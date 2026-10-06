import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BenchError,
  benchErrorMessage,
  getAgentBench,
  readBenchStream,
  saveAgentBenchCase,
  streamAgentBench,
  suggestBenchImprovements,
} from "../data/agent-bench";

function streamOf(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("reading the bench stream", () => {
  it("reads whole events however the chunks split them", async () => {
    const events = [];
    for await (const event of readBenchStream(
      streamOf(['{"type":"te', 'xt","delta":"A"}\n{"type":"text","delta":"B"}', "\nnot json\n", '{"type":"retry"}'])
    ))
      events.push(event);
    expect(events).toEqual([
      { type: "text", delta: "A" },
      { type: "text", delta: "B" },
      { type: "retry" },
    ]);
  });

  it("builds the answer as it streams, starts over on a retry, and resolves with the kept run", async () => {
    const run = { id: "r1", prompt: "Hi", target: "draft", output: "Hello.", createdAt: 1 };
    const fetch = vi.fn(async () =>
      new Response(
        streamOf([
          '{"type":"start","target":"draft"}\n',
          '{"type":"text","delta":"Hal"}\n{"type":"retry"}\n',
          '{"type":"text","delta":"Hel"}\n{"type":"text","delta":"lo."}\n',
          `${JSON.stringify({ type: "done", run })}\n`,
        ]),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    const seen: string[] = [];
    await expect(
      streamAgentBench({ agentId: "a", prompt: "Hi", target: "draft", content: { x: 1 }, onText: (text) => seen.push(text) }),
    ).resolves.toEqual(run);
    expect(seen).toEqual(["Hal", "", "Hel", "Hello."]);
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({
      agentId: "a",
      prompt: "Hi",
      target: "draft",
      content: { x: 1 },
    });
  });

  it("never sends draft content when asking the release", async () => {
    const fetch = vi.fn(async () => new Response(streamOf(['{"type":"done","run":{}}\n'])));
    vi.stubGlobal("fetch", fetch);
    await streamAgentBench({ agentId: "a", prompt: "Hi", target: "release", content: { x: 1 }, onText: () => undefined });
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).not.toHaveProperty("content");
  });

  it("names an older release only when asking a release", async () => {
    const fetch = vi.fn(async () => new Response(streamOf(['{"type":"done","run":{}}\n'])));
    vi.stubGlobal("fetch", fetch);
    await streamAgentBench({ agentId: "a", prompt: "Hi", target: "release", releaseNumber: 1, onText: () => undefined });
    await streamAgentBench({ agentId: "a", prompt: "Hi", target: "draft", releaseNumber: 1, onText: () => undefined });
    const bodies = fetch.mock.calls.map((call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
    expect(bodies[0]).toMatchObject({ target: "release", releaseNumber: 1 });
    expect(bodies[1]).not.toHaveProperty("releaseNumber");
  });

  it("throws the stream's own words, or nothing to show when it just stops", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(streamOf(['{"type":"error","message":"Try again soon."}\n']))));
    await expect(streamAgentBench({ agentId: "a", prompt: "Hi", target: "draft", onText: () => undefined })).rejects.toThrow(
      "Try again soon.",
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(streamOf([]))));
    const stopped = await streamAgentBench({ agentId: "a", prompt: "Hi", target: "draft", onText: () => undefined }).catch(
      (error: unknown) => error,
    );
    expect(benchErrorMessage(stopped, "This answer did not finish.")).toBe("This answer did not finish.");
  });

  it("reads a refusal before the stream starts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { ok: false, error: { code: "AGENT_BENCH_NO_RELEASE", message: "This agent has no release to compare with yet." } },
          { status: 400 },
        ),
      ),
    );
    const error = await streamAgentBench({ agentId: "a", prompt: "Hi", target: "release", onText: () => undefined }).catch(
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(BenchError);
    expect(benchErrorMessage(error, "x")).toBe("This agent has no release to compare with yet.");
  });
});

describe("the bench's saved state", () => {
  it("reads tests, answers and the release through the main route", async () => {
    const fetch = vi.fn(async () => Response.json({ cases: [], runs: [], release: null }));
    vi.stubGlobal("fetch", fetch);
    await expect(getAgentBench("agent 1")).resolves.toEqual({ cases: [], runs: [], release: null });
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe("/api/spectra?action=agentBench&agentId=agent+1");
  });

  it("shows the server's sentence when a save is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { ok: false, error: { code: "AGENT_BENCH_LIMIT_CONFLICT", message: "An agent keeps up to 50 tests. Remove one first." } },
          { status: 409 },
        ),
      ),
    );
    const error = await saveAgentBenchCase({
      agentId: "a",
      prompt: "Hi",
      mustInclude: ["x"],
      mustNotInclude: [],
      required: true,
    }).catch((thrown: unknown) => thrown);
    expect(benchErrorMessage(error, "Not saved.")).toBe("An agent keeps up to 50 tests. Remove one first.");
  });

  it("asks for suggestions about one answer and reads them back", async () => {
    const suggestions = [{ key: "tone:warm", reason: "Kinder.", edits: [{ kind: "tone", value: "warm" }] }];
    const fetch = vi.fn(async () => Response.json({ suggestions }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      suggestBenchImprovements({
        agentId: "a",
        prompt: "Hi",
        output: "Hello.",
        checks: { mustInclude: ["x"], mustNotInclude: [] },
        content: { y: 1 },
      }),
    ).resolves.toEqual(suggestions);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/spectra/agents/bench/suggest");
    expect(JSON.parse(init.body as string)).toEqual({
      agentId: "a",
      prompt: "Hi",
      output: "Hello.",
      checks: { mustInclude: ["x"], mustNotInclude: [] },
      content: { y: 1 },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { ok: false, error: { code: "AGENT_BENCH_SUGGEST_UNAVAILABLE", message: "Compile the agent's skills first, then ask for suggestions." } },
          { status: 400 },
        ),
      ),
    );
    const error = await suggestBenchImprovements({ agentId: "a", prompt: "Hi", output: "Hello." }).catch((thrown: unknown) => thrown);
    expect(benchErrorMessage(error, "x")).toBe("Compile the agent's skills first, then ask for suggestions.");
  });

  it("keeps a code out of the words, and falls back for anything unworded", () => {
    expect(benchErrorMessage(new Error("AGENT_BENCH_PROMPT_REQUIRED: Write the question first."), "x")).toBe(
      "Write the question first.",
    );
    expect(benchErrorMessage(new Error("TypeError: boom"), "Fallback.")).toBe("Fallback.");
  });
});
