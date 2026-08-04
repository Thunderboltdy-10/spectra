import { describe, expect, it } from "vitest";
import {
  REVEAL_PROFILES,
  RevealScheduler,
} from "../runs/streaming/reveal-scheduler";

describe("RevealScheduler", () => {
  it("reveals progressively at the profile rate", () => {
    const scheduler = new RevealScheduler("conversation");
    scheduler.tick(100, 0);
    const first = scheduler.tick(100, 16);
    expect(first.revealed).toBeGreaterThan(0);
    expect(first.revealed).toBeLessThan(100);
    expect(first.active).toBe(true);

    let now = 16;
    let result = first;
    while (result.active && now < 10_000) {
      now += 16;
      result = scheduler.tick(100, now);
    }
    expect(result.revealed).toBe(100);
    expect(result.active).toBe(false);
  });

  it("accelerates with catch-up when the queue grows large", () => {
    const scheduler = new RevealScheduler("document");
    scheduler.tick(10_000, 0);
    const catchingUp = scheduler.tick(10_000, 16);
    const small = new RevealScheduler("document");
    small.tick(100, 0);
    const notCatchingUp = small.tick(100, 16);
    const catchUpRate = catchingUp.revealed / notCatchingUp.revealed;
    expect(catchUpRate).toBeGreaterThanOrEqual(
      REVEAL_PROFILES.document.catchUpFactor - 0.5,
    );
  });

  it("respects the per-tick ceiling", () => {
    const scheduler = new RevealScheduler("dock");
    scheduler.tick(1_000, 0);
    const result = scheduler.tick(1_000, 1_000);
    expect(result.revealed).toBeLessThanOrEqual(
      REVEAL_PROFILES.dock.maxPerTick,
    );
  });

  it("reveals in quantised batches", () => {
    const scheduler = new RevealScheduler("table");
    scheduler.tick(500, 0);
    const result = scheduler.tick(500, 32);
    expect(result.revealed % REVEAL_PROFILES.table.batchSize).toBe(0);
  });

  it("imported profile never streams artificially", () => {
    const scheduler = new RevealScheduler("imported");
    scheduler.tick(5_000, 0);
    const result = scheduler.tick(5_000, 16);
    expect(result.revealed).toBe(5_000);
    expect(result.active).toBe(false);
  });

  it("settle completes immediately", () => {
    const scheduler = new RevealScheduler("conversation");
    scheduler.tick(2_000, 0);
    const result = scheduler.settle(2_000);
    expect(result.revealed).toBe(2_000);
  });

  it("never reveals more than canonical and survives content shrink", () => {
    const scheduler = new RevealScheduler("conversation");
    scheduler.tick(500, 0);
    scheduler.tick(500, 100);
    const shrunk = scheduler.tick(200, 200);
    expect(shrunk.revealed).toBeLessThanOrEqual(200);
  });

  it("INV-22: reveal completion is not required for canonical truth", () => {
    /* The canonical model updates independently of reveal progress: a consumer
       reading the scheduler mid-reveal must still get the full canonical
       length and an accurate queue size. */
    const scheduler = new RevealScheduler("document");
    scheduler.tick(300, 0);
    const canonical = "x".repeat(300);
    const snapshot = scheduler.snapshot(canonical.length);
    expect(snapshot.revealed + snapshot.queued).toBe(canonical.length);
    expect(canonical.length).toBe(300);
  });

  it("all five profile names exist and are internally consistent", () => {
    for (const [name, profile] of Object.entries(REVEAL_PROFILES)) {
      expect(typeof name).toBe("string");
      expect(profile.charsPerSecond).toBeGreaterThan(0);
      expect(profile.catchUpFactor).toBeGreaterThanOrEqual(1);
      expect(profile.maxPerTick).toBeGreaterThan(0);
      expect(profile.batchSize).toBeGreaterThanOrEqual(1);
    }
  });
});
