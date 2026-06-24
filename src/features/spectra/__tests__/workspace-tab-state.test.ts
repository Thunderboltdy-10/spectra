import { describe, expect, it } from "vitest";
import { parseWorkspaceHubTabs } from "../components/workspace-tab-state";

describe("workspace hub tab persistence", () => {
  it("drops wrong-table and stale workspace ids before activation", () => {
    const result = parseWorkspaceHubTabs({
      activeId: "bad-tab",
      tabs: [
        { id: "bad-tab", label: "Old widget", workspaceId: "t57ax7akvh0w6j3zzqkr800kzd88vdrr" },
        { id: "good-tab", label: "Biology", workspaceId: "workspace-good" },
      ],
    }, new Set(["workspace-good"]));
    expect(result.tabs).toEqual([{ id: "good-tab", label: "Biology", workspaceId: "workspace-good" }]);
    expect(result.activeId).toBe("good-tab");
  });

  it("rejects malformed persisted rows", () => {
    expect(parseWorkspaceHubTabs({ tabs: [{ id: 1, label: "Bad" }, null] }).tabs).toEqual([]);
  });
});
