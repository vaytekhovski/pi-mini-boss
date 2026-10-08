/**
 * pi-mini-boss `ask` tool — asks the user through a centered overlay panel.
 *
 * One call can carry several questions, shown as tabs (←/→). The panel toggles
 * with Ctrl+H: a global shortcut handles the "show again" case, because a hidden
 * overlay no longer receives key input.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
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

  const toggle = (qi: number, oi: number) => {
    if (questions[qi].multiSelect) {
      selected[qi].has(oi) ? selected[qi].delete(oi) : selected[qi].add(oi);
    } else {
      selected[qi].clear();
      selected[qi].add(oi);
    }
  };

  function handleInput(data: string): void {
    if (matchesKey(data, HIDE_KEY)) {
      toggleOverlayVisibility();
      return;
    }
    const q = questions[tab];
    if (matchesKey(data, Key.left)) {
      tab = Math.max(0, tab - 1);
      refresh();
      return;
    }
    if (matchesKey(data, Key.right)) {
      tab = Math.min(questions.length - 1, tab + 1);
      refresh();
      return;
    }
    if (matchesKey(data, Key.up)) {
      cursor[tab] = Math.max(0, cursor[tab] - 1);
      refresh();
      return;
    }
    if (matchesKey(data, Key.down)) {
      cursor[tab] = Math.min(q.options.length - 1, cursor[tab] + 1);
      refresh();
      return;
    }
    if (matchesKey(data, Key.space)) {
      toggle(tab, cursor[tab]);
      refresh();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      // Enter also picks the highlighted option before moving on.
      const optionIndex = cursor[tab];
      if (!selected[tab].has(optionIndex)) {
        if (q.multiSelect) {
          selected[tab].add(optionIndex);
        } else {
          selected[tab].clear();
          selected[tab].add(optionIndex);
        }
      }
      if (tab < questions.length - 1) {
        tab += 1;
        refresh();
      } else {
        submit();
      }
      return;
    }
    if (matchesKey(data, Key.escape)) {
      done({ answers: [], cancelled: true });
      return;
    }
    const match = /^[1-9]$/.exec(data);
    if (match) {
      const index = Number(match[0]) - 1;
      if (index >= q.options.length) {
        return;
      }
      cursor[tab] = index;
      toggle(tab, index);
      if (q.multiSelect) {
        refresh();
      } else if (tab < questions.length - 1) {
        tab += 1;
        refresh();
      } else {
        submit();
      }
    }
  }

  function render(width: number): string[] {
    if (cached) {
      return cached;
    }
    const w = Math.max(1, width);
    const lines: string[] = [];

    if (questions.length > 1) {
      const tabs = questions.map((q, i) => {
        const label = ` ${q.header || `Q${i + 1}`} `;
        return i === tab ? theme.fg("accent", label) : theme.fg("dim", label);
      });
      lines.push(...wrapTextWithAnsi(tabs.join(theme.fg("dim", "│")), w));
    }
    lines.push(theme.fg("accent", "─".repeat(w)));

    const q = questions[tab];
    lines.push(...wrapTextWithAnsi(theme.fg("text", q.question), w));
    lines.push("");

    q.options.forEach((option, index) => {
      const mark = q.multiSelect
        ? selected[tab].has(index)
          ? "[x]"
          : "[ ]"
        : selected[tab].has(index)
          ? "(•)"
          : "( )";
      const prefix = index === cursor[tab] ? theme.fg("accent", "> ") : "  ";
      lines.push(...wrapTextWithAnsi(`${prefix}${mark} ${index + 1}. ${option.label}`, w));
      if (option.description) {
        lines.push(...wrapTextWithAnsi(`      ${theme.fg("muted", option.description)}`, w));
      }
    });

    lines.push("");
    const last = tab === questions.length - 1;
    const controls = [
      "↑↓/1-9 — выбрать",
      q.multiSelect ? "Space — отметить" : null,
      `Enter — ${last ? "готово" : "далее"}`,
      questions.length > 1 ? "←/→ — вопросы" : null,
      `Ctrl+H — ${overlayHidden ? "показать" : "скрыть"}`,
      "Esc — отмена",
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(...wrapTextWithAnsi(theme.fg("dim", controls), w));
    lines.push(theme.fg("accent", "─".repeat(w)));

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
  // Global toggle: a hidden overlay receives no key input, so the "show again"
  // half has to be an app-level shortcut.
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
      "Ask the user one or more questions with options through a centered overlay panel. Questions are shown as tabs (←/→). Supports single/multi choice and pre-selected options. Returns the chosen labels per question.",
    promptSnippet: "Ask the user questions via a panel",
    promptGuidelines: [
      "Use `ask` for structured questions (role, choices, confirmations) — put related questions in one call; they become tabs.",
      "Set selected:true on the option you recommend as the default.",
    ],
    parameters: ASK_PARAMETERS,
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
            minWidth: 40,
            width: "60%",
          },
          onHandle: (h: HideHandle) => {
            handle = h;
          },
        },
      );
      activeOverlay = undefined;
      overlayHidden = false;

      if (!result || result.cancelled) {
        return text("User cancelled the question.");
      }
      const summary = result.answers
        .map((a) => `${a.header}: ${a.labels.join(", ") || "(none)"}`)
        .join("; ");
      return text(`User answered — ${summary}`);
    },
  });
}
