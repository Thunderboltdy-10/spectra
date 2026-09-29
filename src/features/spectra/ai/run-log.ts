import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { StructuredLogger } from "@/lib/logging";

/**
 * The structured logger for the Spectra run loop. A request gets a requestId
 * and each run attempt adds its runId and executionId, so every line the loop
 * writes, including lines from helpers deep in planning and tool execution,
 * can be joined to one run without threading a logger through every call.
 */
const current = new AsyncLocalStorage<StructuredLogger>();

export function withSpectraRequestLog<T>(
  request: { method: string; path: string },
  task: () => T,
) {
  return current.run(
    new StructuredLogger({ requestId: randomUUID().slice(0, 8), ...request }),
    task,
  );
}

export function withSpectraRunLog<T>(
  run: { runId: string; executionId: string },
  task: () => T,
) {
  return current.run(runLog().child(run), task);
}

/** The logger for the request and run in progress. */
export function runLog() {
  return (
    current.getStore() ??
    new StructuredLogger({ requestId: "background", path: "/api/spectra/run", method: "POST" })
  );
}
