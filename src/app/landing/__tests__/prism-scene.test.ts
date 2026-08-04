// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  PRISM_SCENES,
  PRISM_TRACK,
  clamp01,
  lerpScene,
  sceneForProgress,
  sceneIndexForProgress,
  staticSceneFor,
  type PrismSceneState,
} from "../prism/prism-scene";

function expectSceneClose(actual: PrismSceneState, expected: PrismSceneState) {
  (Object.keys(expected) as Array<keyof PrismSceneState>).forEach((key) => {
    expect(actual[key], key).toBeCloseTo(expected[key], 10);
  });
}

describe("prism scene state machine", () => {
  it("anchors the track at both ends", () => {
    expect(PRISM_TRACK[0]).toBe("hero");
    expect(PRISM_TRACK[PRISM_TRACK.length - 1]).toBe("converge");
    expectSceneClose(sceneForProgress(0), PRISM_SCENES.hero);
    expectSceneClose(sceneForProgress(1), PRISM_SCENES.converge);
  });

  it("passes through every named scene boundary", () => {
    const last = PRISM_TRACK.length - 1;
    PRISM_TRACK.forEach((id, index) => {
      const progress = index / last;
      expectSceneClose(sceneForProgress(progress), PRISM_SCENES[id]);
    });
  });

  it("interpolates midpoints deterministically", () => {
    const mid = sceneForProgress(0.5);
    expectSceneClose(mid, PRISM_SCENES.transformation);
    // Same input → identical output (deterministic timeline requirement).
    expect(sceneForProgress(0.3127)).toEqual(sceneForProgress(0.3127));
  });

  it("never overshoots: progress beyond [0,1] clamps", () => {
    expectSceneClose(sceneForProgress(-0.4), PRISM_SCENES.hero);
    expectSceneClose(sceneForProgress(1.7), PRISM_SCENES.converge);
  });

  it("moves continuously: nearby progress stays optically nearby", () => {
    for (let p = 0; p < 0.98; p += 0.05) {
      const a = sceneForProgress(p);
      const b = sceneForProgress(p + 0.02);
      for (const key of ["dispersion", "beam", "fan"] as const) {
        expect(Math.abs(a[key] - b[key])).toBeLessThan(0.2);
      }
    }
  });

  it("lerp is exact at both endpoints and halfway", () => {
    const a = {
      dispersion: 0,
      beam: 0.2,
      fan: 1,
      tilt: -0.1,
      shimmer: 0.5,
      progress: 0,
    };
    const b = {
      dispersion: 1,
      beam: 0.8,
      fan: 0,
      tilt: 0.1,
      shimmer: 0.9,
      progress: 1,
    };
    expect(lerpScene(a, b, 0)).toEqual(a);
    expect(lerpScene(a, b, 1)).toEqual(b);
    expect(lerpScene(a, b, 0.5).dispersion).toBeCloseTo(0.5);
    expect(lerpScene(a, b, 0.5).beam).toBeCloseTo(0.5);
  });

  it("picks the owning scene index nearest the boundary", () => {
    const last = PRISM_TRACK.length - 1;
    expect(sceneIndexForProgress(0)).toBe(0);
    expect(sceneIndexForProgress(1)).toBe(last);
    expect(sceneIndexForProgress(0.24)).toBe(1); // past hero→fragments midpoint
    expect(sceneIndexForProgress(0.11)).toBe(0); // still hero-forward
  });

  it("clamps unit values", () => {
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(9)).toBe(1);
  });

  it("static fallback renders a real scene state", () => {
    expectSceneClose(staticSceneFor("live"), PRISM_SCENES.live);
  });

  it("narrative progress is monotonic along the track", () => {
    // The energy story never runs backwards: dormant → released only.
    for (let index = 1; index < PRISM_TRACK.length; index++) {
      const previous = PRISM_SCENES[PRISM_TRACK[index - 1]!].progress;
      const current = PRISM_SCENES[PRISM_TRACK[index]!].progress;
      expect(current).toBeGreaterThan(previous);
    }
    // Hero arrives calm, converges released.
    expect(PRISM_SCENES.hero.progress).toBeLessThanOrEqual(0.2);
    expect(PRISM_SCENES.converge.progress).toBeGreaterThanOrEqual(0.9);
  });
});
