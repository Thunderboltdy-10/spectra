import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const values = new Map<string, string>();
const storage: Storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => { values.delete(key); },
  setItem: (key, value) => { values.set(key, value); },
};

let contextStore: typeof import("@/stores/spectra-context-store").useSpectraContextStore;

beforeAll(async () => {
  vi.stubGlobal("localStorage", storage);
  ({ useSpectraContextStore: contextStore } = await import("@/stores/spectra-context-store"));
});

beforeEach(() => {
  storage.clear();
  contextStore.setState({
    continuation: null,
    explicit: [],
    selectionDraft: [],
    visible: [],
    excludedVisibleKeys: [],
    activeWorkspace: null,
    globalScope: true,
    openObjects: [],
    activeOpenObjectKey: null,
    tileArtifactIds: [],
    tileSizes: {},
    tilesIsolated: false,
    revision: 1,
  });
});

describe("canonical Spectra client state", () => {
  it("keeps one continuation target and keeps temporary selection separate from explicit context", () => {
    const state = contextStore.getState();
    state.setContinuation({ id: "thread-a", title: "First" });
    state.setContinuation({ id: "thread-b", title: "Second" });
    state.addExplicit({ type: "artifact", id: "explicit-a", label: "Explicit", source: "explicit" });
    state.toggleSelection({ type: "artifact", id: "selected-b", label: "Selected", source: "selected" });
    state.clearSelection();

    expect(contextStore.getState().continuation?.id).toBe("thread-b");
    expect(contextStore.getState().selectionDraft).toEqual([]);
    expect(contextStore.getState().explicit.map((row) => row.id)).toEqual(["explicit-a"]);
  });

  it("opens thread and run panels without stealing the active artifact surface", () => {
    const state = contextStore.getState();
    state.openObject({ type: "artifact", id: "doc-a", label: "Document", presentation: "tab" });
    state.openObject({ type: "thread", id: "thread-a", label: "Conversation", presentation: "thread-panel" });
    expect(contextStore.getState().activeOpenObjectKey).toBe("artifact:doc-a");
    state.openObject({ type: "run", id: "run-a", label: "Run", presentation: "run-panel" });
    expect(contextStore.getState().activeOpenObjectKey).toBe("artifact:doc-a");
  });

  it("prunes inaccessible open objects and orphaned tiles while retaining explicit context as stale", () => {
    contextStore.setState({
      explicit: [{ type: "artifact", id: "gone", label: "Gone artifact", source: "explicit" }],
      openObjects: [
        { type: "artifact", id: "gone", label: "Gone artifact", presentation: "tile" },
        { type: "artifact", id: "kept", label: "Old title", presentation: "split" },
      ],
      activeOpenObjectKey: "artifact:gone",
      tileArtifactIds: ["gone"],
      tileSizes: { gone: "wide" },
      tilesIsolated: true,
    });

    contextStore.getState().reconcile([{ type: "artifact", id: "kept", label: "Current title" }]);
    const next = contextStore.getState();

    expect(next.openObjects).toEqual([{ type: "artifact", id: "kept", label: "Current title", presentation: "split" }]);
    expect(next.activeOpenObjectKey).toBeNull();
    expect(next.tileArtifactIds).toEqual([]);
    expect(next.tileSizes).toEqual({});
    expect(next.tilesIsolated).toBe(false);
    expect(next.explicit).toEqual([{ type: "artifact", id: "gone", label: "Gone artifact", source: "explicit", stale: true }]);
  });

  it("keeps a just-opened live thread panel while the thread index is still catching up", () => {
    const state = contextStore.getState();
    state.openObject({
      type: "thread",
      id: "brand-new-thread",
      label: "Current conversation",
      presentation: "thread-panel",
    });
    state.reconcile([
      { type: "artifact", id: "doc-a", label: "Document" },
      { type: "thread", id: "older-thread", label: "Older chat" },
    ]);
    expect(contextStore.getState().openObjects).toEqual([
      {
        type: "thread",
        id: "brand-new-thread",
        label: "Current conversation",
        presentation: "thread-panel",
      },
    ]);
  });

  it("closes tile presentation atomically without leaving layout state behind", () => {
    contextStore.getState().setTileObjects([
      { type: "artifact", id: "a", label: "A", presentation: "tile" },
      { type: "artifact", id: "b", label: "B", presentation: "tile" },
    ]);
    contextStore.getState().cycleTileSize("a");
    contextStore.getState().setTilesIsolated(true);
    contextStore.getState().closePresentation("tile");

    const next = contextStore.getState();
    expect(next.openObjects.some((row) => row.presentation === "tile")).toBe(false);
    expect(next.tileArtifactIds).toEqual([]);
    expect(next.tileSizes).toEqual({});
    expect(next.tilesIsolated).toBe(false);
  });

  it("forgets a visible-context exclusion when the object is no longer visible", () => {
    contextStore.getState().setVisible([{ type: "artifact", id: "a", label: "A", source: "visible" }]);
    contextStore.getState().toggleVisibleExclusion("artifact", "a");
    contextStore.getState().setVisible([]);
    expect(contextStore.getState().excludedVisibleKeys).toEqual([]);
  });

  it("keeps an artifact split open beside a thread panel and replaces only conflicting conversation panels", () => {
    const state = contextStore.getState();
    state.openObject({ type: "artifact", id: "doc", label: "Document", presentation: "split" });
    state.openObject({ type: "thread", id: "thread-a", label: "Thread A", presentation: "thread-panel" });
    expect(contextStore.getState().openObjects.map((row) => row.id)).toEqual(["doc", "thread-a"]);
    state.openObject({ type: "thread", id: "thread-b", label: "Thread B", presentation: "thread-panel" });
    expect(contextStore.getState().openObjects.map((row) => row.id)).toEqual(["doc", "thread-b"]);
  });
});
