/**
 * pi-mini-boss activity store — a realtime feed of what the main agent and its
 * subagents are doing right now. The `boss` tool writes here; the dashboard
 * streams it over SSE next to the task board.
 *
 * One SQLite table `runs` holds two kinds of rows:
 *   • `agent`    — one upserted row per project: the orchestrator's current step.
 *   • `subagent` — append-only rows: a launched subagent's lifecycle.
 */
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { AGENT_ROOT } from "../paths.js";
import { loadBetterSqlite3 } from "../store/sqlite-native.js";

export type RunKind = "agent" | "subagent";
/** `waiting` is only used on an `agent` row (the user is being asked something); subagents stay running/done/error. */
export type RunStatus = "running" | "done" | "error" | "waiting";

export interface Run {
  id: number;
  kind: RunKind;
  name: string;
  status: RunStatus;
  detail: string;
  /** Owning project name; `""` means unknown (legacy rows, or no cwd). */
  project: string;
  createdAt: number;
  updatedAt: number;
}

/** Everything the dashboard needs to render the activity panel. */
export interface ActivitySnapshot {
  /** Freshest agent row, kept for backward compatibility. */
  agent: Run | null;
  /** Every agent row, one per project (newest first). */
  agents: Run[];
  runs: Run[];
}

/** Default store location (module-owned, next to the agent config). */
export const DEFAULT_ACTIVITY_DB = path.join(AGENT_ROOT, "pi-mini-boss", "activity.db");

interface Row {
  id: number;
  kind: string;
  name: string;
  status: string;
  detail: string;
  project: string;
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
  transaction<T>(fn: () => T): () => T;
  close(): void;
}
type DbCtor = new (dbPath: string) => Db;

