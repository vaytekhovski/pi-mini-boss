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

/**
 * Task lifecycle as a pipeline. The six middle stages are the workflow:
 * analysis → planning → development → review → testing → report. `blocked`
 * and `deleted` exist beyond the pipeline.
 */
export type TaskStatus =
  | "pending"
  | "analysis"
  | "planning"
  | "development"
  | "review"
  | "testing"
  | "report"
  | "completed"
  | "blocked"
  | "deleted";
export const TASK_STATUSES: readonly TaskStatus[] = [
  "pending",
  "analysis",
  "planning",
  "development",
  "review",
  "testing",
  "report",
  "completed",
  "blocked",
  "deleted",
];

/** Stages that represent active work (an `activeForm` label makes sense here). */
export const ACTIVE_STATUSES: readonly TaskStatus[] = [
  "analysis",
  "planning",
  "development",
  "review",
  "testing",
  "report",
];

/** Priority hint; free-form but the UI colours these. */
export type TaskPriority = "low" | "normal" | "high" | "urgent";

/** A project owns tasks; its identity mirrors a session's git repo / cwd. */
export interface Project {
  id: number;
  name: string;
  path: string;
  createdAt: number;
  updatedAt: number;
}

export interface Task {
  id: number;
  subject: string;
  description: string;
  status: TaskStatus;
  activeForm: string;
  priority: TaskPriority;
  /** Owning project id, or null for tasks outside any project. */
  projectId: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TaskInput {
  subject: string;
  description?: string;
  status?: TaskStatus;
  activeForm?: string;
  priority?: TaskPriority;
  projectId?: number | null;
}

export interface TaskPatch {
  subject?: string;
  description?: string;
  status?: TaskStatus;
  activeForm?: string;
  priority?: TaskPriority;
  projectId?: number | null;
}

export interface TaskCounts {
  total: number;
  pending: number;
  analysis: number;
  planning: number;
  development: number;
  review: number;
  testing: number;
  report: number;
  completed: number;
  blocked: number;
}

/** Default store location (module-owned, next to the agent config). */
export const DEFAULT_TASKS_DB = path.join(AGENT_ROOT, "pi-mini-boss", "tasks.db");

interface Row {
  id: number;
  subject: string;
  description: string;
  status: string;
  active_form: string;
  priority: string;
  project_id: number | null;
  created_at: number;
  updated_at: number;
}

interface ProjectRow {
  id: number;
  name: string;
  path: string;
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

function toTask(row: Row): Task {
  return {
    id: row.id,
    subject: row.subject,
    description: row.description,
    status: row.status as TaskStatus,
    activeForm: row.active_form,
    priority: row.priority as TaskPriority,
    projectId: row.project_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
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
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        path TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        active_form TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'normal',
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    this.migrateTaskProjectColumn();
  }

  /**
   * Idempotent schema and data migrations for databases written by older builds:
   * add `tasks.project_id` when the projects table was introduced, and fold the
   * retired `in_progress` status into `development` so old rows stay visible.
   */
  private migrateTaskProjectColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "project_id")) {
      this.db.exec(
        "ALTER TABLE tasks ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL",
      );
    }
    // `in_progress` predates the pipeline statuses; the UPDATE is a no-op once run.
    this.db.exec("UPDATE tasks SET status = 'development' WHERE status = 'in_progress'");
  }

  /**
   * Upsert a project by name. The path is only (re)written when provided and it
   * differs from the stored one; an unchanged project does not emit a change.
   */
  ensureProject(name: string, path = ""): Project {
    const trimmed = name.trim();
    const now = Date.now();
    // Two processes can race the same name; ON CONFLICT DO NOTHING makes the
    // insert safe and the following SELECT returns whichever row won.
    const inserted = this.db
      .prepare(
        "INSERT INTO projects (name, path, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO NOTHING",
      )
      .run(trimmed, path, now, now);
    const existing = this.db.prepare("SELECT * FROM projects WHERE name = ?").get(trimmed) as ProjectRow;
    if (inserted.changes > 0) {
      this.changed();
      return toProject(existing);
    }
    const nextPath = path && path !== existing.path ? path : existing.path;
    if (nextPath !== existing.path) {
      this.db
        .prepare("UPDATE projects SET path = ?, updated_at = ? WHERE id = ?")
        .run(nextPath, now, existing.id);
      this.changed();
      return { ...toProject(existing), path: nextPath, updatedAt: now };
    }
    return toProject(existing);
  }

  /** All projects, oldest first. */
  listProjects(): Project[] {
    const rows = this.db.prepare("SELECT * FROM projects ORDER BY id").all() as ProjectRow[];
    return rows.map(toProject);
  }

  /** Bind every project-less task to `projectId`; returns the number of rows moved. */
  assignLegacyTasks(projectId: number): number {
    const info = this.db
      .prepare("UPDATE tasks SET project_id = ?, updated_at = ? WHERE project_id IS NULL")
      .run(projectId, Date.now());
    if (info.changes > 0) {
      this.changed();
    }
    return info.changes;
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
        `INSERT INTO tasks (subject, description, status, active_form, priority, project_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.subject,
        input.description ?? "",
        input.status ?? "pending",
        input.activeForm ?? "",
        input.priority ?? "normal",
        input.projectId ?? null,
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
    const projectId = patch.projectId !== undefined ? patch.projectId : current.projectId;
    this.db
      .prepare(
        `UPDATE tasks SET subject = ?, description = ?, status = ?, active_form = ?, priority = ?, project_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.subject ?? current.subject,
        patch.description ?? current.description,
        patch.status ?? current.status,
        patch.activeForm ?? current.activeForm,
        patch.priority ?? current.priority,
        projectId,
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

  /** Non-deleted tasks, oldest first; optionally filtered by status and/or project. */
  list(status?: TaskStatus, projectId?: number): Task[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (status) {
      where.push("status = ?");
      args.push(status);
    } else {
      where.push("status != 'deleted'");
    }
    if (projectId !== undefined) {
      where.push("project_id = ?");
      args.push(projectId);
    }
    const rows = this.db
      .prepare(`SELECT * FROM tasks WHERE ${where.join(" AND ")} ORDER BY id`)
      .all(...args) as Row[];
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

  counts(projectId?: number): TaskCounts {
    const rows = this.db
      .prepare(
        projectId !== undefined
          ? "SELECT status, COUNT(*) AS n FROM tasks WHERE status != 'deleted' AND project_id = ? GROUP BY status"
          : "SELECT status, COUNT(*) AS n FROM tasks WHERE status != 'deleted' GROUP BY status",
      )
      .all(...(projectId !== undefined ? [projectId] : [])) as Array<{ status: string; n: number }>;
    const counts: TaskCounts = {
      total: 0,
      pending: 0,
      analysis: 0,
      planning: 0,
      development: 0,
      review: 0,
      testing: 0,
      report: 0,
      completed: 0,
      blocked: 0,
    };
    for (const { status, n } of rows) {
      counts.total += n;
      if (status in counts) {
        counts[status as keyof TaskCounts] += n;
      }
    }
    return counts;
  }

  /** Aggregate snapshot for realtime UIs: projects, tasks and counts. */
  snapshot(): { projects: Project[]; tasks: Task[]; counts: TaskCounts } {
    return { projects: this.listProjects(), tasks: this.list(), counts: this.counts() };
  }

  close(): void {
    this.events.removeAllListeners();
    this.db.close();
  }
}
