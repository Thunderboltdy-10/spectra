import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/*
 * First visible output for "hello", measured at unit level: every Convex
 * call, the collaboration read and the model are mocked with realistic
 * delays (fake timers, so the numbers are exact and repeatable). The clock
 * starts when the request arrives and stops when the first text delta
 * reaches the open client's stream. The report holds the critical path.
 */

const DELAYS: Record<string, number> = {
  "auth:requireActor": 30,
  "spectraThreads:getActiveExecution": 60,
  "spectraHarness:load": 60,
  "spectraArtifacts:get": 70,
  "spectraRuns:beginRun": 150,
  "spectraRuns:get": 60,
  "spectraRuns:claimExecution": 90,
  "spectraArtifacts:listAgentRoutingDescriptors": 80,
  "spectraThreads:getSummary": 50,
  "accountPreferences:layers": 50,
  "identity:me": 50,
  "spectraThreads:listMessages": 80,
  // An action that embeds the prompt through OpenRouter, then searches.
  "memory:contextForRun": 500,
  "memory:listMine": 70,
  "bridge:devices": 40,
  "collab:readLive": 350,
  "clerk:getSessionList": 150,
  "clerk:getToken": 150,
  "spectraRuns:listRunAttachments": 60,
  "spectraHarness:joinableRun": 60,
};
const DEFAULT_QUERY_MS = 60;
const DEFAULT_MUTATION_MS = 90;
const MODEL_FIRST_TOKEN_MS = 700;
// Auth, beginRun, then the claim and every read together.
const MODEL_START_BUDGET_MS = 300;

const calls: Array<{ name: string; at: number }> = [];
let clockStart = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function record(name: string) {
  calls.push({ name, at: Date.now() - clockStart });
}

function result(name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case "spectraRuns:beginRun":
      return {
        runId: "run-1",
        resultCardId: "card-1",
        card: { _id: "card-1", runId: "run-1", status: "running", title: "Working", variant: "status", actions: [], updatedAt: 1 },
        threadId: "thread-1",
        executionId: "exec-1",
        created: true,
        workspaceId: "ws-1",
      };
    case "spectraRuns:get":
      return {
        run: { status: "running", sourceSurface: "chat", userPrompt: "hello", threadId: "thread-1", executionId: "exec-1" },
        cards: [{ _id: "card-1", runId: "run-1", status: "running", title: "Working", variant: "status", actions: [], updatedAt: 1 }],
        operations: [],
      };
    case "spectraArtifacts:get":
      return {
        _id: args.artifactId,
        blueprintKey: "document",
        title: "Cells",
        capabilities: ["read", "modify"],
        content: { markdown: "# Cells" },
        placements: [{ workspaceId: "ws-1", workspaceTitle: "Biology" }],
      };
    case "spectraArtifacts:listAgentRoutingDescriptors":
    case "spectraThreads:listMessages":
      return name === "spectraThreads:listMessages" ? { messages: [] } : [];
    case "spectraThreads:getActiveExecution":
      return { run: null };
    case "spectraThreads:getSummary":
      return { needsTitle: false };
    case "accountPreferences:layers":
      return [];
    case "identity:me":
      return { name: "Ada", schoolRole: "student" };
    case "memory:contextForRun":
      return { text: "" };
    case "memory:listMine":
      return { claims: [] };
    case "bridge:devices":
      return [];
    case "spectraHarness:saveCheckpoint":
      return { steers: [], active: true };
    case "spectraRuns:heartbeat":
      return { alive: true };
    case "spectraRuns:listRunAttachments":
      return [];
    default:
      return null;
  }
}

vi.mock("@/lib/auth-server", () => ({
  requireActor: async () => {
    await sleep(DELAYS["auth:requireActor"]!);
    return { clerkId: "user_1" };
  },
}));

vi.mock("@clerk/backend", () => ({
  createClerkClient: () => ({
    sessions: {
      getSessionList: async () => {
        record("clerk:getSessionList");
        await sleep(DELAYS["clerk:getSessionList"]!);
        return { data: [{ id: "sess_1", lastActiveAt: 1 }] };
      },
      getToken: async () => {
        record("clerk:getToken");
        await sleep(DELAYS["clerk:getToken"]!);
        return { jwt: "token" };
      },
    },
  }),
}));

