import { describe, expect, it } from "vitest";
import { Document } from "@ariadng/office/docx";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { applyDocumentAcademicOperations } from "../commands/office/document-academic-operations";
import { docxProjectionFromContent } from "../lenses/document-projection";
import { docxLens, docxProjectionReadbackDigest, docxProjectionSemanticDigest } from "../lenses/docx-lens";
import { createEvidenceSpanAt, createVerifiedSource } from "../sources/records/source-record";
import { preservationViolations } from "../commands/office/preservation-guard";
import { readFile } from "node:fs/promises";
import { pptxLens } from "../lenses/pptx-lens";
import { pptxArtifactContent, pptxProjectionUpdateFromContent } from "../lenses/office-content";
import { Workbook } from "@ariadng/office/xlsx";
import { xlsxLens } from "../lenses/xlsx-lens";
import { fidelityRegionMap } from "../commands/office/fidelity-regions";

// Independent launch review contracts. All packages are disposable in-memory
// fixtures. This suite never opens Office or touches a linked native file.
async function blank() {
  const document = Document.create();
  document.addParagraph("A claim.");
  document.addParagraph("Independent neighbor.");
  return docxLens.open(await document.save());
}

async function edit(base: Awaited<ReturnType<typeof blank>>, operations: unknown) {
  const content = applyDocumentAcademicOperations(base.projection, operations);
  const desired = docxProjectionFromContent(content, base.projection).projection;
  const bytes = await docxLens.materialize({ carry: base.preservedCarry, projection: desired });
  return docxLens.open(bytes);
}

function repack(parts: Record<string, Uint8Array>) {
  return zipSync(parts, { mtime: new Date("1980-01-01T00:00:00Z") });
}

