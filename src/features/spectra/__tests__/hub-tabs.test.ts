import { describe, expect, it } from "vitest";
import { hubTabsWithoutWorkspace } from "../pages/hub-tabs";

const home = () => ({ id: "home-new", label: "Home" });

describe("hub tabs after a workspace is deleted", () => {
  it("closes every tab of it and keeps the active one when it survives", () => {
    const tabs = [{ id: "a", label: "Home" }, { id: "b", label: "Biology", workspaceId: "w1" }, { id: "c", label: "Maths", workspaceId: "w2" }];
    expect(hubTabsWithoutWorkspace(tabs, "c", "w1", home)).toEqual({ tabs: [tabs[0], tabs[2]], activeId: "c" });
  });

  it("moves to Home when the deleted workspace was the active tab", () => {
    const tabs = [{ id: "c", label: "Maths", workspaceId: "w2" }, { id: "a", label: "Home" }, { id: "b", label: "Biology", workspaceId: "w1" }];
    expect(hubTabsWithoutWorkspace(tabs, "b", "w1", home).activeId).toBe("a");
  });

  it("opens a Home tab when nothing is left", () => {
    expect(hubTabsWithoutWorkspace([{ id: "b", label: "Biology", workspaceId: "w1" }], "b", "w1", home)).toEqual({
      tabs: [{ id: "home-new", label: "Home" }],
      activeId: "home-new",
    });
  });
});
