import type { SpectraAgentMessage } from "./agent-loop";

/**
 * In-loop context compaction near the model's context window.
 *
 * Ordinary short conversations never reach this code: the loop compares the
 * provider-reported prompt size (plus what it appended since) with a threshold.
 * When compaction is needed it is lossless for task state and lossy only for
 * re-readable evidence:
 * - every system message (the cacheable stable prefix) and every user message
 *   (original request, clarification answers, steering) stays verbatim;
 * - the most recent tool exchanges stay verbatim;
 * - older tool results keep their identity/receipt fields (ids, revisions,
 *   status, approval scope, evidence handles) while long bodies are replaced
 *   by an explicit omission note telling the model to re-read if needed;
 * - the harness may append an exact task-state record (staged graph, receipts)
 *   that replaces any earlier record instead of accumulating.
 */

export const TASK_STATE_MARKER = "Current task state (exact, maintained by Spectra";

const SCALAR_LIMIT = 240;
const LONG_RESULT_CHARACTERS = 1_500;
const KEPT_RECENT_EXCHANGES = 1;

export function estimateMessageTokens(messages: readonly SpectraAgentMessage[]) {
  // Conservative for mixed prose/JSON: providers average 3.5-4 chars/token.
  return Math.ceil(messageCharacters(messages) / 3.5);
}

export function messageCharacters(messages: readonly SpectraAgentMessage[]) {
  let total = 0;
  for (const message of messages) {
    total += typeof message.content === "string"
      ? message.content.length : JSON.stringify(message.content ?? null).length;
    for (const call of message.tool_calls ?? []) total += call.function.arguments.length + call.function.name.length;
  }
  return total;
}

/** Keep identity, receipt, approval and evidence fields; drop long bodies. */
export function digestToolPayload(value: unknown, depth = 0): { value: unknown; omitted: number } {
  if (value === null || typeof value === "number" || typeof value === "boolean")
    return { value, omitted: 0 };
  if (typeof value === "string")
    return value.length <= SCALAR_LIMIT ? { value, omitted: 0 } : { value: undefined, omitted: value.length };
  if (depth >= 4) return { value: undefined, omitted: JSON.stringify(value)?.length ?? 0 };
  if (Array.isArray(value)) {
    let omitted = 0;
    const kept: unknown[] = [];
    for (const [index, item] of value.entries()) {
      if (index >= 24) { omitted += JSON.stringify(item)?.length ?? 0; continue; }
      const digest = digestToolPayload(item, depth + 1);
      omitted += digest.omitted;
      if (digest.value !== undefined) kept.push(digest.value);
    }
    return { value: kept, omitted };
  }
  if (typeof value === "object") {
    let omitted = 0;
    const kept: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const digest = digestToolPayload(item, depth + 1);
      omitted += digest.omitted;
      if (digest.value !== undefined) kept[key] = digest.value;
    }
    return { value: kept, omitted };
  }
  return { value: undefined, omitted: 0 };
}

function compactToolContent(content: unknown, name: string) {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  if (text.length <= LONG_RESULT_CHARACTERS) return null;
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* A plain text body is digested as one string. */ }
  const digest = digestToolPayload(parsed);
  if (!digest.omitted) return null;
  return JSON.stringify({
    ...(digest.value && typeof digest.value === "object" && !Array.isArray(digest.value)
      ? digest.value as Record<string, unknown> : { data: digest.value }),
    compacted: {
      omittedCharacters: digest.omitted,
      note: `Older ${name} result compacted for context size. Identifiers, revisions and statuses above are exact. Call ${name} again (refresh: true for reads) if exact content is needed; this note is not a new permission check or write receipt.`,
    },
  });
}

function compactArguments(argumentsText: string) {
  if (argumentsText.length <= LONG_RESULT_CHARACTERS) return argumentsText;
  let parsed: unknown;
  try { parsed = JSON.parse(argumentsText); } catch { return JSON.stringify({ compacted: { omittedCharacters: argumentsText.length } }); }
  const digest = digestToolPayload(parsed);
  return JSON.stringify({ ...(digest.value as Record<string, unknown> ?? {}), compacted: { omittedCharacters: digest.omitted } });
}

/**
 * Reduce the oldest compactable tool exchanges until the estimate reaches
 * `targetTokens`. Returns `changed: false` when nothing can be reduced; the
 * caller then keeps its emergency context guard.
 */
export function compactAgentMessages(
  messages: readonly SpectraAgentMessage[],
  options: { targetTokens: number; taskState?: string; isProtectedTool?: (name: string) => boolean },
) {
  const next = messages
    .filter((message) => !(message.role === "system" && typeof message.content === "string" &&
      message.content.startsWith(TASK_STATE_MARKER)))
    .map((message) => ({ ...message }));
  const exchangeStarts = next.flatMap((message, index) =>
    message.role === "assistant" && message.tool_calls?.length ? [index] : []);
  const compactable = exchangeStarts.slice(0, Math.max(0, exchangeStarts.length - KEPT_RECENT_EXCHANGES));
  let changed = false;
  let estimate = estimateMessageTokens(next);
  for (const start of compactable) {
    if (estimate <= options.targetTokens) break;
    const assistant = next[start]!;
    const names = new Map(assistant.tool_calls!.map((call) => [call.id, call.function.name]));
    assistant.tool_calls = assistant.tool_calls!.map((call) => {
      if (options.isProtectedTool?.(call.function.name)) return call;
      const argumentsText = compactArguments(call.function.arguments);
      if (argumentsText === call.function.arguments) return call;
      changed = true;
      return { ...call, function: { ...call.function, arguments: argumentsText } };
    });
    for (let index = start + 1; index < next.length && next[index]!.role === "tool"; index += 1) {
      const tool = next[index]!;
      const name = names.get(String(tool.tool_call_id)) ?? "tool";
      if (options.isProtectedTool?.(name)) continue;
      const compacted = compactToolContent(tool.content, name);
      if (compacted) { next[index] = { ...tool, content: compacted }; changed = true; }
    }
    estimate = estimateMessageTokens(next);
  }
  if (options.taskState) next.push({ role: "system", content: `${TASK_STATE_MARKER}; supersedes earlier task-state notes):\n${options.taskState}` });
  return { messages: next, changed, estimatedTokens: estimateMessageTokens(next) };
}
