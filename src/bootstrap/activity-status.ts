/**
 * pi-mini-boss activity widget.
 *
 * Renders what the agent is doing right now as persistent content near the
 * editor (above the todo dock), updated from lifecycle events. Also loadable
 * standalone for a quick check: `pi -e ./src/bootstrap/activity-status.ts`.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const WIDGET_ID = "pi-mini-boss:activity";

/** Best-effort one-line description of a tool call for the activity line. */
function describeTool(toolName: string, input: Record<string, unknown>): string {
  const pick = (...keys: string[]): string => {
    for (const key of keys) {
      const value = input[key];
      if (typeof value === "string" && value.length > 0) {
        return value.length > 100 ? `${value.slice(0, 100)}…` : value;
      }
    }
    return "";
  };

  switch (toolName) {
    case "bash":
      return `$ ${pick("command")}`;
    case "read":
      return `📖 ${pick("path", "file_path")}`;
    case "edit":
      return `✏️  ${pick("path", "file_path")}`;
    case "write":
      return `📝 ${pick("path", "file_path")}`;
    case "grep":
    case "rg":
      return `🔍 ${pick("pattern")}`;
    default:
      return toolName;
  }
}

function render(ctx: ExtensionContext, text: string): void {
  if (!ctx.hasUI) {
    return;
  }
  ctx.ui.setWidget(WIDGET_ID, [text], { placement: "belowEditor" });
}

/**
 * Register the activity widget on an extension instance. Call from the
 * pi-mini-boss extension factory.
 */
export function registerActivityStatus(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => render(ctx, "🤖 pi-mini-boss · ожидание"));
  pi.on("agent_start", (_event, ctx) => render(ctx, "🍳 pi-mini-boss · работаю…"));
  pi.on("tool_call", (event, ctx) => {
    const input = (event.input ?? {}) as Record<string, unknown>;
    render(ctx, `⚙️  pi-mini-boss · ${describeTool(event.toolName, input)}`);
  });
  pi.on("agent_end", (_event, ctx) => render(ctx, "✅ pi-mini-boss · готово"));
  pi.on("session_shutdown", (_event, ctx) => render(ctx, "🤖 pi-mini-boss"));
}

export default registerActivityStatus;
