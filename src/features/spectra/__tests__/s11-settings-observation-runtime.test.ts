import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { awaitedUiOperation, cancelUiObservation, notifyUiObservation, waitForSettingsAction } from "@/app/api/spectra/run/harness/ui-observation";
import { SMART_COMPLETION_TARGET } from "../actions/protocol/semantic-action";
const io = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@/app/api/spectra/run/harness/io", () => io);
const identity = { runId: "run", executionId: "attempt", operationId: "toggle" };
const fence = { epoch: 1, sequence: 0 as const, operationDigest: "a".repeat(64) };
const offered = () => ({ phase: "waiting", action: { ...identity, ...fence, kind: "settings_toggle", target: SMART_COMPLETION_TARGET, checked: false, expiresAt: Date.now() + 15_000 }, participants: [{ clientId: "tab", mode: "follow" }] });
beforeEach(() => { vi.useFakeTimers(); io.mutate.mockReset(); });
afterEach(() => { cancelUiObservation(identity.runId, identity.executionId); vi.clearAllTimers(); vi.useRealTimers(); });

describe("S11 bounded server observation waits", () => {
  it("uses one read-only prepare transaction and no wait for headless work", async () => {
    io.mutate.mockResolvedValue({ phase: "headless" });
    expect(await waitForSettingsAction(identity)).toEqual({});
    expect(io.mutate).toHaveBeenCalledTimes(1);
    expect(awaitedUiOperation("run", "attempt")).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("wakes on the same-instance durable ACK without another read", async () => {
    const snapshot = offered();
    io.mutate.mockResolvedValue(snapshot);
    const start = Date.now();
    const task = waitForSettingsAction(identity);
    await vi.advanceTimersByTimeAsync(180);
    notifyUiObservation(identity, { ...snapshot, phase: "sealed" });
    expect(await task).toEqual({ fence });
    expect(Date.now() - start).toBe(180);
    expect(io.mutate).toHaveBeenCalledTimes(1);
  });

  it("models cross-instance ACK delivery on the existing five-second heartbeat without a new poll", async () => {
    const snapshot = offered();
    io.mutate.mockResolvedValue(snapshot);
    const task = waitForSettingsAction(identity);
    const start = Date.now();
    let resolved = false;
    void task.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(resolved).toBe(false);
    expect(io.mutate).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    notifyUiObservation(identity, { ...snapshot, phase: "sealed" });
    expect(await task).toEqual({ fence });
    expect(Date.now() - start).toBe(5_000);
    expect(io.mutate).toHaveBeenCalledTimes(1);
  });

  it("invalidates the expired epoch transactionally before headless recovery", async () => {
    const snapshot = offered();
    io.mutate.mockResolvedValueOnce(snapshot).mockResolvedValueOnce({ ...snapshot, phase: "headless", action: { ...snapshot.action, epoch: 2 }, participants: [] });
    const task = waitForSettingsAction(identity);
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await task).toEqual({ fence: { ...fence, epoch: 2 } });
    expect(io.mutate.mock.calls.map(call => call[0])).toEqual(["spectraOperations:prepareUiAction", "spectraOperations:expireUiAction"]);
  });

  it("cancels on Stop and cannot accept a later acknowledgement", async () => {
    io.mutate.mockResolvedValue(offered());
    const task = waitForSettingsAction(identity);
    const rejection = expect(task).rejects.toThrow("AI_EXECUTION_ABORTED");
    await vi.advanceTimersByTimeAsync(0);
    cancelUiObservation("run", "attempt");
    await rejection;
    notifyUiObservation(identity, { ...offered(), phase: "sealed" });
    expect(awaitedUiOperation("run", "attempt")).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not mistake an empty heartbeat during preparation for headless permission", async () => {
    let prepared!: (value: unknown) => void;
    io.mutate.mockReturnValue(new Promise(resolve => { prepared = resolve; }));
    const task = waitForSettingsAction(identity);
    notifyUiObservation(identity, { phase: "headless" });
    prepared(offered());
    await vi.advanceTimersByTimeAsync(0);
    expect(awaitedUiOperation("run", "attempt")).toBe("toggle");
    notifyUiObservation(identity, { ...offered(), phase: "sealed" });
    expect(await task).toEqual({ fence });
  });
});
