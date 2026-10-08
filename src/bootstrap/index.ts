/**
 * pi-mini-boss bootstrap — brings the config to life:
 *   • nudges on session start when the config is missing or extensions are absent;
 *   • injects role + base_behavior + workflow into every system prompt;
 *   • exposes /onboard to (re)configure.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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
    "ВАЖНО: не исследуй файловую систему, не запускай команды, не ищи и не загружай скиллы — никаких ls/pwd/grep/skill_manage.",
    "",
    "Шаг 1. Одним вызовом tool `ask` задай все 4 вопроса (параметр `questions` — массив; в панели они станут вкладками, ←/→ переключение). Никаких отдельных вызовов:",
    'ask questions=[',
    '  {question:"Кто ты?", header:"Роль", options:[',
    '    {label:"senior backend developer", description:"бэкенд, API, сервисы", selected:true},',
    '    {label:"frontend developer", description:"интерфейсы, вёрстка, UX"},',
    '    {label:"fullstack developer", description:"и бэкенд, и фронтенд"},',
    '    {label:"mobile developer", description:"iOS / Android / кроссплатформа"},',
    '    {label:"DevOps / SRE engineer", description:"CI/CD, инфраструктура, надёжность"},',
    '    {label:"data / ML engineer", description:"пайплайны, модели, аналитика"},',
    '    {label:"QA / test automation engineer", description:"тесты, качество, автотесты"},',
    '    {label:"architect / tech lead", description:"архитектура, ревью, решения"} ]},',
    '  {question:"Над чем ты работаешь?", header:"Назначение", options:[',
    '    {label:"веб-приложение / SaaS", description:"продукт для пользователей", selected:true},',
    '    {label:"бэкенд, API и сервисы", description:"серверная логика и интеграции"},',
    '    {label:"мобильное приложение", description:"iOS / Android"},',
    '    {label:"данные, аналитика и ML", description:"пайплайны, отчёты, модели"},',
    '    {label:"маркетплейс / e-commerce", description:"продавцы, товары, заказы"},',
    '    {label:"финтех / платежи", description:"деньги, транзакции, интеграции"},',
    '    {label:"игры / графика / медиа", description:"рендер, звук, контент"},',
    '    {label:"библиотека / SDK / опенсорс", description:"публичный код и API"} ]},',
    '  {question:"Язык общения?", header:"Язык", options:[',
    '    {label:"ru", description:"русский", selected:true},',
    '    {label:"en", description:"English"} ]},',
    '  {question:"Какие расширения установить?", header:"Расширения", multiSelect:true, options:[',
    '    {label:"pi-subagents", description:"делегирование и субагенты", selected:true},',
    '    {label:"ponytail", description:"лаконичный режим, меньше токенов", selected:true},',
    '    {label:"pi-web-access", description:"доступ в интернет", selected:true},',
    '    {label:"billion-context-pi", description:"сжатие контекста, длинные сессии", selected:true} ]} ]',
    "",
    "Если пользователь ОТМЕНИЛ вопросы (Esc) — НЕ задавай их в чате. Напиши одну короткую дружелюбную фразу: онбординг можно запустить позже командой /onboard, а настроенный агент понимает контекст проекта и работает точнее. Больше ничего не делай.",
    "",
    `Шаг 2. Прочитай шаблон ${DEFAULT_CONFIG_PATH} (это файл по абсолютному пути — не ищи его) и запиши ${USER_CONFIG_PATH}:`,
    "   - role.name / role.purpose / role.language ← из ответов;",
    "   - base_behavior / workflow / thinking / required_extensions ← как в шаблоне;",
    '   - recommended_extensions ← отмеченные в ответе 4 (label → name, description → why);',
    "   - добавь onboarded: true.",
    "",
    "Шаг 3. Ответь одной короткой строкой, как настроен агент. Больше ничего не делай.",
  ].join("\n");
}

/**
 * Apply the role profile at session start: the configured model, thinking level,
 * and active-tool allowlist. Any field left out is not touched.
 */
async function applyRoleProfile(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
  const role = loadAgentConfig().role;
  if (!role) {
    return;
  }
  if (role.thinking) {
    try {
      pi.setThinkingLevel(role.thinking as never);
    } catch {
      // A bad level in the config must not break the session.
    }
  }
  if (role.model && ctx.modelRegistry) {
    const [provider, ...rest] = role.model.split("/");
    const model = ctx.modelRegistry.find(provider, rest.join("/"));
    if (model) {
      await pi.setModel(model);
    }
  }
  if (role.tools && role.tools.length > 0) {
    pi.setActiveTools(role.tools);
  }
}

/** Register the bootstrap lifecycle hooks and the /onboard command. */
export function registerBootstrap(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    await applyRoleProfile(pi, ctx);
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
      // Hidden custom message: the model gets the instructions and a turn starts,
      // but the long prompt never appears in the transcript.
      await pi.sendMessage(
        { customType: "pi-mini-boss:onboard", content: buildOnboardPrompt(), display: false },
        { triggerTurn: true },
      );
    },
  });

  pi.registerCommand("clear", {
    description: "Очистить окно вывода",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }
      await ctx.ui.custom<void>((tui, _theme, _kb, done) => {
        done(undefined);
        // clearScreen writes ANSI directly, so the renderer's cursor state goes
        // stale — force a full repaint right after, or Pi is left on a black screen.
        // `renderNow` exists only in newer pi-tui; requestRender(true) covers the
        // 0.80 typed surface the package builds against.
        tui.terminal.clearScreen();
        (tui as unknown as { renderNow?: (force?: boolean) => void }).renderNow?.(true);
        tui.requestRender(true);
        return { render: (): string[] => [], invalidate: (): void => {} };
      });
    },
  });
}
