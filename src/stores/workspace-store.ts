import { create } from "zustand";
import type {
  BackgroundMode,
  HubSurfaceState,
  HubVisibility,
  ZoomTier,
  ZoomSignals,
  ViewMode,
  WorkspaceData,
  WorkspaceItemData,
  NavigationMode,
  PageLevel,
  WidgetData,
  WidgetKind,
  ItemPositionOverride,
  HubEdge,
} from "@/lib/workspace/contracts";
import { zoomTierForLevel, zoomTierProgress, computeZoomSignals, VIEWPORT, computeWorkspaceEnvelope } from "@/lib/workspace/contracts";

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
  workspaceAutoSelectContext?: boolean;
  workspaceNavigationMode?: NavigationMode;
  workspaceHubOrder?: Record<HubEdge, string[]>;
};

const WIDGET_STORAGE_KEY = "spectra:widgets:v1";
const ITEM_POS_STORAGE_KEY = "spectra:item-positions:v1";
const HUB_ORDER_STORAGE_KEY = "spectra:hub-order:v1";

function loadWidgets(): WidgetData[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WIDGET_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WidgetData[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveWidgets(widgets: WidgetData[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(widgets));
  } catch {}
}

function loadItemPositions(): Record<string, ItemPositionOverride> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ITEM_POS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ItemPositionOverride>;
  } catch {
    return {};
  }
}

function saveItemPositions(positions: Record<string, ItemPositionOverride>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ITEM_POS_STORAGE_KEY, JSON.stringify(positions));
  } catch {}
}

function loadHubOrder(): Record<HubEdge, string[]> {
  const empty: Record<HubEdge, string[]> = { top: [], bottom: [], left: [], right: [] };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(HUB_ORDER_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Record<HubEdge, string[]>;
    return {
      top: Array.isArray(parsed.top) ? parsed.top : [],
      bottom: Array.isArray(parsed.bottom) ? parsed.bottom : [],
      left: Array.isArray(parsed.left) ? parsed.left : [],
      right: Array.isArray(parsed.right) ? parsed.right : [],
    };
  } catch {
    return empty;
  }
}

function saveHubOrder(order: Record<HubEdge, string[]>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HUB_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {}
}

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
  /** Continuous semantic zoom signals for progressive rendering */
  zoomSignals: ZoomSignals;
  viewportX: number;
  viewportY: number;

  /** Smoothed workspace proximity: 0=far from any, 1=deeply inside one */
  workspaceProximity: number;
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


  /** Active thread selected in threads hub for inline preview */
  activeThreadId: string | null;
  workspaces: WorkspaceData[];
  hasHydratedPreferences: boolean;
  autoSelectContext: boolean;

  /* ─ Navigation & Page mode ─ */
  navigationMode: NavigationMode;
  pageLevel: PageLevel;
  /** In page mode, the active region key (group label) when at "region" */
  pageRegionKey: string | null;

  /* ─ Widget system ─ */
  widgets: WidgetData[];
  widgetPlacementHint: { kind: WidgetKind; at: "pointer" | "center" } | null;

  /* ─ Item position overrides ─ */
  itemPositions: Record<string, ItemPositionOverride>;

  /* ─ Hub order ─ */
  hubOrder: Record<HubEdge, string[]>;

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

  /** Thread hub management */
  openThreadInHub: (threadId: string) => void;
  closeThreadInHub: () => void;

  setWorkspaces: (workspaces: WorkspaceData[]) => void;
  hydratePreferences: (preferences: WorkspacePreferencesPayload) => void;
  setAutoSelectContext: (enabled: boolean) => void;

  /** Computed fly-to target for dock navigation */
  flyToTarget: { centerX: number; centerY: number; zoom: number; requestId: number } | null;
  flyToWorkspace: (id: string) => void;
  clearFlyToTarget: () => void;

  /* ─ Navigation ─ */
  setNavigationMode: (mode: NavigationMode) => void;
  toggleNavigationMode: () => void;
  setPageLevel: (level: PageLevel) => void;
  setPageRegionKey: (key: string | null) => void;

  /* ─ Widget actions ─ */
  addWidget: (widget: WidgetData) => void;
  updateWidget: (id: string, patch: Partial<WidgetData>) => void;
  removeWidget: (id: string) => void;
  setWidgetPlacementHint: (hint: WorkspaceState["widgetPlacementHint"]) => void;

  /* ─ Item positions ─ */
  setItemPosition: (itemId: string, x: number, y: number) => void;
  clearItemPosition: (itemId: string) => void;

  /* ─ Hub order ─ */
  setHubOrder: (edge: HubEdge, ids: string[]) => void;
  reorderHub: (edge: HubEdge, fromIdx: number, toIdx: number) => void;
};

