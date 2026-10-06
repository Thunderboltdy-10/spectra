// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const field = vi.hoisted(() => ({
  send: vi.fn((..._args: unknown[]) => Promise.resolve()),
  glow: vi.fn((..._args: unknown[]) => ({ stop: vi.fn(), move: vi.fn() })),
  pulse: vi.fn(),
}));

vi.mock("../life/life", () => ({ life: { on: true, send: field.send, glow: field.glow, pulse: field.pulse } }));

import { useWritingFront } from "../life/use-life";

const rect = (x: number, y: number, width = 400, height = 24) =>
  ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) }) as DOMRect;

function Reply({ active, text }: { active: boolean; text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useWritingFront(ref, active);
  return (
    <div ref={ref} data-testid="reply">
      {text}
    </div>
  );
}

let frames: FrameRequestCallback[] = [];
const flushFrames = (at = performance.now()) => {
  const pending = frames;
  frames = [];
  for (const frame of pending) frame(at);
};

beforeEach(() => {
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => rect(100, 200));
  document.createRange = () =>
    ({
      setStart: () => {},
      setEnd: () => {},
      getClientRects: () => [rect(300, 210, 8, 18)],
    }) as unknown as Range;
  const prism = document.createElement("div");
  prism.setAttribute("data-island-prism", "");
  prism.getBoundingClientRect = () => rect(480, 680, 40, 40);
  document.body.append(prism);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Spectra writing a reply", () => {
  it("starts as light that leaves the prism for where the words begin, then follows the writing", async () => {
    render(<Reply active text="Hello" />);
    expect(field.send).toHaveBeenCalledWith([500, 700], [112, 212], expect.objectContaining({ colour: "spectrum" }));
    // The front waits for the light to land.
    flushFrames(1000);
    expect(field.glow).not.toHaveBeenCalled();
    await act(async () => {});
    flushFrames(2000);
    expect(field.glow).toHaveBeenCalledTimes(1);
  });

  it("settles with a soft pulse where the words stopped, and comes from the prism only once", async () => {
    const { rerender } = render(<Reply active text="Hello" />);
    await act(async () => {});
    flushFrames(2000);
    rerender(<Reply active={false} text="Hello world" />);
    expect(field.pulse).toHaveBeenCalledWith(308, 219, 0.35, "spectrum");
    rerender(<Reply active text="Hello world, again" />);
    expect(field.send).toHaveBeenCalledTimes(1);
  });

  it("says nothing more when the reply leaves the page", async () => {
    const { unmount } = render(<Reply active text="Hello" />);
    await act(async () => {});
    flushFrames(2000);
    unmount();
    expect(field.pulse).not.toHaveBeenCalled();
  });
});
