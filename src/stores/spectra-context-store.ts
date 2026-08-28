"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type SpectraContextObjectType = "artifact" | "workspace" | "thread";
export type SpectraContextSource = "explicit" | "selected" | "visible" | "recent" | "inferred";

export type SpectraContextObject = {
  type: SpectraContextObjectType;
  id: string;
  label: string;
  source: SpectraContextSource;
  workspaceId?: string;
  capability?: "context" | "tile" | "continue";
  stale?: boolean;
  semanticTargetId?: string;
  semanticAnchor?: {
    workId: string;
    workType: string;
    kind: string;
    path: string[];
    stableIds?: Record<string, string>;
    fallbackExcerpt?: string;
    schemaVersion: number;
    relativePosition?: number[];
  };
  contextSummary?: string;
};

export type SpectraContinuation = {
  id: string;
  title: string;
  runId?: string;
  workspaceId?: string;
  /** Artifact the conversation was started from, when artifact-scoped. */
  artifactId?: string;
};

export type SpectraOpenObjectType = SpectraContextObjectType | "run";
export type SpectraOpenPresentation = "rail" | "split" | "tab" | "tile" | "thread-panel" | "run-panel" | "full";
export type SpectraTileSize = "normal" | "wide" | "tall";

export type SpectraOpenObject = {
  type: SpectraOpenObjectType;
  id: string;
  label: string;
  presentation: SpectraOpenPresentation;
  workspaceId?: string;
};

type SpectraContextState = {
  continuation: SpectraContinuation | null;
  explicit: SpectraContextObject[];
  selectionDraft: SpectraContextObject[];
  visible: SpectraContextObject[];
  excludedVisibleKeys: string[];
  activeWorkspace: { id: string; title: string } | null;
  globalScope: boolean;
  openObjects: SpectraOpenObject[];
  activeOpenObjectKey: string | null;
  dirtyArtifactIds: string[];
  tileArtifactIds: string[];
  tileSizes: Record<string, SpectraTileSize>;
  tilesIsolated: boolean;
  revision: number;
  setContinuation: (thread: SpectraContinuation | null) => void;
  setActiveWorkspace: (workspace: { id: string; title: string } | null) => void;
  setGlobalScope: (global: boolean) => void;
  toggleSelection: (object: SpectraContextObject, cap?: number) => { added: boolean; atLimit: boolean };
  setSelectionDraft: (objects: SpectraContextObject[]) => void;
  clearSelection: () => void;
  commitSelection: () => void;
  addExplicit: (object: SpectraContextObject) => void;
  removeExplicit: (type: SpectraContextObjectType, id: string) => void;
  clearExplicit: () => void;
  setVisible: (objects: SpectraContextObject[]) => void;
  toggleVisibleExclusion: (type: SpectraContextObjectType, id: string) => void;
  reconcile: (available: Array<{ type: SpectraContextObjectType; id: string; label?: string; workspaceId?: string }>, options?: { completeTypes?: SpectraContextObjectType[] }) => void;
  setObjectAvailability: (type: SpectraContextObjectType, id: string, available?: { label?: string; workspaceId?: string }) => void;
  openObject: (object: SpectraOpenObject) => void;
  focusObject: (type: SpectraOpenObjectType, id: string) => boolean;
  deactivateObject: () => void;
  closeObject: (type: SpectraOpenObjectType, id: string) => void;
  closePresentation: (presentation: SpectraOpenPresentation) => void;
  setTileObjects: (objects: SpectraOpenObject[]) => void;
  addTileObject: (object: SpectraOpenObject) => void;
  removeTileObject: (artifactId: string) => void;
  clearTiles: () => void;
  setTilesIsolated: (isolated: boolean) => void;
  moveTileBefore: (artifactId: string, targetArtifactId: string) => void;
  cycleTileSize: (artifactId: string) => void;
  setArtifactDirty: (artifactId: string, dirty: boolean) => void;
};

function sameObject(a: Pick<SpectraContextObject, "type" | "id">, b: Pick<SpectraContextObject, "type" | "id">) {
  const left = a as Pick<SpectraContextObject, "type" | "id" | "semanticTargetId">;
  const right = b as Pick<SpectraContextObject, "type" | "id" | "semanticTargetId">;
  return left.type === right.type && left.id === right.id && left.semanticTargetId === right.semanticTargetId;
}

function dedupe(objects: SpectraContextObject[]) {
  const rows: SpectraContextObject[] = [];
  for (const object of objects) {
    const index = rows.findIndex((row) => sameObject(row, object));
    if (index === -1) rows.push(object);
    else rows[index] = { ...rows[index], ...object };
  }
  return rows;
}

