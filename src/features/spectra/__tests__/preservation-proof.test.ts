import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { strToU8, unzipSync, zipSync } from "fflate";
import { comparePackages } from "@ariadng/office/preservation";
import { Document } from "@ariadng/office/docx";
import { Workbook } from "@ariadng/office/xlsx";
import { parseXml } from "@ariadng/office/xml";
import { assertNativePreservationKept, nativePreservationProof, type PreservationIntent } from "../lenses/preservation-proof";
import { PreservationViolationError, type PreservationEntry } from "../commands/office/preservation-guard";
import { docxLens } from "../lenses/docx-lens";
import { pptxLens } from "../lenses/pptx-lens";
import { xlsxLens } from "../lenses/xlsx-lens";
import { applyDocumentAcademicOperations } from "../commands/office/document-academic-operations";
import { docxProjectionFromContent } from "../lenses/document-projection";
import type { DocxOperation, PptxProjection, XlsxOperation } from "../lenses/projection-contracts";

const PML = "http://schemas.openxmlformats.org/presentationml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const slidePart = "ppt/slides/slide1.xml";
const claim = (pathPattern: string): PreservationEntry => ({ feature: pathPattern, class: "PRESERVED", partName: slidePart, pathPattern, namespaceUri: PML });
const pack = (parts: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, typeof value === "string" ? strToU8(value) : value])), { mtime: new Date("1980-01-01T00:00:00Z") });
const sld = (body: string, prefix = "p") => `<${prefix}:sld xmlns:${prefix}="${PML}">${body}</${prefix}:sld>`;
const rels = (...edges: [id: string, type: string, target: string][]) => `<Relationships xmlns="${PACKAGE_REL}">${edges.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type.includes(":") ? type : `${REL}/${type}`}" Target="${target}"/>`).join("")}</Relationships>`;

async function check(before: Uint8Array, after: Uint8Array, entries: readonly PreservationEntry[], intent?: PreservationIntent) {
  const comparison = await comparePackages(before, after);
  await assertNativePreservationKept({ before, after, entries, parts: comparison.parts, intent });
  return comparison;
}

const deletionProjection: PptxProjection = {
  slides: [{ id: `pptx:slide:/${slidePart}`, index: 0, title: "", text: [], objects: [], hasTransition: false, hasTiming: false, speakerNotes: "" }],
  nativeBinding: { version: 1, format: "pptx", profile: "strict-native", macroEnabled: false, semanticDigest: "0".repeat(64) },
};
const deleteSlide: PreservationIntent = { format: "pptx", projection: deletionProjection, operations: [{ kind: "remove-slide", slideId: deletionProjection.slides[0]!.id }] };
function ownedGraph() {
  return {
    "ppt/presentation.xml": `<p:presentation xmlns:p="${PML}" xmlns:r="${REL}"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels(["rId1", "slide", "slides/slide1.xml"]),
    [slidePart]: sld(""),
    "ppt/slides/_rels/slide1.xml.rels": rels(["n", "notesSlide", "../notesSlides/notesSlide1.xml"], ["c", "chart", "../charts/chart1.xml"]),
    "ppt/notesSlides/notesSlide1.xml": sld("<p:cSld/>"),
    "ppt/notesSlides/_rels/notesSlide1.xml.rels": rels(["s", "slide", "../slides/slide1.xml"]),
    "ppt/charts/chart1.xml": "<chart/>",
    "ppt/charts/_rels/chart1.xml.rels": rels(["e", "package", "../embeddings/sheet.xlsx"]),
    "ppt/embeddings/sheet.xlsx": new Uint8Array([1, 2, 3]),
  };
}
const deletedGraph = () => ({ "ppt/presentation.xml": `<p:presentation xmlns:p="${PML}"><p:sldIdLst/></p:presentation>` });

