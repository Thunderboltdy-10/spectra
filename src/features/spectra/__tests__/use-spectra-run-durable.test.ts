// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpectraRun } from "../ai/use-spectra-run";
import { getSpectraRunDetail, getSpectraRunEvents, getSpectraRunTabs, type SpectraRunTab, type SpectraRunEvent } from "../data/api";
import { stopObservingUiRun } from "../collaboration/settings-observation-client";
import { spectraBus } from "../events";

vi.mock("../data/api", () => ({ getSpectraRunTabs: vi.fn(), getSpectraRunEvents: vi.fn(), getSpectraRunDetail: vi.fn(), postSpectra: vi.fn() }));
vi.mock("../settings/preference-store", () => ({ useSpectraPreferences: () => ({ preferences: { ai: { continueCurrentConversation: true } } }) }));
vi.mock("../collaboration/run-ledger", () => ({ recordRunEvent: vi.fn(), getRunLedger: vi.fn() }));
vi.mock("../collaboration/ai-ui-events", () => ({ handleSpectraAiUiEvent: vi.fn(), rememberCommittedArtifactResult: vi.fn() }));
vi.mock("../collaboration/artifact-ai-activity", () => ({ publishArtifactAiActivity: vi.fn() }));
vi.mock("sonner", () => ({ toast: { dismiss: vi.fn(), message: vi.fn(), error: vi.fn() } }));

const transport = vi.fn(async () => new Response(JSON.stringify({ error: "This observed action is no longer available." }), { status: 409 }));
function tab(status: "running" | "awaiting_resolution" = "awaiting_resolution", executionId = "attempt") {
  return { _id: "tab", runId: "run", threadId: "thread", surface: "chat", run: { _id: "run", executionId, status, userPrompt: "Tighten my notes summary", createdAt: 1, updatedAt: 2 }, thread: { _id: "thread", title: "Notes" } } as SpectraRunTab;
}
function final(sequence = 1, executionId = "attempt"): SpectraRunEvent {
  return { _id: "event", runId: "run", executionId, sequence, type: "final", createdAt: 3, payload: { type: "final", runId: "run", summary: "Choose notes or skip.", card: { id: "card", runId: "run", status: "awaiting_resolution", title: "Choose notes", variant: "status", actions: [], updatedAt: 3 } } };
}
function source(current: SpectraRunTab, rows: SpectraRunEvent[]) {
  vi.mocked(getSpectraRunTabs).mockResolvedValue({ runTabs: [current] });
  vi.mocked(getSpectraRunEvents).mockImplementation(async (_runId, after = 0) => ({ events: rows.filter((row) => row.sequence > after) }));
  vi.mocked(getSpectraRunDetail).mockResolvedValue({ run: current.run } as Awaited<ReturnType<typeof getSpectraRunDetail>>);
}
const refresh = vi.fn(async () => { spectraBus.emit("threads.changed", {}); });
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal("fetch", transport);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => { cleanup(); stopObservingUiRun("run"); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function settle(milliseconds = 20) { await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); }); }

