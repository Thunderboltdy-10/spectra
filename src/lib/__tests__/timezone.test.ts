import { describe, expect, it, vi } from "vitest";
import { formatSchoolNow, resolveSafeTimeZone } from "@/lib/timezone";

describe("timezone guards", () => {
  it("keeps valid IANA zones untouched", () => {
    expect(resolveSafeTimeZone("Europe/Madrid")).toBe("Europe/Madrid");
  });

  it("falls back invalid timezones to UTC and warns", () => {
    const warning = vi.fn();
    expect(resolveSafeTimeZone("Mars/Olympus", warning)).toBe("UTC");
    expect(warning).toHaveBeenCalledTimes(1);
  });

  it("formats school time with the safe fallback zone", () => {
    const warning = vi.fn();
    const result = formatSchoolNow("Not/ARealZone", warning);
    expect(result.timeZone).toBe("UTC");
    expect(result.label.length).toBeGreaterThan(0);
    expect(warning).toHaveBeenCalledTimes(1);
  });
});
