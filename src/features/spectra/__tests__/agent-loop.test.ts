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

  it("treats maxTotalTokens as a per-turn prompt budget, not a cumulative sum", async () => {
    const requestTurn = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        usage: { promptTokens: 90_000, completionTokens: 500, totalTokens: 90_500 },
        toolCalls: [
          { id: "read-1", name: "read_artifact", arguments: '{"artifactId":"a1"}' },
        ],
      })
      .mockResolvedValueOnce({
        text: "",
        usage: { promptTokens: 95_000, completionTokens: 800, totalTokens: 95_800 },
        toolCalls: [
          { id: "plan-1", name: "submit_plan", arguments: '{"decision":"operate"}' },
        ],
      });
    const executeTool = vi.fn().mockResolvedValue({ ok: true });
    const result = await runSpectraAgentLoop({
      messages: [{ role: "user", content: "Add a validation column" }],
      requestTurn,
      executeTool,
      isTerminalTool: (call) => call.name === "submit_plan",
      budget: { maxTotalTokens: 120_000 },
    });
    expect(result.terminalTool?.id).toBe("plan-1");
    // Cumulative spend is ~186k — previously this falsely tripped the 120k
    // "context budget" because usage was summed across turns.
    expect(result.usage?.totalTokens).toBeGreaterThan(120_000);
  });

  it("still pauses when a single turn's prompt exceeds the context budget", async () => {
    const requestTurn = vi.fn().mockResolvedValue({
      text: "",
      usage: { promptTokens: 130_000, completionTokens: 10, totalTokens: 130_010 },
      toolCalls: [
        { id: "plan-1", name: "submit_plan", arguments: '{"decision":"operate"}' },
      ],
    });
    await expect(
      runSpectraAgentLoop({
        messages: [{ role: "user", content: "Huge sheet" }],
        requestTurn,
        executeTool: vi.fn(),
        isTerminalTool: (call) => call.name === "submit_plan",
        budget: { maxTotalTokens: 120_000 },
      }),
    ).rejects.toThrow(/reliability context budget/i);
  });

  it("feeds a tool-specific recoverable duration result back to the model", async () => {
      const requestTurn = vi
        .fn()
        .mockResolvedValueOnce({
          text: "",
          toolCalls: [
            {
              id: "read-1",
              name: "read_artifact",
              arguments: '{"artifactId":"a1"}',
            },
          ],
        })
        .mockResolvedValueOnce({
          text: "",
          toolCalls: [
            {
              id: "plan-1",
              name: "submit_plan",
              arguments: '{"decision":"operate"}',
            },
          ],
        });
      const executeTool = vi.fn(async () => ({
        ok: false,
        code: "provider_unavailable",
        retryable: true,
        message: "The read policy degraded to the existing context.",
      }));
      const result = await runSpectraAgentLoop({
        messages: [{ role: "user", content: "Read notes" }],
        requestTurn,
        executeTool,
        isTerminalTool: (call) => call.name === "submit_plan",
      });
      expect(result.terminalTool?.id).toBe("plan-1");
      expect(requestTurn.mock.calls[1]?.[0]).toContainEqual(
        expect.objectContaining({
          role: "tool",
          content: expect.stringContaining("provider_unavailable"),
        }),
      );
  });

  it("does not discard sibling calls when a provider mixes a terminal tool with reads", async () => {
    const requestTurn = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          { id: "plan-1", name: "submit_plan", arguments: '{"decision":"operate"}' },
          { id: "read-1", name: "read_artifact", arguments: '{"artifactId":"a1"}' },
        ],
      })
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [
          { id: "plan-2", name: "submit_plan", arguments: '{"decision":"operate"}' },
        ],
      });
    const executeTool = vi.fn().mockResolvedValue({ ok: true, title: "Lesson notes" });
    const result = await runSpectraAgentLoop({
      messages: [{ role: "user", content: "Update the notes" }],
      requestTurn,
      executeTool,
      isParallelSafeTool: (call) => call.name === "read_artifact",
      isTerminalTool: (call) => call.name === "submit_plan",
    });

    expect(result.terminalTool?.id).toBe("plan-2");
    expect(executeTool).toHaveBeenCalledWith(
      expect.objectContaining({ id: "read-1" }),
    );
    expect(requestTurn.mock.calls[1]?.[0]).toContainEqual(
      expect.objectContaining({
        role: "tool",
        tool_call_id: "plan-1",
        content: expect.stringContaining("terminal_tool_must_be_alone"),
      }),
    );
  });

  it("does not execute later mutations after Stop aborts the signal", async () => {
    const controller = new AbortController();
    const requestTurn = vi.fn().mockResolvedValue({
      text: "",
      toolCalls: [
        {
          id: "mut-1",
          name: "schedule_calendar_task",
          arguments: '{"startAt":1,"endAt":2,"timezone":"UTC"}',
        },
        {
          id: "mut-2",
          name: "schedule_calendar_task",
          arguments: '{"startAt":3,"endAt":4,"timezone":"UTC"}',
        },
      ],
    });
    let calls = 0;
    const executeTool = vi.fn(async () => {
      calls += 1;
      if (calls === 1) controller.abort();
      return { ok: true, item: { id: `item-${calls}` } };
    });
    await expect(
      runSpectraAgentLoop({
        messages: [{ role: "user", content: "Schedule two blocks" }],
        requestTurn,
        executeTool,
        isTerminalTool: () => false,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(executeTool).toHaveBeenCalledTimes(1);
  });
});

