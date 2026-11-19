import { describe, expect, it } from "vitest";
import * as docx from "docx";
import JSZip from "jszip";
import { docxLens } from "../lenses/docx-lens";
import {
  docxProjectionFromContent,
  documentBlocksFromJson,
  documentContentToProseMirrorJson,
  type DocumentJsonNode,
} from "../lenses/document-projection";

async function numberedSteps() {
  const step = (text: string, level: number) => new docx.Paragraph({ numbering: { reference: "steps", level }, children: [new docx.TextRun(text)] });
  const document = new docx.Document({
    numbering: {
      config: [{
        reference: "steps",
        levels: [
          { level: 0, format: docx.LevelFormat.DECIMAL, text: "%1.", alignment: docx.AlignmentType.START },
          { level: 1, format: docx.LevelFormat.LOWER_LETTER, text: "%2)", alignment: docx.AlignmentType.START },
        ],
      }],
    },
    sections: [{ children: [step("Measure", 0), step("Record", 0), step("Repeat", 1), step("Average", 0)] }],
  });
  return new Uint8Array(await docx.Packer.toBuffer(document));
}

/** Each body paragraph's text with its list id and level, in order. */
async function wordParagraphs(bytes: Uint8Array) {
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/gu) ?? []).map((paragraph) => [
    [...paragraph.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/gu)].map((match) => match[1]).join(""),
    paragraph.match(/<w:numId w:val="(\d+)"/u)?.[1] ?? null,
    Number(paragraph.match(/<w:ilvl w:val="(\d+)"/u)?.[1] ?? -1),
  ]);
}

describe("a Word list opens as one nested list", () => {
  it("groups its paragraphs and nests them by level", async () => {
    const opened = await docxLens.open(await numberedSteps());
    const json = documentContentToProseMirrorJson(opened.projection) as DocumentJsonNode;
    expect(json.content?.map((node) => node.type)).toEqual(["orderedList"]);
    const items = json.content![0]!.content!;
    expect(items.map((item) => item.content?.[0]?.content?.[0]?.text)).toEqual(["Measure", "Record", "Average"]);
    expect(items[1]!.content?.[1]?.type).toBe("orderedList");
    expect(items[1]!.content?.[1]?.attrs?.type).toBe("a");
  });

  it("is unchanged after the editor trip", async () => {
    const opened = await docxLens.open(await numberedSteps());
    const base = opened.projection;
    const blocks = documentBlocksFromJson(documentContentToProseMirrorJson(base) as DocumentJsonNode);
    expect(docxProjectionFromContent({ ...base, blocks, nativeProjectionComplete: true }, base).operations).toEqual([]);
  });

  it("writes an item added under another into the same Word list, one level down", async () => {
    const opened = await docxLens.open(await numberedSteps());
    const base = opened.projection;
    const json = documentContentToProseMirrorJson(base) as DocumentJsonNode;
    // Enter after "Repeat": a second item of the nested list.
    const nested = json.content![0]!.content![1]!.content![1]!;
    nested.content!.push({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Check" }] }] });
    // And an edit to an item in the middle of the list.
    json.content![0]!.content![2]!.content![0]!.content = [{ type: "text", text: "Average the trials" }];
    const blocks = documentBlocksFromJson(json);
    const { operations } = docxProjectionFromContent({ ...base, tiptap: json, blocks, nativeProjectionComplete: true }, base);
    const output = await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations });
    const paragraphs = await wordParagraphs(output);
    const numId = paragraphs[0]![1];
    expect(paragraphs).toEqual([
      ["Measure", numId, 0],
      ["Record", numId, 0],
      ["Repeat", numId, 1],
      ["Check", numId, 1],
      ["Average the trials", numId, 0],
    ]);
  });

  it("moves an existing item a level in or out when the writer presses Tab or Shift+Tab", async () => {
    const opened = await docxLens.open(await numberedSteps());
    const base = opened.projection;
    const json = documentContentToProseMirrorJson(base) as DocumentJsonNode;
    const list = json.content![0]!;
    const [measure, record, average] = list.content!;
    // Shift+Tab on "Repeat" lifts it beside "Record"; Tab on "Average" sinks it under "Repeat".
    const repeat = record!.content![1]!.content![0]!;
    list.content = [measure!, { ...record!, content: [record!.content![0]!] },
      { ...repeat, content: [...repeat.content!, { type: "orderedList", content: [average!] }] }];
    const blocks = documentBlocksFromJson(json);
    const { operations } = docxProjectionFromContent({ ...base, tiptap: json, blocks, nativeProjectionComplete: true }, base);
    expect(operations.map((operation) => operation.kind)).toEqual(["format-paragraph", "format-paragraph"]);
    const output = await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations });
    const paragraphs = await wordParagraphs(output);
    const numId = paragraphs[0]![1];
    expect(paragraphs).toEqual([["Measure", numId, 0], ["Record", numId, 0], ["Repeat", numId, 0], ["Average", numId, 1]]);
    const reopened = await docxLens.open(output);
    const tree = documentContentToProseMirrorJson(reopened.projection) as DocumentJsonNode;
    expect(tree.content?.length).toBe(1);
    expect(tree.content![0]!.content![2]!.content![1]!.content![0]!.content![0]!.content![0]!.text).toBe("Average");
  });
});
