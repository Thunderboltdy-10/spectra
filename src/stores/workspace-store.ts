"use client";

import { create } from "zustand";

export type WorkspaceCameraState = {
  x: number;
  y: number;
  z: number;
};

export type CardBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type WorkspaceBackgroundMode = "dots" | "grid" | "blank";

export type WorkspaceViewMode = "structured" | "columns" | "graph";

/** Semantic zoom bands */
export type ZoomBand = "overview" | "summary" | "detail" | "internal";

/** Panel types for the right push-panel */
export type PanelType = "chat" | "note" | "artifact" | "planner" | "route-trace";

type PanelState = {
  type: PanelType;
  id: string; // threadId, noteId, artifactId, etc.
};

type WorkspaceStoreState = {
  camera: WorkspaceCameraState;
  selectedWorkstreamId?: string;
  showArchived: boolean;
  showConnections: boolean;
  backgroundMode: WorkspaceBackgroundMode;
  isCreateDialogOpen: boolean;

  // Semantic zoom — committed workstream via zoom or click
  committedWorkstreamId?: string;
  zoomBand: ZoomBand;

  // View mode per committed workstream
  viewMode: WorkspaceViewMode;

  // Right push-panel
  panel?: PanelState;

  // Initial chat query when entering a workstream via quick chat
  openChatQuery?: string;

  // Previous viewport for zoom-out restoration
  previousViewport?: { x: number; y: number; zoom: number };

  // Hub
  hubFocusOpen: boolean;
  hubCardBounds?: CardBounds;

  // Actions
  setCamera: (camera: WorkspaceCameraState) => void;
  setZoomBand: (band: ZoomBand) => void;
  setSelectedWorkstreamId: (workstreamId?: string) => void;
  setShowArchived: (showArchived: boolean) => void;
  setShowConnections: (showConnections: boolean) => void;
  setBackgroundMode: (backgroundMode: WorkspaceBackgroundMode) => void;
  openCreateDialog: () => void;
  closeCreateDialog: () => void;

  // Semantic zoom commitment
  commitWorkstream: (workstreamId: string) => void;
  commitWorkstreamWithChat: (workstreamId: string, query?: string) => void;
  exitWorkstream: () => void;
  setPreviousViewport: (viewport: { x: number; y: number; zoom: number }) => void;

  // View modes
  setViewMode: (mode: WorkspaceViewMode) => void;

  // Push panel
  openPanel: (type: PanelType, id: string) => void;
  closePanel: () => void;
  setOpenChatQuery: (query?: string) => void;
  clearOpenChatQuery: () => void;

  // Hub
  focusHub: (bounds: CardBounds) => void;
  exitHub: () => void;

  reset: () => void;
};

const DEFAULT_CAMERA: WorkspaceCameraState = {
  x: 0,
  y: 0,
  z: 1,
};

export const useWorkspaceStore = create<WorkspaceStoreState>((set) => ({
  camera: DEFAULT_CAMERA,
  selectedWorkstreamId: undefined,
  showArchived: true,
  showConnections: true,
  backgroundMode: "dots",
  isCreateDialogOpen: false,
  committedWorkstreamId: undefined,
  zoomBand: "summary",
  viewMode: "structured",
  panel: undefined,
  openChatQuery: undefined,
  previousViewport: undefined,
  hubFocusOpen: false,
  hubCardBounds: undefined,

  setCamera: (camera) => set({ camera }),
  setZoomBand: (zoomBand) => set({ zoomBand }),
  setSelectedWorkstreamId: (selectedWorkstreamId) => set({ selectedWorkstreamId }),
  setShowArchived: (showArchived) => set({ showArchived }),
  setShowConnections: (showConnections) => set({ showConnections }),
  setBackgroundMode: (backgroundMode) => set({ backgroundMode }),
  openCreateDialog: () => set({ isCreateDialogOpen: true }),
  closeCreateDialog: () => set({ isCreateDialogOpen: false }),

  commitWorkstream: (workstreamId) =>
    set({
      committedWorkstreamId: workstreamId,
      openChatQuery: undefined,
    }),
  commitWorkstreamWithChat: (workstreamId, query) =>
    set({
      committedWorkstreamId: workstreamId,
      openChatQuery: query,
      panel: query ? { type: "chat", id: "new" } : undefined,
    }),
  exitWorkstream: () =>
    set({
      committedWorkstreamId: undefined,
      openChatQuery: undefined,
      panel: undefined,
    }),
  setPreviousViewport: (viewport) => set({ previousViewport: viewport }),

  setViewMode: (viewMode) => set({ viewMode }),

  openPanel: (type, id) => set({ panel: { type, id } }),
  closePanel: () => set({ panel: undefined }),
  setOpenChatQuery: (query) => set({ openChatQuery: query }),
  clearOpenChatQuery: () => set({ openChatQuery: undefined }),

  focusHub: (hubCardBounds) => set({ hubFocusOpen: true, hubCardBounds }),
  exitHub: () => set({ hubFocusOpen: false, hubCardBounds: undefined }),

  reset: () =>
    set({
      camera: DEFAULT_CAMERA,
      selectedWorkstreamId: undefined,
      showArchived: true,
      showConnections: true,
      backgroundMode: "dots",
      isCreateDialogOpen: false,
      committedWorkstreamId: undefined,
      hubFocusOpen: false,
      hubCardBounds: undefined,
      openChatQuery: undefined,
      zoomBand: "summary",
      viewMode: "structured",
      panel: undefined,
      previousViewport: undefined,
    }),
}));
