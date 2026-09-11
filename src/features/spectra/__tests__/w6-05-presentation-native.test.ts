import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildPresentationPptx } from "../presentation/io";
import { pptxLens } from "../lenses/pptx-lens";
import type { PresentationContent } from "../presentation/model";

function nativeContent(): PresentationContent {
  return {
    theme: { id: "native-test", fonts: { heading: "Cambria", body: "Aptos" } },
    slides: [{
      id: "slide-1",
      title: "Native editing",
      speakerNotes: "Speaker notes survive native export.",
      objects: [
        {
          id: "rich-text",
          type: "text",
          x: 80,
          y: 70,
          width: 800,
          height: 100,
          rotation: 0,
          content: {
            text: "Bold lead\nAptos body",
            paragraphs: [
              { runs: [{ text: "Bold lead", bold: true, color: "var(--accent)" }] },
              { runs: [{ text: "Aptos body", fontFamily: "Aptos", fontSizePt: 22 }] },
            ],
          },
          readingOrder: 0,
        },
        {
          id: "rich-text-2",
          type: "text",
          x: 80,
          y: 430,
          width: 360,
          height: 80,
          rotation: 0,
          content: { text: "Second native text box" },
          readingOrder: 3,
        },
        {
          id: "table-1",
          type: "table",
          x: 80,
          y: 200,
          width: 420,
          height: 180,
          rotation: 0,
          content: {
            rows: [
              [{ text: "Metric", style: { fill: "var(--bg-secondary)", bold: true } }, { text: "Value" }],
              [{ text: "Retention" }, { text: "92", style: { color: "var(--accent-mint)" } }],
            ],
          },
          readingOrder: 1,
        },
        {
          id: "chart-1",
          type: "chart",
          x: 540,
          y: 180,
          width: 380,
          height: 250,
          rotation: 0,
          content: {
            chartType: "column",
            title: "Quarterly output",
            categories: ["Q1", "Q2", "Q3"],
            series: [{ name: "Output", categories: ["Q1", "Q2", "Q3"], values: [12, 18, 24] }],
            showLegend: true,
          },
          readingOrder: 2,
        },
      ],
    }],
    settings: { aspectRatio: "16:9" },
  };
}

