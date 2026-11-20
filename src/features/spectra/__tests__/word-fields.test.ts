import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { exportDocxCopy } from "../lenses/docx-adapter";
import { docxLens, docxProjectionReadbackDigest, docxProjectionSemanticDigest, docxReadbackDifference } from "../lenses/docx-lens";
import { docxProjectionFromContent, documentBlocksFromJson, documentContentToProseMirrorJson } from "../lenses/document-projection";
import { wordSeqField, wordTocField } from "../editor/word-fields";
import { spectraLookCatalogue } from "../lenses/spectra-word-styles";

type JsonNode = { type: string; attrs?: Record<string, unknown>; content?: JsonNode[]; text?: string };
const paragraph = (text: string): JsonNode => ({ type: "paragraph", content: [{ type: "text", text }] });

function caption(number: number, id: string): JsonNode {
  return {
    type: "paragraph",
    attrs: { styleId: "Caption" },
    content: [
      { type: "text", text: "Figure " },
      { type: "wordField", attrs: { native: wordSeqField("Figure", number, id) } },
      { type: "text", text: ": a leaf in light" },
    ],
  };
}

describe("a caption added in Spectra, in Word", () => {
  it("is Word's Caption style with a SEQ field holding its number, and reads back the same", async () => {
    const { bytes } = await exportDocxCopy({ type: "doc", content: [paragraph("Leaves take in light.")] }, { styles: spectraLookCatalogue("essay") });
    const opened = await docxLens.open(bytes, "strict-native");
    const json = documentContentToProseMirrorJson(opened.projection) as { type: string; content: JsonNode[] };
    json.content = [...json.content, caption(1, "caption-new-1")];
    const update = docxProjectionFromContent({ ...opened.projection, blocks: documentBlocksFromJson(json as never) }, opened.projection);
    const output = new Uint8Array(await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations: update.operations }));

    const xml = await (await JSZip.loadAsync(output)).file("word/document.xml")!.async("string");
    expect(xml).toMatch(/<w:pStyle w:val="Caption"\/>/u);
    expect(xml).toMatch(/<w:fldSimple w:instr=" SEQ Figure \\\* ARABIC "><w:r><w:rPr><w:noProof\/><\/w:rPr><w:t>1<\/w:t><\/w:r><\/w:fldSimple>/u);

    const reopened = await docxLens.open(output, "strict-native");
    const block = reopened.projection.blocks.at(-1)!;
    expect(block.text).toBe("Figure 1: a leaf in light");
    expect(block.inlineContent?.find((item) => item.kind === "field")).toMatchObject({ instruction: "SEQ Figure \\* ARABIC", text: "1" });
    const requested = await docxProjectionSemanticDigest(update.projection);
    const readback = await docxProjectionReadbackDigest(reopened.projection, update.projection);
    expect(requested === readback ? null : await docxReadbackDifference(reopened.projection, update.projection)).toBeNull();
  });

  it("writes Word's own table of contents, marked for Word to rebuild, and reads it back", async () => {
    const heading = (text: string, level: number): JsonNode => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
    const { bytes } = await exportDocxCopy({ type: "doc", content: [heading("Introduction", 1), paragraph("Light."), heading("Method", 2)] });
    const opened = await docxLens.open(bytes, "strict-native");
    const json = documentContentToProseMirrorJson(opened.projection) as { type: string; content: JsonNode[] };
    const toc = wordTocField([{ title: "Introduction", level: 1 }, { title: "Method", level: 2 }], "toc-new");
    json.content = [{ type: "paragraph", content: [{ type: "wordField", attrs: { native: toc } }] }, ...json.content];
    const update = docxProjectionFromContent({ ...opened.projection, blocks: documentBlocksFromJson(json as never) }, opened.projection);
    const output = new Uint8Array(await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations: update.operations }));
    const xml = await (await JSZip.loadAsync(output)).file("word/document.xml")!.async("string");
    expect(xml).toContain('w:dirty="true"');
    expect(xml).toContain(String.raw`w:instr=" TOC \o &quot;1-3&quot; \h \z \u "`);
    const reopened = await docxLens.open(output, "strict-native");
    expect(reopened.projection.blocks[0]!.inlineContent?.[0]).toMatchObject({ kind: "field", text: "Introduction\nMethod" });
    const requested = await docxProjectionSemanticDigest(update.projection);
    const readback = await docxProjectionReadbackDigest(reopened.projection, update.projection);
    expect(requested === readback ? null : await docxReadbackDifference(reopened.projection, update.projection)).toBeNull();
  });
});