const HUB_VISIBILITY_ORDER: HubVisibility[] = ["collapsed", "expanded", "hidden"];

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  zoom: VIEWPORT.DEFAULT_ZOOM,
  zoomTier: zoomTierForLevel(VIEWPORT.DEFAULT_ZOOM),
  zoomProgress: zoomTierProgress(VIEWPORT.DEFAULT_ZOOM),
  zoomSignals: computeZoomSignals(VIEWPORT.DEFAULT_ZOOM),
  viewportX: 0,
  viewportY: 0,

  workspaceProximity: 0,
  activeWorkspaceId: null,
  committedWorkspaceId: null,
  nearestWorkspaceId: null,
  viewMode: "byType",
  focusedItemId: null,

  deepEditTargets: [],

  hubVisibility: "expanded",
  backgroundMode: "dots",
  plannerOpen: false,
  openSurfaces: {},
  pinnedHubItemIds: [],
  pendingResultCard: null,
  resultCards: [],
  activeThreadId: null,

  workspaces: [],
  hasHydratedPreferences: false,
  autoSelectContext: false,
  flyToTarget: null,

  navigationMode: "canvas",
  pageLevel: "atlas",
  pageRegionKey: null,

  widgets: loadWidgets(),
  widgetPlacementHint: null,
  itemPositions: loadItemPositions(),
  hubOrder: loadHubOrder(),

  setZoom: (zoom) =>
    set({
      zoom,
      zoomTier: zoomTierForLevel(zoom),
      zoomProgress: zoomTierProgress(zoom),
      zoomSignals: computeZoomSignals(zoom),
    }),

  setViewport: (x, y, zoom) =>
    set((state) => {
      const nextTier = zoomTierForLevel(zoom);
      const progress = zoomTierProgress(zoom);
      const signals = computeZoomSignals(zoom);

      // Compute viewport center in world coordinates
      const screenW = typeof window !== "undefined" ? window.innerWidth : 1400;
      const screenH = typeof window !== "undefined" ? window.innerHeight : 900;
      const worldCenterX = (-x + screenW / 2) / zoom;
      const worldCenterY = (-y + screenH / 2) / zoom;

      let nearestId = state.nearestWorkspaceId;
      let minDistance = Infinity;

      state.workspaces.forEach((ws, idx) => {
        const env = computeWorkspaceEnvelope(idx, ws.itemCount);
        const dx = env.centerX - worldCenterX;
        const dy = env.centerY - worldCenterY;
        const dist = dx * dx + dy * dy;
        if (dist < minDistance) {
          minDistance = dist;
          nearestId = ws.id;
        }
      });

      // Continuous workspace proximity inference.
      // Uses the zoom signals (structureReveal, contentDepth) instead of
      // raw zoom to drive proximity. This means commitment responds to
      // the semantic meaning of the zoom level, not just the numeric value.
      // Hysteresis prevents flickering at boundary transitions.
      const commitThreshold = 0.48;
      const uncommitThreshold = 0.22;

      // Proximity combines zoom signals (semantic depth) with spatial
      // closeness to the nearest workspace center.
      let proximity = 0;
      if (nearestId && state.workspaces.length > 0) {
        const nearestIdx = state.workspaces.findIndex((w) => w.id === nearestId);
        if (nearestIdx >= 0) {
          const env = computeWorkspaceEnvelope(nearestIdx, state.workspaces[nearestIdx].itemCount);
          const dx = env.centerX - worldCenterX;
          const dy = env.centerY - worldCenterY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          // Normalize distance: 0 when at center, 1 when at ~2x envelope radius
          const envRadius = Math.max(env.width, env.height) * 0.6;
          const spatialCloseness = Math.max(0, 1 - dist / (envRadius * 2));
          // Semantic zoom depth: uses continuous signals instead of raw zoom.
          // structureReveal = items becoming visible (entering workspace interior)
          // contentDepth = detail/touch tier (deeply inside workspace)
          const semanticDepth = Math.max(signals.structureReveal, signals.contentDepth);
          proximity = spatialCloseness * 0.35 + semanticDepth * 0.65;
        }
      }

      let autoWorkspaceId = state.committedWorkspaceId;
      if (state.autoSelectContext) {
        if (state.committedWorkspaceId) {
          // Already committed: only uncommit when proximity drops below lower threshold
          if (proximity < uncommitThreshold) {
            autoWorkspaceId = null;
          }
        } else {
          // Not committed: only commit when proximity exceeds upper threshold
          if (proximity >= commitThreshold) {
            autoWorkspaceId = nearestId;
          }
        }
      }

      return {
        viewportX: x,
        viewportY: y,
        zoom,
        zoomTier: nextTier,
        zoomProgress: progress,
        zoomSignals: signals,
        workspaceProximity: proximity,
        nearestWorkspaceId: nearestId,
        committedWorkspaceId: autoWorkspaceId,
        activeWorkspaceId: autoWorkspaceId ?? state.activeWorkspaceId,
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

  openThreadInHub: (threadId) =>
    set({ activeThreadId: threadId }),

  closeThreadInHub: () =>
    set({ activeThreadId: null }),

  setWorkspaces: (workspaces) =>
    set({ workspaces }),

  hydratePreferences: (preferences) =>
    set((state) => ({
      viewMode: preferences.workspaceViewMode ?? state.viewMode,
      backgroundMode: preferences.workspaceBackgroundMode ?? state.backgroundMode,
      hubVisibility: preferences.workspaceHubVisibility ?? state.hubVisibility,
      autoSelectContext: preferences.workspaceAutoSelectContext ?? state.autoSelectContext,
      navigationMode: preferences.workspaceNavigationMode ?? state.navigationMode,
      hasHydratedPreferences: true,
    })),

  setAutoSelectContext: (enabled) =>
    set((state) => {
      scheduleWorkspacePreferencesPersist({ workspaceAutoSelectContext: enabled });
      return enabled
        ? { autoSelectContext: true }
        : {
            autoSelectContext: false,
            committedWorkspaceId: null,
            activeWorkspaceId:
              state.activeWorkspaceId === state.committedWorkspaceId ? null : state.activeWorkspaceId,
          };
    }),

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

  setNavigationMode: (mode) =>
    set(() => {
      scheduleWorkspacePreferencesPersist({ workspaceNavigationMode: mode });
      return { navigationMode: mode };
    }),

  toggleNavigationMode: () =>
    set((state) => {
      const next: NavigationMode = state.navigationMode === "canvas" ? "pages" : "canvas";
      scheduleWorkspacePreferencesPersist({ workspaceNavigationMode: next });
      return { navigationMode: next };
    }),

  setPageLevel: (level) =>
    set({ pageLevel: level }),

  setPageRegionKey: (key) =>
    set({ pageRegionKey: key }),

  addWidget: (widget) =>
    set((state) => {
      const next = [...state.widgets, widget];
      saveWidgets(next);
      return { widgets: next };
    }),

  updateWidget: (id, patch) =>
    set((state) => {
      const next = state.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w));
      saveWidgets(next);
      return { widgets: next };
    }),

  removeWidget: (id) =>
    set((state) => {
      const next = state.widgets.filter((w) => w.id !== id);
      saveWidgets(next);
      return { widgets: next };
    }),

  setWidgetPlacementHint: (hint) =>
    set({ widgetPlacementHint: hint }),

  setItemPosition: (itemId, x, y) =>
    set((state) => {
      const next: Record<string, ItemPositionOverride> = {
        ...state.itemPositions,
        [itemId]: { itemId, x, y, updatedAt: Date.now() },
      };
      saveItemPositions(next);
      return { itemPositions: next };
    }),

  clearItemPosition: (itemId) =>
    set((state) => {
      const next = { ...state.itemPositions };
      delete next[itemId];
      saveItemPositions(next);
      return { itemPositions: next };
    }),

  setHubOrder: (edge, ids) =>
    set((state) => {
      const next: Record<HubEdge, string[]> = { ...state.hubOrder, [edge]: ids };
      saveHubOrder(next);
      return { hubOrder: next };
    }),

  reorderHub: (edge, fromIdx, toIdx) =>
    set((state) => {
      const list = [...(state.hubOrder[edge] ?? [])];
      if (fromIdx < 0 || fromIdx >= list.length || toIdx < 0 || toIdx >= list.length) return state;
      const [moved] = list.splice(fromIdx, 1);
      list.splice(toIdx, 0, moved);
      const next: Record<HubEdge, string[]> = { ...state.hubOrder, [edge]: list };
      saveHubOrder(next);
      return { hubOrder: next };
    }),
}));
