export const WORKSPACE_STATES = [
  "world_overview",
  "focused",
  "deep_work",
  "command_mode",
  "utility_reveal",
] as const;

export type WorkspaceState = (typeof WORKSPACE_STATES)[number];

export type WorkspaceCanvasState = Extract<
  WorkspaceState,
  "world_overview" | "focused" | "deep_work"
>;

export type WorkspaceStateContext = {
  activeWorkstreamId?: string;
  panelOpen: boolean;
  commandModeOpen: boolean;
  utilityRevealOpen: boolean;
  lastCanvasState?: WorkspaceCanvasState;
};

export type WorkspaceStateSnapshot = WorkspaceStateContext & {
  workspaceState: WorkspaceState;
};

export type ResolvedWorkspaceState = Pick<
  WorkspaceStateSnapshot,
  "workspaceState" | "lastCanvasState" | "commandModeOpen" | "utilityRevealOpen"
>;

export function isCanvasWorkspaceState(
  value: WorkspaceState | undefined,
): value is WorkspaceCanvasState {
  return (
    value === "world_overview"
    || value === "focused"
    || value === "deep_work"
  );
}

export function deriveCanvasWorkspaceState(
  context: Pick<WorkspaceStateContext, "activeWorkstreamId" | "panelOpen">,
): WorkspaceCanvasState {
  if (context.panelOpen) return "deep_work";
  if (context.activeWorkstreamId) return "focused";
  return "world_overview";
}

export function resolveWorkspaceState(
  context: WorkspaceStateContext,
): ResolvedWorkspaceState {
  const canvasState = deriveCanvasWorkspaceState(context);
  const lastCanvasState = isCanvasWorkspaceState(context.lastCanvasState)
    ? context.lastCanvasState
    : canvasState;

  if (context.utilityRevealOpen) {
    return {
      workspaceState: "utility_reveal",
      lastCanvasState,
      commandModeOpen: false,
      utilityRevealOpen: true,
    };
  }

  if (context.commandModeOpen && canvasState !== "deep_work") {
    return {
      workspaceState: "command_mode",
      lastCanvasState,
      commandModeOpen: true,
      utilityRevealOpen: false,
    };
  }

  return {
    workspaceState: canvasState,
    lastCanvasState: canvasState,
    commandModeOpen: false,
    utilityRevealOpen: false,
  };
}

export function deriveCommandSurfaceMode(
  snapshot: Pick<WorkspaceStateSnapshot, "workspaceState">,
): "ambient" | "expanded" | "panel-footer" {
  if (snapshot.workspaceState === "deep_work") {
    return "panel-footer";
  }
  if (snapshot.workspaceState === "command_mode") {
    return "expanded";
  }
  return "ambient";
}
