import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { exportDocxCopy } from "../lenses/docx-adapter";
import { docxLens } from "../lenses/docx-lens";
import { docxProjectionFromContent, documentBlocksFromJson, documentContentToProseMirrorJson } from "../lenses/document-projection";

const W14 = "http://schemas.microsoft.com/office/word/2010/wordml";
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

async function documentXml(bytes: Uint8Array) {
  return (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
}

function expectDeclaredOnce(xml: string) {
  expect(xml).not.toMatch(/xmlns:ns\d+=/u);
  expect(xml).not.toMatch(/\sns\d+:paraId=/u);
  expect(xml.split(`xmlns:w14="${W14}"`)).toHaveLength(2);
  expect(xml).toMatch(/<w:document[^>]*xmlns:w14=/u);
  expect(xml).toMatch(/mc:Ignorable="[^"]*\bw14\b/u);
  expect(xml).toMatch(/w14:paraId="[0-9A-F]{8}"/u);
}

describe("Word 2010 paragraph ids", () => {
  it("are declared once on the document, not on every paragraph", async () => {
    const { bytes } = await exportDocxCopy({ type: "doc", content: [paragraph("One"), paragraph("Two")] });
    expectDeclaredOnce(await documentXml(bytes));
  });

  it("stay declared once after the lens inserts paragraphs", async () => {
    const { bytes } = await exportDocxCopy({ type: "doc", content: [paragraph("One")] });
    const opened = await docxLens.open(bytes, "strict-native");
    const json = documentContentToProseMirrorJson(opened.projection) as { type: string; content: Array<Record<string, unknown>> };
    json.content = [...json.content, paragraph("Two"), paragraph("Three")];
    const update = docxProjectionFromContent({ ...opened.projection, blocks: documentBlocksFromJson(json) }, opened.projection);
    expect(update.operations.length).toBeGreaterThan(0);
    const output = await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations: update.operations }, {});
    const xml = await documentXml(new Uint8Array(output));
    expectDeclaredOnce(xml);
    const reopened = await docxLens.open(new Uint8Array(output), "strict-native");
    expect(reopened.projection.blocks.map((block) => block.text)).toEqual(["One", "Two", "Three"]);
  });
});
