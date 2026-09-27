// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSettingsObservationEvent, observeUiRun, stopObservingUiRun, uiObserverForRun } from "../collaboration/settings-observation-client";
import { registerSettingsToggleControl } from "../collaboration/settings-toggle-control";
import { __resetAppChoreographyHost, getAppChoreographyCoordinator, releaseChoreographyActor, startAppChoreographyMaintenance } from "../collaboration/app-choreography-host";
import { __resetFollowAi, followAiActor, isFollowingAi } from "../collaboration/follow-ai";
import { SMART_COMPLETION_TARGET, type SettingsToggleAction, type UiObservationSnapshot } from "../actions/protocol/semantic-action";

function action(runId = "run"): SettingsToggleAction {
  return { runId, executionId: "attempt", operationId: "toggle", operationDigest: "a".repeat(64), epoch: 1, sequence: 0, kind: "settings_toggle", target: SMART_COMPLETION_TARGET, checked: false, expiresAt: Date.now() + 15_000 };
}
function identity(value: SettingsToggleAction) {
  const { runId, executionId, operationId, operationDigest, epoch, sequence } = value;
  return { runId, executionId, operationId, operationDigest, epoch, sequence };
}
function box(element: HTMLElement, top: number) {
  element.getBoundingClientRect = () => ({ x: 20, y: top, left: 20, top, right: 56, bottom: top + 20, width: 36, height: 20, toJSON: () => ({}) });
}
const disposers: Array<() => void> = [];
const snapshots = new Map<string, UiObservationSnapshot>();
const transport = vi.fn();
let stopMaintenance: () => void;

