import { describe, expect, it } from "vitest";
import { formatByteCount, formatElapsedSince } from "../../../../shared/human-format";

describe("human-readable Bridge metadata", () => {
  it("formats byte counts without exposing raw implementation wording", () => {
    expect(formatByteCount(512)).toBe("512 B");
    expect(formatByteCount(5_123)).toBe("5 KB");
    expect(formatByteCount(5 * 1_048_576)).toBe("5 MB");
  });

  it("uses minutes, hours, and days for older verification timestamps", () => {
    const now = 10 * 24 * 60 * 60 * 1_000;
    expect(formatElapsedSince(now - 45_000, now)).toBe("45s ago");
    expect(formatElapsedSince(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatElapsedSince(now - 3 * 60 * 60_000, now)).toBe("3h ago");
    expect(formatElapsedSince(now - 2 * 24 * 60 * 60_000, now)).toBe("2d ago");
  });
});
