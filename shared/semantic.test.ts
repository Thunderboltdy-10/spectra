import { describe, expect, it } from "vitest";
import { artifactChunkDrafts, finalizeChunks, foldForSearch, schoolRecordTypeIndexed, threadChunkDrafts } from "./semantic-chunks";
import { inWindow, isUpcoming, parseQueryCues } from "./semantic-query";
import { centroid, cosine, fuseAndGroup, hintedItemFits, isCopy, lexicalText, rankWithSignals, snippetFor } from "./semantic-ranking";

const NOW = Date.UTC(2026, 9, 4, 12); // Sunday
const DAY = 86_400_000;

describe("semantic chunks", () => {
  it("starts with a title chunk and anchors each passage to its block", () => {
    const drafts = artifactChunkDrafts({ blueprintKey: "document", title: "Cells", summary: "Cell structure.", content: { blocks: [
      { id: "h1", type: "heading", text: "Organelles" }, { id: "p1", type: "paragraph", text: "Mitochondria make ATP." },
    ] } });
    expect(drafts[0]).toMatchObject({ chunkKey: "title" });
    expect(drafts[0]!.text).toContain("Cell structure.");
    expect(drafts[1]).toMatchObject({ regionId: "h1" });
    expect(drafts[1]!.text).toContain("Mitochondria make ATP.");
  });

  it("keeps quiz bodies for the owner only, but not the title chunk", () => {
    const drafts = artifactChunkDrafts({ blueprintKey: "quiz", title: "Plants", content: { questions: [
      { id: "q1", prompt: "What do plants need?", answer: "Light" },
    ] } });
    expect(drafts[0]!.ownerOnly).toBeUndefined();
    expect(drafts.slice(1).every((draft) => draft.ownerOnly)).toBe(true);
  });

  it("falls back to the text index when the content shape is unknown", () => {
    const drafts = artifactChunkDrafts({ blueprintKey: "document", title: "Notes", content: "not an object", textIndex: "Plain words." });
    expect(drafts.map((draft) => draft.text)).toContain("Plain words.");
  });

  it("joins short thread messages with the next one and anchors to the first message", () => {
    const drafts = threadChunkDrafts({ title: "Help", messages: [
      { id: "m1", role: "user", content: "Can you help with titration?" },
      { id: "t1", role: "tool", content: "ignored tool output" },
      { id: "m2", role: "assistant", content: "Yes. ".repeat(40) },
    ] });
    expect(drafts).toHaveLength(2);
    expect(drafts[1]).toMatchObject({ messageId: "m1" });
    expect(drafts[1]!.text).toContain("You: Can you help");
    expect(drafts[1]!.text).not.toContain("ignored");
  });

  it("hashes title, label and passage, so only changed chunks are re-embedded", async () => {
    const [a] = await finalizeChunks("Cells", [{ chunkKey: "x", text: "Same text." }]);
    const [b] = await finalizeChunks("Cells", [{ chunkKey: "x", text: "Same text." }]);
    const [c] = await finalizeChunks("Cells", [{ chunkKey: "x", text: "Other text." }]);
    expect(a!.contentHash).toBe(b!.contentHash);
    expect(a!.contentHash).not.toBe(c!.contentHash);
    expect(a!.searchText).toBe(foldForSearch(a!.embedText));
  });

  it("folds accents and skips school record types that are not worth searching", () => {
    expect(foldForSearch("Fotosíntesis")).toBe("fotosintesis");
    expect(schoolRecordTypeIndexed("membership")).toBe(false);
    expect(schoolRecordTypeIndexed("cas_reflection")).toBe(true);
  });
});

describe("query cues", () => {
  it("reads type words and keeps content words for full-text", () => {
    const cues = parseQueryCues("my chemistry notes", { now: NOW });
    expect(cues.types).toContainEqual(expect.objectContaining({ kind: "artifact" }));
    expect(cues.contentTerms).toEqual(["chemistry"]);
    expect(lexicalText(cues)).toBe("chemistry");
  });

  it("turns yesterday into a past window and drops the time words from the text", () => {
    const cues = parseQueryCues("the essay from yesterday", { now: NOW });
    expect(cues.window).toMatchObject({ future: false });
    expect(cues.text).toBe("essay");
    expect(inWindow(cues, { updatedAt: NOW - DAY })).toBe(true);
    expect(inWindow(cues, { updatedAt: NOW - 3 * DAY })).toBe(false);
  });

  it("respects the viewer's timezone for day windows", () => {
    // 01:00 UTC on Monday is still Sunday evening at UTC-5 (offset +300 minutes).
    const now = Date.UTC(2026, 9, 5, 1);
    const cues = parseQueryCues("today", { now, timezoneOffsetMinutes: 300 });
    expect(inWindow(cues, { updatedAt: Date.UTC(2026, 9, 4, 20) })).toBe(true);
  });

  it("reads 'when' and 'due' as upcoming, within two weeks", () => {
    const cues = parseQueryCues("when is my chemistry test", { now: NOW });
    expect(cues.upcoming).toBe(true);
    expect(cues.text).not.toContain("when");
    expect(isUpcoming(cues, { timeAt: NOW + DAY }, NOW)).toBe(true);
    expect(isUpcoming(cues, { timeAt: NOW + 30 * DAY }, NOW)).toBe(false);
    expect(isUpcoming(cues, {}, NOW)).toBe(false);
  });

  it("reads 'what did I ask' as a thread cue without question words as content", () => {
    const cues = parseQueryCues("what did I ask about titration", { now: NOW });
    expect(cues.types).toContainEqual({ kind: "thread" });
    expect(cues.contentTerms).toEqual(["titration"]);
  });

  it("never returns empty text", () => {
    expect(parseQueryCues("yesterday", { now: NOW }).text).toBe("yesterday");
  });
});