vi.mock("./io", async (importOriginal) => {
  const original = await importOriginal<typeof import("./io")>();
  const call = (fallback: number) => async (name: string, args: Record<string, unknown>) => {
    record(name);
    await sleep(DELAYS[name] ?? fallback);
    return result(name, args);
  };
  const mutate = async (name: string, args: Record<string, unknown>) => {
    const value = await call(DEFAULT_MUTATION_MS)(name, args);
    // A scheduled run's output reaches the client through the durable event log.
    if (name === "spectraRuns:appendEvents" && JSON.stringify(args.events ?? []).includes('"text_delta"')) record("durable:first_text");
    return value;
  };
  return { ...original, query: call(DEFAULT_QUERY_MS), mutate, act: call(DEFAULT_MUTATION_MS) };
});

vi.mock("@/features/spectra/ai/yjs-artifact-operation", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/spectra/ai/yjs-artifact-operation")>();
  return {
    ...original,
    readLiveArtifactValue: async () => {
      record("collab:readLive");
      await sleep(DELAYS["collab:readLive"]!);
      return null;
    },
  };
});

vi.mock("@/features/spectra/ai/harness/model", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/spectra/ai/harness/model")>();
  return {
    ...original,
    openRouterModelCaller: async ({ onText }: { onText: (delta: string) => void }) => {
      record("model:call");
      await sleep(MODEL_FIRST_TOKEN_MS);
      onText("Hi!");
      await sleep(100);
      return { text: "Hi!", toolCalls: [] };
    },
    callSpectraModel: async () => {
      await sleep(300);
      return { text: '{"title":"Greeting"}', toolCalls: [] };
    },
    spectraModelContextWindow: async () => 200_000,
  };
});

async function firstOutputMs(body: Record<string, unknown>) {
  const { handleSpectraRunRequest } = await import("../runtime");
  calls.length = 0;
  clockStart = Date.now();
  const request = new NextRequest("http://localhost/api/spectra/run", { method: "POST", body: JSON.stringify(body) });
  let response: Response | undefined;
  void handleSpectraRunRequest(request).then((value) => {
    response = value;
  });
  while (!response) await vi.advanceTimersByTimeAsync(1);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let firstText: number | undefined;
  void (async () => {
    while (firstText === undefined) {
      const chunk = await reader.read();
      if (chunk.done) return;
      buffer += decoder.decode(chunk.value, { stream: true });
      for (const line of buffer.split("\n").slice(0, -1)) {
        const event = JSON.parse(line) as { type?: string };
        if (event.type === "text_delta" && firstText === undefined) firstText = Date.now() - clockStart;
      }
      buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
    }
  })();
  while (firstText === undefined && Date.now() - clockStart < 10_000) await vi.advanceTimersByTimeAsync(1);
  await reader.cancel().catch(() => undefined);
  const modelAt = calls.find((entry) => entry.name === "model:call")?.at;
  return { firstText: firstText ?? Number.POSITIVE_INFINITY, modelAt, calls: [...calls] };
}

async function scheduledFirstOutputMs(payload: Record<string, unknown>) {
  const { createHash, createHmac } = await import("node:crypto");
  const { handleSpectraRunRequest } = await import("../runtime");
  calls.length = 0;
  clockStart = Date.now();
  const rawBody = JSON.stringify({
    action: "scheduled_run",
    actorClerkId: "user_1",
    runId: "run-1",
    executionId: "exec-1",
    resultCardId: "card-1",
    payload,
  });
  const key = createHmac("sha256", process.env.SPECTRA_COLLAB_BRIDGE_KEY!).update("spectra-event-callback:v1").digest("base64url");
  const timestamp = Date.now();
  const digest = createHash("sha256").update(rawBody).digest("base64url");
  const signature = createHmac("sha256", key).update(`${timestamp}.${digest}`).digest("base64url");
  const request = new NextRequest("http://localhost/api/spectra/run", {
    method: "POST",
    body: rawBody,
    headers: { "x-spectra-scheduler-timestamp": String(timestamp), "x-spectra-scheduler-signature": signature },
  });
  void handleSpectraRunRequest(request);
  const durable = () => calls.find((entry) => entry.name === "durable:first_text");
  while (!durable() && Date.now() - clockStart < 10_000) await vi.advanceTimersByTimeAsync(1);
  // The event is visible once the append commits (its own delay) and the subscription pushes.
  const firstText = (durable()?.at ?? Number.POSITIVE_INFINITY) + DEFAULT_MUTATION_MS;
  return { firstText, modelAt: calls.find((entry) => entry.name === "model:call")?.at, calls: [...calls] };
}

