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
import { checkExtensions, installSelectedExtensions } from "./extension-check.js";
import { applyExtensionSelection } from "./extension-selection.js";
import { extensionQuestions, installedCatalogNames } from "./questions.js";
import { runQuestionnaire } from "../tasks/ask-tool.js";

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
    "Онбординг pi-mini-boss — ТРИ окна подряд. Вопросы строит сам модуль, ты только вызываешь `ask` с пресетом: ничего не сочиняй, не исследуй ФС, не ищи и не загружай скиллы. Описание возможностей модуль уже вывел в чат сам — не пересказывай его.",
    "",
    'Окно 1 — ЯЗЫК: `ask preset="language"` (locale="ru"). Подтверди на «Итоге». Запомни язык как LANG.',
    'Окно 2 — РОЛЬ и НАЗНАЧЕНИЕ: `ask preset="role" locale=LANG`. Подтверди на «Итоге».',
    'Окно 3 — РАСШИРЕНИЯ (вкладки по категориям): `ask preset="extensions" locale=LANG`. Подтверди на «Итоге».',
    "",
    `Уже установлены из каталога: ${installed.join(", ") || "нет"}.`,
    "Окно 4 — СВЕРКА (ТОЛЬКО если есть расширения, которые УЖЕ установлены, но НЕ отмечены в окне 3).",
    "Строки для панели возьми по выбранному языку LANG:",
    '  ru: {question:"Эти расширения уже установлены, но не выбраны: <список>. Удалить их?", header:"Удалить", options:[{label:"оставить", description:"ничего не удалять"}, {label:"удалить", description:"снять невыбранные установленные"}]}',
    '  en: {question:"These extensions are installed but not selected: <list>. Remove them?", header:"Remove", options:[{label:"keep", description:"remove nothing"}, {label:"remove", description:"uninstall the unselected ones"}]}',
    "Если выбрано «удалить» / «remove» — выполни `pi remove npm:<name>` по каждому. Если таких нет — окно 4 не открывай.",
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
 * Short tour of what pi-mini-boss already does. Posted to the transcript by the
 * extension itself (exact text, no model round-trip), before onboarding and
 * once more after it finishes so nobody misses it.
 */
const TOUR = {
  ru: {
    title: "pi-mini-boss — что уже работает",
    body: [
      "- **Память между сессиями** — `memory_add` / `memory_search`: факты, решения и ошибки сохраняются и находятся позже; прошлые сессии индексируются и ищутся. Личные правила «навсегда» — `/memory-pin` (STANDING.md).",
      "- **Задачи и веб-доска** — инструмент `task` со статусами (pending → in_progress → completed / blocked) и доска в браузере: `/dashboard` поднимает локальный сервер и показывает прогресс в реальном времени.",
      "- **Панель вопросов** — инструмент `ask`: оверлей с вкладками, мультивыбором и живым переключением языка (это то, что откроется сейчас).",
      "- **Роли и назначения** — профиль агента: поведение и язык, при желании — модель, уровень thinking и набор активных инструментов.",
      "- **Процесс работы** — скилл `workflow`: план → работа → проверка → закрытие; статус задачи обновляется в том же шаге.",
      "- **Команды** — `/onboard` (настройка), `/extensions` (добавить или отключить расширения), `/clear` (очистить окно).",
      "",
      "_Дальше — три окна настройки: язык → роль → расширения._",
    ].join("\n"),
  },
  en: {
    title: "pi-mini-boss — what already works",
    body: [
      "- **Memory across sessions** — `memory_add` / `memory_search`: facts, decisions and failures are saved and found later; past sessions are indexed and searchable. Permanent personal rules — `/memory-pin` (STANDING.md).",
      "- **Tasks and a web board** — the `task` tool with statuses (pending → in_progress → completed / blocked) and a browser board: `/dashboard` starts a local server and shows progress in real time.",
      "- **Question panel** — the `ask` tool: an overlay with tabs, multi-select and live language switching (this is what opens next).",
      "- **Roles and purposes** — an agent profile: behaviour and language, optionally the model, thinking level and active tool set.",
      "- **Working process** — the `workflow` skill: plan → do → verify → close; task status updates in the same step.",
      "- **Commands** — `/onboard` (this setup), `/extensions` (add or switch off extensions), `/clear` (clear the window).",
      "",
      "_Next: three windows of setup — language → role → extensions._",
    ].join("\n"),
  },
} as const;