describe("W6-05 native PowerPoint writer", () => {
  it("exports rich text, editable tables, and native chart parts", async () => {
    const blob = await buildPresentationPptx(nativeContent(), []);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const slideXml = strFromU8(files["ppt/slides/slide1.xml"]!);
    const chartXml = strFromU8(files["ppt/charts/chart1.xml"]!);
    expect(slideXml).toContain("<a:tbl>");
    expect(slideXml).toContain('b="1"');
    expect(slideXml).toContain("graphicFrame");
    expect(chartXml).toContain("<c:barChart>");
    expect(files["ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx"]).toBeTruthy();

    const opened = await pptxLens.open(new Uint8Array(await blob.arrayBuffer()));
    const objects = opened.projection.slides[0]!.objects;
    expect(objects.find((object) => object.type === "table")?.content).toMatchObject({ nativeTable: true });
    expect(objects.find((object) => object.type === "chart")?.content).toMatchObject({
      chartType: "column",
      title: "Quarterly output",
      categories: ["Q1", "Q2", "Q3"],
      series: [{ name: "Output", values: [12, 18, 24] }],
    });
    const textContent = objects.find((object) => object.type === "text")?.content as { paragraphs: Array<{ runs: Array<{ text: string; bold?: boolean }> }> };
    expect(textContent.paragraphs[0]!.runs[0]).toMatchObject({ text: "Bold lead", bold: true });
  });

  it("writes chart caches and embedded workbook values through the native chart relationship", async () => {
    const source = new Uint8Array(await readFile("fixtures/office/pptx/chart-notes-preservation.pptx"));
    const opened = await pptxLens.open(source);
    const slide = opened.projection.slides[0]!;
    const chart = slide.objects.find((object) => object.type === "chart")!;
    const chartContent = chart.content as { nativeShapeId: string; categories: string[]; series: Array<{ id?: string; name: string; categories: string[]; values: number[] }> };
    const edited = await pptxLens.mutate(opened.preservedCarry, {
      kind: "set-chart",
      slideId: slide.id,
      shapeId: chartContent.nativeShapeId,
      title: "Updated output",
      categories: chartContent.categories,
      series: chartContent.series.map((series, index) => index === 0 ? { ...series, values: [10, 20, 30, 40] } : series),
      showLegend: true,
    });
    const files = unzipSync(edited);
    const chartXml = strFromU8(files["ppt/charts/chart1.xml"]!);
    expect(chartXml).toContain("Updated output");
    expect(chartXml).toMatch(/<c:v>10<\/c:v>/);
    expect(chartXml).toMatch(/<c:v>40<\/c:v>/);
    const reopened = await pptxLens.open(edited);
    expect((reopened.projection.slides[0]!.objects.find((object) => object.id === chart.id)!.content as { title?: string }).title).toBe("Updated output");
    expect((reopened.projection.slides[0]!.objects.find((object) => object.id === chart.id)!.content as { series: Array<{ values: number[] }> }).series[0]!.values).toEqual([10, 20, 30, 40]);
  });

  it("writes table cell text and formatting without flattening the table graphic frame", async () => {
    const generated = await buildPresentationPptx(nativeContent(), []);
    const opened = await pptxLens.open(new Uint8Array(await generated.arrayBuffer()));
    const slide = opened.projection.slides[0]!;
    const table = slide.objects.find((object) => object.type === "table")!;
    const tableContent = table.content as { nativeShapeId: string; rows: Array<Array<{ text: string; style?: Record<string, unknown> }>> };
    const rows = tableContent.rows.map((row) => row.map((cell) => ({ ...cell })));
    rows[0]![0] = { ...rows[0]![0]!, text: "Metric updated", style: { ...(rows[0]![0]!.style ?? {}), fill: "var(--bg-elevated)", bold: true } };
    const edited = await pptxLens.materialize({
      projection: {
        ...opened.projection,
        slides: opened.projection.slides.map((candidate) => candidate.id !== slide.id ? candidate : {
          ...candidate,
          objects: candidate.objects.map((object) => object.id === table.id ? { ...object, content: { ...tableContent, rows } } : object),
        }),
      },
      carry: opened.preservedCarry,
    });
    const reopened = await pptxLens.open(edited);
    const updated = reopened.projection.slides[0]!.objects.find((object) => object.id === table.id)!;
    const updatedCell = (updated.content as { rows: Array<Array<{ text: string; style?: Record<string, unknown> }>> }).rows[0]![0]!;
    expect(updatedCell.text).toBe("Metric updated");
    expect(updatedCell.style?.fill).toBe("#FFFEFD");
  });

  it("keeps native shape identity while applying rich runs and grouping existing objects", async () => {
    const generated = await buildPresentationPptx(nativeContent(), []);
    const opened = await pptxLens.open(new Uint8Array(await generated.arrayBuffer()));
    const slide = opened.projection.slides[0]!;
    const body = slide.objects.find((object) => object.type === "text" && !object.locked)!;
    const paragraphs = [{ runs: [{ text: "Native bold", bold: true, fontSizePt: 26, color: "var(--accent-mint)" }] }];
    const members = slide.objects.filter((object) => object.type === "text" && !object.locked);
    const groupId = `${slide.id}:group:w6-05`;
    const after = {
      ...opened.projection,
      slides: opened.projection.slides.map((candidate) => candidate.id !== slide.id ? candidate : {
        ...candidate,
        objects: [
          ...candidate.objects.map((object) => object.id === body.id ? { ...object, content: { ...(object.content as object), text: "Native bold", paragraphs } } : object).map((object) => members.some((member) => member.id === object.id) ? { ...object, parentId: groupId } : object),
          {
            id: groupId,
            type: "group" as const,
            x: Math.min(...members.map((object) => object.x)),
            y: Math.min(...members.map((object) => object.y)),
            width: Math.max(...members.map((object) => object.x + object.width)) - Math.min(...members.map((object) => object.x)),
            height: Math.max(...members.map((object) => object.y + object.height)) - Math.min(...members.map((object) => object.y)),
            rotation: 0,
            content: { childIds: members.map((member) => member.id) },
            readingOrder: 0,
          },
        ],
      }),
    };
    const edited = await pptxLens.materialize({ projection: after, carry: opened.preservedCarry });
    const reopened = await pptxLens.open(edited);
    const editedBody = reopened.projection.slides[0]!.objects.find((object) => object.id === body.id)!;
    expect(editedBody.content).toMatchObject({ text: "Native bold", paragraphs: [{ runs: [{ bold: true, fontSizePt: 26 }] }] });
    expect(reopened.projection.slides[0]!.objects.some((object) => object.type === "group")).toBe(true);
    expect(editedBody.parentId).toMatch(/:shape:\d+$/);
  });
});
