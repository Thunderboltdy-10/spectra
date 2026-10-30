import { expect, it } from "vitest";
import { documentPerformancePreview } from "../collaboration/document-performance-preview";
import { documentBlocksFromJson, type DocumentJsonNode } from "../lenses/document-projection";

it("shows only the blocks reached by the performance, preserving rich subtrees and the saved value", () => {
  const tiptap: DocumentJsonNode = { type: "doc", content: [
    { type: "paragraph", attrs: { blockId: "first" }, content: [{ type: "text", text: "First finished line." }] },
    { type: "bulletList", attrs: { blockId: "list" }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Rich item", marks: [{ type: "bold" }] }] }] }] },
    { type: "paragraph", attrs: { blockId: "future" }, content: [{ type: "text", text: "Not reached." }] },
  ] };
  const blocks = documentBlocksFromJson(tiptap);
  const staged = { tiptap, blocks: [{ ...blocks[0], text: "First fi" }, blocks[1]] };
  const original = structuredClone(staged);
  const preview = documentPerformancePreview(staged).tiptap as DocumentJsonNode;
  expect(preview.content).toHaveLength(2);
  expect(preview.content?.[0]?.content?.[0]?.text).toBe("First fi");
  expect(preview.content?.[1]).toEqual(tiptap.content?.[1]);
  expect(staged).toEqual(original);
  expect((documentPerformancePreview({ tiptap, blocks: [] }).tiptap as DocumentJsonNode).content).toEqual([]);
});
