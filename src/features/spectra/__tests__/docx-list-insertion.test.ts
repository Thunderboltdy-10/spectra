import { expect, it } from "vitest";
import { Document } from "@ariadng/office/docx";
import { docxLens, docxProjectionReadbackDigest, docxProjectionSemanticDigest } from "../lenses/docx-lens";
import { docxProjectionFromContent } from "../lenses/document-projection";

const item = (text: string, marks?: { type: string }[]) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text, ...(marks ? { marks } : {}) }] }] });

it("writes a new numbered list into Word and reads them back as authored", async () => {
  const source = Document.create();
  source.addParagraph("Existing paragraph.");
  const opened = await docxLens.open(await source.save(), "strict-native");
  const existing = opened.projection.blocks[0]!;
  const content = {
    nativeProjectionComplete: true,
    blocks: [
      { id: existing.id, type: "paragraph", text: existing.text },
      { id: "new-list", type: "list", text: "First sourceSecond source" },
    ],
    tiptap: { type: "doc", content: [{ type: "orderedList", attrs: { blockId: "new-list" },
      content: [item("First source", [{ type: "italic" }]), item("Second source")] }] },
  };
  const { projection, operations } = docxProjectionFromContent(content, opened.projection);
  expect(projection.blocks.map((block) => [block.type, block.text])).toEqual([
    ["paragraph", "Existing paragraph."], ["list", "First source"], ["list", "Second source"]]);
  const output = await docxLens.mutate(opened.preservedCarry, { kind: "ai-edit", operations });
  const reopened = await docxLens.open(output, "strict-native");
  const lists = reopened.projection.blocks.filter((block) => block.type === "list");
  expect(lists).toHaveLength(2);
  // Both items belong to one Word list, so it numbers 1, 2 rather than 1, 1.
  expect(new Set(lists.map((block) => (block.attrs?.list as { numId: string }).numId)).size).toBe(1);
  expect(await docxProjectionReadbackDigest(reopened.projection, projection)).toBe(await docxProjectionSemanticDigest(projection));
});
