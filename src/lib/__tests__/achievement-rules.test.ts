import { describe, expect, it } from "vitest";
import { shouldCheckImageAchievements } from "@/lib/achievement-rules";

describe("achievement image-gating", () => {
  it("only evaluates image milestones for image activity", () => {
    expect(shouldCheckImageAchievements({ activityType: "chat", modeUsed: "tutor" })).toBe(false);
    expect(shouldCheckImageAchievements({ activityType: "image", modeUsed: "image" })).toBe(true);
    expect(shouldCheckImageAchievements({ activityType: "chat", modeUsed: "image" })).toBe(true);
  });
});
