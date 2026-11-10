import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
const io = vi.hoisted(() => ({ query: vi.fn(), local: vi.fn(), urls: [] as string[], starts: [] as Record<string, unknown>[], inference: false, toolOnce: false,
  turns: [] as Record<string, unknown>[], interrupts: [] as Record<string, unknown>[],
  traces: [] as Array<{ path: string; kind: string; method?: string }> }));
vi.mock("@/lib/convex-server", () => ({ convexQuery: io.query }));
vi.mock("@/lib/local-bridge-relay", () => ({ localBridgeRelay: io.local }));
vi.mock("node:fs", async original => ({ ...await original<typeof import("node:fs")>(), mkdirSync: vi.fn(),
  appendFileSync: (path: string, data: string) => io.traces.push({ path, ...JSON.parse(data) }) }));
import { runtimeStatus, subscriptionOneShot, subscriptionModelCaller } from "../subscription-runtime";
import { withRunTrace } from "../run-trace";
import { emptyLoopState, runHarnessLoop } from "../loop";

class Socket extends EventTarget {
  private created = AsyncLocalStorage.snapshot();
  constructor(url: string) { super(); io.urls.push(url); queueMicrotask(() => this.dispatchEvent(new Event("open"))); }
  send(text: string) {
    const frame = JSON.parse(text);
    if (frame.method === "thread/start") io.starts.push(frame.params);
    if (frame.method === "turn/start") io.turns.push(frame.params);
    if (frame.method === "turn/interrupt") io.interrupts.push(frame.params);
    const reply = frame.args ? { relay: "started" }
      : frame.method === "thread/start" ? io.inference ? { id: frame.id, result: { thread: { id: `thread-${io.starts.length}` } } } : { id: frame.id, error: { message: "fixture stops before inference" } }
      : frame.id ? { id: frame.id, result: frame.method === "account/read" ? { account: { email: "fixture@example.test" } } : frame.method === "turn/start" ? { turn: { id: `turn-${io.turns.length}` } } : {} }
      : null;
    const emit = (value: unknown) => this.created(() => this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })));
    if (reply) queueMicrotask(() => {
      emit(reply);
      if (io.inference && frame.method === "turn/start") {
        const params = { threadId: frame.params.threadId };
        if (io.toolOnce) {
          io.toolOnce = false;
          emit({ id: 9001, method: "item/tool/call", params: { ...params, callId: "look-call", tool: "look", arguments: {} } });
          return;
        }
        emit({ method: "item/agentMessage/delta", params: { ...params, delta: "Done" } });
        emit({ method: "turn/completed", params: { ...params, turn: { status: "completed" } } });
      }
    });
  }
  close() { this.dispatchEvent(new Event("close")); }
}

