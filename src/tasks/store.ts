/**
 * pi-mini-boss task store — the single source of truth for tasks, shared by the
 * agent's `task` tool, the native TUI panel, and the web dashboard.
 *
 * Replaces the in-session todo state (rpiv-todo) and the kanban-sync file hacks
 * with one SQLite store that every surface reads.
 */
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { AGENT_ROOT } from "../paths.js";
import { loadBetterSqlite3 } from "../store/sqlite-native.js";

/** Task lifecycle. `blocked` and `deleted` exist beyond the classic three. */
export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "deleted";
export const TASK_STATUSES: readonly TaskStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "deleted",
];

/** Priority hint; free-form but the UI colours these. */
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface Task {
  id: number;
  subject: string;
  description: string;
  status: TaskStatus;
  activeForm: string;
  priority: TaskPriority;
  createdAt: number;
  updatedAt: number;
}

export interface TaskInput {
  subject: string;
  description?: string;
  status?: TaskStatus;
  activeForm?: string;
  priority?: TaskPriority;
}

export interface TaskPatch {
  subject?: string;
  description?: string;
  status?: TaskStatus;
  activeForm?: string;
  priority?: TaskPriority;
}

export interface TaskCounts {
  total: number;
  pending: number;
  in_progress: number;
  completed: number;
  blocked: number;
}

/** Default store location (module-owned, next to the agent config). */
export const DEFAULT_TASKS_DB = path.join(AGENT_ROOT, "pi-mini-boss", "tasks.db");

/** One choice in a question. */
export interface QuestionOption {
  label: string;
  description?: string;
  /** Pre-selected in the board (multi-select). */
  selected?: boolean;
}

export interface QuestionInput {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: QuestionOption[];
}

export type QuestionStatus = "pending" | "answered" | "cancelled";

/** A question asked through the board (the terminal side panel). */
export interface Question {
  id: number;
  question: string;
  header: string;
  multiSelect: boolean;
  options: QuestionOption[];
  answer: string[] | null;
  status: QuestionStatus;
  createdAt: number;
  answeredAt: number | null;
}

interface Row {
  id: number;
  subject: string;
  description: string;
  status: string;
  active_form: string;
  priority: string;
  created_at: number;
  updated_at: number;
}

/** Minimal better-sqlite3 surface this store needs. */
interface Statement {
  run(...args: unknown[]): { lastInsertRowid: number | bigint; changes: number };
  all(...args: unknown[]): unknown[];
  get(...args: unknown[]): unknown;
}
interface Db {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}
type DbCtor = new (dbPath: string) => Db;

interface QuestionRow {
  id: number;
  question: string;
  header: string;
  multi_select: number;
  options: string;
  answer: string | null;
  status: string;
  created_at: number;
  answered_at: number | null;
}

function toQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    question: row.question,
    header: row.header,
    multiSelect: row.multi_select === 1,
    options: JSON.parse(row.options) as QuestionOption[],
    answer: row.answer ? (JSON.parse(row.answer) as string[]) : null,
    status: row.status as QuestionStatus,
    createdAt: row.created_at,
    answeredAt: row.answered_at,
  };
}

