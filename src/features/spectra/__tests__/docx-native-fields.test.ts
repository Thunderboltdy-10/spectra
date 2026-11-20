import { describe, expect, it } from "vitest";
import * as docx from "docx";
import JSZip from "jszip";
import { docxLens, docxProjectionReadbackDigest, docxProjectionSemanticDigest } from "../lenses/docx-lens";
import { docxProjectionFromContent } from "../lenses/document-projection";
import { docxRichInlineToJson, documentRichInlineFromJson } from "../lenses/document-projection";

async function withFields() {
  const document = new docx.Document({
    sections: [{
      children: [
        new docx.Paragraph({ children: [new docx.TextRun("This is page "), new docx.TextRun({ children: [docx.PageNumber.CURRENT] }), new docx.TextRun(" of the essay.")] }),
        new docx.Paragraph({ children: [new docx.TextRun("See page "), new docx.PageReference("method"), new docx.TextRun(" for the method.")] }),
        new docx.Paragraph({ children: [new docx.Bookmark({ id: "method", children: [new docx.TextRun("Method")] })] }),
      ],
    }],
  });
  return new Uint8Array(await docx.Packer.toBuffer(document));
}

const fieldsOf = (blocks: ReadonlyArray<{ inlineContent?: ReadonlyArray<{ kind: string }> }>) =>
  blocks.flatMap((block) => (block.inlineContent ?? []).filter((item) => item.kind === "field")) as Array<{ kind: "field"; instruction: string; text: string; fieldId: string }>;

describe("Word fields Spectra does not model", () => {
  it("reads them as chips and leaves their paragraphs editable", async () => {
    const opened = await docxLens.open(await withFields());
    const [page, reference] = opened.projection.blocks;
    expect(page!.attrs?.nativeReadOnly).toBeUndefined();
    expect(reference!.attrs?.nativeReadOnly).toBeUndefined();
    expect(fieldsOf([page!]).map((field) => field.instruction)).toEqual(["PAGE"]);
    expect(fieldsOf([reference!])[0]?.instruction).toMatch(/^PAGEREF method/u);
    expect(opened.fidelityMap.entries.some((entry) => entry.feature === "field")).toBe(false);
  });

  it("writes an edit around a field and keeps the field exactly", async () => {
    const payload = await withFields();
    const opened = await docxLens.open(payload);
    const content = structuredClone(opened.projection);
    const target = content.blocks[0]!;
    const first = target.inlineContent![0]!;
    if (first.kind !== "text") throw new Error("expected text first");
    first.text = "You are reading page ";
    target.text = target.text.replace("This is page ", "You are reading page ");
    const update = docxProjectionFromContent(content, opened.projection);
    const requested = await docxProjectionSemanticDigest(update.projection);
    const output = await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations: update.operations });
    const reopened = await docxLens.open(output);
    expect(await docxProjectionReadbackDigest(reopened.projection, update.projection)).toBe(requested);
    expect(reopened.projection.blocks[0]!.text.startsWith("You are reading page ")).toBe(true);
    expect(fieldsOf([reopened.projection.blocks[0]!]).map((field) => field.instruction)).toEqual(["PAGE"]);
    const xml = await (await JSZip.loadAsync(output)).file("word/document.xml")!.async("string");
    expect(xml.match(/<w:instrText[^>]*>\s*PAGE\s*<\/w:instrText>/gu)).toHaveLength(1);
    expect(xml.includes("fieldRuns")).toBe(false);
  });

  it("survives the editor: a field node becomes the same atom again", async () => {
    const opened = await docxLens.open(await withFields());
    const content = opened.projection.blocks[0]!.inlineContent!;
    const json = docxRichInlineToJson(content, opened.projection.nativeBinding)!;
    expect(json.some((node) => node.type === "wordField")).toBe(true);
    const back = documentRichInlineFromJson({ type: "paragraph", content: json });
    expect(fieldsOf([{ inlineContent: back }])).toEqual(fieldsOf([{ inlineContent: content }]));
  });
});

describe("fields Spectra leaves read-only", () => {
  it("does not take a field whose run also holds the paragraph's words", async () => {
    const { Document } = await import("@ariadng/office/docx");
    const { parseXml } = await import("@ariadng/office/xml");
    const document = Document.create();
    const paragraph = document.addParagraph("placeholder").element;
    for (const child of [...paragraph.elements()]) if (child.localName === "r") paragraph.removeChild(child);
    const run = parseXml(`<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:t xml:space="preserve">Page </w:t><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>3</w:t><w:fldChar w:fldCharType="end"/></w:r>`).root;
    paragraph.appendChild(run);
    document._markMainDirty();
    const opened = await docxLens.open(await document.save());
    const block = opened.projection.blocks[0]!;
    expect(fieldsOf([block])).toEqual([]);
    expect(block.attrs?.nativeReadOnly).toBe(true);
  });
});
