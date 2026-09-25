import { describe, expect, it } from "vitest";
import { Document } from "@ariadng/office/docx";
import { strFromU8, unzipSync } from "fflate";
import { docxLens, docxProjectionReadbackDigest, docxProjectionSemanticDigest } from "../lenses/docx-lens";
import { docxOperationsBetween } from "../lenses/document-projection";
import type { DocxProjection } from "../lenses/projection-contracts";

async function blank() {
  const document = Document.create();
  document.addParagraph("Original first"); document.addParagraph("Original second");
  return docxLens.open(await document.save());
}

describe("Shared DOCX delta and insertion policy", () => {
  it("writes new paragraph formatting identically through explicit deltas and materialization", async () => {
    const base = await blank();
    const desired: DocxProjection = { ...base.projection, blocks: [
      base.projection.blocks[1]!,
      { id: "new-center", type: "paragraph", text: "Centered", attrs: { format: { bold: true, color: "FF0000" }, paragraphFormat: { alignment: "center", spacingAfterPoints: 12 } } },
      { id: "new-right", type: "paragraph", text: "Right", attrs: { paragraphFormat: { alignment: "right" } } },
      base.projection.blocks[0]!,
    ] };
    const operations = docxOperationsBetween(base.projection, desired);
    expect(operations).toContainEqual({ kind: "format-paragraph", regionId: "new-center", format: { alignment: "center", spacingAfterPoints: 12 } });
    const materialized = await docxLens.open(await docxLens.materialize({ carry: base.preservedCarry, projection: desired }));
    const explicit = await docxLens.open(await docxLens.mutate(base.preservedCarry, { kind: "ai-edit", operations }));
    expect(materialized.projection.blocks.map((block) => block.text)).toEqual(desired.blocks.map((block) => block.text));
    expect(materialized.projection.blocks[1]?.attrs?.format).toMatchObject({ bold: true, color: "FF0000" });
    expect(materialized.projection.blocks[1]?.attrs?.paragraphFormat).toMatchObject({ alignment: "center", spacingAfterPoints: 12 });
    expect(await docxProjectionReadbackDigest(materialized.projection, desired)).toBe(await docxProjectionSemanticDigest(desired));
    expect(await docxProjectionSemanticDigest(explicit.projection)).toBe(await docxProjectionSemanticDigest(materialized.projection));
  });

  it("resolves caller IDs for academic and format operations following an insertion", async () => {
    const base = await blank();
    const output = await docxLens.mutate(base.preservedCarry, { kind: "ai-edit", operations: [
      { kind: "insert-paragraph", regionId: "new-caller-id", text: "New claim", afterRegionId: base.projection.blocks[0]!.id },
      { kind: "format-paragraph", regionId: "new-caller-id", format: { alignment: "center" } },
      { kind: "insert-note", noteType: "footnote", noteId: "7", content: [[{ text: "New evidence" }]], anchor: { regionId: "new-caller-id", expectedText: "New claim", start: 0, end: 0 } },
    ] });
    const reopened = await docxLens.open(output);
    const block = reopened.projection.blocks.find((block) => block.text === "New claim")!;
    expect(block.attrs?.paragraphFormat).toMatchObject({ alignment: "center" });
    expect(block.inlineContent).toContainEqual(expect.objectContaining({ kind: "noteRef", noteId: "7", text: "New evidence" }));
  });

  it("keeps native style inheritance on a text edit and writes only explicitly changed formatting", async () => {
    const base = await blank();
    const styled = await docxLens.open(await docxLens.mutate(base.preservedCarry, { kind: "apply-style", regionId: base.projection.blocks[0]!.id, style: "Heading1" }));
    const desired: DocxProjection = { ...styled.projection, blocks: styled.projection.blocks.map((block, index) => index ? block : { ...block, text: "Changed heading", inlineContent: undefined }) };
    const operations = docxOperationsBetween(styled.projection, desired);
    expect(operations.some((operation) => operation.kind === "format-runs")).toBe(false);
    const output = await docxLens.materialize({ carry: styled.preservedCarry, projection: desired });
    const xml = strFromU8(unzipSync(output)["word/document.xml"]!);
    expect(xml).toContain("Changed heading");
    expect(xml).not.toContain("<w:b");
    const missingAttrs: DocxProjection = { ...styled.projection, blocks: styled.projection.blocks.map(({ attrs: _attrs, ...block }) => block) };
    expect(docxOperationsBetween(styled.projection, missingAttrs)).toEqual([]);
  });

  it("inserts an equation with its authored alignment and retains it on an unchanged pass", async () => {
    const base = await blank();
    const desired: DocxProjection = { ...base.projection, blocks: [...base.projection.blocks, { id: "new-equation", type: "paragraph", text: "x^2", attrs: { alignment: "right", display: "block" }, inlineContent: [{ kind: "equation", latex: "x^2", display: "block" }] }] };
    const reopened = await docxLens.open(await docxLens.materialize({ carry: base.preservedCarry, projection: desired }));
    expect(reopened.projection.blocks.at(-1)?.attrs?.alignment).toBe("right");
    expect(docxOperationsBetween(reopened.projection, reopened.projection)).toEqual([]);
    expect(await docxLens.materialize({ carry: reopened.preservedCarry, projection: reopened.projection })).toEqual(reopened.preservedCarry.payload);
  });

  it("rejects unsupported new tables through the shared policy", async () => {
    const base = await blank();
    const desired: DocxProjection = { ...base.projection, blocks: [...base.projection.blocks, { id: "new-table", type: "table", text: "Cell", rows: [["Cell"]] }] };
    expect(() => docxOperationsBetween(base.projection, desired)).toThrow(/new table/);
    await expect(docxLens.materialize({ carry: base.preservedCarry, projection: desired })).rejects.toThrow(/new table/);
  });
});