describe("first visible output for hello", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.SPECTRA_TEST_INLINE_RUNS = "1";
    process.env.SPECTRA_COLLAB_BRIDGE_KEY = "k".repeat(40);
    process.env.CLERK_SECRET_KEY = "sk_test_latency";
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.SPECTRA_TEST_INLINE_RUNS;
    delete process.env.SPECTRA_COLLAB_BRIDGE_KEY;
    delete process.env.CLERK_SECRET_KEY;
  });

  it("new chat", async () => {
    const measured = await firstOutputMs({ action: "run", prompt: "hello", surface: "chat", timeZone: "Europe/Madrid" });
    console.info("[latency] new chat", JSON.stringify({ firstText: measured.firstText, modelAt: measured.modelAt, calls: measured.calls }));
    // Budget: one admission write and one parallel round trip before the model (HARNESS.md, Latency targets).
    expect(measured.modelAt).toBeLessThanOrEqual(MODEL_START_BUDGET_MS);
    expect(measured.firstText).toBeLessThanOrEqual(MODEL_START_BUDGET_MS + MODEL_FIRST_TOKEN_MS);
  });

  it("existing thread with a document open", async () => {
    const measured = await firstOutputMs({
      action: "run",
      prompt: "hello",
      surface: "artifact",
      threadId: "thread-1",
      artifactId: "artifact-1",
      currentView: "Editing document Cells",
      open: [{ id: "artifact-1", type: "document", title: "Cells" }],
      timeZone: "Europe/Madrid",
    });
    console.info("[latency] thread + open document", JSON.stringify({ firstText: measured.firstText, modelAt: measured.modelAt, calls: measured.calls }));
    expect(measured.modelAt).toBeLessThanOrEqual(MODEL_START_BUDGET_MS + 60);
  });

  it("scheduled worker, new chat (from the scheduler's callback)", async () => {
    // The route marks a start sent without files, so the worker skips the attachment read.
    const measured = await scheduledFirstOutputMs({ mode: "start", prompt: "hello", surface: "chat", threadId: "thread-1", timeZone: "Europe/Madrid", withAttachments: false });
    console.info("[latency] scheduled new chat", JSON.stringify({ firstText: measured.firstText, modelAt: measured.modelAt, calls: measured.calls }));
    // The scheduled hop adds Clerk; the first words are written to the log at once.
    expect(measured.firstText).toBeLessThanOrEqual(1_300);
  });

  it("scheduled worker, resumed for the same user (a known session)", async () => {
    await scheduledFirstOutputMs({ mode: "start", prompt: "hello", surface: "chat", threadId: "thread-1", timeZone: "Europe/Madrid", withAttachments: false });
    await vi.advanceTimersByTimeAsync(5_000);
    const measured = await scheduledFirstOutputMs({ mode: "resume", prompt: "hello", surface: "chat", threadId: "thread-1", timeZone: "Europe/Madrid" });
    console.info("[latency] scheduled resume, known session", JSON.stringify({ firstText: measured.firstText, modelAt: measured.modelAt, calls: measured.calls }));
    expect(measured.calls.some((entry) => entry.name === "clerk:getSessionList")).toBe(false);
    expect(measured.firstText).toBeLessThanOrEqual(1_150);
  });

  it("scheduled admission (request until the worker is scheduled)", async () => {
    delete process.env.SPECTRA_TEST_INLINE_RUNS;
    process.env.SPECTRA_APP_URL = "http://localhost:3000";
    try {
      const { handleSpectraRunRequest } = await import("../runtime");
      calls.length = 0;
      clockStart = Date.now();
      const request = new NextRequest("http://localhost/api/spectra/run", {
        method: "POST",
        body: JSON.stringify({ action: "run", prompt: "hello", surface: "chat", threadId: "thread-1", timeZone: "Europe/Madrid" }),
      });
      let done = false;
      void handleSpectraRunRequest(request).then(() => {
        done = true;
      });
      while (!done && Date.now() - clockStart < 10_000) await vi.advanceTimersByTimeAsync(1);
      const admitted = Date.now() - clockStart;
      console.info("[latency] scheduled admission", JSON.stringify({ admitted, calls }));
      expect(calls.some((entry) => entry.name === "spectraRuns:scheduleExecution")).toBe(true);
    } finally {
      delete process.env.SPECTRA_APP_URL;
    }
  });
});
