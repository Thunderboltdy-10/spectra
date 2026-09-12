import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { Workbook } from "@ariadng/office/xlsx";
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
});
