import { create } from "zustand";
import type {
  BackgroundMode,
  HubSurfaceState,
  HubVisibility,
  ZoomTier,
  ViewMode,
  WorkspaceData,
  WorkspaceItemData,
} from "@/lib/workspace/contracts";
import { zoomTierForLevel, zoomTierProgress, VIEWPORT, computeWorkspaceEnvelope } from "@/lib/workspace/contracts";

export type DeepEditTarget = {
  item: WorkspaceItemData;
  locked: boolean;
  pinned: boolean;
};

import type { ResultCardData } from "@/components/workspace/result-card";

type WorkspacePreferencesPayload = {
  workspaceViewMode?: ViewMode;
  workspaceBackgroundMode?: BackgroundMode;
  workspaceHubVisibility?: HubVisibility;
};

let persistWorkspacePreferencesTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleWorkspacePreferencesPersist(patch: WorkspacePreferencesPayload) {
  if (typeof window === "undefined") return;

  if (persistWorkspacePreferencesTimer) {
    clearTimeout(persistWorkspacePreferencesTimer);
  }

  persistWorkspacePreferencesTimer = setTimeout(() => {
    void fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {
      // Preference sync is best-effort; avoid breaking workspace interactions.
    });
  }, 120);
}

type WorkspaceState = {
  zoom: number;
  zoomTier: ZoomTier;
  /** 0-1 progress within the current zoom tier for smooth interpolation */
  zoomProgress: number;
  viewportX: number;
  viewportY: number;

  activeWorkspaceId: string | null;
  committedWorkspaceId: string | null;
  /** Workspace closest to viewport center u2013 used for auto-entry */
  nearestWorkspaceId: string | null;
  viewMode: ViewMode;
  focusedItemId: string | null;

  /** Deep-edit surfaces open on right edge (hub ecology, not panel) */
  deepEditTargets: DeepEditTarget[];

  hubVisibility: HubVisibility;
  backgroundMode: BackgroundMode;
  plannerOpen: boolean;
  openSurfaces: Record<string, HubSurfaceState>;
  pinnedHubItemIds: string[];
  pendingResultCard:
    | {
        state: "loading" | "done";
        promptSnippet: string;
        summary?: string;
        targetId?: string;
      }
    | null;

  /** Stacking result cards above command bar */
  resultCards: ResultCardData[];

  workspaces: WorkspaceData[];
  hasHydratedPreferences: boolean;

  setZoom: (zoom: number) => void;
  setViewport: (x: number, y: number, zoom: number) => void;
  setActiveWorkspace: (id: string | null) => void;
  commitToWorkspace: (id: string | null) => void;
  setNearestWorkspace: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setFocusedItem: (id: string | null) => void;

  /**
   * Deep edit surface management.
   * openDeepEdit uses replacement semantics: opening a surface of the same
   * itemType as an existing unlocked surface replaces it rather than stacking.
   */
  openDeepEdit: (item: WorkspaceItemData) => void;
  closeDeepEdit: (itemId: string) => void;
  toggleDeepEditLock: (itemId: string) => void;
  toggleDeepEditPin: (itemId: string) => void;
  closeAllDeepEdits: () => void;

  setHubVisibility: (visibility: HubVisibility) => void;
  cycleHubVisibility: () => void;
  setBackgroundMode: (mode: BackgroundMode) => void;
  togglePlanner: () => void;
  openSurface: (surface: HubSurfaceState) => void;
  closeSurface: (id: string) => void;
  toggleSurfaceLocked: (id: string) => void;
  pinHubItem: (id: string) => void;
  unpinHubItem: (id: string) => void;
  setPendingResultCard: (
    card:
      | {
          state: "loading" | "done";
          promptSnippet: string;
          summary?: string;
          targetId?: string;
        }
      | null,
  ) => void;

  /** Result card stack management */
  pushResultCard: (card: Omit<ResultCardData, "createdAt">) => void;
  updateResultCard: (cardId: string, updates: Partial<ResultCardData>) => void;
  dismissResultCard: (cardId: string) => void;
  reopenResultCard: (cardId: string) => void;
  clearResultCards: () => void;

  setWorkspaces: (workspaces: WorkspaceData[]) => void;
  hydratePreferences: (preferences: WorkspacePreferencesPayload) => void;

  /** Computed fly-to target for dock navigation */
  flyToTarget: { centerX: number; centerY: number; zoom: number; requestId: number } | null;
  flyToWorkspace: (id: string) => void;
  clearFlyToTarget: () => void;
};

