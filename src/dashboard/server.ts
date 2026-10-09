/**
 * pi-mini-boss dashboard server — Hono HTTP + SSE over the shared task store
 * and the activity store.
 *
 * One process serves both the JSON API and the realtime stream, so the web UI
 * and the native TUI read the same SQLite stores.
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import {
  TASK_STATUSES,
  type Project,
  type Task,
  type TaskCounts,
  type TaskPatch,
  type TaskStore,
} from "../tasks/store.js";
import type { ActivitySnapshot, ActivityStore } from "../activity/store.js";
import { detectProject } from "../project.js";
import { renderDashboardHtml } from "./ui.js";

export const DEFAULT_DASHBOARD_PORT = 7817;

const PATCHABLE_STATUSES = new Set<string>(TASK_STATUSES);
const PATCHABLE_PRIORITIES = new Set<string>(["low", "normal", "high", "urgent"]);

/** Everything the multi-project board needs in one poll. */
export interface DashboardSnapshot {
  /** Session project, or the project with the most unfinished tasks, or null. */
  currentProject: string | null;
  projects: Project[];
  tasks: Task[];
  counts: TaskCounts;
  activity: ActivitySnapshot;
}

/**
 * Fallback for `currentProject` when the process cwd is not a project: the
 * project owning the most unfinished (not completed) tasks. With several
 * projects running in parallel this is the one the user is most likely viewing.
 */
function busiestProject(tasks: Task[], projects: Project[]): string | null {
  const unfinished = new Map<number, number>();
  for (const task of tasks) {
    if (task.projectId === null || task.status === "completed") continue;
    unfinished.set(task.projectId, (unfinished.get(task.projectId) ?? 0) + 1);
  }
  let bestId: number | null = null;
  let bestCount = 0;
  for (const [id, count] of unfinished) {
    if (count > bestCount) {
      bestId = id;
      bestCount = count;
    }
  }
  return bestId === null ? null : (projects.find((project) => project.id === bestId)?.name ?? null);
}

/** Parse a task patch from a JSON body, rejecting unknown fields. */
function parseTaskPatch(body: unknown): TaskPatch {
  if (typeof body !== "object" || body === null) {
    throw new Error("body must be a JSON object");
  }
  const { subject, description, status, activeForm, priority } = body as Record<string, unknown>;
  const patch: TaskPatch = {};
  if (subject !== undefined) {
    if (typeof subject !== "string") throw new Error("subject must be a string");
    patch.subject = subject;
  }
  if (description !== undefined) {
    if (typeof description !== "string") throw new Error("description must be a string");
    patch.description = description;
  }
  if (status !== undefined) {
    if (typeof status !== "string" || !PATCHABLE_STATUSES.has(status)) {
      throw new Error(`unknown status: ${String(status)}`);
    }
    patch.status = status as TaskPatch["status"];
  }
  if (activeForm !== undefined) {
    if (typeof activeForm !== "string") throw new Error("activeForm must be a string");
    patch.activeForm = activeForm;
  }
  if (priority !== undefined) {
    if (typeof priority !== "string" || !PATCHABLE_PRIORITIES.has(priority)) {
      throw new Error(`unknown priority: ${String(priority)}`);
    }
    patch.priority = priority as TaskPatch["priority"];
  }
  return patch;
}

