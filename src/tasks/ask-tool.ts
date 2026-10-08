/**
 * pi-mini-boss `ask` tool — asks the user through a centered overlay panel.
 *
 * One call can carry several questions, shown as tabs. Arrow keys move between
 * questions; 1-9 / Enter choose. Ctrl+H toggles the panel (a global shortcut, so
 * it also works while hidden).
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const ASK_TOOL_NAME = "ask";
/** Toggle the panel so the transcript can be seen/scrolled. */
const HIDE_KEY = Key.ctrl("h");

/** Text that is either plain or per-locale, e.g. { ru: "...", en: "..." }. */
const LocalizedSchema = Type.Union([Type.String(), Type.Record(Type.String(), Type.String())]);

const OptionSchema = Type.Object({
  label: LocalizedSchema,
  description: Type.Optional(LocalizedSchema),
  selected: Type.Optional(Type.Boolean({ description: "Pre-select this option" })),
  installed: Type.Optional(Type.Boolean({ description: "Already installed" })),
});

const ASK_PARAMETERS = Type.Object({
  locale: Type.Optional(Type.String({ description: "UI language of the panel: ru | en" })),
  preset: Type.Optional(
    Type.String({ description: "Built-in question preset: language | role | extensions" }),
  ),
  questions: Type.Optional(
    Type.Array(
      Type.Object({
        question: LocalizedSchema,
        header: Type.Optional(LocalizedSchema),
        multiSelect: Type.Optional(Type.Boolean({ description: "Allow several choices" })),
        uiLanguage: Type.Optional(
          Type.Boolean({ description: "This question switches the panel language live" }),
        ),
        options: Type.Array(OptionSchema, { minItems: 2, maxItems: 12 }),
      }),
      { minItems: 1, maxItems: 8, description: "One or more questions" },
    ),
  ),
});

type Localized = string | Record<string, string>;
interface OptionSpec {
  label: Localized;
  description?: Localized;
  selected?: boolean;
  installed?: boolean;
}
interface QuestionSpec {
  question: Localized;
  header?: Localized;
  multiSelect?: boolean;
  uiLanguage?: boolean;
  options: OptionSpec[];
}
interface AskParams {
  locale?: string;
  preset?: string;
  questions?: QuestionSpec[];
}

/** UI strings per locale; the panel switches live on the uiLanguage question. */
const STRINGS: Record<string, Record<string, string>> = {
  ru: {
    summary: "Итог",
    review: "Проверь выбор:",
    none: "(не выбрано)",
    question: "Вопрос",
    confirm: "Enter — подтвердить",
    change: "←/→ — изменить",
    choose: "1-9/Enter — выбрать",
    nav: "←→/↑↓ — навигация",
    hide: "скрыть",
    show: "показать",
  },
  en: {
    summary: "Summary",
    review: "Review your choice:",
    none: "(none)",
    question: "Question",
    confirm: "Enter — confirm",
    change: "←/→ — change",
    choose: "1-9/Enter — choose",
    nav: "←→/↑↓ — navigate",
    hide: "hide",
    show: "show",
  },
};
interface AskResult {
  answers: Array<{ header: string; labels: string[] }>;
  cancelled: boolean;
}

/** The narrow surface of the overlay handle we need. */
type HideHandle = { setHidden(hidden: boolean): void };

// ── Overlay visibility (module scope so the global shortcut can reach it) ──
let activeOverlay: { setHidden(hidden: boolean): void; refresh(): void } | undefined;
let overlayHidden = false;
/** Called when the panel is hidden, so the chat can explain how to bring it back. */
let onHidden: (() => void) | undefined;

function toggleOverlayVisibility(): void {
  if (!activeOverlay) {
    return;
  }
  overlayHidden = !overlayHidden;
  activeOverlay.setHidden(overlayHidden);
  activeOverlay.refresh();
  if (overlayHidden) {
    onHidden?.();
  }
}

