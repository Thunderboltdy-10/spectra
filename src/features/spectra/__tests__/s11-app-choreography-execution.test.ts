// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetAppChoreographyHost,
  artifactPerformerFor,
  currentViewportSnapshot,
  getAppChoreographyCoordinator,
  performAppChoreography,
  startAppChoreographyMaintenance,
  type AppPerformanceContext,
} from "../collaboration/app-choreography-host";
import { __resetFollowAi, followAiActor } from "../collaboration/follow-ai";
import { handleSpectraAiUiEvent } from "../collaboration/ai-ui-events";
import { spectraBus } from "../events";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const request = (operationId: string, actorId = "a", targetKey = "name") => ({
  actorId, operationId, target: "library" as const, targetKey, summary: "Rename folder",
});

function box(element: HTMLElement, top: number, height = 40) {
  element.getBoundingClientRect = () => ({
    x: 20, y: top, left: 20, top, right: 220, bottom: top + height, width: 200, height,
    toJSON: () => ({}),
  }) as DOMRect;
}

describe("S11 local choreography execution lifecycle", () => {
  let stopMaintenance: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    __resetAppChoreographyHost();
    __resetFollowAi();
    window.history.replaceState(null, "", "/library");
    stopMaintenance = startAppChoreographyMaintenance();
  });
  afterEach(() => {
    stopMaintenance();
    __resetAppChoreographyHost();
    __resetFollowAi();
    document.body.replaceChildren();
    window.history.replaceState(null, "", "/");
    vi.useRealTimers();
  });

  it("waits for the actual action, then starts its queued successor once", async () => {
    const firstAction = deferred();
    const secondAction = deferred();
    const input = document.createElement("input");
    document.body.append(input);
    const starts: string[] = [];
    const first = performAppChoreography(request("1"), async () => {
      starts.push("1");
      await firstAction.promise;
      input.value = "First";
    });
    const second = performAppChoreography(request("2"), async () => {
      starts.push("2");
      await secondAction.promise;
      input.value = "Second";
    });
    const duplicate = vi.fn();
    expect(performAppChoreography(request("2"), duplicate)).toBe(second);
    await vi.advanceTimersByTimeAsync(1000);
    expect(input.value).toBe("");
    expect(starts).toEqual(["1"]);
    expect(first.status).toBe("performing");
    expect(second.status).toBe("queued");
    firstAction.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(input.value).toBe("First");
    expect(starts).toEqual(["1", "2"]);
    expect(first.status).toBe("completed");
    secondAction.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(input.value).toBe("Second");
    expect(second.status).toBe("completed");
    expect(duplicate).not.toHaveBeenCalled();
    expect(getAppChoreographyCoordinator().snapshot()).toEqual([]);
  });

  it("runs separate actors on separate controls while retaining a blocked actor's FIFO", async () => {
    const gate = deferred();
    const effects: string[] = [];
    performAppChoreography(request("1", "a", "shared"), () => gate.promise);
    performAppChoreography(request("1", "b", "shared"), () => { effects.push("b1"); });
    performAppChoreography(request("2", "b", "other"), () => { effects.push("b2"); });
    performAppChoreography(request("1", "c", "independent"), () => { effects.push("c1"); });
    await vi.advanceTimersByTimeAsync(0);
    expect(effects).toEqual(["c1"]);
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(effects).toEqual(["c1", "b1", "b2"]);
  });

  it("does not label a rejected action complete and lets the next action recover", async () => {
    const failing = deferred();
    const first = performAppChoreography(request("1"), () => failing.promise);
    const recovered = vi.fn();
    const next = performAppChoreography(request("2"), recovered);
    await vi.advanceTimersByTimeAsync(0);
    failing.reject(new Error("Control detached"));
    await vi.advanceTimersByTimeAsync(0);
    expect(first).toMatchObject({ status: "failed", reason: "Control detached" });
    expect(next.status).toBe("completed");
    expect(recovered).toHaveBeenCalledOnce();
  });

  it("cancels an expired performer and ignores its late acknowledgement", async () => {
    const old = deferred();
    const replacement = deferred();
    let oldSignal!: AbortSignal;
    const first = performAppChoreography(request("same"), ({ signal }) => {
      oldSignal = signal;
      return old.promise;
    });
    await vi.advanceTimersByTimeAsync(8100);
    expect(first.status).toBe("cancelled");
    expect(oldSignal.aborted).toBe(true);
    const second = performAppChoreography(request("same"), () => replacement.promise);
    await vi.advanceTimersByTimeAsync(0);
    old.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(second.status).toBe("performing");
    replacement.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(second.status).toBe("completed");
  });

  it("unmount cancels local callbacks and queued work without replaying them on remount", async () => {
    const gate = deferred();
    let context!: AppPerformanceContext;
    const first = performAppChoreography(request("1"), (value) => { context = value; return gate.promise; });
    const queued = vi.fn();
    const second = performAppChoreography(request("2"), queued);
    await vi.advanceTimersByTimeAsync(0);
    stopMaintenance();
    expect(context.signal.aborted).toBe(true);
    expect(context.checkpoint()).toBe(false);
    expect([first.status, second.status]).toEqual(["cancelled", "cancelled"]);
    stopMaintenance = startAppChoreographyMaintenance();
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(queued).not.toHaveBeenCalled();
    expect(getAppChoreographyCoordinator().snapshot()).toEqual([]);
  });

  it("reevaluates clipped control visibility without touching user focus, selection, route or scroll", async () => {
    const pane = document.createElement("div");
    pane.style.overflow = "auto";
    box(pane, 100, 100);
    pane.scrollTop = 73;
    const target = document.createElement("input");
    target.dataset.spectraAiTarget = "name";
    box(target, 120);
    const userInput = document.createElement("input");
    userInput.value = "User is editing";
    pane.append(target);
    document.body.append(pane, userInput);
    userInput.focus();
    userInput.setSelectionRange(2, 7);
    const gate = deferred();
    let context!: AppPerformanceContext;
    performAppChoreography(request("visibility"), (value) => { context = value; return gate.promise; });
    await vi.advanceTimersByTimeAsync(0);
    expect(context.decision()).toMatchObject({ animate: true, navigate: false });
    box(target, 300); // The page is still mounted, but the scrolled pane clips this control.
    expect(context.decision()).toMatchObject({ animate: false, navigate: false });
    followAiActor("a");
    expect(context.decision()).toMatchObject({ animate: true, navigate: true });
    followAiActor("b");
    expect(context.decision()).toMatchObject({ animate: false, navigate: false });
    box(target, 120);
    expect(context.decision()).toMatchObject({ animate: true, navigate: false });
    expect(document.activeElement).toBe(userInput);
    expect([userInput.selectionStart, userInput.selectionEnd]).toEqual([2, 7]);
    expect(pane.scrollTop).toBe(73);
    expect(window.location.pathname).toBe("/library");
    target.hidden = true;
    expect(currentViewportSnapshot("a", request("visibility")).targetVisible).toBe(false);
    gate.resolve();
  });

  it("renewing at acknowledged progress allows a long action but not a dead callback", async () => {
    const gate = deferred();
    let context!: AppPerformanceContext;
    const entry = performAppChoreography(request("long"), (value) => { context = value; return gate.promise; });
    await vi.advanceTimersByTimeAsync(7000);
    expect(context.checkpoint()).toBe(true);
    await vi.advanceTimersByTimeAsync(7000);
    expect(entry.status).toBe("performing");
    await vi.advanceTimersByTimeAsync(1100);
    expect(entry.status).toBe("cancelled");
    expect(context.checkpoint()).toBe(false);
    gate.resolve();
  });

  it("keeps artifact actors separate even when operation IDs match", () => {
    const a = artifactPerformerFor("a");
    const b = artifactPerformerFor("b");
    const envelope = { operationId: "1", artifactId: "artifact", typeKey: "planner_task", path: "/description", action: "set", before: "Old", after: "New" };
    a.start({ ...envelope, runId: "a" });
    b.start({ ...envelope, runId: "b" });
    expect(a).not.toBe(b);
    expect(artifactPerformerFor("a")).toBe(a);
    a.cancel();
    expect(a.getSnapshot().operations).toHaveLength(0);
    expect(b.getSnapshot().operations).toHaveLength(1);
  });

  it("saved-event replay neither executes controls nor changes an ordinary-mode viewport", async () => {
    const route = vi.fn();
    const remove = spectraBus.handle("navigation.show", route);
    const event = { key: "organize_library", runId: "saved-run", payload: { targetId: "folder", note: "Created Sources" } };
    try {
      handleSpectraAiUiEvent(event);
      handleSpectraAiUiEvent(event);
      await vi.advanceTimersByTimeAsync(1000);
      expect(getAppChoreographyCoordinator().snapshot()).toEqual([]);
      expect(route).not.toHaveBeenCalled();
    } finally { remove(); }
  });
});
