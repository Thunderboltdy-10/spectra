import { describe, expect, it } from "vitest";
import { documentContentFromJson } from "../components/document-content";

describe("document content conversion without a studio", () => {
  it("preserves formatting, native extensions and rich editor nodes", () => {
    const previous = {
      pageSetup: { orientation: "landscape", margins: "narrow" },
      references: [{ id: "source-1", title: "Primary source" }],
      customExtension: { retained: true },
    };
    const json = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, blockId: "heading" }, content: [{ type: "text", text: "Overview" }] },
        { type: "paragraph", attrs: { blockId: "body" }, content: [
          { type: "text", text: "Important ", marks: [{ type: "bold" }] },
          { type: "inlineEquation", attrs: { latex: "x+1" } },
          { type: "image", attrs: { src: "/api/spectra/assets/content?assetId=image-1", assetId: "image-1" } },
        ] },
      ],
    };
    const converted = documentContentFromJson(json, previous);
    expect(converted).toMatchObject(previous);
    expect(converted.tiptap).toBe(json);
    expect(converted.blocks[0]).toMatchObject({ id: "heading", type: "heading", text: "Overview" });
    expect(converted.outline).toEqual([{ id: "heading", title: "Overview", level: 1 }]);
    expect(previous).not.toHaveProperty("blocks");
  });

  it("keeps explicit native deletion intent when a document becomes shorter", () => {
    const previous = {
      blocks: [
        { id: "docx:paragraph:a", type: "paragraph", text: "A" },
        { id: "docx:paragraph:b", type: "paragraph", text: "B" },
      ],
      nativeBinding: {
        version: 1, format: "docx", profile: "strict-native", macroEnabled: false,
        semanticDigest: "a".repeat(64), nativePlaceholders: [],
      },
    };
    const converted = documentContentFromJson({
      type: "doc",
      content: [{ type: "paragraph", attrs: { blockId: "docx:paragraph:a" }, content: [{ type: "text", text: "A" }] }],
    }, previous);
    expect(converted.blocks).toHaveLength(1);
    expect(Reflect.get(converted, "nativeBinding")).toBe(previous.nativeBinding);
    expect(converted.nativeProjectionComplete).toBe(true);
    expect(JSON.stringify(converted.nativeIntent)).toContain("docx:paragraph:b");
    expect(JSON.stringify(converted.nativeIntent)).toContain("delete-region");
  });

  it("keeps the existing empty-document fallback and clears the outline", () => {
    const json = { type: "doc", content: [] };
    expect(documentContentFromJson(json, { outline: [{ title: "Old heading" }] })).toMatchObject({
      tiptap: json,
      blocks: [{ id: "intro", type: "paragraph", text: "" }],
      outline: [],
    });
  });
});
