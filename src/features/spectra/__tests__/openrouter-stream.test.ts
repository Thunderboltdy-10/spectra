import { describe, expect, it } from "vitest";
import { extractPartialJsonStringField, readOpenRouterResponse } from "../ai/openrouter-stream";
import { getSpectraProviderRouting } from "../ai/model-config";

describe("OpenRouter public response streaming", () => {
  it("keeps DeepSeek exclusive unless deployment explicitly enables fallback", () => {
    delete process.env.SPECTRA_ALLOW_PROVIDER_FALLBACKS;
    expect(getSpectraProviderRouting()).toEqual({ order: ["deepseek"], allow_fallbacks: false });
    process.env.SPECTRA_ALLOW_PROVIDER_FALLBACKS = "true";
    expect(getSpectraProviderRouting().allow_fallbacks).toBe(true);
    delete process.env.SPECTRA_ALLOW_PROVIDER_FALLBACKS;
  });
  it("decodes only the public finalResponse JSON string", () => {
    expect(extractPartialJsonStringField('{"decision":"answer","finalResponse":"Line one\\nLine \\"two', "finalResponse"))
      .toMatchObject({ found: true, complete: false, value: 'Line one\nLine "two' });
  });

  it("emits incremental text and records provider usage from SSE", async () => {
    const chunks = [
      'data: {"model":"deepseek/deepseek-v4-pro","provider":"DeepSeek","choices":[{"delta":{"content":"{\\"decision\\":\\"answer\\",\\"finalResponse\\":\\"Hello"}}]}\n\n',
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
    const result = await readOpenRouterResponse(response, (delta) => deltas.push(delta));
    expect(deltas.join("")).toBe("Hello world");
    expect(result.provider).toBe("DeepSeek");
    expect(result.usage).toMatchObject({ promptTokens: 12, completionTokens: 4, totalTokens: 16 });
  });
});
