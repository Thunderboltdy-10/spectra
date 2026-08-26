import { describe, expect, it } from "vitest";
import {
  blocksFromJson,
  documentJsonFromContent,
} from "../components/artifact-studio";
import { withDocumentFormatting } from "../components/document-studio";
import { docxProjectionFromContent } from "../lenses/document-projection";
import type { DocxProjection } from "../lenses/projection-contracts";
import {
  documentContentToProseMirrorJson,
  documentYjsAdapter,
} from "../work/models/yjs/document-adapter";

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

  it("keeps a Word outdent when the paragraph is edited for another reason", () => {
    // A Word style may put a heading out into the left margin. Reporting that as
    // indent level 0 would make the very next save pull it back in, so the sign
    // has to survive the trip through the editor's attributes.
    const json = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { blockId: "docx:paragraph:2", level: 1, indentLevel: -5 },
          content: [{ type: "text", text: "Complexity" }],
        },
        {
          type: "paragraph",
          attrs: { blockId: "docx:paragraph:3", indentLevel: 2 },
          content: [{ type: "text", text: "Body" }],
        },
      ],
    };
    const projected = withDocumentFormatting(
      {
        blocks: [
          { id: "docx:paragraph:2", type: "heading", text: "Complexity" },
          { id: "docx:paragraph:3", type: "paragraph", text: "Body" },
        ],
      },
      json,
    );
    const blocks = projected.blocks as {
      attrs?: { paragraphFormat?: { indentLevel?: number } };
    }[];
    expect(blocks[0]?.attrs?.paragraphFormat?.indentLevel).toBe(-5);
    expect(blocks[1]?.attrs?.paragraphFormat?.indentLevel).toBe(2);
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

  it("derives deletions and reorders when collaborative content has no explicit intent", () => {
    const base: DocxProjection = {
      blocks: [
        { id: "docx:paragraph:a", type: "paragraph", text: "A" },
        { id: "docx:paragraph:b", type: "paragraph", text: "B" },
        { id: "docx:paragraph:c", type: "paragraph", text: "C" },
      ],
      outline: [],
      nativeBinding: {
        version: 1,
        format: "docx",
        profile: "strict-native",
        macroEnabled: false,
        semanticDigest: "a".repeat(64),
        nativePlaceholders: [],
      },
    };
    const update = docxProjectionFromContent(
      {
        blocks: [base.blocks[2], base.blocks[0]],
        outline: [],
        nativeProjectionComplete: true,
      },
      base,
    );

    expect(update.projection.blocks.map((block) => block.id)).toEqual([
      "docx:paragraph:c",
      "docx:paragraph:a",
    ]);
    expect(update.operations).toContainEqual({
      kind: "delete-region",
      regionId: "docx:paragraph:b",
    });
    expect(update.operations).toContainEqual({
      kind: "reorder-regions",
      order: ["docx:paragraph:c", "docx:paragraph:a"],
    });
  });

  it("does not retain an earlier native intent inside collaborative state", () => {
    const document = documentYjsAdapter.createDocument({
      blocks: [{ id: "docx:paragraph:a", type: "paragraph", text: "A" }],
      nativeBinding: {
        version: 1,
        format: "docx",
        profile: "strict-native",
        macroEnabled: false,
        semanticDigest: "a".repeat(64),
        nativePlaceholders: [],
      },
      nativeIntent: {
        kind: "replace-paragraph",
        regionId: "docx:paragraph:a",
        text: "stale",
      },
    });

    expect(documentYjsAdapter.project(document)).not.toHaveProperty("nativeIntent");
  });
});
