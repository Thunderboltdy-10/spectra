import { describe, expect, it, vi } from "vitest";
import { compactAgentMessages, TASK_STATE_MARKER } from "../ai/agent-context";
import { runSpectraAgentLoop, type SpectraAgentMessage } from "../ai/agent-loop";

const exchange = (id: string, name: string, result: unknown): SpectraAgentMessage[] => [
  { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify({ artifactId: id }) } }] },
  { role: "tool", tool_call_id: id, content: JSON.stringify(result) },
];

describe("agent context compaction", () => {
  it("keeps instructions, identities, receipts and the latest exchange while dropping old bodies", () => {
    const body = "Long source passage. ".repeat(5_000);
    const messages: SpectraAgentMessage[] = [
      { role: "system", content: "Stable prefix" },
      { role: "user", content: "Original request" },
      ...exchange("read-1", "read_artifact", { ok: true, artifactId: "a1", revision: 4, content: body }),
      ...exchange("write-1", "schedule_calendar_task", { ok: true, receipt: { operationId: "op-1", status: "saved" }, detail: body }),
      { role: "user", content: "Steer: keep it short" },
      ...exchange("read-2", "read_artifact", { ok: true, artifactId: "a2", content: body }),
    ];
    const result = compactAgentMessages(messages, {
      targetTokens: 1_000, taskState: '{"stagedOperations":[]}',
      isProtectedTool: (name) => name === "schedule_calendar_task",
    });
    expect(result.changed).toBe(true);
    expect(result.messages[0]).toEqual({ role: "system", content: "Stable prefix" });
    const text = JSON.stringify(result.messages);
    for (const kept of ["Original request", "Steer: keep it short", '\\"revision\\":4', "op-1"]) expect(text).toContain(kept);
    // Old read body is gone, the protected receipt and newest read are exact.
    expect(result.messages[3]!.content).toContain("omittedCharacters");
    expect(result.messages[5]!.content).toBe(messages[5]!.content);
    expect(result.messages[8]!.content).toBe(messages[8]!.content);
    expect(result.messages.at(-1)!.content).toContain(TASK_STATE_MARKER);
    const again = compactAgentMessages(result.messages, { targetTokens: 1_000, taskState: "{}" });
    expect(again.messages.filter((message) => String(message.content).startsWith(TASK_STATE_MARKER))).toHaveLength(1);
  });

  it("does no compaction work for an ordinary short conversation", async () => {
    const requestTurn = vi.fn()
      .mockResolvedValueOnce({ text: "", usage: { promptTokens: 1_200 }, toolCalls: [{ id: "r", name: "read_artifact", arguments: "{}" }] })
      .mockResolvedValueOnce({ text: "Done.", usage: { promptTokens: 1_400 }, toolCalls: [] });
    const taskState = vi.fn(() => "{}");
    const messages: SpectraAgentMessage[] = [{ role: "system", content: "Prefix" }, { role: "user", content: "Hi" }];
    await runSpectraAgentLoop({ messages, requestTurn, taskState, executeTool: async () => ({ ok: true, value: "x" }),
      isParallelSafeTool: () => true, isTerminalTool: () => false });
    expect(taskState).not.toHaveBeenCalled();
    expect(requestTurn.mock.calls[1]![0]).toHaveLength(4);
  });
});