describe("S11 independent Office preservation contracts", () => {
  it("does not forbid worksheet creation just because a workbook has one visible sheet", async () => {
    const workbook = Workbook.create();
    const base = await xlsxLens.open(await workbook.save());
    const output = await xlsxLens.mutate(base.preservedCarry, { kind: "add-sheet", sheetId: "s11-new-sheet", name: "Added", index: 1 });
    const reopened = await xlsxLens.open(output);
    expect(reopened.projection.sheets.map(sheet => sheet.name)).toContain("Added");
    expect(fidelityRegionMap(base.fidelityMap.entries).sheetStructure).toBe("NATIVE");
  });

  it("deletes an explicitly removed native presentation object through the editor projection", async () => {
    const base = await pptxLens.open(await readFile("fixtures/office/pptx/typical-preservation.pptx"));
    const content = pptxArtifactContent(base.projection);
    const slide = content.slides.find(item => item.objects.length > 0)!;
    expect(slide).toBeDefined();
    const removed = slide.objects[0]!;
    const desired = { ...content, slides: content.slides.map(item => item.id === slide.id ? { ...item, objects: item.objects.filter(object => object.id !== removed.id) } : item) };
    const update = pptxProjectionUpdateFromContent(desired, base.projection, { objectLists: "complete" });
    expect(update.projection.slides.find(item => item.id === slide.id)!.objects.some(item => item.id === removed.id)).toBe(false);
    const output = await pptxLens.materialize({ carry: base.preservedCarry, projection: update.projection });
    const reopened = await pptxLens.open(output);
    expect(reopened.projection.slides.find(item => item.id === slide.id)!.objects.some(item => item.id === removed.id)).toBe(false);
  });

  it("checks every protected construct sharing a native XML part", () => {
    const parts = [{ name: "ppt/slides/slide1.xml", verdict: "different", diffs: [{ path: "/p:sld/p:timing/p:tnLst" }] }];
    const entries = [
      { feature: "transition", class: "PRESERVED", partName: "/ppt/slides/slide1.xml", pathPattern: "transition", readOnly: true },
      { feature: "animation", class: "PRESERVED", partName: "/ppt/slides/slide1.xml", pathPattern: "timing", readOnly: true },
    ];
    // Reordering declarations cannot determine whether losing animation is safe.
    expect(preservationViolations({ entries: [...entries].reverse(), parts })).toHaveLength(1);
    expect(preservationViolations({ entries, parts })).toHaveLength(1);
  });

  it("requires ownership evidence before allowing a preserved binary part to disappear", () => {
    expect(preservationViolations({
      entries: [{ feature: "macro", class: "PRESERVED", partName: "/word/vbaProject.bin", readOnly: true }],
      parts: [{ name: "word/vbaProject.bin", verdict: "different", note: "only in expected package" }],
    })).toHaveLength(1);
  });

  it("finds citation evidence after a valid relationship-preserving custom XML relocation", async () => {
    const base = await blank();
    const block = base.projection.blocks[0]!;
    const source = { ...createVerifiedSource({ title: "Source title", sourceType: "paper", authority: "primary", accessedAt: "2026-09-25T00:00:00Z", provider: "fixture", content: "Supporting passage", url: "https://example.com/source" }), id: "source:s11-fixed-source" };
    const span = { ...createEvidenceSpanAt(source, "Supporting passage", 0, 10, 1), id: "evidence:s11-fixed-passage" };
    const withBundle = { ...base, projection: { ...base.projection, sourceBundle: { sources: [source], evidence: [span] } } };
    const inserted = await edit(withBundle, [{ kind: "insert-word-citation", citationId: "s11-citation", source: { tag: "S11Source", sourceType: "JournalArticle", title: "Source title" }, sourceHandle: { sourceId: source.id, evidenceIds: [span.id] }, anchor: { regionId: block.id, expectedText: block.text, start: 0, end: 0 } }]);
    const citation = inserted.projection.blocks[0]!.inlineContent!.find(item => item.kind === "citation")!;
    expect(citation.kind === "citation" && citation.sourceRef?.sourceId).toBe(source.id);
    const parts = unzipSync(inserted.preservedCarry.payload);
    const original = "customXml/spectraAcademic.xml";
    const relocated = "customXml/item99.xml";
    parts[relocated] = parts[original]!;
    delete parts[original];
    for (const path of ["word/_rels/document.xml.rels", "[Content_Types].xml"]) {
      parts[path] = strToU8(strFromU8(parts[path]!).replaceAll(original, relocated));
    }
    expect(strFromU8(parts["word/_rels/document.xml.rels"]!)).toContain(relocated);
    const reopened = await docxLens.open(repack(parts));
    const actual = reopened.projection.blocks[0]!.inlineContent!.find(item => item.kind === "citation")!;
    expect(actual.kind === "citation" && actual.source.tag).toBe("S11Source");
    expect(actual.kind === "citation" && actual.sourceRef).toEqual(citation.kind === "citation" && citation.sourceRef);
  });

  it("exports explicitly centered newly inserted paragraphs with their requested formatting", async () => {
    const base = await blank();
    const requested = { ...base.projection, blocks: [...base.projection.blocks, { id: "s11-new-paragraph", type: "paragraph" as const, text: "Centered addition", attrs: { paragraphFormat: { alignment: "center" as const } } }] };
    const bytes = await docxLens.materialize({ carry: base.preservedCarry, projection: requested });
    const reopened = await docxLens.open(bytes);
    expect(reopened.projection.blocks.at(-1)?.text).toBe("Centered addition");
    expect(reopened.projection.blocks.at(-1)?.attrs?.paragraphFormat).toMatchObject({ alignment: "center" });
    expect(await docxProjectionReadbackDigest(reopened.projection, requested)).toBe(await docxProjectionSemanticDigest(requested));
  });

  it("preserves native underline color when a supported note body is edited", async () => {
    const base = await blank();
    const block = base.projection.blocks[0]!;
    const inserted = await edit(base, [{ kind: "insert-note", noteType: "footnote", noteId: "1", content: [[{ text: "Original note", underline: true }]], anchor: { regionId: block.id, expectedText: block.text, start: 0, end: 0 } }]);
    const parts = unzipSync(inserted.preservedCarry.payload);
    const noteXml = strFromU8(parts["word/footnotes.xml"]!);
    expect(noteXml).toContain('<w:u w:val="single"');
    parts["word/footnotes.xml"] = strToU8(noteXml.replace('<w:u w:val="single"', '<w:u w:val="single" w:color="FF0000"'));
    const native = await docxLens.open(repack(parts));
    const note = native.projection.blocks[0]!.inlineContent!.find(item => item.kind === "noteRef")!;
    expect(note.kind === "noteRef" && note.readOnlyReason).toBeUndefined();
    const changed = await edit(native, [{ kind: "edit-note", noteType: "footnote", noteId: "1", expectedText: "Original note", content: [[{ text: "Edited note", underline: true }]] }]);
    const outputXml = strFromU8(unzipSync(changed.preservedCarry.payload)["word/footnotes.xml"]!);
    expect(outputXml).toContain("Edited note");
    expect(outputXml).toContain('w:color="FF0000"');
  });

  it("rejects a stale note body and leaves the fixture bytes unchanged", async () => {
    const base = await blank();
    const block = base.projection.blocks[0]!;
    const inserted = await edit(base, [{ kind: "insert-note", noteType: "footnote", noteId: "1", content: [[{ text: "Current body" }]], anchor: { regionId: block.id, expectedText: block.text, start: 0, end: 0 } }]);
    const snapshot = inserted.preservedCarry.payload.slice();
    expect(() => applyDocumentAcademicOperations(inserted.projection, [{ kind: "edit-note", noteType: "footnote", noteId: "1", expectedText: "Old body", content: [[{ text: "Replacement" }]] }])).toThrow(/note changed/i);
    expect(inserted.preservedCarry.payload).toEqual(snapshot);
  });
});
