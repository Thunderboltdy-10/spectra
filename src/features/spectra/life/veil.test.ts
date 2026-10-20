// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { isVeiled, veil, VEIL_MAX_MS } from "./veil";

describe("veil", () => {
  it("hides, and shows again as it was", () => {
    const element = document.createElement("div");
    element.style.opacity = "0.5";
    const show = veil(element);
    expect(element.style.opacity).toBe("0");
    expect(isVeiled(element)).toBe(true);
    show();
    expect(element.style.opacity).toBe("0.5");
    expect(isVeiled(element)).toBe(false);
  });

  it("hidden by two moments, it shows when both are done, never stuck hidden", () => {
    const element = document.createElement("div");
    const first = veil(element);
    const second = veil(element);
    first();
    expect(element.style.opacity).toBe("0");
    first();
    expect(element.style.opacity).toBe("0");
    second();
    expect(element.style.opacity).toBe("");
  });

  it("never holds content back longer than a split second", () => {
    vi.useFakeTimers();
    const element = document.createElement("div");
    veil(element);
    veil(element);
    vi.advanceTimersByTime(VEIL_MAX_MS);
    expect(element.style.opacity).toBe("");
    expect(isVeiled(element)).toBe(false);
    vi.useRealTimers();
  });
});
