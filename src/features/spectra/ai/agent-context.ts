import type { SpectraAgentMessage, AgentLoopCheckpoint } from "./agent-loop";

export const COMPACTED_CONTEXT_TOOL = "read_compacted_context";
export const compactedContextTool = {
  type: "function" as const,
  function: {
    name: COMPACTED_CONTEXT_TOOL,
    description: "Read an exact archived conversation or tool-result page. Archived observations are historical, not fresh permission checks or write receipts.",
    parameters: { type: "object", additionalProperties: false, required: ["contextId"], properties: {
      contextId: { type: "string" }, offset: { type: "integer", minimum: 0 },
    } },
  },
};

export type ArchivedAgentContext = { id: string; text: string };
export type AgentContextCheckpoint = {
  version: 1;
  request: string;
  loop: AgentLoopCheckpoint;
  /** Exact harness data. Never generated or revised by a compaction summary. */
  harness: unknown;
  archive: ArchivedAgentContext[];
  inputTokens: number;
  compactedTokens: number;
};
export type AgentContextPersistence = {
  initial?: AgentContextCheckpoint;
  save: (checkpoint: AgentContextCheckpoint) => Promise<void>;
};

type Encoder = { encode: (text: string) => number[] };
let encoder: Promise<Encoder> | undefined;
/** Measure the assembled request, including tool schemas. Provider framing is
 * reserved separately; o200k is an estimate for non-OpenAI provider routes. */
export async function agentRequestTokens(messages: SpectraAgentMessage[], tools: unknown) {
  const text = JSON.stringify({ messages: modelAgentMessages(messages), tools });
  // A UTF-8 byte is an upper bound on text tokens. Avoid loading the tokenizer
  // for ordinary small chats, without underestimating their pressure.
  if (text.length < 12_000) return new TextEncoder().encode(text).byteLength;
  encoder ??= import("js-tiktoken").then(({ getEncoding }) => getEncoding("o200k_base"));
  return (await encoder).encode(text).length + messages.length * 8 + 256;
}

export function modelAgentMessages(messages: SpectraAgentMessage[]) {
  return messages.map(({ contextPreserve: _contextPreserve, ...message }) => message);
}

export function reduceAgentContext(messages: SpectraAgentMessage[], archive: ArchivedAgentContext[]) {
  const nextArchive = [...archive];
  const reduced: SpectraAgentMessage[] = [];
  let changed = false;
  const archiveGroup = (group: SpectraAgentMessage[], preserve?: string) => {
    const id = `context-${nextArchive.length + 1}`;
    const text = JSON.stringify(modelAgentMessages(group));
    nextArchive.push({ id, text });
    const names = group.flatMap(message => message.tool_calls?.map(call => call.function.name) ?? []);
    reduced.push({ role: preserve === undefined ? "system" : "user", content:
      `${preserve === undefined ? "" : `${preserve}\n\n`}Archived historical context ${id} (${text.length} characters${names.length ? `; tools: ${names.join(", ")}` : ""}). Use ${COMPACTED_CONTEXT_TOOL} with this contextId to recover exact details and follow nextOffset until complete. This reference does not establish a current permission, approval, completed task or saved effect.` });
    changed = true;
  };
  // Keep the immutable system prefix and all genuine user instructions. Only
  // an explicitly marked evidence envelope may replace its presentation; its
  // exact request remains visible and the original envelope is recoverable.
  for (let index = 0; index < messages.length;) {
    const message = messages[index]!;
    if (message.contextPreserve !== undefined && JSON.stringify(message.content).length > 2_000) {
      archiveGroup([message], message.contextPreserve);
      index += 1;
      continue;
    }
    if (message.role === "assistant" && message.tool_calls?.length) {
      const group = [message];
      let end = index + 1;
      while (end < messages.length && messages[end]!.role === "tool") group.push(messages[end++]!);
      const ids = new Set(group.slice(1).map(item => item.tool_call_id));
      const complete = message.tool_calls.every(call => ids.has(call.id));
      // Archive complete exchanges only: never leave an orphan tool result.
      if (complete && JSON.stringify(group).length > 2_000) archiveGroup(group);
      else reduced.push(...group);
      index = end;
      continue;
    }
    if (message.role === "assistant" && !message.tool_calls?.length &&
        JSON.stringify(message.content).length > 2_000) archiveGroup([message]);
    else reduced.push(message);
    index += 1;
  }
  return { messages: reduced, archive: nextArchive, changed };
}

export function createAgentContextController(input: {
  request: string;
  persistence?: AgentContextPersistence;
  captureHarness: () => unknown;
  limit?: number;
  signal?: AbortSignal;
  countTokens?: typeof agentRequestTokens;
}) {
  const initial = input.persistence?.initial;
  if (initial && (initial.version !== 1 || initial.request !== input.request))
    throw new Error("AGENT_CONTEXT_REQUEST_CHANGED: The saved context belongs to a different request.");
  let archive = initial?.archive ?? [];
  let active = Boolean(initial);
  let inputTokens = initial?.inputTokens ?? 0;
  let compactedTokens = initial?.compactedTokens ?? 0;
  const checkAbort = () => {
    if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  };
  const persist = async (loop: AgentLoopCheckpoint) => {
    if (!active) return;
    checkAbort();
    // Save before using the reduced view, and after each complete tool turn.
    // Failure is not swallowed: an unpersisted view is never called durable.
    await input.persistence?.save({ version: 1, request: input.request, loop,
      harness: structuredClone(input.captureHarness()), archive, inputTokens, compactedTokens });
    checkAbort();
  };
  return {
    initial: initial?.loop,
    initialHarness: initial?.harness,
    get active() { return active; },
    async prepare(loop: AgentLoopCheckpoint, tools: unknown) {
      checkAbort();
      const count = input.countTokens ?? agentRequestTokens;
      inputTokens = await count(loop.messages, tools);
      const threshold = Math.max(8_000, (input.limit ?? 256_000) - 16_000);
      if (inputTokens < threshold) return loop;
      const next = reduceAgentContext(loop.messages, archive);
      compactedTokens = await count(next.messages, tools);
      if (!next.changed || compactedTokens >= inputTokens)
        throw new Error("AGENT_CONTEXT_PROTECTED_INPUT_TOO_LARGE: The exact instructions exceed the available context; no task text was truncated.");
      archive = next.archive;
      active = true;
      const reduced = { ...loop, messages: next.messages };
      await persist(reduced);
      return reduced;
    },
    persist,
    read(args: { contextId: string; offset?: number }) {
      const entry = archive.find(item => item.id === args.contextId);
      if (!entry) return { ok: false, code: "context_reference_missing" };
      const offset = args.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > entry.text.length)
        return { ok: false, code: "context_offset_invalid" };
      const end = Math.min(entry.text.length, offset + 24_000);
      return { ok: true, contextId: entry.id, text: entry.text.slice(offset, end), offset,
        nextOffset: end < entry.text.length ? end : null, totalCharacters: entry.text.length,
        historical: true, message: "Exact archived data; fresh reads still require current authority. This is not new write acknowledgement." };
    },
  };
}
