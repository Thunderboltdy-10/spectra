import { describe, expect, it } from "vitest";
import type { SpectraThread } from "../../data/api";
import { dayGroup, groupThreads, matchThreads, RECENT_LIMIT } from "../threads-model";

const NOW = new Date(2026, 9, 5, 15, 0).getTime();
const HOUR = 3_600_000;

function thread(id: string, at: number, extra: Partial<SpectraThread> = {}): SpectraThread {
  return { _id: id, title: `Thread ${id}`, origin: "chat", status: "active", createdAt: at, updatedAt: at, lastMessageAt: at, ...extra };
}

describe("threads view groups", () => {
  it("names days by the user's calendar", () => {
    expect(dayGroup(NOW - HOUR, NOW)).toBe("Today");
    expect(dayGroup(new Date(2026, 9, 4, 23, 50).getTime(), NOW)).toBe("Yesterday");
    expect(dayGroup(NOW - 3 * 24 * HOUR, NOW)).toBe("This week");
    expect(dayGroup(NOW - 9 * 24 * HOUR, NOW)).toBe("Earlier");
  });

  it("puts moving threads first, then pinned, then recent days, newest first, skipping archived", () => {
    const groups = groupThreads(
      [
        thread("old", NOW - 10 * 24 * HOUR),
        thread("today", NOW - HOUR),
        thread("running", NOW - 2 * HOUR),
        thread("pinned", NOW - 30 * HOUR, { pinned: true }),
        thread("archived", NOW, { status: "archived" }),
        thread("today-newer", NOW - 10 * 60_000),
      ],
      { activeIds: new Set(["running"]), now: NOW },
    );
    expect(groups.map((group) => [group.title, group.threads.map((row) => row._id)])).toEqual([
      ["Active", ["running"]],
      ["Pinned", ["pinned"]],
      ["Today", ["today-newer", "today"]],
      ["Earlier", ["old"]],
    ]);
  });

  it("groups artifacts that several conversations worked on, busiest first", () => {
    const essay = { id: "essay", title: "Essay" };
    const deck = { id: "deck", title: "Deck" };
    const groups = groupThreads(
      [
        thread("a", NOW - HOUR, { contexts: { artifacts: [essay, deck] } }),
        thread("b", NOW - 2 * HOUR, { contexts: { artifacts: [essay] } }),
        thread("c", NOW - 3 * HOUR, { contexts: { artifacts: [essay, deck] } }),
        thread("d", NOW - 4 * HOUR, { contexts: { artifacts: [{ id: "lone", title: "Lone" }] } }),
      ],
      { now: NOW },
    );
    const artifactGroups = groups.filter((group) => group.key.startsWith("artifact:"));
    expect(artifactGroups.map((group) => [group.title, group.threads.length])).toEqual([
      ["Essay", 3],
      ["Deck", 2],
    ]);
  });

  it("keeps the recent list bounded", () => {
    const many = Array.from({ length: RECENT_LIMIT + 15 }, (_, index) => thread(`t${index}`, NOW - index * 60_000));
    const recent = groupThreads(many, { now: NOW }).filter((group) => group.key.startsWith("day:"));
    expect(recent.reduce((sum, group) => sum + group.threads.length, 0)).toBe(RECENT_LIMIT);
  });

  it("matches every word across titles, summaries and artifacts when search has nothing", () => {
    const rows = [
      thread("a", NOW, { title: "Photosynthesis notes", summaryShort: "Light reactions" }),
      thread("b", NOW, { title: "Essay plan", contexts: { artifacts: [{ id: "x", title: "Biology essay" }] } }),
    ];
    expect(matchThreads(rows, "light photosynthesis").map((row) => row._id)).toEqual(["a"]);
    expect(matchThreads(rows, "biology").map((row) => row._id)).toEqual(["b"]);
    expect(matchThreads(rows, "   ")).toEqual([]);
  });
});
