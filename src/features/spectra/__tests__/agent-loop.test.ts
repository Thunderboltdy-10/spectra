import { describe, expect, it, vi } from "vitest";
import { runSpectraAgentLoop } from "../ai/agent-loop";

describe("runSpectraAgentLoop", () => {
  it("executes on-demand reads and returns the terminal plan without a turn cap", async () => {
    const requestTurn = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          { id: "read-1", name: "read_artifact", arguments: '{"artifactId":"a1"}' },
        ],
      })
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          { id: "plan-1", name: "submit_plan", arguments: '{"decision":"operate"}' },
        ],
      });
    const executeTool = vi.fn().mockResolvedValue({ ok: true, title: "Cellular respiration" });
    const result = await runSpectraAgentLoop({
      messages: [{ role: "user", content: "Create a deck from my lesson" }],
      requestTurn,
      executeTool,
      isTerminalTool: (call) => call.name === "submit_plan",
    });
    expect(result.turns).toBe(2);
    expect(result.terminalTool?.id).toBe("plan-1");
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(requestTurn.mock.calls[1]?.[0]).toContainEqual(
      expect.objectContaining({ role: "tool", tool_call_id: "read-1" }),
    );
  });

  it("returns structured feedback before rejecting a proven no-progress cycle", async () => {
    const repeated = {
      text: "",
      toolCalls: [
        { id: "same", name: "search_objects", arguments: '{"query":"cell"}' },
      ],
    };
    const requestTurn = vi.fn().mockResolvedValue(repeated);
    const executeTool = vi.fn().mockResolvedValue({ ok: true, results: [] });
    await expect(
      runSpectraAgentLoop({
        messages: [{ role: "user", content: "Find cell notes" }],
        requestTurn,
        executeTool,
        isTerminalTool: () => false,
      }),
    ).rejects.toThrow(/repeated the identical search_objects request/i);
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(requestTurn.mock.calls[2]?.[0]).toContainEqual(
      expect.objectContaining({
        role: "tool",
        content: expect.stringContaining("identical_tool_call_repeated"),
      }),
    );
  });
});
