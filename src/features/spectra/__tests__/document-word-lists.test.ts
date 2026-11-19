import { describe, expect, it } from "vitest";
import { documentJsonFromContent } from "../components/artifact-studio";
import { documentContentToProseMirrorJson } from "../lenses/document-projection";

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
const shape = (json: { content?: Array<{ type?: string; attrs?: Record<string, unknown> }> }) =>
  json.content?.map((node) => [node.type, node.attrs?.start ?? null, node.attrs?.type ?? null, node.attrs?.listLevel ?? null]);
const expected = [
  ["orderedList", 1, null, null],
  ["orderedList", 2, null, null],
  ["orderedList", 1, "a", 1],
  ["orderedList", 3, null, null],
  ["bulletList", null, null, null],
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
});