export function spectraObjectKey(object: Pick<SpectraOpenObject, "type" | "id">) {
  return `${object.type}:${object.id}`;
}

export function normalizeTileObjects(objects: SpectraOpenObject[], cap = 24) {
  const rows: SpectraOpenObject[] = [];
  for (const object of objects) {
    if (object.type !== "artifact" || rows.some((row) => row.id === object.id)) continue;
    rows.push({ ...object, presentation: "tile" });
    if (rows.length >= cap) break;
  }
  return rows;
}

function upsertOpenObject(objects: SpectraOpenObject[], object: SpectraOpenObject) {
  const key = spectraObjectKey(object);
  // Work can coexist with one auxiliary conversation, but conversation panels
  // share one physical slot. Multiple runs remain alive in the run rail and
  // can be switched into this slot without duplicating narrow panels.
  const conflictingPresentations =
    object.presentation === "split"
      ? new Set<SpectraOpenPresentation>(["split"])
      : object.presentation === "thread-panel" ||
          object.presentation === "run-panel"
        ? new Set<SpectraOpenPresentation>(["thread-panel", "run-panel"])
        : new Set<SpectraOpenPresentation>();
  return [
    ...objects.filter((row) => spectraObjectKey(row) !== key && !conflictingPresentations.has(row.presentation)),
    object,
  ];
}

