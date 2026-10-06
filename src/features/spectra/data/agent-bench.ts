import type {
  BenchCase,
  BenchRun,
  BenchStreamEvent,
  BenchTarget,
} from "../agents/foundry";
import { readConvexError } from "../../../../shared/convex-error.mjs";
import { requestSpectra } from "./request";

/*
 * The agent bench's client: the saved tests and recent answers through the
 * main Spectra route, and one answer at a time through the bench route's
 * stream.
 */

/** The newest release a draft can be compared with. */
export type BenchRelease = {
  releaseNumber: number;
  title: string;
  summary?: string;
  content: unknown;
};

export type AgentBenchState = {
  cases: BenchCase[];
  runs: BenchRun[];
  release: BenchRelease | null;
};

/** A failure the bench route or Convex worded for the person reading it. */
export class BenchError extends Error {
  constructor(
    message: string,
    readonly data?: { code?: string | null; message: string },
  ) {
    super(message);
    this.name = "BenchError";
  }
}

async function readBody<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: unknown })
    | null;
  if (!response.ok) {
    const error = payload?.error;
    if (error && typeof error === "object" && "message" in error)
      throw new BenchError(String((error as { message: unknown }).message), error as BenchError["data"]);
    throw new BenchError(typeof error === "string" ? error : "");
  }
  return payload as T;
}

export async function getAgentBench(agentId: string, signal?: AbortSignal) {
  const qs = new URLSearchParams({ action: "agentBench", agentId });
  return readBody<AgentBenchState>(
    await requestSpectra(`/api/spectra?${qs.toString()}`, { cache: "no-store", signal }),
  );
}

export type SaveBenchCaseInput = {
  agentId: string;
  caseId?: string;
  prompt: string;
  mustInclude: string[];
  mustNotInclude: string[];
  rubric?: string;
  required: boolean;
};

export async function saveAgentBenchCase(input: SaveBenchCaseInput) {
  return readBody<{ caseId: string; created: boolean }>(
    await requestSpectra("/api/spectra", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "saveAgentBenchCase", ...input }),
    }),
  );
}

export async function removeAgentBenchCase(agentId: string, caseId: string) {
  return readBody<{ removed: boolean }>(
    await requestSpectra("/api/spectra", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "removeAgentBenchCase", agentId, caseId }),
    }),
  );
}

/** Reads an NDJSON body line by line, however the chunks were split. */
export async function* readBenchStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<BenchStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffered += decoder.decode(value, { stream: !done });
    let newline = buffered.indexOf("\n");
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (line) {
        try {
          yield JSON.parse(line) as BenchStreamEvent;
        } catch {
          // A line that is not an event is not something to show.
        }
      }
      newline = buffered.indexOf("\n");
    }
    if (done) break;
  }
  const rest = buffered.trim();
  if (rest) {
    try {
      yield JSON.parse(rest) as BenchStreamEvent;
    } catch {
      // As above.
    }
  }
}

/**
 * Asks the agent one bench prompt and streams the answer into `onText`. It
 * resolves with the answer as kept, or throws a worded `BenchError`.
 */
export async function streamAgentBench(input: {
  agentId: string;
  prompt: string;
  target: BenchTarget;
  /** The editor's newest draft, so a rerun right after an edit uses it. */
  content?: unknown;
  signal?: AbortSignal;
  onText: (text: string) => void;
}): Promise<BenchRun> {
  const response = await requestSpectra("/api/spectra/agents/bench", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentId: input.agentId,
      prompt: input.prompt,
      target: input.target,
      ...(input.target === "draft" && input.content !== undefined
        ? { content: input.content }
        : {}),
    }),
    signal: input.signal,
  });
  if (!response.ok || !response.body) await readBody(response);
  let text = "";
  for await (const event of readBenchStream(response.body!)) {
    if (event.type === "text") {
      text += event.delta;
      input.onText(text);
    } else if (event.type === "retry") {
      text = "";
      input.onText(text);
    } else if (event.type === "done") return event.run;
    else if (event.type === "error")
      throw new BenchError(event.message, { message: event.message });
  }
  throw new BenchError("");
}

/**
 * What to tell the person: the bench's own sentence when it wrote one,
 * otherwise the caller's copy. A code or a raw provider message never shows.
 */
export function benchErrorMessage(error: unknown, fallback: string) {
  if (error instanceof BenchError) return error.message || fallback;
  const { code, message } = readConvexError(error);
  if (code?.startsWith("AGENT_")) {
    const sentence = message.slice(code.length).replace(/^:\s*/, "");
    if (sentence) return sentence;
  }
  if (error instanceof Error && error.message.startsWith("Spectra could not reach"))
    return error.message;
  return fallback;
}
