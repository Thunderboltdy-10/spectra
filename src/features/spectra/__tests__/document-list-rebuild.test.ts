import { describe, expect, it } from "vitest";
import { documentBlocksFromJson, documentContentToProseMirrorJson } from "../../../../shared/document-projection.mjs";

const item = (...content: unknown[]) => ({ type: "listItem", content: [{ type: "paragraph", content }] });
const text = (value: string, bold = false) => ({ type: "text", text: value, ...(bold ? { marks: [{ type: "bold" }] } : {}) });

describe("a document edit that adds a block the tree hasn't seen", () => {
  it("leaves the items of an unchanged list apart", () => {
    const list = {
      type: "bulletList",
      attrs: { blockId: "block-steps" },
      content: [item(text("Label axes: "), text("Price", true)), item(text("Draw supply and demand.")), item(text("Mark "), text("Qm", true))],
    };
    const tiptap = { type: "doc", content: [{ type: "paragraph", attrs: { blockId: "block-intro" }, content: [text("Intro")] }, list] };
    const blocks = [...documentBlocksFromJson(tiptap), { id: "block-new", type: "paragraph", text: "A new line" }];

    const next = documentContentToProseMirrorJson({ tiptap, blocks }) as { content: Array<{ type: string; content?: unknown[]; attrs?: { blockId?: string } }> };

    const kept = next.content.find((node) => node.attrs?.blockId === "block-steps");
    expect(kept?.content).toHaveLength(3);
    expect(next.content.map((node) => node.attrs?.blockId)).toEqual(["block-intro", "block-steps", "block-new"]);
  });

  it("still applies a real change to a block beside it", () => {
    const tiptap = { type: "doc", content: [{ type: "paragraph", attrs: { blockId: "block-intro" }, content: [text("Intro")] }] };
    const blocks = [{ id: "block-intro", type: "paragraph", text: "Changed" }, { id: "block-new", type: "paragraph", text: "A new line" }];

    const next = documentContentToProseMirrorJson({ tiptap, blocks });

    expect(documentBlocksFromJson(next).map((block: { text?: string }) => block.text)).toEqual(["Changed", "A new line"]);
  });
});