describe("ranking", () => {
  const chunks = new Map([
    ["c1", { chunkId: "c1", itemKey: "a", title: "A", text: "alpha" }],
    ["c2", { chunkId: "c2", itemKey: "a", title: "A", text: "alpha two" }],
    ["c3", { chunkId: "c3", itemKey: "b", title: "B", text: "beta" }],
  ]);

  it("fuses lists by reciprocal rank and groups chunks by item", () => {
    const fused = fuseAndGroup({ chunks, vector: [{ chunkId: "c3", similarity: 0.9 }, { chunkId: "c1", similarity: 0.8 }],
      words: ["c1", "c2"], title: ["c1"] });
    expect(fused.map((item) => item.itemKey)).toEqual(["a", "b"]);
    expect(fused[0]).toMatchObject({ best: { chunkId: "c1" }, matchedBy: ["meaning", "words", "title"] });
    expect(fused[0]!.normalized).toBeLessThanOrEqual(1);
  });

  it("drops vector hits below the similarity floor", () => {
    const fused = fuseAndGroup({ chunks, vector: [{ chunkId: "c3", similarity: 0.01 }], words: [] });
    expect(fused).toEqual([]);
  });

  it("adds type, time, open and recent signals as order, never as filters", () => {
    const cues = parseQueryCues("the deck from yesterday", { now: NOW });
    const ranked = rankWithSignals([
      { itemId: "doc", kind: "artifact", subtype: "document", base: 0.6, matchedBy: ["meaning"], updatedAt: NOW - 10 * DAY },
      { itemId: "deck", kind: "artifact", subtype: "presentation", base: 0.3, matchedBy: ["meaning"], updatedAt: NOW - DAY },
    ], cues, { now: NOW });
    expect(ranked.map((item) => item.itemId)).toEqual(["deck", "doc"]);
    expect(ranked[0]!.matchedBy).toEqual(expect.arrayContaining(["type", "when"]));
    const opened = rankWithSignals([
      { itemId: "x", kind: "artifact", base: 0.5, matchedBy: [] }, { itemId: "y", kind: "artifact", base: 0.45, matchedBy: [] },
    ], parseQueryCues("notes", { now: NOW }), { now: NOW, openItemIds: ["y"] });
    expect(opened[0]).toMatchObject({ itemId: "y", matchedBy: ["open"] });
  });

  it("admits a hinted item only when it fits the query", () => {
    const cues = parseQueryCues("my chemistry notes", { now: NOW });
    expect(hintedItemFits(cues, { kind: "artifact", title: "Chemistry: acids" })).toBe(true);
    expect(hintedItemFits(cues, { kind: "artifact", title: "Budget" })).toBe(false);
    expect(hintedItemFits(parseQueryCues("the presentation", { now: NOW }), { kind: "artifact", subtype: "presentation", title: "X" })).toBe(true);
  });

  it("treats same content and near-identical lineage as copies", () => {
    expect(isCopy({ sameDigest: true, lineage: false, similarity: 0 })).toBe(true);
    expect(isCopy({ sameDigest: false, lineage: true, similarity: 0.98 })).toBe(true);
    expect(isCopy({ sameDigest: false, lineage: false, similarity: 0.98 })).toBe(false);
  });

  it("builds unit centroids and snippets around the first query word", () => {
    const mean = centroid([[1, 0], [0, 2]])!;
    expect(cosine(mean, [1, 1])).toBeCloseTo(1);
    const text = `${"filler ".repeat(60)}mitochondria are the powerhouse ${"tail ".repeat(60)}`;
    const snippet = snippetFor(text, "powerhouse");
    expect(snippet).toContain("powerhouse");
    expect(snippet.startsWith("…")).toBe(true);
  });
});
