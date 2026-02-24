import { describe, expect, it } from "vitest";
import { computeStreakProgress } from "../streakLogic";

describe("computeStreakProgress", () => {
  it("counts first activity day when streak row was initialized at 0", () => {
    const result = computeStreakProgress({
      currentStreak: 0,
      longestStreak: 0,
      lastActiveDate: "2026-02-23",
      activityDate: "2026-02-23",
    });

    expect(result.changed).toBe(true);
    if (!result.changed) return;
    expect(result.reason).toBe("first_activity_day");
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(1);
    expect(result.lastActiveDate).toBe("2026-02-23");
  });

  it("does not increment again for same-day duplicate activity", () => {
    const result = computeStreakProgress({
      currentStreak: 4,
      longestStreak: 7,
      lastActiveDate: "2026-02-23",
      activityDate: "2026-02-23",
    });

    expect(result.changed).toBe(false);
    if (result.changed) return;
    expect(result.reason).toBe("already_recorded");
    expect(result.currentStreak).toBe(4);
    expect(result.longestStreak).toBe(7);
  });

  it("increments on a consecutive day", () => {
    const result = computeStreakProgress({
      currentStreak: 4,
      longestStreak: 5,
      lastActiveDate: "2026-02-22",
      activityDate: "2026-02-23",
    });

    expect(result.changed).toBe(true);
    if (!result.changed) return;
    expect(result.reason).toBe("continued");
    expect(result.currentStreak).toBe(5);
    expect(result.longestStreak).toBe(5);
  });

  it("resets streak after a multi-day gap", () => {
    const result = computeStreakProgress({
      currentStreak: 9,
      longestStreak: 12,
      lastActiveDate: "2026-02-20",
      activityDate: "2026-02-23",
    });

    expect(result.changed).toBe(true);
    if (!result.changed) return;
    expect(result.reason).toBe("reset_after_gap");
    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(12);
  });
});
