import { describe, expect, it } from "vitest";
import { documentJsonFromContent } from "../components/artifact-studio";
import { documentBlocksFromJson, documentContentToProseMirrorJson, type DocumentJsonNode } from "../lenses/document-projection";

const item = (id: string, text: string, list: Record<string, unknown>) => ({
  id, type: "list", text,
  inlineContent: [{ kind: "text", text }],
  attrs: { list: { numId: "2", level: 0, format: "decimal", text: "%1.", start: 1, isBullet: false, ...list } },
});
const blocks = [
  item("docx:paragraph:00000001", "One", {}),
  item("docx:paragraph:00000002", "Two", {}),
  item("docx:paragraph:00000003", "Two a", { level: 1, format: "lowerLetter" }),
  item("docx:paragraph:00000004", "Three", {}),
  { id: "docx:paragraph:00000005", type: "list", text: "Dot", inlineContent: [{ kind: "text", text: "Dot" }], attrs: { list: { numId: "3", level: 0, isBullet: true } } },
];
type Node = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: Node[] };
/** Lists as [type, start, numbering, level, items]; items as [id, text, ...nested lists]. */
const outline = (node: Node): unknown => node.type === "listItem"
  ? [node.attrs?.blockId ?? null, node.content?.[0]?.content?.[0]?.text ?? "", ...(node.content ?? []).slice(1).map(outline)]
  : [node.type, node.attrs?.start ?? null, node.attrs?.type ?? null, node.attrs?.listLevel ?? null, (node.content ?? []).map(outline)];
const shape = (json: Node) => json.content?.map(outline);
// One Word list is one list node: "Two a" nests under "Two", and "Three" counts on as 3.
const expected = [
  ["orderedList", 1, null, null, [
    [null, "One"],
    ["docx:paragraph:00000002", "Two", ["orderedList", 1, "a", null, [["docx:paragraph:00000003", "Two a"]]]],
    ["docx:paragraph:00000004", "Three"],
  ]],
  ["bulletList", null, null, null, [[null, "Dot"]]],
];

describe("Word numbered lists open numbered on every path", () => {
  it("from the projection alone", () => {
    expect(shape(documentContentToProseMirrorJson({ blocks }))).toEqual(expected);
  });

  it("from the projection beside editor JSON that no longer mirrors it", () => {
    const tiptap = { type: "doc", content: blocks.map((block) => ({ type: "bulletList", attrs: { blockId: block.id }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "stale" }] }] }] })) };
    expect(shape(documentContentToProseMirrorJson({ blocks, tiptap }))).toEqual(expected);
  });

  it("in the studio's first paint, with and without editor JSON", () => {
    expect(shape(documentJsonFromContent({ blocks }, "Worksheet") as never)).toEqual(expected);
    const tiptap = documentContentToProseMirrorJson({ blocks });
    expect(shape(documentJsonFromContent({ blocks, tiptap }, "Worksheet") as never)).toEqual(expected);
  });

  it("reads every grouped item back as its own Word paragraph", () => {
    const json = documentContentToProseMirrorJson({ blocks }) as DocumentJsonNode;
    expect(documentBlocksFromJson(json).map((block) => [block.id, block.text])).toEqual(blocks.map((block) => [block.id, block.text]));
  });
});
