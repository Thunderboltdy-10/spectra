import { describe, expect, it } from "vitest";
import {
  blocksFromJson,
  documentJsonFromContent,
} from "../components/artifact-studio";
import { documentContentToProseMirrorJson } from "../work/models/yjs/document-adapter";

describe("native document projection", () => {
  it("projects persisted Word heading styles back into TipTap headings", () => {
    const content = {
      blocks: [
        {
          id: "docx:paragraph:one",
          type: "heading",
          text: "Heading one",
          attrs: { styleId: "Heading1" },
        },
        {
          id: "docx:paragraph:two",
          type: "heading",
          text: "Heading two",
          attrs: { styleId: "Heading2" },
        },
      ],
    };
    const json = documentJsonFromContent(content, "fixture");
    expect(json.content?.map((node) => [node.type, node.attrs?.level])).toEqual([
      ["heading", 1],
      ["heading", 2],
    ]);
  });

  it("repairs stale persisted TipTap paragraphs from native Word styles", () => {
    const content = {
      blocks: [
        {
          id: "docx:paragraph:one",
          type: "heading",
          text: "Heading one",
          attrs: { styleId: "Heading1" },
        },
      ],
      tiptap: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { blockId: "docx:paragraph:one" },
            content: [{ type: "text", text: "Heading one" }],
          },
        ],
      },
    };
    const json = documentJsonFromContent(content, "fixture");
    expect(json.content?.[0]?.type).toBe("heading");
    expect(json.content?.[0]?.attrs?.level).toBe(1);
  });

  it("keeps a heading style id when converting the editor back to semantic blocks", () => {
    const blocks = blocksFromJson({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 3, blockId: "docx:paragraph:three" },
          content: [{ type: "text", text: "Heading three" }],
        },
      ],
    });
    expect(blocks[0]).toMatchObject({
      id: "docx:paragraph:three",
      type: "heading",
      attrs: { level: 3, styleId: "Heading3" },
    });
  });

  it("repairs stale native heading nodes before a Yjs document is initialized", () => {
    const json = documentContentToProseMirrorJson({
      blocks: [
        {
          id: "docx:paragraph:one",
          type: "heading",
          text: "Heading one",
          attrs: { styleId: "Heading1" },
        },
      ],
      tiptap: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { blockId: "docx:paragraph:one" },
            content: [{ type: "text", text: "Heading one" }],
          },
        ],
      },
    });
    expect(json.content?.[0]).toMatchObject({
      type: "heading",
      attrs: { blockId: "docx:paragraph:one", level: 1 },
    });
  });
});
