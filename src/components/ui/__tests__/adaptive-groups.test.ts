import { describe, expect, it } from "vitest";
import { applyOrder, groupedWidth, groupOrderOf, moveKey, planGroupedLayout, type GroupedItem, type GroupedMetrics } from "../adaptive-groups";

const metrics: GroupedMetrics = { gap: 4, groupGap: 12, more: 32, groupMenu: { text: 48, insert: 56 } };

const items: GroupedItem[] = [
  { id: "undo", group: "history", labelPolicy: "never", pinned: true, widths: { full: 32, icon: 32 } },
  { id: "redo", group: "history", labelPolicy: "never", pinned: true, widths: { full: 32, icon: 32 } },
  { id: "bold", group: "text", labelPolicy: "never", widths: { full: 32, icon: 32 } },
  { id: "style", group: "text", widths: { full: 90, icon: 32 } },
  { id: "table", group: "insert", widths: { full: 80, icon: 32 } },
  { id: "citation", group: "insert", labelPolicy: "always", widths: { full: 100, icon: 32 } },
];

const empty = { labelHidden: new Set<string>(), groupMenus: new Set<string>(), inMore: new Set<string>() };

describe("planGroupedLayout", () => {
  it("measures groups with their gaps and dividers", () => {
    // history 32+4+32, text 32+4+90, insert 80+4+100, two group gaps.
    expect(groupedWidth(items, empty, metrics)).toBe(68 + 126 + 184 + 24);
    expect(groupOrderOf(items)).toEqual(["history", "text", "insert"]);
  });

  it("keeps everything when the bar fits", () => {
    const layout = planGroupedLayout({ items, plan: [{ groupMenu: "insert" }], available: 1000, metrics });
    expect(layout.groupMenus.size + layout.labelHidden.size + layout.inMore.size).toBe(0);
    expect(layout.fellBack).toBe(false);
  });

  it("applies the authored steps in order and stops as soon as the bar fits", () => {
    const full = groupedWidth(items, empty, metrics);
    const layout = planGroupedLayout({
      items,
      plan: [{ hideLabel: "style" }, { groupMenu: "insert" }, { toMenu: "group:text" }],
      available: full - 58,
      metrics,
    });
    expect([...layout.labelHidden]).toEqual(["style"]);
    expect(layout.groupMenus.size).toBe(0);
    expect(layout.inMore.size).toBe(0);
  });

  it("never hides an always label, a never label or a pinned command", () => {
    const layout = planGroupedLayout({
      items,
      plan: [{ hideLabel: "group:insert" }, { hideLabel: "group:history" }, { hideLabel: "bold" }],
      available: 0,
      metrics,
    });
    expect(layout.labelHidden.has("table")).toBe(true);
    expect(layout.labelHidden.has("citation")).toBe(false);
    expect(layout.labelHidden.has("undo")).toBe(false);
    expect(layout.labelHidden.has("bold")).toBe(false);
  });

  it("moves a label-dependent group into its dropdown as a unit", () => {
    const layout = planGroupedLayout({ items, plan: [{ groupMenu: "insert" }], available: 280, metrics });
    expect([...layout.groupMenus]).toEqual(["insert"]);
    expect(layout.labelHidden.has("citation")).toBe(false);
    expect(layout.fellBack).toBe(false);
  });

  it("never folds or moves the group that holds undo and redo", () => {
    const layout = planGroupedLayout({
      items,
      plan: [{ groupMenu: "history" }, { toMenu: "group:history" }],
      available: 0,
      metrics,
    });
    expect(layout.groupMenus.has("history")).toBe(false);
    expect(layout.inMore.has("undo")).toBe(false);
    expect(layout.inMore.has("redo")).toBe(false);
  });

  it("falls back to folding groups from the end, then More, and says so", () => {
    const folded = planGroupedLayout({ items, plan: [], available: 68 + 12 + 126 + 12 + 56, metrics });
    expect([...folded.groupMenus]).toEqual(["insert"]);
    expect(folded.fellBack).toBe(true);
    const tight = planGroupedLayout({ items, plan: [], available: 120, metrics });
    expect(tight.inMore.has("table")).toBe(true);
    expect(tight.inMore.has("bold")).toBe(true);
    expect(tight.inMore.has("undo")).toBe(false);
  });
});

describe("saved orders", () => {
  it("puts the person's order first and keeps the rest in shipped order", () => {
    expect(applyOrder(["a", "b", "c", "d"], (value) => value, ["c", "a"])).toEqual(["c", "a", "b", "d"]);
  });

  it("ignores stale keys and never drops or duplicates a value", () => {
    expect(applyOrder(["a", "b"], (value) => value, ["gone", "b", "b"])).toEqual(["b", "a"]);
    expect(applyOrder(["a", "b"], (value) => value, undefined)).toEqual(["a", "b"]);
  });

  it("moves a key before another, or to the end", () => {
    expect(moveKey(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveKey(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
    expect(moveKey(["a", "b"], "a", "missing")).toEqual(["b", "a"]);
  });
});
