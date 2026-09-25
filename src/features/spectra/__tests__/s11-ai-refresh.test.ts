import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSpectraAgentLoop, type SpectraAgentMessage } from "../ai/agent-loop";
import { spectraToolRegistry } from "../tools/registry";

vi.mock("server-only", () => ({}));
const seams = vi.hoisted(() => ({ readQuery: vi.fn(), query: vi.fn(), act: vi.fn(), convexQuery: vi.fn() }));
vi.mock("@/app/api/spectra/run/loop/io", () => ({
  ...seams, mutate: vi.fn(), safeJson: JSON.stringify,
}));
vi.mock("@/lib/convex-server", () => ({
  convexQuery: seams.convexQuery, convexMutation: vi.fn(), convexAction: vi.fn(),
}));
import { executeAgentReadTool } from "@/app/api/spectra/run/loop/plan";

const read = (id: string, refresh?: boolean) => ({
  id, name: "read_artifact", arguments: JSON.stringify({ artifactId: "shared-note", ...(refresh === undefined ? {} : { refresh }) }),
});
const artifact = (version: number) => ({
  _id: "shared-note", blueprintKey: "document", title: "Shared note",
  updatedAt: version, currentVersionId: `version-${version}`, contentHash: `hash-${version}`,
  content: { text: `Human edit ${version}` },
});
const returned = (messages: SpectraAgentMessage[], id: string) => JSON.parse(String(
  messages.find((message) => message.tool_call_id === id)?.content,
));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("S11 explicit fresh reads", () => {
  it.each([
    ["search_objects", { query: "note" }],
    ["search_library", { query: "note" }],
    ["read_artifact", { artifactId: "note" }],
    ["read_workspace", { workspaceId: "workspace" }],
    ["read_thread", { threadId: "thread" }],
    ["retrieve_memory", { query: "note", depth: "focused" }],
    ["get_school_data", { purpose: "classes" }],
    ["web_search", { query: "note" }],
    ["read_calendar", { from: 1, to: 2 }],
    ["read_embeds", { hostWorkId: "note" }],
  ])("keeps refresh in the %s model schema", (name, args) => {
    expect(spectraToolRegistry.parseInput(name as string, { ...args as object, refresh: true }))
      .toMatchObject({ refresh: true });
  });

  it("reauthorizes successive identical refreshes and labels later reuse with the exact observed revision", async () => {
    seams.readQuery.mockResolvedValueOnce({ ok: true, value: artifact(1) })
      .mockResolvedValueOnce({ ok: true, value: artifact(2) })
      .mockResolvedValueOnce({ ok: true, value: artifact(3) });
    const messages: SpectraAgentMessage[][] = [];
    await runSpectraAgentLoop({ messages: [], isParallelSafeTool: () => true, isTerminalTool: () => false,
      executeTool: (call) => executeAgentReadTool("actor", call),
      requestTurn: async (history, turn) => {
        messages.push(structuredClone(history));
        return turn <= 4
          ? { text: "", toolCalls: [read(`r${turn}`, turn === 2 || turn === 3 ? true : undefined)] }
          : { text: "The third revision contains the latest observed human edit.", toolCalls: [] };
      },
    });
    expect(seams.readQuery).toHaveBeenCalledTimes(3);
    for (const [, args] of seams.readQuery.mock.calls) {
      expect(args).toEqual({ actorClerkId: "actor", artifactId: "shared-note" });
    }
    const latest = returned(messages[3]!, "r3");
    expect(latest).toMatchObject({ status: 0, artifact: { currentVersionId: "version-3", contentHash: "hash-3" } });
    expect(latest.readSnapshot.observedAt).toEqual(expect.any(Number));
    expect(latest.readSnapshot.revisions).toMatchObject({ "artifact.currentVersionId": "version-3" });
    expect(returned(messages[4]!, "r4")).toMatchObject({
      code: "read_result_reused", readSnapshot: { ...latest.readSnapshot, reused: true },
      message: expect.stringContaining("No fresh data or permissions were checked"),
    });
  });

  it("returns a refreshed permission failure and never reuses the earlier authorized snapshot afterward", async () => {
    seams.readQuery.mockResolvedValueOnce({ ok: true, value: artifact(1) })
      .mockResolvedValue({ ok: false, code: "permission_lost", message: "Access was revoked.", retryable: false });
    const messages: SpectraAgentMessage[][] = [];
    await runSpectraAgentLoop({ messages: [], isParallelSafeTool: () => true, isTerminalTool: () => false,
      executeTool: (call) => executeAgentReadTool("actor", call),
      requestTurn: async (history, turn) => {
        messages.push(structuredClone(history));
        return turn <= 3 ? { text: "", toolCalls: [read(`r${turn}`, turn === 2)] }
          : { text: "Access was revoked; no update was saved.", toolCalls: [] };
      },
    });
    expect(returned(messages[2]!, "r2")).toMatchObject({ status: 1, code: "permission_lost" });
    expect(returned(messages[3]!, "r3").code).not.toBe("read_result_reused");
    expect(returned(messages[3]!, "r3").status).toBe(1);
  });

  it("retains source revision metadata when a large artifact read has partial coverage", async () => {
    seams.readQuery.mockResolvedValue({ ok: true, value: {
      ...artifact(9), liveStateVectorHash: "live-9", content: { text: "large ".repeat(15_000) },
    } });
    expect(await executeAgentReadTool("actor", read("large", true))).toMatchObject({
      ok: true, artifact: { currentVersionId: "version-9", contentHash: "hash-9",
        liveStateVectorHash: "live-9", contentCoverage: { complete: false } },
    });
  });

  it("bounds endless explicit refreshes when only fetch bookkeeping changes", async () => {
    let reads = 0;
    const executeTool = vi.fn(async () => ({ ok: true, artifact: { ...artifact(1), updatedAt: reads },
      observedAt: ++reads, refreshCount: reads, telemetry: { durationMs: reads },
    }));
    const requestTurn = vi.fn(async (_history: SpectraAgentMessage[], turn: number) => ({ text: "", toolCalls: [read(`r${turn}`, true)] }));
    await expect(runSpectraAgentLoop({ messages: [], executeTool, requestTurn,
      isParallelSafeTool: () => true, isTerminalTool: () => false,
    })).rejects.toMatchObject({ name: "SpectraAgentNoProgressError" });
    expect(executeTool).toHaveBeenCalledTimes(5);
    expect(requestTurn).toHaveBeenCalledTimes(7);
  });

  it("retains the global tool bound even when every refreshed revision changes", async () => {
    let reads = 0;
    const executeTool = vi.fn(async () => ({ ok: true, revision: ++reads }));
    await runSpectraAgentLoop({ messages: [], executeTool, budget: { maxToolCalls: 4 },
      requestTurn: async (_history, turn) => ({ text: "", toolCalls: [read(`r${turn}`, true)] }),
      isParallelSafeTool: () => true, isTerminalTool: () => false,
    });
    expect(executeTool).toHaveBeenCalledTimes(4);
  });

  it("does not grant refresh bypass to mutation calls", async () => {
    const executeTool = vi.fn().mockRejectedValue(new Error("Acknowledgement lost"));
    await runSpectraAgentLoop({ messages: [], executeTool,
      requestTurn: async (_history, turn) => turn <= 2
        ? { text: "", toolCalls: [{ ...read(`w${turn}`, true), name: "organize_library" }] }
        : { text: "The write needs reconciliation.", toolCalls: [] },
      isMutationTool: () => true, isParallelSafeTool: () => false, isTerminalTool: () => false,
    });
    expect(executeTool).toHaveBeenCalledTimes(1);
  });
});
