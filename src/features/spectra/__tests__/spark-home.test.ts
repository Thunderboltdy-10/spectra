// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const field = vi.hoisted(() => ({
  send: vi.fn((..._args: unknown[]) => Promise.resolve()),
  glow: vi.fn(() => ({ stop: vi.fn(), move: vi.fn() })),
  pulse: vi.fn(),
}));

vi.mock("../life/life", () => ({ life: { on: true, send: field.send, glow: field.glow, pulse: field.pulse } }));
vi.mock("../life/use-life", () => ({ markCause: vi.fn(), markWorking: vi.fn(() => () => {}), prismPoint: () => [500, 700] }));

import { presentAppControl, SPARK_HOME_MS } from "../collaboration/app-choreography-host";

const rect = (x: number, y: number, width = 40, height = 20) =>
  ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) }) as DOMRect;

describe("Spectra's light after it works the interface", () => {
  let prism: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    prism = document.createElement("div");
    prism.setAttribute("data-island-home", "");
    prism.getBoundingClientRect = () => rect(480, 680, 40, 40);
    document.body.append(prism);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  const control = (x: number) => {
    const element = document.createElement("button");
    element.getBoundingClientRect = () => rect(x, 100);
    document.body.append(element);
    return element;
  };

  it("crosses the field back into the prism, which takes it in", () => {
    const release = presentAppControl("spectra-a", "op-1", control(100));
    expect(field.send).toHaveBeenCalledTimes(1);
    release();
    vi.advanceTimersByTime(SPARK_HOME_MS + 10);
    expect(field.send).toHaveBeenCalledTimes(2);
    expect(field.send.mock.calls[1]).toEqual([[120, 110], { x: 480, y: 680, width: 40, height: 40 }, expect.objectContaining({ absorb: true })]);
  });

  it("stays out while Spectra moves straight on to the next control", () => {
    presentAppControl("spectra-b", "op-1", control(100))();
    vi.advanceTimersByTime(SPARK_HOME_MS / 2);
    presentAppControl("spectra-b", "op-2", control(300));
    vi.advanceTimersByTime(SPARK_HOME_MS * 2);
    // Out from the prism, then from the first control to the second: never home.
    expect(field.send).toHaveBeenCalledTimes(2);
    expect(field.send.mock.calls[1][0]).toEqual([120, 110]);
  });
});
