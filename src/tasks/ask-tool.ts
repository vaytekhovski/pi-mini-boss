/**
 * pi-mini-boss `ask` tool — asks the user a question through the terminal board.
 *
 * The question is written to the shared store, the board renders and answers it,
 * and the tool polls until the answer arrives. If the board is not running, the
 * tool returns immediately so the agent can fall back to a plain-text question
 * instead of hanging.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { TaskStore } from "./store.js";

const ASK_TOOL_NAME = "ask";
const POLL_MS = 300;
const TIMEOUT_MS = 5 * 60 * 1000;

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
        Type.Boolean({ description: "Pre-select this option in the board (multi-select)" }),
      ),
    }),
    { minItems: 2, maxItems: 12, description: "Answer choices" },
  ),
});

interface AskParams {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: Array<{ label: string; description?: string }>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }], details: {} };
}

/** Register the `ask` tool against a lazily-resolved store. */
export function registerAskTool(pi: ExtensionAPI, getStore: () => TaskStore): void {
  pi.registerTool({
    name: ASK_TOOL_NAME,
    label: "Ask (board)",
    description:
      "Ask the user a question with options through the terminal board (side panel). Returns the chosen option labels. If the board is not running, returns a note so you can ask in plain text instead.",
    promptSnippet: "Ask the user a question via the board",
    promptGuidelines: [
      "Prefer `ask` over plain-text questions when the board is running — it keeps the transcript scroll intact and supports many options.",
      "If `ask` reports the board is not running, ask the question as normal text in your reply.",
    ],
    parameters: ASK_PARAMETERS,
    async execute(_toolCallId, params, signal) {
      const store = getStore();
      const input = params as AskParams;

      if (!store.boardAlive()) {
        return text(
          "The terminal board is not running, so the question was not shown. Ask the user in plain text instead.",
        );
      }

      const question = store.askQuestion({ ...input, multiSelect: input.multiSelect === true });
      const deadline = Date.now() + TIMEOUT_MS;

      while (Date.now() < deadline) {
        if (signal?.aborted) {
          store.cancelQuestion(question.id);
          return text("The question was cancelled.");
        }
        const current = store.getQuestion(question.id);
        if (current?.status === "answered") {
          return text(`User answered: ${current.answer?.join(", ") ?? "(none)"}`);
        }
        if (current?.status === "cancelled") {
          return text("User cancelled the question.");
        }
        await sleep(POLL_MS);
      }

      store.cancelQuestion(question.id);
      return text("The user did not answer in time. Ask the question in plain text.");
    },
  });
}
