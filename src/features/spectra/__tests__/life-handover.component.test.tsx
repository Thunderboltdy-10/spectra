// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const field = vi.hoisted(() => ({
  unform: vi.fn((_figure: unknown) => Promise.resolve()),
  morph: vi.fn((_from: unknown, _to: unknown) => ({ formed: Promise.resolve() })),
  replacement: null as HTMLElement | null,
}));

vi.mock("../life/life", () => ({
  life: { on: true, unform: field.unform, morph: field.morph },
}));

vi.mock("../life/figure-dom", () => ({
  figureOf: (element: HTMLElement) => ({ strokes: [], of: element.textContent }),
  hasVisibleFrame: () => false,
  replacementOf: () => field.replacement,
}));

import { markNavigation, useLifeHandover } from "../life/use-life";
import { veil } from "../life/veil";

function Empty() {
  const ref = useRef<HTMLDivElement>(null);
  useLifeHandover(ref);
  return <div ref={ref}>Nothing yet</div>;
}

let frames: FrameRequestCallback[] = [];
const flushFrames = () => {
  const pending = frames;
  frames = [];
  for (const frame of pending) frame(performance.now());
};

beforeEach(() => {
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 10, y: 10, left: 10, top: 10, right: 210, bottom: 110, width: 200, height: 100, toJSON: () => ({}) } as DOMRect);
  vi.spyOn(performance, "now").mockReturnValue(100_000);
  markNavigation();
  vi.spyOn(performance, "now").mockReturnValue(200_000);
});

afterEach(() => {
  flushFrames();
  vi.restoreAllMocks();
  field.unform.mockClear();
  field.morph.mockClear();
  field.replacement = null;
});

describe("hand over", () => {
  it("an empty state's dots flow into what takes its place", () => {
    const view = render(<Empty />);
    const content = document.createElement("ul");
    content.textContent = "First item";
    field.replacement = content;
    view.unmount();
    flushFrames();
    expect(field.morph).toHaveBeenCalledTimes(1);
    expect(field.morph.mock.calls[0][1]).toEqual(expect.objectContaining({ of: "First item" }));
    expect(field.unform).not.toHaveBeenCalled();
  });

  it("with nothing there, it parts", () => {
    const view = render(<Empty />);
    view.unmount();
    flushFrames();
    expect(field.unform).toHaveBeenCalledTimes(1);
    expect(field.morph).not.toHaveBeenCalled();
  });

  it("content that is forming itself brings its own light", () => {
    const view = render(<Empty />);
    const content = document.createElement("div");
    const show = veil(content);
    field.replacement = content;
    view.unmount();
    flushFrames();
    expect(field.morph).not.toHaveBeenCalled();
    expect(field.unform).toHaveBeenCalledTimes(1);
    show();
  });
});
