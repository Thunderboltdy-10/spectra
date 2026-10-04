// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpectraRun } from "../ai/use-spectra-run";
import { getSpectraRunDetail, getSpectraRunEvents, getSpectraRunTabs } from "../data/api";

vi.mock("../data/api", () => ({ getSpectraRunTabs: vi.fn(), getSpectraRunEvents: vi.fn(), getSpectraRunDetail: vi.fn(), postSpectra: vi.fn() }));
vi.mock("../settings/preference-store", () => ({ useSpectraPreferences: () => ({ preferences: { ai: { continueCurrentConversation: true } } }) }));
vi.mock("../collaboration/run-ledger", () => ({ recordRunEvent: vi.fn(), getRunLedger: vi.fn() }));
vi.mock("../collaboration/ai-ui-events", () => ({ handleSpectraAiUiEvent: vi.fn(), rememberCommittedArtifactResult: vi.fn() }));
vi.mock("../collaboration/artifact-ai-activity", () => ({ publishArtifactAiActivity: vi.fn() }));
vi.mock("sonner", () => ({ toast: { dismiss: vi.fn(), message: vi.fn(), error: vi.fn() } }));

type Sent = Record<string, unknown>;
const sent: Sent[] = [];
let respond: (body: Sent) => Response = () => new Response("{}", { status: 409 });
const transport = vi.fn(async (_url?: unknown, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body)) as Sent;
  sent.push(body);
  return respond(body);
});
const ndjson = (events: unknown[]) => new Response(events.map((event) => JSON.stringify(event)).join("\n") + "\n");
const card = { id: "card", runId: "run", status: "queued", title: "Working", variant: "status", actions: [], updatedAt: 1 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  sent.length = 0;
  vi.stubGlobal("fetch", transport);
  vi.mocked(getSpectraRunTabs).mockResolvedValue({ runTabs: [] });
  vi.mocked(getSpectraRunEvents).mockResolvedValue({ events: [] });
  vi.mocked(getSpectraRunDetail).mockResolvedValue({ run: { _id: "run", executionId: "attempt", status: "running", threadId: "thread", userPrompt: "", createdAt: 1, updatedAt: 1 } } as unknown as Awaited<ReturnType<typeof getSpectraRunDetail>>);
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function settle(milliseconds = 20) { await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); }); }

describe("the run request", () => {
  it("names what is open, the selection, the references and the agent, and nothing else about context", async () => {
    respond = () => ndjson([{ type: "run_created", runId: "run", card }]);
    const open = [{ id: "doc-1", type: "document", title: "Cell notes" }];
    const { result } = renderHook(() => useSpectraRun({ surface: "chat", open, selection: { text: "mitosis", in: open[0] } }));
    await act(async () => {
      await result.current.run("Explain this", [], {
        threadId: null,
        references: [{ id: "deck-1", type: "presentation", title: "Biology deck" }],
        agentId: "agent-1",
      });
    });
    const body = sent.find((row) => row.action === "run")!;
    expect(body).toMatchObject({
      open,
      selection: { text: "mitosis", in: open[0] },
      references: [{ id: "deck-1", type: "presentation", title: "Biology deck" }],
      agentId: "agent-1",
    });
    for (const gone of ["focusMode", "selectedArtifactIds", "explicitContextObjects"]) expect(body).not.toHaveProperty(gone);
  });

  it("sends agentId null to switch back to Auto, and leaves it out to keep the thread's choice", async () => {
    respond = () => ndjson([{ type: "run_created", runId: "run", card }]);
    const { result } = renderHook(() => useSpectraRun({ surface: "chat" }));
    await act(async () => { await result.current.run("Back to auto", [], { threadId: "thread", agentId: null }); });
    await act(async () => { await result.current.run("Keep going", [], { threadId: "thread" }); });
    const runs = sent.filter((row) => row.action === "run");
    expect(runs[0]).toHaveProperty("agentId", null);
    expect(runs[1]).not.toHaveProperty("agentId");
  });

  it("accepts a message that joined a working run, without starting a new run", async () => {
    respond = () => ndjson([{ type: "steer_queued", runId: "run", threadId: "thread" }]);
    const { result } = renderHook(() => useSpectraRun({ surface: "chat", threadId: "thread" }));
    let accepted = false;
    await act(async () => { accepted = await result.current.run("Also add a summary", [], { threadId: "thread" }); });
    await settle();
    expect(accepted).toBe(true);
    expect(result.current.cards.some((row) => row.id.startsWith("optimistic:"))).toBe(false);
  });
});

describe("steering a working run", () => {
  const file = { id: "file-1", name: "notes.pdf", mimeType: "application/pdf", size: 10, handling: "pdf" as const, data: "AA==" };

  it("sends the message and its files to the run in one request", async () => {
    respond = (body) => body.action === "steer" ? new Response(JSON.stringify({ queued: true })) : new Response("{}", { status: 409 });
    const { result } = renderHook(() => useSpectraRun({ surface: "chat", threadId: "thread" }));
    let accepted = false;
    await act(async () => { accepted = await result.current.steer("run", "Use this too", [file]); });
    expect(accepted).toBe(true);
    const steer = sent.find((row) => row.action === "steer")!;
    expect(steer).toMatchObject({ runId: "run", executionId: "attempt", text: "Use this too", attachments: [expect.objectContaining({ id: "file-1" })] });
    expect(sent.some((row) => row.action === "stop")).toBe(false);
  });

  it("sends the message as a new turn of the run's thread when the run waits or has finished", async () => {
    respond = (body) => body.action === "steer"
      ? new Response("This run is waiting for an answer.", { status: 409 })
      : ndjson([{ type: "run_created", runId: "run", card }]);
    const { result } = renderHook(() => useSpectraRun({ surface: "chat", threadId: "thread" }));
    await act(async () => { await result.current.steer("run", "Genetics", [file]); });
    const run = sent.find((row) => row.action === "run")!;
    expect(run).toMatchObject({ prompt: "Genetics", threadId: "thread", steerRunId: "run", attachments: [expect.objectContaining({ id: "file-1" })] });
    expect(sent.some((row) => row.action === "stop")).toBe(false);
  });
});
