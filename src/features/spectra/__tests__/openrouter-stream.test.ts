import { describe, expect, it } from "vitest";
import { extractPartialJsonStringField, readOpenRouterAgentTurn, readOpenRouterResponse } from "../ai/openrouter-stream";
import { allowSpectraProviderFallbacks, getSpectraProviderRouting } from "../ai/model-config";

describe("OpenRouter public response streaming", () => {
  it("restricts the primary call to native DeepSeek and keeps fallback routing explicit", () => {
    delete process.env.SPECTRA_ALLOW_PROVIDER_FALLBACKS;
    expect(allowSpectraProviderFallbacks()).toBe(true);
    expect(getSpectraProviderRouting("primary")).toEqual({ order: ["deepseek"], only: ["deepseek"], allow_fallbacks: false });
    expect(getSpectraProviderRouting("fallback")).toEqual({ order: ["baidu", "streamlake", "deepinfra"], only: ["baidu", "streamlake", "deepinfra"], allow_fallbacks: true, require_parameters: true });
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
});
