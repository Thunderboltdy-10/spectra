import { describe, expect, it, vi } from "vitest";
import { runSpectraAgentLoop } from "../ai/agent-loop";
import type { SpectraAgentMessage } from "../ai/agent-loop";

describe("S11 independent review: lossless task state across bounded context", () => {
  it("compacts one oversized context while preserving intent, scoped approval, sources and receipts", async () => {
    const stablePrompt = "Use typed tools, preserve task state, and never infer approval.";
    const originalRequest = "Revise guide-A and create one practice deck. Preserve the official deadline.";
    const latestSteer = "Make the remaining practice deck suitable for beginners; keep the earlier guide change.";
    const receipt = { operationId: "op-committed", artifactId: "guide-A", revision: 12, status: "canonical_saved" };
    const staged = { operationIndex: 1, phase: "staged", operation: {
      type: "artifact.create", input: { blueprintKey: "flashcard_deck", title: "Practice deck" },
    } };
    const approval = { operationId: "op-delete", scopeHash: "exact-scope-review", status: "rejected" };
    const messages: SpectraAgentMessage[] = [
      { role: "system", content: stablePrompt },
      { role: "user", content: originalRequest },
      { role: "assistant", content: null, tool_calls: [{ id: "old-read", type: "function",
        function: { name: "read_artifact", arguments: '{"artifactId":"source-A"}' } }] },
      { role: "tool", tool_call_id: "old-read", content: JSON.stringify({ ok: true,
        sourceId: "source-A", evidenceId: "evidence:review-source", revision: 5,
        content: "Historical source text for an already inspected passage. ".repeat(24_000),
      }) },
      { role: "assistant", content: null, tool_calls: [{ id: "saved-write", type: "function",
        function: { name: "propose_operation", arguments: '{"operationId":"op-committed"}' } }] },
      { role: "tool", tool_call_id: "saved-write", content: JSON.stringify({ ok: true, receipt, staged, approval }) },
      { role: "user", content: latestSteer },
    ];
    const snapshots: SpectraAgentMessage[][] = [];
    const requestTurn = vi.fn(async (context: SpectraAgentMessage[], index: number) => {
      snapshots.push(structuredClone(context));
      return index === 1
        ? { text: "", usage: { promptTokens: 260_000, completionTokens: 20, totalTokens: 260_020 },
            toolCalls: [{ id: "next-read", name: "read_artifact", arguments: '{"artifactId":"guide-A"}' }] }
        : { text: "The guide is saved; the practice deck remains staged and the rejected deletion was not applied.",
            usage: { promptTokens: 20_000, completionTokens: 40, totalTokens: 20_040 }, toolCalls: [] };
    });
    await runSpectraAgentLoop({ messages, requestTurn,
      executeTool: async () => ({ ok: true, artifactId: "guide-A", revision: 12 }),
      isParallelSafeTool: () => true, isTerminalTool: () => false });
    expect(snapshots).toHaveLength(2);
    const resumed = JSON.stringify(snapshots[1]);
    expect(resumed.length).toBeLessThan(512_000);
    expect(snapshots[1]![0]).toEqual({ role: "system", content: stablePrompt });
    for (const required of [originalRequest, latestSteer, "evidence:review-source",
      "op-committed", "canonical_saved", "Practice deck", "staged", "exact-scope-review", "rejected"])
      expect(resumed).toContain(required);
  });
});
