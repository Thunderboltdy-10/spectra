import { create } from "zustand";
import type { ZoomTier, ViewMode, WorkspaceData } from "@/lib/workspace/contracts";
import { zoomTierForLevel, VIEWPORT } from "@/lib/workspace/contracts";

export type PanelTarget = {
  type: "chat" | "note" | "artifact" | "planner";
  id?: string;
  workspaceId?: string;
} | null;

type WorkspaceState = {
  /* u2500u2500 Camera u2500u2500 */
  zoom: number;
  zoomTier: ZoomTier;
  viewportX: number;
  viewportY: number;

  /* u2500u2500 Navigation u2500u2500 */
  activeWorkspaceId: string | null;
  /** The workspace the user has "committed" into (entered) */
  committedWorkspaceId: string | null;
  viewMode: ViewMode;

  /* u2500u2500 Focus u2500u2500 */
  focusedItemId: string | null;

  /* u2500u2500 Panel u2500u2500 */
  panelOpen: boolean;
  panelTarget: PanelTarget;

  /* u2500u2500 Hub u2500u2500 */
  hubCollapsed: boolean;
  plannerOpen: boolean;

  /* u2500u2500 Workspaces data (ephemeral, for display) u2500u2500 */
  workspaces: WorkspaceData[];

  /* u2500u2500 Actions u2500u2500 */
  setZoom: (zoom: number) => void;
  setViewport: (x: number, y: number, zoom: number) => void;
  setActiveWorkspace: (id: string | null) => void;
  commitToWorkspace: (id: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setFocusedItem: (id: string | null) => void;
  openPanel: (target: PanelTarget) => void;
  closePanel: () => void;
  toggleHub: () => void;
  togglePlanner: () => void;
  setWorkspaces: (workspaces: WorkspaceData[]) => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  zoom: VIEWPORT.DEFAULT_ZOOM,
  zoomTier: zoomTierForLevel(VIEWPORT.DEFAULT_ZOOM),
  viewportX: 0,
  viewportY: 0,

  activeWorkspaceId: null,
  committedWorkspaceId: null,
  viewMode: "byType",

  focusedItemId: null,

  panelOpen: false,
  panelTarget: null,

  hubCollapsed: false,
  plannerOpen: false,

  workspaces: [],

  setZoom: (zoom) =>
    set({ zoom, zoomTier: zoomTierForLevel(zoom) }),

  setViewport: (x, y, zoom) =>
    set({ viewportX: x, viewportY: y, zoom, zoomTier: zoomTierForLevel(zoom) }),

  setActiveWorkspace: (id) =>
    set({ activeWorkspaceId: id }),

  commitToWorkspace: (id) =>
    set({ committedWorkspaceId: id, activeWorkspaceId: id }),

  setViewMode: (mode) =>
    set({ viewMode: mode }),

  setFocusedItem: (id) =>
    set({ focusedItemId: id }),

  openPanel: (target) =>
    set({ panelOpen: true, panelTarget: target }),

  closePanel: () =>
    set({ panelOpen: false, panelTarget: null }),

  toggleHub: () =>
    set((state) => ({ hubCollapsed: !state.hubCollapsed })),

  togglePlanner: () =>
    set((state) => ({ plannerOpen: !state.plannerOpen })),

  setWorkspaces: (workspaces) =>
    set({ workspaces }),
}));
