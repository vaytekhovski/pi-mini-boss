/**
 * pi-mini-boss `task` tool — the agent's interface to the shared task store.
 *
 * Replaces the in-session todo tool: state is persisted in SQLite and visible to
 * the native TUI panel and the web dashboard at the same time.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import { detectProject } from "../project.js";
import { TASK_STATUSES, type Project, type Task, type TaskCounts, type TaskStore } from "./store.js";

const TASK_TOOL_NAME = "task";

/** Project name used for tasks created outside any detected project. */
const INBOX_PROJECT = "inbox";

const STATUS_VALUES = TASK_STATUSES as readonly [
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
const PRIORITY_VALUES = ["low", "normal", "high", "urgent"] as const;

const TASK_PARAMETERS = Type.Object({
  action: StringEnum(["create", "update", "list", "get", "delete", "clear", "projects"] as const),
  id: Type.Optional(Type.Number({ description: "Task id (update/get/delete)" })),
  subject: Type.Optional(Type.String({ description: "Short imperative subject (create/update)" })),
  description: Type.Optional(Type.String({ description: "Long-form detail (create/update)" })),
  status: Type.Optional(StringEnum(STATUS_VALUES)),
  activeForm: Type.Optional(
    Type.String({ description: "Present-continuous label while a stage is active" }),
  ),
  priority: Type.Optional(StringEnum(PRIORITY_VALUES)),
  project: Type.Optional(Type.String({ description: "Project name (create/update/list)" })),
});

interface TaskParams {
  action: "create" | "update" | "list" | "get" | "delete" | "clear" | "projects";
  id?: number;
  subject?: string;
  description?: string;
  status?: (typeof STATUS_VALUES)[number];
  activeForm?: string;
  priority?: (typeof PRIORITY_VALUES)[number];
  project?: string;
}

const ACTIVE_GLYPH = "◐";

function formatTask(task: Task, projectName?: string | null): string {
  const glyph =
    task.status === "completed"
      ? "✓"
      : task.status === "blocked"
        ? "⊘"
        : task.status === "pending"
          ? "○"
          : ACTIVE_GLYPH;
  const extra =
    task.status !== "pending" &&
    task.status !== "completed" &&
    task.status !== "blocked" &&
    task.status !== "deleted" &&
    task.activeForm
      ? ` (${task.activeForm})`
      : "";
  const project = projectName ? ` (project: ${projectName})` : "";
  return `#${task.id} ${glyph} ${task.subject} [${task.status}/${task.priority}]${extra}${project}`;
}

interface TaskDetails {
  action: TaskParams["action"];
  task?: Task | null;
  tasks?: Task[];
  counts?: TaskCounts;
  projects?: Project[];
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
export function registerTaskTool(
  pi: ExtensionAPI,
  getStore: () => TaskStore,
  projectsMemoryDir?: string,
): void {
  // The current project is resolved once per cwd; legacy tasks are backfilled
  // to the first resolved project exactly once per process.
  const projectByCwd = new Map<string, Project>();
  let legacyTasksAssigned = false;
  const resolveProject = (cwd?: string): Project | null => {
    if (!cwd) return null;
    const cached = projectByCwd.get(cwd);
    if (cached) return cached;
    const name = detectProject(projectsMemoryDir, cwd).name ?? INBOX_PROJECT;
    const project = getStore().ensureProject(name, cwd);
    projectByCwd.set(cwd, project);
    if (!legacyTasksAssigned) {
      getStore().assignLegacyTasks(project.id);
      legacyTasksAssigned = true;
    }
    return project;
  };

  pi.registerTool({
    name: TASK_TOOL_NAME,
    label: "Tasks",
    description:
      "Manage the shared pi-mini-boss task list. Actions: create, update, list, get, delete, clear. Status pipeline: pending → analysis → planning → development → review → testing → report → completed, plus blocked and deleted. Update a task's status in the SAME step as the work — never leave a stale status.",
    promptSnippet: "Track tasks with live status",
    promptGuidelines: [
      "Use the task tool for multi-step work: create one task per step and mark the current one in the active pipeline stage (analysis/planning/development/review/testing/report) BEFORE starting it.",
      "Update status immediately in the same step as the work (done → completed); never leave a stale status.",
      "Never mark a task completed while its tests fail — keep it in its active stage and add a blocker task.",
    ],
    parameters: TASK_PARAMETERS,
    renderShell: "self",
    renderCall: () => hiddenRenderer,
    renderResult: () => hiddenRenderer,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx?: { cwd?: string }) {
      const store = getStore();
      const { action, id, subject, description, status, activeForm, priority, project } =
        params as TaskParams;

      switch (action) {
        case "create": {
          if (!subject) {
            throw new Error("task create requires a `subject`");
          }
          const projectName = project === undefined ? undefined : project.trim();
          if (project !== undefined && !projectName) {
            throw new Error("project name must not be empty");
          }
          // Without an explicit project, bind to the session project; with no
          // cwd at all, fall back to inbox so the task is never left unbound
          // (only true legacy rows carry a NULL project_id).
          const projectId = projectName
            ? store.ensureProject(projectName).id
            : (resolveProject(ctx?.cwd) ?? store.ensureProject(INBOX_PROJECT)).id;
          const task = store.create({ subject, description, status, activeForm, priority, projectId });
          return ok(`Created ${formatTask(task)}`, { action, task });
        }
        case "update": {
          if (id === undefined) {
            throw new Error("task update requires an `id`");
          }
          const projectName = project === undefined ? undefined : project.trim();
          if (project !== undefined && !projectName) {
            throw new Error("project name must not be empty");
          }
          const projectId = projectName ? store.ensureProject(projectName).id : undefined;
          const task = store.update(id, { subject, description, status, activeForm, priority, projectId });
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
        case "projects": {
          const current = resolveProject(ctx?.cwd);
          const projects = store.listProjects();
          const text = projects.length > 0
            ? projects
                .map((p) => {
                  const marker = current && p.id === current.id ? " (current)" : "";
                  return `#${p.id} ${p.name}${marker} — ${store.counts(p.id).total} task(s)`;
                })
                .join("\n")
            : "No projects.";
          return ok(text, { action, projects });
        }
        case "list":
        default: {
          const nameById = new Map(store.listProjects().map((p) => [p.id, p.name]));
          const wanted = project?.trim();
          const target = wanted ? store.listProjects().find((p) => p.name === wanted) : undefined;
          if (wanted && !target) {
            return ok(`Project not found: ${wanted}`, { action, tasks: [] });
          }
          const tasks = store.list(status, target?.id);
          const counts = store.counts(target?.id);
          const active =
            counts.analysis +
            counts.planning +
            counts.development +
            counts.review +
            counts.testing +
            counts.report;
          const text = tasks.length > 0
            ? `${counts.completed}/${counts.total} done · ${active} active · ${counts.blocked} blocked\n${tasks.map((task) => formatTask(task, task.projectId != null ? nameById.get(task.projectId) : null)).join("\n")}`
            : "No tasks.";
          return ok(text, { action, tasks, counts });
        }
      }
    },
  });
}
