import { describe, expect, it } from "vitest";
import { createPresentationSlide } from "../presentation/model";
import { clockDuration, longestSlide, rehearsalReport, spokenDuration } from "../presentation/rehearsal";

describe("presentation rehearsal", () => {
  it("keeps each time beside the slide it was spoken over", () => {
    const slides = [createPresentationSlide(1), createPresentationSlide(2)];
    const report = rehearsalReport(slides, [12_000]);
    expect(report.slideDurations).toEqual([12_000, 0]);
    expect(report.totalMs).toBe(12_000);
    expect(report.slides).toHaveLength(2);
  });

  it("says times as a clock and in words", () => {
    expect(clockDuration(247_400)).toBe("4:07");
    expect(spokenDuration(247_400)).toBe("4 minutes 7 seconds");
    expect(spokenDuration(60_000)).toBe("1 minute");
    expect(spokenDuration(1_000)).toBe("1 second");
    expect(spokenDuration(200)).toBe("under a second");
  });

  it("names the longest slide only when it stands out", () => {
    const slides = [1, 2, 3].map(createPresentationSlide);
    expect(longestSlide(rehearsalReport(slides, [10_000, 11_000, 10_500]))).toBeUndefined();
    expect(longestSlide(rehearsalReport(slides, [10_000, 60_000, 10_000]))).toBe(1);
  });
});