const HUB_VISIBILITY_ORDER: HubVisibility[] = ["collapsed", "expanded", "hidden"];

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  zoom: VIEWPORT.DEFAULT_ZOOM,
  zoomTier: zoomTierForLevel(VIEWPORT.DEFAULT_ZOOM),
  zoomProgress: zoomTierProgress(VIEWPORT.DEFAULT_ZOOM),
  viewportX: 0,
  viewportY: 0,

  activeWorkspaceId: null,
  committedWorkspaceId: null,
  nearestWorkspaceId: null,
  viewMode: "byType",
  focusedItemId: null,

  deepEditTargets: [],

  hubVisibility: "collapsed",
  backgroundMode: "dots",
  plannerOpen: false,
  openSurfaces: {},
  pinnedHubItemIds: [],
  pendingResultCard: null,
  resultCards: [],

  workspaces: [],
  hasHydratedPreferences: false,
  flyToTarget: null,

  setZoom: (zoom) =>
    set({
      zoom,
      zoomTier: zoomTierForLevel(zoom),
      zoomProgress: zoomTierProgress(zoom),
    }),

  setViewport: (x, y, zoom) =>
    set((state) => {
      const nextTier = zoomTierForLevel(zoom);
      const progress = zoomTierProgress(zoom);
      const committedWorkspaceId = state.committedWorkspaceId;

      return {
        viewportX: x,
        viewportY: y,
        zoom,
        zoomTier: nextTier,
        zoomProgress: progress,
        committedWorkspaceId,
        activeWorkspaceId: committedWorkspaceId ?? state.activeWorkspaceId,
      };
    }),

  setActiveWorkspace: (id) =>
    set({ activeWorkspaceId: id }),

  commitToWorkspace: (id) =>
    set({ committedWorkspaceId: id, activeWorkspaceId: id, nearestWorkspaceId: id }),

  setNearestWorkspace: (id) =>
    set({ nearestWorkspaceId: id }),

  setViewMode: (mode) =>
    set(() => {
      scheduleWorkspacePreferencesPersist({ workspaceViewMode: mode });
      return { viewMode: mode };
    }),

  setFocusedItem: (id) =>
    set({ focusedItemId: id }),

  /* ── Deep Edit Surface Management ── */

  openDeepEdit: (item) =>
    set((state) => {
      // Already open u2014 just focus it
      const exists = state.deepEditTargets.find((t) => t.item.id === item.id);
      if (exists) return { focusedItemId: item.id };

      // Replacement semantics: if there's an unlocked surface, replace it
      // rather than stacking, to keep the UI clean as a single active deep edit.
      const unlockedIdx = state.deepEditTargets.findIndex(
        (t) => !t.locked && !t.pinned,
      );

      let nextTargets: DeepEditTarget[];
      if (unlockedIdx >= 0) {
        nextTargets = [...state.deepEditTargets];
        nextTargets[unlockedIdx] = { item, locked: false, pinned: false };
      } else {
        nextTargets = [
          ...state.deepEditTargets,
          { item, locked: false, pinned: false },
        ];
      }

      return {
        deepEditTargets: nextTargets,
        focusedItemId: item.id,
      };
    }),

  closeDeepEdit: (itemId) =>
    set((state) => ({
      deepEditTargets: state.deepEditTargets.filter((t) => t.item.id !== itemId),
      focusedItemId: state.focusedItemId === itemId ? null : state.focusedItemId,
    })),

  toggleDeepEditLock: (itemId) =>
    set((state) => ({
      deepEditTargets: state.deepEditTargets.map((t) =>
        t.item.id === itemId ? { ...t, locked: !t.locked } : t,
      ),
    })),

  toggleDeepEditPin: (itemId) =>
    set((state) => ({
      deepEditTargets: state.deepEditTargets.map((t) =>
        t.item.id === itemId ? { ...t, pinned: !t.pinned } : t,
      ),
    })),

  closeAllDeepEdits: () =>
    set({ deepEditTargets: [], focusedItemId: null }),

  /* ── Hub Visibility ── */

  setHubVisibility: (visibility) =>
    set(() => {
      scheduleWorkspacePreferencesPersist({ workspaceHubVisibility: visibility });
      return { hubVisibility: visibility };
    }),

  cycleHubVisibility: () =>
    set((state) => ({
      hubVisibility:
        HUB_VISIBILITY_ORDER[(HUB_VISIBILITY_ORDER.indexOf(state.hubVisibility) + 1) % HUB_VISIBILITY_ORDER.length],
    })),

  setBackgroundMode: (mode) =>
    set(() => {
      scheduleWorkspacePreferencesPersist({ workspaceBackgroundMode: mode });
      return { backgroundMode: mode };
    }),

  togglePlanner: () =>
    set((state) => ({ plannerOpen: !state.plannerOpen })),

  openSurface: (surface) =>
    set((state) => ({
      openSurfaces: {
        ...state.openSurfaces,
        [surface.id]: surface,
      },
    })),

  closeSurface: (id) =>
    set((state) => {
      const next = { ...state.openSurfaces };
      delete next[id];
      return { openSurfaces: next };
    }),

  toggleSurfaceLocked: (id) =>
    set((state) => {
      const surface = state.openSurfaces[id];
      if (!surface) return state;
      return {
        openSurfaces: {
          ...state.openSurfaces,
          [id]: { ...surface, locked: !surface.locked, expanded: surface.locked ? surface.expanded : true },
        },
      };
    }),

  pinHubItem: (id) =>
    set((state) => ({
      pinnedHubItemIds: state.pinnedHubItemIds.includes(id) ? state.pinnedHubItemIds : [...state.pinnedHubItemIds, id],
    })),

  unpinHubItem: (id) =>
    set((state) => ({
      pinnedHubItemIds: state.pinnedHubItemIds.filter((entry) => entry !== id),
    })),

  setPendingResultCard: (card) =>
    set({ pendingResultCard: card }),

  /* u2500u2500 Result Card Stack Management u2500u2500 */

  pushResultCard: (card) =>
    set((state) => ({
      resultCards: [
        { ...card, createdAt: Date.now() },
        ...state.resultCards,
      ],
    })),

  updateResultCard: (cardId, updates) =>
    set((state) => ({
      resultCards: state.resultCards.map((c) =>
        c.id === cardId ? { ...c, ...updates } : c,
      ),
    })),

  dismissResultCard: (cardId) =>
    set((state) => ({
      resultCards: state.resultCards.map((c) =>
        c.id === cardId ? { ...c, state: "dismissed" as const } : c,
      ),
    })),

  reopenResultCard: (cardId) =>
    set((state) => ({
      resultCards: state.resultCards.map((c) =>
        c.id === cardId ? { ...c, state: "done" as const } : c,
      ),
    })),

  clearResultCards: () =>
    set({ resultCards: [] }),

  setWorkspaces: (workspaces) =>
    set({ workspaces }),

  hydratePreferences: (preferences) =>
    set((state) => ({
      viewMode: preferences.workspaceViewMode ?? state.viewMode,
      backgroundMode: preferences.workspaceBackgroundMode ?? state.backgroundMode,
      hubVisibility: preferences.workspaceHubVisibility ?? state.hubVisibility,
      hasHydratedPreferences: true,
    })),

  flyToWorkspace: (id) =>
    set((state) => {
      const idx = state.workspaces.findIndex((w) => w.id === id);
      if (idx < 0) return state;
      const ws = state.workspaces[idx];
      const envelope = computeWorkspaceEnvelope(idx, ws.itemCount);
      return {
        committedWorkspaceId: id,
        activeWorkspaceId: id,
        nearestWorkspaceId: id,
        flyToTarget: {
          centerX: envelope.centerX,
          centerY: envelope.centerY,
          zoom: envelope.fitZoom,
          requestId: Date.now(),
        },
      };
    }),

  clearFlyToTarget: () =>
    set({ flyToTarget: null }),
}));
