import { describe, expect, it, vi } from "vitest";
import { runSpectraAgentLoop } from "../ai/agent-loop";
import type { SpectraAgentMessage } from "../ai/agent-loop";
import { spectraToolRegistry } from "../tools/registry";

describe("S11 independent review: bounded recovery and receipt identity", () => {
  it("exposes an intentional freshness request instead of silently stripping it", () => {
    expect(spectraToolRegistry.parseInput("read_artifact", {
      artifactId: "externally-edited", refresh: true,
    })).toMatchObject({ artifactId: "externally-edited", refresh: true });
  });

  it("honors repeated refresh reads when a human or native editor changes the same target", async () => {
    const read = { id: "read-first", name: "read_artifact",
      arguments: '{"artifactId":"externally-edited","refresh":true}' };
    const executeTool = vi.fn()
      .mockResolvedValueOnce({ ok: true, artifactId: "externally-edited", revision: 10, content: "Before the human edit" })
      .mockResolvedValueOnce({ ok: true, artifactId: "externally-edited", revision: 11, content: "Human revision to preserve" });
    const snapshots: SpectraAgentMessage[][] = [];
    await runSpectraAgentLoop({ messages: [], executeTool,
      requestTurn: async (messages, index) => {
        snapshots.push(structuredClone(messages));
        return index < 3
          ? { text: "", toolCalls: [{ ...read, id: `read-${index}` }] }
          : { text: "The latest human revision remains present.", toolCalls: [] };
      },
      isParallelSafeTool: () => true, isTerminalTool: () => false });
    expect(executeTool).toHaveBeenCalledTimes(2);
    const refreshed = snapshots[2]!.find((message) => message.tool_call_id === "read-2");
    expect(JSON.parse(String(refreshed?.content))).toMatchObject({
      revision: 11, content: "Human revision to preserve",
    });
  });

  it("does not return completion if Stop arrives with the final model response", async () => {
    const controller = new AbortController();
    const executeTool = vi.fn();
    await expect(runSpectraAgentLoop({
      messages: [{ role: "user", content: "Explain this result." }],
      requestTurn: async () => {
        controller.abort();
        return { text: "An answer that arrived after Stop.", toolCalls: [] };
      },
      executeTool, isTerminalTool: () => false, signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("retries one transient read without retrying an unacknowledged mutation", async () => {
    const read = { id: "read", name: "read_artifact", arguments: '{"artifactId":"disposable"}' };
    const write = { id: "write", name: "organize_library", arguments: '{"name":"Review folder"}' };
    const executeTool = vi.fn()
      .mockResolvedValueOnce({ ok: false, retryable: true, code: "temporary_read_failure" })
      .mockResolvedValueOnce({ ok: true, artifact: { id: "disposable", revision: 8 } })
      .mockRejectedValueOnce(new Error("Connection lost after the server may have committed."));
    const requestTurn = vi.fn()
      .mockResolvedValueOnce({ text: "", toolCalls: [read] })
      .mockResolvedValueOnce({ text: "", toolCalls: [{ ...read, id: "read-retry" }] })
      .mockResolvedValueOnce({ text: "", toolCalls: [write] })
      .mockResolvedValueOnce({ text: "", toolCalls: [{ ...write, id: "write-retry" }] })
      .mockResolvedValueOnce({ text: "The folder's save needs reconciliation.", toolCalls: [] });
    await runSpectraAgentLoop({ messages: [], requestTurn, executeTool,
      isParallelSafeTool: (call) => call.name === "read_artifact",
      isMutationTool: (call) => call.name === "organize_library", isTerminalTool: () => false });
    expect(executeTool.mock.calls.map(([call]) => call.name)).toEqual([
      "read_artifact", "read_artifact", "organize_library",
    ]);
  });

  it("keeps successful receipt identity through three reordered retries without another effect", async () => {
    const argumentsList = [
      '{"name":"Review folder","parentId":"root"}',
      '{"parentId":"root","name":"Review folder"}',
      '{ "name": "Review folder", "parentId": "root" }',
      '{"parentId":"root", "name":"Review folder"}',
    ];
    const snapshots: SpectraAgentMessage[][] = [];
    const executeTool = vi.fn().mockResolvedValue({ ok: true, receipt: {
      operationId: "op-review", createdId: "one-folder", revision: 1,
    } });
    await runSpectraAgentLoop({ messages: [], executeTool,
      requestTurn: async (messages, index) => {
        snapshots.push(structuredClone(messages));
        return index <= argumentsList.length
          ? { text: "", toolCalls: [{ id: `retry-${index}`, name: "organize_library", arguments: argumentsList[index - 1]! }] }
          : { text: "Created one folder.", toolCalls: [] };
      },
      isMutationTool: () => true, isTerminalTool: () => false });
    expect(executeTool).toHaveBeenCalledTimes(1);
    const receipts = snapshots.at(-1)!.filter((message) => message.role === "tool")
      .map((message) => JSON.parse(String(message.content)).receipt);
    expect(receipts).toHaveLength(4);
    expect(receipts.every((receipt) => receipt?.createdId === "one-folder" && receipt?.operationId === "op-review")).toBe(true);
  });

  it("terminates an alternating retrieval cycle without spending the whole generic turn budget", async () => {
    const executeTool = vi.fn().mockResolvedValue({ ok: true, results: [] });
    const requestTurn = vi.fn(async (_messages: SpectraAgentMessage[], index: number) => ({
      text: "", toolCalls: [{ id: `read-${index}`, name: "search_objects",
        arguments: JSON.stringify({ query: index % 2 ? "lesson" : "lesson notes" }) }],
    }));
    await expect(runSpectraAgentLoop({ messages: [], requestTurn, executeTool,
      isParallelSafeTool: () => true, isTerminalTool: () => false,
    })).rejects.toThrow(/no further progress|no.progress|repeated/i);
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(requestTurn.mock.calls.length).toBeLessThanOrEqual(9);
  });
});
