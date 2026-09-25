import { describe, expect, it, vi } from "vitest";
import { runSpectraAgentLoop } from "../ai/agent-loop";

describe("runSpectraAgentLoop", () => {
  it("feeds back a saved mutation receipt on retry without executing it again", async () => {
    const call = { id: "write", name: "schedule_calendar_task", arguments: '{"planTaskId":"essay"}' };
    const requestTurn = vi.fn().mockResolvedValueOnce({ text: "", toolCalls: [call] })
      .mockResolvedValueOnce({ text: "", toolCalls: [{ ...call, id: "retry" }] })
      .mockResolvedValueOnce({ text: "", toolCalls: [{ id: "done", name: "submit_plan", arguments: "{}" }] });
    const executeTool = vi.fn().mockResolvedValue({ ok: true, receipt: { itemId: "saved-item", revision: 1 } });
    await runSpectraAgentLoop({ messages: [], requestTurn, executeTool, isMutationTool: () => true, isTerminalTool: (call) => call.name === "submit_plan" });
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(requestTurn.mock.calls[2]![0]).toContainEqual(expect.objectContaining({ role: "tool", tool_call_id: "retry", content: expect.stringContaining("saved-item") }));
  });

  it("does not fast-complete a mixed tool turn after its first successful action", async () => {
    const requestTurn = vi.fn().mockResolvedValueOnce({ text: "", toolCalls: [
      { id: "one", name: "write", arguments: '{"id":1}' }, { id: "two", name: "write", arguments: '{"id":2}' },
    ] }).mockResolvedValueOnce({ text: "", toolCalls: [{ id: "done", name: "submit_plan", arguments: "{}" }] });
    const result = await runSpectraAgentLoop({ messages: [], requestTurn, executeTool: vi.fn().mockResolvedValue({ ok: true }),
      isCompleteAfterTool: () => true, isTerminalTool: (call) => call.name === "submit_plan" });
    expect(result.terminalTool?.id).toBe("done");
    expect(requestTurn.mock.calls[1]![0].filter((message: { role: string }) => message.role === "tool")).toHaveLength(2);
  });

  it("offers bounded schema repair instead of abandoning the request on a tool exception", async () => {
    const requestTurn = vi.fn().mockResolvedValueOnce({ text: "", toolCalls: [{ id: "bad", name: "read", arguments: "{}" }] })
      .mockResolvedValueOnce({ text: "", toolCalls: [{ id: "good", name: "read", arguments: '{"id":"resolved"}' }] })
      .mockResolvedValueOnce({ text: "done", toolCalls: [] });
    const executeTool = vi.fn().mockRejectedValueOnce(new Error("artifactId is required")).mockResolvedValueOnce({ ok: true });
    await runSpectraAgentLoop({ messages: [], requestTurn, executeTool, isTerminalTool: () => false });
    expect(requestTurn.mock.calls[1]![0]).toContainEqual(expect.objectContaining({ content: expect.stringContaining("artifactId is required") }));
    expect(executeTool).toHaveBeenCalledTimes(2);
  });

  it("executes on-demand reads and returns the terminal plan", async () => {
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

  it("returns structured feedback for an identical no-progress cycle", async () => {
    const repeated = {
      text: "",
      toolCalls: [
        { id: "same", name: "search_objects", arguments: '{"query":"cell"}' },
      ],
    };
    const requestTurn = vi
      .fn()
      .mockResolvedValueOnce(repeated)
      .mockResolvedValueOnce(repeated)
      .mockResolvedValueOnce(repeated)
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ id: "done", name: "submit_plan", arguments: "{}" }],
      });
    const executeTool = vi.fn().mockResolvedValue({ ok: true, results: [] });
    const result = await runSpectraAgentLoop({
        messages: [{ role: "user", content: "Find cell notes" }],
        requestTurn,
        executeTool,
        isTerminalTool: (call) => call.name === "submit_plan",
      });
    expect(result.turns).toBe(4);
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(requestTurn.mock.calls[2]?.[0]).toContainEqual(
      expect.objectContaining({
        role: "tool",
        content: expect.stringContaining("identical_tool_call_repeated"),
      }),
    );
  });

  it("reuses an identical successful read without copying its payload into history", async () => {
    const read = (id: string) => ({
      id,
      name: "read_artifact",
      arguments: '{"artifactId":"guide-1"}',
    });
    const requestTurn = vi
      .fn()
      .mockResolvedValueOnce({ text: "", toolCalls: [read("r1")] })
      .mockResolvedValueOnce({ text: "", toolCalls: [read("r2")] })
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ id: "done", name: "submit_plan", arguments: "{}" }],
      });
    const executeTool = vi.fn().mockResolvedValue({
      ok: true,
      artifact: { title: "Guide", content: "large canonical content" },
    });

    await runSpectraAgentLoop({
      messages: [],
      requestTurn,
      executeTool,
      isParallelSafeTool: (call) => call.name === "read_artifact",
      isTerminalTool: (call) => call.name === "submit_plan",
    });

    expect(executeTool).toHaveBeenCalledTimes(1);
    const repeatedResult = requestTurn.mock.calls[2]![0].find(
      (message: { role: string; tool_call_id?: string }) =>
        message.role === "tool" && message.tool_call_id === "r2",
    );
    expect(repeatedResult?.content).toContain("read_result_reused");
    expect(repeatedResult?.content).not.toContain("large canonical content");
  });

  it("blocks repeated reads of one artifact and asks the agent to use its existing results", async () => {
    const read = (id: string, blockId: string) => ({
      id,
      name: "read_artifact",
      arguments: JSON.stringify({ artifactId: "guide-1", blockIds: [blockId] }),
    });
    const requestTurn = vi
      .fn()
      .mockResolvedValueOnce({ text: "", toolCalls: [read("r1", "b1")] })
      .mockResolvedValueOnce({ text: "", toolCalls: [read("r2", "b2")] })
      .mockResolvedValueOnce({ text: "", toolCalls: [read("r3", "b3")] })
      .mockResolvedValueOnce({ text: "", toolCalls: [read("r4", "b4")] })
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ id: "done", name: "submit_plan", arguments: "{}" }],
      });
    const executeTool = vi.fn().mockResolvedValue({ ok: true, artifact: { title: "Guide" } });

    const result = await runSpectraAgentLoop({
      messages: [{ role: "user", content: "Update the guide" }],
      requestTurn,
      executeTool,
      isParallelSafeTool: (call) => call.name === "read_artifact",
      isTerminalTool: (call) => call.name === "submit_plan",
    });

    expect(result.terminalTool?.name).toBe("submit_plan");
    expect(executeTool).toHaveBeenCalledTimes(3);
    expect(requestTurn.mock.calls[4]?.[0]).toContainEqual(
      expect.objectContaining({
        role: "tool",
        content: expect.stringContaining("read_target_budget_reached"),
      }),
    );
  });

  it("uses one terminal-only recovery turn when the ordinary turn budget is reached", async () => {
    const requestTurn = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ id: "r1", name: "read_thread", arguments: '{"threadId":"t1"}' }],
      })
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ id: "r2", name: "read_thread", arguments: '{"threadId":"t2"}' }],
      })
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ id: "r3", name: "read_thread", arguments: '{"threadId":"t3"}' }],
      })
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ id: "r4", name: "read_thread", arguments: '{"threadId":"t4"}' }],
      })
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ id: "done", name: "submit_plan", arguments: "{}" }],
      });

    const result = await runSpectraAgentLoop({
      messages: [{ role: "user", content: "Review this conversation" }],
      requestTurn,
      executeTool: vi.fn().mockResolvedValue({ ok: true }),
      isParallelSafeTool: (call) => call.name === "read_thread",
      isTerminalTool: (call) => call.name === "submit_plan",
      budget: { maxTurns: 4 },
    });

    expect(result.terminalTool?.name).toBe("submit_plan");
    expect(result.turns).toBe(5);
    expect(requestTurn.mock.calls[4]?.[0][0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("Finish now using the context and tool results already gathered"),
    });
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

