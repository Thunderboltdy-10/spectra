"use client";

import { create } from "zustand";
import {
  DEFAULT_UTILITY_ZONES,
  type WorkspaceUtilityType,
  type WorkspaceUtilityZone,
} from "@/lib/workspace/contracts";
import {
  resolveWorkspaceState,
  type WorkspaceCanvasState,
  type WorkspaceState,
} from "@/lib/workspace/state-machine";

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

/** Zoom bands are still used as a presentation hint by the legacy canvas renderer. */
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

  // Semantic zoom — primary focus plus any visible internal workstreams
  primaryWorkstreamId?: string;
  visibleWorkstreamIds: string[];
  zoomBand: ZoomBand;
  workspaceState: WorkspaceState;
  lastCanvasState: WorkspaceCanvasState;
  commandModeOpen: boolean;
  utilityRevealOpen: boolean;

  // View mode per committed workstream
  viewMode: WorkspaceViewMode;

  // Right push-panel
  panel?: PanelState;

  // Initial chat query when entering a workstream via quick chat
  openChatQuery?: string;

  // Previous viewport for zoom-out restoration
  previousViewport?: { x: number; y: number; zoom: number };

  // Focus timer
  timerState: {
    active: boolean;
    sessionMinutes: number;
    elapsed: number; // seconds elapsed in current session
    sessionsCompleted: number;
    workstreamId?: string;
    workstreamTitle?: string;
  };

  edgeUtilityZones: Partial<Record<WorkspaceUtilityType, WorkspaceUtilityZone>>;

  // Actions
  setCamera: (camera: WorkspaceCameraState) => void;
  setZoomBand: (band: ZoomBand) => void;
  setWorkspaceState: (workspaceState: WorkspaceState) => void;
  enterCommandMode: () => void;
  exitCommandMode: () => void;
  setUtilityRevealOpen: (open: boolean) => void;
  setUtilityZone: (utility: WorkspaceUtilityType, zone: WorkspaceUtilityZone) => void;
  setSelectedWorkstreamId: (workstreamId?: string) => void;
  setShowArchived: (showArchived: boolean) => void;
  setShowConnections: (showConnections: boolean) => void;
  setBackgroundMode: (backgroundMode: WorkspaceBackgroundMode) => void;
  openCreateDialog: () => void;
  closeCreateDialog: () => void;

  // Semantic zoom commitment
  commitWorkstream: (workstreamId: string) => void;
  commitWorkstreamWithChat: (workstreamId: string, query?: string) => void;
  setPrimaryWorkstreamId: (workstreamId?: string) => void;
  setVisibleWorkstreamIds: (workstreamIds: string[]) => void;
  exitWorkstream: () => void;
  setPreviousViewport: (viewport: { x: number; y: number; zoom: number }) => void;

  // View modes
  setViewMode: (mode: WorkspaceViewMode) => void;

  // Push panel
  openPanel: (type: PanelType, id: string) => void;
  closePanel: () => void;
  setOpenChatQuery: (query?: string) => void;
  clearOpenChatQuery: () => void;

  // Timer
  setTimerMinutes: (minutes: number) => void;
  startTimer: (sessionMinutes?: number, workstreamId?: string, workstreamTitle?: string) => void;
  pauseTimer: () => void;
  resetTimer: () => void;
  tickTimer: () => void;
  completeTimerSession: () => void;

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
  primaryWorkstreamId: undefined,
  visibleWorkstreamIds: [],
  zoomBand: "summary",
  workspaceState: "world_overview",
  lastCanvasState: "world_overview",
  commandModeOpen: false,
  utilityRevealOpen: false,
  viewMode: "structured",
  panel: undefined,
  openChatQuery: undefined,
  previousViewport: undefined,
  timerState: {
    active: false,
    sessionMinutes: 25,
    elapsed: 0,
    sessionsCompleted: 0,
  },
  edgeUtilityZones: { ...DEFAULT_UTILITY_ZONES },

  setCamera: (camera) => set({ camera }),
  setZoomBand: (zoomBand) => set({ zoomBand }),
  setWorkspaceState: (workspaceState) =>
    set((state) => resolveWorkspaceState({
      activeWorkstreamId: state.primaryWorkstreamId,
      panelOpen: !!state.panel,
      commandModeOpen: workspaceState === "command_mode",
      utilityRevealOpen: workspaceState === "utility_reveal",
      lastCanvasState: state.lastCanvasState,
    })),
  enterCommandMode: () =>
    set((state) => resolveWorkspaceState({
      activeWorkstreamId: state.primaryWorkstreamId,
      panelOpen: !!state.panel,
      commandModeOpen: state.workspaceState !== "deep_work",
      utilityRevealOpen: false,
      lastCanvasState: state.lastCanvasState,
    })),
  exitCommandMode: () =>
    set((state) => resolveWorkspaceState({
      activeWorkstreamId: state.primaryWorkstreamId,
      panelOpen: !!state.panel,
      commandModeOpen: false,
      utilityRevealOpen: state.utilityRevealOpen,
      lastCanvasState: state.lastCanvasState,
    })),
  setUtilityRevealOpen: (open) =>
    set((state) => resolveWorkspaceState({
      activeWorkstreamId: state.primaryWorkstreamId,
      panelOpen: !!state.panel,
      commandModeOpen: open ? false : state.commandModeOpen,
      utilityRevealOpen: open,
      lastCanvasState: state.lastCanvasState,
    })),
  setUtilityZone: (utility, zone) =>
    set((state) => ({
      edgeUtilityZones: {
        ...state.edgeUtilityZones,
        [utility]: zone,
      },
    })),
  setSelectedWorkstreamId: (selectedWorkstreamId) => set({ selectedWorkstreamId }),
  setShowArchived: (showArchived) => set({ showArchived }),
  setShowConnections: (showConnections) => set({ showConnections }),
  setBackgroundMode: (backgroundMode) => set({ backgroundMode }),
  openCreateDialog: () => set({ isCreateDialogOpen: true }),
  closeCreateDialog: () => set({ isCreateDialogOpen: false }),

  commitWorkstream: (workstreamId) =>
    set((state) => ({
      primaryWorkstreamId: workstreamId,
      visibleWorkstreamIds: [workstreamId],
      openChatQuery: undefined,
      panel: undefined,
      ...resolveWorkspaceState({
        activeWorkstreamId: workstreamId,
        panelOpen: false,
        commandModeOpen: false,
        utilityRevealOpen: false,
        lastCanvasState: state.lastCanvasState,
      }),
    })),
  commitWorkstreamWithChat: (workstreamId, query) =>
    set((state) => ({
      primaryWorkstreamId: workstreamId,
      visibleWorkstreamIds: [workstreamId],
      openChatQuery: query,
      panel: query ? { type: "chat", id: "new" } : undefined,
      ...resolveWorkspaceState({
        activeWorkstreamId: workstreamId,
        panelOpen: !!query,
        commandModeOpen: false,
        utilityRevealOpen: false,
        lastCanvasState: state.lastCanvasState,
      }),
    })),
  setPrimaryWorkstreamId: (primaryWorkstreamId) => set({ primaryWorkstreamId }),
  setVisibleWorkstreamIds: (visibleWorkstreamIds) => set({ visibleWorkstreamIds }),
  exitWorkstream: () =>
    set((state) => ({
      primaryWorkstreamId: undefined,
      visibleWorkstreamIds: [],
      openChatQuery: undefined,
      panel: undefined,
      ...resolveWorkspaceState({
        activeWorkstreamId: undefined,
        panelOpen: false,
        commandModeOpen: false,
        utilityRevealOpen: false,
        lastCanvasState: state.lastCanvasState,
      }),
    })),
  setPreviousViewport: (viewport) => set({ previousViewport: viewport }),

  setViewMode: (viewMode) => set({ viewMode }),

  openPanel: (type, id) =>
    set((state) => ({
      panel: { type, id },
      ...resolveWorkspaceState({
        activeWorkstreamId: state.primaryWorkstreamId,
        panelOpen: true,
        commandModeOpen: false,
        utilityRevealOpen: false,
        lastCanvasState: state.lastCanvasState,
      }),
    })),
  closePanel: () =>
    set((state) => ({
      panel: undefined,
      ...resolveWorkspaceState({
        activeWorkstreamId: state.primaryWorkstreamId,
        panelOpen: false,
        commandModeOpen: false,
        utilityRevealOpen: state.utilityRevealOpen,
        lastCanvasState: state.lastCanvasState,
      }),
    })),
  setOpenChatQuery: (query) => set({ openChatQuery: query }),
  clearOpenChatQuery: () => set({ openChatQuery: undefined }),

  setTimerMinutes: (minutes) =>
    set((state) => ({
      timerState: { ...state.timerState, sessionMinutes: minutes, elapsed: 0 },
    })),
  startTimer: (sessionMinutes, workstreamId, workstreamTitle) => {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ai-school:timer-start"));
    set((state) => ({
      timerState: {
        ...state.timerState,
        active: true,
        sessionMinutes: sessionMinutes ?? state.timerState.sessionMinutes,
        workstreamId: workstreamId ?? state.timerState.workstreamId,
        workstreamTitle: workstreamTitle ?? state.timerState.workstreamTitle,
      },
    }));
  },
  pauseTimer: () => {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ai-school:timer-pause"));
    set((state) => ({
      timerState: { ...state.timerState, active: false },
    }));
  },
  resetTimer: () => {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("ai-school:timer-reset"));
    set((state) => ({
      timerState: { ...state.timerState, active: false, elapsed: 0 },
    }));
  },
  tickTimer: () =>
    set((state) => ({
      timerState: { ...state.timerState, elapsed: state.timerState.elapsed + 1 },
    })),
  completeTimerSession: () =>
    set((state) => ({
      timerState: {
        ...state.timerState,
        active: false,
        elapsed: 0,
        sessionsCompleted: state.timerState.sessionsCompleted + 1,
      },
    })),

  reset: () =>
    set({
      camera: DEFAULT_CAMERA,
      selectedWorkstreamId: undefined,
      showArchived: true,
      showConnections: true,
      backgroundMode: "dots",
      isCreateDialogOpen: false,
      primaryWorkstreamId: undefined,
      visibleWorkstreamIds: [],
      openChatQuery: undefined,
      zoomBand: "summary",
      workspaceState: "world_overview",
      lastCanvasState: "world_overview",
      commandModeOpen: false,
      utilityRevealOpen: false,
      viewMode: "structured",
      panel: undefined,
      previousViewport: undefined,
      edgeUtilityZones: { ...DEFAULT_UTILITY_ZONES },
      timerState: {
        active: false,
        sessionMinutes: 25,
        elapsed: 0,
        sessionsCompleted: 0,
      },
    }),
}));
