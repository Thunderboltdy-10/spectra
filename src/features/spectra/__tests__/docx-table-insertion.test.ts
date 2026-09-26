// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Document, WML_NAMESPACE } from "@ariadng/office/docx";
import { unzipSync } from "fflate";
import { docxLens, docxProjectionReadbackDigest, docxProjectionSemanticDigest } from "../lenses/docx-lens";
import { documentBlocksFromJson, documentContentToProseMirrorJson, docxOperationsBetween, docxProjectionFromContent } from "../lenses/document-projection";
import { docxInsertTableOperationSchema, docxSemanticDeltaSchema, type DocxProjection, type DocxProjectionBlock } from "../lenses/projection-contracts";
import { officeCapabilitiesFor } from "../capabilities";
import { commandContext } from "../commands/registry";
import { fidelityRegionMap } from "../commands/office/fidelity-regions";

const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const BlockAttrs = Extension.create({ name: "testTableAttrs", addGlobalAttributes() { return [{ types: ["table"], attributes: { blockId: { default: "new-table" }, spectraAuthored: { default: false } } }]; } });

async function blank() {
  const document = Document.create();
  document.addParagraph("Before"); document.addParagraph("After");
  document.office.package.addPart("/customXml/retained.xml", "application/xml", new TextEncoder().encode('<v:record xmlns:v="urn:vendor" value="keep"/>'));
  document.office.mainPart.relationships().add({ type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml", target: "../customXml/retained.xml" });
  return docxLens.open(await document.save());
}

function insertProjection(base: DocxProjection, table: DocxProjectionBlock): DocxProjection {
  return { ...base, blocks: [base.blocks[0]!, table, ...base.blocks.slice(1)] };
}

function expectRetainedParts(before: Uint8Array, after: Uint8Array) {
  const original = unzipSync(before); const result = unzipSync(after);
  expect(Object.keys(result).sort()).toEqual(Object.keys(original).sort());
  for (const name of Object.keys(original)) if (name !== "word/document.xml") expect(result[name], name).toEqual(original[name]);
}

describe("Native DOCX table insertion", () => {
  it("materializes the toolbar's 3×3 header table through shared editor conversion", async () => {
    const base = await blank();
    const element = document.createElement("div");
    const editor = new Editor({ element, extensions: [StarterKit, BlockAttrs, Table, TableRow, TableCell, TableHeader], content: "<p></p>" });
    let generated;
    try {
      expect(editor.chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).updateAttributes("table", { spectraAuthored: true }).run()).toBe(true);
      generated = editor.getJSON().content!.find((node) => node.type === "table")!;
    } finally { editor.destroy(); }
    const table = documentBlocksFromJson({ type: "doc", content: [generated] })[0]! as DocxProjectionBlock;
    expect(table.rows).toEqual(Array.from({ length: 3 }, () => ["", "", ""]));
    expect(table.attrs?.headerRow).toBe(true);
    const update = docxProjectionFromContent({ blocks: insertProjection(base.projection, table).blocks, nativeProjectionComplete: true }, base.projection);
    expect(update.operations.find((operation) => operation.kind === "insert-table")).toMatchObject({ regionId: table.id, headerRow: true, rows: table.rows });
    const output = await docxLens.materialize({ carry: base.preservedCarry, projection: update.projection });
    const reopened = await docxLens.open(output);
    expect(reopened.projection.blocks.map((block) => block.type)).toEqual(["paragraph", "table", "paragraph"]);
    expect(reopened.projection.blocks[1]).toMatchObject({ rows: table.rows, attrs: { headerRow: true } });
    expect(await docxProjectionReadbackDigest(reopened.projection, update.projection)).toBe(await docxProjectionSemanticDigest(update.projection));
    const explicit = await docxLens.open(await docxLens.mutate(base.preservedCarry, { kind: "ai-edit", operations: update.operations }));
    expect(await docxProjectionSemanticDigest(explicit.projection)).toBe(await docxProjectionSemanticDigest(reopened.projection));
    const native = await Document.open(output);
    const grid = native.tables()[0]!.element.find(WML_NAMESPACE, "tblGrid")!.elements();
    expect(grid).toHaveLength(3);
    expect(new Set(grid.map((column) => column.getAttributeNs(WML_NAMESPACE, "w"))).size).toBe(1);
    expect(Number(grid[0]!.getAttributeNs(WML_NAMESPACE, "w"))).toBeGreaterThan(0);
    expect(native.tables()[0]!.element.find(WML_NAMESPACE, "tblPr")!.find(WML_NAMESPACE, "tblBorders")!.elements()).toHaveLength(6);
    expect(native.body().elements().at(-1)?.localName).toBe("sectPr");
    expectRetainedParts(base.preservedCarry.payload, output);
    expect(docxOperationsBetween(reopened.projection, reopened.projection)).toEqual([]);
    expect(await docxLens.materialize({ carry: reopened.preservedCarry, projection: reopened.projection })).toEqual(output);
    const capability = officeCapabilitiesFor("document").find((entry) => entry.id === "document.insert.table")!;
    expect(capability.native).toMatchObject({ delta: "insert-table", touches: ["tableStructure"] });
    expect(capability.availability(commandContext("document", () => true, "owner", undefined, { compatibilityProfile: "strict-native", fidelity: fidelityRegionMap(base.fidelityMap.entries) })).state).toBe("enabled");
  });

  it.each([true, false, undefined])("retains header intent %s in native and editor roundtrips", async (headerRow) => {
    const base = await blank();
    const table: DocxProjectionBlock = { id: "new-header", type: "table", text: "A | B", rows: [["A", "B"]], ...(headerRow !== undefined ? { attrs: { headerRow } } : {}) };
    const desired = insertProjection(base.projection, table);
    const output = await docxLens.materialize({ carry: base.preservedCarry, projection: desired });
    const reopened = await docxLens.open(output);
    const actual = reopened.projection.blocks[1]!;
    expect(actual.attrs?.headerRow).toBe(headerRow ?? false);
    expect(await docxProjectionReadbackDigest(reopened.projection, desired)).toBe(await docxProjectionSemanticDigest(desired));
    const native = await Document.open(output);
    const header = native.tables()[0]!.element.find(WML_NAMESPACE, "tr")!.find(WML_NAMESPACE, "trPr")?.find(WML_NAMESPACE, "tblHeader");
    expect(header?.getAttributeNs(WML_NAMESPACE, "val")).toBe(headerRow === undefined ? undefined : headerRow ? "1" : "0");
    const editor = documentContentToProseMirrorJson({ blocks: [actual] });
    expect(editor.content?.[0]?.content?.[0]?.content?.every((cell) => cell.type === (headerRow ? "tableHeader" : "tableCell"))).toBe(true);
    expect(documentBlocksFromJson(editor)[0]?.attrs?.headerRow).toBe(headerRow ?? false);
    const wrongHeader = { ...reopened.projection, blocks: reopened.projection.blocks.map((block, index) => index === 1 ? { ...block, attrs: { ...block.attrs, headerRow: !headerRow } } : block) };
    expect(await docxProjectionReadbackDigest(wrongHeader, desired)).not.toBe(await docxProjectionSemanticDigest(desired));
  });

  it("preserves rich cell text and formatting and detects lost formatting", async () => {
    const base = await blank();
    const table: DocxProjectionBlock = { id: "new-rich", type: "table", text: "Bold | Plain", rows: [["Bold", "Plain"]], attrs: { headerRow: false }, richRows: [[[{ kind: "text", text: "Bold", format: { bold: true, color: "FF0000" } }], [{ kind: "text", text: "Plain" }]]] };
    const desired = insertProjection(base.projection, table);
    const output = await docxLens.materialize({ carry: base.preservedCarry, projection: desired });
    const reopened = await docxLens.open(output);
    expect(reopened.projection.blocks[1]?.richRows?.[0]?.[0]?.[0]).toMatchObject({ kind: "text", text: "Bold", format: { bold: true, color: "FF0000" } });
    expect(await docxProjectionReadbackDigest(reopened.projection, desired)).toBe(await docxProjectionSemanticDigest(desired));
    const corrupted = structuredClone(reopened.projection);
    corrupted.blocks[1]!.richRows![0]![0] = [{ kind: "text", text: "Bold" }];
    expect(await docxProjectionReadbackDigest(corrupted, desired)).not.toBe(await docxProjectionSemanticDigest(desired));
    expectRetainedParts(base.preservedCarry.payload, output);
  });

  it("resolves new IDs through row edits, reorder and deletion without anchor collisions", async () => {
    const base = await blank();
    const callerId = base.projection.blocks[0]!.id.replace("paragraph", "table");
    const operations = docxSemanticDeltaSchema.parse({ kind: "ai-edit", operations: [
      { kind: "insert-table", regionId: callerId, afterRegionId: null, rows: [["Start", "Other"]] },
      { kind: "insert-table-row", regionId: callerId, row: 0 },
      { kind: "edit-table-cell", regionId: callerId, row: 0, column: 0, text: "New first" },
      { kind: "delete-table-row", regionId: callerId, row: 1 },
      { kind: "reorder-regions", order: [base.projection.blocks[0]!.id, base.projection.blocks[1]!.id, callerId] },
    ] });
    const output = await docxLens.mutate(base.preservedCarry, operations);
    const reopened = await docxLens.open(output);
    const table = reopened.projection.blocks.at(-1)!;
    expect(table.rows).toEqual([["New first", ""]]);
    expect(table.id).not.toBe(callerId);
    const native = await Document.open(output);
    const ids = native.paragraphs().map((paragraph) => paragraph.element.getAttributeNs(W14, "paraId")).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    const deleted = await docxLens.mutate(base.preservedCarry, { kind: "ai-edit", operations: [...(operations.kind === "ai-edit" ? operations.operations : []), { kind: "delete-region", regionId: callerId }] });
    expect((await docxLens.open(deleted)).projection.blocks.map((block) => block.text)).toEqual(["Before", "After"]);
    expectRetainedParts(base.preservedCarry.payload, deleted);
  });

  it("rejects empty, ragged, oversized or mismatched rich requests before creating native content", async () => {
    const base = await blank();
    const before = base.preservedCarry.payload.slice();
    for (const input of [
      { rows: [] }, { rows: [[]] }, { rows: [["A"], ["B", "C"]] },
      { rows: [Array(64).fill("")] }, { rows: Array.from({ length: 1_001 }, () => [""]) },
      { rows: Array.from({ length: 200 }, () => Array(63).fill("")) },
      { rows: [["A", "B"]], richRows: [[[]]] },
      { rows: [["A"]], richRows: [[[{ kind: "table", rows: [["nested"]] }]]] },
      { rows: [["A"]], headerRow: "false" },
    ]) {
      const operation = { kind: "insert-table", ...input };
      expect(docxInsertTableOperationSchema.safeParse(operation).success).toBe(false);
      await expect(docxLens.mutate(base.preservedCarry, operation as never)).rejects.toThrow();
    }
    expect(base.preservedCarry.payload).toEqual(before);
  });

  it.each(["merged", "nested", "mixed-header"])("rejects %s editor structures rather than flattening them", async (kind) => {
    const base = await blank();
    const cell = { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] };
    const json = { type: "doc", content: [{ type: "table", content: [{ type: "tableRow", content: [
      kind === "merged" ? { ...cell, attrs: { colspan: 2, rowspan: 1 } } : kind === "nested" ? { ...cell, content: [{ type: "table", content: [] }] } : { ...cell, type: "tableHeader" }, cell,
    ] }] }] };
    const block = documentBlocksFromJson(json)[0]! as DocxProjectionBlock;
    expect(block.attrs?.unsupportedTableStructure).toBe(true);
    await expect(docxLens.materialize({ carry: base.preservedCarry, projection: insertProjection(base.projection, block) })).rejects.toThrow(/Merged, nested or irregular/);
  });

  it("keeps existing header transformations unavailable", async () => {
    const base = await blank();
    const bytes = await docxLens.mutate(base.preservedCarry, { kind: "insert-table", rows: [["Cell"]], headerRow: false });
    const opened = await docxLens.open(bytes);
    const desired = { ...opened.projection, blocks: opened.projection.blocks.map((block) => block.type === "table" ? { ...block, attrs: { ...block.attrs, headerRow: true } } : block) };
    expect(() => docxOperationsBetween(opened.projection, desired)).toThrow(/header structure/);
  });
});
