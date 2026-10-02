import { describe, expect, it, vi } from "vitest";
import { runSpectraAgentLoop } from "../ai/agent-loop";

describe("runSpectraAgentLoop", () => {
  it("preserves quality findings and repair guidance in a failed tool observation", async () => {
    const failure = {
      ok: false, code: "quality_critique_failed", retryable: true,
      message: "The draft needs correction.", critiqueAttempt: 1, critiqueLimit: 3,
      score: 40, passScore: 80,
      findings: [{ criterionId: "evidence", severity: "error", message: "Support this claim.", path: "blocks.0" }],
      repair: "Read the supplied source and revise the unsupported claim.",
    };
    const requestTurn = vi.fn()
      .mockResolvedValueOnce({ text: "", toolCalls: [{ id: "create", name: "propose_operation", arguments: "{}" }] })
      .mockResolvedValueOnce({ text: "The draft needs correction.", toolCalls: [] });
    await runSpectraAgentLoop({ messages: [], requestTurn,
      executeTool: vi.fn().mockResolvedValue(failure), isTerminalTool: () => false });
    const messages = requestTurn.mock.calls[1]![0] as Array<{ role: string; content: string }>;
    const observation = JSON.parse(messages.find(message => message.role === "tool")!.content);
    const { ok: _ok, message, ...feedback } = failure;
    expect(observation).toEqual({ ...feedback, status: 1, error: message });
  });

  it("gives a read cycle actionable feedback while keeping all requested writes available", async () => {
    const read = { id: "read", name: "read_artifact", arguments: '{"artifactId":"deck"}' };
    const write = (id: string) => ({ id, name: "propose_operation", arguments: JSON.stringify({ id }) });
    const requestTurn = vi.fn()
      .mockResolvedValueOnce({ text: "", toolCalls: [read] })
      .mockResolvedValueOnce({ text: "", toolCalls: [{ ...read, id: "repeat-1" }] })
      .mockResolvedValueOnce({ text: "", toolCalls: [{ ...read, id: "repeat-2" }] })
      .mockResolvedValueOnce({ text: "", toolCalls: [write("deck-citations")] })
      .mockResolvedValueOnce({ text: "", toolCalls: [write("guide-citations")] })
      .mockResolvedValueOnce({ text: "Added citations to the deck and guide.", toolCalls: [] });
    const executeTool = vi.fn().mockResolvedValue({ ok: true });
    const result = await runSpectraAgentLoop({
      messages: [{ role: "user", content: "Add citations to both the deck and guide." }],
      requestTurn, executeTool,
      isParallelSafeTool: (call) => call.name === "read_artifact",
      isMutationTool: (call) => call.name === "propose_operation",
      isTerminalTool: () => false,
    });
    expect(executeTool.mock.calls.map(([call]) => call.id)).toEqual(["read", "deck-citations", "guide-citations"]);
    expect(requestTurn.mock.calls[3]![0]).toContainEqual(expect.objectContaining({
      role: "system", content: expect.stringContaining("Continue every unresolved part"),
    }));
    expect(result).toMatchObject({ turns: 6, text: "Added citations to the deck and guide." });
  });

  it("bounds a non-responsive retrieval cycle without replaying reads", async () => {
    const requestTurn = vi.fn().mockResolvedValue({ text: "", toolCalls: [
      { id: "read", name: "read_artifact", arguments: '{"artifactId":"deck"}' },
    ] });
    const executeTool = vi.fn().mockResolvedValue({ ok: true });
    await expect(runSpectraAgentLoop({ messages: [], requestTurn, executeTool,
      isParallelSafeTool: () => true, isTerminalTool: () => false })).rejects.toMatchObject({ name: "SpectraAgentNoProgressError" });
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(requestTurn).toHaveBeenCalledTimes(7); // one useful read, four stalled turns, two finalization attempts
  });

  it("continues an answer cut off at the output limit instead of saving it as final", async () => {
    const requestTurn = vi.fn()
      .mockResolvedValueOnce({ text: "Photosynthesis has two stages: the light", toolCalls: [], finishReason: "length" })
      .mockResolvedValueOnce({ text: "-dependent reactions and the Calvin cycle.", toolCalls: [], finishReason: "stop" });
    const result = await runSpectraAgentLoop({ messages: [], requestTurn, executeTool: vi.fn(), isTerminalTool: () => false });
    expect(result.text).toBe("Photosynthesis has two stages: the light-dependent reactions and the Calvin cycle.");
    expect(result.truncated).toBeUndefined();
    expect(requestTurn.mock.calls.map((call) => call[2])).toEqual([false, true]);
    expect(requestTurn.mock.calls[1]![0]).toContainEqual(expect.objectContaining({
      role: "user", content: expect.stringContaining("cut off by the output limit"),
    }));
  });

  it("reports an answer that stays cut off after every continuation", async () => {
    const requestTurn = vi.fn().mockResolvedValue({ text: "more ", toolCalls: [], finishReason: "length" });
    const result = await runSpectraAgentLoop({ messages: [], requestTurn, executeTool: vi.fn(), isTerminalTool: () => false });
    expect(requestTurn).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({ text: "more more more more ", truncated: true });
  });

  it("sends a reviewed final answer back once, then accepts the next answer", async () => {
    const requestTurn = vi.fn()
      .mockResolvedValueOnce({ text: "I've updated your notes.", toolCalls: [], finishReason: "stop" })
      .mockResolvedValueOnce({ text: "Here is the corrected paragraph.", toolCalls: [], finishReason: "stop" });
    const reviewAnswer = vi.fn().mockReturnValue("Nothing was saved; act or rewrite.");
    const result = await runSpectraAgentLoop({ messages: [], requestTurn, executeTool: vi.fn(),
      isTerminalTool: () => false, reviewAnswer });
    expect(result.text).toBe("Here is the corrected paragraph.");
    expect(reviewAnswer).toHaveBeenCalledTimes(1);
    expect(requestTurn.mock.calls.map((call) => call[2])).toEqual([false, false]);
    expect(requestTurn.mock.calls[1]![0]).toEqual([
      { role: "assistant", content: "I've updated your notes." },
      { role: "system", content: "Nothing was saved; act or rewrite." },
    ]);
  });

  it("never executes or finishes on a tool call cut off at the output limit", async () => {
    const cutPlan = { id: "plan", name: "submit_plan", arguments: '{"operations":[{"type":"artifact.cre' };
    const read = { id: "read", name: "read_artifact", arguments: '{"artifactId":"deck"}' };
    const requestTurn = vi.fn()
      .mockResolvedValueOnce({ text: "", toolCalls: [read, cutPlan], finishReason: "length" })
      .mockResolvedValueOnce({ text: "", toolCalls: [{ ...cutPlan, id: "plan-2", arguments: "{}" }], finishReason: "tool_calls" });
    const executeTool = vi.fn().mockResolvedValue({ ok: true });
    const result = await runSpectraAgentLoop({ messages: [], requestTurn, executeTool,
      isParallelSafeTool: (call) => call.name === "read_artifact",
      isTerminalTool: (call) => call.name === "submit_plan" });
    expect(executeTool.mock.calls.map(([call]) => call.id)).toEqual(["read"]);
    expect(requestTurn.mock.calls[1]![0]).toContainEqual(expect.objectContaining({
      role: "tool", tool_call_id: "plan", content: expect.stringContaining("output_truncated"),
    }));
    expect(result.terminalTool?.id).toBe("plan-2");
  });

  it("retries one transient read failure with identical arguments", async () => {
    const read = { id: "read", name: "read_artifact", arguments: '{"artifactId":"guide"}' };
    const requestTurn = vi.fn()
      .mockResolvedValueOnce({ text: "", toolCalls: [read] })
      .mockResolvedValueOnce({ text: "", toolCalls: [{ ...read, id: "retry" }] })
      .mockResolvedValueOnce({ text: "Read the guide.", toolCalls: [] });
    const executeTool = vi.fn().mockRejectedValueOnce(new Error("Temporary connection failure"))
      .mockResolvedValueOnce({ ok: true, artifact: { id: "guide" } });
    const result = await runSpectraAgentLoop({ messages: [], requestTurn, executeTool,
      isParallelSafeTool: () => true, isTerminalTool: () => false });
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("Read the guide.");
  });

  it("does not repeat an unacknowledged mutation as if it were a safe read retry", async () => {
    const write = { id: "write", name: "write", arguments: '{"id":"guide"}' };
    const requestTurn = vi.fn()
      .mockResolvedValueOnce({ text: "", toolCalls: [write] })
      .mockResolvedValueOnce({ text: "", toolCalls: [{ ...write, id: "retry" }] })
      .mockResolvedValueOnce({ text: "The write result is unconfirmed.", toolCalls: [] });
    const executeTool = vi.fn().mockRejectedValue(new Error("Connection lost after sending"));
    await runSpectraAgentLoop({ messages: [], requestTurn, executeTool,
      isMutationTool: () => true, isTerminalTool: () => false });
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it("honors Stop arriving during a final model response", async () => {
    const controller = new AbortController();
    await expect(runSpectraAgentLoop({ messages: [], signal: controller.signal,
      requestTurn: async () => { controller.abort(); return { text: "Done", toolCalls: [] }; },
      executeTool: vi.fn(), isTerminalTool: () => false,
    })).rejects.toMatchObject({ name: "AbortError" });
  });

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

  it("allows distinct reads of useful regions in the same artifact", async () => {
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
    const executeTool = vi.fn(async (call: { arguments: string }) => ({
      ok: true, artifact: { title: "Guide", block: JSON.parse(call.arguments).blockIds[0] },
    }));

    const result = await runSpectraAgentLoop({
      messages: [{ role: "user", content: "Update the guide" }],
      requestTurn,
      executeTool,
      isParallelSafeTool: (call) => call.name === "read_artifact",
      isTerminalTool: (call) => call.name === "submit_plan",
    });

    expect(result.terminalTool?.name).toBe("submit_plan");
    expect(executeTool).toHaveBeenCalledTimes(4);
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
      executeTool: vi.fn(async (call: { arguments: string }) => ({ ok: true, thread: JSON.parse(call.arguments) })),
      isParallelSafeTool: (call) => call.name === "read_thread",
      isTerminalTool: (call) => call.name === "submit_plan",
      budget: { maxTurns: 4 },
    });

    expect(result.terminalTool?.name).toBe("submit_plan");
    expect(result.turns).toBe(5);
    expect(requestTurn.mock.calls[4]?.[0][0]).toEqual({
      role: "user", content: "Review this conversation",
    });
    expect(requestTurn.mock.calls[4]?.[0].at(-1)).toMatchObject({
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

