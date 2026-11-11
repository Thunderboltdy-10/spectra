import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeReasoningDetail } from "../../openrouter-stream";
import { createOpenRouterCaller } from "../model";
import type { HarnessMessage } from "../types";
import type { ModelCaller } from "../loop";

const request = (onText = vi.fn(), onRetry = vi.fn()) =>
  ({
    messages: [{ role: "user", content: "hi" }] as HarnessMessage[],
    tools: [],
    toolChoice: "auto",
    signal: new AbortController().signal,
    onText,
    onRetry,
  }) as Parameters<ModelCaller>[0];

describe("the provider's reasoning during a tool loop", () => {
  it("puts streamed pieces back together and keeps encrypted blocks apart", () => {
    const blocks: Array<Record<string, unknown>> = [];
    mergeReasoningDetail(blocks, { type: "reasoning.text", index: 0, text: "First ", format: "x" });
    mergeReasoningDetail(blocks, { type: "reasoning.text", index: 0, text: "thought", signature: "sig" });
    mergeReasoningDetail(blocks, { type: "reasoning.encrypted", index: 1, data: "abc" });
    expect(blocks).toEqual([
      { type: "reasoning.text", index: 0, text: "First thought", format: "x", signature: "sig" },
      { type: "reasoning.encrypted", index: 1, data: "abc" },
    ]);
  });

  afterEach(() => vi.unstubAllGlobals());

  const sse = (lines: unknown[]) =>
    new Response(lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join("") + "data: [DONE]\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  const toolTurn = sse([
    { model: "m", provider: "p", choices: [{ delta: { reasoning_details: [{ type: "reasoning.encrypted", index: 0, data: "secret" }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "search", arguments: "{}" } }] } }] },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
  ]);
  const looping: HarnessMessage[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "search", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_1", content: "found" },
  ];

  it("sends it back on the same route, leaves the transcript clean, and drops it if refused", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test");
    const bodies: Array<{ messages: Array<Record<string, unknown>> }> = [];
    const replies = [toolTurn, new Response("no", { status: 400 }), sse([{ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] }])];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return replies.shift()!;
    });
    const caller = createOpenRouterCaller();
    await caller(request());
    const turn = await caller({ ...request(), messages: looping });
    expect(turn.text).toBe("done");
    expect(bodies[1]!.messages[1]!.reasoning_details).toEqual([{ type: "reasoning.encrypted", index: 0, data: "secret" }]);
    // The provider said no: the same request again, without it.
    expect(bodies[2]!.messages[1]!.reasoning_details).toBeUndefined();
    expect(JSON.stringify(looping)).not.toContain("secret");
  });
});
