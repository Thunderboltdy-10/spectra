import { describe, expect, it } from "vitest";
import {
  deriveCommandSurfaceMode,
  resolveWorkspaceState,
} from "@/lib/workspace/state-machine";

describe("workspace state machine", () => {
  it("resolves explicit canvas states without zoom-band coupling", () => {
    expect(resolveWorkspaceState({
      activeWorkstreamId: undefined,
      panelOpen: false,
      commandModeOpen: false,
      utilityRevealOpen: false,
    })).toEqual({
      workspaceState: "world_overview",
      lastCanvasState: "world_overview",
      commandModeOpen: false,
      utilityRevealOpen: false,
    });

    expect(resolveWorkspaceState({
      activeWorkstreamId: "ws_1",
      panelOpen: false,
      commandModeOpen: false,
      utilityRevealOpen: false,
    })).toEqual({
      workspaceState: "focused",
      lastCanvasState: "focused",
      commandModeOpen: false,
      utilityRevealOpen: false,
    });

    expect(resolveWorkspaceState({
      activeWorkstreamId: "ws_1",
      panelOpen: true,
      commandModeOpen: false,
      utilityRevealOpen: false,
    })).toEqual({
      workspaceState: "deep_work",
      lastCanvasState: "deep_work",
      commandModeOpen: false,
      utilityRevealOpen: false,
    });
  });

  it("layers command and utility states over the last canvas state", () => {
    expect(resolveWorkspaceState({
      activeWorkstreamId: "ws_1",
      panelOpen: false,
      commandModeOpen: true,
      utilityRevealOpen: false,
      lastCanvasState: "focused",
    })).toEqual({
      workspaceState: "command_mode",
      lastCanvasState: "focused",
      commandModeOpen: true,
      utilityRevealOpen: false,
    });

    expect(resolveWorkspaceState({
      activeWorkstreamId: "ws_1",
      panelOpen: false,
      commandModeOpen: true,
      utilityRevealOpen: true,
      lastCanvasState: "focused",
    })).toEqual({
      workspaceState: "utility_reveal",
      lastCanvasState: "focused",
      commandModeOpen: false,
      utilityRevealOpen: true,
    });
  });

  it("maps command surface presentation from explicit workspace state", () => {
    expect(deriveCommandSurfaceMode({ workspaceState: "world_overview" })).toBe("ambient");
    expect(deriveCommandSurfaceMode({ workspaceState: "command_mode" })).toBe("expanded");
    expect(deriveCommandSurfaceMode({ workspaceState: "deep_work" })).toBe("panel-footer");
  });
});
