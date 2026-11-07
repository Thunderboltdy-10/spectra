import { describe, expect, it } from "vitest";
import { readableParts, textOf, versionPartChanges } from "../readable-version";

const doc = (...paragraphs: string[]) => ({
  title: "Notes",
  content: {
    tiptap: {
      type: "doc",
      content: paragraphs.map((text) => ({ type: "paragraph", attrs: { id: `b-${text}` }, content: [{ type: "text", text, marks: [{ type: "bold" }] }] })),
    },
    blocks: [{ id: "ignored", text: "not read when the tree is there" }],
  },
});

describe("readableParts", () => {
  it("reads a document's blocks as words, never its structure", () => {
    const parts = readableParts("document", doc("First.", "Second."));
    expect(parts.map((part) => part.text)).toEqual(["Notes", "First.", "Second."]);
    expect(JSON.stringify(parts)).not.toContain("attrs");
  });

  it("reads list items one by one", () => {
    const parts = readableParts("document", {
      content: { tiptap: { type: "doc", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] }, { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] }] }] } },
    });
    expect(parts.map((part) => part.text)).toEqual(["A", "B"]);
  });

  it("labels cards and sheet cells", () => {
    expect(readableParts("flashcard_deck", { content: { cards: [{ id: "x", front: "Q", back: "A" }] } })).toEqual([
      { label: "Card 1 front", text: "Q" },
      { label: "Card 1 back", text: "A" },
    ]);
    expect(readableParts("sheets", { content: { sheets: [{ name: "Marks", cells: { B2: { value: 7, format: { bold: true } } } }] } })).toEqual([
      { label: "Marks B2", text: "7" },
    ]);
  });

  it("skips anything that is not read", () => {
    expect(textOf({ id: "abc", color: "#fff", width: 12, text: "Kept" })).toBe("Kept");
  });
});

describe("versionPartChanges", () => {
  const parts = (...texts: string[]) => texts.map((text) => ({ text }));

  it("folds what stayed and pairs a replacement", () => {
    expect(versionPartChanges(parts("a", "b", "c"), parts("a", "B!", "c"))).toEqual([
      { kind: "same", count: 1, first: "a" },
      { kind: "changed", label: undefined, before: "b", after: "B!" },
      { kind: "same", count: 1, first: "c" },
    ]);
  });

  it("finds an addition in the middle", () => {
    const changes = versionPartChanges(parts("a", "c"), parts("a", "b", "c"));
    expect(changes.map((change) => change.kind)).toEqual(["same", "added", "same"]);
  });

  it("finds a removal", () => {
    const changes = versionPartChanges(parts("a", "b", "c"), parts("a", "c"));
    expect(changes.map((change) => change.kind)).toEqual(["same", "removed", "same"]);
  });

  it("says nothing changed when nothing did", () => {
    expect(versionPartChanges(parts("a", "b"), parts("a", "b"))).toEqual([{ kind: "same", count: 2, first: "a" }]);
  });
});
