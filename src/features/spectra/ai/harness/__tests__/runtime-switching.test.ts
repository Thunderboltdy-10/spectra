import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeReasoningDetail } from "../../openrouter-stream";
import { createOpenRouterCaller } from "../model";
import { runtimeFallbackLabel, withRuntimeFallback, type DisposableModelCaller } from "../subscription-runtime";
import { ProviderUnavailableError, type HarnessMessage, type ModelTurn } from "../types";
import type { ModelCaller } from "../loop";

const finished = (text: string): ModelTurn => ({ text, toolCalls: [] });
const request = (onText = vi.fn(), onRetry = vi.fn()) =>
  ({
    messages: [{ role: "user", content: "hi" }] as HarnessMessage[],
    tools: [],
    toolChoice: "auto",
    signal: new AbortController().signal,
    onText,
    onRetry,
  }) as Parameters<ModelCaller>[0];

describe("leaving the user's own runtime", () => {
  it("never invokes the paid fallback when the runtime is explicitly forced", async () => {
    vi.stubEnv("SPECTRA_AI_RUNTIME", "codex");
    const fallback = vi.fn<ModelCaller>();
    const primary: DisposableModelCaller = async () => { throw new ProviderUnavailableError("Codex is unavailable."); };
    try {
      await expect(withRuntimeFallback(primary, fallback, vi.fn())(request())).rejects.toThrow("Codex is unavailable.");
      expect(fallback).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it("hands the same transcript to OpenRouter, takes back partial text, and says why once", async () => {
    const dispose = vi.fn();
    const primary: DisposableModelCaller = Object.assign(
      async (input: Parameters<ModelCaller>[0]) => {
        input.onText("half a sente");
        throw new ProviderUnavailableError("You've hit your usage limit.");
      },
      { dispose },
    );
    const seen: HarnessMessage[][] = [];
    const fallback: ModelCaller = async (input) => {
      seen.push(input.messages);
      return finished("whole answer");
    };
    const notes: string[] = [];
    const caller = withRuntimeFallback(primary, fallback, (reason) => notes.push(reason));
    const input = request();
    await expect(caller(input)).resolves.toMatchObject({ text: "whole answer" });
    expect(input.onRetry).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(seen[0]).toBe(input.messages);
    expect(runtimeFallbackLabel(notes[0]!)).toMatch(/limit/);
    // Later calls in the run go straight to OpenRouter.
    await caller(request());
    expect(notes).toHaveLength(1);
    expect(seen).toHaveLength(2);
  });

  it("does not switch when the user stopped the run", async () => {
    const controller = new AbortController();
    const fallback = vi.fn<ModelCaller>();
    const primary: DisposableModelCaller = async () => {
      controller.abort();
      throw new Error("aborted");
    };
    const caller = withRuntimeFallback(primary, fallback, () => undefined);
    await expect(caller({ ...request(), signal: controller.signal })).rejects.toThrow("aborted");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("names the login problem so the user knows what to do", () => {
    expect(runtimeFallbackLabel("Log in to Codex on this computer to use it in Spectra.")).toMatch(/logged in/i);
    expect(runtimeFallbackLabel("Could not reach the Bridge relay for codex.")).toMatch(/Bridge/);
  });
});

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
