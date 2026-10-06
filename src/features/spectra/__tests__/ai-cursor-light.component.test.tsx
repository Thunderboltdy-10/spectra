// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const field = vi.hoisted(() => ({ send: vi.fn((..._args: unknown[]) => Promise.resolve()) }));
vi.mock("../life/life", () => ({ life: { on: true, send: field.send } }));
vi.mock("../life/use-life", () => ({ prismPoint: () => [500, 700] }));

import { useAiCursorLight } from "../components/presence/interaction-layer";

function Cursor({ id, ai, departing }: { id: string; ai: boolean; departing: boolean }) {
  const attach = useAiCursorLight(id, ai, departing);
  return <div ref={attach} className="cursor" />;
}

const frames: FrameRequestCallback[] = [];
const flush = () => frames.splice(0).forEach((frame) => frame(0));

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 100, y: 100, left: 100, top: 100, right: 120, bottom: 120, width: 20, height: 20, toJSON: () => ({}) } as DOMRect);
  const prism = document.createElement("div");
  prism.setAttribute("data-island-prism", "");
  document.body.append(prism);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  field.send.mockClear();
});

describe("Spectra's cursor in a work", () => {
  it("arrives as light from the prism, once, and goes back into it when done", () => {
    const view = render(<Cursor id="spectra-1" ai departing={false} />);
    flush();
    expect(field.send).toHaveBeenCalledTimes(1);
    expect(field.send.mock.calls[0][0]).toEqual([500, 700]);
    view.rerender(<Cursor id="spectra-1" ai departing={false} />);
    flush();
    expect(field.send).toHaveBeenCalledTimes(1);
    view.rerender(<Cursor id="spectra-1" ai departing />);
    expect(field.send).toHaveBeenCalledTimes(2);
    expect(field.send.mock.calls[1][2]).toEqual(expect.objectContaining({ absorb: true }));
  });

  it("leaves a person's cursor to itself", () => {
    const view = render(<Cursor id="person-1" ai={false} departing={false} />);
    flush();
    view.rerender(<Cursor id="person-1" ai={false} departing />);
    expect(field.send).not.toHaveBeenCalled();
  });
});
