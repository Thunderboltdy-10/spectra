import { describe, expect, it } from "vitest";
import {
  grammarFor,
  transitionFor,
  type MotionPrimitive,
} from "../motion/grammar";
import { resolveEffectiveMotion } from "../motion/motion-level";
import { MOTION_DURATIONS } from "../motion/tokens";

const PRIMITIVES: MotionPrimitive[] = [
  "reveal",
  "morph",
  "focus",
  "ownership",
  "completion",
  "recovery",
  "presence",
];

describe("motion grammar", () => {
  it("defines every primitive with consistent duration/easing", () => {
    for (const primitive of PRIMITIVES) {
      const config = grammarFor(primitive, "full");
      expect(config.duration).toBeGreaterThan(0);
      expect(config.ease).toHaveLength(4);
      expect(config.distance).toBeGreaterThanOrEqual(0);
    }
  });

  it("reduced motion keeps state legible but removes travel", () => {
    for (const primitive of PRIMITIVES) {
      const full = grammarFor(primitive, "full");
      const reduced = grammarFor(primitive, "reduced");
      expect(reduced.distance).toBeLessThanOrEqual(1);
      expect(reduced.duration).toBeLessThan(full.duration);
      expect(reduced.type).toBe("tween");
    }
  });

  it("none collapses to instant", () => {
    for (const primitive of PRIMITIVES) {
      const none = grammarFor(primitive, "none");
      expect(none.duration).toBeLessThanOrEqual(0.01);
      expect(none.distance).toBe(0);
    }
  });

  it("morph uses spring in full mode, never in reduced mode", () => {
    expect(grammarFor("morph", "full").type).toBe("spring");
    expect(transitionFor("morph", "full")).toMatchObject({ type: "spring" });
    expect(grammarFor("morph", "reduced").type).toBe("tween");
  });

  it("durations use the shared token set", () => {
    expect(grammarFor("reveal", "full").duration).toBe(MOTION_DURATIONS.base);
    expect(grammarFor("ownership", "full").duration).toBe(
      MOTION_DURATIONS.fast,
    );
  });
});

describe("resolveEffectiveMotion", () => {
  it("passes through full when nothing requests less", () => {
    const motion = resolveEffectiveMotion("full", false);
    expect(motion.level).toBe("full");
    expect(motion.reduced).toBe(false);
    expect(motion.disabled).toBe(false);
  });

  it("OS reduced-motion downgrades full to reduced", () => {
    const motion = resolveEffectiveMotion("full", true);
    expect(motion.level).toBe("reduced");
    expect(motion.reduced).toBe(true);
  });

  it("explicit none always wins", () => {
    expect(resolveEffectiveMotion("none", false).disabled).toBe(true);
    expect(resolveEffectiveMotion("none", true).level).toBe("none");
  });

  it("OS preference never increases motion", () => {
    expect(resolveEffectiveMotion("reduced", false).level).toBe("reduced");
    expect(resolveEffectiveMotion("reduced", true).level).toBe("reduced");
  });
});
