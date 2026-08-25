import { describe, expect, it } from "vitest";
import {
  CANVAS_MARGIN,
  LANDING_WIDTH,
  SCENE_FRAME,
  cameraFor,
  fitFor,
} from "../story/timeline";

/**
 * The camera's fit rule: never larger than authored.
 *
 * Fitting both axes without a cap upscaled the canvas ~1.3x on ordinary
 * laptops, which is what made the whole landing read as zoomed in. The cap
 * keeps held scenes at their authored size on big windows and still scales
 * down on small ones.
 */
describe("fitFor", () => {
  it("caps the canvas at its authored scale on large windows", () => {
    expect(fitFor({ width: 2560, height: 1440 })).toBe(1);
    expect(fitFor({ width: 1440, height: 900 })).toBe(1);
  });

  it("still scales down when the window cannot hold a scene", () => {
    const narrow = fitFor({ width: 800, height: 900 });
    const short = fitFor({ width: 1440, height: 500 });
    expect(narrow).toBeCloseTo((800 - CANVAS_MARGIN * 2) / LANDING_WIDTH, 10);
    expect(short).toBeCloseTo((500 - CANVAS_MARGIN * 2) / SCENE_FRAME, 10);
  });

  it("never goes below the readability floor", () => {
    expect(fitFor({ width: 200, height: 200 })).toBe(0.2);
  });
});

describe("cameraFor", () => {
  it("stays reversible: the same scroll resolves to the same camera", () => {
    const down = cameraFor(1200, 900);
    const up = cameraFor(1200, 900);
    expect(down).toEqual(up);
  });

  it("holds each scene before advancing to the next", () => {
    const first = cameraFor(0, 900);
    expect(first.scene).toBe("wake");
    expect(first.t).toBe(0);
  });
});
