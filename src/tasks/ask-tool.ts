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

function createQuestionnaire(tui: any, theme: any, done: (result: AskResult) => void, questions: QuestionSpec[]) {
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
      // Enter picks the highlighted option (multi: adds it), then moves on.
      if (tab < REVIEW && questions[tab].options.length > 0) {
        const index = cursor[tab];
        if (!selected[tab].has(index)) {
          if (questions[tab].multiSelect) {
            selected[tab].add(index);
          } else {
            selected[tab].clear();
            selected[tab].add(index);
          }
        }
      }
      advance();
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
      const labels = [...questions.map((tq, i) => tq.header || `Q${i + 1}`), "Итог"];
      const tabs = labels.map((label, i) =>
        i === qi ? theme.fg("accent", `▸ ${label}`) : theme.fg("dim", label),
      );
      top.push(...wrapTextWithAnsi(tabs.join(theme.fg("dim", " · ")), innerW));
      top.push("");
    }

    if (qi === REVIEW) {
      middle.push(...wrapTextWithAnsi(theme.fg("text", "Проверь выбор:"), innerW));
      middle.push("");
      const half = Math.floor(innerW / 2);
      questions.forEach((q, i) => {
        const labels = [...selected[i]].sort((a, b) => a - b).map((index) => q.options[index].label);
        const label = `${q.header || `Вопрос ${i + 1}`}:`;
        const value = labels.length > 0 ? labels.join(", ") : "(не выбрано)";
        // The label ends (its colon) at the centre; the value starts there.
        const left = " ".repeat(Math.max(0, half - label.length)) + theme.fg("muted", label);
        const room = Math.max(0, innerW - half);
        const text = value.length > room ? value.slice(0, room) : value;
        const line = left + text;
        middle.push(line + " ".repeat(Math.max(0, innerW - visibleWidth(line))));
      });
      return { top, middle, bottom };
    }

    const q = questions[qi];
    const block: string[] = [];
    block.push(...wrapTextWithAnsi(theme.fg("text", q.question), innerW));
    block.push("");
    q.options.forEach((option, index) => {
      const isSelected = selected[qi].has(index);
      const marker = isSelected ? theme.fg("accent", q.multiSelect ? "◉" : "●") : theme.fg("dim", "○");
      const star = recommended[qi].has(index) ? ` ${theme.fg("warning", "★")}` : "";
      const label = isSelected ? theme.fg("accent", option.label) : theme.fg("text", option.label);
      const desc = option.description ? ` ${theme.fg("muted", `— ${option.description}`)}` : "";
      const focus = index === cursor[qi] ? theme.fg("accent", "‣") : " ";
      block.push(...wrapTextWithAnsi(`${focus} ${marker} ${index + 1}. ${label}${star}${desc}`, innerW));
    });
    // Question and options share one left-aligned block, centred as a whole.
    const widest = block.length > 0 ? Math.max(...block.map((line) => visibleWidth(line))) : 0;
    const indent = Math.max(0, Math.floor((innerW - widest) / 2));
    for (const line of block) {
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
    const innerW = Math.max(6, w - 4);
    const accent = (s: string) => theme.fg("accent", s);

    // Fixed height: measure every question and pad the shown one, so switching
    // tabs never resizes the window. Two spare rows keep some breathing room.
    const built = [...Array(questions.length + 1).keys()].map((qi) => buildBody(qi, innerW));
    const maxRows =
      Math.max(...built.map((b) => b.top.length + b.middle.length + b.bottom.length)) + 2;
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
        ? "Enter — подтвердить · ←/→ — изменить"
        : `1-9/Enter — выбрать · ↑↓ — варианты · ←/→ — вопросы · Ctrl+H — ${overlayHidden ? "показать" : "скрыть"}`;
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
      lines.push(`${accent("│")} ${" ".repeat(before)}${line}${" ".repeat(after)} ${accent("│")}`);
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
      if (input.questions.length === 0) {
        return text("No questions provided.");
      }

      let handle: HideHandle | undefined;
      overlayHidden = false;
      onHidden = () => {
        ctx.ui.notify("Панель вопросов скрыта. Нажми Ctrl+H, чтобы вернуть её.", "info");
      };
      const result = await ctx.ui.custom<AskResult | null>(
        (tui, theme, _kb, done) => {
          const component = createQuestionnaire(tui, theme, done, input.questions);
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
            width: 64,
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