function toRun(row: Row): Run {
  return {
    id: row.id,
    kind: row.kind as RunKind,
    name: row.name,
    status: row.status as RunStatus,
    detail: row.detail,
    project: row.project,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** SQLite-backed activity store with a change emitter for the SSE stream. */
export class ActivityStore {
  private readonly db: Db;
  private readonly events = new EventEmitter();

  constructor(dbPath: string = DEFAULT_ACTIVITY_DB, ctor?: DbCtor) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const Database = ctor ?? (loadBetterSqlite3() as DbCtor);
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL DEFAULT 'subagent',
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        detail TEXT NOT NULL DEFAULT '',
        project TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    this.migrateProjectColumn();
  }

  /**
   * Idempotent migration for databases written before activity rows carried a
   * project (mirrors the task store's PRAGMA-based column check).
   */
  private migrateProjectColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(runs)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "project")) {
      this.db.exec("ALTER TABLE runs ADD COLUMN project TEXT NOT NULL DEFAULT ''");
    }
  }

  /** Subscribe to every mutation (used by the SSE stream). */
  onChange(listener: () => void): () => void {
    this.events.on("change", listener);
    return () => this.events.off("change", listener);
  }

  private changed(): void {
    this.events.emit("change");
  }

  /** Upsert the orchestrator's current activity for one project. */
  setAgentActivity(detail: string, project = ""): Run {
    return this.upsertAgent(detail, "running", project);
  }

  /**
   * Toggle the "agent is waiting for the user" flag on the project's agent row.
   * Only the status changes; the stored detail is preserved. A row created just
   * to carry the waiting signal (no detail yet) is deleted when the wait ends,
   * so the dashboard never shows a phantom "● работает" with an empty detail.
   * Turning the flag off for a project with no agent row is a no-op.
   */
  setWaiting(waiting: boolean, project = ""): Run | undefined {
    if (!waiting) {
      const dropped = this.dropIdleAgent(project);
      if (dropped !== false) return undefined;
    }
    return this.upsertAgent(null, waiting ? "waiting" : "running", project);
  }

  /**
   * Resolve the project's freshest agent row when the waiting flag turns off.
   * Returns `true` when an empty "waiting" row was deleted, `false` when the
   * row exists and should keep running, and `undefined` when the project has no
   * agent row at all — so `setWaiting(false)` never inserts a phantom row.
   */
  private dropIdleAgent(project: string): boolean | undefined {
    const row = this.db
      .prepare("SELECT id, detail, status FROM runs WHERE kind = 'agent' AND project = ? ORDER BY id DESC LIMIT 1")
      .get(project) as { id: number; detail: string; status: string } | undefined;
    if (!row) return undefined;
    if (row.detail !== "" || row.status !== "waiting") return false;
    this.db.prepare("DELETE FROM runs WHERE id = ?").run(row.id);
    this.changed();
    return true;
  }

  /**
   * Upsert the agent row for `project` (one row per project). `detail === null`
   * keeps the stored detail; otherwise it replaces it.
   */
  private upsertAgent(detail: string | null, status: RunStatus, project: string): Run {
    const now = Date.now();
    const id = this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT id FROM runs WHERE kind = 'agent' AND project = ? ORDER BY id DESC LIMIT 1")
        .get(project) as { id: number } | undefined;
      if (existing) {
        if (detail === null) {
          this.db
            .prepare("UPDATE runs SET status = ?, updated_at = ? WHERE id = ?")
            .run(status, now, existing.id);
        } else {
          this.db
            .prepare("UPDATE runs SET status = ?, detail = ?, updated_at = ? WHERE id = ?")
            .run(status, detail, now, existing.id);
        }
        return existing.id;
      }
      const info = this.db
        .prepare(
          `INSERT INTO runs (kind, name, status, detail, project, created_at, updated_at)
           VALUES ('agent', 'agent', ?, ?, ?, ?, ?)`,
        )
        .run(status, detail ?? "", project, now, now);
      return Number(info.lastInsertRowid);
    })();
    this.changed();
    return this.get(id)!;
  }

  /**
   * Record a subagent's lifecycle. `running` upserts by name within its project
   * (no duplicates); `done`/`error` close the latest running run with that name,
   * or append a finished row when there is no open one.
   */
  recordSubagent(name: string, status: RunStatus, detail = "", project = ""): Run {
    if (status === "running") {
      const open = this.getOpenRun(name, project);
      if (open) {
        this.db
          .prepare("UPDATE runs SET detail = ?, updated_at = ? WHERE id = ?")
          .run(detail || open.detail, Date.now(), open.id);
        this.changed();
        return this.get(open.id)!;
      }
      return this.insertRun(name, "running", detail, project);
    }
    const open = this.getOpenRun(name, project);
    if (open) {
      this.db
        .prepare("UPDATE runs SET status = ?, detail = ?, updated_at = ? WHERE id = ?")
        .run(status, detail || open.detail, Date.now(), open.id);
      this.changed();
      return this.get(open.id)!;
    }
    return this.insertRun(name, status, detail, project);
  }

  private insertRun(name: string, status: RunStatus, detail: string, project: string): Run {
    const now = Date.now();
    const info = this.db
      .prepare(
        `INSERT INTO runs (kind, name, status, detail, project, created_at, updated_at)
         VALUES ('subagent', ?, ?, ?, ?, ?, ?)`,
      )
      .run(name, status, detail, project, now, now);
    this.changed();
    return this.get(Number(info.lastInsertRowid))!;
  }

  /** The most recent `running` subagent run with this name in this project, if any. */
  private getOpenRun(name: string, project: string): Row | undefined {
    return this.db
      .prepare(
        "SELECT * FROM runs WHERE kind = 'subagent' AND name = ? AND project = ? AND status = 'running' ORDER BY id DESC LIMIT 1",
      )
      .get(name, project) as Row | undefined;
  }

  get(id: number): Run | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
    return row ? toRun(row) : null;
  }

  /** The freshest agent row across all projects (backward-compatible accessor). */
  getAgent(): Run | null {
    const row = this.db
      .prepare("SELECT * FROM runs WHERE kind = 'agent' ORDER BY updated_at DESC, id DESC LIMIT 1")
      .get() as Row | undefined;
    return row ? toRun(row) : null;
  }

  /** All agent rows, one per project, newest first. */
  listAgents(): Run[] {
    const rows = this.db
      .prepare("SELECT * FROM runs WHERE kind = 'agent' ORDER BY updated_at DESC, id DESC")
      .all() as Row[];
    return rows.map(toRun);
  }

  /** Recent subagent runs, newest first (running ones first in practice). */
  listRuns(limit = 50): Run[] {
    const rows = this.db
      .prepare("SELECT * FROM runs WHERE kind = 'subagent' ORDER BY id DESC LIMIT ?")
      .all(limit) as Row[];
    return rows.map(toRun);
  }

  snapshot(): ActivitySnapshot {
    return { agent: this.getAgent(), agents: this.listAgents(), runs: this.listRuns() };
  }

  /**
   * Mark any `running`/`waiting` row in `projects` as done — a fresh session for
   * those projects means nothing from a past one is still working. When
   * `staleBeforeMs` is given, only rows whose `updated_at` is before that
   * absolute timestamp are closed. Returns the number of rows changed; an empty
   * list is a no-op.
   */
  finishStaleProjects(projects: string[], staleBeforeMs?: number): number {
    if (projects.length === 0) return 0;
    const placeholders = projects.map(() => "?").join(", ");
    const info = this.db
      .prepare(
        `UPDATE runs SET status = 'done', updated_at = ? WHERE status IN ('running', 'waiting') AND project IN (${placeholders})${staleBeforeMs !== undefined ? " AND updated_at < ?" : ""}`,
      )
      .run(Date.now(), ...projects, ...(staleBeforeMs !== undefined ? [staleBeforeMs] : []));
    const changes = Number(info.changes);
    if (changes > 0) this.changed();
    return changes;
  }

  close(): void {
    this.events.removeAllListeners();
    this.db.close();
  }
}
