import { describe, expect, it } from "vitest";
import {
  CursorTravel,
  easeOutExpo,
  travelDuration,
  travelKindFor,
} from "../collaboration/cursor-motion";

const noMotion = () => false;
const reduced = () => true;

describe("travelDuration", () => {
  it("scales with distance but stays inside a fast band", () => {
    expect(travelDuration(0)).toBe(140);
    expect(travelDuration(40)).toBeLessThan(240);
    expect(travelDuration(300)).toBeGreaterThan(180);
    expect(travelDuration(5000)).toBe(560);
  });

  it("orders durations monotonically", () => {
    expect(travelDuration(50)).toBeLessThan(travelDuration(200));
    expect(travelDuration(200)).toBeLessThan(travelDuration(800));
  });
});

describe("travelKindFor", () => {
  it("classifies stay, hop, journey and fade", () => {
    expect(travelKindFor(0.5, false)).toBe("stay");
    expect(travelKindFor(40, false)).toBe("hop");
    expect(travelKindFor(400, false)).toBe("journey");
    expect(travelKindFor(10, true)).toBe("fade");
  });
});

describe("easeOutExpo", () => {
  it("starts fast and lands exactly", () => {
    expect(easeOutExpo(0)).toBeCloseTo(0, 5);
    expect(easeOutExpo(1)).toBe(1);
    expect(easeOutExpo(0.25)).toBeGreaterThan(0.7);
    expect(easeOutExpo(0.9)).toBeLessThan(1);
  });
});

describe("CursorTravel", () => {
  it("places the first point without a journey", () => {
    const travel = new CursorTravel(noMotion);
    travel.moveTo(10, 20, 0);
    const sample = travel.sample(16);
    expect(sample.x).toBe(10);
    expect(sample.y).toBe(20);
    expect(sample.travelling).toBe(false);
  });

  it("interpolates a journey and settles on the exact target", () => {
    const travel = new CursorTravel(noMotion);
    travel.moveTo(0, 0, 0);
    travel.moveTo(300, 0, 16);
    const duration = travelDuration(300);
    const mid = travel.sample(16 + duration / 2);
    expect(mid.x).toBeGreaterThan(100);
    expect(mid.x).toBeLessThan(300);
    expect(mid.travelling).toBe(true);
    const end = travel.sample(16 + duration + 10);
    expect(end.x).toBe(300);
    expect(end.travelling).toBe(false);
  });

  it("retargets mid-flight from the current interpolated position", () => {
    const travel = new CursorTravel(noMotion);
    travel.moveTo(0, 0, 0);
    travel.moveTo(400, 0, 16);
    const before = travel.sample(120);
    travel.moveTo(800, 0, 120);
    const after = travel.sample(136);
    // The retargeted journey starts where the body actually was — no jump back.
    expect(after.x).toBeGreaterThanOrEqual(before.x - 1);
  });

  it("treats a sub-pixel nudge as a stay, not a journey", () => {
    const travel = new CursorTravel(noMotion);
    travel.moveTo(100, 100, 0);
    travel.moveTo(100.4, 100.4, 16);
    expect(travel.sample(32).travelling).toBe(false);
  });

  it("honours reduced motion by snapping immediately", () => {
    const travel = new CursorTravel(reduced);
    travel.moveTo(0, 0, 0);
    travel.moveTo(500, 500, 16);
    const sample = travel.sample(20);
    expect(sample.x).toBe(500);
    expect(sample.y).toBe(500);
    expect(sample.travelling).toBe(false);
  });

  it("dips opacity through a fade journey", () => {
    const travel = new CursorTravel(noMotion);
    travel.moveTo(0, 0, 0);
    travel.moveTo(100, 100, 16, true);
    const mid = travel.sample(16 + 150);
    if (mid.kind === "fade" && mid.travelling) {
      expect(travel.fadeOpacity(mid)).toBeLessThan(0.6);
    }
    const done = travel.sample(16 + 400);
    expect(travel.fadeOpacity(done)).toBe(1);
  });
});

describe("an AI's hand when the work outruns it", () => {
  it("does not dart across the page several times a second", () => {
    const travel = new CursorTravel(() => false, "actor");
    travel.moveTo(0, 0, 0);
    travel.moveTo(0, 400, 10);
    travel.moveTo(0, 800, 60);
    travel.moveTo(0, 1200, 110);
    // Still on its first move; the two arrivals in between are not visited.
    expect(travel.sample(200).y).toBeLessThanOrEqual(420);
    travel.sample(400);
    travel.sample(2_000);
    expect(travel.position).toEqual({ x: 0, y: 1200 });
  });
});
