import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { docxLens } from "../lenses/docx-lens";
import { docxRichInlineToJson } from "../lenses/document-projection";

const fixture = (name: string) =>
  readFileSync(join(process.cwd(), "fixtures/office/docx", name));

describe("Word review read-path projection (S9-OFFICE live gaps)", () => {
  it("lists individual revision marks from tracked-changes.docx", async () => {
    const opened = await docxLens.open(fixture("tracked-changes.docx"));
    const revisions = opened.projection.nativeBinding.wordRevisions ?? [];
    expect(revisions.length).toBeGreaterThan(0);
    expect(revisions.every((mark) => mark.kind === "del" || mark.kind === "ins")).toBe(
      true,
    );
    const placeholders = opened.projection.nativeBinding.nativePlaceholders.filter(
      (entry) => /tracked change/i.test(entry.label),
    );
    expect(placeholders.length).toBe(revisions.length);
    expect(placeholders[0]?.detail).toMatch(/Eric White|Word/i);
  });

  it("does not invent revision marks for complex-structure.docx (no w:ins/w:del)", async () => {
    const opened = await docxLens.open(fixture("complex-structure.docx"));
    expect(opened.projection.nativeBinding.wordRevisions ?? []).toEqual([]);
    expect(
      opened.projection.nativeBinding.nativePlaceholders.some((entry) =>
        /tracked change/i.test(entry.label),
      ),
    ).toBe(false);
  });

  it("projects footnote and endnote refs + bodies from footnotes-endnotes.docx", async () => {
    const opened = await docxLens.open(fixture("footnotes-endnotes.docx"));
    const notes = opened.projection.nativeBinding.wordNotes ?? [];
    expect(notes.filter((note) => note.type === "footnote")).toHaveLength(2);
    expect(notes.filter((note) => note.type === "endnote")).toHaveLength(2);
    expect(notes.some((note) => /test footnote/i.test(note.text))).toBe(true);
    expect(notes.some((note) => /test end notes/i.test(note.text))).toBe(true);

    const noteRefs = opened.projection.blocks.flatMap(
      (block) =>
        block.inlineContent?.filter((item) => item.kind === "noteRef") ?? [],
    );
    expect(noteRefs).toHaveLength(4);
    expect(noteRefs.filter((item) => item.kind === "noteRef" && item.noteType === "footnote")).toHaveLength(2);
    expect(noteRefs.filter((item) => item.kind === "noteRef" && item.noteType === "endnote")).toHaveLength(2);

    const json = docxRichInlineToJson(noteRefs, opened.projection.nativeBinding);
    expect(json?.some((node) => node.type === "footnote")).toBe(true);
    expect(json?.some((node) => node.type === "endnote")).toBe(true);
  });

  it("projects native Word comments from tracked-changes.docx without flattening", async () => {
    const opened = await docxLens.open(fixture("tracked-changes.docx"));
    const comments = opened.projection.nativeBinding.wordComments ?? [];
    expect(comments).toHaveLength(1);
    expect(comments[0]?.author).toMatch(/Eric White/i);
    expect(comments[0]?.text).toMatch(/This is a comment/i);
    const commented = opened.projection.blocks.find(
      (block) => block.attrs?.nativeReadOnly === true,
    );
    expect(commented).toBeTruthy();
  });
});
