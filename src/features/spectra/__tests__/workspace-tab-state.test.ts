import { describe, expect, it } from "vitest";
import { parseWorkspaceHubTabs } from "../components/workspace-tab-state";
import { artifactIdFromSpectraLocation } from "../pages/shell-location";

describe("workspace hub tab persistence", () => {
  it("reads the synchronous browser location across close and work-to-work navigation", () => {
    expect(
      artifactIdFromSpectraLocation("/library", "?artifactId=work-a"),
    ).toBe("work-a");
    expect(artifactIdFromSpectraLocation("/library", "")).toBeUndefined();
    expect(
      artifactIdFromSpectraLocation("/library", "?artifactId=work-b"),
    ).toBe("work-b");
    expect(
      artifactIdFromSpectraLocation(
        "/library/work%2Flegacy",
        "?artifactId=work-b",
      ),
    ).toBe("work/legacy");
  });
  it("drops wrong-table and stale workspace ids before activation", () => {
    const result = parseWorkspaceHubTabs(
      {
        activeId: "bad-tab",
        tabs: [
          {
            id: "bad-tab",
            label: "Old widget",
            workspaceId: "t57ax7akvh0w6j3zzqkr800kzd88vdrr",
          },
          { id: "good-tab", label: "Biology", workspaceId: "workspace-good" },
        ],
      },
      new Set(["workspace-good"]),
    );
    expect(result.tabs).toEqual([
      { id: "good-tab", label: "Biology", workspaceId: "workspace-good" },
    ]);
    expect(result.activeId).toBe("good-tab");
  });

  it("rejects malformed persisted rows", () => {
    expect(
      parseWorkspaceHubTabs({ tabs: [{ id: 1, label: "Bad" }, null] }).tabs,
    ).toEqual([]);
  });

  it("repairs duplicate destinations while preserving the active tab", () => {
    const result = parseWorkspaceHubTabs({
      activeId: "home-active",
      tabs: [
        { id: "home-old", label: "Home" },
        { id: "workspace-old", label: "Biology", workspaceId: "workspace-1" },
        { id: "home-active", label: "Home" },
        { id: "workspace-new", label: "Biology", workspaceId: "workspace-1" },
      ],
    });

    expect(result.tabs).toEqual([
      { id: "home-active", label: "Home", workspaceId: undefined },
      { id: "workspace-old", label: "Biology", workspaceId: "workspace-1" },
    ]);
    expect(result.activeId).toBe("home-active");
  });
});
