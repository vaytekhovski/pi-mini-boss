/**
 * pi-mini-boss bootstrap — brings the config to life:
 *   • nudges on session start when the config is missing or extensions are absent;
 *   • injects role + base_behavior + workflow into every system prompt;
 *   • exposes /onboard to (re)configure.
 */
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_CONFIG_PATH,
  PACKAGE_ROOT,
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
/** Skills implemented in a `skills/<kind>/` directory; stubs carry `disable-model-invocation: true`. */
function listImplemented(kind: string): Array<{ slug: string; description: string }> {
  const dir = path.join(PACKAGE_ROOT, "skills", kind);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const items: Array<{ slug: string; description: string }> = [];
  for (const slug of fs.readdirSync(dir)) {
    const file = path.join(dir, slug, "SKILL.md");
    if (!fs.existsSync(file)) {
      continue;
    }
    const text = fs.readFileSync(file, "utf8");
    if (/^disable-model-invocation:\s*true\s*$/m.test(text)) {
      continue;
    }
    const description = /^description:\s*"?([^"\n]+?)"?\s*$/m.exec(text)?.[1]?.trim() ?? slug;
    items.push({ slug, description });
  }
  return items.sort((a, b) => a.slug.localeCompare(b.slug));
}

function buildOnboardPrompt(): string {
  const roles = listImplemented("roles");
  const purposes = listImplemented("purposes");
  const extensions = loadAgentConfig().recommended_extensions ?? [];
  const roleOptions =
    roles.length > 0 ? roles : [{ slug: "senior backend developer", description: "бэкенд, API, сервисы" }];
  const purposeOptions =
    purposes.length > 0 ? purposes : [{ slug: "веб-приложение / SaaS", description: "продукт для пользователей" }];
  const extensionLines =
    extensions.length > 0
      ? extensions.map((ext, index) => {
          const selected = ext.selected === false ? "" : ", selected:true";
          const tail = index === extensions.length - 1 ? " ]} ]" : ",";
          return `    {label:"${ext.name}", description:"${ext.why}"${selected}}${tail}`;
        })
      : ['    {label:"ponytail", description:"лаконичный режим", selected:true} ]} ]'];
  return [
    "Онбординг pi-mini-boss. Он идёт ТРЕМЯ отдельными окнами: окно закрывается — сразу открывается следующее.",
    "ВАЖНО: не исследуй файловую систему, не запускай команды, не ищи и не загружай скиллы — никаких ls/pwd/grep/skill_manage.",
    "",
    'Окно 1 — ЯЗЫК. Одним вызовом `ask` (locale="ru"), вопрос с флагом uiLanguage:true — панель переключит язык сама:',
    'ask locale="ru" questions=[',
    '  {question:{ru:"Язык общения?", en:"Language?"}, header:{ru:"Язык", en:"Language"}, uiLanguage:true, options:[',
    '    {label:"ru", description:{ru:"русский", en:"Russian"}, selected:true},',
    '    {label:"en", description:{ru:"английский", en:"English"} } ]} ]',
    "Подтверди на вкладке «Итог» (Enter). Запомни выбранный язык как LANG.",
    "",
    "Окно 2 — РОЛЬ и НАЗНАЧЕНИЕ. Второй вызов `ask` с locale=LANG:",
    "ask locale=LANG questions=[",
    '  {question:"Кто ты?", header:"Роль", options:[',
    ...roleOptions.map(
      (role, index) =>
        `    {label:"${role.slug}", description:"${role.description}"${index === 0 ? ", selected:true" : ""}}${index === roleOptions.length - 1 ? " ]}," : ","}`,
    ),
    '  {question:"Над чем ты работаешь?", header:"Назначение", options:[',
    ...purposeOptions.map(
      (purpose, index) =>
        `    {label:"${purpose.slug}", description:"${purpose.description}"${index === 0 ? ", selected:true" : ""}}${index === purposeOptions.length - 1 ? " ]} ]" : ","}`,
    ),
    "Подтверди на «Итоге».",
    "",
    "Окно 3 — РАСШИРЕНИЯ. Третий вызов `ask` с locale=LANG:",
    "ask locale=LANG questions=[",
    '  {question:"Какие расширения установить?", header:"Расширения", multiSelect:true, options:[',
    ...extensionLines,
    "Подтверди на «Итоге».",
    "",
    "Если пользователь ОТМЕНИЛ любое окно (Esc) — НЕ задавай вопросы в чате. Напиши коротко: онбординг можно запустить позже командой /onboard. Больше ничего не делай.",
    "",
    `Шаг 4. Прочитай шаблон ${DEFAULT_CONFIG_PATH} (это файл по абсолютному пути — не ищи его) и запиши ${USER_CONFIG_PATH}:`,
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
