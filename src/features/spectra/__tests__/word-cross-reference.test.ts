import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { exportDocxCopy } from "../lenses/docx-adapter";
import { docxLens, docxProjectionReadbackDigest, docxProjectionSemanticDigest, docxReadbackDifference } from "../lenses/docx-lens";
import { docxProjectionFromContent, documentBlocksFromJson, documentContentToProseMirrorJson } from "../lenses/document-projection";
import { crossReferenceAnchor } from "../lenses/word-bookmarks";

type JsonNode = { type: string; attrs?: Record<string, unknown>; content?: JsonNode[]; text?: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }> };
const heading = (text: string, blockId: string): JsonNode => ({ type: "heading", attrs: { level: 1, blockId }, content: [{ type: "text", text }] });
const reference = (text: string, blockId: string): JsonNode => ({ type: "text", text, marks: [{ type: "link", attrs: { href: `#${crossReferenceAnchor(blockId)}` } }] });

async function documentXml(bytes: Uint8Array) {
  return (await JSZip.loadAsync(bytes)).file("word/document.xml")!.async("string");
}

describe("a cross-reference to a heading, in Word", () => {
  it("exports as a link to a bookmark Spectra puts on the heading", async () => {
    const { bytes } = await exportDocxCopy({ type: "doc", content: [
      heading("Method", "block-method"),
      { type: "paragraph", attrs: { blockId: "block-p" }, content: [{ type: "text", text: "See " }, reference("Method", "block-method"), { type: "text", text: "." }] },
    ] });
    const xml = await documentXml(bytes);
    const name = crossReferenceAnchor("block-method");
    expect(xml).toContain(`w:anchor="${name}"`);
    expect(xml).toMatch(new RegExp(String.raw`<w:bookmarkStart w:id="\d+" w:name="${name}"/>[\s\S]*Method[\s\S]*<w:bookmarkEnd`, "u"));
    const opened = await docxLens.open(bytes, "strict-native");
    const linked = opened.projection.blocks[1]!.inlineContent?.find((item) => item.kind === "text" && item.href);
    expect(linked).toMatchObject({ text: "Method", href: `#${name}` });
  });

  it("saved into a Word file, links to an existing heading and to one added in the same save, and reads back", async () => {
    const { bytes } = await exportDocxCopy({ type: "doc", content: [heading("Results", "r"), { type: "paragraph", content: [{ type: "text", text: "Body." }] }] });
    const opened = await docxLens.open(bytes, "strict-native");
    const json = documentContentToProseMirrorJson(opened.projection) as { type: string; content: JsonNode[] };
    const resultsId = String(json.content[0]!.attrs!.blockId);
    json.content.push(heading("Discussion", "block-new-discussion"));
    json.content.push({ type: "paragraph", content: [{ type: "text", text: "As in " }, reference("Results", resultsId), { type: "text", text: " and " }, reference("Discussion", "block-new-discussion"), { type: "text", text: "." }] });
    const update = docxProjectionFromContent({ ...opened.projection, blocks: documentBlocksFromJson(json as never) }, opened.projection);
    const output = new Uint8Array(await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations: update.operations }));
    const xml = await documentXml(output);
    for (const id of [resultsId, "block-new-discussion"]) {
      const name = crossReferenceAnchor(id);
      expect(xml).toContain(`w:anchor="${name}"`);
      expect(xml).toContain(`w:name="${name}"`);
    }
    const reopened = await docxLens.open(output, "strict-native");
    const requested = await docxProjectionSemanticDigest(update.projection);
    const readback = await docxProjectionReadbackDigest(reopened.projection, update.projection);
    expect(requested === readback ? null : await docxReadbackDifference(reopened.projection, update.projection)).toBeNull();

    // Saving again leaves the bookmarks as they are.
    const json2 = documentContentToProseMirrorJson(reopened.projection) as { type: string; content: JsonNode[] };
    json2.content.push({ type: "paragraph", content: [{ type: "text", text: "More." }] });
    const update2 = docxProjectionFromContent({ ...reopened.projection, blocks: documentBlocksFromJson(json2 as never) }, reopened.projection);
    const output2 = new Uint8Array(await docxLens.mutate(reopened.preservedCarry, { kind: "ai-edit", operations: update2.operations }));
    expect((await documentXml(output2)).match(/<w:bookmarkStart/gu)?.length).toBe(2);
  });

  it("an in-document link a stored copy never knew does not count as an edit", async () => {
    const { bytes } = await exportDocxCopy({ type: "doc", content: [
      heading("Aim", "aim"),
      { type: "paragraph", attrs: { blockId: "p" }, content: [{ type: "text", text: "See " }, reference("Aim", "aim")] },
      { type: "paragraph", attrs: { blockId: "q" }, content: [{ type: "text", text: "Other." }] },
    ] });
    const opened = await docxLens.open(bytes, "strict-native");
    const json = documentContentToProseMirrorJson(opened.projection) as { type: string; content: JsonNode[] };
    // Content written before links to bookmarks were read: the same words, no link.
    for (const node of json.content[1]!.content ?? []) delete node.marks;
    json.content[2]!.content = [{ type: "text", text: "Other, edited." }];
    const update = docxProjectionFromContent({ ...opened.projection, blocks: documentBlocksFromJson(json as never) }, opened.projection);
    expect(update.operations.map((operation) => "regionId" in operation ? operation.regionId : operation.kind)).toEqual([opened.projection.blocks[2]!.id]);
  });
});
