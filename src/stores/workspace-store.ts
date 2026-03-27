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

type WorkspaceStoreState = {
  camera: WorkspaceCameraState;
  selectedWorkstreamId?: string;
  showArchived: boolean;
  showConnections: boolean;
  backgroundMode: WorkspaceBackgroundMode;
  isCreateDialogOpen: boolean;
  // Focus mode — "entering" a workstream or hub
  focusedWorkstreamId?: string;
  focusCardBounds?: CardBounds;
  hubFocusOpen: boolean;
  hubCardBounds?: CardBounds;
  // Initial chat query when focusing a workstream via QuickChatBar
  openChatQuery?: string;
  // Actions
  setCamera: (camera: WorkspaceCameraState) => void;
  setSelectedWorkstreamId: (workstreamId?: string) => void;
  setShowArchived: (showArchived: boolean) => void;
  setShowConnections: (showConnections: boolean) => void;
  setBackgroundMode: (backgroundMode: WorkspaceBackgroundMode) => void;
  openCreateDialog: () => void;
  closeCreateDialog: () => void;
  focusWorkstream: (workstreamId: string, bounds: CardBounds) => void;
  focusWorkstreamWithChat: (workstreamId: string, bounds: CardBounds, query?: string) => void;
  exitWorkstream: () => void;
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
  focusedWorkstreamId: undefined,
  focusCardBounds: undefined,
  hubFocusOpen: false,
  hubCardBounds: undefined,
  openChatQuery: undefined,

  setCamera: (camera) => set({ camera }),
  setSelectedWorkstreamId: (selectedWorkstreamId) => set({ selectedWorkstreamId }),
  setShowArchived: (showArchived) => set({ showArchived }),
  setShowConnections: (showConnections) => set({ showConnections }),
  setBackgroundMode: (backgroundMode) => set({ backgroundMode }),
  openCreateDialog: () => set({ isCreateDialogOpen: true }),
  closeCreateDialog: () => set({ isCreateDialogOpen: false }),

  focusWorkstream: (focusedWorkstreamId, focusCardBounds) =>
    set({ focusedWorkstreamId, focusCardBounds, openChatQuery: undefined }),
  focusWorkstreamWithChat: (focusedWorkstreamId, focusCardBounds, query) =>
    set({ focusedWorkstreamId, focusCardBounds, openChatQuery: query }),
  exitWorkstream: () =>
    set({ focusedWorkstreamId: undefined, focusCardBounds: undefined, openChatQuery: undefined }),

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
      focusedWorkstreamId: undefined,
      focusCardBounds: undefined,
      hubFocusOpen: false,
      hubCardBounds: undefined,
      openChatQuery: undefined,
    }),
}));
