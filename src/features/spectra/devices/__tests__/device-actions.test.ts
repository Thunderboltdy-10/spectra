import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  status: null as { deviceId?: string; paused?: boolean } | null,
  calls: [] as string[],
  fail: false,
}));

vi.mock("../../bridge/client", () => {
  const call = (name: string) => async (...args: unknown[]) => {
    bridge.calls.push([name, ...args.map(String)].join(":"));
    if (bridge.fail) throw new Error("Failed to fetch");
    return name === "update" ? "Spectra Bridge is up to date." : undefined;
  };
  return {
    loadBridgeStatusCache: () => bridge.status,
    selectBridgeFolder: call("select"),
    retryBridgeFolder: call("retry"),
    pauseBridgeFolder: call("pauseFolder"),
    removeBridgeFolder: call("remove"),
    pauseBridgeSync: call("pauseSync"),
    openBridgeLogs: call("logs"),
    requestBridgeUpdate: call("update"),
  };
});

import { spectraBus } from "../../events";
import { claimDeviceAction, runAiDeviceAction, runLocalDeviceAction } from "../device-actions";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

beforeEach(() => {
  bridge.status = { deviceId: "device-here", paused: false };
  bridge.calls = [];
  bridge.fail = false;
  vi.stubGlobal("window", { localStorage: memoryStorage() });
});
afterEach(() => vi.unstubAllGlobals());

describe("device actions on this computer", () => {
  it("runs each action through the local Bridge and tells Devices to refresh", async () => {
    const changed = vi.fn();
    const off = spectraBus.on("devices.changed", changed);
    try {
      await expect(runLocalDeviceAction({ action: "pause_folder", grantId: "grant_a" })).resolves.toMatchObject({ status: "completed", message: "Paused the folder." });
      await runLocalDeviceAction({ action: "resume_syncing" });
      await expect(runLocalDeviceAction({ action: "update" })).resolves.toMatchObject({ message: "Spectra Bridge is up to date." });
    } finally {
      off();
    }
    expect(bridge.calls).toEqual(["pauseFolder:grant_a:true", "pauseSync:false", "update"]);
    expect(changed).toHaveBeenCalledTimes(3);
  });

  it("asks which folder instead of guessing, and reports failures in plain words", async () => {
    await expect(runLocalDeviceAction({ action: "retry_folder" })).resolves.toEqual({ status: "failed", message: "Say which folder." });
    expect(bridge.calls).toEqual([]);
    bridge.fail = true;
    const outcome = await runLocalDeviceAction({ action: "show_logs" });
    expect(outcome.status).toBe("failed");
    expect(outcome.message).not.toMatch(/Failed to fetch/);
  });
});

describe("Spectra AI's device actions", () => {
  it("runs an action once, however many tabs or replays deliver it", async () => {
    expect(claimDeviceAction("run:op")).toBe(true);
    expect(claimDeviceAction("run:op")).toBe(false);
    const open = vi.fn();
    await expect(runAiDeviceAction({ action: "retry_folder", grantId: "grant_a", actionId: "run:retry" }, open)).resolves.toMatchObject({ status: "completed" });
    await expect(runAiDeviceAction({ action: "retry_folder", grantId: "grant_a", actionId: "run:retry" }, open)).resolves.toBeNull();
    expect(bridge.calls).toEqual(["retry:grant_a"]);
    expect(open).toHaveBeenCalledWith(false);
  });

  it("runs only on the computer it was meant for", async () => {
    const open = vi.fn();
    await expect(runAiDeviceAction({ action: "show_logs", deviceId: "device-desk" }, open)).resolves.toBeNull();
    bridge.status = null;
    await expect(runAiDeviceAction({ action: "show_logs" }, open)).resolves.toBeNull();
    await expect(runAiDeviceAction({ action: "unknown" }, open)).resolves.toBeNull();
    expect(bridge.calls).toEqual([]);
    expect(open).not.toHaveBeenCalled();
  });

  it("opens Devices to connect when asked to pair, even before this computer is known", async () => {
    bridge.status = null;
    const open = vi.fn();
    await expect(runAiDeviceAction({ action: "pair", actionId: "run:pair" }, open)).resolves.toMatchObject({ status: "pending" });
    expect(open).toHaveBeenCalledWith(true);
  });
});
