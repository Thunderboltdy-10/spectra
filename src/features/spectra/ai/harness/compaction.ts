import type { Compactor } from "./loop";
import type { HarnessMessage } from "./types";

/*
 * Compaction: when the transcript nears the model's context window, the
 * older part becomes one structured summary and the recent turns stay
 * verbatim. The user sees an "Earlier messages summarised" divider.
 */

export const COMPACTION_THRESHOLD = 0.8;
export const SUMMARY_MARKER = "[Earlier messages summarised]";

/** A cheap, conservative token estimate (about 3.5 characters per token). */
export function estimateTokens(messages: readonly HarnessMessage[]) {
  let chars = 0;
  for (const message of messages) {
    chars += 16;
    if (typeof message.content === "string") chars += message.content.length;
    else
      for (const part of message.content)
        chars += part.type === "text" ? part.text.length : part.type === "image_url" ? 3_000 : 6_000;
    if (message.role === "assistant" && message.tool_calls)
      for (const call of message.tool_calls) chars += call.function.name.length + call.function.arguments.length + 24;
  }
  return Math.ceil(chars / 3.5);
}

function plainText(message: HarnessMessage) {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => (part.type === "text" ? part.text : part.type === "image_url" ? "[image]" : `[file ${part.file.filename}]`))
    .join("\n");
}

const PER_MESSAGE_LIMIT = 4_000;

/** The older part of the transcript as text for the summariser. */
export function transcriptForSummary(messages: readonly HarnessMessage[]) {
  return messages
    .map((message) => {
      const body = plainText(message);
      const clipped = body.length > PER_MESSAGE_LIMIT ? `${body.slice(0, PER_MESSAGE_LIMIT)}\n[… ${body.length - PER_MESSAGE_LIMIT} more characters]` : body;
      if (message.role === "assistant") {
        const calls = (message.tool_calls ?? [])
          .map((call) => `→ ${call.function.name}(${call.function.arguments.slice(0, 600)})`)
          .join("\n");
        return `ASSISTANT: ${clipped}${calls ? `\n${calls}` : ""}`;
      }
      if (message.role === "tool") return `TOOL RESULT: ${clipped}`;
      return `${message.role.toUpperCase()}: ${clipped}`;
    })
    .join("\n\n");
}

export const SUMMARY_INSTRUCTIONS = `Summarise the earlier part of this Spectra conversation so the assistant can carry on without it. Be specific and keep every id, title, number and date that later work may need. Use exactly these headings:

## What the user wants
## Done so far
(each artifact created or edited: type, title, id, what it contains now)
## Decisions and preferences
## Facts gathered
## Still open

If the transcript opens with NOTES SO FAR, those notes cover everything before it: carry what still matters forward into the new summary, so nothing earlier is lost.

Write plain, compact notes. Do not invent anything.`;

/**
 * Where the verbatim tail starts: the earliest message boundary that keeps the
 * tail within `keepTokens`, never splitting a tool call from its result.
 */
export function compactionCut(messages: readonly HarnessMessage[], keepTokens: number) {
  let cut = messages.length;
  let kept = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    kept += estimateTokens([messages[index]!]);
    if (kept > keepTokens) break;
    cut = index;
  }
  // A tail must start at a user message or an assistant turn, not a tool result.
  while (cut < messages.length && messages[cut]!.role === "tool") cut += 1;
  // Always keep the latest user request verbatim.
  const lastUser = messages.findLastIndex((message) => message.role === "user");
  if (lastUser >= 0 && cut > lastUser) cut = lastUser;
  return cut;
}

/*
 * A thread keeps its whole past across runs, weeks apart or not: once enough
 * messages have built up, the oldest are folded into the thread's running
 * notes and only the recent ones are replayed verbatim.
 */

/** Unfolded messages a thread may build up before the oldest are folded. */
export const THREAD_FOLD_AT = 40;
/** Messages that stay verbatim after a fold. */
export const THREAD_KEEP_MESSAGES = 16;

export function threadFold<T extends { createdAt: number }>(unfolded: readonly T[]) {
  if (unfolded.length <= THREAD_FOLD_AT) return null;
  const older = unfolded.slice(0, unfolded.length - THREAD_KEEP_MESSAGES);
  return { older, through: older.at(-1)!.createdAt };
}

export function threadFoldTranscript(notes: string | undefined, older: readonly HarnessMessage[]) {
  const transcript = transcriptForSummary(older);
  return notes?.trim() ? `NOTES SO FAR:\n${notes.trim()}\n\n${transcript}` : transcript;
}

/** The thread's notes as the first message a run sees. */
export function notesMessage(notes: string): HarnessMessage {
  return { role: "user", content: `${SUMMARY_MARKER}\n${notes.trim()}` };
}

export type Summariser = (input: { transcript: string; signal: AbortSignal }) => Promise<string>;

export function createCompactor(options: {
  contextWindow: number | (() => Promise<number>);
  summarise: Summariser;
  threshold?: number;
  /** Share of the window kept verbatim. */
  keepShare?: number;
}): Compactor {
  const threshold = options.threshold ?? COMPACTION_THRESHOLD;
  const keepShare = options.keepShare ?? 0.25;
  return async ({ system, messages, signal }) => {
    const window =
      typeof options.contextWindow === "number" ? options.contextWindow : await options.contextWindow();
    if (estimateTokens([system, ...messages]) < window * threshold) return null;
    const cut = compactionCut(messages, Math.floor(window * keepShare));
    if (cut <= 1) return null;
    const older = messages.slice(0, cut);
    const summary = (await options.summarise({ transcript: transcriptForSummary(older), signal })).trim();
    if (!summary) return null;
    return {
      summary,
      messages: [{ role: "user", content: `${SUMMARY_MARKER}\n${summary}` }, ...messages.slice(cut)],
    };
  };
}