describe("Durable run event consumption", () => {
  it("consumes a clarification final once even when refreshing the thread triggers another poll", async () => {
    source(tab(), [final()]);
    const onFinal = vi.fn();
    renderHook(() => useSpectraRun({ surface: "chat", threadId: "thread", onDataChanged: refresh, onFinal }));
    await settle();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(getSpectraRunEvents).toHaveBeenCalledTimes(1);
  });
  it("does not let a prior clarification final stop a resumed attempt or replay its reply", async () => {
    source(tab("running", "resumed"), [final(1, "asking"), { _id: "progress", runId: "run", executionId: "resumed", sequence: 2, type: "text_replace", createdAt: 4, payload: { type: "text_replace", runId: "run", content: "Continuing after skip." } }]);
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpectraRun({ surface: "chat", threadId: "thread", onFinal }));
    await settle();
    expect(onFinal).not.toHaveBeenCalled();
    expect(result.current.liveExchange?.content).toBe("Continuing after skip.");
    expect(transport).toHaveBeenCalledTimes(1);
    spectraBus.emit("threads.changed", {});
    await settle();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getSpectraRunEvents).mock.calls.at(-1)?.[1]).toBe(2);
  });
  it("refreshes a lagging attempt once without dropping its newly arrived events", async () => {
    const cached = tab("running", "asking");
    const current = tab("running", "resumed");
    const rows = [final(1, "asking"), { _id: "progress", runId: "run", executionId: "resumed", sequence: 2, type: "text_replace", createdAt: 4, payload: { type: "text_replace", runId: "run", content: "Resumed reply." } }];
    source(cached, rows);
    vi.mocked(getSpectraRunDetail).mockResolvedValue({ run: current.run } as Awaited<ReturnType<typeof getSpectraRunDetail>>);
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpectraRun({ surface: "chat", threadId: "thread", onFinal }));
    await settle();
    expect(onFinal).not.toHaveBeenCalled();
    expect(result.current.liveExchange?.content).toBe("Resumed reply.");
    expect(getSpectraRunDetail).toHaveBeenCalledTimes(1);
    rows.push({ _id: "next", runId: "run", executionId: "resumed", sequence: 3, type: "text_delta", createdAt: 5, payload: { type: "text_delta", runId: "run", content: " More." } });
    await settle(750);
    expect(result.current.liveExchange?.content).toBe("Resumed reply. More.");
    expect(getSpectraRunDetail).toHaveBeenCalledTimes(1);
  });
  it("retains a final cursor when React recreates the polling effect", async () => {
    source(tab(), [final()]);
    const first = vi.fn(); const replacement = vi.fn();
    const { rerender } = renderHook(({ onFinal }) => useSpectraRun({ surface: "chat", threadId: "thread", onFinal }), { initialProps: {onFinal: first} });
    await settle();
    expect(first).toHaveBeenCalledTimes(1);
    rerender({onFinal: replacement});
    await settle();
    expect(replacement).not.toHaveBeenCalled();
    expect(getSpectraRunEvents).toHaveBeenCalledTimes(1);
  });

  it("discovers a new attempt after a settled clarification without replaying its final", async () => {
    const rows = [final()];
    source(tab(), rows);
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpectraRun({ surface: "chat", threadId: "thread", onFinal }));
    await settle();
    expect(onFinal).toHaveBeenCalledTimes(1);
    source(tab("running", "resumed"), rows);
    rows.push({ _id: "resumed", runId: "run", executionId: "resumed", sequence: 2, type: "text_replace", createdAt: 4, payload: { type: "text_replace", runId: "run", content: "Skipped the choice." } });
    spectraBus.emit("threads.changed", {});
    await settle();
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(result.current.liveExchange?.content).toBe("Skipped the choice.");
    expect(vi.mocked(getSpectraRunEvents).mock.calls.at(-1)?.[1]).toBe(1);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each(["skip", "notes"])("hands an acknowledged %s continuation to fresh durable polling without reload", async (choiceKey) => {
    const asking = tab(); const askingRows = [final()];
    source(asking, askingRows);
    const onFinal = vi.fn();
    const { result } = renderHook(() => useSpectraRun({ surface: "chat", threadId: "thread", onDataChanged: refresh, onFinal }));
    await settle();
    const continued = { ...tab("running", "continuing"), runId: "continued", run: { ...tab("running", "continuing").run, _id: "continued" } };
    const reply = { ...final(1, "continuing"), runId: "continued", payload: { ...final().payload, runId: "continued", summary: "Continuation finished.", card: { ...(final().payload.card as Record<string, unknown>), runId: "continued", status: "completed" } } };
    vi.mocked(getSpectraRunTabs).mockImplementation(async (options) => ({ runTabs: [options?.force ? continued : asking] }));
    vi.mocked(getSpectraRunEvents).mockImplementation(async (runId, after = 0) => ({ events: runId === "continued" ? (after < 1 ? [reply] : []) : askingRows.filter(row => row.sequence > after) }));
    transport.mockImplementation(async (_url?: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.action === "run") return new Response(JSON.stringify({ type: "run_created", runId: "continued", card: { id: "continued-card", runId: "continued", status: "queued", title: "Getting ready", variant: "status", actions: [], updatedAt: 4 } }) + "\n");
      return new Response("{}", { status: 409 });
    });
    await act(async () => {
      await result.current.run("Continue after clarification.", [], {threadId: "thread", clarificationId: "clarification", choiceKey, choiceMessageId: "message", executionId: "attempt"});
    });
    await settle(750);
    expect(onFinal).toHaveBeenCalledWith(expect.objectContaining({runId: "continued", summary: "Continuation finished."}));
    expect(result.current.liveExchange).toBeNull();
    expect(result.current.submitting).toBe(false);
  });
  it("keeps Stop available after acknowledgement while the durable snapshot is in flight", async () => {
    source(tab(), [final()]);
    const { result } = renderHook(() => useSpectraRun({ surface: "chat", threadId: "thread" }));
    await settle();
    vi.mocked(getSpectraRunTabs).mockImplementation(() => new Promise(() => {}));
    transport.mockImplementation(async (_url?: unknown, init?: RequestInit) => {
      if (JSON.parse(String(init?.body)).action === "run") return new Response(JSON.stringify({type: "run_created", runId: "continued", card: {id:"continued-card",runId:"continued",status:"queued",title:"Getting ready",variant:"status",actions:[],updatedAt:4}}) + "\n");
      return new Response("{}", {status:409});
    });
    await act(async () => { await result.current.run("Continue.", [], {threadId:"thread"}); });
    await settle();
    expect(result.current.submitting).toBe(true);
    expect(result.current.activeRunId).toBe("continued");
  });

  it("clears the provisional exchange when a continuation is rejected before acknowledgement", async () => {
    source(tab(), [final()]);
    const { result } = renderHook(() => useSpectraRun({ surface: "chat", threadId: "thread" }));
    await settle();
    transport.mockImplementation(async () => new Response("This continuation is no longer available.", {status:409}));
    let accepted = true;
    await act(async () => { accepted = await result.current.run("Continue.", [], {threadId:"thread"}); });
    expect(accepted).toBe(false);
    expect(result.current.submitting).toBe(false);
    expect(result.current.liveExchange).toBeNull();
  });

});
