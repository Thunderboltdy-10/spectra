import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/*
 * A message sent while a run waits or works joins that run instead of
 * starting another, with its files; a chosen agent that cannot run is a
 * typed error, never a silent fallback to Auto.
 */

type Call = { name: string; args: Record<string, unknown> };
const calls: Call[] = [];
let joinable: unknown = null;
let agentRuntime: unknown = { agentId: "agent-1" };

vi.mock("@/lib/auth-server", () => ({ requireActor: async () => ({ clerkId: "user_1" }) }));

vi.mock("@/features/spectra/compute/files/attachment-preprocessor", () => ({
  prepareAttachments: async (input: Array<{ name?: string }> | undefined) =>
    (input ?? []).map((row) => ({ name: row.name ?? "file", mimeType: "text/plain", size: 5, handling: "text", text: "notes" })),
}));

vi.mock("./harness/attachments", () => ({
  persistRunAttachments: async (runId: string, executionId: string, input: unknown[] | undefined, prepared: unknown[], options: unknown) => {
    calls.push({ name: "persistRunAttachments", args: { runId, executionId, count: prepared.length, options } });
    return prepared.map((_, index) => `attachment-${index + 1}`);
  },
  loadRunAttachments: async () => [],
}));

vi.mock("./harness/io", async (importOriginal) => {
  const original = await importOriginal<typeof import("./harness/io")>();
  const handle = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    switch (name) {
      case "spectraHarness:joinableRun":
        return joinable;
      case "spectraArtifacts:getAgentRuntime":
        return agentRuntime;
      case "spectraHarness:queueSteer":
        return { queued: true, threadId: "thread-1" };
      case "spectraHarness:answer":
        return { alreadyAnswered: false };
      case "spectraRuns:get":
        return {
          run: { status: "queued", sourceSurface: "chat", userPrompt: "Make a deck", threadId: "thread-1", executionId: "exec-1" },
          cards: [{ _id: "card-1", runId: "run-1", status: "running", title: "Working", variant: "status", actions: [], updatedAt: 1 }],
          operations: [],
        };
      case "spectraRuns:beginRun":
        return {
          runId: "run-2",
          resultCardId: "card-2",
          card: { _id: "card-2", runId: "run-2", status: "running", title: "Working", variant: "status", actions: [], updatedAt: 1 },
          threadId: "thread-1",
          executionId: "exec-2",
          created: true,
        };
      default:
        return null;
    }
  };
  return { ...original, query: handle, mutate: handle, act: handle };
});

