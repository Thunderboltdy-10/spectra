// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRIDGE_DISCOVERY_STORAGE_KEY,
  BRIDGE_SESSION_STORAGE_KEY,
  bridgeDiscoveryDelay,
  bridgeDiscoveryEnabled,
  bridgeReachabilityCopy,
  persistBridgeSession,
} from "../bridge/client";
import { resetBridgeProbeForTests, useBridgeHealth } from "../bridge/use-bridge";

function healthCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/health"))
    .length;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetBridgeProbeForTests();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Bridge discovery gate (LV-012)", () => {
  it("never probes Bridge on a device that has not connected it", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useBridgeHealth());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * 60_000);
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.checked).toBe(true);
    expect(result.current.reachability).toBe("not-set-up");
    expect(bridgeReachabilityCopy("not-set-up").detail).toContain("Connect Bridge");
  });

  it("checks automatically once connected, backing off while Bridge is unreachable", async () => {
    window.localStorage.setItem(BRIDGE_DISCOVERY_STORAGE_KEY, "enabled");
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useBridgeHealth());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(healthCalls(fetchMock)).toBe(1);
    expect(result.current.reachability).toBe("not-running");
    // Misses wait 30 s, 60 s, 120 s ... instead of a probe every 15 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(healthCalls(fetchMock)).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(healthCalls(fetchMock)).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(healthCalls(fetchMock)).toBe(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    // 120 s, 240 s, then the 5-minute cap: far fewer than forty 15 s polls.
    expect(healthCalls(fetchMock)).toBeLessThanOrEqual(6);
  });

  it("shares one probe between surfaces mounted together", async () => {
    window.localStorage.setItem(BRIDGE_DISCOVERY_STORAGE_KEY, "enabled");
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useBridgeHealth());
    renderHook(() => useBridgeHealth());
    renderHook(() => useBridgeHealth());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(healthCalls(fetchMock)).toBe(1);
  });

  it("turns discovery on when this device pairs, and for devices that paired before", () => {
    expect(bridgeDiscoveryEnabled()).toBe(false);
    persistBridgeSession("session-token");
    expect(window.localStorage.getItem(BRIDGE_DISCOVERY_STORAGE_KEY)).toBe("enabled");
    window.localStorage.clear();
    window.localStorage.setItem(BRIDGE_SESSION_STORAGE_KEY, "earlier-session");
    expect(bridgeDiscoveryEnabled()).toBe(true);
    expect(window.localStorage.getItem(BRIDGE_DISCOVERY_STORAGE_KEY)).toBe("enabled");
  });

  it("doubles the wait per miss up to five minutes", () => {
    expect(bridgeDiscoveryDelay(0)).toBe(15_000);
    expect(bridgeDiscoveryDelay(1)).toBe(30_000);
    expect(bridgeDiscoveryDelay(3)).toBe(120_000);
    expect(bridgeDiscoveryDelay(5)).toBe(300_000);
    expect(bridgeDiscoveryDelay(50)).toBe(300_000);
  });
});
