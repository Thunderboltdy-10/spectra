// @vitest-environment jsdom
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

/**
 * A German report: its heading styles are called "berschrift1" and
 * "berschrift2" (Word keeps the built-in names "heading 1", "heading 2"), and
 * an outline list numbers them 1, 1.1, 1.2, 2, 2.1.
 */
async function localisedReport() {
  const outline = { reference: "outline", level: 0 };
  const document = new docx.Document({
    numbering: {
      config: [{
        reference: "outline",
        levels: [
          { level: 0, format: docx.LevelFormat.DECIMAL, text: "%1", start: 1 },
          { level: 1, format: docx.LevelFormat.DECIMAL, text: "%1.%2", start: 1 },
        ],
      }],
    },
    sections: [{
      children: [
        new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, numbering: outline, children: [new docx.TextRun("Einleitung")] }),
        new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_2, numbering: { ...outline, level: 1 }, children: [new docx.TextRun("Hintergrund")] }),
        new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_2, numbering: { ...outline, level: 1 }, children: [new docx.TextRun("Methode")] }),
        new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_1, numbering: outline, children: [new docx.TextRun("Ergebnisse")] }),
        new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_2, numbering: { ...outline, level: 1 }, children: [new docx.TextRun("Daten")] }),
        new docx.Paragraph({ heading: docx.HeadingLevel.HEADING_4, children: [new docx.TextRun("Einzelheiten")] }),
        new docx.Paragraph({ children: [new docx.TextRun("Text.")] }),
      ],
    }],
  });
  const zip = await JSZip.loadAsync(await docx.Packer.toBuffer(document));
  for (const part of ["word/styles.xml", "word/document.xml"]) {
    const xml = await zip.file(part)!.async("string");
    zip.file(part, xml.replace(/"Heading([12])"/gu, '"berschrift$1"').replace(/w:val="Heading ([12])"/gu, 'w:val="heading $1"'));
  }
  return new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
}

async function bodyXml(bytes: Uint8Array, part = "word/document.xml") {
  return (await JSZip.loadAsync(bytes)).file(part)!.async("string");
}

const paragraphWith = (xml: string, text: string) =>
  (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/gu) ?? []).find((paragraph) => paragraph.includes(text)) ?? "";

describe("Word headings by role", () => {
  it("opens localised, numbered headings as headings with Word's numbers", async () => {
    const opened = await docxLens.open(await localisedReport());
    const blocks = opened.projection.blocks.slice(0, 6);
    expect(blocks.map((block) => block.type)).toEqual(["heading", "heading", "heading", "heading", "heading", "heading"]);
    expect(blocks.map((block) => block.attrs?.styleId)).toEqual(["Heading1", "Heading2", "Heading2", "Heading1", "Heading2", "Heading4"]);
    expect(blocks.map((block) => block.attrs?.nativeStyleId)).toEqual(["berschrift1", "berschrift2", "berschrift2", "berschrift1", "berschrift2", undefined]);
    expect(blocks.map((block) => block.attrs?.number)).toEqual(["1", "1.1", "1.2", "2", "2.1", undefined]);
    expect(blocks.some((block) => block.attrs?.list)).toBe(false);
    const json = documentContentToProseMirrorJson(opened.projection) as DocumentJsonNode;
    const headings = json.content!.filter((node) => node.type === "heading");
    expect(headings.map((node) => [node.attrs?.level, node.attrs?.headingNumber ?? null])).toEqual([
      [1, "1"], [2, "1.1"], [2, "1.2"], [1, "2"], [2, "2.1"], [4, null],
    ]);
  });

  it("writes nothing back for untouched numbered headings", async () => {
    const opened = await docxLens.open(await localisedReport());
    const base = opened.projection;
    const json = documentContentToProseMirrorJson(base) as DocumentJsonNode;
    expect(docxProjectionFromContent({ ...base, tiptap: json, blocks: documentBlocksFromJson(json), nativeProjectionComplete: true }, base).operations).toEqual([]);
  });

  it("keeps Word's numbering on an edited heading and reuses the file's own heading style", async () => {
    const opened = await docxLens.open(await localisedReport());
    const base = opened.projection;
    const json = documentContentToProseMirrorJson(base) as DocumentJsonNode;
    const headings = json.content!.filter((node) => node.type === "heading");
    headings[2]!.content = [{ type: "text", text: "Methodik" }];
    headings[5]!.attrs = { ...headings[5]!.attrs, level: 2 };
    const { operations } = docxProjectionFromContent({ ...base, tiptap: json, blocks: documentBlocksFromJson(json), nativeProjectionComplete: true }, base);
    expect(operations.length).toBeGreaterThan(0);
    const output = await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations });
    const xml = await bodyXml(output);
    const method = paragraphWith(xml, "Methodik");
    expect(method).toContain('<w:pStyle w:val="berschrift2"/>');
    expect(method).toContain("<w:numPr>");
    expect(paragraphWith(xml, "Einzelheiten")).toContain('<w:pStyle w:val="berschrift2"/>');
    expect(await bodyXml(output, "word/styles.xml")).not.toContain('w:styleId="Heading2"');
    const reopened = await docxLens.open(output);
    expect(reopened.projection.blocks.slice(0, 6).map((block) => block.attrs?.number)).toEqual(["1", "1.1", "1.2", "2", "2.1", undefined]);
  });
});