async function post(body: Record<string, unknown>) {
  const { handleSpectraRunRequest } = await import("./runtime");
  const response = await handleSpectraRunRequest(
    new NextRequest("http://localhost/api/spectra/run", { method: "POST", body: JSON.stringify(body) }),
  );
  const text = await response.text();
  const events = text
    .split("\n")
    .filter((line) => line.trim().startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { response, text, events };
}

const named = (name: string) => calls.filter((call) => call.name === name);
const file = { name: "notes.txt", mimeType: "text/plain", handling: "text", data: "bm90ZXM=" };

describe("a message joins the run it belongs to", () => {
  beforeEach(() => {
    calls.length = 0;
    joinable = null;
    agentRuntime = { agentId: "agent-1" };
    process.env.SPECTRA_APP_URL = "http://localhost:3999";
  });
  afterEach(() => {
    delete process.env.SPECTRA_APP_URL;
  });

  it("joins a working run at its next turn, with its files", async () => {
    joinable = { runId: "run-1", executionId: "exec-1", threadId: "thread-1", status: "running", pending: null };
    const { response, events } = await post({
      action: "run", prompt: "Also add a summary slide", surface: "chat", threadId: "thread-1", attachments: [file],
    });
    expect(response.status).toBe(200);
    expect(events).toEqual([{ type: "steer_queued", runId: "run-1", threadId: "thread-1" }]);
    expect(named("persistRunAttachments")[0]?.args).toMatchObject({ runId: "run-1", executionId: "exec-1", options: { steer: true } });
    expect(named("spectraHarness:queueSteer")[0]?.args).toMatchObject({
      runId: "run-1", executionId: "exec-1", text: "Also add a summary slide", attachmentIds: ["attachment-1"],
    });
    expect(named("spectraThreads:appendMessage")[0]?.args).toMatchObject({ metadata: { steer: true } });
    expect(named("spectraRuns:beginRun")).toHaveLength(0);
  });

  it("answers a waiting run's question with the message and adds its files to the next turn", async () => {
    joinable = { runId: "run-1", executionId: "exec-1", threadId: "thread-1", status: "awaiting_resolution", pending: { toolCallId: "ask-1", kind: "question" } };
    const { response, events } = await post({
      action: "run", prompt: "Ten slides", surface: "chat", threadId: "thread-1", attachments: [file],
    });
    expect(response.status).toBe(200);
    expect(named("spectraHarness:answer")[0]?.args).toMatchObject({ toolCallId: "ask-1", answer: { kind: "question", text: "Ten slides" } });
    expect(named("spectraHarness:queueSteer")[0]?.args).toMatchObject({ text: "", attachmentIds: ["attachment-1"] });
    expect(named("spectraRuns:scheduleExecution")[0]?.args).toMatchObject({ runId: "run-1", payload: { mode: "resume" } });
    expect(events.map((event) => event.type)).toEqual(["run_created", "thread_ready"]);
    expect(named("spectraRuns:beginRun")).toHaveLength(0);
  });

  it("declines a waiting approval and passes the message on as what to do instead", async () => {
    joinable = { runId: "run-1", executionId: "exec-1", threadId: "thread-1", status: "awaiting_confirmation", pending: { toolCallId: "call-1", kind: "approval" } };
    await post({ action: "run", prompt: "Keep the old title", surface: "chat", threadId: "thread-1" });
    expect(named("spectraHarness:answer")[0]?.args).toMatchObject({ answer: { kind: "approval", allowed: false } });
    expect(named("spectraHarness:queueSteer")[0]?.args).toMatchObject({ text: "Keep the old title" });
  });

  it("joins the run named by steerRunId even without a thread", async () => {
    joinable = { runId: "run-1", executionId: "exec-1", threadId: null, status: "running", pending: null };
    const { events } = await post({ action: "run", prompt: "Shorter", surface: "chat", steerRunId: "run-1" });
    expect(named("spectraHarness:joinableRun")[0]?.args).toMatchObject({ runId: "run-1" });
    expect(events).toEqual([{ type: "steer_queued", runId: "run-1" }]);
  });
});

describe("explicit agent choice", () => {
  beforeEach(() => {
    calls.length = 0;
    joinable = null;
    agentRuntime = { agentId: "agent-1" };
    process.env.SPECTRA_APP_URL = "http://localhost:3999";
  });
  afterEach(() => {
    delete process.env.SPECTRA_APP_URL;
  });

  it("refuses an agent the user can no longer use with a typed error", async () => {
    agentRuntime = null;
    const { response, text } = await post({ action: "run", prompt: "Help", surface: "chat", agentId: "agent-gone" });
    expect(response.status).toBe(409);
    expect(response.headers.get("X-Spectra-Error")).toBe("AI_AGENT_UNAVAILABLE");
    expect(text).toContain("switch back to Auto");
    expect(named("spectraRuns:beginRun")).toHaveLength(0);
  });

  it("starts with the chosen agent, explicitly", async () => {
    const { events } = await post({ action: "run", prompt: "Help", surface: "chat", agentId: "agent-1" });
    expect(named("spectraRuns:scheduleExecution")[0]?.args).toMatchObject({ payload: { mode: "start", agentId: "agent-1" } });
    expect(named("spectraRuns:get")).toHaveLength(0);
    expect(events.map((event) => event.type)).toEqual(["run_created", "thread_ready"]);
  });

  it("switches the thread back to Auto when agentId is null", async () => {
    await post({ action: "run", prompt: "Help", surface: "chat", threadId: "thread-1", agentId: null });
    expect(named("spectraRuns:beginRun")[0]?.args).toMatchObject({ clearRetainedAgent: true });
    expect(named("spectraArtifacts:getAgentRuntime")).toHaveLength(0);
    const payload = named("spectraRuns:scheduleExecution")[0]?.args.payload as Record<string, unknown>;
    expect(payload.agentId).toBeUndefined();
  });

  it("keeps what the user pointed at as labels for the run", async () => {
    await post({
      action: "run", prompt: "Fix this", surface: "chat",
      open: [{ id: "doc-1", type: "document", title: "Essay" }],
      selection: { text: "second paragraph", in: { id: "doc-1", type: "document", title: "Essay" } },
      references: [{ id: "deck-1", type: "presentation", title: "Deck" }],
    });
    expect(named("spectraRuns:beginRun")[0]?.args.pointers).toMatchObject({
      open: [{ id: "doc-1", type: "document", title: "Essay" }],
      selection: { text: "second paragraph" },
      references: [{ id: "deck-1" }],
    });
  });
});
