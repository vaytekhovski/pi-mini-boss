/**
 * pi-mini-boss bootstrap — brings the config to life:
 *   • nudges on session start when the config is missing or extensions are absent;
 *   • injects role + base_behavior + workflow into every system prompt;
 *   • exposes /onboard to (re)configure.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadAgentConfig, needsOnboarding, type AgentConfig } from "./config.js";
import { checkExtensions } from "./extension-check.js";

/** Render the role + core rules + workflow as a system-prompt section. */
function buildSystemPromptBlock(config: AgentConfig): string {
  const lines: string[] = ["# pi-mini-boss"];
  const { name, purpose, language } = config.role ?? ({} as AgentConfig["role"]);
  lines.push(`Роль: ${name ?? "—"} — ${purpose ?? "—"} (язык общения: ${language ?? "ru"}).`);
  if (config.base_behavior?.length) {
    lines.push("Базовые правила:");
    for (const rule of config.base_behavior) {
      lines.push(`- ${rule}`);
    }
  }
  if (config.workflow?.length) {
    lines.push(`Ведение задачи: ${config.workflow.join(" → ")}.`);
  }
  return lines.join("\n");
}

const ONBOARD_PROMPT =
  "Выполни онбординг pi-mini-boss по скиллу bootstrap: прочитай config/agent.yaml (ядро), " +
  "задай пользователю вопросы одним вызовом ask_user_question (роль, назначение, язык, какие " +
  "recommended_extensions ставить), затем запиши ~/.pi/agent/pi-mini-boss/agent.yaml с ответами " +
  "и onboarded: true, сверь required_extensions и коротко подтверди конфигурацию.";

/** Register the bootstrap lifecycle hooks and the /onboard command. */
export function registerBootstrap(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    if (needsOnboarding()) {
      ctx.ui.notify("pi-mini-boss: конфиг не настроен — запусти /onboard", "info");
    }
    const { missingRequired } = checkExtensions(loadAgentConfig());
    if (missingRequired.length > 0) {
      ctx.ui.notify(`pi-mini-boss: нет обязательных расширений: ${missingRequired.join(", ")}`, "warning");
    }
  });

  pi.on("before_agent_start", async (event) => {
    const block = buildSystemPromptBlock(loadAgentConfig());
    const promptOptions = event.systemPromptOptions;
    if (promptOptions && "sections" in promptOptions) {
      promptOptions.appendSystemPrompt = [promptOptions.appendSystemPrompt, block]
        .filter(Boolean)
        .join("\n\n");
      return;
    }
    return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
  });

  pi.registerCommand("onboard", {
    description: "Настроить pi-mini-boss: роль, назначение, язык, расширения",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();
      pi.sendUserMessage(ONBOARD_PROMPT);
    },
  });
}