function createQuestionnaire(
  tui: any,
  theme: any,
  done: (result: AskResult) => void,
  questions: QuestionSpec[],
  baseLocale = "ru",
) {
  const languageIndex = questions.findIndex((q) => q.uiLanguage === true);
  const locale = (): string => {
    if (languageIndex >= 0) {
      const label = (tr(questions[languageIndex].options[cursor[languageIndex]]?.label) ?? "").toLowerCase();
      if (label.startsWith("en")) return "en";
      if (label.startsWith("ru")) return "ru";
    }
    return baseLocale === "en" ? "en" : "ru";
  };
  const t = (key: string): string => STRINGS[locale()]?.[key] ?? STRINGS.ru[key] ?? key;
  /** Resolve a possibly-localized text for the active locale. */
  const tr = (value: Localized | undefined, fallback = ""): string => {
    if (value === undefined) return fallback;
    if (typeof value === "string") return value;
    return value[locale()] ?? value.ru ?? value.en ?? fallback;
  };
  const selected = questions.map(
    (q) => new Set<number>(q.options.map((o, i) => (o.selected ? i : -1)).filter((i) => i >= 0)),
  );
  // Remember which options were marked recommended, for the ★ marker.
  const recommended = selected.map((set) => new Set(set));
  const REVIEW = questions.length;
  const cursor = questions.map(() => 0);
  let tab = 0;
  let cached: string[] | undefined;

  const refresh = () => {
    cached = undefined;
    tui.requestRender();
  };

  const submit = () => {
    done({
      answers: questions.map((q, qi) => ({
        header: tr(q.header) || tr(q.question),
        labels: [...selected[qi]].sort((a, b) => a - b).map((i) => tr(q.options[i].label)),
      })),
      cancelled: false,
    });
  };

  /** Choose option `index` on the current question, then advance/submit. */
  const chooseAndAdvance = (index: number) => {
    const q = questions[tab];
    if (q.multiSelect) {
      selected[tab].has(index) ? selected[tab].delete(index) : selected[tab].add(index);
      refresh();
      return;
    }
    selected[tab].clear();
    selected[tab].add(index);
    advance();
  };

  const advance = () => {
    if (tab < questions.length) {
      tab += 1;
      refresh();
    } else {
      submit();
    }
  };

  function handleInput(data: string): void {
    if (matchesKey(data, HIDE_KEY)) {
      toggleOverlayVisibility();
      return;
    }
    if (matchesKey(data, Key.left)) {
      tab = Math.max(0, tab - 1);
      refresh();
      return;
    }
    if (matchesKey(data, Key.right)) {
      tab = Math.min(REVIEW, tab + 1);
      refresh();
      return;
    }
    if (matchesKey(data, Key.up)) {
      if (tab < REVIEW) {
        cursor[tab] = Math.max(0, cursor[tab] - 1);
        refresh();
      }
      return;
    }
    if (matchesKey(data, Key.down)) {
      if (tab < REVIEW) {
        cursor[tab] = Math.min(questions[tab].options.length - 1, cursor[tab] + 1);
        refresh();
      }
      return;
    }
    if (matchesKey(data, Key.enter)) {
      // Enter behaves exactly like pressing the highlighted option's number.
      if (tab === REVIEW) {
        submit();
        return;
      }
      if (questions[tab].options.length > 0) {
        chooseAndAdvance(cursor[tab]);
      }
      return;
    }
    if (matchesKey(data, Key.escape)) {
      done({ answers: [], cancelled: true });
      return;
    }
    if (tab === REVIEW) {
      return;
    }
    const match = /^[1-9]$/.exec(data);
    if (match) {
      const index = Number(match[0]) - 1;
      if (index < questions[tab].options.length) {
        chooseAndAdvance(index);
      }
    }
  }

  /** Build the (wrapped) body for a question, or the review screen. */
  const buildBody = (qi: number, innerW: number): { top: string[]; middle: string[]; bottom: string[] } => {
    const top: string[] = [];
    const middle: string[] = [];
    const bottom: string[] = [];
    if (questions.length > 1) {
      const labels = [...questions.map((tq, i) => tr(tq.header) || `${t("question")} ${i + 1}`), t("summary")];
      const tabs = labels.map((label, i) =>
        i === qi ? theme.fg("accent", `▸ ${label}`) : theme.fg("dim", label),
      );
      top.push(...wrapTextWithAnsi(tabs.join(theme.fg("dim", " · ")), innerW));
      top.push("");
    }

    if (qi === REVIEW) {
      middle.push(...wrapTextWithAnsi(theme.fg("text", t("review")), innerW));
      middle.push("");
      const block: string[] = [];
      questions.forEach((q, i) => {
        const labels = [...selected[i]].sort((a, b) => a - b).map((index) => tr(q.options[index].label));
        const value = labels.length > 0 ? labels.join(", ") : t("none");
        block.push(
          ...wrapTextWithAnsi(`${theme.fg("muted", `${tr(q.header) || `${t("question")} ${i + 1}`}:`)} ${value}`, innerW),
        );
      });
      // Same treatment as the options: one left-aligned block, centred as a whole.
      const widest = block.length > 0 ? Math.max(...block.map((line) => visibleWidth(line))) : 0;
      const indent = Math.max(0, Math.floor((innerW - widest) / 2));
      for (const line of block) {
        const padded = " ".repeat(indent) + line;
        middle.push(padded + " ".repeat(Math.max(0, innerW - visibleWidth(padded))));
      }
      return { top, middle, bottom };
    }

    const q = questions[qi];
    middle.push(...wrapTextWithAnsi(theme.fg("text", tr(q.question)), innerW));
    middle.push("");
    const optionLines: string[] = [];
    q.options.forEach((option, index) => {
      const isSelected = selected[qi].has(index);
      const marker = isSelected ? theme.fg("accent", q.multiSelect ? "◉" : "●") : theme.fg("dim", "○");
      const star = recommended[qi].has(index) ? ` ${theme.fg("warning", "★")}` : "";
      const installedSlot = option.installed ? theme.fg("success", "✓") : " ";
      const label = isSelected ? theme.fg("accent", tr(option.label)) : theme.fg("text", tr(option.label));
      const desc = option.description ? ` ${theme.fg("muted", `— ${tr(option.description)}`)}` : "";
      const focus = index === cursor[qi] ? theme.fg("accent", "‣") : " ";
      optionLines.push(...wrapTextWithAnsi(`${installedSlot} ${focus} ${marker} ${index + 1}. ${label}${star}${desc}`, innerW));
    });
    // The list is left-aligned as a block and centred horizontally as a whole.
    const widest = optionLines.length > 0 ? Math.max(...optionLines.map((line) => visibleWidth(line))) : 0;
    const indent = Math.max(0, Math.floor((innerW - widest) / 2));
    for (const line of optionLines) {
      const padded = " ".repeat(indent) + line;
      middle.push(padded + " ".repeat(Math.max(0, innerW - visibleWidth(padded))));
    }
    return { top, middle, bottom };
  };

  function render(width: number): string[] {
    if (cached) {
      return cached;
    }
    const w = Math.max(14, width);
    const SIDE_PAD = 2;
    const innerW = Math.max(6, w - 2 - SIDE_PAD * 2);
    const accent = (s: string) => theme.fg("accent", s);

    // Fixed height: measure every question and pad the shown one, so switching
    // tabs never resizes the window. Two spare rows keep some breathing room.
    const built = [...Array(questions.length + 1).keys()].map((qi) => buildBody(qi, innerW));
    const maxRows = Math.max(...built.map((b) => b.top.length + b.middle.length + b.bottom.length)) * 2;
    const { top, middle, bottom } = built[tab];
    // Tabs stick to the top, hints to the bottom; the spare space sits between.
    const padTotal = Math.max(0, maxRows - (top.length + middle.length + bottom.length));
    // Tabs stay at the top and hints at the bottom; the middle block is centred
    // vertically inside the space that remains.
    const padTop = Math.floor(padTotal / 2);
    const body = [
      ...top,
      ...new Array(padTop).fill(""),
      ...middle,
      ...new Array(padTotal - padTop).fill(""),
      ...bottom,
    ];

    // Controls live in the bottom border; the brand sits in the top border.
    const controls =
      tab === REVIEW
        ? `${t("confirm")} · ${t("change")}`
        : `${t("choose")} · ${t("nav")} · Ctrl+H — ${overlayHidden ? t("show") : t("hide")}`;
    // Border with the label centred between the corners.
    const border = (left: string, right: string, label: string): string => {
      const inner = Math.max(1, w - 2);
      const pad = Math.max(0, inner - visibleWidth(label));
      const before = Math.floor(pad / 2);
      const after = pad - before;
      return (
        accent(left) + accent("─".repeat(before)) + label + accent("─".repeat(after)) + accent(right)
      );
    };
    // Esc is a close button overlaid on the right dashes, so the brand stays centred.
    const close = ` ${theme.fg("muted", "Esc")} `;
    const closeW = visibleWidth(close);
    const topLabel = accent(" pi-mini-boss ");
    const topPad = Math.max(0, w - 2 - visibleWidth(topLabel));
    const topBefore = Math.floor(topPad / 2);
    const topAfter = topPad - topBefore;
    const lines: string[] = [
      accent("╭") +
        accent("─".repeat(topBefore)) +
        topLabel +
        accent("─".repeat(Math.max(0, topAfter - closeW))) +
        close +
        accent("╮"),
    ];
    for (const line of body) {
      const pad = Math.max(0, innerW - visibleWidth(line));
      const before = Math.floor(pad / 2);
      const after = pad - before;
      const gutter = " ".repeat(SIDE_PAD);
      lines.push(
        `${accent("│")}${gutter}${" ".repeat(before)}${line}${" ".repeat(after)}${gutter}${accent("│")}`,
      );
    }
    lines.push(border("╰", "╯", theme.fg("accent", ` ${controls} `)));

    cached = lines;
    return lines;
  }

  return {
    render,
    invalidate: () => {
      cached = undefined;
    },
    handleInput,
  };
}

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }], details: {} };
}

