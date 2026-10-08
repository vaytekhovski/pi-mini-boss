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
import { installedCatalogNames } from "./questions.js";

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
  const installed = installedCatalogNames();
  return [
    "Онбординг pi-mini-boss — ТРИ окна подряд. Вопросы строит сам модуль, ты только вызываешь `ask` с пресетом: ничего не сочиняй, не исследуй ФС, не ищи и не загружай скиллы.",
    "",
    'Окно 1 — ЯЗЫК: `ask preset="language"` (locale="ru"). Подтверди на «Итоге». Запомни язык как LANG.',
    'Окно 2 — РОЛЬ и НАЗНАЧЕНИЕ: `ask preset="role" locale=LANG`. Подтверди на «Итоге».',
    'Окно 3 — РАСШИРЕНИЯ (вкладки по категориям): `ask preset="extensions" locale=LANG`. Подтверди на «Итоге».',
    "",
    `Уже установлены из каталога: ${installed.join(", ") || "нет"}.`,
    "Окно 4 — СВЕРКА (ТОЛЬКО если есть расширения, которые УЖЕ установлены, но НЕ отмечены в окне 3):",
    "ask locale=LANG questions=[",
    '  {question:"Эти расширения уже установлены, но не выбраны: <список>. Удалить их?", header:"Удалить", options:[',
    '    {label:"оставить", description:"ничего не удалять"},',
    '    {label:"удалить", description:"снять невыбранные установленные"} ]} ]',
    "Если выбрано «удалить» — выполни `pi remove npm:<name>` по каждому. Если таких нет — окно 4 не открывай.",
    "",
    "Если пользователь ОТМЕНИЛ любое окно (Esc) — НЕ задавай вопросы в чате. Напиши коротко: онбординг можно запустить позже командой /onboard. Больше ничего не делай.",
    "",
    `Шаг 4. Прочитай шаблон ${DEFAULT_CONFIG_PATH} (файл по абсолютному пути — не ищи) и запиши ${USER_CONFIG_PATH}:`,
    "   - role.name / role.purpose / role.language ← из окон 2 и 1 (language = LANG);",
    "   - base_behavior / workflow / thinking / required_extensions ← как в шаблоне;",
    "   - recommended_extensions ← отмеченные в окне 3 (label → name, description → why);",
    "   - добавь onboarded: true.",
    "",
    "Шаг 5. Ответь одной короткой строкой, как настроен агент. Больше ничего не делай.",
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
