// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { LifeEngine } from "./engine";
import { life } from "./life";

afterEach(() => {
  life.detach();
  vi.unstubAllGlobals();
});

it("moves a pinned figure with its element when the page scrolls under the fixed canvas", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  const handled: { type: string; id?: number; dx?: number; dy?: number }[] = [];
  life.attachEngine({ handle: (command: { type: string }) => handled.push(command) } as unknown as LifeEngine);

  const element = document.createElement("div");
  document.body.append(element);
  let top = 300;
  element.getBoundingClientRect = () => new DOMRect(40, top, 200, 80);

  const formed = life.pin(life.form({ strokes: [] }), element);
  top = 180; // scrolled 120px
  frames.shift()?.(0);
  expect(handled.filter((command) => command.type === "place")).toEqual([
    expect.objectContaining({ id: formed.id, dx: 0, dy: -120 }),
  ]);

  // Still: no further moves. Gone from the page: it stops following.
  frames.shift()?.(0);
  element.remove();
  frames.shift()?.(0);
  expect(handled.filter((command) => command.type === "place")).toHaveLength(1);
  expect(frames).toHaveLength(0);
});
