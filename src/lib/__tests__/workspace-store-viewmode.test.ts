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
});
