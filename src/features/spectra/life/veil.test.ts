// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isVeiled, veil } from "./veil";

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
});
