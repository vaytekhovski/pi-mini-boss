/**
 * pi-mini-boss `ask` tool — asks the user through a right-side overlay panel.
 *
 * One call can carry several questions, shown as tabs (←/→). The panel can be
 * hidden with Ctrl+H (and shown again) so the transcript can be scrolled while
 * it stays open.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const ASK_TOOL_NAME = "ask";
/** Hide/show the panel so the transcript can be scrolled. */
const HIDE_KEY = "ctrl+h";

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

function createQuestionnaire(
  tui: any,
  theme: any,
  done: (result: AskResult) => void,
  getHandle: () => HideHandle | undefined,
  questions: QuestionSpec[],
) {
  const selected = questions.map(
    (q) => new Set<number>(q.options.map((o, i) => (o.selected ? i : -1)).filter((i) => i >= 0)),
  );
  const cursor = questions.map(() => 0);
  let tab = 0;
  let hidden = false;
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
      hidden = !hidden;
      getHandle()?.setHidden(hidden);
      refresh();
      return;
    }
    if (hidden) {
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
        return i === tab ? theme.fg("accent", theme.fg("text", label)) : theme.fg("dim", label);
      });
      lines.push(...wrapTextWithAnsi(tabs.join(theme.fg("dim", "│")), w));
      lines.push(...wrapTextWithAnsi(theme.fg("dim", "←/→ — вопросы · Ctrl+H — скрыть/показать"), w));
    }
    lines.push(theme.fg("accent", "─".repeat(w)));

    const q = questions[tab];
    lines.push(...wrapTextWithAnsi(theme.fg("text", q.question), w));
    lines.push("");

    q.options.forEach((option, index) => {
      const mark = q.multiSelect ? (selected[tab].has(index) ? "[x]" : "[ ]") : selected[tab].has(index) ? "(•)" : "( )";
      const prefix = index === cursor[tab] ? theme.fg("accent", "> ") : "  ";
      lines.push(...wrapTextWithAnsi(`${prefix}${mark} ${index + 1}. ${option.label}`, w));
      if (option.description) {
        lines.push(...wrapTextWithAnsi(`      ${theme.fg("muted", option.description)}`, w));
      }
    });

    lines.push("");
    const last = tab === questions.length - 1;
    const hint = q.multiSelect
      ? `↑↓ · Space/цифры — отметить · Enter — ${last ? "готово" : "далее"} · Esc — отмена`
      : `↑↓/цифры — выбрать · Enter — ${last ? "готово" : "далее"} · Esc — отмена`;
    lines.push(...wrapTextWithAnsi(theme.fg("dim", hint), w));
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
  pi.registerTool({
    name: ASK_TOOL_NAME,
    label: "Ask",
    description:
      "Ask the user one or more questions with options through a right-side overlay panel. Questions are shown as tabs (←/→). Supports single/multi choice and pre-selected options. Returns the chosen labels per question.",
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
      const result = await ctx.ui.custom<AskResult | null>(
        (tui, theme, _kb, done) =>
          createQuestionnaire(tui, theme, done, () => handle, input.questions),
        {
          overlay: true,
          overlayOptions: {
            anchor: "right-center",
            minWidth: 34,
            width: "42%",
            margin: { right: 1 },
          },
          onHandle: (h: HideHandle) => {
            handle = h;
          },
        },
      );

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
