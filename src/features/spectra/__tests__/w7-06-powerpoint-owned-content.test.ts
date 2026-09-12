import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildPresentationPptx } from "../presentation/io";
import {
  applyLinkedChartResolution,
  refreshPresentationLinkedCharts,
  resolveLinkedChart,
} from "../presentation/linked-chart";
import type { PresentationContent } from "../presentation/model";
import type { SpectraArtifact } from "../data/api";
import { pptxLens } from "../lenses/pptx-lens";

const chartFixture = "fixtures/office/pptx/chart-notes-preservation.pptx";

async function artifact(value: unknown) {
  return pptxLens.open(new Uint8Array(await readFile(String(value))));
}

function sourceArtifact(content: unknown, status: SpectraArtifact["status"] = "active") {
  return {
    _id: "sheets-source",
    blueprintKey: "sheets",
    title: "Committed source",
    status,
    content,
    tags: [],
    createdAt: 1,
    updatedAt: 2,
    currentVersionId: "version-7",
  } as SpectraArtifact;
}

describe("W7-06 PowerPoint-owned content", () => {
  it("duplicates a chart with an isolated chart/workbook graph and cleans it after deletion", async () => {
    const opened = await artifact(chartFixture);
    const sourceSlide = opened.projection.slides[0]!;
    const sourceChart = sourceSlide.objects.find((object) => object.type === "chart")!;
    const nativeShapeId = (sourceChart.content as { nativeShapeId: string }).nativeShapeId;
    const duplicated = await pptxLens.mutate(opened.preservedCarry, {
      kind: "ai-edit",
      operations: [
        { kind: "duplicate-slide", slideId: sourceSlide.id, newSlideId: "duplicate" },
        {
          kind: "set-chart",
          slideId: "duplicate",
          shapeId: nativeShapeId,
          categories: ["Q1", "Q2"],
          series: [{ name: "Copied output", categories: ["Q1", "Q2"], values: [901, 902] }],
          showLegend: true,
        },
      ],
    });
    const files = unzipSync(duplicated);
    expect(files["ppt/charts/chart1.xml"]).toBeTruthy();
    expect(files["ppt/charts/chart2.xml"]).toBeTruthy();
    expect(files["ppt/embeddings/Microsoft_Office_Excel_Worksheet1.xlsx"]).toBeTruthy();
    expect(files["ppt/embeddings/Microsoft_Office_Excel_Worksheet2.xlsx"]).toBeTruthy();
    expect(strFromU8(files["ppt/charts/chart1.xml"]!)).not.toContain("Copied output");
    expect(strFromU8(files["ppt/charts/chart2.xml"]!)).toContain("Copied output");

    const reopened = await pptxLens.open(duplicated);
    const duplicateSlide = reopened.projection.slides[1]!;
    const duplicateChart = duplicateSlide.objects.find((object) => object.type === "chart")!;
    expect((duplicateChart.content as { nativeChartPart?: string }).nativeChartPart).not.toBe(
      (sourceChart.content as { nativeChartPart?: string }).nativeChartPart,
    );
    expect((duplicateChart.content as { series: Array<{ values: number[] }> }).series[0]!.values).toEqual([901, 902]);
    const remaining = {
      ...reopened.projection,
      slides: [reopened.projection.slides[0]!],
    };
    const deleted = await pptxLens.materialize({ projection: remaining, carry: reopened.preservedCarry });
    const deletedFiles = unzipSync(deleted);
    expect(deletedFiles["ppt/charts/chart1.xml"]).toBeTruthy();
    expect(deletedFiles["ppt/charts/chart2.xml"]).toBeUndefined();
    expect(deletedFiles["ppt/embeddings/Microsoft_Office_Excel_Worksheet2.xlsx"]).toBeUndefined();
  }, 30_000);

  it("writes and reads external and internal native hyperlinks while removing stale relationships", async () => {
    const content: PresentationContent = {
      theme: { id: "links" },
      slides: [
        {
          id: "slide-1",
          title: "Links",
          objects: [{
            id: "text-1",
            type: "text",
            x: 80,
            y: 80,
            width: 700,
            height: 100,
            rotation: 0,
            hyperlink: { kind: "external", url: "https://old.example.test" },
            content: {
              paragraphs: [{ runs: [
                { text: "external", hyperlink: { kind: "external", url: "https://old.example.test" } },
                { text: " and next", bold: true, hyperlink: { kind: "slide", slideId: "slide-2" } },
              ] }],
            },
          }, {
            id: "shape-1",
            type: "shape",
            x: 80,
            y: 220,
            width: 260,
            height: 90,
            rotation: 0,
            hyperlink: { kind: "external", url: "https://shape.example.test" },
            content: { text: "Shape link" },
          }],
        },
        { id: "slide-2", title: "Target", objects: [] },
      ],
      settings: { aspectRatio: "16:9" },
    };
    const blob = await buildPresentationPptx(content, []);
    const original = new Uint8Array(await blob.arrayBuffer());
    const originalFiles = unzipSync(original);
    const originalRels = strFromU8(originalFiles["ppt/slides/_rels/slide1.xml.rels"]!);
    expect(originalRels).toContain("hyperlink");
    expect(originalRels).toContain('Target="slide2.xml"');
    const opened = await pptxLens.open(original);
    const slide = opened.projection.slides[0]!;
    const text = slide.objects.find((object) => object.type === "text")!;
    expect(text.hyperlink).toBeUndefined();
    expect((text.content as { paragraphs: Array<{ runs: Array<{ hyperlink?: unknown }> }> }).paragraphs[0]!.runs.map((run) => run.hyperlink)).toEqual([
      { kind: "external", url: "https://old.example.test" },
      { kind: "slide", slideId: "pptx:slide:/ppt/slides/slide2.xml" },
    ]);
    expect(opened.projection.slides[0]!.objects.find((object) => object.hyperlink && typeof object.hyperlink !== "string" && object.hyperlink.kind === "external" && object.hyperlink.url === "https://shape.example.test")?.hyperlink).toEqual({
      kind: "external",
      url: "https://shape.example.test",
    });

    const changed = structuredClone(opened.projection);
    const changedText = changed.slides[0]!.objects.find((object) => object.id === text.id)!;
    changedText.hyperlink = undefined;
    changedText.content = {
      ...(changedText.content as Record<string, unknown>),
      paragraphs: [{ runs: [{ text: "external", bold: false, hyperlink: { kind: "external", url: "https://new.example.test" } }, { text: " and next", bold: true }] }],
    };
    const changedShape = changed.slides[0]!.objects.find((object) => object.hyperlink && typeof object.hyperlink !== "string" && object.hyperlink.kind === "external" && object.hyperlink.url === "https://shape.example.test");
    if (changedShape) changedShape.hyperlink = undefined;
    const edited = await pptxLens.materialize({ projection: changed, carry: opened.preservedCarry });
    const editedFiles = unzipSync(edited);
    const editedRels = strFromU8(editedFiles["ppt/slides/_rels/slide1.xml.rels"]!);
    expect(editedRels).toContain("https://new.example.test");
    expect(editedRels).not.toContain("https://old.example.test");
    expect(editedRels).not.toContain('Target="slide2.xml"');
    expect(strFromU8(editedFiles["ppt/slides/slide1.xml"]!)).toContain('b="1"');
  });

  it("resolves committed Sheets ranges, pins their full series, and keeps saved content when access is unavailable", () => {
    const chart = {
      id: "chart",
      type: "chart" as const,
      x: 0, y: 0, width: 100, height: 100, rotation: 0,
      content: { chartType: "column", categories: ["old"], series: [{ name: "Old", categories: ["old"], values: [1] }] },
      sourceBinding: { artifactId: "sheets-source", kind: "sheets_range" as const, range: "Data!A1:C4", live: true },
    };
    const source = sourceArtifact({
      activeSheetId: "data",
      sheets: [{ id: "data", name: "Data", cells: {
        A1: { value: "Quarter" }, B1: { value: "Output" }, C1: { value: "Cost" },
        A2: { value: "Q1" }, B2: { value: 10 }, C2: { value: 2 },
        A3: { value: "Q2" }, B3: { value: 20 }, C3: { value: 3 },
        A4: { value: "Q3" }, B4: { value: 30 }, C4: { value: 4 },
      } }],
    });
    const available = resolveLinkedChart(chart, [source]);
    expect(available.status).toBe("available");
    expect(available.sourceRevision).toBe("version-7");
    expect(available.chart?.series.map((series) => series.values)).toEqual([[10, 20, 30], [2, 3, 4]]);
    const saved = applyLinkedChartResolution(chart, available);
    expect((saved.content as { series: unknown[] }).series).toHaveLength(2);
    const pinned = resolveLinkedChart({ ...saved, sourceBinding: { ...saved.sourceBinding!, live: false } }, [sourceArtifact(undefined, "deleted")]);
    expect(pinned.status).toBe("pinned");
    expect(pinned.chart?.series[1]?.values).toEqual([2, 3, 4]);
    const unavailable = refreshPresentationLinkedCharts({ theme: { id: "test" }, slides: [{ id: "s", title: "s", objects: [chart] }] }, [sourceArtifact(undefined, "deleted")]);
    expect(unavailable.unavailable).toEqual(["chart"]);
    expect((unavailable.deck.slides[0]!.objects[0]!.content as { series: unknown[] }).series).toHaveLength(1);
  });
});
