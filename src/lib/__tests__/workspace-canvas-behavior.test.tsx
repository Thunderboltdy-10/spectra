import { beforeEach, describe, expect, it } from "vitest";
import { __workspaceCanvasTestUtils } from "@/components/workspace/workspace-canvas";
import { loadLocalOverrides, saveLocalOverride } from "@/lib/workspace/position-persistence";
import { useWorkspaceStore } from "@/stores/workspace-store";

class MemoryStorage {
  private store = new Map<string, string>();

  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

describe("workspace canvas behavior", () => {
  beforeEach(() => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, "window", {
      value: { localStorage: storage },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
    useWorkspaceStore.getState().reset();
    window.localStorage.clear();
  });

  it("restores the default landscape viewport when nothing is persisted", () => {
    expect(__workspaceCanvasTestUtils.restoreViewport()).toEqual({ x: 0, y: 0, zoom: 0.18 });
  });

  it("loads saved local position overrides on first read and persists updates immediately", () => {
    saveLocalOverride("ws_1", 4321, 987);
    const overrides = loadLocalOverrides();

    expect(overrides.get("ws_1")).toEqual({ x: 4321, y: 987 });
    expect(JSON.parse(window.localStorage.getItem("workspace:position-overrides") ?? "{}").ws_1).toMatchObject({
      x: 4321,
      y: 987,
    });
  });

  it("reduces neighbor opacity progressively after the detail threshold", () => {
    expect(__workspaceCanvasTestUtils.getNeighborOpacity(0.55)).toBe(1);
    expect(__workspaceCanvasTestUtils.getNeighborOpacity(0.8)).toBeGreaterThan(0);
    expect(__workspaceCanvasTestUtils.getNeighborOpacity(1.05)).toBe(0);
  });
});
