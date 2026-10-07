/* eslint-disable spectra/no-raw-hex-in-styles -- Native workbook fixture colours, not UI styles. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Workbook } from "@ariadng/office/xlsx";
import { parseXml } from "@ariadng/office/xml";
import { parseOfficePreview, previewTransferables } from "../office-preview";
import { xlsxLens } from "../../lenses/xlsx-lens";
import { xlsxArtifactContent, xlsxOperationsBetween, xlsxProjectionFromContent } from "../../lenses/office-content";
import { applyExcelTint, excelColor, normalizeExcelColorValue } from "../../lenses/xlsx-colors";

const fixture = (...path: string[]) => readFile(join(process.cwd(), "fixtures", "office", ...path)).then((buffer) => new Uint8Array(buffer));
const SML = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/** A workbook with Excel's own conditional formats, written as Excel writes them. */
async function formattedWorkbook() {
  const workbook = Workbook.create();
  const sheet = workbook.sheet("Sheet1")!;
  [10, 20, 30, 40, 50].forEach((value, index) => {
    sheet.setCell(`A${index + 1}`, value);
    sheet.setCell(`B${index + 1}`, value);
    sheet.setCell(`C${index + 1}`, value);
    sheet.setCell(`E${index + 1}`, value);
  });
  const native = await Workbook.open(await workbook.save());
  const styles = await native.office.xml("/xl/styles.xml");
  const dxfs = parseXml(
    `<dxfs xmlns="${SML}" count="1"><dxf><font><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf></dxfs>`,
  ).root;
  // dxfs sits after cellStyles, before tableStyles and the rest.
  const later = styles.root.elements().find((node) => ["tableStyles", "colors", "extLst"].includes(node.localName)) ?? null;
  styles.root.insertBefore(dxfs, later);
  native.office.markDirty("/xl/styles.xml");
  const document = await native.office.xml(native.sheet("Sheet1")!.partName);
  const formats = parseXml(
    `<root xmlns="${SML}">` +
      `<conditionalFormatting sqref="A1:A5 E1:E5"><cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan"><formula>35</formula></cfRule></conditionalFormatting>` +
      `<conditionalFormatting sqref="B1:B5"><cfRule type="colorScale" priority="2"><colorScale><cfvo type="min"/><cfvo type="percentile" val="50"/><cfvo type="max"/><color rgb="FFF8696B"/><color theme="0" tint="-0.5"/><color rgb="FF63BE7B"/></colorScale></cfRule></conditionalFormatting>` +
      `<conditionalFormatting sqref="C1:C5"><cfRule type="dataBar" priority="3"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/></dataBar></cfRule></conditionalFormatting>` +
      `</root>`,
  ).root;
  const anchor = document.root.elements().find((node) => node.localName === "pageMargins") ?? null;
  for (const node of [...formats.elements()]) document.root.insertBefore(node, anchor);
  native.office.markDirty(native.sheet("Sheet1")!.partName);
  return native.save();
}

