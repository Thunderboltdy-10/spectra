import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { Workbook } from "@ariadng/office/xlsx";
import { strFromU8, unzipSync } from "fflate";
import { fidelityRegionMap } from "../commands/office/fidelity-regions";
import { pptxLens, pptxProjectionSemanticDigest } from "../lenses/pptx-lens";
import { xlsxLens, xlsxSemanticDigest } from "../lenses/xlsx-lens";
import {
  pptxArtifactContent, pptxProjectionUpdateFromContent,
  xlsxArtifactContent, xlsxProjectionUpdateFromContent,
} from "../lenses/office-content";
import { presentationYjsAdapter } from "../work/models/yjs/structured-adapters";

const deck = async (name = "chart-notes-preservation") => pptxLens.open(
  await readFile(`fixtures/office/pptx/${name}.pptx`),
);

describe("S11 Office model boundaries", () => {
  it("removes an object from a hydrated snapshot and preserves retained identities, order and native assets", async () => {
    const opened = await deck();
    const document = presentationYjsAdapter.createDocument(pptxArtifactContent(opened.projection));
    try {
      const content = presentationYjsAdapter.project(document);
      const slide = content.slides.find((item) => item.objects.some((object) => object.type === "text"))!;
      const removed = slide.objects.find((object) => object.type === "text")!;
      const desired = { ...content, slides: content.slides.map((item) => item.id === slide.id
        ? { ...item, objects: item.objects.filter((object) => object.id !== removed.id) } : item) };
      const update = pptxProjectionUpdateFromContent(desired, opened.projection, { objectLists: "complete" });
      expect(update.operations).toContainEqual({ kind: "remove-object", slideId: slide.id, shapeId: (removed.content as { nativeShapeId: string }).nativeShapeId });
      const bytes = await pptxLens.materialize({ carry: opened.preservedCarry, projection: update.projection });
      const reopened = await pptxLens.open(bytes);
      expect(reopened.projection.slides.map((item) => item.objects.map((object) => object.id)))
        .toEqual(desired.slides.map((item) => item.objects.map((object) => object.id)));
      expect(await pptxProjectionSemanticDigest(update.projection)).toBe(reopened.projection.nativeBinding.semanticDigest);
      const beforeParts = unzipSync(opened.preservedCarry.payload);
      const afterParts = unzipSync(bytes);
      const carried = Object.keys(beforeParts).filter((name) => /^ppt\/(charts|media|embeddings|notesSlides)\//.test(name));
      expect(carried.some((name) => name.startsWith("ppt/charts/"))).toBe(true);
      for (const name of carried) expect(afterParts[name], name).toEqual(beforeParts[name]);
    } finally { document.destroy(); }
  });

  it("treats an explicit empty complete object list as removal, and omitted or sparse lists as carry", async () => {
    const opened = await deck("typical-preservation");
    const content = pptxArtifactContent(opened.projection);
    const slide = content.slides.find((item) => item.objects.length)!;
    const complete = { ...content, slides: content.slides.map((item) => item.id === slide.id ? { ...item, objects: [] } : item) };
    const update = pptxProjectionUpdateFromContent(complete, opened.projection, { objectLists: "complete" });
    expect(update.projection.slides.find((item) => item.id === slide.id)!.objects).toEqual([]);
    const reopened = await pptxLens.open(await pptxLens.materialize({ carry: opened.preservedCarry, projection: update.projection }));
    expect(reopened.projection.slides.find((item) => item.id === slide.id)!.objects).toEqual([]);
    expect(await pptxProjectionSemanticDigest(update.projection)).toBe(reopened.projection.nativeBinding.semanticDigest);
    // The exact same theme and binding cannot grant removal authority.
    expect(pptxProjectionUpdateFromContent(complete, opened.projection).projection.slides.find((item) => item.id === slide.id)!.objects).toEqual(slide.objects);
    for (const patch of [{ id: slide.id }, { id: slide.id, objects: [] }]) {
      const sparse = pptxProjectionUpdateFromContent({ slides: [patch] }, opened.projection);
      expect(sparse.projection.slides[0]!.objects).toEqual(slide.objects);
      expect(sparse.operations.filter((operation) => operation.kind === "remove-object")).toEqual([]);
    }
  });

  it("keeps unmentioned objects and native content locators in a sparse object patch", async () => {
    const opened = await deck();
    const slide = opened.projection.slides.find((item) => item.objects.some((object) => object.type === "text"))!;
    const object = slide.objects.find((item) => item.type === "text")!;
    const update = pptxProjectionUpdateFromContent({ slides: [{ id: slide.id, objects: [{ id: object.id, type: "text", content: { text: "Sparse edit" } }] }] }, opened.projection);
    expect(update.projection.slides[0]!.objects.map((item) => item.id)).toEqual(slide.objects.map((item) => item.id));
    expect(update.projection.slides[0]!.objects.find((item) => item.id === object.id)!.content).toMatchObject({ ...(object.content as object), text: "Sparse edit" });
    const reopened = await pptxLens.open(await pptxLens.materialize({ carry: opened.preservedCarry, projection: update.projection }));
    const actual = reopened.projection.slides[0]!.objects.find((item) => item.id === object.id)!;
    expect(actual.content).toMatchObject({ text: "Sparse edit" });
  });

  it("keeps the supplied order in a complete object list and rejects duplicate identities", async () => {
    const opened = await deck();
    const content = pptxArtifactContent(opened.projection);
    const slide = content.slides.find((item) => item.objects.length > 1)!;
    const reversed = [...slide.objects].reverse();
    const desired = { ...content, slides: content.slides.map((item) => item.id === slide.id ? { ...item, objects: reversed } : item) };
    const update = pptxProjectionUpdateFromContent(desired, opened.projection, { objectLists: "complete" });
    expect(update.projection.slides.find((item) => item.id === slide.id)!.objects.map((item) => item.id)).toEqual(reversed.map((item) => item.id));
    const reordered = await pptxLens.open(await pptxLens.materialize({ carry: opened.preservedCarry, projection: update.projection }));
    expect(reordered.projection.slides.find((item) => item.id === slide.id)!.objects.map((item) => item.id)).toEqual(reversed.map((item) => item.id));
    expect(await pptxProjectionSemanticDigest(update.projection)).toBe(reordered.projection.nativeBinding.semanticDigest);
    expect(() => pptxProjectionUpdateFromContent({ ...content, slides: [{ ...slide, objects: [slide.objects[0]!, slide.objects[0]!] }] }, opened.projection, { objectLists: "complete" })).toThrow(/duplicate object identities/);
    const incomplete = { id: slide.id, objects: [{ id: slide.objects[0]!.id, type: slide.objects[0]!.type }] };
    expect(() => pptxProjectionUpdateFromContent({ ...content, slides: [incomplete] }, opened.projection, { objectLists: "complete" })).toThrow();
    expect(pptxProjectionUpdateFromContent({ ...content, slides: [incomplete] }, opened.projection).projection.slides[0]!.objects).toEqual(slide.objects);
  });

  it("allows first native features and verifies their saved values", async () => {
    const workbook = Workbook.create();
    workbook.sheet("Sheet1")!.setCell("A1", "Category");
    workbook.sheet("Sheet1")!.setCell("B1", "Value");
    workbook.sheet("Sheet1")!.setCell("A2", "One");
    workbook.sheet("Sheet1")!.setCell("B2", 7);
    const opened = await xlsxLens.open(await workbook.save());
    const id = opened.projection.sheets[0]!.id;
    const regions = fidelityRegionMap(opened.fidelityMap.entries);
    for (const feature of ["charts", "tables", "validation", "conditionalFormat", "namedRanges", "sheetStructure", "dimensions", "sheetViews", "sheetMetadata", "calculationSettings", "sortFilter"])
      expect(regions[feature], feature).toBe("NATIVE");
    const bytes = await xlsxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations: [
      { kind: "add-sheet", sheetId: "s11-added", name: "Added", index: 1 },
      { kind: "set-sheet-properties", sheetId: id, properties: { columnWidths: { "0": 148 }, rowHeights: { "1": 36 }, showGridlines: false, showHeadings: false, tabColor: "FF112233" } },
      { kind: "set-workbook-properties", calculationMode: "manual" },
      { kind: "set-defined-names", names: [{ name: "FirstRange", ref: "Sheet1!$A$1:$B$2" }] },
      { kind: "upsert-table", sheetId: id, table: { id: "s11-table", name: "FirstTable", range: "A1:B2", columns: ["Category", "Value"], headerRow: true, totalsRow: false } },
      { kind: "upsert-chart", sheetId: id, chart: { id: "s11-chart", type: "column", sourceRange: "Sheet1!$A$1:$B$2", title: "First chart", position: { x: 200, y: 40, width: 400, height: 240 } } },
      { kind: "set-validations", sheetId: id, validations: [{ type: "whole", sqref: "B2", operator: "between", formula1: "0", formula2: "10" }] },
      { kind: "set-conditional-formats", sheetId: id, conditionalFormats: [{ sqref: "B2", rules: [{ type: "cellIs", operator: "greaterThan", formulas: ["5"] }] }] },
    ] });
    const reopened = await xlsxLens.open(bytes);
    expect(reopened.projection.sheets.map((sheet) => sheet.name)).toEqual(["Sheet1", "Added"]);
    expect(reopened.projection.calculationMode).toBe("manual");
    expect(reopened.projection.definedNames).toContainEqual({ name: "FirstRange", ref: "Sheet1!$A$1:$B$2" });
    const sheet = reopened.projection.sheets[0]!;
    expect(sheet).toMatchObject({ showGridlines: false, showHeadings: false, rowHeights: { "1": 36 } });
    expect(sheet.columnWidths!["0"]).toBeCloseTo(148, 0);
    expect(sheet.tabColor).toMatch(/112233/);
    expect(await xlsxSemanticDigest({ ...reopened.projection, sheets: [{ ...sheet, tabColor: "#FF0000" }, ...reopened.projection.sheets.slice(1)] })).not.toBe(reopened.projection.nativeBinding.semanticDigest);
    expect(sheet.tables).toEqual([expect.objectContaining({ name: "FirstTable", range: "A1:B2" })]);
    expect(sheet.charts).toEqual([expect.objectContaining({ title: "First chart", type: "column" })]);
    expect(sheet.validations).toEqual([expect.objectContaining({ type: "whole", sqref: "B2", formula1: "0", formula2: "10" })]);
    expect(sheet.conditionalFormats).toEqual([expect.objectContaining({ sqref: "B2", rules: [expect.objectContaining({ type: "cellIs", operator: "greaterThan" })] })]);
  });

  it("expands authored worksheet bounds when a distant cell is saved", async () => {
    const opened = await xlsxLens.open(await Workbook.create().save());
    const content = xlsxArtifactContent(opened.projection);
    content.sheets[0]!.cells.AA101 = { value: "Beyond original extent" };
    const update = xlsxProjectionUpdateFromContent(content, opened.projection);
    expect(update.projection.sheets[0]).toMatchObject({ rowCount: 101, columnCount: 27 });
    const reopened = await xlsxLens.open(await xlsxLens.materialize({ carry: opened.preservedCarry, projection: update.projection }));
    expect(reopened.projection.sheets[0]).toMatchObject({ rowCount: 101, columnCount: 27 });
    expect(reopened.projection.sheets[0]!.cells).toContainEqual(expect.objectContaining({ ref: "AA101", value: "Beyond original extent" }));
  });

  it("reports native transition editing unavailable and preserves its XML through another edit", async () => {
    const opened = await deck("transition-law");
    expect(opened.capabilities.human.find((capability) => capability.id === "edit-native-transition")?.available).toBe(false);
    const slide = opened.projection.slides.find((item) => item.hasTransition)!;
    const bytes = await pptxLens.mutate(opened.preservedCarry, { kind: "set-title", slideId: slide.id, text: "Title with preserved transition" });
    const part = slide.id.replace(/^pptx:slide:\//, "");
    const transitionXml = (payload: Uint8Array) => strFromU8(unzipSync(payload)[part]!).match(/<(?:\w+:)?transition\b[\s\S]*?<\/(?:\w+:)?transition>/)?.[0];
    expect(transitionXml(opened.preservedCarry.payload)).toBeDefined();
    expect(transitionXml(bytes)).toBe(transitionXml(opened.preservedCarry.payload));
    const reopened = await pptxLens.open(bytes);
    expect(reopened.projection.slides.find((item) => item.id === slide.id)!.title).toBe("Title with preserved transition");
    expect(reopened.projection.slides.find((item) => item.id === slide.id)!.hasTransition).toBe(true);
  });

  it("removes a modeled picture while retaining the original native media bytes", async () => {
    const opened = await deck("media-preservation");
    const content = pptxArtifactContent(opened.projection);
    const slide = content.slides.find((item) => item.objects.some((object) => object.type === "image"))!;
    const picture = slide.objects.find((object) => object.type === "image")!;
    const desired = { ...content, slides: content.slides.map((item) => item.id === slide.id ? { ...item, objects: item.objects.filter((object) => object.id !== picture.id) } : item) };
    const update = pptxProjectionUpdateFromContent(desired, opened.projection, { objectLists: "complete" });
    const bytes = await pptxLens.materialize({ carry: opened.preservedCarry, projection: update.projection });
    const actual = await pptxLens.open(bytes);
    expect(actual.projection.slides.find((item) => item.id === slide.id)!.objects.some((object) => object.id === picture.id)).toBe(false);
    expect(await pptxProjectionSemanticDigest(update.projection)).toBe(actual.projection.nativeBinding.semanticDigest);
    const beforeParts = unzipSync(opened.preservedCarry.payload);
    const afterParts = unzipSync(bytes);
    const media = Object.keys(beforeParts).filter((name) => name.startsWith("ppt/media/"));
    expect(media.length).toBeGreaterThan(0);
    for (const name of media) expect(afterParts[name], name).toEqual(beforeParts[name]);
  });
});