beforeEach(() => {
  io.urls.length = 0; io.query.mockReset(); io.local.mockReset();
  io.starts.length = 0;
  io.inference = false; io.toolOnce = false; io.traces.length = 0; io.turns.length = 0; io.interrupts.length = 0;
  vi.stubEnv("SPECTRA_RUN_TRACE_DIR", undefined);
  vi.stubEnv("SPECTRA_AGENT_HUB_URL", undefined);
  vi.stubGlobal("WebSocket", Socket);
  io.local.mockImplementation(async (accountId: string) => ({ token: "dummy", accountId, query: `deviceId=${accountId}&generation=1` }));
});
afterEach(() => {
  const pool = Reflect.get(globalThis, "__spectraCodexConnections") as Map<string, { abandon(reason: string): void }> | undefined;
  for (const connection of pool?.values() ?? []) connection.abandon("Test complete.");
  pool?.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

it("resolves each tool-free call's account before reusing a Codex connection", async () => {
  const request = { messages: [], signal: new AbortController().signal };
  for (const accountId of ["first-owner", "second-owner", "first-owner"]) {
    io.query.mockResolvedValue({ accountId });
    await expect(subscriptionOneShot("codex", request)).rejects.toThrow("fixture stops before inference");
  }
  expect(io.urls).toHaveLength(2);
  expect(io.urls[0]).toContain("deviceId=first-owner");
  expect(io.urls[1]).toContain("deviceId=second-owner");
  expect(io.query).toHaveBeenCalledTimes(3);
  expect(io.local).toHaveBeenCalledTimes(2);
});

it("keeps an explicitly bound one-shot account/model instead of the current browser identity", async () => {
  io.query.mockResolvedValue({ accountId: "other-current-owner" });
  await expect(subscriptionOneShot("codex", { accountId: "selected-owner", model: "gpt-6-luna", messages: [],
    signal: new AbortController().signal })).rejects.toThrow("fixture stops before inference");
  expect(io.query).not.toHaveBeenCalled();
  expect(io.local).toHaveBeenCalledWith("selected-owner");
  expect(io.starts[0]?.model).toBe("gpt-6-luna");
});

it("records each reused connection's thread notifications under their own run", async () => {
  io.inference = true; vi.stubEnv("SPECTRA_RUN_TRACE_DIR", "fixture-traces");
  for (const runId of ["run-a", "run-b"]) await withRunTrace(runId, async () => {
    const caller = subscriptionModelCaller("codex", { accountId: "same-owner", model: "gpt-6-luna" });
    try {
      await expect(caller({ messages: [{ role: "user", content: "Hi" }], tools: [], toolChoice: "auto",
        signal: new AbortController().signal, onText: vi.fn(), onRetry: vi.fn() })).resolves.toMatchObject({ text: "Done" });
    } finally { caller.dispose?.(); }
  });
  expect(io.urls).toHaveLength(1);
  expect(io.traces.filter(e => e.kind === "codex" && e.method === "turn/completed").map(e => e.path.split(/[\\/]/).at(-1)))
    .toEqual(["run-a.raw.jsonl", "run-b.raw.jsonl"]);
});

it.each(["auto", "none"] as const)("offers tools only when the caller's choice is %s", async toolChoice => {
  io.inference = true;
  const tools = [{ type: "function" as const, function: { name: "look", description: "Look", parameters: { type: "object" } } }];
  const caller = subscriptionModelCaller("codex", { accountId: "owner", model: "gpt-6-luna" });
  try {
    await expect(caller({ messages: [{ role: "user", content: "Summarise" }], tools, toolChoice,
      signal: new AbortController().signal, onText: vi.fn(), onRetry: vi.fn() })).resolves.toMatchObject({ text: "Done" });
    expect(io.starts[0]?.dynamicTools).toHaveLength(toolChoice === "none" ? 0 : 1);
    expect(io.starts).toHaveLength(1);
  } finally { caller.dispose?.(); }
});

it("removes an existing CLI thread's tools for the budget summary without reopening its connection", async () => {
  io.inference = true;
  const tools = [{ type: "function" as const, function: { name: "look", description: "Look", parameters: { type: "object" } } }];
  const caller = subscriptionModelCaller("codex", { accountId: "owner", model: "gpt-6-luna" });
  const input = { tools, signal: new AbortController().signal, onText: vi.fn(), onRetry: vi.fn() };
  try {
    await caller({ ...input, messages: [{ role: "user", content: "Work" }], toolChoice: "auto" });
    await expect(caller({ ...input, messages: [{ role: "user", content: "Work" }, { role: "assistant", content: "Done" },
      { role: "user", content: "Budget reached: summarise what is done." }], toolChoice: "none" })).resolves.toMatchObject({ text: "Done" });
    expect(io.starts.map(start => start.dynamicTools)).toEqual([[{ type: "function", name: "look", description: "Look", inputSchema: { type: "object" } }], []]);
    expect(io.urls).toHaveLength(1);
    expect(io.local).toHaveBeenCalledTimes(1);
    expect(io.query).not.toHaveBeenCalled();
  } finally { caller.dispose?.(); }
});

it("finishes the real harness budget summary after an outstanding CLI tool request", async () => {
  io.inference = true; io.toolOnce = true;
  const execute = vi.fn(async () => ({ ok: true, content: "Found the notes." }));
  const caller = subscriptionModelCaller("codex", { accountId: "owner", model: "gpt-6-luna" });
  try {
    const outcome = await runHarnessLoop(emptyLoopState([{ role: "user", content: "Find the notes." }]), {
      runId: "budget-summary", callModel: caller, systemPrompt: "Use your tools.", signal: new AbortController().signal, policy: () => "allow",
      tools: [{ name: "look", description: "Look", parameters: { type: "object" }, effect: "read", label: () => "Looking", parse: raw => raw, execute }],
      budgets: { maxTurns: 1, wallClockMs: 60_000 },
    });
    expect(outcome.status).toBe("completed");
    expect(outcome.state.text).toBe("Done");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(io.starts).toHaveLength(2);
    expect(io.starts[1]?.dynamicTools).toEqual([]);
    expect(io.turns[1]?.input).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("Found the notes.") })]));
    expect(io.interrupts).toEqual([{ threadId: "thread-1", turnId: "turn-1" }]);
    expect(io.urls).toHaveLength(1);
  } finally { caller.dispose?.(); }
});

it("does not open a CLI socket after status disposal during async preflight", async () => {
  vi.useFakeTimers();
  let resolve!: (value: { token: string; accountId: string; query: string }) => void;
  io.local.mockReturnValue(new Promise(value => { resolve = value; }));
  const pending = runtimeStatus("owner");
  await vi.advanceTimersByTimeAsync(12_001);
  await pending;
  resolve({ token: "dummy", accountId: "owner", query: "deviceId=owner&generation=1" });
  await vi.runAllTimersAsync();
  expect(io.urls).toEqual([]);
});
