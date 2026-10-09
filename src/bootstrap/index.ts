/**
 * pi-mini-boss bootstrap — brings the config to life:
 *   • nudges on session start when the config is missing or extensions are absent;
 *   • injects role + base_behavior + workflow into every system prompt;
 *   • exposes /onboard to (re)configure.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_CONFIG_PATH,
  PACKAGE_ROOT,
  USER_CONFIG_PATH,
  loadAgentConfig,
  needsOnboarding,
  saveAgentConfig,
  type AgentConfig,
  type AgentRole,
} from "./config.js";
import { checkExtensions, installSelectedExtensions } from "./extension-check.js";
import { applyExtensionSelection, syncDeclaredPackages } from "./extension-selection.js";
import { extensionQuestions, installedCatalogNames, languageQuestion, roleQuestions } from "./questions.js";
import { runQuestionnaire, type AskResult, type QuestionSpec } from "../tasks/ask-tool.js";

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
      "- **Задачи и веб-доска** — инструмент `task` со статусами пайплайна (pending → analysis → planning → development → review → testing → report → completed / blocked) и доска в браузере: `/dashboard` поднимает локальный сервер и показывает задачи и активность (чем занят агент и субагенты) в реальном времени.",
      "- **Панель вопросов** — инструмент `ask`: оверлей с вкладками, мультивыбором и живым переключением языка (это то, что откроется сейчас).",
      "- **Роли и назначения** — профиль агента: поведение и язык, при желании — модель, уровень thinking и набор активных инструментов.",
      "- **Процесс работы** — скилл `workflow`: анализ → планирование → разработка → ревью → тестирование → отчёт; каждый шаг делегируется субагентам (каталог `subagents`), статус обновляется в том же шаге.",
      "- **Команды** — `/onboard` (настройка), `/extensions` (добавить или отключить расширения), `/language` и `/profile` (сменить язык, роль, назначение), `/mini-boss` (текущая настройка), `/dashboard` (веб-доска задач), `/memory-pin` (правила навсегда).",
      "",
      "_Дальше — три окна настройки: язык → роль → расширения._",
    ].join("\n"),
  },
  en: {
    title: "pi-mini-boss — what already works",
    body: [
      "- **Memory across sessions** — `memory_add` / `memory_search`: facts, decisions and failures are saved and found later; past sessions are indexed and searchable. Permanent personal rules — `/memory-pin` (STANDING.md).",
      "- **Tasks and a web board** — the `task` tool with pipeline statuses (pending → analysis → planning → development → review → testing → report → completed / blocked) and a browser board: `/dashboard` starts a local server and shows tasks and activity (what the agent and subagents are doing) in real time.",
      "- **Question panel** — the `ask` tool: an overlay with tabs, multi-select and live language switching (this is what opens next).",
      "- **Roles and purposes** — an agent profile: behaviour and language, optionally the model, thinking level and active tool set.",
      "- **Working process** — the `workflow` skill: analysis → planning → development → review → testing → report; each step is delegated to subagents (the `subagents` catalog); status updates in the same step.",
      "- **Commands** — `/onboard` (setup), `/extensions` (add or switch off extensions), `/language` and `/profile` (change language, role, purpose), `/mini-boss` (current setup), `/dashboard` (task web board), `/memory-pin` (permanent rules).",
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

/** Role patch from the /language panel answers. */
export function languageFromAnswers(answers: AskResult["answers"]): Partial<AgentRole> {
  return { language: answers[0]?.labels[0] === "en" ? "en" : "ru" };
}

/**
 * Role patch from the /profile panel answers. The panel is built by
 * `roleQuestions()`, whose tabs are always role first, purpose second.
 */
export function profileFromAnswers(answers: AskResult["answers"]): Partial<AgentRole> {
  return {
    ...(answers[0]?.labels[0] ? { name: answers[0].labels[0] } : {}),
    ...(answers[1]?.labels[0] ? { purpose: answers[1].labels[0] } : {}),
  };
}

/** Version from the shipped package.json, or "?" when unreadable. */
function packageVersion(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as {
      version?: string;
    };
    return raw.version ?? "?";
  } catch {
    return "?";
  }
}