/** Fastify-free Hono app exposing the task store and the activity store. */
export function createDashboardApp(
  store: TaskStore,
  activity: ActivityStore,
  projectsMemoryDir?: string,
  sessionCwd?: string,
): Hono {
  const app = new Hono();

  // The session project is fixed for the process lifetime; detect it once so a
  // per-second poll never re-walks the filesystem. `undefined` means "not yet".
  let detectedProject: string | null | undefined;
  const sessionProject = (tasks: Task[], projects: Project[]): string | null => {
    if (detectedProject === undefined) {
      try {
        detectedProject = detectProject(projectsMemoryDir, sessionCwd ?? process.cwd()).name;
      } catch {
        detectedProject = null;
      }
    }
    return detectedProject ?? busiestProject(tasks, projects);
  };

  const taskSnapshot = (): DashboardSnapshot => {
    const snap = store.snapshot();
    return {
      currentProject: sessionProject(snap.tasks, snap.projects),
      projects: snap.projects,
      tasks: snap.tasks,
      counts: snap.counts,
      activity: activity.snapshot(),
    };
  };
  const activitySnapshot = () => activity.snapshot();

  app.get("/api/tasks", (c) => c.json(taskSnapshot()));

  // Edit a task from the dashboard. The body is either a field patch
  // (subject/description/status/activeForm/priority) or a command carrying an
  // `action` for lightweight board operations (move / project).
  app.patch("/api/tasks/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) {
      return c.json({ error: "invalid id" }, 400);
    }
    const body = await c.req.json().catch(() => null);
    if (typeof body !== "object" || body === null) {
      return c.json({ error: "body must be a JSON object" }, 400);
    }

    const action = (body as Record<string, unknown>).action;
    if (action !== undefined) {
      if (action === "move") {
        const status = (body as Record<string, unknown>).status;
        if (typeof status !== "string" || !PATCHABLE_STATUSES.has(status)) {
          return c.json({ error: `unknown status: ${String(status)}` }, 400);
        }
        const task = store.update(id, { status: status as TaskPatch["status"] });
        if (!task) {
          return c.json({ error: `task #${id} not found` }, 404);
        }
        return c.json(task);
      }
      if (action === "project") {
        const project = (body as Record<string, unknown>).project;
        if (typeof project !== "string" || !project.trim()) {
          return c.json({ error: "project must be a non-empty string" }, 400);
        }
        if (!store.get(id)) {
          return c.json({ error: `task #${id} not found` }, 404);
        }
        const target = store.ensureProject(project.trim());
        const task = store.update(id, { projectId: target.id });
        return c.json(task);
      }
      return c.json({ error: `unknown action: ${String(action)}` }, 400);
    }

    let patch: TaskPatch;
    try {
      patch = parseTaskPatch(body);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "bad request" }, 400);
    }
    if (Object.keys(patch).length === 0) {
      return c.json({ error: "empty patch" }, 400);
    }
    const task = store.update(id, patch);
    if (!task) {
      return c.json({ error: `task #${id} not found` }, 404);
    }
    return c.json(task);
  });

  app.get("/api/activity", (c) => c.json(activitySnapshot()));

  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      // Writing to a stream the client already dropped must not surface as an
      // unhandled rejection — it would take the whole dashboard down.
      const write = (event: string, data: string) => stream.writeSSE({ event, data }).catch(() => {});
      const sendTasks = () => write("tasks", JSON.stringify(taskSnapshot()));
      const sendActivity = () => write("activity", JSON.stringify(activitySnapshot()));
      let closed: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        closed = resolve;
      });
      const offTasks = store.onChange(() => {
        void sendTasks();
      });
      const offActivity = activity.onChange(() => {
        void sendActivity();
      });
      stream.onAbort(() => {
        offTasks();
        offActivity();
        closed();
      });
      await sendTasks();
      await sendActivity();
      // Keep the connection open; the ping lets the client detect drops, and the
      // race ends the loop as soon as the client goes away.
      while (!stream.aborted) {
        // Own clearable timer instead of stream.sleep: otherwise a client that
        // disconnects mid-wait leaves a 15s handle that keeps the process alive.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const tick = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 15000);
        });
        await Promise.race([tick, done]);
        clearTimeout(timer);
        if (stream.aborted) {
          break;
        }
        await write("ping", "1");
      }
    }),
  );

  app.get("/", (c) => c.html(renderDashboardHtml()));
  return app;
}

/** A running dashboard server. */
export interface DashboardHandle {
  url: string;
  stop(): void;
}

/** Start the dashboard; resolves once the port is bound. */
export function startDashboard(
  store: TaskStore,
  activity: ActivityStore,
  port: number = DEFAULT_DASHBOARD_PORT,
  projectsMemoryDir?: string,
  sessionCwd?: string,
): Promise<DashboardHandle> {
  const app = createDashboardApp(store, activity, projectsMemoryDir, sessionCwd);
  return new Promise((resolve, reject) => {
    // Serve on the loopback interface only: the board exposes tasks/activity and
    // must never be reachable from the network.
    const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
      resolve({
        url: `http://127.0.0.1:${info.port}`,
        stop: () => server.close(),
      });
    });
    // Without this the promise never settles when the port is taken (EADDRINUSE)
    // and /dashboard hangs instead of saying why.
    server.on("error", reject);
  });
}