export const useSpectraContextStore = create<SpectraContextState>()(persist((set, get) => ({
  continuation: null,
  explicit: [],
  selectionDraft: [],
  visible: [],
  excludedVisibleKeys: [],
  activeWorkspace: null,
  globalScope: true,
  openObjects: [],
  activeOpenObjectKey: null,
  dirtyArtifactIds: [],
  tileArtifactIds: [],
  tileSizes: {},
  tilesIsolated: false,
  revision: 1,
  setContinuation: (continuation) => set((state) => ({ continuation, revision: state.revision + 1 })),
  setActiveWorkspace: (activeWorkspace) => set((state) => ({ activeWorkspace, globalScope: !activeWorkspace, revision: state.revision + 1 })),
  setGlobalScope: (globalScope) => set((state) => ({ globalScope, activeWorkspace: globalScope ? null : state.activeWorkspace, revision: state.revision + 1 })),
  toggleSelection: (object, cap = 24) => {
    const current = get().selectionDraft;
    const existing = current.some((row) => sameObject(row, object));
    if (!existing && current.length >= cap) return { added: false, atLimit: true };
    set((state) => ({ selectionDraft: existing ? state.selectionDraft.filter((row) => !sameObject(row, object)) : [...state.selectionDraft, { ...object, source: "selected" }], revision: state.revision + 1 }));
    return { added: !existing, atLimit: false };
  },
  setSelectionDraft: (selectionDraft) => set((state) => ({ selectionDraft: dedupe(selectionDraft.map((row) => ({ ...row, source: "selected" }))), revision: state.revision + 1 })),
  clearSelection: () => set((state) => ({ selectionDraft: [], revision: state.revision + 1 })),
  commitSelection: () => set((state) => ({ explicit: dedupe([...state.explicit, ...state.selectionDraft.map((row) => ({ ...row, source: "explicit" as const }))]), selectionDraft: [], revision: state.revision + 1 })),
  addExplicit: (object) => set((state) => ({ explicit: dedupe([...state.explicit, { ...object, source: "explicit" }]), revision: state.revision + 1 })),
  removeExplicit: (type, id) => set((state) => ({ explicit: state.explicit.filter((row) => row.type !== type || row.id !== id), revision: state.revision + 1 })),
  clearExplicit: () => set((state) => ({ explicit: [], revision: state.revision + 1 })),
  setVisible: (visible) => set((state) => {
    const nextVisible = dedupe(visible.map((row) => ({ ...row, source: "visible" as const })));
    const visibleKeys = new Set(nextVisible.map((row) => spectraObjectKey(row)));
    return {
      visible: nextVisible,
      excludedVisibleKeys: state.excludedVisibleKeys.filter((key) => visibleKeys.has(key)),
      revision: state.revision + 1,
    };
  }),
  toggleVisibleExclusion: (type, id) => set((state) => { const key = `${type}:${id}`; return { excludedVisibleKeys: state.excludedVisibleKeys.includes(key) ? state.excludedVisibleKeys.filter((row) => row !== key) : [...state.excludedVisibleKeys, key], revision: state.revision + 1 }; }),
  reconcile: (available, options) => set((state) => {
    const byKey = new Map(available.map((row) => [`${row.type}:${row.id}`, row]));
    const providedTypes = new Set(available.map((row) => row.type));
    const completeTypes = new Set(options?.completeTypes ?? providedTypes);
    const reconcileRows = (rows: SpectraContextObject[]) => rows.flatMap((row) => {
      if (!providedTypes.has(row.type) || !completeTypes.has(row.type)) {
        const next = byKey.get(`${row.type}:${row.id}`);
        return next ? [{ ...row, label: next.label ?? row.label, workspaceId: next.workspaceId ?? row.workspaceId, stale: false }] : [row];
      }
      const next = byKey.get(`${row.type}:${row.id}`);
      return next ? [{ ...row, label: next.label ?? row.label, workspaceId: next.workspaceId ?? row.workspaceId, stale: false }] : row.source === "explicit" ? [{ ...row, stale: true }] : [];
    });
    const reconcileOpenObjects = state.openObjects.flatMap((row) => {
      // Live QC panels can open on thread_ready / run_created before the
      // independently refreshed thread index includes that id. Dropping them
      // here blanks the workspace live UI (no traces, no collaborator panel).
      if (
        row.type === "run" ||
        row.presentation === "thread-panel" ||
        row.presentation === "run-panel" ||
        !completeTypes.has(row.type)
      ) {
        return [row];
      }
      const next = byKey.get(`${row.type}:${row.id}`);
      return next ? [{ ...row, label: next.label ?? row.label, workspaceId: next.workspaceId ?? row.workspaceId }] : [];
    });
    const openTileIds = new Set(reconcileOpenObjects.filter((row) => row.type === "artifact" && row.presentation === "tile").map((row) => row.id));
    const tileArtifactIds = state.tileArtifactIds.filter((id) => openTileIds.has(id));
    const openKeys = new Set(reconcileOpenObjects.map(spectraObjectKey));
    return {
      explicit: reconcileRows(state.explicit),
      selectionDraft: reconcileRows(state.selectionDraft),
      visible: reconcileRows(state.visible),
      openObjects: reconcileOpenObjects,
      activeOpenObjectKey: state.activeOpenObjectKey && openKeys.has(state.activeOpenObjectKey) ? state.activeOpenObjectKey : null,
      dirtyArtifactIds: state.dirtyArtifactIds.filter((id) => !completeTypes.has("artifact") || byKey.has(`artifact:${id}`)),
      tileArtifactIds,
      tileSizes: Object.fromEntries(Object.entries(state.tileSizes).filter(([id]) => openTileIds.has(id))),
      tilesIsolated: tileArtifactIds.length ? state.tilesIsolated : false,
      revision: state.revision + 1,
    };
  }),
  setObjectAvailability: (type, id, available) => set((state) => {
    const update = (rows: SpectraContextObject[]) => rows.flatMap((row) => {
      if (row.type !== type || row.id !== id) return [row];
      if (available) return [{ ...row, label: available.label ?? row.label, workspaceId: available.workspaceId ?? row.workspaceId, stale: false }];
      return row.source === "explicit" ? [{ ...row, stale: true }] : [];
    });
    if (available) {
      return {
        explicit: update(state.explicit),
        selectionDraft: update(state.selectionDraft),
        visible: update(state.visible),
        openObjects: state.openObjects.map((row) => row.type === type && row.id === id ? { ...row, label: available.label ?? row.label, workspaceId: available.workspaceId ?? row.workspaceId } : row),
        revision: state.revision + 1,
      };
    }
    const key = `${type}:${id}`;
    const nextOpen = state.openObjects.filter((row) => spectraObjectKey(row) !== key);
    const nextTiles = type === "artifact" ? state.tileArtifactIds.filter((artifactId) => artifactId !== id) : state.tileArtifactIds;
    return {
      explicit: update(state.explicit),
      selectionDraft: update(state.selectionDraft),
      visible: update(state.visible),
      openObjects: nextOpen,
      activeOpenObjectKey: state.activeOpenObjectKey === key ? (nextOpen.at(-1) ? spectraObjectKey(nextOpen.at(-1)!) : null) : state.activeOpenObjectKey,
      dirtyArtifactIds: type === "artifact" ? state.dirtyArtifactIds.filter((artifactId) => artifactId !== id) : state.dirtyArtifactIds,
      tileArtifactIds: nextTiles,
      tileSizes: type === "artifact" ? Object.fromEntries(Object.entries(state.tileSizes).filter(([artifactId]) => artifactId !== id)) : state.tileSizes,
      tilesIsolated: nextTiles.length ? state.tilesIsolated : false,
      revision: state.revision + 1,
    };
  }),
  openObject: (object) => set((state) => {
    const key = spectraObjectKey(object);
    const movesOutOfTiles = object.type === "artifact" && object.presentation !== "tile" && state.tileArtifactIds.includes(object.id);
    const isAuxiliaryPanel = object.presentation === "thread-panel" || object.presentation === "run-panel";
    return {
      openObjects: upsertOpenObject(state.openObjects, object),
      // A side panel is additive working context. Opening it must not steal the
      // primary rail/tab identity from the artifact or workspace beneath it.
      activeOpenObjectKey: isAuxiliaryPanel ? state.activeOpenObjectKey : key,
      tileArtifactIds: movesOutOfTiles ? state.tileArtifactIds.filter((id) => id !== object.id) : state.tileArtifactIds,
      tileSizes: movesOutOfTiles ? Object.fromEntries(Object.entries(state.tileSizes).filter(([id]) => id !== object.id)) : state.tileSizes,
      tilesIsolated: movesOutOfTiles && state.tileArtifactIds.length === 1 ? false : state.tilesIsolated,
      revision: state.revision + 1,
    };
  }),
  focusObject: (type, id) => {
    const key = `${type}:${id}`;
    if (!get().openObjects.some((row) => spectraObjectKey(row) === key)) return false;
    set((state) => ({ activeOpenObjectKey: key, revision: state.revision + 1 }));
    return true;
  },
  deactivateObject: () => set((state) => ({ activeOpenObjectKey: null, revision: state.revision + 1 })),
  closeObject: (type, id) => set((state) => {
    const key = `${type}:${id}`;
    const nextOpen = state.openObjects.filter((row) => spectraObjectKey(row) !== key);
    const nextTiles = type === "artifact" ? state.tileArtifactIds.filter((artifactId) => artifactId !== id) : state.tileArtifactIds;
    return {
      openObjects: nextOpen,
      activeOpenObjectKey: state.activeOpenObjectKey === key ? (nextOpen.at(-1) ? spectraObjectKey(nextOpen.at(-1)!) : null) : state.activeOpenObjectKey,
      dirtyArtifactIds: type === "artifact" ? state.dirtyArtifactIds.filter((artifactId) => artifactId !== id) : state.dirtyArtifactIds,
      tileArtifactIds: nextTiles,
      tileSizes: type === "artifact" ? Object.fromEntries(Object.entries(state.tileSizes).filter(([artifactId]) => artifactId !== id)) : state.tileSizes,
      tilesIsolated: nextTiles.length ? state.tilesIsolated : false,
      revision: state.revision + 1,
    };
  }),
  closePresentation: (presentation) => set((state) => {
    const closing = new Set(state.openObjects.filter((row) => row.presentation === presentation).map(spectraObjectKey));
    const nextOpen = state.openObjects.filter((row) => row.presentation !== presentation);
    return {
      openObjects: nextOpen,
      activeOpenObjectKey: state.activeOpenObjectKey && closing.has(state.activeOpenObjectKey) ? (nextOpen.at(-1) ? spectraObjectKey(nextOpen.at(-1)!) : null) : state.activeOpenObjectKey,
      ...(presentation === "tile" ? { tileArtifactIds: [], tileSizes: {}, tilesIsolated: false } : {}),
      revision: state.revision + 1,
    };
  }),
  setTileObjects: (objects) => set((state) => {
    const tiles = normalizeTileObjects(objects);
    const ids = tiles.map((row) => row.id);
    const idSet = new Set(ids);
    let nextOpen = state.openObjects.filter((row) => row.presentation !== "tile" && !(row.type === "artifact" && idSet.has(row.id)));
    for (const tile of tiles) nextOpen = upsertOpenObject(nextOpen, tile);
    return {
      openObjects: nextOpen,
      activeOpenObjectKey: tiles.at(-1) ? spectraObjectKey(tiles.at(-1)!) : state.activeOpenObjectKey,
      tileArtifactIds: ids,
      tileSizes: Object.fromEntries(Object.entries(state.tileSizes).filter(([id]) => idSet.has(id))),
      tilesIsolated: ids.length > 0,
      revision: state.revision + 1,
    };
  }),
  addTileObject: (object) => set((state) => {
    if (object.type !== "artifact" || state.tileArtifactIds.includes(object.id) || state.tileArtifactIds.length >= 24) return state;
    const tile = { ...object, presentation: "tile" as const };
    return {
      openObjects: upsertOpenObject(state.openObjects, tile),
      activeOpenObjectKey: spectraObjectKey(tile),
      tileArtifactIds: [...state.tileArtifactIds, object.id],
      revision: state.revision + 1,
    };
  }),
  removeTileObject: (artifactId) => set((state) => {
    const nextTiles = state.tileArtifactIds.filter((id) => id !== artifactId);
    const key = `artifact:${artifactId}`;
    const nextOpen = state.openObjects.filter((row) => spectraObjectKey(row) !== key || row.presentation !== "tile");
    return {
      openObjects: nextOpen,
      activeOpenObjectKey: state.activeOpenObjectKey === key ? (nextOpen.at(-1) ? spectraObjectKey(nextOpen.at(-1)!) : null) : state.activeOpenObjectKey,
      tileArtifactIds: nextTiles,
      tileSizes: Object.fromEntries(Object.entries(state.tileSizes).filter(([id]) => id !== artifactId)),
      tilesIsolated: nextTiles.length ? state.tilesIsolated : false,
      revision: state.revision + 1,
    };
  }),
  clearTiles: () => set((state) => ({
    openObjects: state.openObjects.filter((row) => row.presentation !== "tile"),
    activeOpenObjectKey: state.activeOpenObjectKey && state.openObjects.some((row) => spectraObjectKey(row) === state.activeOpenObjectKey && row.presentation === "tile") ? null : state.activeOpenObjectKey,
    tileArtifactIds: [],
    tileSizes: {},
    tilesIsolated: false,
    revision: state.revision + 1,
  })),
  setTilesIsolated: (tilesIsolated) => set((state) => ({ tilesIsolated: state.tileArtifactIds.length ? tilesIsolated : false, revision: state.revision + 1 })),
  moveTileBefore: (artifactId, targetArtifactId) => set((state) => {
    if (artifactId === targetArtifactId || !state.tileArtifactIds.includes(artifactId) || !state.tileArtifactIds.includes(targetArtifactId)) return state;
    const next = state.tileArtifactIds.filter((id) => id !== artifactId);
    next.splice(next.indexOf(targetArtifactId), 0, artifactId);
    return { tileArtifactIds: next, revision: state.revision + 1 };
  }),
  cycleTileSize: (artifactId) => set((state) => {
    if (!state.tileArtifactIds.includes(artifactId)) return state;
    const current = state.tileSizes[artifactId] ?? "normal";
    const next = current === "normal" ? "wide" : current === "wide" ? "tall" : "normal";
    return { tileSizes: { ...state.tileSizes, [artifactId]: next }, revision: state.revision + 1 };
  }),
  setArtifactDirty: (artifactId, dirty) => set((state) => {
    const present = state.dirtyArtifactIds.includes(artifactId);
    if (present === dirty) return state;
    return {
      dirtyArtifactIds: dirty ? [...state.dirtyArtifactIds, artifactId] : state.dirtyArtifactIds.filter((id) => id !== artifactId),
      revision: state.revision + 1,
    };
  }),
}), {
  name: "spectra.context.v2",
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({ continuation: state.continuation, explicit: state.explicit, selectionDraft: state.selectionDraft, excludedVisibleKeys: state.excludedVisibleKeys, activeWorkspace: state.activeWorkspace, globalScope: state.globalScope, openObjects: state.openObjects, activeOpenObjectKey: state.activeOpenObjectKey, tileArtifactIds: state.tileArtifactIds, tileSizes: state.tileSizes, tilesIsolated: state.tilesIsolated, revision: state.revision }),
  version: 2,
  // Rehydrate from the mounted shell so the server and the first client render
  // share the same empty session. Reading storage during module evaluation made
  // persisted artifact tabs appear only on the client and triggered a full
  // hydration recovery on every reload.
  skipHydration: true,
}));

export function activeArtifactContext(state: Pick<SpectraContextState, "explicit" | "visible" | "excludedVisibleKeys">) {
  const explicitKeys = new Set(state.explicit.map((object) => `${object.type}:${object.id}`));
  return dedupe([...state.explicit, ...state.visible.filter((object) => explicitKeys.has(`${object.type}:${object.id}`) || !state.excludedVisibleKeys.includes(`${object.type}:${object.id}`))]).filter((object) => object.type === "artifact" && !object.stale).map((object) => object.id);
}
