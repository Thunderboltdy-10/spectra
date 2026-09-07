import { describe, expect, it } from "vitest";
import {
  extractPartialJsonStringField,
  formatProviderStallLabel,
  ProviderStreamStalledError,
  readOpenRouterAgentTurn,
  readOpenRouterResponse,
  streamEventIsMeaningful,
} from "../ai/openrouter-stream";
import {
  allowSpectraProviderFallbacks,
  getSpectraProviderRouting,
  getSpectraVisionModelId,
  getSpectraVisionProviderRouting,
} from "../ai/model-config";

describe("OpenRouter public response streaming", () => {
  it("restricts the primary call to the configured Luna route and keeps fallback routing explicit", () => {
    delete process.env.SPECTRA_ALLOW_PROVIDER_FALLBACKS;
    expect(allowSpectraProviderFallbacks()).toBe(true);
    expect(getSpectraProviderRouting("primary")).toEqual({ order: ["OpenAI"], only: ["OpenAI"], allow_fallbacks: false });
    expect(getSpectraVisionProviderRouting()).toEqual({
      order: ["Xiaomi"],
      only: ["Xiaomi"],
      allow_fallbacks: false,
    });
    expect(getSpectraVisionModelId()).toBe("xiaomi/mimo-v2.5");
    expect(getSpectraProviderRouting("fallback")).toEqual({ order: ["OpenAI"], only: ["OpenAI"], allow_fallbacks: true, require_parameters: true });
  });
  it("decodes only the public finalResponse JSON string", () => {
    expect(extractPartialJsonStringField('{"decision":"answer","finalResponse":"Line one\\nLine \\"two', "finalResponse"))
      .toMatchObject({ found: true, complete: false, value: 'Line one\nLine "two' });
  });

  it("emits incremental text and records provider usage from SSE", async () => {
    const chunks = [
      'data: {"model":"deepseek/deepseek-v4-pro","provider":"DeepSeek","choices":[{"delta":{"reasoning":"Checking context. ","content":"{\\"decision\\":\\"answer\\",\\"finalResponse\\":\\"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world\\",\\"operations\\":[]}"}}],"usage":{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16}}\n\n',
      "data: [DONE]\n\n",
    ];
    const response = new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } });
    const deltas: string[] = [];
    const reasoning: string[] = [];
    const result = await readOpenRouterResponse(response, (delta) => deltas.push(delta), (delta) => reasoning.push(delta));
    expect(deltas.join("")).toBe("Hello world");
    expect(reasoning.join("")).toBe("Checking context. ");
    expect(result.provider).toBe("DeepSeek");
    expect(result.usage).toMatchObject({ promptTokens: 12, completionTokens: 4, totalTokens: 16 });
  });

  it("reassembles a provider JSON event split across data records", async () => {
    const chunks = [
      'data: {"model":"deepseek/deepseek-v4-pro","provider":"DeepSeek","choices":[{"delta":{"content":"{\\"decision\\":\\"answer\\",',
      '\n',
      'data: \\"finalResponse\\":\\"Recovered\\",\\"operations\\":[]}"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const response = new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } });
    const result = await readOpenRouterResponse(response);
    expect(result.text).toContain('"finalResponse":"Recovered"');
    expect(result.provider).toBe("DeepSeek");
  });

  it("keeps a complete structured response when a provider appends a terminal error", async () => {
    const chunks = [
      'data: {"model":"deepseek/deepseek-v4-pro","provider":"DeepSeek","choices":[{"delta":{"content":"```json\\n{\\"decision\\":\\"answer\\",\\"finalResponse\\":\\"Finished\\",\\"operations\\":[]}\\n```"}}]}\n\n',
      'data: {"error":{"message":"Internal Server Error"}}\n\n',
    ];
    const response = new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } });
    const result = await readOpenRouterResponse(response);
    expect(result.text).toContain('"finalResponse":"Finished"');
    expect(result.provider).toBe("DeepSeek");
  });

  it("still rejects a terminal error after partial structured output", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"{\\"decision\\":\\"answer\\""}}]}\n\n',
      'data: {"error":{"message":"Internal Server Error"}}\n\n',
    ];
    const response = new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } });
    await expect(readOpenRouterResponse(response)).rejects.toThrow("Internal Server Error");
  });

  it("passes a recoverable plan with complete operations to the guarded plan parser", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"{\\"decision\\":\\"operate\\",\\"operations\\":[{\\"type\\":\\"artifact.update\\",\\"input\\":{}}],\\"finalResponse\\":\\"Applied\\""}}]}\n\n',
      'data: {"error":{"message":"Internal Server Error"}}\n\n',
    ];
    const response = new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } });
    const result = await readOpenRouterResponse(response);
    expect(result.text).toContain('"type":"artifact.update"');
  });

  it("preserves distinct streamed tool calls for the iterative agent loop", async () => {
    const chunks = [
      'data: {"model":"deepseek/deepseek-v4-pro","provider":"DeepSeek","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-read","function":{"name":"read_artifact","arguments":"{\\"artifact"}},{"index":1,"id":"call-search","function":{"name":"search_objects","arguments":"{\\"query\\":\\"resp"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"Id\\":\\"artifact-1\\"}"}},{"index":1,"function":{"arguments":"iration\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const response = new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } });
    const result = await readOpenRouterAgentTurn(response);
    expect(result.finishReason).toBe("tool_calls");
    expect(result.toolCalls).toEqual([
      { id: "call-read", name: "read_artifact", arguments: '{"artifactId":"artifact-1"}' },
      { id: "call-search", name: "search_objects", arguments: '{"query":"respiration"}' },
    ]);
  });

  it("processes a final SSE record when the stream closes without a newline", async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-plan","function":{"name":"submit_plan","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}',
        ));
        controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } });

    await expect(readOpenRouterAgentTurn(response)).resolves.toMatchObject({
      finishReason: "tool_calls",
      toolCalls: [
        { id: "call-plan", name: "submit_plan", arguments: "{}" },
      ],
    });
  });

  it("recovers an agent turn after one malformed provider event", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_artifact","arguments":"{\\"artifactId\\":\\"broken',
      '\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-2","function":{"name":"search_objects","arguments":"{\\"query\\":\\"photosynthesis\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const response = new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } });
    const result = await readOpenRouterAgentTurn(response);
    expect(result.toolCalls).toEqual([
      { id: "call-2", name: "search_objects", arguments: '{"query":"photosynthesis"}' },
    ]);
  });

  it("does not duplicate a tool name when a provider repeats its full value", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_artifact","arguments":"{\\"artifactId\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read_artifact","arguments":"\\"artifact-1\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const response = new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } });
    const result = await readOpenRouterAgentTurn(response);
    expect(result.toolCalls[0]).toEqual({
      id: "call-1",
      name: "read_artifact",
      arguments: '{"artifactId":"artifact-1"}',
    });
  });

  it("treats reasoning deltas and SSE keep-alives as meaningful stream activity", () => {
    expect(streamEventIsMeaningful({ line: ": keep-alive" })).toBe(true);
    expect(streamEventIsMeaningful({ delta: { reasoning: "Planning the answer." } })).toBe(true);
    expect(streamEventIsMeaningful({
      delta: { reasoning_details: [{ type: "reasoning.text", text: "Still thinking." }] },
    })).toBe(true);
    expect(streamEventIsMeaningful({ delta: { role: "assistant" } })).toBe(true);
    expect(streamEventIsMeaningful({ pendingJsonContinued: true })).toBe(true);
    expect(streamEventIsMeaningful({ line: "event: ping" })).toBe(false);
  });

  it("names the live provider in stall errors", () => {
    expect(formatProviderStallLabel("deepseek")).toBe("DeepSeek");
    expect(formatProviderStallLabel("baidu")).toBe("Baidu");
    const error = new ProviderStreamStalledError(25_000, formatProviderStallLabel("DeepSeek"));
    expect(error.message).toContain("DeepSeek");
    expect(error.message).toContain("25 seconds");
    expect(error.providerLabel).toBe("DeepSeek");
  });

  it("does not stall while reasoning keep-alives continue under a short idle timeout", async () => {
    const encoder = new TextEncoder();
    let step = 0;
    const response = new Response(new ReadableStream({
      async pull(controller) {
        step += 1;
        if (step === 1) {
          controller.enqueue(encoder.encode(": ping\n\n"));
          await new Promise((resolve) => setTimeout(resolve, 40));
          return;
        }
        if (step === 2) {
          controller.enqueue(encoder.encode(
            'data: {"provider":"DeepSeek","choices":[{"delta":{"reasoning":"Checking."}}]}\n\n',
          ));
          await new Promise((resolve) => setTimeout(resolve, 40));
          return;
        }
        if (step === 3) {
          controller.enqueue(encoder.encode(
            'data: {"choices":[{"delta":{"content":"{\\"decision\\":\\"answer\\",\\"finalResponse\\":\\"Alive\\",\\"operations\\":[]}"}}]}\n\n',
          ));
          return;
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } });
    const result = await readOpenRouterResponse(
      response,
      undefined,
      undefined,
      undefined,
      80,
      "DeepSeek",
    );
    expect(result.text).toContain('"finalResponse":"Alive"');
    expect(result.provider).toBe("DeepSeek");
  });

  it("rejects a true idle stall with the configured provider label", async () => {
    const response = new Response(new ReadableStream({
      start() {
        // Never enqueue — the idle watchdog must fire with the hint label.
      },
    }), { headers: { "content-type": "text/event-stream" } });
    await expect(
      readOpenRouterResponse(response, undefined, undefined, undefined, 50, "Baidu"),
    ).rejects.toMatchObject({
      name: "ProviderStreamStalledError",
      providerLabel: "Baidu",
      message: expect.stringContaining("Baidu"),
    });
  });
});
