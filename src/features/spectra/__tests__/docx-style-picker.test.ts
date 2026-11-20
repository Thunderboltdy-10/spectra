import { describe, expect, it } from "vitest";
import * as docx from "docx";
import { docxLens, docxProjectionReadbackDigest, docxProjectionSemanticDigest } from "../lenses/docx-lens";
import { docxProjectionFromContent, documentBlocksFromJson, documentContentToProseMirrorJson } from "../lenses/document-projection";
import { activeWordStyle, wordStyleOptions } from "../editor/word-style-options";

type JsonNode = { type: string; attrs?: Record<string, unknown>; content?: JsonNode[] };

async function styled() {
  const document = new docx.Document({
    sections: [{
      children: [
        new docx.Paragraph({ text: "Photosynthesis", heading: docx.HeadingLevel.HEADING_1 }),
        new docx.Paragraph({ text: "Figure 1: a leaf", style: "Caption" }),
        new docx.Paragraph({ text: "Plants make sugar from light." }),
      ],
    }],
  });
  return docxLens.open(new Uint8Array(await docx.Packer.toBuffer(document)));
}

describe("the style menu of a Word document", () => {
  it("offers Word's own styles in the order a writer reaches for them", async () => {
    const opened = await styled();
    const options = wordStyleOptions(opened.projection.styles);
    expect(options.slice(0, 5).map((option) => option.label)).toEqual(["Normal", "Title", "Heading 1", "Heading 2", "Heading 3"]);
    expect(options.find((option) => option.label === "Heading 1")).toMatchObject({ level: 1, styleId: "Heading1" });
    expect(activeWordStyle(options, { type: "heading", level: 2 })).toBe("word:Heading2");
    expect(activeWordStyle(options, { type: "paragraph", styleId: null })).toBe(options[0]!.value);
    expect(activeWordStyle(options, { type: "paragraph", styleId: "TOC1" })).toBeUndefined();
  });

  it("offers headings a blank file has not used yet", () => {
    const options = wordStyleOptions({ defaultStyleId: "Normal", paragraph: { Normal: { name: "Normal", role: "normal" } } });
    expect(options.map((option) => option.styleId)).toEqual(["Normal", "Heading1", "Heading2", "Heading3"]);
  });

  it("writes a style chosen in the editor, including back to body text, and reads it back", async () => {
    const opened = await styled();
    const json = documentContentToProseMirrorJson(opened.projection) as JsonNode;
    const [heading, caption, body] = json.content!;
    json.content = [
      { ...heading!, type: "paragraph", attrs: { blockId: heading!.attrs!.blockId } },
      { ...caption!, attrs: { ...caption!.attrs, styleId: "Normal" } },
      { ...body!, attrs: { ...body!.attrs, styleId: "Title" } },
    ];
    const update = docxProjectionFromContent({ ...opened.projection, blocks: documentBlocksFromJson(json) }, opened.projection);
    expect(update.operations.filter((operation) => operation.kind === "apply-style").map((operation) => (operation as { style: string }).style))
      .toEqual(["Normal", "Normal", "Title"]);
    const output = await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations: update.operations });
    const reopened = await docxLens.open(output);
    expect(reopened.projection.blocks.map((block) => [block.type, block.attrs?.styleId ?? null])).toEqual([
      ["paragraph", null], ["paragraph", null], ["paragraph", "Title"],
    ]);
    expect(await docxProjectionReadbackDigest(reopened.projection, update.projection)).toBe(await docxProjectionSemanticDigest(update.projection));
  });

  it("asks nothing of a body paragraph that stays body text", async () => {
    const opened = await styled();
    const json = documentContentToProseMirrorJson(opened.projection) as JsonNode;
    json.content![2] = { ...json.content![2]!, attrs: { ...json.content![2]!.attrs, styleId: "Normal" } };
    const update = docxProjectionFromContent({ ...opened.projection, blocks: documentBlocksFromJson(json) }, opened.projection);
    expect(update.operations).toEqual([]);
  });
});
