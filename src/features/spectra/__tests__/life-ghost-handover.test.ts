// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { figureOf } from "../life/figure-dom";
import { replacementOf } from "../life/life-field";

function box(element: Element, x: number, y: number, width: number, height: number) {
  const rect = { x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) } as DOMRect;
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect);
  return rect;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("ghosts", () => {
  it("draws a bare list as its rows alone, with no frame of its own", () => {
    const list = document.createElement("div");
    const row = document.createElement("div");
    row.setAttribute("data-life-ghost-bar", "");
    list.append(row);
    document.body.append(list);
    box(list, 0, 0, 300, 120);
    box(row, 10, 10, 200, 12);
    const framed = figureOf(list, { bars: "[data-life-ghost-bar]" });
    const bare = figureOf(list, { bars: "[data-life-ghost-bar]", frame: false });
    expect(bare.strokes.length).toBe(framed.strokes.length - 1);
    expect(bare.fill).toBeUndefined();
  });

  it("hands over to the content that took its place, not to the page around it", () => {
    const page = document.createElement("main");
    const list = document.createElement("section");
    const row = document.createElement("div");
    list.append(row);
    page.append(list);
    document.body.append(page);
    const ghost = box(document.createElement("div"), 0, 0, 300, 200);
    box(page, 0, 0, 1200, 900);
    box(list, 0, 0, 300, 220);
    box(row, 0, 90, 300, 30);
    document.elementFromPoint = vi.fn(() => row);
    expect(replacementOf(ghost)).toBe(list);
  });

  it("finds nothing when nothing took its place", () => {
    const page = document.createElement("main");
    document.body.append(page);
    const ghost = box(document.createElement("div"), 0, 0, 300, 200);
    box(page, 0, 0, 1200, 900);
    document.elementFromPoint = vi.fn(() => page);
    expect(replacementOf(ghost)).toBeNull();
  });
});
