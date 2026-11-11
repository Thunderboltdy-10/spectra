import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/*
 * A development-only record of one run, one JSON line per event, written to
 * SPECTRA_RUN_TRACE_DIR/<runId>.jsonl. It stays silent unless that variable is
 * set, and it only records sizes, names and timings, except for the model's
 * reasoning summary and raw provider frames, which go to <runId>.raw.jsonl.
 */

type TraceStore = { runId: string; startedAt: number };

const current = new AsyncLocalStorage<TraceStore>();

function directory() {
  return process.env.SPECTRA_RUN_TRACE_DIR?.trim() || "";
}

export function runTraceEnabled() {
  return Boolean(directory());
}

let prepared = false;
function write(file: string, line: Record<string, unknown>) {
  const root = directory();
  if (!root) return;
  try {
    if (!prepared) {
      mkdirSync(root, { recursive: true });
      prepared = true;
    }
    appendFileSync(join(root, file), `${JSON.stringify(line)}\n`);
  } catch {
    // Tracing never affects a run.
  }
}

export function withRunTrace<T>(runId: string, task: () => T): T {
  if (!runTraceEnabled()) return task();
  return current.run({ runId, startedAt: Date.now() }, task);
}

/** One event on the run in progress, or on `requests.jsonl` outside a run. */
export function traceEvent(kind: string, data: Record<string, unknown> = {}) {
  if (!runTraceEnabled()) return;
  const store = current.getStore();
  const now = Date.now();
  write(store ? `${store.runId}.jsonl` : "outside-run.jsonl", {
    at: now,
    ...(store ? { t: now - store.startedAt } : {}),
    kind,
    ...data,
  });
}

/** Raw provider frames and reasoning text, kept apart from the timing record. */
export function traceRaw(kind: string, data: Record<string, unknown>) {
  if (!runTraceEnabled()) return;
  const store = current.getStore();
  write(store ? `${store.runId}.raw.jsonl` : "outside-run.raw.jsonl", {
    at: Date.now(),
    kind,
    ...data,
  });
}

/** Times `work` and records how it ended. */
export async function traceSpan<T>(
  kind: string,
  data: Record<string, unknown>,
  work: () => Promise<T>,
): Promise<T> {
  if (!runTraceEnabled()) return work();
  const started = Date.now();
  try {
    const result = await work();
    traceEvent(kind, { ...data, ms: Date.now() - started, ok: true });
    return result;
  } catch (error) {
    traceEvent(kind, {
      ...data,
      ms: Date.now() - started,
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 240) : "unknown",
    });
    throw error;
  }
}

export function jsonSize(value: unknown) {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}
