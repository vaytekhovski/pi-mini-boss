/**
 * pi-mini-boss bootstrap — brings the config to life:
 *   • nudges on session start when the config is missing or extensions are absent;
 *   • injects role + base_behavior + workflow into every system prompt;
 *   • exposes /onboard to (re)configure.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_CONFIG_PATH,
  USER_CONFIG_PATH,
  loadAgentConfig,
  needsOnboarding,
  type AgentConfig,
} from "./config.js";
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

/**
 * Self-contained onboarding prompt. It spells out the questions and gives the
 * agent absolute paths, so it never has to explore the filesystem or look up a
 * skill (that exploration was the old noisy behaviour).
 */
function buildOnboardPrompt(): string {
  return [
    "Онбординг pi-mini-boss.",
    "ВАЖНО: не исследуй файловую систему, не запускай команды, не ищи и не загружай скиллы — никаких ls/pwd/grep. Сразу вопросы, затем один read и один write.",
    "",
    "Шаг 1. Одним вызовом ask_user_question задай эти 4 вопроса:",
    '1) header "Роль", question "Кто ты?", single (2–4 опции):',
    '   - "senior backend developer (Recommended)" — бэкенд, API, сервисы',
    '   - "frontend developer" — интерфейсы, вёрстка, UX',
    '   - "fullstack developer" — и бэкенд, и фронтенд',
    '   - "testing / QA engineer" — тесты, качество, автоматизация',
    '2) header "Назначение", question "Над чем ты работаешь?", single:',
    '   - "веб-приложение / SaaS (Recommended)" — продукт для пользователей',
    '   - "бэкенд, API и сервисы" — серверная логика и интеграции',
    '   - "мобильное приложение" — iOS/Android/кроссплатформа',
    '   - "данные, аналитика, ML" — пайплайны, отчёты, модели',
    '3) header "Язык", question "Язык общения?", single:',
    '   - "ru (Recommended)" — русский',
    '   - "en" — English',
    '4) header "Расширения", question "Какие рекомендованные расширения НЕ устанавливать? (по умолчанию — оставляем все; отметь только лишние)", multiSelect: true:',
    '   - "pi-subagents" — делегирование и параллельные субагенты',
    '   - "ponytail" — лаконичный режим, меньше токенов',
    '   - "pi-web-access" — доступ в интернет',
    '   - "billion-context-pi" — сжатие контекста, длинные сессии',
    "",
    `Шаг 2. Прочитай шаблон ${DEFAULT_CONFIG_PATH} (это файл по абсолютному пути — не ищи его) и запиши ${USER_CONFIG_PATH}:`,
    "   - role.name / role.purpose / role.language ← из ответов;",
    "   - base_behavior / workflow / thinking / required_extensions ← как в шаблоне;",
    '   - recommended_extensions ← как в шаблоне, минус те, что отмечены «не ставить»;',
    "   - добавь onboarded: true.",
    "",
    "Шаг 3. Ответь одной короткой строкой, как настроен агент. Больше ничего не делай.",
  ].join("\n");
}

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
      pi.sendUserMessage(buildOnboardPrompt());
    },
  });
}
