// @vitest-environment jsdom
import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRIDGE_DISCOVERY_STORAGE_KEY,
  BRIDGE_SESSION_STORAGE_KEY,
  BRIDGE_STATUS_CACHE_KEY,
  bridgeDiscoveryDelay,
  bridgeDiscoveryEnabled,
  bridgeReachabilityCopy,
  persistBridgeSession,
} from "../bridge/client";
import { resetBridgeProbeForTests, useBridgeHealth } from "../bridge/use-bridge";
import { BridgeDiscoveryMount } from "../bridge/bridge-discovery-mount";

const auth = vi.hoisted(() => ({ isAuthenticated: true }));
vi.mock("convex/react", () => ({ useConvexAuth: () => auth }));

function healthCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/health"))
    .length;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetBridgeProbeForTests();
  auth.isAuthenticated = true;
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Bridge discovery gate (LV-012)", () => {
  it("wakes every mounted surface after same-tab manual reconnect with one shared probe", async () => {
    const fetchMock = vi.fn(async (url) => Response.json(String(url).endsWith("/v1/health")
      ? { version: "0.1.0", paired: true, protocolVersion: "1.0" }
      : { version: "0.1.0", paired: true, protocolVersion: "1.0", cloudConnected: true, mounts: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const first = renderHook(() => useBridgeHealth());
    const second = renderHook(() => useBridgeHealth());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(first.result.current.reachability).toBe("not-set-up");
    await act(async () => {
      persistBridgeSession("reconnected-session");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(first.result.current.reachability).toBe("connected");
    expect(second.result.current.reachability).toBe("connected");
    expect(healthCalls(fetchMock)).toBe(1);
  });

  it("keeps the remembered computer, as not connected, while a refused browser joins again", async () => {
    window.localStorage.setItem(BRIDGE_DISCOVERY_STORAGE_KEY, "enabled");
    window.localStorage.setItem(BRIDGE_SESSION_STORAGE_KEY, "expired-session");
    window.localStorage.setItem(BRIDGE_STATUS_CACHE_KEY, JSON.stringify({
      version: "0.1.0", protocolVersion: "1.0", paired: true, cloudConnected: true,
      deviceId: "old-device", deviceName: "Old computer", mounts: [{
        id: "old-folder", label: "Old folder", state: "active", detail: "Up to date",
      }],
    }));
    vi.stubGlobal("fetch", vi.fn(async (url) => String(url).endsWith("/v1/health")
      ? Response.json({ version: "0.1.0", paired: true, protocolVersion: "1.0" })
      : new Response("Expired session", { status: 401 })));
    const { result } = renderHook(() => useBridgeHealth());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(window.localStorage.getItem(BRIDGE_STATUS_CACHE_KEY)).not.toBeNull();
    expect(result.current.status).toMatchObject({ deviceId: "old-device", paired: false, cloudConnected: false });
    expect(result.current.reachability).toBe("running");
  });

  it("preserves a remembered computer while Bridge is temporarily unreachable", async () => {
    window.localStorage.setItem(BRIDGE_DISCOVERY_STORAGE_KEY, "enabled");
    window.localStorage.setItem(BRIDGE_SESSION_STORAGE_KEY, "valid-session");
    window.localStorage.setItem(BRIDGE_STATUS_CACHE_KEY, JSON.stringify({
      version: "0.1.0", protocolVersion: "1.0", paired: true, cloudConnected: true,
      deviceId: "remembered-device", deviceName: "My computer", mounts: [],
    }));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { result } = renderHook(() => useBridgeHealth());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.status).toMatchObject({ deviceId: "remembered-device", paired: false });
  });
  it("waits until discovery is enabled", async () => {
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

  it("discovers an installed Bridge for a signed-in account before any device is paired", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ version: "0.1.0", paired: false, protocolVersion: "1.0", port: 47615 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useBridgeHealth());
    render(<BridgeDiscoveryMount />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(healthCalls(fetchMock)).toBeGreaterThan(0);
    expect(result.current.health?.paired).toBe(false);
    expect(bridgeDiscoveryEnabled()).toBe(true);
    expect(window.localStorage.getItem(BRIDGE_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("leaves automatic discovery disabled for signed-out visitors", () => {
    auth.isAuthenticated = false;
    render(<BridgeDiscoveryMount />);
    expect(bridgeDiscoveryEnabled()).toBe(false);
  });

  it("checks automatically once connected, backing off while Bridge is unreachable, and at once on return", async () => {
    window.localStorage.setItem(BRIDGE_DISCOVERY_STORAGE_KEY, "enabled");
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useBridgeHealth());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(healthCalls(fetchMock)).toBe(1);
    expect(result.current.reachability).toBe("not-running");
    // Misses wait 30 s, then 60 s, instead of a probe every 15 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(healthCalls(fetchMock)).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000);
    });
    expect(healthCalls(fetchMock)).toBe(2);
    // Coming back to the page looks at once (Bridge may just have been opened),
    // but not again within a few seconds.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(healthCalls(fetchMock)).toBe(3);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(healthCalls(fetchMock)).toBe(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    // Held at the one-minute cap: far fewer than forty 15 s polls.
    expect(healthCalls(fetchMock)).toBeLessThanOrEqual(13);
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

  it("doubles the wait per miss up to a minute", () => {
    expect(bridgeDiscoveryDelay(0)).toBe(15_000);
    expect(bridgeDiscoveryDelay(1)).toBe(30_000);
    expect(bridgeDiscoveryDelay(3)).toBe(60_000);
    expect(bridgeDiscoveryDelay(5)).toBe(60_000);
    expect(bridgeDiscoveryDelay(50)).toBe(60_000);
  });
});
