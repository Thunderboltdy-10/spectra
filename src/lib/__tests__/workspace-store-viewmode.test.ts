import { describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@/stores/workspace-store";

describe("workspace store viewMode compatibility", () => {
  it("defaults to redesign view mode", () => {
    useWorkspaceStore.getState().reset();
    expect(useWorkspaceStore.getState().viewMode).toBe("byType");
  });

  it("accepts redesign values directly", () => {
    useWorkspaceStore.getState().setViewMode("byTopic");
    expect(useWorkspaceStore.getState().viewMode).toBe("byTopic");
    useWorkspaceStore.getState().setViewMode("timeline");
    expect(useWorkspaceStore.getState().viewMode).toBe("timeline");
  });

  it("maps legacy values to redesign values for compatibility", () => {
    useWorkspaceStore.getState().setViewMode("structured" as never);
    expect(useWorkspaceStore.getState().viewMode).toBe("byType");
    useWorkspaceStore.getState().setViewMode("columns" as never);
    expect(useWorkspaceStore.getState().viewMode).toBe("byTopic");
    useWorkspaceStore.getState().setViewMode("graph" as never);
    expect(useWorkspaceStore.getState().viewMode).toBe("timeline");
  });

  it("persists view mode per workstream when committing between workspaces", () => {
    useWorkspaceStore.getState().reset();

    useWorkspaceStore.getState().commitWorkstream("ws_a");
    useWorkspaceStore.getState().setViewMode("byTopic");

    useWorkspaceStore.getState().commitWorkstream("ws_b");
    expect(useWorkspaceStore.getState().viewMode).toBe("byTopic");
    useWorkspaceStore.getState().setViewMode("timeline");

    useWorkspaceStore.getState().commitWorkstream("ws_a");
    expect(useWorkspaceStore.getState().viewMode).toBe("byTopic");

    useWorkspaceStore.getState().commitWorkstream("ws_b");
    expect(useWorkspaceStore.getState().viewMode).toBe("timeline");
  });

  it("retains global fallback mode when exiting a committed workstream", () => {
    useWorkspaceStore.getState().reset();

    useWorkspaceStore.getState().setViewMode("timeline");
    useWorkspaceStore.getState().commitWorkstream("ws_a");
    useWorkspaceStore.getState().setViewMode("byTopic");

    useWorkspaceStore.getState().exitWorkstream();

    expect(useWorkspaceStore.getState().viewMode).toBe("byTopic");
    expect(useWorkspaceStore.getState().viewModeByWorkstream.ws_a).toBe("byTopic");
  });
});
