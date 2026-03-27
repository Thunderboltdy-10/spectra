"use client";

import create from "zustand";

export type WorkspaceCameraState = {
  x: number;
  y: number;
  z: number;
};

type WorkspaceStoreState = {
  camera: WorkspaceCameraState;
  selectedWorkstreamId?: string;
  showArchived: boolean;
  showConnections: boolean;
  isCreateDialogOpen: boolean;
  setCamera: (camera: WorkspaceCameraState) => void;
  setSelectedWorkstreamId: (workstreamId?: string) => void;
  setShowArchived: (showArchived: boolean) => void;
  setShowConnections: (showConnections: boolean) => void;
  openCreateDialog: () => void;
  closeCreateDialog: () => void;
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
  isCreateDialogOpen: false,
  setCamera: (camera) => set({ camera }),
  setSelectedWorkstreamId: (selectedWorkstreamId) => set({ selectedWorkstreamId }),
  setShowArchived: (showArchived) => set({ showArchived }),
  setShowConnections: (showConnections) => set({ showConnections }),
  openCreateDialog: () => set({ isCreateDialogOpen: true }),
  closeCreateDialog: () => set({ isCreateDialogOpen: false }),
  reset: () =>
    set({
      camera: DEFAULT_CAMERA,
      selectedWorkstreamId: undefined,
      showArchived: true,
      showConnections: true,
      isCreateDialogOpen: false,
    }),
}));