/** The tour in the configured language, optionally under a different heading. */
function tourText(language: string, title?: string): string {
  const entry = language === "en" ? TOUR.en : TOUR.ru;
  return `**${title ?? entry.title}**\n\n${entry.body}`;
}

/** The language currently saved in the user config. */
function configLanguage(): string {
  return loadAgentConfig().role.language === "en" ? "en" : "ru";
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
  // Set when /onboard starts so the tour is repeated once that run settles —
  // whoever missed it at the top gets it too.
  let recapPending = false;

  pi.on("agent_end", async () => {
    if (!recapPending) {
      return;
    }
    recapPending = false;
    const language = configLanguage();
    // agent_end fires while the session still streams; without an explicit
    // triggerTurn:false Pi steers the message into the agent, which then
    // restarts the onboarding windows. This message is informational only.
    await pi.sendMessage(
      {
        customType: "pi-mini-boss:tour",
        content: tourText(
          language,
          language === "en" ? "Reminder: what already works" : "Напоминание: что уже работает",
        ),
        display: true,
      },
      { triggerTurn: false },
    );
  });

  pi.on("session_start", async (_event, ctx) => {
    await applyRoleProfile(pi, ctx);
    const english = configLanguage() === "en";
    if (needsOnboarding()) {
      ctx.ui.notify(
        english
          ? "pi-mini-boss: config not set up — run /onboard"
          : "pi-mini-boss: конфиг не настроен — запусти /onboard",
        "info",
      );
    }
    const { missingRequired } = checkExtensions(loadAgentConfig());
    if (missingRequired.length > 0) {
      ctx.ui.notify(
        english
          ? `pi-mini-boss: missing required extensions: ${missingRequired.join(", ")}`
          : `pi-mini-boss: нет обязательных расширений: ${missingRequired.join(", ")}`,
        "warning",
      );
    }
    // Only once onboarding happened: before that the config is the package
    // template and its defaults are not the user's choice.
    if (!needsOnboarding()) {
      const added = installSelectedExtensions(loadAgentConfig());
      if (added.length > 0) {
        ctx.ui.notify(
          english
            ? `pi-mini-boss: declared ${added.length} extension(s) in settings.json — restart Pi (or run \`pi update --extensions\`)`
            : `pi-mini-boss: добавил расширений в settings.json: ${added.length} — перезапусти Pi (или \`pi update --extensions\`)`,
          "info",
        );
      }
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
      // The feature tour goes to the transcript first; the onboarding prompt is a
      // hidden custom message, so the long instructions never show up there.
      recapPending = true;
      await pi.sendMessage(
        { customType: "pi-mini-boss:tour", content: tourText(configLanguage()), display: true },
        { triggerTurn: false },
      );
      // Hidden custom message: the model gets the instructions and a turn starts,
      // but the long prompt never appears in the transcript.
      await pi.sendMessage(
        { customType: "pi-mini-boss:onboard", content: buildOnboardPrompt(), display: false },
        { triggerTurn: true },
      );
    },
  });

  pi.registerCommand("extensions", {
    description: "Выбрать расширения: поставить новые, отключить снятые",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }
      await ctx.waitForIdle();
      const english = configLanguage() === "en";
      // The panel is opened by the extension itself: the answer is applied here,
      // so no model turn can get it wrong.
      const result = await runQuestionnaire(ctx.ui, extensionQuestions(), configLanguage());
      if (!result || result.cancelled) {
        return;
      }
      const { selected, added, removed } = applyExtensionSelection(
        result.answers.flatMap((answer) => answer.labels),
      );
      ctx.ui.notify(
        english
          ? `pi-mini-boss: ${selected.length} selected, ${added.length} added, ${removed.length} switched off — restart Pi (or run \`pi update --extensions\`)`
          : `pi-mini-boss: выбрано ${selected.length} · добавил ${added.length} · снял ${removed.length} — перезапусти Pi (или \`pi update --extensions\`)`,
        "info",
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
