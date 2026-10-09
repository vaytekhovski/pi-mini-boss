/**
 * pi-mini-boss `boss` tool — the orchestrator's feed into the dashboard activity
 * panel. Two actions:
 *   • `activity` — report what the main agent is doing right now;
 *   • `subagent` — record a subagent launch / finish (running → done / error).
 *
 * Kept separate from the `task` tool: tasks are deliverables, activity is "who
 * is busy with what", which the dashboard shows in its own realtime panel.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { detectProject } from "../project.js";
import type { ActivityStore } from "./store.js";

/** Project name used when a cwd exists but no project can be detected. */
const INBOX_PROJECT = "inbox";

/** Проект из cwd; без cwd не выдумываем. */
export function resolveActivityProject(projectsMemoryDir: string | undefined, cwd?: string): string {
  return cwd ? detectProject(projectsMemoryDir, cwd).name ?? INBOX_PROJECT : "";
}

const BOSS_PARAMETERS = Type.Object({
  action: Type.Optional(StringEnum(["activity", "subagent"] as const)),
  detail: Type.Optional(Type.String({ description: "Что делается сейчас (activity / subagent)" })),
  name: Type.Optional(Type.String({ description: "Имя субагента (для action=subagent)" })),
  status: Type.Optional(StringEnum(["running", "done", "error"] as const)),
  waiting: Type.Optional(
    Type.Boolean({ description: "true — агент ждёт ответа пользователя, false — продолжил работу" }),
  ),
});

interface BossParams {
  action?: "activity" | "subagent";
  detail?: string;
  name?: string;
  status?: "running" | "done" | "error";
  waiting?: boolean;
}

const hiddenRenderer = { render: (): string[] => [], invalidate: (): void => {} };

/** Register the `boss` tool against a lazily-resolved activity store. */
export function registerBossTool(
  pi: ExtensionAPI,
  getStore: () => ActivityStore,
  projectsMemoryDir?: string,
): void {
  pi.registerTool({
    name: "boss",
    label: "Activity",
    description:
      "Report realtime activity to the pi-mini-boss dashboard. `boss activity <detail>` sets what the main agent is doing. `boss subagent name=<n> status=running|done|error detail=<d>` records a subagent's lifecycle.",
    promptSnippet: "Feed the dashboard activity panel",
    promptGuidelines: [
      "Call `boss activity` at the start of each pipeline stage so the dashboard always shows what you are doing.",
      "Call `boss subagent ... status=running` when you launch a subagent and status=done/error when it returns.",
      "Keep details short and human-readable; they render in the dashboard activity panel.",
    ],
    parameters: BOSS_PARAMETERS,
    renderShell: "self",
    renderCall: () => hiddenRenderer,
    renderResult: () => hiddenRenderer,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx?: { cwd?: string }) {
      const store = getStore();
      const { action, detail, name, status, waiting } = params as BossParams;
      // The project comes from the session cwd; with no cwd we do not invent one
      // and record under the empty (legacy) project instead.
      const project = resolveActivityProject(projectsMemoryDir, ctx?.cwd);

      // A waiting toggle is independent of activity/subagent.
      if (waiting !== undefined) {
        const run = store.setWaiting(waiting, project);
        return {
          content: [
            { type: "text" as const, text: waiting ? "Агент ждёт ответа пользователя" : "Агент продолжил работу" },
          ],
          details: { run },
        };
      }

      if (action === undefined) {
        throw new Error("boss requires an `action` or `waiting`");
      }

      if (action === "activity") {
        if (!detail) {
          throw new Error("boss activity requires a `detail`");
        }
        const run = store.setAgentActivity(detail, project);
        return { content: [{ type: "text" as const, text: `Агент: ${run.detail}` }], details: { run } };
      }

      // action === "subagent"
      if (!name) {
        throw new Error("boss subagent requires a `name`");
      }
      const run = store.recordSubagent(name, status ?? "running", detail ?? "", project);
      const text =
        run.status === "running"
          ? `Субагент ${run.name} → running${run.detail ? ` (${run.detail})` : ""}`
          : `Субагент ${run.name} → ${run.status}${run.detail ? ` (${run.detail})` : ""}`;
      return { content: [{ type: "text" as const, text }], details: { run } };
    },
  });
}
