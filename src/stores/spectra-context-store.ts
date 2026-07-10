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
};

export type SpectraContinuation = { id: string; title: string; runId?: string; workspaceId?: string };

type SpectraContextState = {
  continuation: SpectraContinuation | null;
  explicit: SpectraContextObject[];
  selectionDraft: SpectraContextObject[];
  visible: SpectraContextObject[];
  excludedVisibleKeys: string[];
  activeWorkspace: { id: string; title: string } | null;
  globalScope: boolean;
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
  reconcile: (available: Array<{ type: SpectraContextObjectType; id: string; label?: string; workspaceId?: string }>) => void;
  setObjectAvailability: (type: SpectraContextObjectType, id: string, available?: { label?: string; workspaceId?: string }) => void;
};

function sameObject(a: Pick<SpectraContextObject, "type" | "id">, b: Pick<SpectraContextObject, "type" | "id">) {
  return a.type === b.type && a.id === b.id;
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

export const useSpectraContextStore = create<SpectraContextState>()(persist((set, get) => ({
  continuation: null,
  explicit: [],
  selectionDraft: [],
  visible: [],
  excludedVisibleKeys: [],
  activeWorkspace: null,
  globalScope: true,
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
  setVisible: (visible) => set((state) => ({ visible: dedupe(visible.map((row) => ({ ...row, source: "visible" }))), revision: state.revision + 1 })),
  toggleVisibleExclusion: (type, id) => set((state) => { const key = `${type}:${id}`; return { excludedVisibleKeys: state.excludedVisibleKeys.includes(key) ? state.excludedVisibleKeys.filter((row) => row !== key) : [...state.excludedVisibleKeys, key], revision: state.revision + 1 }; }),
  reconcile: (available) => set((state) => {
    const byKey = new Map(available.map((row) => [`${row.type}:${row.id}`, row]));
    const providedTypes = new Set(available.map((row) => row.type));
    const reconcileRows = (rows: SpectraContextObject[]) => rows.flatMap((row) => {
      if (!providedTypes.has(row.type)) return [row];
      const next = byKey.get(`${row.type}:${row.id}`);
      return next ? [{ ...row, label: next.label ?? row.label, workspaceId: next.workspaceId ?? row.workspaceId, stale: false }] : row.source === "explicit" ? [row] : [];
    });
    return { explicit: reconcileRows(state.explicit), selectionDraft: reconcileRows(state.selectionDraft), visible: reconcileRows(state.visible), revision: state.revision + 1 };
  }),
  setObjectAvailability: (type, id, available) => set((state) => {
    const update = (rows: SpectraContextObject[]) => rows.flatMap((row) => {
      if (row.type !== type || row.id !== id) return [row];
      if (available) return [{ ...row, label: available.label ?? row.label, workspaceId: available.workspaceId ?? row.workspaceId, stale: false }];
      return row.source === "explicit" ? [{ ...row, stale: true }] : [];
    });
    return { explicit: update(state.explicit), selectionDraft: update(state.selectionDraft), visible: update(state.visible), revision: state.revision + 1 };
  }),
}), {
  name: "spectra.context.v2",
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({ continuation: state.continuation, explicit: state.explicit, selectionDraft: state.selectionDraft, excludedVisibleKeys: state.excludedVisibleKeys, activeWorkspace: state.activeWorkspace, globalScope: state.globalScope, revision: state.revision }),
  version: 2,
}));

export function activeArtifactContext(state: Pick<SpectraContextState, "explicit" | "visible" | "excludedVisibleKeys">) {
  const explicitKeys = new Set(state.explicit.map((object) => `${object.type}:${object.id}`));
  return dedupe([...state.explicit, ...state.visible.filter((object) => explicitKeys.has(`${object.type}:${object.id}`) || !state.excludedVisibleKeys.includes(`${object.type}:${object.id}`))]).filter((object) => object.type === "artifact" && !object.stale).map((object) => object.id);
}
