import { describe, expect, it } from "vitest";
import {
  blocksFromJson,
  documentJsonFromContent,
} from "../components/artifact-studio";
import { withDocumentFormatting } from "../components/document-studio";
import {
  compactDocxProjectionForStorage,
  docxProjectionFromContent,
  documentBlocksFromJson,
} from "../lenses/document-projection";
import { authoredSemanticsEqual } from "../../../../shared/document-projection.mjs";
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
    expect(json.content?.map((node) => [node.type, node.attrs?.level])).toEqual(
      [
        ["heading", 1],
        ["heading", 2],
      ],
    );
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

  it("adopts Word-only trailing paragraphs instead of remapping the stale TipTap tree", () => {
    const content = {
      blocks: [
        {
          id: "docx:paragraph:one",
          type: "paragraph",
          text: "Spectra paragraph",
        },
        {
          id: "docx:paragraph:native",
          type: "paragraph",
          text: "RCV1WORDNATIVE3",
        },
      ],
      tiptap: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { blockId: "docx:paragraph:one" },
            content: [{ type: "text", text: "Spectra paragraph" }],
          },
        ],
      },
    };
    const yjsJson = documentContentToProseMirrorJson(content);
    expect(yjsJson.content?.map((node) => node.attrs?.blockId)).toEqual([
      "docx:paragraph:one",
      "docx:paragraph:native",
    ]);
    expect(documentJsonFromContent(content, "fixture").content?.at(-1)).toMatchObject({
      attrs: { blockId: "docx:paragraph:native" },
    });
    expect(
      JSON.stringify(documentJsonFromContent(content, "fixture")),
    ).toContain("RCV1WORDNATIVE3");
  });

  it("applies table-cell and paragraph mutations onto a stale TipTap tree", () => {
    const json = documentContentToProseMirrorJson({
      blocks: [
        {
          id: "docx:paragraph:one",
          type: "paragraph",
          text: "Spectra later",
        },
        {
          id: "docx:table:1",
          type: "table",
          text: "Spectra cell | B",
          rows: [["Spectra cell", "B"]],
        },
      ],
      tiptap: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { blockId: "docx:paragraph:one" },
            content: [{ type: "text", text: "Complexity" }],
          },
          {
            type: "table",
            attrs: { blockId: "docx:table:1" },
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableHeader",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "Old" }],
                      },
                    ],
                  },
                  {
                    type: "tableHeader",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "B" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(json.content?.[0]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "Spectra later" }],
    });
    expect(json.content?.[1]?.content?.[0]?.content?.[0]).toMatchObject({
      type: "tableHeader",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Spectra cell" }],
        },
      ],
    });
  });

  it("carries ordered OMML, native media, and rich table cells through both editor paths", () => {
    const content = {
      nativeBinding: {
        version: 1,
        format: "docx",
        profile: "strict-native",
        macroEnabled: false,
        semanticDigest: "a".repeat(64),
        nativePlaceholders: [],
        sourceArtifactId: "artifact-rich-docx",
        sourcePayloadHash: "b".repeat(64),
      },
      blocks: [
        {
          id: "docx:paragraph:rich",
          type: "paragraph",
          text: "Let x^{2} finish.",
          inlineContent: [
            { kind: "text", text: "Let " },
            { kind: "equation", latex: "x^{2}", display: "inline" },
            { kind: "text", text: " finish. " },
            {
              kind: "image",
              partName: "/word/media/image1.png",
              mediaType: "image/png",
              altText: "Cover",
              widthEmu: 3_048_000,
              heightEmu: 1_524_000,
              placement: "inline",
            },
          ],
          attrs: { nativeReadOnly: true },
        },
        {
          id: "docx:table:rich",
          type: "table",
          text: "Term x_1 | Meaning",
          rows: [["Term x_1", "Meaning"]],
          richRows: [
            [
              [
                { kind: "text", text: "Term " },
                { kind: "equation", latex: "x_1", display: "inline" },
              ],
              [{ kind: "text", text: "Meaning" }],
            ],
          ],
          attrs: { nativeReadOnly: true },
        },
      ],
    };

    const direct = documentJsonFromContent(content, "fixture");
    expect(direct.content?.[0]?.content?.map((node) => node.type)).toEqual([
      "text",
      "inlineEquation",
      "text",
      "nativeDocxImage",
    ]);
    const image = direct.content?.[0]?.content?.[3];
    expect(image?.attrs?.src).toContain("/api/spectra/lenses/docx/media?");
    expect(image?.attrs?.src).toContain("artifactId=artifact-rich-docx");
    expect(image?.attrs?.src).not.toContain("base64");
    expect(
      direct.content?.[1]?.content?.[0]?.content?.[0]?.content?.[0]?.content?.map(
        (node) => node.type,
      ),
    ).toEqual(["text", "inlineEquation"]);

    const yjsJson = documentContentToProseMirrorJson(content);
    expect(yjsJson).toEqual(direct);
    const projected = documentYjsAdapter.project(
      documentYjsAdapter.createDocument(content),
    );
    expect(projected.blocks?.[0]).toMatchObject({
      id: "docx:paragraph:rich",
      inlineContent: [
        { kind: "text", text: "Let " },
        { kind: "equation", latex: "x^{2}", display: "inline" },
        { kind: "text", text: " finish. " },
        {
          kind: "image",
          partName: "/word/media/image1.png",
          mediaType: "image/png",
          altText: "Cover",
        },
      ],
    });
    expect(projected.blocks?.[1]).toMatchObject({
      id: "docx:table:rich",
      richRows: [
        [
          [
            { kind: "text", text: "Term " },
            { kind: "equation", latex: "x_1", display: "inline" },
          ],
          [{ kind: "text", text: "Meaning" }],
        ],
      ],
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

  it("retains invisible native trailing whitespace while deriving a real prose edit", () => {
    const base: DocxProjection = {
      blocks: [
        {
          id: "docx:paragraph:editable",
          type: "paragraph",
          text: "Editable paragraph ",
        },
        {
          id: "docx:paragraph:protected",
          type: "paragraph",
          text: "Protected equation context \n  ",
          attrs: { nativeReadOnly: true },
        },
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
        blocks: [
          { ...base.blocks[0], text: "Edited paragraph" },
          { ...base.blocks[1], text: "Protected equation context" },
        ],
        nativeProjectionComplete: true,
      },
      base,
    );

    expect(update.projection.blocks[1]?.text).toBe(
      "Protected equation context \n  ",
    );
    expect(update.operations).toEqual([
      {
        kind: "replace-paragraph",
        regionId: "docx:paragraph:editable",
        text: "Edited paragraph",
      },
    ]);
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

    expect(documentYjsAdapter.project(document)).not.toHaveProperty(
      "nativeIntent",
    );
  });

  it("opens an unactivated native document from its freshly read projection", () => {
    const base: DocxProjection = {
      blocks: [{ id: "docx:paragraph:a", type: "paragraph", text: "Native" }],
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

    expect(docxProjectionFromContent(null, base)).toEqual({
      projection: base,
      operations: [],
    });
  });

  it("compacts safe equation metadata without discarding unsafe native OMML", () => {
    const projection: DocxProjection = {
      blocks: [
        {
          id: "docx:paragraph:equations",
          type: "paragraph",
          text: "x+1 and x\\ne",
          inlineContent: [
            {
              kind: "equation",
              latex: "x+1",
              display: "inline",
              ommlXml: "<m:oMath><m:r><m:t>x+1</m:t></m:r></m:oMath>",
              ommlSourceLatex: "x+1",
            },
            { kind: "text", text: " and " },
            {
              kind: "equation",
              latex: "x\\frobnicate y",
              display: "inline",
              ommlXml: "<m:oMath><m:r><m:t>x≠y</m:t></m:r></m:oMath>",
              ommlSourceLatex: "x\\frobnicate y",
            },
          ],
        },
        {
          id: "docx:equation:block",
          type: "equation",
          text: "x+1",
          latex: "x+1",
          inlineContent: [
            {
              kind: "equation",
              latex: "x+1",
              display: "block",
              ommlXml: "<m:oMath><m:r><m:t>x+1</m:t></m:r></m:oMath>",
              ommlSourceLatex: "x+1",
            },
          ],
        },
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

    const compact = compactDocxProjectionForStorage(projection);
    const inlines = compact.blocks[0]?.inlineContent ?? [];
    expect(inlines[0]).toEqual({
      kind: "equation",
      latex: "x+1",
      display: "inline",
    });
    expect(inlines[2]).toMatchObject({
      kind: "equation",
      latex: "x\\frobnicate y",
      ommlXml: "<m:oMath><m:r><m:t>x≠y</m:t></m:r></m:oMath>",
    });
    expect(compact.blocks[1]).not.toHaveProperty("latex");
    expect(compact.blocks[1]?.inlineContent?.[0]).toEqual({
      kind: "equation",
      latex: "x+1",
      display: "block",
    });
  });

  // Word reads a cell's runs back as one line; the editor must too, or every
  // save of a table with an inline equation fails its readback.
  it("reads the runs of a table cell on one line, inline equations included", () => {
    const [table] = documentBlocksFromJson({
      type: "doc",
      content: [{
        type: "table",
        content: [{
          type: "tableRow",
          content: [{
            type: "tableCell",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Order of " }, { type: "inlineEquation", attrs: { latex: "x^2" } }] },
              { type: "paragraph", content: [{ type: "text", text: "Second line" }] },
            ],
          }],
        }],
      }],
    });
    expect(table?.rows).toEqual([["Order of x^2\nSecond line"]]);
  });

  it("treats a heading level that matches its Word style as derived, not authored", () => {
    const reopened = { type: "heading", text: "Results", attrs: { styleId: "Heading1" } };
    expect(authoredSemanticsEqual({ ...reopened, attrs: { styleId: "Heading1", level: 1 } }, reopened)).toBe(true);
    expect(authoredSemanticsEqual({ ...reopened, attrs: { styleId: "Heading1", level: 2 } }, reopened)).toBe(false);
  });
});
