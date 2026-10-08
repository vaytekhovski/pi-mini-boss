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
      const send = () => stream.writeSSE({ event: "tasks", data: JSON.stringify(snapshot()) });
      const off = store.onChange(() => {
        void send();
      });
      stream.onAbort(off);
      await send();
      // Keep the connection open; a periodic ping lets the client detect drops.
      while (!stream.aborted) {
        await stream.sleep(15000);
        await stream.writeSSE({ event: "ping", data: "1" });
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
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port }, (info) => {
      resolve({
        url: `http://localhost:${info.port}`,
        stop: () => server.close(),
      });
    });
  });
}
