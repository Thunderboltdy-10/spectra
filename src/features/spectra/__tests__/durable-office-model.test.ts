import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { boundedArtifactRead } from "../ai/bounded-artifact-read";
import { encodeSheetCellsForStorage } from "../../../../shared/sheet-cells";
import { initializeNativeArtifactDocument, nativeArtifactProjection } from "../../../../scripts/collaboration-native-projection.mjs";
import { docxProjectionFromContent } from "../lenses/document-projection";
import type { DocxProjection } from "../lenses/projection-contracts";

describe("large Office model boundaries", () => {
  it("bounds multibyte model context while retaining a requested distant cell and cached formula truth", () => {
    const cells = Object.fromEntries(Array.from({ length: 2000 }, (_, index) => [`A${index + 1}`, { value: "é".repeat(60) }]));
    cells.P9996 = { value: "target" };
    const artifact = { id: "work", blueprintKey: "sheets", content: { sheets: [{ id: "sheet", name: "Dense", cells: encodeSheetCellsForStorage({ ...cells, T10000: { formula: "=UNSUPPORTED(A1)", value: 42, cachedValue: 42 } }) }] } };
    const before = JSON.stringify(artifact);
    const result = boundedArtifactRead(artifact, { prompt: "Set P9996; inspect T10000" });
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(64 * 1024);
    expect(result).toMatchObject({ contentCoverage: { complete: false }, content: { sheets: [{ totalCellCount: 2002, cells: { P9996: { value: "target" }, T10000: { formula: "=UNSUPPORTED(A1)", cachedValue: 42 } } }] } });
    expect(JSON.stringify(artifact)).toBe(before);
    expect(boundedArtifactRead({ content: { value: 1 } })).toEqual({ content: { value: 1 } });
  });

  it("keeps cropped images and table OMML unchanged through canonical Yjs bootstrap", () => {
    const equation = { kind: "equation" as const, latex: "{K}_{0,\\,0}", display: "block" as const, ommlXml: "<m:oMath/>", ommlSourceLatex: "{K}_{0,\\,0}" };
    const base: DocxProjection = {
      blocks: [
        { id: "image", type: "paragraph", text: "Picture", inlineContent: [{ kind: "image", partName: "/word/media/image1.png", occurrenceId: "image-one", mediaType: "image/png", altText: "Picture", placement: "inline", crop: { left: 0.12, top: 0.03, right: 0, bottom: 0 } }] },
        { id: "table", type: "table", text: equation.latex, rows: [[equation.latex]], richRows: [[[equation]]] },
      ], outline: [], nativeBinding: { version: 1, format: "docx", profile: "strict-native", macroEnabled: false, semanticDigest: "a".repeat(64), nativePlaceholders: [] },
    };
    const doc = new Y.Doc();
    try {
      initializeNativeArtifactDocument(doc, { title: "Paper", typeKey: "document", schemaVersion: 4, tags: [], content: base });
      const content = nativeArtifactProjection(doc, 4)!.content;
      expect(docxProjectionFromContent(content, base).operations).toEqual([]);
      const edited = structuredClone(content);
      edited.blocks[1].richRows[0][0][0].latex = "K+1";
      expect(docxProjectionFromContent(edited, base).operations).toEqual([expect.objectContaining({ kind: "edit-table-cell", regionId: "table" })]);
    } finally { doc.destroy(); }
  });
});
