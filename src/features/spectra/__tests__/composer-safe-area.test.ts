// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerComposerBand } from "../components/composer-safe-area";

/**
 * The composer band publishes its own height; every surface it floats over
 * consumes `--spectra-composer-safe-area` instead of guessing a constant.
 */
describe("composer safe area registry", () => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  function band(height: number, bottom = height): HTMLElement {
    const element = document.createElement("div");
    element.getBoundingClientRect = () =>
      ({
        height,
        bottom,
        top: bottom - height,
      }) as DOMRect;
    document.body.appendChild(element);
    return element;
  }

  const safeArea = () =>
    document.documentElement.style.getPropertyValue(
      "--spectra-composer-safe-area",
    );

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty(
      "--spectra-composer-safe-area",
    );
  });

  it("publishes the mounted band's height plus the gap", () => {
    const unregister = registerComposerBand(band(80));
    expect(safeArea()).toBe("92px");
    unregister();
  });

  it("tracks the tallest visible band when several routes mount one", () => {
    const small = registerComposerBand(band(80));
    const tall = registerComposerBand(band(140));
    expect(safeArea()).toBe("152px");
    small();
    tall();
  });

  it("ignores bands parked off-screen and clears the variable when none remain", () => {
    const hidden = registerComposerBand(band(80, -10));
    expect(safeArea()).toBe("");
    hidden();
    const visible = registerComposerBand(band(96));
    expect(safeArea()).toBe("108px");
    visible();
    expect(safeArea()).toBe("");
  });
});
