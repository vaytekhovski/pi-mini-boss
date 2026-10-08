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

const OptionSchema = Type.Object({
  label: Type.String({ description: "Short option label" }),
  description: Type.Optional(Type.String({ description: "What the option means" })),
  selected: Type.Optional(Type.Boolean({ description: "Pre-select this option" })),
});

const ASK_PARAMETERS = Type.Object({
  questions: Type.Array(
    Type.Object({
      question: Type.String({ description: "The question to ask" }),
      header: Type.Optional(Type.String({ description: "Short tab label" })),
      multiSelect: Type.Optional(Type.Boolean({ description: "Allow several choices" })),
      options: Type.Array(OptionSchema, { minItems: 2, maxItems: 12 }),
    }),
    { minItems: 1, maxItems: 8, description: "One or more questions" },
  ),
});

interface OptionSpec {
  label: string;
  description?: string;
  selected?: boolean;
}
interface QuestionSpec {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: OptionSpec[];
}
interface AskParams {
  questions: QuestionSpec[];
}
interface AskResult {
  answers: Array<{ header: string; labels: string[] }>;
  cancelled: boolean;
}

/** The narrow surface of the overlay handle we need. */
type HideHandle = { setHidden(hidden: boolean): void };

// ── Overlay visibility (module scope so the global shortcut can reach it) ──
let activeOverlay: { setHidden(hidden: boolean): void; refresh(): void } | undefined;
let overlayHidden = false;

function toggleOverlayVisibility(): void {
  if (!activeOverlay) {
    return;
  }
  overlayHidden = !overlayHidden;
  activeOverlay.setHidden(overlayHidden);
  activeOverlay.refresh();
}

function createQuestionnaire(tui: any, theme: any, done: (result: AskResult) => void, questions: QuestionSpec[]) {
  const selected = questions.map(
    (q) => new Set<number>(q.options.map((o, i) => (o.selected ? i : -1)).filter((i) => i >= 0)),
  );
  // Remember which options were marked recommended, for the ★ marker.
  const recommended = selected.map((set) => new Set(set));
  let tab = 0;
  let cached: string[] | undefined;

  const refresh = () => {
    cached = undefined;
    tui.requestRender();
  };

  const submit = () => {
    done({
      answers: questions.map((q, qi) => ({
        header: q.header || q.question,
        labels: [...selected[qi]].sort((a, b) => a - b).map((i) => q.options[i].label),
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
    if (tab < questions.length - 1) {
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
    if (matchesKey(data, Key.up) || matchesKey(data, Key.left)) {
      tab = Math.max(0, tab - 1);
      refresh();
      return;
    }
    if (matchesKey(data, Key.down) || matchesKey(data, Key.right)) {
      tab = Math.min(questions.length - 1, tab + 1);
      refresh();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      // Enter accepts the current selection; with nothing chosen, take the first.
      if (selected[tab].size === 0 && questions[tab].options.length > 0) {
        selected[tab].add(0);
      }
      advance();
      return;
    }
    if (matchesKey(data, Key.escape)) {
      done({ answers: [], cancelled: true });
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

  function render(width: number): string[] {
    if (cached) {
      return cached;
    }
    const w = Math.max(14, width);
    const innerW = Math.max(6, w - 4);
    const accent = (s: string) => theme.fg("accent", s);
    const q = questions[tab];
    const body: string[] = [];

    if (questions.length > 1) {
      const tabs = questions.map((tq, i) =>
        i === tab
          ? theme.fg("accent", `▸ ${tq.header || `Q${i + 1}`}`)
          : theme.fg("dim", `${tq.header || `Q${i + 1}`}`),
      );
      body.push(...wrapTextWithAnsi(tabs.join(theme.fg("dim", " · ")), innerW));
      body.push("");
    }

    body.push(...wrapTextWithAnsi(theme.fg("text", q.question), innerW));
    body.push("");

    q.options.forEach((option, index) => {
      const isSelected = selected[tab].has(index);
      const marker = isSelected ? theme.fg("accent", q.multiSelect ? "◉" : "●") : theme.fg("dim", "○");
      const star = recommended[tab].has(index) ? ` ${theme.fg("warning", "★")}` : "";
      const label = isSelected ? theme.fg("accent", option.label) : theme.fg("text", option.label);
      body.push(...wrapTextWithAnsi(`${marker} ${index + 1}. ${label}${star}`, innerW));
      if (option.description) {
        body.push(...wrapTextWithAnsi(`   ${theme.fg("muted", option.description)}`, innerW));
      }
    });

    body.push("");
    body.push(...wrapTextWithAnsi(theme.fg("dim", "1-9/Enter — выбрать"), innerW));
    body.push(...wrapTextWithAnsi(theme.fg("dim", "↑↓/←→ — вопросы"), innerW));
    body.push(
      ...wrapTextWithAnsi(
        theme.fg("dim", `Ctrl+H — ${overlayHidden ? "показать" : "скрыть"} · Esc — отмена`),
        innerW,
      ),
    );

    // Box: topic + number in the top border, brand in the bottom border.
    const heading = `${q.header || `Вопрос ${tab + 1}`}${
      questions.length > 1 ? ` · ${tab + 1}/${questions.length}` : ""
    }`;
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
    const lines: string[] = [border("╭", "╮", accent(` ${heading} `))];
    for (const line of body) {
      const pad = Math.max(0, innerW - visibleWidth(line));
      const before = Math.floor(pad / 2);
      const after = pad - before;
      lines.push(`${accent("│")} ${" ".repeat(before)}${line}${" ".repeat(after)} ${accent("│")}`);
    }
    lines.push(border("╰", "╯", theme.fg("muted", " pi-mini-boss ")));

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
      if (input.questions.length === 0) {
        return text("No questions provided.");
      }

      let handle: HideHandle | undefined;
      overlayHidden = false;
      const result = await ctx.ui.custom<AskResult | null>(
        (tui, theme, _kb, done) => {
          activeOverlay = {
            setHidden: (hidden: boolean) => handle?.setHidden(hidden),
            refresh: () => tui.requestRender(),
          };
          return createQuestionnaire(tui, theme, done, input.questions);
        },
        {
          overlay: true,
          overlayOptions: {
            anchor: "center",
            minWidth: 30,
            width: 44,
            margin: { top: 1, bottom: 1 },
          },
          onHandle: (h: HideHandle) => {
            handle = h;
          },
        },
      );
      activeOverlay = undefined;
      overlayHidden = false;

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
