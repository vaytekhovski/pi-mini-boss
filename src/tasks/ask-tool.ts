/**
 * pi-mini-boss `ask` tool — asks the user through a right-side overlay panel.
 *
 * The overlay is our own component (not the removed rpiv questionnaire): it
 * supports many options, pre-selected checkboxes, keyboard navigation, and keeps
 * most of the transcript visible because it is anchored to the right edge.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const ASK_TOOL_NAME = "ask";

const ASK_PARAMETERS = Type.Object({
  question: Type.String({ description: "The question to ask the user" }),
  header: Type.Optional(Type.String({ description: "Short label for the question" })),
  multiSelect: Type.Optional(
    Type.Boolean({ description: "Allow choosing several options (default: single)" }),
  ),
  options: Type.Array(
    Type.Object({
      label: Type.String({ description: "Short option label" }),
      description: Type.Optional(Type.String({ description: "What the option means" })),
      selected: Type.Optional(
        Type.Boolean({ description: "Pre-select this option (multi-select)" }),
      ),
    }),
    { minItems: 2, maxItems: 12, description: "Answer choices" },
  ),
});

interface AskParams {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: Array<{ label: string; description?: string; selected?: boolean }>;
}

interface AskAnswer {
  labels: string[];
  cancelled: boolean;
}

/** Build the overlay component for one question. */
// The factory's `tui`/`theme` types differ across pi-tui versions; the surface we
// use is tiny, so keep the parameters loose.
function createQuestionComponent(
  tui: any,
  theme: any,
  done: (answer: AskAnswer) => void,
  params: AskParams,
) {
  const multi = params.multiSelect === true;
  const options = params.options;
  const selected = new Set<number>(
    options.map((option, index) => (option.selected ? index : -1)).filter((index) => index >= 0),
  );
  let cursor = 0;
  let cached: string[] | undefined;

  const refresh = () => {
    cached = undefined;
    tui.requestRender();
  };

  const submit = () => {
    const labels = [...selected].sort((a, b) => a - b).map((index) => options[index].label);
    if (labels.length === 0) {
      return;
    }
    done({ labels, cancelled: false });
  };

  const toggle = (index: number) => {
    if (multi) {
      selected.has(index) ? selected.delete(index) : selected.add(index);
    } else {
      selected.clear();
      selected.add(index);
    }
  };

  function handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      cursor = Math.max(0, cursor - 1);
      refresh();
      return;
    }
    if (matchesKey(data, Key.down)) {
      cursor = Math.min(options.length - 1, cursor + 1);
      refresh();
      return;
    }
    if (matchesKey(data, Key.space)) {
      toggle(cursor);
      refresh();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      submit();
      return;
    }
    if (matchesKey(data, Key.escape)) {
      done({ labels: [], cancelled: true });
      return;
    }
    const match = /^[1-9]$/.exec(data);
    if (match) {
      const index = Number(match[0]) - 1;
      if (index >= options.length) {
        return;
      }
      cursor = index;
      toggle(index);
      if (multi) {
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
    const lines: string[] = [theme.fg("accent", "─".repeat(w))];
    if (params.header) {
      lines.push(...wrapTextWithAnsi(theme.fg("accent", params.header), w));
    }
    lines.push(...wrapTextWithAnsi(theme.fg("text", params.question), w));
    lines.push("");
    options.forEach((option, index) => {
      const mark = multi ? (selected.has(index) ? "[x]" : "[ ]") : selected.has(index) ? "(•)" : "( )";
      const prefix = index === cursor ? theme.fg("accent", "> ") : "  ";
      lines.push(...wrapTextWithAnsi(`${prefix}${mark} ${index + 1}. ${option.label}`, w));
      if (option.description) {
        lines.push(...wrapTextWithAnsi(`      ${theme.fg("muted", option.description)}`, w));
      }
    });
    lines.push("");
    const hint = multi
      ? "↑↓ · Space/цифры — отметить · Enter — ок · Esc — отмена"
      : "↑↓/цифры — выбрать · Enter — ок · Esc — отмена";
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
      "Ask the user a question with options through a right-side overlay panel. Supports single/multi choice and pre-selected options. Returns the chosen labels.",
    promptSnippet: "Ask the user a question via a panel",
    promptGuidelines: [
      "Use `ask` for structured questions (role, choices, confirmations) — it keeps the transcript scroll intact.",
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
      const result = await ctx.ui.custom<AskAnswer | null>(
        (tui, theme, _kb, done) => createQuestionComponent(tui, theme, done, input),
        {
          overlay: true,
          overlayOptions: {
            anchor: "right-center",
            minWidth: 34,
            width: "42%",
            margin: { right: 1 },
          },
        },
      );
      if (!result || result.cancelled) {
        return text("User cancelled the question.");
      }
      return text(`User answered: ${result.labels.join(", ")}`);
    },
  });
}
