import { describe, expect, it } from "vitest";
import { formatMemory, mergeMemoryEntries } from "@/lib/orchestrator/post-process";
import type { MemoryEntry } from "@/lib/orchestrator/history";

describe("memory consolidation", () => {
  it("merges similar keys and keeps the most recent value", () => {
    const now = Date.now();
    const existing: MemoryEntry[] = [
      {
        key: "learning style",
        value: "visual learner",
        confidence: 0.7,
        extractedAt: now - 10_000,
      },
    ];
    const incoming: MemoryEntry[] = [
      {
        key: "study_style",
        value: "prefers worked examples",
        confidence: 0.8,
        extractedAt: now,
      },
    ];

    const merged = mergeMemoryEntries(existing, incoming);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.key).toBe("learning_style");
    expect(merged[0]?.value).toBe("prefers worked examples");
  });

  it("removes stale low-confidence entries older than 30 days", () => {
    const now = Date.now();
    const stale: MemoryEntry = {
      key: "goal",
      value: "improve essays",
      confidence: 0.2,
      extractedAt: now - 31 * 24 * 60 * 60 * 1000,
    };

    const merged = mergeMemoryEntries([stale], []);
    expect(merged).toHaveLength(0);
  });

  it("caps merged memory entries at 20", () => {
    const now = Date.now();
    const incoming: MemoryEntry[] = Array.from({ length: 30 }).map((_, index) => ({
      key: `key_${index}`,
      value: `value_${index}`,
      confidence: 0.9 - index * 0.01,
      extractedAt: now - index,
    }));

    const merged = mergeMemoryEntries([], incoming);
    expect(merged.length).toBeLessThanOrEqual(20);
  });

  it("keeps raw memory text under 1500 characters", () => {
    const entries: MemoryEntry[] = Array.from({ length: 25 }).map((_, index) => ({
      key: `topic_${index}`,
      value: "x".repeat(120),
      confidence: 0.8,
      extractedAt: Date.now() - index,
    }));

    const text = formatMemory(entries);
    expect(text.length).toBeLessThanOrEqual(1500);
  });
});
