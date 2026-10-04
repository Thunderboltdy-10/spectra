// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { planLayout, type BarCommand, type CollapseStep } from "../adaptive-bar";
import { IconButton } from "../icon-button";
import { SplitButton } from "../split-button";

const commands: BarCommand[] = [
  { id: "status", icon: "saved", label: "Saved", pinned: true, render: () => null },
  { id: "share", icon: "share", label: "Share" },
  { id: "filter", icon: "filter", label: "Filter", group: "sort" },
  { id: "sort", icon: "sort", label: "Sort", group: "sort" },
  { id: "export", icon: "external", label: "Export", labelPolicy: "always" },
  { id: "close", icon: "close", label: "Close", labelPolicy: "never" },
];
const widths = {
  status: { full: 90, icon: 90 },
  share: { full: 80, icon: 32 },
  filter: { full: 80, icon: 32 },
  sort: { full: 70, icon: 32 },
  export: { full: 84, icon: 32 },
  close: { full: 32, icon: 32 },
};
const plan: CollapseStep[] = [{ hideLabel: "share" }, { toMenu: "group:sort" }, { hideLabel: "export" }, { toMenu: "export" }];
const layout = (available: number) => planLayout({ commands, plan, widths, available, gap: 4, more: 32 });

describe("AdaptiveBar's collapse plan", () => {
  it("shows everything with labels when there is room", () => {
    const { labelHidden, inMenu } = layout(1000);
    expect(labelHidden.size).toBe(0);
    expect(inMenu.size).toBe(0);
  });

  it("applies the authored steps in order, only as far as it needs", () => {
    // 90+80+80+70+84+32 + 5 gaps = 456; hiding Share's label saves 48.
    expect([...layout(410).labelHidden]).toEqual(["share"]);
    expect(layout(410).inMenu.size).toBe(0);
    const narrower = layout(330);
    expect([...narrower.inMenu].sort()).toEqual(["filter", "sort"]);
  });

  it("never hides an `always` label: that command moves into the menu instead", () => {
    const tight = layout(200);
    expect(tight.labelHidden.has("export")).toBe(false);
    expect(tight.inMenu.has("export")).toBe(true);
  });

  it("never collapses a pinned command, whatever the width", () => {
    const tiny = layout(40);
    expect(tiny.inMenu.has("status")).toBe(false);
    expect(tiny.labelHidden.has("status")).toBe(false);
  });

  it("falls back to moving unpinned commands from the end when the plan runs out", () => {
    const tiny = layout(170);
    expect(tiny.inMenu.has("close")).toBe(true);
    expect(tiny.inMenu.has("status")).toBe(false);
  });
});

describe("IconButton", () => {
  it("is always named, with its shortcut exposed", () => {
    render(<IconButton icon="share" label="Share" shortcut="⌘S" />);
    const button = screen.getByRole("button", { name: "Share" });
    expect(button.getAttribute("aria-keyshortcuts")).toBe("⌘S");
    expect(button.querySelector("svg[data-icon='share']")).not.toBeNull();
  });
});

describe("SplitButton", () => {
  it("runs its action and names its menu segment", () => {
    const onClick = vi.fn();
    render(<SplitButton label="Allow" onClick={onClick} items={[{ key: "always", label: "Always allow" }]} onSelect={() => {}} menuLabel="More ways to allow" />);
    screen.getByRole("button", { name: "Allow" }).click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "More ways to allow" })).toBeTruthy();
  });
});
