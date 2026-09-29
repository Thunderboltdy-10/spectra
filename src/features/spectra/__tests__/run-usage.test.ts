import { afterEach, describe, expect, it, vi } from "vitest";
import { readOpenRouterAgentTurn, readOpenRouterResponse } from "../ai/openrouter-stream";
import { runUsageSnapshot, withRunUsageLedger } from "../ai/run-usage";
import { openRouterParallelSearch } from "../sources/research/parallel-search";

function sse(chunks: string[]) {
  return new Response(new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENROUTER_API_KEY;
});

describe("run usage ledger", () => {
  it("counts every provider call in a run, including failed passes and web research", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      choices: [{ message: { content: "", annotations: [] } }],
      usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
    })));
    const snapshot = await withRunUsageLedger(async () => {
      // A pass that streamed usage and then failed: its tokens were billed.
      await expect(readOpenRouterAgentTurn(sse([
        'data: {"choices":[{"delta":{"content":"Photosynthesis turns"}}],"usage":{"prompt_tokens":1000,"completion_tokens":200}}\n\n',
        'data: {"error":{"message":"Internal Server Error"},"choices":[{"delta":{},"finish_reason":"error"}]}\n\n',
      ]))).rejects.toThrow("Internal Server Error");
      // The repair pass that succeeded.
      const repaired = await readOpenRouterResponse(sse([
        'data: {"choices":[{"delta":{"content":"{\\"decision\\":\\"answer\\",\\"finalResponse\\":\\"Done\\",\\"operations\\":[]}"}}],"usage":{"prompt_tokens":1100,"completion_tokens":50,"total_tokens":1150}}\n\n',
        "data: [DONE]\n\n",
      ]));
      await openRouterParallelSearch({ purpose: "Check", query: "photosynthesis" }, { maxResults: 3 });
      return runUsageSnapshot(repaired.usage);
    });
    expect(snapshot).toMatchObject({ promptTokens: 2140, completionTokens: 260, providerCalls: 3 });
    // The final pass's timing survives the merge.
    expect(snapshot).toHaveProperty("elapsedMs");
  });

  it("records nothing outside a run", async () => {
    await readOpenRouterResponse(sse([
      'data: {"choices":[{"delta":{"content":"{}"}}],"usage":{"prompt_tokens":5,"completion_tokens":5}}\n\n',
      "data: [DONE]\n\n",
    ]));
    expect(runUsageSnapshot()).toBeUndefined();
  });
});