describe("Excel colours", () => {
  it("reads rgb, theme with tint and the indexed palette as #RRGGBB", () => {
    const palette = { theme: ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4"] };
    const element = (attributes: string) => parseXml(`<color xmlns="${SML}" ${attributes}/>`).root;
    expect(excelColor(element('rgb="FF112233"'), palette)).toBe("#112233");
    expect(excelColor(element('theme="4"'), palette)).toBe("#4472C4");
    expect(excelColor(element('theme="0" tint="-0.5"'), palette)).toBe("#808080");
    expect(excelColor(element('indexed="10"'), palette)).toBe("#FF0000");
    expect(excelColor(element('auto="1"'), palette)).toBeUndefined();
    expect(applyExcelTint("000000", 0.5)).toBe("808080");
    expect(normalizeExcelColorValue("#abc123")).toBe("#ABC123");
  });
});

describe("Excel depth in the importer and the viewer", () => {
  it("resolves conditional formats to Excel's colours and shows them evaluated", async () => {
    const bytes = await formattedWorkbook();
    const opened = await xlsxLens.open(bytes, "strict-native");
    const rules = (opened.projection.sheets[0]!.conditionalFormats ?? []).flatMap((group) => group.rules as Array<Record<string, unknown>>);
    expect(rules[0]).toMatchObject({ type: "cellIs", fillColor: "#FFC7CE", textColor: "#9C0006" });
    expect((rules[1]!.colorScale as { colors: string[] }).colors).toEqual(["#F8696B", "#808080", "#63BE7B"]);
    expect(rules[2]).toMatchObject({ type: "dataBar", dataBar: { color: "#638EC6" } });

    // The editor sees one rule per range, the three-colour scale and the bar.
    const content = xlsxArtifactContent(opened.projection);
    const editorRules = content.sheets[0]!.conditionalFormats ?? [];
    expect(editorRules.map((rule) => [rule.kind, rule.range])).toEqual([
      ["cell_is", "A1:A5"],
      ["cell_is", "E1:E5"],
      ["color_scale", "B1:B5"],
      ["data_bar", "C1:C5"],
    ]);
    expect(editorRules[2]).toMatchObject({ minimumColor: "#F8696B", midpointColor: "#808080", maximumColor: "#63BE7B" });
    // Opening and saving untouched writes nothing back.
    expect(xlsxOperationsBetween(opened.projection, xlsxProjectionFromContent(content, opened.projection))).toEqual([]);

    const preview = await parseOfficePreview("sheet", bytes);
    if (preview.kind !== "sheet") throw new Error("expected a workbook");
    const conditional = preview.sheets[0]!.conditional;
    expect(conditional.A4).toEqual({ backgroundColor: "#FFC7CE", color: "#9C0006" });
    expect(conditional.E5).toEqual({ backgroundColor: "#FFC7CE", color: "#9C0006" });
    expect(conditional.A3).toBeUndefined();
    expect(conditional.B1).toEqual({ backgroundColor: "#F8696B" });
    expect(conditional.B3).toEqual({ backgroundColor: "#808080" });
    expect(conditional.B5).toEqual({ backgroundColor: "#63BE7B" });
    expect(conditional.B2!.backgroundColor).toBe("color-mix(in srgb, #808080 50%, #F8696B)");
    expect(conditional.C5).toEqual({ bar: { color: "#638EC6", ratio: 1 } });
    expect(conditional.C1!.bar!.ratio).toBeCloseTo(0.28);
  });

  it("keeps a three-colour scale's thresholds when the editor changes a rule", async () => {
    const opened = await xlsxLens.open(await formattedWorkbook(), "strict-native");
    const content = xlsxArtifactContent(opened.projection);
    const rules = content.sheets[0]!.conditionalFormats!;
    content.sheets[0]!.conditionalFormats = rules.map((rule) => (rule.kind === "color_scale" ? { ...rule, maximumColor: "#0000FF" } : rule));
    const saved = await xlsxLens.materialize({ projection: xlsxProjectionFromContent(content, opened.projection), carry: opened.preservedCarry });
    const reopened = await xlsxLens.open(saved, "strict-native");
    const all = (reopened.projection.sheets[0]!.conditionalFormats ?? []).flatMap((group) => group.rules as Array<Record<string, unknown>>);
    const scale = all.find((rule) => rule.type === "colorScale")!.colorScale as { cfvo: Array<{ type: string }>; colors: string[] };
    expect(scale.cfvo.map((entry) => entry.type)).toEqual(["min", "percentile", "max"]);
    expect(scale.colors.at(-1)).toBe("#0000FF");
    // The data bar is Excel's own and stays exactly once.
    expect(all.filter((rule) => rule.type === "dataBar")).toHaveLength(1);
  });

  it("draws widths in pixels and writes Excel's own units back unchanged", async () => {
    const workbook = Workbook.create();
    workbook.sheet("Sheet1")!.setCell("A1", "Wide");
    const native = await Workbook.open(await workbook.save());
    const document = await native.office.xml(native.sheet("Sheet1")!.partName);
    const cols = parseXml(`<cols xmlns="${SML}"><col min="1" max="1" width="21.140625" customWidth="1"/></cols>`).root;
    document.root.insertBefore(cols, document.root.elements().find((node) => node.localName === "sheetData") ?? null);
    native.office.markDirty(native.sheet("Sheet1")!.partName);
    const opened = await xlsxLens.open(await native.save(), "strict-native");
    expect(opened.projection.sheets[0]!.columnWidths).toEqual({ "0": 21.140625 });
    const content = xlsxArtifactContent(opened.projection);
    expect(content.sheets[0]!.columnWidths).toEqual({ "0": 148 });
    expect(xlsxOperationsBetween(opened.projection, xlsxProjectionFromContent(content, opened.projection))).toEqual([]);
    content.sheets[0]!.columnWidths = { "0": 200 };
    const resized = xlsxProjectionFromContent(content, opened.projection);
    expect(resized.sheets[0]!.columnWidths).toEqual({ "0": 28.5703125 });
  });

  it("reads charts, pictures and notes onto their cells", async () => {
    const bytes = await fixture("xlsx", "complex-preservation.xlsx");
    const opened = await xlsxLens.open(bytes, "strict-native");
    const [first, second] = opened.projection.sheets;
    expect(first!.charts![0]!.anchor).toMatchObject({ from: { column: 6, row: 5, x: 60 }, to: { column: 14, row: 20 } });
    expect(first!.comments).toEqual([{ ref: "V10", author: "Author", text: "This is a comment" }]);
    expect(second!.pictures![0]).toMatchObject({ mediaPart: "/xl/media/image1.png", mediaType: "image/png", description: "Screen Clipping" });

    const preview = await parseOfficePreview("sheet", bytes);
    if (preview.kind !== "sheet") throw new Error("expected a workbook");
    const sheet = preview.sheets.find((candidate) => candidate.name === "Sheet1")!;
    expect(sheet.notes.V10).toEqual({ author: "Author", text: "This is a comment" });
    const chart = sheet.charts[0]!;
    expect(chart.type).toBe("column");
    expect(chart.plot.keys).toHaveLength(1);
    expect(chart.plot.data.length).toBe(5);
    // The grid reaches far enough to hold the chart.
    expect(sheet.rowCount).toBeGreaterThanOrEqual(21);
    expect(sheet.columnCount).toBeGreaterThanOrEqual(15);
    const pictured = preview.sheets.find((candidate) => candidate.name === "Sheet2")!;
    expect(pictured.pictures[0]).toMatchObject({ label: "Screen Clipping", mediaId: preview.media[0]!.id });
    expect(preview.media[0]!.mediaType).toBe("image/png");
    expect(previewTransferables(preview)).toHaveLength(preview.media.length);
    // Plain data only: it crosses from the worker by structured clone.
    expect(structuredClone(preview)).toEqual(preview);
  });
});
