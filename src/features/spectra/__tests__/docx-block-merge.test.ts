import { describe, expect, it } from "vitest";
import { mergeDocxBlock } from "../lenses/docx-block-merge";
import { mergeThreeWay } from "../lenses/three-way-merge";
import type { DocxProjectionBlock } from "../lenses/projection-contracts";

const paragraph = (text: string, extra: Partial<DocxProjectionBlock> = {}): DocxProjectionBlock =>
  ({ id: "p1", type: "paragraph", text, attrs: { styleId: "Normal" }, ...extra });

describe("merging inside a paragraph both sides changed", () => {
  const base = paragraph("The mitochondria is the powerhouse of the cell. It makes energy.");

  it("keeps a Word typo fix and a Spectra sentence edit in different places", () => {
    const ours = paragraph("The mitochondria is the powerhouse of the cell. It makes ATP from glucose.");
    const theirs = paragraph("The mitochondrion is the powerhouse of the cell. It makes energy.");
    expect(mergeDocxBlock(base, ours, theirs)?.text).toBe("The mitochondrion is the powerhouse of the cell. It makes ATP from glucose.");
  });

  it("leaves two different changes to the same words a conflict", () => {
    const ours = paragraph("The mitochondria is the engine of the cell. It makes energy.");
    const theirs = paragraph("The mitochondria is the battery of the cell. It makes energy.");
    expect(mergeDocxBlock(base, ours, theirs)).toBeUndefined();
  });

  it("takes the same change made on both sides once", () => {
    const both = paragraph("The mitochondria is the powerhouse of the cell! It makes energy.");
    const ours = paragraph("Indeed, the mitochondria is the powerhouse of the cell! It makes energy.");
    expect(mergeDocxBlock(base, ours, both)?.text).toBe("Indeed, the mitochondria is the powerhouse of the cell! It makes energy.");
  });

  it("carries run formatting and inline atoms through the merge", () => {
    const rich = (runs: DocxProjectionBlock["inlineContent"]) => ({
      ...paragraph(runs!.map((run) => (run.kind === "text" ? run.text : run.kind === "equation" ? run.latex : "")).join("")),
      inlineContent: runs,
    });
    const equation = { kind: "equation" as const, latex: "E=mc^2", display: "inline" as const };
    const baseRich = rich([{ kind: "text", text: "Energy is " }, equation, { kind: "text", text: " in physics." }]);
    // Word bolds "physics"; Spectra rewrites the opening.
    const theirs = rich([
      { kind: "text", text: "Energy is " }, equation, { kind: "text", text: " in " },
      { kind: "text", text: "physics", format: { bold: true } }, { kind: "text", text: "." },
    ]);
    const ours = rich([{ kind: "text", text: "Rest energy is " }, equation, { kind: "text", text: " in physics." }]);
    const merged = mergeDocxBlock(baseRich, ours, theirs);
    expect(merged?.text).toBe("Rest energy is E=mc^2 in physics.");
    expect(merged?.inlineContent).toEqual([
      { kind: "text", text: "Rest energy is " }, equation, { kind: "text", text: " in " },
      { kind: "text", text: "physics", format: { bold: true } }, { kind: "text", text: "." },
    ]);
  });

  it("merges a style change on one side with a word change on the other", () => {
    const ours = paragraph("The mitochondria is the powerhouse of the cell. It makes lots of energy.");
    const theirs = paragraph(base.text, { attrs: { styleId: "Quote" } });
    expect(mergeDocxBlock(base, ours, theirs)).toMatchObject({ text: ours.text, attrs: { styleId: "Quote" } });
    const otherStyle = paragraph(ours.text, { attrs: { styleId: "Heading1" } });
    expect(mergeDocxBlock(base, otherStyle, theirs)).toBeUndefined();
  });

  it("does not trust runs left behind when only the text was edited", () => {
    const runs = [{ kind: "text" as const, text: base.text, format: { italic: true } }];
    const baseRich = { ...base, inlineContent: runs };
    const ours = { ...baseRich, text: "Rewritten in Spectra." };
    const theirs = { ...baseRich, text: base.text.replace("energy", "power"), inlineContent: [{ ...runs[0], text: base.text.replace("energy", "power") }] };
    expect(mergeDocxBlock(baseRich, ours, theirs)).toBeUndefined();
  });

  it("keeps a deleted block against an edit as a conflict", () => {
    expect(mergeDocxBlock(base, undefined, paragraph("Changed."))).toBeUndefined();
  });

  it("merges different cells of one table", () => {
    const table = (rows: string[][]): DocxProjectionBlock => ({
      id: "t1", type: "table", text: rows.map((row) => row.join(" | ")).join("\n"), rows, attrs: { rowCount: rows.length, columnCount: 2 },
    });
    const baseTable = table([["Name", "Score"], ["Ana", "7"]]);
    const merged = mergeDocxBlock(baseTable, table([["Name", "Score"], ["Ana", "8"]]), table([["Student", "Score"], ["Ana", "7"]]));
    expect(merged).toMatchObject({ rows: [["Student", "Score"], ["Ana", "8"]], text: "Student | Score\nAna | 8" });
    expect(mergeDocxBlock(baseTable, table([["Name", "Score"], ["Ana", "8"]]), table([["Name", "Score"], ["Ana", "9"]]))).toBeUndefined();
  });

  it("is used by the region merge so the paragraph is no longer reported as a conflict", () => {
    const ours = paragraph("The mitochondria is the powerhouse of the cell. It makes ATP.");
    const theirs = paragraph("The mitochondrion is the powerhouse of the cell. It makes energy.");
    const merged = mergeThreeWay({ base: [base], ours: [ours], theirs: [theirs], id: (block) => block.id, mergeRegion: mergeDocxBlock });
    expect(merged.conflicts).toEqual([]);
    expect(merged.value[0]?.text).toBe("The mitochondrion is the powerhouse of the cell. It makes ATP.");
  });
});

describe("choosing per paragraph", () => {
  it("keeps Word's, mine or both for each clashing paragraph", async () => {
    const { Document } = await import("@ariadng/office/docx");
    const { docxLens } = await import("../lenses/docx-lens");
    const { mergeDocxProjections } = await import("@/app/api/spectra/lenses/docx/route");
    const document = Document.create();
    document.addParagraph("First paragraph as it was.");
    document.addParagraph("Second paragraph as it was.");
    const base = (await docxLens.open(await document.save())).projection;
    const [first, second] = base.blocks;
    const edit = (text: [string, string]) => ({
      ...structuredClone(base),
      blocks: base.blocks.map((block, index) => ({ ...block, text: text[index]!, inlineContent: undefined })),
    });
    const ours = edit(["Mine, rewritten.", "Mine again."]);
    const theirs = edit(["Word, rewritten.", "Word again."]);
    expect(mergeDocxProjections(base, ours, theirs).conflicts.map((conflict) => conflict.id)).toEqual([first!.id, second!.id]);
    const chosen = mergeDocxProjections(base, ours, theirs, { regions: { [first!.id]: "word", [second!.id]: "both" } });
    expect(chosen.projection.blocks.map((block) => block.text)).toEqual(["Word, rewritten.", "Word again.", "Mine again."]);
    expect(chosen.projection.blocks[1]!.id).toBe(second!.id);
    expect(chosen.projection.blocks[2]!.id).not.toBe(second!.id);
  });
});
