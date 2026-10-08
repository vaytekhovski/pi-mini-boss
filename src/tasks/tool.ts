/**
 * pi-mini-boss `task` tool — the agent's interface to the shared task store.
 *
 * Replaces the in-session todo tool: state is persisted in SQLite and visible to
 * the native TUI panel and the web dashboard at the same time.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { TASK_STATUSES, type Task, type TaskCounts, type TaskStore } from "./store.js";

const TASK_TOOL_NAME = "task";

const STATUS_VALUES = [...TASK_STATUSES] as [
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "deleted",
];
const PRIORITY_VALUES = ["low", "normal", "high", "urgent"] as const;

const TASK_PARAMETERS = Type.Object({
  action: StringEnum(["create", "update", "list", "get", "delete", "clear"] as const),
  id: Type.Optional(Type.Number({ description: "Task id (update/get/delete)" })),
  subject: Type.Optional(Type.String({ description: "Short imperative subject (create/update)" })),
  description: Type.Optional(Type.String({ description: "Long-form detail (create/update)" })),
  status: Type.Optional(StringEnum(STATUS_VALUES)),
  activeForm: Type.Optional(
    Type.String({ description: "Present-continuous label while in_progress" }),
  ),
  priority: Type.Optional(StringEnum(PRIORITY_VALUES)),
});

interface TaskParams {
  action: "create" | "update" | "list" | "get" | "delete" | "clear";
  id?: number;
  subject?: string;
  description?: string;
  status?: (typeof STATUS_VALUES)[number];
  activeForm?: string;
  priority?: (typeof PRIORITY_VALUES)[number];
}

function formatTask(task: Task): string {
  const glyph =
    task.status === "completed" ? "✓" : task.status === "in_progress" ? "◐" : task.status === "blocked" ? "⊘" : "○";
  const extra = task.status === "in_progress" && task.activeForm ? ` (${task.activeForm})` : "";
  return `#${task.id} ${glyph} ${task.subject} [${task.status}/${task.priority}]${extra}`;
}

interface TaskDetails {
  action: TaskParams["action"];
  task?: Task | null;
  tasks?: Task[];
  counts?: TaskCounts;
  removed?: boolean;
  cleared?: boolean;
}

/** One result shape for every action so the tool's `details` type stays stable. */
function ok(text: string, details: TaskDetails) {
  return { content: [{ type: "text" as const, text }], details };
}

/** Renders nothing: tasks live in the board panel, not the transcript. */
const hiddenRenderer = { render: (): string[] => [], invalidate: (): void => {} };

/** Register the `task` tool against a lazily-resolved store. */
export function registerTaskTool(pi: ExtensionAPI, getStore: () => TaskStore): void {
  pi.registerTool({
    name: TASK_TOOL_NAME,
    label: "Tasks",
    description:
      "Manage the shared pi-mini-boss task list. Actions: create, update, list, get, delete, clear. Status: pending → in_progress → completed, plus blocked and deleted. Update a task's status in the SAME step as the work — never leave a stale status.",
    promptSnippet: "Track tasks with live status",
    promptGuidelines: [
      "Use the task tool for multi-step work: create one task per step and mark the current one in_progress BEFORE starting it.",
      "Update status immediately in the same step as the work (done → completed); never leave a stale status.",
      "Never mark a task completed while its tests fail — keep it in_progress and add a blocker task.",
    ],
    parameters: TASK_PARAMETERS,
    renderShell: "self",
    renderCall: () => hiddenRenderer,
    renderResult: () => hiddenRenderer,
    async execute(_toolCallId, params) {
      const store = getStore();
      const { action, id, subject, description, status, activeForm, priority } = params as TaskParams;

      switch (action) {
        case "create": {
          if (!subject) {
            throw new Error("task create requires a `subject`");
          }
          const task = store.create({ subject, description, status, activeForm, priority });
          return ok(`Created ${formatTask(task)}`, { action, task });
        }
        case "update": {
          if (id === undefined) {
            throw new Error("task update requires an `id`");
          }
          const task = store.update(id, { subject, description, status, activeForm, priority });
          if (!task) {
            throw new Error(`task #${id} not found`);
          }
          return ok(`Updated ${formatTask(task)}`, { action, task });
        }
        case "get": {
          const task = id === undefined ? null : store.get(id);
          return ok(task ? formatTask(task) : `task #${id} not found`, { action, task });
        }
        case "delete": {
          if (id === undefined) {
            throw new Error("task delete requires an `id`");
          }
          const removed = store.remove(id);
          return ok(removed ? `Deleted task #${id}` : `task #${id} not found`, { action, removed });
        }
        case "clear": {
          store.clear();
          return ok("Cleared all tasks", { action, cleared: true });
        }
        case "list":
        default: {
          const tasks = store.list(status);
          const counts = store.counts();
          const text = tasks.length > 0
            ? `${counts.completed}/${counts.total} done · ${counts.in_progress} active · ${counts.blocked} blocked\n${tasks.map(formatTask).join("\n")}`
            : "No tasks.";
          return ok(text, { action, tasks, counts });
        }
      }
    },
  });
}
