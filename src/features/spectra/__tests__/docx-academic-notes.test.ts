import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Document } from "@ariadng/office/docx";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { docxLens } from "../lenses/docx-lens";
import { docxProjectionFromContent } from "../lenses/document-projection";
import { documentYjsAdapter } from "../work/models/yjs/document-adapter";
import { docxOperationSchema } from "../lenses/projection-contracts";
import { MAX_WORD_NOTE_ID, existingWordNoteIdSchema, nextWordNoteId, wordNoteIdSchema } from "../lenses/docx-academic-schema";

const fixture = () => readFile(join(process.cwd(), "fixtures/office/docx/footnotes-endnotes.docx"));
const xml = (bytes: Uint8Array, part: string) => strFromU8(unzipSync(bytes)[part]!);

async function blank() {
  const document = Document.create();
  document.addParagraph("A careful claim and its neighbor.");
  document.addParagraph("A second paragraph.");
  return docxLens.open(await document.save());
}

describe("Academic Word note operations", () => {
  it("allocates unused Word-compatible note IDs and rejects values Word cannot store", () => {
    expect(wordNoteIdSchema.safeParse(String(MAX_WORD_NOTE_ID)).success).toBe(true);
    expect(wordNoteIdSchema.safeParse(String(MAX_WORD_NOTE_ID + 1)).success).toBe(false);
    expect(existingWordNoteIdSchema.safeParse(String(MAX_WORD_NOTE_ID + 1)).success).toBe(true);
    expect(existingWordNoteIdSchema.safeParse("2147483648").success).toBe(false);
    expect(nextWordNoteId([], 0)).toBe("1");
    expect(nextWordNoteId(["1", "2"], 0)).toBe("3");
    expect(nextWordNoteId(["32767"], 32_766)).toBe("1");
  });

  it("deletes a legacy out-of-range note without permitting another invalid note ID", async () => {
    const base = await blank();
    const paragraph = base.projection.blocks[0]!;
    const valid = await docxLens.mutate(base.preservedCarry, docxOperationSchema.parse({
      kind: "insert-note", noteType: "footnote", noteId: "41",
      anchor: { regionId: paragraph.id, start: 9, end: 9, expectedText: paragraph.text },
      content: [[{ text: "Legacy note" }]],
    }));
    const entries = unzipSync(valid);
    for (const part of ["word/document.xml", "word/footnotes.xml"]) {
      const xmlText = strFromU8(entries[part]!);
      expect(xmlText).toContain('w:id="41"');
      entries[part] = strToU8(xmlText.replaceAll('w:id="41"', 'w:id="40000"'));
    }
    const imported = await docxLens.open(zipSync(entries));
    expect(imported.projection.nativeBinding.wordNotes).toMatchObject([{ id: "40000", type: "footnote", text: "Legacy note" }]);

    const deleted = await docxLens.mutate(imported.preservedCarry, {
      kind: "delete-note", noteType: "footnote", noteId: "40000", expectedText: "Legacy note",
    });
    const reopened = await docxLens.open(deleted);
    expect(reopened.projection.nativeBinding.wordNotes ?? []).toEqual([]);
    expect(strFromU8(unzipSync(deleted)["word/footnotes.xml"]!)).not.toContain('w:id="40000"');
    expect(strFromU8(unzipSync(deleted)["word/document.xml"]!)).not.toContain('w:id="40000"');
    expect(docxOperationSchema.safeParse({
      kind: "insert-note", noteType: "footnote", noteId: "40000",
      anchor: { regionId: paragraph.id, start: 9, end: 9, expectedText: paragraph.text },
      content: [[{ text: "Must remain invalid" }]],
    }).success).toBe(false);
  });

  it.each(["footnote", "endnote"] as const)("inserts, edits rich content, moves and deletes a %s with reserved separators intact", async (noteType) => {
    const base = await blank();
    const paragraph = base.projection.blocks[0]!;
    const inserted = await docxLens.mutate(base.preservedCarry, docxOperationSchema.parse({
      kind: "insert-note", noteType, noteId: "41",
      anchor: { regionId: paragraph.id, start: 9, end: 9, expectedText: paragraph.text },
      content: [[{ text: "A source", bold: true }, { text: " with context." }], [{ text: "Second paragraph.", italic: true }]],
    }));
    const opened = await docxLens.open(inserted);
    expect(opened.projection.nativeBinding.wordNotes).toMatchObject([{ id: "41", type: noteType, text: "A source with context.\nSecond paragraph.", content: [[{ text: "A source", bold: true }, { text: " with context." }], [{ text: "Second paragraph.", italic: true }]] }]);
    const part = `word/${noteType}s.xml`;
    expect(xml(inserted, part)).toContain('w:id="-1"');
    expect(xml(inserted, part)).toContain('w:type="continuationSeparator"');
    const edited = await docxLens.mutate(opened.preservedCarry, { kind: "edit-note", noteType, noteId: "41", expectedText: "A source with context.\nSecond paragraph.", content: [[{ text: "Edited α 😀", underline: true }]] });
    const editedOpen = await docxLens.open(edited);
    const neighbor = editedOpen.projection.blocks[1]!;
    const moved = await docxLens.mutate(editedOpen.preservedCarry, { kind: "move-note", noteType, noteId: "41", anchor: { regionId: neighbor.id, start: 2, end: 2, expectedText: neighbor.text } });
    const movedOpen = await docxLens.open(moved);
    expect(movedOpen.projection.blocks[0]!.inlineContent?.some((item) => item.kind === "noteRef") ?? false).toBe(false);
    expect(movedOpen.projection.blocks[1]!.inlineContent?.find((item) => item.kind === "noteRef")).toMatchObject({ noteId: "41", text: "Edited α 😀" });
    const deleted = await docxLens.mutate(movedOpen.preservedCarry, { kind: "delete-note", noteType, noteId: "41", expectedText: "Edited α 😀" });
    expect((await docxLens.open(deleted)).projection.nativeBinding.wordNotes ?? []).toEqual([]);
    expect(xml(deleted, part)).toContain('w:id="-1"');
    expect(xml(deleted, part)).not.toContain('w:id="41"');
    expect(xml(deleted, "word/_rels/document.xml.rels")).toContain(`${noteType}s.xml`);
  });

  it("keeps the imported package byte-identical through Yjs and writes a neighboring rich edit without losing notes", async () => {
    const payload = await fixture();
    const base = await docxLens.open(payload);
    const ydoc = documentYjsAdapter.createDocument(base.projection);
    const projected = documentYjsAdapter.project(ydoc);
    const update = docxProjectionFromContent(projected, base.projection);
    expect(update.operations).toEqual([]);
    expect(await docxLens.materialize({ projection: update.projection, carry: base.preservedCarry })).toEqual(payload);
    const block = base.projection.blocks.find((candidate) => candidate.inlineContent?.some((item) => item.kind === "noteRef"))!;
    const changed = await docxLens.mutate(base.preservedCarry, { kind: "replace-paragraph", regionId: block.id, text: `${block.text} Neighbor changed.`, inlineContent: [...block.inlineContent!, { kind: "text", text: " Neighbor changed.", format: { italic: true } }] });
    const reopened = await docxLens.open(changed);
    expect(reopened.projection.nativeBinding.wordNotes).toEqual(base.projection.nativeBinding.wordNotes);
    expect(xml(changed, "word/footnotes.xml")).toBe(xml(payload, "word/footnotes.xml"));
    expect(xml(changed, "word/endnotes.xml")).toBe(xml(payload, "word/endnotes.xml"));
    ydoc.destroy();
  });

  it("refuses stale anchors, reserved IDs, reused identities and stale note body edits", async () => {
    const base = await blank();
    const paragraph = base.projection.blocks[0]!;
    const operation = { kind: "insert-note" as const, noteType: "footnote" as const, noteId: "10", anchor: { regionId: paragraph.id, start: 4, end: 4, expectedText: paragraph.text }, content: [[{ text: "Original" }]] };
    expect(docxOperationSchema.safeParse({ ...operation, noteId: "0" }).success).toBe(false);
    await expect(docxLens.mutate(base.preservedCarry, { ...operation, anchor: { ...operation.anchor, expectedText: "stale" } })).rejects.toThrow(/changed/);
    const opened = await docxLens.open(await docxLens.mutate(base.preservedCarry, operation));
    await expect(docxLens.mutate(opened.preservedCarry, operation)).rejects.toThrow(/identity/);
    await expect(docxLens.mutate(opened.preservedCarry, { kind: "edit-note", noteType: "footnote", noteId: "10", expectedText: "stale", content: [[{ text: "replacement" }]] })).rejects.toThrow(/changed/);
  });
});