/** Renders nothing: the question lives in the overlay, not the transcript. */
const hiddenRenderer = { render: (): string[] => [], invalidate: (): void => {} };

/** Register the `ask` tool. */
export function registerAskTool(pi: ExtensionAPI): void {
  pi.registerShortcut(HIDE_KEY, {
    description: "Скрыть/показать панель вопросов",
    handler: () => {
      toggleOverlayVisibility();
    },
  });

  pi.registerTool({
    name: ASK_TOOL_NAME,
    label: "Ask",
    description:
      "Ask the user one or more questions with options through a centered overlay panel. Arrow keys switch questions; 1-9 or Enter choose. Supports single/multi choice and pre-selected options. Returns the chosen labels per question.",
    promptSnippet: "Ask the user questions via a panel",
    promptGuidelines: [
      "Use `ask` for structured questions (role, choices, confirmations) — put related questions in one call; they become tabs.",
      "Set selected:true on the option you recommend as the default.",
      "If the user cancels, do NOT repeat the questions in chat — acknowledge briefly and stop.",
    ],
    parameters: ASK_PARAMETERS,
    renderShell: "self",
    renderCall: () => hiddenRenderer,
    renderResult: () => hiddenRenderer,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) {
      if (!ctx.hasUI) {
        return text("No interactive UI available — ask the user in plain text.");
      }
      const input = params as AskParams;
      // A preset builds the questions inside the extension, so the model only
      // emits a short call instead of the whole option list.
      let questions = input.questions ?? [];
      if (questions.length === 0 && input.preset) {
        const { languageQuestion, roleQuestions, extensionQuestions } = await import(
          "../bootstrap/questions.js"
        );
        if (input.preset === "language") {
          questions = [languageQuestion() as never];
        } else if (input.preset === "role") {
          questions = roleQuestions() as never;
        } else if (input.preset === "extensions") {
          questions = extensionQuestions() as never;
        }
      }
      if (questions.length === 0) {
        return text("No questions provided.");
      }

      let handle: HideHandle | undefined;
      overlayHidden = false;
      onHidden = () => {
        ctx.ui.notify("Панель вопросов скрыта. Нажми Ctrl+H, чтобы вернуть её.", "info");
      };
      const result = await ctx.ui.custom<AskResult | null>(
        (tui, theme, _kb, done) => {
          const component = createQuestionnaire(tui, theme, done, questions, input.locale);
          activeOverlay = {
            setHidden: (hidden: boolean) => handle?.setHidden(hidden),
            refresh: () => {
              component.invalidate();
              tui.requestRender();
            },
          };
          return component;
        },
        {
          overlay: true,
          overlayOptions: {
            anchor: "center",
            minWidth: 40,
            width: 100,
            margin: { top: 1, bottom: 1 },
          },
          onHandle: (h: HideHandle) => {
            handle = h;
          },
        },
      );
      activeOverlay = undefined;
      overlayHidden = false;
      onHidden = undefined;

      if (!result || result.cancelled) {
        return text(
          "User cancelled the questions. Do NOT repeat them in chat — just acknowledge briefly and stop.",
        );
      }
      const summary = result.answers
        .map((a) => `${a.header}: ${a.labels.join(", ") || "(none)"}`)
        .join("; ");
      return text(`User answered — ${summary}`);
    },
  });
}
