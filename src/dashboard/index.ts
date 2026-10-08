/**
 * pi-mini-boss dashboard lifecycle — starts the Hono server on demand
 * (`/dashboard`) and stops it on session shutdown.
 *
 * The socket is started from a command, never from the factory, so headless
 * invocations never open a port.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TaskStore } from "../tasks/store.js";
import { DEFAULT_DASHBOARD_PORT, startDashboard, type DashboardHandle } from "./server.js";

/** Register the `/dashboard` command and its shutdown cleanup. */
export function registerDashboard(pi: ExtensionAPI, getStore: () => TaskStore): void {
  let handle: DashboardHandle | undefined;
  let starting: Promise<DashboardHandle> | undefined;

  pi.registerCommand("dashboard", {
    description: "Открыть веб-дашборд задач (реалтайм, SSE)",
    handler: async (_args, ctx) => {
      if (!handle) {
        starting ??= startDashboard(getStore(), DEFAULT_DASHBOARD_PORT);
        handle = await starting;
      }
      ctx.ui.notify(`pi-mini-boss dashboard → ${handle.url}`, "info");
    },
  });

  pi.on("session_shutdown", async () => {
    handle?.stop();
    handle = undefined;
    starting = undefined;
  });
}
