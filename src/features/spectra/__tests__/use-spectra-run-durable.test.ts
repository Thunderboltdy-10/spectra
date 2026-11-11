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
function tab(status: "running" | "awaiting_resolution" | "awaiting_confirmation" = "awaiting_resolution", executionId = "attempt") {
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

function approvalEvents(): SpectraRunEvent[] {
  const card = { id: "approval", runId: "run", status: "awaiting_confirmation", title: "Approve calendar.schedule", variant: "operation", actions: [{ key: "confirm", label: "Apply changes" }], updatedAt: 3 };
  return [
    { ...final(), type: "confirmation_required", payload: { type: "confirmation_required", runId: "run", reasons: ["Confirmation required"], card } },
    { ...final(2), type: "result_card", payload: { type: "result_card", runId: "run", card: { ...card, id: "work", title: "Revise chemistry", variant: "artifact" } } },
  ];
}

const refresh = vi.fn(async () => { spectraBus.emit("threads.changed", {}); });
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal("fetch", transport);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});
afterEach(() => { cleanup(); stopObservingUiRun("run"); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function settle(milliseconds = 20) { await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); }); }

describe("Durable run event consumption", () => {
  it.each([
    { kind: "approval" as const, value: { kind: "approval" as const, allowed: true }, label: "Allowed" },
    { kind: "approval" as const, value: { kind: "approval" as const, allowed: false }, label: "Not allowed" },
    { kind: "question" as const, value: { kind: "question" as const, text: "Physics" }, label: "Physics" },
  ])("shares a $label resume with its paused owner when the prelude is a result card", async ({ kind, value, label }) => {
    const waiting = tab(kind === "approval" ? "awaiting_confirmation" : "awaiting_resolution");
    source({ ...waiting, surface: "artifact", run: { ...waiting.run, artifactId: "artifact" } }, []);
    const approval = { id: "card", runId: "run", status: waiting.run.status, title: "Needs your input", variant: "status", actions: [{ key: "confirm", label: "Allow" }], updatedAt: 3 };
    const input = { kind, toolCallId: "write", executionId: "attempt", question: "Change the Word file?" };
    transport.mockImplementation(async (_url?: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const events = body.action === "run"
        ? [{ type: "run_created", runId: "run", card: approval }, { type: "input_required", runId: "run", input, card: approval }]
        : [{ type: "result_card", runId: "run", card: approval }, { type: "input_answered", runId: "run", toolCallId: "write", label },
          { type: "final", runId: "run", summary: "Saved", card: { ...approval, status: "completed", title: "Done", actions: [], updatedAt: 4 } }];
      return new Response(events.map(event => JSON.stringify(event)).join("\n") + "\n");
    });
    const owner = renderHook(() => useSpectraRun({ surface: "artifact", artifactId: "artifact" }));
    const answerer = renderHook(() => useSpectraRun({ surface: "chat", threadId: "thread", observeDurableRuns: false }));
    await settle();
    await act(async () => { await owner.result.current.run("Summarise this Word file"); });
    await settle();
    expect(owner.result.current.liveExchange?.input).toMatchObject({ kind });
    vi.mocked(getSpectraRunEvents).mockClear();
    await act(async () => { expect(await answerer.result.current.answer("run", "write", value)).toBe(true); });
    await settle();
    expect.soft(owner.result.current.liveExchange).toBeNull();
    expect.soft(owner.result.current.cards).toContainEqual(expect.objectContaining({ id: "card", status: "completed", actions: [] }));
    expect.soft(getSpectraRunEvents).not.toHaveBeenCalled();
  });

  it.each([{}, { artifactId: "artifact" }, { workspaceId: "workspace" }])("does not discover other conversations for a new chat with context %j", async (context) => {
    const foreign = { ...tab("awaiting_confirmation"), run: { ...tab("awaiting_confirmation").run, artifactId: "artifact" }, workspaceId: "workspace" };
    source(foreign, approvalEvents());
    const { result } = renderHook(() => useSpectraRun({ surface: "chat", ...context }));
    await settle();
    expect(result.current.cards).toEqual([]);
    expect(result.current.liveExchange).toBeNull();
    expect(getSpectraRunTabs).not.toHaveBeenCalled();
    expect(getSpectraRunEvents).not.toHaveBeenCalled();
  });

  it("leaves another thread's approval behind when switching to a new chat", async () => {
    source(tab(), [final()]);
    const { result, rerender } = renderHook(({ threadId }) => useSpectraRun({ surface: "chat", threadId }),
      { initialProps: { threadId: "thread" as string | undefined } });
    await settle();
    expect(result.current.cards).toHaveLength(1);
    const foreign = { ...tab("running", "other-attempt"), runId: "other-run", threadId: "other-thread" };
    source(foreign, [{ ...final(1, "other-attempt"), runId: "other-run", payload: { ...final().payload, runId: "other-run" } }]);
    vi.mocked(getSpectraRunTabs).mockClear();
    vi.mocked(getSpectraRunEvents).mockClear();
    rerender({ threadId: undefined });
    await settle();
    expect(result.current.cards).toEqual([]);
    expect(result.current.liveExchange).toBeNull();
    expect(getSpectraRunTabs).not.toHaveBeenCalled();
    expect(getSpectraRunEvents).not.toHaveBeenCalled();
  });

  it("clears observed progress when leaving a running conversation for a new chat", async () => {
    source(tab("running"), [{ ...final(), type: "text_replace", payload: { type: "text_replace", runId: "run", content: "Working on another conversation." } }]);
    const { result, rerender } = renderHook(({ threadId }) => useSpectraRun({ surface: "chat", threadId }),
      { initialProps: { threadId: "thread" as string | undefined } });
    await settle();
    expect(result.current.liveExchange?.threadId).toBe("thread");
    rerender({ threadId: undefined });
    await settle();
    expect(result.current.liveExchange).toBeNull();
    expect(result.current.submitting).toBe(false);
    expect(result.current.activeRunId).toBeFalsy();
  });

  it.each(["artifact", "workspace"] as const)("retains durable %s recovery outside a conversation", async (surface) => {
    source({ ...tab("awaiting_confirmation"), surface, workspaceId: "workspace", run: { ...tab("awaiting_confirmation").run, artifactId: "artifact" } }, approvalEvents());
    const { result } = renderHook(() => useSpectraRun({ surface, artifactId: surface === "artifact" ? "artifact" : undefined,
      workspaceId: surface === "workspace" ? "workspace" : undefined }));
    await settle();
    expect(result.current.cards.map(card => card.id)).toEqual(["approval", "work"]);
  });

  it("recovers only the newly acknowledged conversation before its parent adopts the thread", async () => {
    source(tab("running"), [final()]);
    transport.mockImplementation(async (_url?: unknown, init?: RequestInit) => {
      if (JSON.parse(String(init?.body)).action !== "run") return new Response("{}", { status: 409 });
      return new Response([
        { type: "run_created", runId: "run", card: { id: "card", runId: "run", status: "queued", title: "Getting ready", variant: "status", actions: [], updatedAt: 1 } },
        { type: "thread_ready", runId: "run", threadId: "thread" },
      ].map(event => JSON.stringify(event)).join("\n") + "\n");
    });
    const onThreadReady = vi.fn();
    const { result } = renderHook(() => useSpectraRun({ surface: "chat", onThreadReady }));
    await settle();
    await act(async () => { await result.current.run("A new request", [], { threadId: null }); });
    await settle();
    expect(onThreadReady).toHaveBeenCalledWith("thread");
    expect(getSpectraRunTabs).toHaveBeenLastCalledWith(expect.objectContaining({ threadId: "thread" }));
    expect(result.current.cards).toContainEqual(expect.objectContaining({ title: "Choose notes" }));
  });

  it.each(["failed", "cancelled"] as const)("reconciles a saved %s run after its first cursor reads fail", async (status) => {
    source(tab("running"), []);
    vi.mocked(getSpectraRunEvents).mockRejectedValue(new Error("INTERNAL_ERROR"));
    transport.mockImplementation(async (_url?: unknown, init?: RequestInit) => {
      if (JSON.parse(String(init?.body)).action === "run") return new Response(JSON.stringify({ type: "run_created", runId: "run", card: { id: "card", runId: "run", status: "queued", title: "Getting ready", variant: "status", actions: [], updatedAt: 2 } }) + "\n");
      return new Response("{}", { status: 409 });
    });
    const onFinal = vi.fn();
    const onDataChanged = vi.fn();
    const { result } = renderHook(() => useSpectraRun({ surface: "chat", threadId: "thread", onDataChanged, onFinal }));
    await settle();
    await act(async () => { await result.current.run("Hi", [], { threadId: "thread" }); });
    await settle();
    expect(result.current.submitting).toBe(true);
    expect(result.current.liveExchange?.runId).toBe("run");
    expect(getSpectraRunEvents).toHaveBeenCalled();
    const stopped: SpectraRunTab = { ...tab("running"), run: { ...tab("running").run, status, updatedAt: 10 }, card: { _id: "card", runId: "run", status, title: "Run interrupted", variant: "status", actions: [{ key: "retry", label: "Retry", targetType: "run", targetId: "run" }], createdAt: 1, updatedAt: 10 } };
    vi.mocked(getSpectraRunTabs).mockResolvedValue({ runTabs: [stopped] });
    spectraBus.emit("threads.changed", {});
    await settle();
    expect(result.current.submitting).toBe(false);
    expect(result.current.liveExchange).toBeNull();
    expect(result.current.cards).toContainEqual(expect.objectContaining({ status, title: "Run interrupted", actions: [expect.objectContaining({ key: "retry" })] }));
    expect(onDataChanged).toHaveBeenCalledTimes(1);
    expect(onFinal).not.toHaveBeenCalled();
    spectraBus.emit("threads.changed", {});
    await settle();
    expect(onDataChanged).toHaveBeenCalledTimes(1);
  });

  it("keeps a local retry stream authoritative over a lagging failed snapshot", async () => {
    source(tab("running", "retrying"), []);
    let closeStream!: () => void;
    transport.mockImplementation(async (_url?: unknown, init?: RequestInit) => {
      if (JSON.parse(String(init?.body)).action !== "run") return new Response("{}", { status: 409 });
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ type: "run_created", runId: "run", card: { id: "card", runId: "run", status: "running", title: "Retrying", variant: "status", actions: [], updatedAt: 20 } }) + "\n"));
        closeStream = () => controller.close();
      } }));
    });
    const { result } = renderHook(() => useSpectraRun({ surface: "chat", threadId: "thread" }));
    await settle();
    let pending!: Promise<boolean>;
    await act(async () => { pending = result.current.run("Continue", [], { threadId: "thread" }); });
    await settle();
    const stale: SpectraRunTab = { ...tab("running", "old"), run: { ...tab("running", "old").run, status: "failed" } };
    vi.mocked(getSpectraRunTabs).mockResolvedValue({ runTabs: [stale] });
    spectraBus.emit("threads.changed", {});
    await settle();
    expect(result.current.submitting).toBe(true);
    expect(result.current.liveExchange?.runId).toBe("run");
    expect(result.current.cards[0]?.title).toBe("Retrying");
    vi.mocked(getSpectraRunTabs).mockResolvedValue({ runTabs: [tab("running", "retrying")] });
    await act(async () => { closeStream(); await pending; });
  });

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
    await settle(4_000);
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

  it("shows a run stopped from another view as stopped, never Working again (F09)", async () => {
    source(tab("running"), []);
    let push!: (event: object) => void;
    transport.mockImplementation(async (_url?: unknown, init?: RequestInit) => {
      if (JSON.parse(String(init?.body)).action !== "run") return new Response("{}", { status: 409 });
      return new Response(new ReadableStream({ start(controller) {
        push = (event) => controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n"));
        push({ type: "run_created", runId: "run", card: { id: "card", runId: "run", status: "running", title: "Getting ready", variant: "status", actions: [], updatedAt: 1 } });
      } }));
    });
    const running = { _id: "card", runId: "run", status: "running", title: "Working", summary: "", variant: "status", actions: [], updatedAt: 1 };
    const { result, rerender } = renderHook(({ cards }) => useSpectraRun({ surface: "chat", threadId: "thread", initialCards: cards as never }), { initialProps: { cards: [running] } });
    await settle();
    await act(async () => { void result.current.run("Derive the standing wave equation", [], { threadId: "thread" }); });
    await settle();
    expect(result.current.liveExchange?.runId).toBe("run");
    rerender({ cards: [{ ...running, status: "cancelled", title: "Stopped", updatedAt: 2 }] });
    await settle();
    expect(result.current.liveExchange?.status).toBe("stopped");
    // A late progress event from the same stream does not bring it back.
    await act(async () => { push({ type: "progress", runId: "run", title: "Creating Standing Waves" }); });
    await settle();
    expect(result.current.liveExchange?.status).toBe("stopped");
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