function toTask(row: Row): Task {
  return {
    id: row.id,
    subject: row.subject,
    description: row.description,
    status: row.status as TaskStatus,
    activeForm: row.active_form,
    priority: row.priority as TaskPriority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** SQLite-backed task store with a change emitter for realtime UIs. */
export class TaskStore {
  private readonly db: Db;
  private readonly events = new EventEmitter();

  constructor(dbPath: string = DEFAULT_TASKS_DB, ctor?: DbCtor) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const Database = ctor ?? (loadBetterSqlite3() as DbCtor);
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS board (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        pid INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question TEXT NOT NULL,
        header TEXT NOT NULL DEFAULT '',
        multi_select INTEGER NOT NULL DEFAULT 0,
        options TEXT NOT NULL,
        answer TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        answered_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        active_form TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'normal',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  /** Subscribe to every mutation (used by the SSE stream). */
  onChange(listener: () => void): () => void {
    this.events.on("change", listener);
    return () => this.events.off("change", listener);
  }

  private changed(): void {
    this.events.emit("change");
  }

  create(input: TaskInput): Task {
    const now = Date.now();
    const info = this.db
      .prepare(
        `INSERT INTO tasks (subject, description, status, active_form, priority, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.subject,
        input.description ?? "",
        input.status ?? "pending",
        input.activeForm ?? "",
        input.priority ?? "normal",
        now,
        now,
      );
    this.changed();
    return this.get(Number(info.lastInsertRowid))!;
  }

  update(id: number, patch: TaskPatch): Task | null {
    const current = this.get(id);
    if (!current) {
      return null;
    }
    this.db
      .prepare(
        `UPDATE tasks SET subject = ?, description = ?, status = ?, active_form = ?, priority = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.subject ?? current.subject,
        patch.description ?? current.description,
        patch.status ?? current.status,
        patch.activeForm ?? current.activeForm,
        patch.priority ?? current.priority,
        Date.now(),
        id,
      );
    this.changed();
    return this.get(id);
  }

  get(id: number): Task | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Row | undefined;
    return row ? toTask(row) : null;
  }

  /** All non-deleted tasks, oldest first (stable board order). */
  list(status?: TaskStatus): Task[] {
    const rows = status
      ? (this.db.prepare("SELECT * FROM tasks WHERE status = ? ORDER BY id").all(status) as Row[])
      : (this.db
          .prepare("SELECT * FROM tasks WHERE status != 'deleted' ORDER BY id")
          .all() as Row[]);
    return rows.map(toTask);
  }

  remove(id: number): boolean {
    const info = this.db.prepare("UPDATE tasks SET status = 'deleted', updated_at = ? WHERE id = ?").run(Date.now(), id);
    if (info.changes > 0) {
      this.changed();
      return true;
    }
    return false;
  }

  clear(): void {
    this.db.exec("DELETE FROM tasks");
    this.changed();
  }

  counts(): TaskCounts {
    const rows = this.db
      .prepare("SELECT status, COUNT(*) AS n FROM tasks WHERE status != 'deleted' GROUP BY status")
      .all() as Array<{ status: string; n: number }>;
    const counts: TaskCounts = { total: 0, pending: 0, in_progress: 0, completed: 0, blocked: 0 };
    for (const { status, n } of rows) {
      counts.total += n;
      if (status in counts) {
        counts[status as keyof TaskCounts] += n;
      }
    }
    return counts;
  }

  // ── Board liveness ─────────────────────────────────────────────────────

  /** Liveness beacon written by the board process each tick. */
  heartbeat(pid: number = process.pid): void {
    this.db
      .prepare(
        "INSERT INTO board (id, pid, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET pid = excluded.pid, updated_at = excluded.updated_at",
      )
      .run(pid, Date.now());
  }

  /** True when a board process beat recently enough to answer questions. */
  boardAlive(maxAgeMs = 4000): boolean {
    const row = this.db.prepare("SELECT updated_at FROM board WHERE id = 1").get() as
      | { updated_at: number }
      | undefined;
    return row !== undefined && Date.now() - row.updated_at < maxAgeMs;
  }

  // ── Questions (asked through the board) ────────────────────────────────

  /** Publish a question for the board to display; the caller polls for the answer. */
  askQuestion(input: QuestionInput): Question {
    const info = this.db
      .prepare(
        `INSERT INTO questions (question, header, multi_select, options, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        input.question,
        input.header ?? "",
        input.multiSelect ? 1 : 0,
        JSON.stringify(input.options),
        Date.now(),
      );
    this.changed();
    return this.getQuestion(Number(info.lastInsertRowid))!;
  }

  getQuestion(id: number): Question | null {
    const row = this.db.prepare("SELECT * FROM questions WHERE id = ?").get(id) as
      | QuestionRow
      | undefined;
    return row ? toQuestion(row) : null;
  }

  /** The newest unanswered question, if any — what the board shows. */
  pendingQuestion(): Question | null {
    const row = this.db
      .prepare("SELECT * FROM questions WHERE status = 'pending' ORDER BY id DESC LIMIT 1")
      .get() as QuestionRow | undefined;
    return row ? toQuestion(row) : null;
  }

  /** Record the board's answer. Returns null if the question was already resolved. */
  answerQuestion(id: number, answer: string[]): Question | null {
    const info = this.db
      .prepare(
        "UPDATE questions SET answer = ?, status = 'answered', answered_at = ? WHERE id = ? AND status = 'pending'",
      )
      .run(JSON.stringify(answer), Date.now(), id);
    if (info.changes === 0) {
      return null;
    }
    this.changed();
    return this.getQuestion(id);
  }

  cancelQuestion(id: number): boolean {
    const info = this.db
      .prepare("UPDATE questions SET status = 'cancelled', answered_at = ? WHERE id = ? AND status = 'pending'")
      .run(Date.now(), id);
    if (info.changes > 0) {
      this.changed();
      return true;
    }
    return false;
  }

  close(): void {
    this.events.removeAllListeners();
    this.db.close();
  }
}
