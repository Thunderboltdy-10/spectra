// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetRunLedger,
  getRunLedger,
  hasSeenOperation,
  markOperationSeen,
  markRunTerminal,
  operationCounts,
  recordRunEvent,
  runIsLiveFor,
} from "../collaboration/run-ledger";

describe("run ledger", () => {
  beforeEach(() => {
    __resetRunLedger();
  });

  it("tracks an operation from intent to durable commit", () => {
    recordRunEvent({
      type: "operation_preview",
      runId: "run-1",
      operationId: "op-1",
      preview: {
        action: "update",
        title: "Rewriting question 3",
        pendingArtifactId: "art-1",
      },
    });
    let entry = getRunLedger("run-1")!;
    expect(entry.operations).toHaveLength(1);
    expect(entry.operations[0]!.status).toBe("performing");
    expect(entry.operations[0]!.title).toBe("Rewriting question 3");

    recordRunEvent({
      type: "operation_result",
      runId: "run-1",
      operationId: "op-1",
    });
    entry = getRunLedger("run-1")!;
    expect(entry.operations[0]!.status).toBe("committed");
    expect(operationCounts(entry)).toEqual({
      committed: 1,
      failed: 0,
      pending: 0,
    });
  });

  it("marks a calm status retry as an invisible continuation, never a failure", () => {
    recordRunEvent({ type: "run_created", runId: "run-1" });
    recordRunEvent({
      type: "status",
      runId: "run-1",
      message: "Taking another careful pass · Keeping your request in focus",
    });
    expect(getRunLedger("run-1")!.phase).toBe("continuing");
    expect(runIsLiveFor("run-1")).toBe(true);
  });

  it("represents partial completion truthfully after a late failure", () => {
    recordRunEvent({
      type: "operation_preview",
      runId: "run-1",
      operationId: "op-1",
      preview: { action: "update", title: "Rewriting question 3" },
    });
    recordRunEvent({
      type: "operation_result",
      runId: "run-1",
      operationId: "op-1",
    });
    recordRunEvent({
      type: "operation_preview",
      runId: "run-1",
      operationId: "op-2",
      preview: { action: "update", title: "Choosing difficulty" },
    });
    recordRunEvent({
      type: "error",
      runId: "run-1",
      message: "The model stream ended early.",
    });

    const entry = getRunLedger("run-1")!;
    expect(entry.phase).toBe("partial");
    expect(entry.preservedPartial).toBe(true);
    expect(operationCounts(entry)).toEqual({
      committed: 1,
      failed: 1,
      pending: 0,
    });
    expect(runIsLiveFor("run-1")).toBe(false);
  });

  it("keeps a clean failure when nothing committed", () => {
    recordRunEvent({
      type: "error",
      runId: "run-1",
      message: "Gateway unavailable.",
    });
    const entry = getRunLedger("run-1")!;
    expect(entry.phase).toBe("failed");
    expect(entry.preservedPartial).toBe(false);
  });

  it("completes through final and stops being live", () => {
    recordRunEvent({ type: "run_created", runId: "run-1" });
    recordRunEvent({ type: "final", runId: "run-1" });
    const entry = getRunLedger("run-1")!;
    expect(entry.phase).toBe("completed");
    expect(entry.generationDone).toBe(true);
    expect(runIsLiveFor("run-1")).toBe(false);
  });

  it("remembers witnessed operations across a reopen", () => {
    markOperationSeen("run-1", "op-1");
    expect(hasSeenOperation("run-1", "op-1")).toBe(true);
    expect(hasSeenOperation("run-1", "op-2")).toBe(false);
    markRunTerminal("run-1", "completed");
    // Reading again must not throw and must keep the record.
    expect(hasSeenOperation("run-1", "op-1")).toBe(true);
  });
});
