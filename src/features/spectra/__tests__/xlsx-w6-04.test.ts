import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { Workbook } from "@ariadng/office/xlsx";
import { XmlElement, XmlText } from "@ariadng/office/xml";
import { comparePackages } from "@ariadng/office/preservation";
import { xlsxLens } from "../lenses/xlsx-lens";
import {
  xlsxArtifactContent,
  xlsxOperationsBetween,
  xlsxProjectionFromContent,
} from "../lenses/office-content";

const fixturePath = join(process.cwd(), "fixtures", "office", "xlsx", "complex-preservation.xlsx");

async function complexFixture() {
  return new Uint8Array(await readFile(fixturePath));
}

function packageText(bytes: Uint8Array, name: string) {
  const file = unzipSync(bytes)[name];
  return file ? strFromU8(file) : "";
}

describe("W6-04 native XLSX structure and chart convergence", () => {
  it("edits real chart and table parts while preserving unrelated OOXML parts", async () => {
    const source = await complexFixture();
    const opened = await xlsxLens.open(source, "enhanced");
    const sourceSheet = opened.projection.sheets[0]!;
    expect(sourceSheet.partName).toBe("/xl/worksheets/sheet1.xml");
    expect(sourceSheet.tables?.[0]).toMatchObject({
      name: "Table1",
      partName: "/xl/tables/table1.xml",
    });
    expect(sourceSheet.charts?.[0]).toMatchObject({
      type: "column",
      partName: "/xl/charts/chart1.xml",
      drawingPartName: "/xl/drawings/drawing1.xml",
    });

    const content = xlsxArtifactContent(opened.projection);
    const sheet = content.sheets[0]!;
    const chart = sheet.charts[0]!;
    const table = sheet.tables[0]!;
    sheet.charts[0] = { ...chart, title: "Updated revenue", sourceRange: "Sheet1!A1:A5" };
    sheet.tables[0] = { ...table, style: "accent" };
    const sourceCell = sheet.cells.A1;
    if (sourceCell) sheet.cells.A1 = { ...sourceCell, value: "Updated" };
    const saved = await xlsxLens.materialize({
      projection: xlsxProjectionFromContent(content, opened.projection),
      carry: opened.preservedCarry,
    });

    const comparison = await comparePackages(source, saved);
    const verdicts = new Map(comparison.parts.map((part) => [part.name, part.verdict]));
    expect(verdicts.get("xl/charts/chart1.xml")).toBe("different");
    expect(verdicts.get("xl/tables/table1.xml")).toBe("different");
    expect(verdicts.get("xl/diagrams/data1.xml")).toBe("identical");
    expect(verdicts.get("xl/comments1.xml")).toBe("identical");
    expect(verdicts.get("xl/media/image1.png")).toBe("identical");
    expect(packageText(saved, "xl/charts/chart1.xml")).toContain("Updated revenue");
    expect(packageText(saved, "xl/charts/chart1.xml")).toContain("Updated");
    expect(packageText(saved, "xl/tables/table1.xml")).toContain("TableStyleMedium4");

    const reopened = await xlsxLens.open(saved, "enhanced");
    expect(reopened.projection.sheets[0]!.charts?.[0]).toMatchObject({
      title: "Updated revenue",
      sourceRange: "'Sheet1'!$A$1:$A$5",
    });
    expect(reopened.projection.sheets[0]!.tables?.[0]?.style).toBe("TableStyleMedium4");
  });

  it("creates a native editable chart with a drawing relationship and cache", async () => {
    const workbook = Workbook.create();
    const sheet = workbook.sheet("Sheet1")!;
    sheet.setCell("A1", "Month");
    sheet.setCell("B1", "Revenue");
    sheet.setCell("A2", "Jan");
    sheet.setCell("B2", 12);
    sheet.setCell("A3", "Feb");
    sheet.setCell("B3", 18);
    const source = await workbook.save();
    const opened = await xlsxLens.open(source, "enhanced");
    const content = xlsxArtifactContent(opened.projection);
    content.sheets[0]!.charts.push({
      id: "chart-created-by-editor",
      type: "line",
      sourceRange: "Sheet1!A1:B3",
      title: "Revenue",
      position: { x: 80, y: 40, width: 420, height: 260 },
    });
    const saved = await xlsxLens.materialize({
      projection: xlsxProjectionFromContent(content, opened.projection),
      carry: opened.preservedCarry,
    });
    const files = unzipSync(saved);
    const chartPart = Object.keys(files).find((name) => /^xl\/charts\/chart\d+\.xml$/.test(name));
    const drawingPart = Object.keys(files).find((name) => /^xl\/drawings\/drawing\d+\.xml$/.test(name));
    expect(chartPart).toBeTruthy();
    expect(drawingPart).toBeTruthy();
    expect(packageText(saved, chartPart!)).toContain("Revenue");
    expect(packageText(saved, chartPart!)).toContain("ptCount");
    expect(packageText(saved, drawingPart!)).toContain("chart");
    expect(packageText(saved, "xl/worksheets/sheet1.xml")).toContain("drawing");

    const reopened = await xlsxLens.open(saved, "enhanced");
    expect(reopened.projection.sheets[0]!.charts?.[0]).toMatchObject({
      type: "line",
      title: "Revenue",
    });
    // A second semantic pass recognizes the native chart by stable position and
    // does not create a duplicate merely because its native part identity was
    // assigned during the first write.
    const secondProjection = xlsxProjectionFromContent(content, reopened.projection);
    expect(xlsxOperationsBetween(reopened.projection, secondProjection).filter((operation) => operation.kind === "upsert-chart")).toHaveLength(0);
  });

  it("rebases formulas, tables, charts, and caches for a native row insertion", async () => {
    const source = await complexFixture();
    const opened = await xlsxLens.open(source, "enhanced");
    const sheet = opened.projection.sheets[0]!;
    const sourceFormula = sheet.cells.find((cell) => cell.formula)?.ref;
    expect(sourceFormula).toBeTruthy();
    const edited = await xlsxLens.mutate(opened.preservedCarry, {
      kind: "mutate-sheet-axis",
      sheetId: sheet.id,
      axis: "row",
      at: 1,
      delta: 1,
    });
    const reopened = await xlsxLens.open(edited, "enhanced");
    expect(reopened.projection.sheets[0]!.tables?.[0]?.range).toBe("A18:C20");
    expect(reopened.projection.sheets[0]!.charts?.[0]?.sourceRange).toContain("$A$6");
    expect(reopened.projection.sheets[0]!.cells.some((cell) => cell.formulaCache === "absent")).toBe(true);
  });

  it("materializes editable validation and conditional-format rules with native metadata", async () => {
    const workbook = Workbook.create();
    const sheet = workbook.sheet("Sheet1")!;
    sheet.setCell("A1", "Status");
    sheet.setCell("A2", "Ready");
    sheet.setCell("A3", "Done");
    const source = await workbook.save();
    const opened = await xlsxLens.open(source, "enhanced");
    const content = xlsxArtifactContent(opened.projection);
    const editorSheet = content.sheets[0]!;
    editorSheet.cells.A2 = {
      ...editorSheet.cells.A2,
      validation: {
        kind: "list",
        options: ["Ready", "Done"],
        rejectInvalid: true,
        showErrorMessage: true,
        errorTitle: "Invalid status",
        errorMessage: "Choose a status from the list.",
        promptTitle: "Status",
        promptMessage: "Choose Ready or Done.",
      },
    };
    editorSheet.cells.A3 = {
      ...editorSheet.cells.A3,
      validation: editorSheet.cells.A2.validation,
    };
    editorSheet.conditionalFormats = [{
      id: "cf-status",
      range: "A2:A3",
      kind: "cell_is",
      operator: "equal_to",
      value: 1,
      fillColor: "var(--success)",
      textColor: "var(--text-primary)",
      priority: 2,
      stopIfTrue: true,
    }];
    const projection = xlsxProjectionFromContent(content, opened.projection);
    const saved = await xlsxLens.materialize({ projection, carry: opened.preservedCarry });
    expect(packageText(saved, "xl/worksheets/sheet1.xml")).toMatch(/dataValidation[^>]*type="list"/);
    expect(packageText(saved, "xl/worksheets/sheet1.xml")).toMatch(/conditionalFormatting[^>]*sqref="A2:A3"/);
    expect(packageText(saved, "xl/worksheets/sheet1.xml")).toContain("Invalid status");
    const reopened = await xlsxLens.open(saved, "enhanced");
    const roundTripped = xlsxArtifactContent(reopened.projection);
    expect(roundTripped.sheets[0]!.cells.A2?.validation).toMatchObject({
      kind: "list",
      options: ["Ready", "Done"],
      errorTitle: "Invalid status",
      promptMessage: "Choose Ready or Done.",
    });
    expect(roundTripped.sheets[0]!.conditionalFormats?.[0]).toMatchObject({
      kind: "cell_is",
      priority: 2,
      stopIfTrue: true,
    });
    const shifted = await xlsxLens.mutate(reopened.preservedCarry, {
      kind: "mutate-sheet-axis",
      sheetId: reopened.projection.sheets[0]!.id,
      axis: "row",
      at: 1,
      delta: 1,
    });
    const shiftedProjection = await xlsxLens.open(shifted, "enhanced");
    const shiftedContent = xlsxArtifactContent(shiftedProjection.projection);
    expect(shiftedContent.sheets[0]!.cells.A3?.validation).toBeDefined();
    expect(shiftedContent.sheets[0]!.conditionalFormats?.[0]?.range).toBe("A3:A4");
  });

  it("writes native combo and histogram charts with source references and readback types", async () => {
    const workbook = Workbook.create();
    const sheet = workbook.sheet("Sheet1")!;
    sheet.setCell("A1", "Month");
    sheet.setCell("B1", "Revenue");
    sheet.setCell("C1", "Margin");
    [["Jan", 10, 0.2], ["Feb", 14, 0.25], ["Mar", 18, 0.3], ["Apr", 22, 0.35]].forEach(([month, revenue, margin], index) => {
      sheet.setCell(`A${index + 2}`, month);
      sheet.setCell(`B${index + 2}`, revenue);
      sheet.setCell(`C${index + 2}`, margin);
    });
    const source = await workbook.save();
    const opened = await xlsxLens.open(source, "enhanced");
    const content = xlsxArtifactContent(opened.projection);
    content.sheets[0]!.charts.push(
      {
        id: "combo-created",
        type: "combo",
        sourceRange: "Sheet1!A1:C5",
        title: "Revenue and margin",
        position: { x: 40, y: 40, width: 520, height: 280 },
      },
      {
        id: "histogram-created",
        type: "histogram",
        sourceRange: "Sheet1!B2:B5",
        title: "Revenue distribution",
        position: { x: 40, y: 340, width: 520, height: 280 },
      },
    );
    const saved = await xlsxLens.materialize({
      projection: xlsxProjectionFromContent(content, opened.projection),
      carry: opened.preservedCarry,
    });
    const chartParts = Object.keys(unzipSync(saved)).filter((name) => /^xl\/charts\/chart\d+\.xml$/.test(name));
    expect(chartParts).toHaveLength(2);
    const chartXml = chartParts.map((part) => packageText(saved, part));
    expect(chartXml.some((xml) => xml.includes("barChart") && xml.includes("lineChart"))).toBe(true);
    expect(chartXml.some((xml) => xml.includes("histogramChart") && xml.includes("histogramSeries") && xml.includes("binCount"))).toBe(true);
    expect(chartXml.every((xml) => xml.includes("Sheet1") && xml.includes("numCache"))).toBe(true);
    const reopened = await xlsxLens.open(saved, "enhanced");
    const charts = reopened.projection.sheets[0]!.charts ?? [];
    expect(charts.map((chart) => chart.type)).toEqual(expect.arrayContaining(["combo", "histogram"]));
    expect(charts.find((chart) => chart.type === "combo")?.series).toEqual(expect.arrayContaining([
      expect.objectContaining({ chartType: "column" }),
      expect.objectContaining({ chartType: "line" }),
    ]));
    const editedContent = xlsxArtifactContent(reopened.projection);
    editedContent.sheets[0]!.charts = editedContent.sheets[0]!.charts.map((chart) =>
      chart.type === "combo"
        ? { ...chart, sourceRange: "Sheet1!A1:C4", title: "Edited combo" }
        : { ...chart, sourceRange: "Sheet1!B2:B5", title: "Edited distribution" },
    );
    const edited = await xlsxLens.materialize({
      projection: xlsxProjectionFromContent(editedContent, reopened.projection),
      carry: reopened.preservedCarry,
    });
    const editedProjection = await xlsxLens.open(edited, "enhanced");
    expect(editedProjection.projection.sheets[0]!.charts?.map((chart) => chart.type)).toEqual(expect.arrayContaining(["combo", "histogram"]));
  });

  it("keeps unsupported validation and conditional-format rules when supported rules change", async () => {
    const workbook = Workbook.create();
    const sheet = workbook.sheet("Sheet1")!;
    sheet.setCell("A1", "Value");
    sheet.setCell("A2", 10);
    const native = await Workbook.open(await workbook.save());
    const document = await native.office.xml(native.sheet("Sheet1")!.partName);
    const prefix = document.root.lookupPrefix("http://schemas.openxmlformats.org/spreadsheetml/2006/main") ?? null;
    const validation = new XmlElement("dataValidations", prefix);
    validation.setAttribute("count", "1");
    const custom = new XmlElement("dataValidation", prefix);
    custom.setAttribute("type", "custom");
    custom.setAttribute("sqref", "A2");
    const customFormula = new XmlElement("formula1", prefix);
    customFormula.appendChild(new XmlText("ISNUMBER(A2)"));
    custom.appendChild(customFormula);
    validation.appendChild(custom);
    document.root.appendChild(validation);
    const conditional = new XmlElement("conditionalFormatting", prefix);
    conditional.setAttribute("sqref", "A2");
    const dataBar = new XmlElement("cfRule", prefix);
    dataBar.setAttribute("type", "dataBar");
    dataBar.setAttribute("priority", "9");
    dataBar.appendChild(new XmlElement("dataBar", prefix));
    conditional.appendChild(dataBar);
    document.root.appendChild(conditional);
    native.office.markDirty(native.sheet("Sheet1")!.partName);
    const source = await native.save();
    const opened = await xlsxLens.open(source, "enhanced");
    const content = xlsxArtifactContent(opened.projection);
    content.sheets[0]!.cells.A2 = {
      ...content.sheets[0]!.cells.A2,
      validation: { kind: "list", options: ["10"], rejectInvalid: true },
    };
    const saved = await xlsxLens.materialize({
      projection: xlsxProjectionFromContent(content, opened.projection),
      carry: opened.preservedCarry,
    });
    const xml = packageText(saved, "xl/worksheets/sheet1.xml");
    expect(xml).toContain('type="custom"');
    expect(xml).toContain("ISNUMBER(A2)");
    expect(xml).toContain('type="dataBar"');
    expect(xml).toContain("dataBar");
    expect(xml).toContain('type="list"');
  });
});
