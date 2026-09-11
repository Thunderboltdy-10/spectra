import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetViewportReadiness,
  acknowledgeViewportReady,
  announceManualViewportInteraction,
  pendingViewportActions,
  requestViewportAction,
} from "../viewport-readiness";
import { spectraBus } from "../events";

describe("viewport readiness", () => {
  afterEach(() => {
    vi.useRealTimers();
    __resetViewportReadiness();
  });

  it("resolves only when the requested mounted target acknowledges", async () => {
    const action = requestViewportAction({
      targetId: "artifact-a",
      view: "artifact",
      navigate: vi.fn(),
    });
    expect(acknowledgeViewportReady({ targetId: "artifact-b", view: "artifact" })).toBe(false);
    expect(acknowledgeViewportReady({ targetId: "artifact-a", view: "artifact" })).toBe(true);
    await expect(action).resolves.toMatchObject({
      targetId: "artifact-a",
      routeGeneration: 1,
      status: "ready",
    });
  });

  it("cancels stale A→B→A requests instead of accepting a late mount", async () => {
    const first = requestViewportAction({ targetId: "a", view: "artifact", navigate: vi.fn() });
    const second = requestViewportAction({ targetId: "b", view: "artifact", navigate: vi.fn() });
    const third = requestViewportAction({ targetId: "a", view: "artifact", navigate: vi.fn() });
    expect(acknowledgeViewportReady({ targetId: "a", view: "artifact" })).toBe(true);
    await expect(first).resolves.toMatchObject({ status: "cancelled" });
    await expect(second).resolves.toMatchObject({ status: "cancelled" });
    await expect(third).resolves.toMatchObject({ status: "ready", targetId: "a" });
  });

  it("publishes a typed manual-interaction signal for follow arbitration", () => {
    const listener = vi.fn();
    const remove = spectraBus.on("navigation.manualInteraction", listener);
    announceManualViewportInteraction({ surface: "artifact", interaction: "keyboard", targetId: "artifact-a" });
    remove();
    expect(listener).toHaveBeenCalledWith({
      surface: "artifact",
      interaction: "keyboard",
      targetId: "artifact-a",
    });
  });

  it("reports a truthful timeout when a surface never mounts", async () => {
    vi.useFakeTimers();
    const action = requestViewportAction({ targetId: "slow", view: "workspace", navigate: vi.fn(), timeoutMs: 250 });
    vi.advanceTimersByTime(250);
    await expect(action).resolves.toMatchObject({ status: "failed", targetId: "slow" });
    expect(pendingViewportActions()).toHaveLength(0);
  });
});