function mountedControl() {
  const element = document.createElement("button");
  element.dataset.spectraAiTarget = SMART_COMPLETION_TARGET;
  element.setAttribute("role", "switch");
  element.setAttribute("aria-checked", "true");
  document.body.append(element);
  box(element, 30);
  const refresh = vi.fn(async () => { element.setAttribute("aria-checked", "false"); });
  disposers.push(registerSettingsToggleControl(element, refresh));
  return { element, refresh };
}
function offer(value = action()) {
  const snapshot: UiObservationSnapshot = { phase: "waiting", action: value, participants: [{ ...uiObserverForRun(value.runId) }], ownerClientId: uiObserverForRun(value.runId).clientId };
  snapshots.set(value.runId, snapshot);
  handleSettingsObservationEvent({ runId: value.runId, key: "settings_toggle_prepared", payload: snapshot });
  return value;
}
function save(value: SettingsToggleAction) {
  snapshots.set(value.runId, { phase: "committed", result: {} });
  handleSettingsObservationEvent({ runId: value.runId, key: "settings_toggle_committed", payload: identity(value) });
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetAppChoreographyHost(); __resetFollowAi();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  window.history.replaceState(null, "", "/settings?section=writing");
  document.documentElement.dataset.spectraMotion = "reduced";
  snapshots.clear(); transport.mockReset();
  transport.mockImplementation(async (_url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body)) as { payload: { identity: { runId: string }; outcome?: string } };
    const snapshot = snapshots.get(body.payload.identity.runId)!;
    if (body.payload.outcome) {
      const next = { ...snapshot, phase: body.payload.outcome === "target_ready" ? "sealed" : "headless" } as UiObservationSnapshot;
      snapshots.set(body.payload.identity.runId, next);
      return { ok: true, json: async () => next };
    }
    return { ok: true, json: async () => snapshot };
  });
  vi.stubGlobal("fetch", transport);
  stopMaintenance = startAppChoreographyMaintenance();
});
afterEach(() => {
  stopObservingUiRun("run"); stopObservingUiRun("other");
  stopMaintenance();
  for (const dispose of disposers.splice(0)) dispose();
  __resetAppChoreographyHost(); __resetFollowAi();
  document.body.replaceChildren(); delete document.documentElement.dataset.spectraMotion;
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("S11 settings observer through the existing event feed", () => {
  it("ignores a prepared notification without a run or action", async () => {
    handleSettingsObservationEvent({ key: "settings_toggle_prepared", payload: { phase: "waiting" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).not.toHaveBeenCalled();
    expect(getAppChoreographyCoordinator().snapshot()).toEqual([]);
  });

  it("uses one validation read and one readiness ACK, and waits for the matching canonical result", async () => {
    const { element, refresh } = mountedControl();
    const value = offer();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
    expect(element.getAttribute("aria-checked")).toBe("true");
    save({ ...value, epoch: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).not.toHaveBeenCalled();
    save(value);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(getAppChoreographyCoordinator().snapshot()).toEqual([]);
  });

  it("skips an invisible ordinary control without navigation or animation wait", async () => {
    const { element, refresh } = mountedControl();
    box(element, 10_000);
    const url = window.location.href;
    offer();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(JSON.parse(transport.mock.calls[1]![1].body).payload.outcome).toBe("invisible");
    expect(refresh).not.toHaveBeenCalled();
    expect(window.location.href).toBe(url);
  });

  it("recovers a lost saved event from the receipt when the terminal feed cancels the performer", async () => {
    const { refresh } = mountedControl();
    offer();
    await vi.advanceTimersByTimeAsync(0);
    snapshots.set("run", { phase: "committed", result: {} });
    stopObservingUiRun("run", true);
    releaseChoreographyActor("run");
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("reevaluates visibility after approaching the control", async () => {
    delete document.documentElement.dataset.spectraMotion;
    const { element, refresh } = mountedControl();
    offer();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).toHaveBeenCalledTimes(1);
    box(element, 10_000);
    await vi.advanceTimersByTimeAsync(180);
    expect(JSON.parse(transport.mock.calls[1]![1].body).payload.outcome).toBe("invisible");
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([
    { preference: "reduced", osReduced: false },
    { preference: "none", osReduced: false },
    { preference: "full", osReduced: true },
  ])("skips the approach delay for $preference motion with OS reduction $osReduced", async ({ preference, osReduced }) => {
    document.documentElement.dataset.spectraMotion = preference;
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: osReduced })));
    mountedControl();
    const value = offer();
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(JSON.parse(transport.mock.calls[1]![1].body).payload.outcome).toBe("target_ready");
    save(value);
    await vi.advanceTimersByTimeAsync(0);
  });

  it("skips ordinary work when the tab becomes hidden during the approach", async () => {
    document.documentElement.dataset.spectraMotion = "full";
    const { refresh } = mountedControl();
    offer();
    await vi.advanceTimersByTimeAsync(0);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await vi.advanceTimersByTimeAsync(180);
    expect(JSON.parse(transport.mock.calls[1]![1].body).payload.outcome).toBe("invisible");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not enqueue a validation response arriving after the run stops", async () => {
    let completeRead!: (response: unknown) => void;
    transport.mockImplementationOnce(() => new Promise(resolve => { completeRead = resolve; }));
    mountedControl();
    offer();
    stopObservingUiRun("run");
    completeRead({ ok: true, json: async () => snapshots.get("run") });
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(getAppChoreographyCoordinator().snapshot()).toEqual([]);
  });

  it("does not resume an interest response after Stop and rediscovery of the same attempt", async () => {
    let completeInterest!: (response: unknown) => void;
    transport.mockImplementationOnce(() => new Promise(resolve => { completeInterest = resolve; }));
    observeUiRun("run", "attempt");
    await vi.advanceTimersByTimeAsync(0);
    stopObservingUiRun("run");
    observeUiRun("run", "attempt", false);
    const snapshot = { phase: "waiting", action: action(), participants: [uiObserverForRun("run")] };
    completeInterest({ ok: true, json: async () => ({ observation: snapshot }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(getAppChoreographyCoordinator().snapshot()).toEqual([]);
  });

  it("does not end the new attempt's Follow when an old interest request fails", async () => {
    let rejectInterest!: (error: Error) => void;
    transport.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectInterest = reject; }));
    followAiActor("run");
    observeUiRun("run", "attempt");
    await vi.advanceTimersByTimeAsync(0);
    observeUiRun("run", "replacement", false);
    rejectInterest(new Error("Disconnected old request"));
    await vi.advanceTimersByTimeAsync(0);
    expect(isFollowingAi()).toBe(true);
  });

  it("retires the old control callback when a replacement attempt is discovered", async () => {
    observeUiRun("run", "attempt", false);
    const { refresh } = mountedControl();
    const previous = offer();
    await vi.advanceTimersByTimeAsync(0);
    observeUiRun("run", "replacement", false);
    save(previous);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).not.toHaveBeenCalled();
    expect(getAppChoreographyCoordinator().snapshot()).toEqual([]);
  });

  it("removes an expired queued action before the other actor releases the control", async () => {
    const { refresh } = mountedControl();
    const first = offer();
    offer({ ...action("other"), expiresAt: Date.now() + 1_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(getAppChoreographyCoordinator().snapshot().map(entry => entry.status)).toEqual(["performing", "blocked"]);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(getAppChoreographyCoordinator().snapshot()).toMatchObject([{ actorId: "run", status: "performing" }]);
    save(first);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getAppChoreographyCoordinator().snapshot()).toEqual([]);
  });

  it("does not replay duplicate offers or a completed operation after reconnect", async () => {
    const { refresh } = mountedControl();
    const value = offer();
    const snapshot = snapshots.get("run")!;
    handleSettingsObservationEvent({ runId: "run", key: "settings_toggle_prepared", payload: snapshot });
    await vi.advanceTimersByTimeAsync(0);
    save(value);
    await vi.advanceTimersByTimeAsync(0);
    stopObservingUiRun("run");
    handleSettingsObservationEvent({ runId: "run", key: "settings_toggle_prepared", payload: snapshot });
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("releases a missing Follow control explicitly instead of pretending it was invisible", async () => {
    followAiActor("run");
    offer();
    await vi.advanceTimersByTimeAsync(15_050);
    const outcomes = transport.mock.calls.map((call) => JSON.parse(call[1].body).payload.outcome).filter(Boolean);
    expect(outcomes).toContain("released");
    expect(outcomes).not.toContain("invisible");
    expect(outcomes).not.toContain("target_ready");
    expect(isFollowingAi()).toBe(false);
  });

  it("serializes two actors on the same control and keeps their receipts separate", async () => {
    const { refresh } = mountedControl();
    const first = offer();
    const second = offer(action("other"));
    await vi.advanceTimersByTimeAsync(0);
    expect(getAppChoreographyCoordinator().snapshot().map(entry => entry.status)).toEqual(["performing", "blocked"]);
    save(first);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getAppChoreographyCoordinator().snapshot()).toMatchObject([{ actorId: "other", status: "performing" }]);
    save(second);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
