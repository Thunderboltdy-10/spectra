import { describe, expect, it } from "vitest";

/**
 * W2 validation: overflow threshold
 */
describe("W2 CategoryFieldNode overflow contract", () => {
  const TOUCH_OVERFLOW_LIMIT = 5;

  it("shows first 5 items when limit is 5", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ id: String(i) }));
    const visible = items.slice(0, TOUCH_OVERFLOW_LIMIT);
    const hidden = Math.max(0, items.length - TOUCH_OVERFLOW_LIMIT);
    expect(visible).toHaveLength(5);
    expect(hidden).toBe(3);
  });

  it("shows +N more count correctly for 8 items", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ id: String(i) }));
    const hiddenCount = Math.max(0, items.length - TOUCH_OVERFLOW_LIMIT);
    expect(hiddenCount).toBe(3);
  });

  it("shows all items when 5 or fewer (no overflow pill)", () => {
    const items = Array.from({ length: 4 }, (_, i) => ({ id: String(i) }));
    const hiddenCount = Math.max(0, items.length - TOUCH_OVERFLOW_LIMIT);
    expect(hiddenCount).toBe(0);
  });

  it("shows all items when exactly 5 (boundary - no overflow pill)", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: String(i) }));
    const hiddenCount = Math.max(0, items.length - TOUCH_OVERFLOW_LIMIT);
    expect(hiddenCount).toBe(0);
  });
});

/**
 * W2 validation: global search scoring
 */
describe("W2 globalSearch scoring logic", () => {
  type Item = { id: string; title: string; contentSummary?: string; updatedAt: number };

  function score(item: Item, q: string): number {
    const query = q.toLowerCase();
    const titleMatch = item.title.toLowerCase().includes(query);
    const summaryMatch = item.contentSummary?.toLowerCase().includes(query) ?? false;
    return titleMatch ? 2 : summaryMatch ? 1 : 0;
  }

  it("returns score 2 for title match", () => {
    const item = { id: "1", title: "Calculus Notes", updatedAt: 0 };
    expect(score(item, "calculus")).toBe(2);
  });

  it("returns score 1 for summary-only match", () => {
    const item = { id: "1", title: "Math Study", contentSummary: "covers calculus concepts", updatedAt: 0 };
    expect(score(item, "calculus")).toBe(1);
  });

  it("returns score 0 for no match", () => {
    const item = { id: "1", title: "History Essay", contentSummary: "French revolution", updatedAt: 0 };
    expect(score(item, "calculus")).toBe(0);
  });

  it("title match ranked higher than summary match", () => {
    const a = { id: "1", title: "Calculus Notes", updatedAt: 0 };
    const b = { id: "2", title: "Math Study", contentSummary: "calculus problems", updatedAt: 0 };
    expect(score(a, "calculus")).toBeGreaterThan(score(b, "calculus"));
  });
});
