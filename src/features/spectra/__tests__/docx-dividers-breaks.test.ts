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

async function report() {
  const document = new docx.Document({
    sections: [{
      children: [
        new docx.Paragraph("Title"),
        new docx.Paragraph({ border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: "auto", space: 1 } }, spacing: { after: 120 }, children: [] }),
        new docx.Paragraph("Introduction"),
        new docx.Paragraph({ children: [new docx.PageBreak()] }),
        new docx.Paragraph("Method"),
        new docx.Paragraph({ border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: "auto", space: 1 } }, children: [new docx.TextRun("Boxed heading")] }),
      ],
    }],
  });
  return new Uint8Array(await docx.Packer.toBuffer(document));
}

async function bodyParagraphs(bytes: Uint8Array) {
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/gu) ?? []).map((paragraph) => ({
    text: [...paragraph.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/gu)].map((match) => match[1]).join(""),
    rule: /<w:pBdr>\s*<w:bottom /u.test(paragraph),
    page: paragraph.includes('w:type="page"'),
    spaced: /<w:spacing [^>]*w:after="120"/u.test(paragraph),
  }));
}

describe("Word dividers and page breaks open as their editor nodes", () => {
  it("opens an empty bottom-bordered paragraph as a divider and a page-break paragraph as a page break", async () => {
    const opened = await docxLens.open(await report());
    const json = documentContentToProseMirrorJson(opened.projection) as DocumentJsonNode;
    expect(json.content?.map((node) => node.type)).toEqual(["paragraph", "horizontalRule", "paragraph", "pageBreak", "paragraph", "paragraph"]);
  });

  it("writes nothing back when the writer has not touched them", async () => {
    const opened = await docxLens.open(await report());
    const base = opened.projection;
    const json = documentContentToProseMirrorJson(base) as DocumentJsonNode;
    const blocks = documentBlocksFromJson(json);
    expect(docxProjectionFromContent({ ...base, tiptap: json, blocks, nativeProjectionComplete: true }, base).operations).toEqual([]);
  });

  it("keeps a Word divider's own spacing when text around it changes, and writes a new divider as a bottom border", async () => {
    const opened = await docxLens.open(await report());
    const base = opened.projection;
    const json = documentContentToProseMirrorJson(base) as DocumentJsonNode;
    json.content![2]!.content = [{ type: "text", text: "Introduction and aims" }];
    json.content!.splice(5, 0, { type: "horizontalRule" });
    const blocks = documentBlocksFromJson(json);
    const { operations } = docxProjectionFromContent({ ...base, tiptap: json, blocks, nativeProjectionComplete: true }, base);
    const output = await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations });
    const paragraphs = await bodyParagraphs(output);
    expect(paragraphs.map((paragraph) => paragraph.text)).toEqual(["Title", "", "Introduction and aims", "", "Method", "", "Boxed heading"]);
    expect(paragraphs[1]).toMatchObject({ rule: true, spaced: true });
    expect(paragraphs[3]).toMatchObject({ page: true });
    expect(paragraphs[5]).toMatchObject({ rule: true });
    const reopened = documentContentToProseMirrorJson((await docxLens.open(output)).projection) as DocumentJsonNode;
    expect(reopened.content?.map((node) => node.type)).toEqual(["paragraph", "horizontalRule", "paragraph", "pageBreak", "paragraph", "horizontalRule", "paragraph"]);
  });

  it("opens a Word section break as a section break and writes new ones as Word sections", async () => {
    const document = new docx.Document({
      sections: [
        { headers: { default: new docx.Header({ children: [new docx.Paragraph("Essay")] }) }, children: [new docx.Paragraph("Cover")] },
        { properties: { page: { size: { orientation: docx.PageOrientation.LANDSCAPE } } }, children: [new docx.Paragraph("Wide table"), new docx.Paragraph("After")] },
      ],
    });
    const opened = await docxLens.open(new Uint8Array(await docx.Packer.toBuffer(document)));
    const base = opened.projection;
    const json = documentContentToProseMirrorJson(base) as DocumentJsonNode;
    const types = json.content!.map((node) => node.type);
    expect(types.filter((type) => type === "sectionBreak").length).toBe(1);
    expect(docxProjectionFromContent({ ...base, tiptap: json, blocks: documentBlocksFromJson(json), nativeProjectionComplete: true }, base).operations).toEqual([]);

    // A new break between "Wide table" and "After" splits the landscape section.
    const at = json.content!.findIndex((node) => node.content?.[0]?.text === "After");
    json.content!.splice(at, 0, { type: "sectionBreak" });
    const { operations } = docxProjectionFromContent({ ...base, tiptap: json, blocks: documentBlocksFromJson(json), nativeProjectionComplete: true }, base);
    const output = await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations });
    const xml = await (await JSZip.loadAsync(output)).file("word/document.xml")!.async("string");
    const sections = xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/gu) ?? [];
    expect(sections.length).toBe(3);
    // The new section keeps the landscape page of the section it split.
    expect(sections[1]).toContain('w:orient="landscape"');
    const reopened = documentContentToProseMirrorJson((await docxLens.open(output)).projection) as DocumentJsonNode;
    expect(reopened.content!.filter((node) => node.type === "sectionBreak").length).toBe(2);

    // Deleting the first break joins the cover into the landscape section, as in Word.
    const reopenedBase = (await docxLens.open(output)).projection;
    const joined = documentContentToProseMirrorJson(reopenedBase) as DocumentJsonNode;
    joined.content!.splice(joined.content!.findIndex((node) => node.type === "sectionBreak"), 1);
    const deletion = docxProjectionFromContent({ ...reopenedBase, tiptap: joined, blocks: documentBlocksFromJson(joined), nativeProjectionComplete: true }, reopenedBase);
    const merged = await docxLens.mutate((await docxLens.open(output)).preservedCarry, { kind: "ai-edit", operations: deletion.operations });
    const mergedXml = await (await JSZip.loadAsync(merged)).file("word/document.xml")!.async("string");
    expect(mergedXml.match(/<w:sectPr[ >]/gu)?.length).toBe(2);
  });
});