describe("complete native package preservation proof", () => {
  it("checks both transition and animation independent of claim order and omitted diagnostics", async () => {
    const before = pack({ [slidePart]: sld("<p:cSld/><p:transition/><p:timing/>") });
    const after = pack({ [slidePart]: sld("<p:cSld/><p:transition/>") });
    const comparison = await comparePackages(before, after);
    // The actual SDK reports only the parent's child count for a removed tail.
    expect(comparison.parts[0]!.diffs?.some((diff) => diff.path.includes("timing"))).toBe(false);
    for (const entries of [[claim("transition"), claim("timing")], [claim("timing"), claim("transition")]]) {
      await expect(check(before, after, entries)).rejects.toBeInstanceOf(PreservationViolationError);
      await expect(assertNativePreservationKept({ before, after, entries, parts: comparison.parts.map((part) => ({ ...part, diffs: [] })) })).rejects.toThrow("NATIVE_PRESERVATION_VIOLATION");
    }
  });

  it("allows native text changes and equivalent namespace prefixes without freezing the slide", async () => {
    const before = pack({ [slidePart]: sld("<p:cSld>old</p:cSld><p:transition><p:fade/></p:transition><p:timing/>") });
    const after = pack({ [slidePart]: sld("<q:cSld>edited</q:cSld><q:transition><q:fade/></q:transition><q:timing/>", "q") });
    await expect(check(before, after, [claim("transition"), claim("timing")])).resolves.toBeDefined();
  });

  it("detects namespace rebinding, repeat-instance loss and inherited xml:space changes", async () => {
    const before = pack({ [slidePart]: sld("<p:timing> </p:timing><p:timing id=\"2\"/>") });
    for (const body of [
      sld("<p:timing> </p:timing>"),
      sld('<p:cSld><p:timing> </p:timing></p:cSld><p:timing id="2"/>'),
      sld('<p:timing xmlns:p="urn:unrelated"> </p:timing><p:timing id="2"/>'),
      sld('<p:timing> </p:timing><p:timing id="2"/>').replace("<p:sld ", '<p:sld xml:space="preserve" '),
    ]) await expect(check(before, pack({ [slidePart]: body }), [claim("timing")])).rejects.toThrow("NATIVE_PRESERVATION_VIOLATION");
  });

  it("permits a proven removed slide and its exclusive notes/chart/embedded dependency graph", async () => {
    const before = pack(ownedGraph()), after = pack(deletedGraph());
    await expect(check(before, after, [], deleteSlide)).resolves.toBeDefined();
    await expect(check(before, after, [])).rejects.toThrow("NATIVE_PRESERVATION_VIOLATION");
    await expect(check(before, after, [], { ...deleteSlide, operations: [] })).rejects.toThrow("NATIVE_PRESERVATION_VIOLATION");
  });

  it("rejects a shared dependency even when the writer also erases the surviving owner's relationship", async () => {
    const before = pack({ ...ownedGraph(), "ppt/slides/slide2.xml": sld(""), "ppt/slides/_rels/slide2.xml.rels": rels(["c", "chart", "../charts/chart1.xml"]) });
    const after = pack({ ...deletedGraph(), "ppt/slides/slide2.xml": sld("") });
    const parts = (await comparePackages(before, after)).parts;
    const proof = await nativePreservationProof({ before, after, entries: [], parts, intent: deleteSlide });
    expect(proof.removedParts).not.toContain("/ppt/charts/chart1.xml");
    expect(proof.removedParts).not.toContain("/ppt/embeddings/sheet.xlsx");
    await expect(check(before, after, [], deleteSlide)).rejects.toThrow("NATIVE_PRESERVATION_VIOLATION");
  });

  it("rejects unowned macros, unknown relations and dangling root references", async () => {
    const graph = ownedGraph();
    const cases = [
      { before: { ...graph, "ppt/vbaProject.bin": new Uint8Array([9]) }, after: deletedGraph() },
      { before: { ...graph, "ppt/slides/_rels/slide1.xml.rels": rels(["n", "notesSlide", "../notesSlides/notesSlide1.xml"], ["c", "urn:foreign/chart", "../charts/chart1.xml"]) }, after: deletedGraph() },
      { before: graph, after: { "ppt/presentation.xml": graph["ppt/presentation.xml"] } },
    ];
    for (const item of cases) await expect(check(pack(item.before), pack(item.after), [], deleteSlide)).rejects.toThrow("NATIVE_PRESERVATION_VIOLATION");
  });

  it("keeps PPTX transition packages editable and validates actual slide cleanup", async () => {
    const source = new Uint8Array(await readFile("fixtures/office/pptx/transition-law.pptx"));
    const opened = await pptxLens.open(source);
    const slide = opened.projection.slides[0]!;
    const operations = [{ kind: "set-title" as const, slideId: slide.id, text: "Preserved timing, edited title" }];
    await expect(check(source, await pptxLens.materialize({ carry: opened.preservedCarry, projection: opened.projection }), opened.fidelityMap.entries)).resolves.toBeDefined();
    const edited = await pptxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations });
    await expect(check(source, edited, opened.fidelityMap.entries, { format: "pptx", projection: opened.projection, operations })).resolves.toBeDefined();
    expect((await pptxLens.open(edited)).projection.slides[0]!.title).toBe(operations[0]!.text);
    const duplicate = await pptxLens.mutate(opened.preservedCarry, { kind: "duplicate-slide", slideId: slide.id, newSlideId: "temporary" });
    const two = await pptxLens.open(duplicate);
    const deletion = { kind: "remove-slide" as const, slideId: two.projection.slides.find((candidate) => !opened.projection.slides.some((original) => original.id === candidate.id))!.id };
    const removed = await pptxLens.mutate(two.preservedCarry, deletion);
    await expect(check(duplicate, removed, two.fidelityMap.entries, { format: "pptx", projection: two.projection, operations: [deletion] })).resolves.toBeDefined();
    expect((await pptxLens.open(removed)).projection.slides).toHaveLength(opened.projection.slides.length);
  });

  it("retains all preserved DOCX parts through no-op, text edit and supported bound Custom XML edit", async () => {
    for (const file of ["embedded-ole.docx", "content-controls-customxml.docx"]) {
      const source = new Uint8Array(await readFile(`fixtures/office/docx/${file}`));
      const opened = await docxLens.open(source);
      const noop = await docxLens.materialize({ carry: opened.preservedCarry, projection: opened.projection });
      await expect(check(source, noop, opened.fidelityMap.entries)).resolves.toBeDefined();
      const table = opened.projection.blocks.find((block) => block.type === "table");
      const paragraph = opened.projection.blocks.find((block) => block.type !== "table" && !block.attrs?.nativeReadOnly)!;
      const operation: DocxOperation = file === "content-controls-customxml.docx"
        ? { kind: "edit-table-cell", regionId: table!.id, row: 0, column: 1, text: "Preservation proof" }
        : { kind: "replace-paragraph", regionId: paragraph.id, text: "Preservation proof" };
      const after = await docxLens.mutate(opened.preservedCarry, operation);
      await expect(check(source, after, opened.fidelityMap.entries, { format: "docx", projection: opened.projection, operations: [operation] })).resolves.toBeDefined();
    }
  });

  it("allows explicit last-image deletion but rejects image disappearance without that intent", async () => {
    const document = Document.create();
    document.addParagraph("Keep this paragraph.");
    document.addImage(new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42E8/x8AAusB9Wl6Xr0AAAAASUVORK5OII=", "base64")), { widthPx: 80, altText: "Owned image" });
    const source = await document.save(), opened = await docxLens.open(source);
    const block = opened.projection.blocks.find((item) => item.inlineContent?.some((inline) => inline.kind === "image"))!;
    const image = block.inlineContent!.find((inline) => inline.kind === "image")!;
    if (image.kind !== "image" || !image.partName) throw new Error("Missing native image");
    const operation: DocxOperation = { kind: "delete-image", regionId: block.id, partName: image.partName, occurrenceId: image.occurrenceId };
    const after = await docxLens.mutate(opened.preservedCarry, operation);
    expect(unzipSync(after)[image.partName.slice(1)]).toBeUndefined();
    await expect(check(source, after, opened.fidelityMap.entries, { format: "docx", projection: opened.projection, operations: [operation] })).resolves.toBeDefined();
    await expect(check(source, after, opened.fidelityMap.entries)).rejects.toThrow("NATIVE_PRESERVATION_VIOLATION");
    const deletedBlock = docxProjectionFromContent({ ...opened.projection, nativeProjectionComplete: true,
      blocks: opened.projection.blocks.filter((item) => item.id !== block.id),
    }, opened.projection);
    const withoutBlock = await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations: deletedBlock.operations });
    await expect(check(source, withoutBlock, opened.fidelityMap.entries, { format: "docx", projection: opened.projection, operations: deletedBlock.operations })).resolves.toBeDefined();
    expect(unzipSync(withoutBlock)[image.partName.slice(1)]).toEqual(unzipSync(source)[image.partName.slice(1)]);

    // The old image releaser recognizes DrawingML blips, but this same native
    // binary is also used by an unmodeled VML picture. Its original ownership
    // must survive even if the writer erases the relationship by mistake.
    const legacy = await Document.open(source);
    const imageRelationship = legacy.office.mainPart.relationships().byType(`${REL}/image`)[0]!;
    const legacyPicture = parseXml(`<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="${REL}"><w:r><w:pict><v:rect><v:imagedata r:id="${imageRelationship.id}"/></v:rect></w:pict></w:r></w:p>`).root;
    legacy.body().insertBefore(legacyPicture, legacy.body().find("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "sectPr") ?? null);
    legacy._markMainDirty();
    const sharedSource = await legacy.save(), shared = await docxLens.open(sharedSource);
    const sharedBlock = shared.projection.blocks.find((item) => item.inlineContent?.some((inline) => inline.kind === "image"))!;
    const sharedOperation: DocxOperation = { ...operation, regionId: sharedBlock.id };
    const faultyOutput = await docxLens.mutate(shared.preservedCarry, sharedOperation);
    await expect(check(sharedSource, faultyOutput, shared.fidelityMap.entries, { format: "docx", projection: shared.projection, operations: [sharedOperation] })).rejects.toThrow("NATIVE_PRESERVATION_VIOLATION");
  });

  it("allows shared-command deletion of the last note and comment while retaining story parts", async () => {
    const document = Document.create();
    document.addParagraph("Anchored text");
    const base = await docxLens.open(await document.save()), block = base.projection.blocks[0]!;
    const seeded = await docxLens.mutate(base.preservedCarry, { kind: "ai-edit", operations: [
      { kind: "insert-note", noteType: "footnote", noteId: "1", content: [[{ text: "Last note" }]], anchor: { regionId: block.id, expectedText: block.text, start: 0, end: 0 } },
      { kind: "add-word-comment", commentId: "1", comment: { text: "Last comment", author: "Fixture" }, anchor: { regionId: block.id, expectedText: block.text, start: 0, end: 4 } },
    ] });
    const opened = await docxLens.open(seeded);
    const content = applyDocumentAcademicOperations(opened.projection, [
      { kind: "delete-note", noteType: "footnote", noteId: "1", expectedText: "Last note" },
      { kind: "delete-word-comment", commentId: "1", expectedText: "Last comment" },
    ]);
    const update = docxProjectionFromContent(content, opened.projection);
    const after = await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations: update.operations });
    await expect(check(seeded, after, opened.fidelityMap.entries, { format: "docx", projection: opened.projection, operations: update.operations })).resolves.toBeDefined();
    const reopened = await docxLens.open(after);
    expect(reopened.projection.nativeBinding.wordNotes ?? []).toEqual([]);
    expect(reopened.projection.nativeBinding.wordComments ?? []).toEqual([]);
    expect(unzipSync(after)["word/footnotes.xml"]).toBeDefined();
    expect(unzipSync(after)["word/comments.xml"]).toBeDefined();
  });

  it("allows native PPTX object deletion and retains the linked binary media", async () => {
    const source = new Uint8Array(await readFile("fixtures/office/pptx/media-preservation.pptx"));
    const opened = await pptxLens.open(source);
    const slide = opened.projection.slides.find((candidate) => candidate.objects.some((object) => object.type === "image"))!;
    const object = slide.objects.find((candidate) => candidate.type === "image")!;
    const operation = { kind: "remove-object" as const, slideId: slide.id, shapeId: object.id.split(":").at(-1)! };
    const after = await pptxLens.mutate(opened.preservedCarry, operation);
    await expect(check(source, after, opened.fidelityMap.entries, { format: "pptx", projection: opened.projection, operations: [operation] })).resolves.toBeDefined();
    expect((await pptxLens.open(after)).projection.slides.find((candidate) => candidate.id === slide.id)!.objects.some((candidate) => candidate.id === object.id)).toBe(false);
    const original = unzipSync(source), output = unzipSync(after);
    for (const part of Object.keys(original).filter((part) => part.startsWith("ppt/media/"))) expect(output[part]).toEqual(original[part]);
  });

  it("allows XLSX cell edits and an explicitly deleted native sheet", async () => {
    const workbook = Workbook.create();
    workbook.sheet("Sheet1")!.setCell("A1", "Original");
    workbook.addSheet("Owned sheet").setCell("B2", "Delete this sheet");
    const source = await workbook.save(), opened = await xlsxLens.open(source);
    const operation: XlsxOperation = { kind: "remove-sheet", sheetId: opened.projection.sheets[1]!.id };
    const after = await xlsxLens.mutate(opened.preservedCarry, operation);
    await expect(check(source, after, opened.fidelityMap.entries, { format: "xlsx", projection: opened.projection, operations: [operation] })).resolves.toBeDefined();
    expect((await xlsxLens.open(after)).projection.sheets).toHaveLength(1);
    await expect(check(source, after, opened.fidelityMap.entries)).rejects.toThrow("NATIVE_PRESERVATION_VIOLATION");
  });

  it("allows explicit XLSX chart/table removal while retaining neighboring native parts", async () => {
    const source = new Uint8Array(await readFile("fixtures/office/xlsx/complex-preservation.xlsx"));
    const opened = await xlsxLens.open(source), sheet = opened.projection.sheets[0]!;
    expect(sheet.charts?.length).toBeGreaterThan(0);
    expect(sheet.tables?.length).toBeGreaterThan(0);
    const operations: XlsxOperation[] = [
      { kind: "remove-chart", sheetId: sheet.id, chartId: sheet.charts![0]!.id },
      { kind: "remove-table", sheetId: sheet.id, tableId: sheet.tables![0]!.id },
    ];
    for (const operation of operations) {
      const after = await xlsxLens.mutate(opened.preservedCarry, operation);
      await expect(check(source, after, opened.fidelityMap.entries, { format: "xlsx", projection: opened.projection, operations: [operation] })).resolves.toBeDefined();
      expect(unzipSync(after)["xl/media/image1.png"]).toEqual(unzipSync(source)["xl/media/image1.png"]);
    }
  });

  it("checks every matching native part instead of only the first family member", async () => {
    const document = Document.create();
    document.addParagraph("Editable body");
    const source = pack({ ...unzipSync(await document.save()), "customXml/item1.xml": "<first/>", "customXml/item2.xml": "<second/>" });
    const opened = await docxLens.open(source);
    expect(opened.fidelityMap.entries.filter((entry) => entry.feature === "customXml").map((entry) => entry.partName)).toEqual(expect.arrayContaining(["/customXml/item1.xml", "/customXml/item2.xml"]));
    const after = pack({ ...unzipSync(source), "customXml/item2.xml": "<changed/>" });
    await expect(check(source, after, opened.fidelityMap.entries)).rejects.toThrow("/customXml/item2.xml");
  });

  it("keeps VBA bytes untouched during ordinary native XLSM edits without executing them", async () => {
    const source = new Uint8Array(await readFile("fixtures/office/xlsx/representative.xlsm"));
    const opened = await xlsxLens.open(source);
    const operation: XlsxOperation = { kind: "set-cell", sheetId: opened.projection.sheets[0]!.id, ref: "Z90", value: "Scoped native edit" };
    await expect(check(source, await xlsxLens.materialize({ carry: opened.preservedCarry, projection: opened.projection }), opened.fidelityMap.entries)).resolves.toBeDefined();
    const after = await xlsxLens.mutate(opened.preservedCarry, operation);
    await expect(check(source, after, opened.fidelityMap.entries, { format: "xlsx", projection: opened.projection, operations: [operation] })).resolves.toBeDefined();
    const originalParts = unzipSync(source), nextParts = unzipSync(after);
    expect(originalParts["xl/vbaProject.bin"]).toBeDefined();
    expect(nextParts["xl/vbaProject.bin"]).toEqual(originalParts["xl/vbaProject.bin"]);
  });

  it("proves standard calculation-chain invalidation for input edits and clearing the last formula", async () => {
    const workbook = Workbook.create();
    workbook.sheet("Sheet1")!.setCell("A1", 3);
    workbook.sheet("Sheet1")!.setFormula("B1", "A1*2");
    workbook.office.package.addPart("/xl/calcChain.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml", strToU8(`<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="B1" i="1"/></calcChain>`));
    workbook.office.mainPart.relationships().add({ type: `${REL}/calcChain`, target: "calcChain.xml" });
    const source = await workbook.save(), opened = await xlsxLens.open(source);
    for (const operation of [
      { kind: "set-cell" as const, sheetId: opened.projection.sheets[0]!.id, ref: "A1", value: 5 },
      { kind: "clear-cell" as const, sheetId: opened.projection.sheets[0]!.id, ref: "B1" },
    ]) {
      const after = await xlsxLens.mutate(opened.preservedCarry, operation);
      expect(unzipSync(after)["xl/calcChain.xml"]).toBeUndefined();
      await expect(check(source, after, opened.fidelityMap.entries, { format: "xlsx", projection: opened.projection, operations: [operation] })).resolves.toBeDefined();
      await expect(check(source, after, opened.fidelityMap.entries)).rejects.toThrow("/xl/calcChain.xml");
      const unknown = pack({ ...unzipSync(source), "xl/calcChain.xml": '<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="B1" i="1"/><extension xmlns="urn:authored">Retain</extension></calcChain>' });
      await expect(check(unknown, after, opened.fidelityMap.entries, { format: "xlsx", projection: opened.projection, operations: [operation] })).rejects.toThrow("/xl/calcChain.xml");
    }
  });
});
