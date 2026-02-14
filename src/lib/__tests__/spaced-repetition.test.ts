import { describe, expect, it } from "vitest";
import { calculateNextReview } from "@/lib/spaced-repetition";

describe("spaced repetition", () => {
  it("resets interval on low quality", () => {
    const next = calculateNextReview(1, 2.5, 12, 3, 0);
    expect(next.interval).toBe(1);
    expect(next.repetitions).toBe(0);
  });

  it("advances repetitions with good quality", () => {
    const first = calculateNextReview(4, 2.5, 0, 0, 0);
    expect(first.interval).toBe(1);

    const second = calculateNextReview(4, first.easeFactor, first.interval, first.repetitions, 0);
    expect(second.interval).toBe(6);
    expect(second.repetitions).toBe(2);
  });

  it("never drops ease factor below 1.3", () => {
    const next = calculateNextReview(0, 1.1, 1, 1, 0);
    expect(next.easeFactor).toBeGreaterThanOrEqual(1.3);
  });
});
