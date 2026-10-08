/**
 * pi-mini-boss dashboard server — Hono HTTP + SSE over the shared task store.
 *
 * One process serves both the JSON API and the realtime stream, so the web UI
 * and the native TUI read the same SQLite store.
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import type { TaskStore } from "../tasks/store.js";
import { renderDashboardHtml } from "./ui.js";

export const DEFAULT_DASHBOARD_PORT = 7817;

/** Fastify-free Hono app exposing the task store. */
export function createDashboardApp(store: TaskStore): Hono {
  const app = new Hono();
  const snapshot = () => ({ tasks: store.list(), counts: store.counts() });

  app.get("/api/tasks", (c) => c.json(snapshot()));

  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      // Writing to a stream the client already dropped must not surface as an
      // unhandled rejection — it would take the whole dashboard down.
      const write = (event: string, data: string) => stream.writeSSE({ event, data }).catch(() => {});
      const send = () => write("tasks", JSON.stringify(snapshot()));
      let closed: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        closed = resolve;
      });
      const off = store.onChange(() => {
        void send();
      });
      stream.onAbort(() => {
        off();
        closed();
      });
      await send();
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
export function startDashboard(store: TaskStore, port: number = DEFAULT_DASHBOARD_PORT): Promise<DashboardHandle> {
  const app = createDashboardApp(store);
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      resolve({
        url: `http://localhost:${info.port}`,
        stop: () => server.close(),
      });
    });
    // Without this the promise never settles when the port is taken (EADDRINUSE)
    // and /dashboard hangs instead of saying why.
    server.on("error", reject);
  });
}
