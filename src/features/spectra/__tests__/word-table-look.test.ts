import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { exportDocxCopy } from "../lenses/docx-adapter";
import { docxLens } from "../lenses/docx-lens";
import { docxProjectionFromContent, documentBlocksFromJson, documentContentToProseMirrorJson } from "../lenses/document-projection";

type JsonNode = { type: string; attrs?: Record<string, unknown>; content?: JsonNode[]; text?: string };
const cell = (type: string, text: string, attrs: Record<string, unknown> = {}): JsonNode => ({ type, attrs, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const table = (attrs: Record<string, unknown> = {}, fills: (string | null)[][] = []): JsonNode => ({
  type: "table",
  attrs,
  content: [
    { type: "tableRow", content: [cell("tableHeader", "Mass (g)", fills[0]?.[0] ? { background: fills[0][0] } : {}), cell("tableHeader", "Time (s)", fills[0]?.[1] ? { background: fills[0][1] } : {})] },
    { type: "tableRow", content: [cell("tableCell", "1.0"), cell("tableCell", "2.0")] },
    { type: "tableRow", content: [cell("tableCell", "3.0", fills[2]?.[0] ? { background: fills[2][0] } : {}), cell("tableCell", "4.0")] },
  ],
});

async function documentXml(bytes: Uint8Array) {
  return (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
}

describe("a table's look in Word", () => {
  it("exports the lines, their colour and the cell fills it was given", async () => {
    const { bytes } = await exportDocxCopy({ type: "doc", content: [table({ lines: "horizontal", lineColor: "#2E74B5" }, [["#D9E2F3", "#D9E2F3"]])] });
    const xml = await documentXml(bytes);
    expect(xml).toMatch(/<w:top w:val="single"[^>]*w:color="2E74B5"/u);
    expect(xml).toMatch(/<w:left w:val="nil"/u);
    expect(xml).toMatch(/<w:insideV w:val="nil"/u);
    expect(xml.match(/w:fill="D9E2F3"/gu)?.length).toBe(2);
    const opened = await docxLens.open(bytes, "strict-native");
    expect(opened.projection.blocks[0]!.attrs).toMatchObject({ borders: "horizontal", borderColor: "2E74B5", cellShading: [["D9E2F3", "D9E2F3"], [null, null], [null, null]] });
    const json = documentContentToProseMirrorJson(opened.projection) as { content: JsonNode[] };
    expect(json.content[0]!.attrs).toMatchObject({ lines: "horizontal", lineColor: "#2E74B5" });
  });

  it("restyled in Spectra, saves into the Word file and reads back, and an untouched table is left alone", async () => {
    const { bytes } = await exportDocxCopy({ type: "doc", content: [table(), table()] });
    const opened = await docxLens.open(bytes, "strict-native");
    const json = documentContentToProseMirrorJson(opened.projection) as { type: string; content: JsonNode[] };
    const target = json.content[0]!;
    target.attrs = { ...target.attrs, lines: "outer", lineColor: "#C00000", fillsSet: true };
    target.content![2]!.content![0]!.attrs = { ...target.content![2]!.content![0]!.attrs, background: "#FFF2CC" };
    const update = docxProjectionFromContent({ ...opened.projection, blocks: documentBlocksFromJson(json as never) }, opened.projection);
    const looks = update.operations.filter((operation) => operation.kind === "set-table-look");
    expect(looks).toEqual([{ kind: "set-table-look", regionId: opened.projection.blocks[0]!.id, borders: "outer", borderColor: "C00000", cellShading: [[null, null], [null, null], ["FFF2CC", null]] }]);
    const output = new Uint8Array(await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations: update.operations }));
    const reopened = await docxLens.open(output, "strict-native");
    expect(reopened.projection.blocks[0]!.attrs).toMatchObject({ borders: "outer", borderColor: "C00000", cellShading: [[null, null], [null, null], ["FFF2CC", null]] });
    expect(reopened.projection.blocks[1]!.attrs?.borders).toBe("grid");
    expect(reopened.projection.blocks[1]!.attrs?.cellShading).toBeUndefined();

    // Clearing the last fill reaches Word too.
    const json2 = documentContentToProseMirrorJson(reopened.projection) as { type: string; content: JsonNode[] };
    json2.content[0]!.content![2]!.content![0]!.attrs = { ...json2.content[0]!.content![2]!.content![0]!.attrs, background: null };
    const update2 = docxProjectionFromContent({ ...reopened.projection, blocks: documentBlocksFromJson(json2 as never) }, reopened.projection);
    const output2 = new Uint8Array(await docxLens.mutate(reopened.preservedCarry, { kind: "ai-edit", operations: update2.operations }));
    expect((await docxLens.open(output2, "strict-native")).projection.blocks[0]!.attrs?.cellShading).toBeUndefined();
  });

  it("content stored before fills were shown never clears Word's fills", async () => {
    const { bytes } = await exportDocxCopy({ type: "doc", content: [table({}, [["#D9E2F3", "#D9E2F3"]])] });
    const opened = await docxLens.open(bytes, "strict-native");
    const json = documentContentToProseMirrorJson(opened.projection) as { type: string; content: JsonNode[] };
    const stale = json.content[0]!;
    delete stale.attrs!.lines;
    delete stale.attrs!.lineColor;
    for (const row of stale.content ?? []) for (const item of row.content ?? []) if (item.attrs) delete item.attrs.background;
    const update = docxProjectionFromContent({ ...opened.projection, blocks: documentBlocksFromJson(json as never) }, opened.projection);
    expect(update.operations.filter((operation) => operation.kind === "set-table-look")).toEqual([]);
  });
});