/** Human-readable summary of the package and the current agent config. */
export function buildInfoText(config: AgentConfig, version: string): string {
  const english = (config.role?.language ?? "ru") === "en";
  const chosen = (config.recommended_extensions ?? [])
    .filter((ext) => ext.selected !== false)
    .map((ext) => ext.name);
  const onboarded = config.onboarded === true;
  return [
    `**pi-mini-boss ${version}**`,
    "",
    `- ${english ? "Role" : "Роль"}: ${config.role?.name ?? "—"}`,
    `- ${english ? "Purpose" : "Назначение"}: ${config.role?.purpose ?? "—"}`,
    `- ${english ? "Language" : "Язык"}: ${config.role?.language ?? "ru"}`,
    `- ${english ? "Onboarding" : "Онбординг"}: ${
      onboarded
        ? english ? "done" : "пройден"
        : english ? "not done — run /onboard" : "не пройден — запусти /onboard"
    }`,
    `- ${english ? "Extensions" : "Расширения"}: ${chosen.length} ${english ? "selected" : "выбрано"}`,
    `  ${chosen.join(", ") || "—"}`,
    `- ${english ? "Config" : "Конфиг"}: ${USER_CONFIG_PATH}`,
    "",
    `${english ? "Commands" : "Команды"}: /onboard · /extensions · /language · /profile · /mini-boss · /dashboard · /memory-pin`,
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

/**
 * Open a panel and merge the resulting role patch into the user config. Used by
 * the /language and /profile commands, which change one part of the profile
 * without re-running the whole onboarding.
 */
async function pickAndSaveRole(
  ctx: ExtensionContext,
  questions: QuestionSpec[],
  apply: (answers: AskResult["answers"]) => Partial<AgentRole>,
): Promise<void> {
  const result = await runQuestionnaire(ctx.ui, questions, configLanguage(), undefined, ctx.cwd);
  if (!result || result.cancelled) {
    return;
  }
  const config = loadAgentConfig();
  const patch = apply(result.answers);
  saveAgentConfig({ ...config, role: { ...config.role, ...patch } });
  const english = (patch.language ?? config.role.language) === "en";
  ctx.ui.notify(english ? "pi-mini-boss: saved" : "pi-mini-boss: сохранено", "info");
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
    // Onboarding just wrote the config: declare what it chose and fetch it, so
    // the restart only has to load the packages. Skipped when onboarding was
    // cancelled — the template's defaults are not the user's choice.
    if (!needsOnboarding()) {
      const added = installSelectedExtensions(loadAgentConfig());
      if (added.length > 0) {
        await syncDeclaredPackages((command, args) => pi.exec(command, args));
      }
    }
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
      const result = await runQuestionnaire(ctx.ui, extensionQuestions(), configLanguage(), undefined, ctx.cwd);
      if (!result || result.cancelled) {
        return;
      }
      const { selected, added, removed } = applyExtensionSelection(
        result.answers.flatMap((answer) => answer.labels),
      );
      // Fetch what was just declared, instead of sending the user to a shell.
      const changed = added.length + removed.length > 0;
      const synced = changed && (await syncDeclaredPackages((command, args) => pi.exec(command, args)));
      const tail = english
        ? synced
          ? " — restart Pi to load them"
          : " — restart Pi (or run `pi update --extensions`)"
        : synced
          ? " — перезапусти Pi, чтобы загрузились"
          : " — перезапусти Pi (или `pi update --extensions`)";
      ctx.ui.notify(
        (english
          ? `pi-mini-boss: ${selected.length} selected, ${added.length} added, ${removed.length} switched off`
          : `pi-mini-boss: выбрано ${selected.length} · добавил ${added.length} · снял ${removed.length}`) +
          tail,
        "info",
      );
    },
  });

  pi.registerCommand("language", {
    description: "Сменить язык общения",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }
      await ctx.waitForIdle();
      await pickAndSaveRole(ctx, [languageQuestion()], languageFromAnswers);
    },
  });

  pi.registerCommand("profile", {
    description: "Сменить роль и назначение",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        return;
      }
      await ctx.waitForIdle();
      await pickAndSaveRole(ctx, roleQuestions(), profileFromAnswers);
    },
  });

  pi.registerCommand("mini-boss", {
    description: "Показать текущую настройку pi-mini-boss",
    handler: async () => {
      await pi.sendMessage(
        {
          customType: "pi-mini-boss:info",
          content: buildInfoText(loadAgentConfig(), packageVersion()),
          display: true,
        },
        { triggerTurn: false },
      );
    },
  });
}
