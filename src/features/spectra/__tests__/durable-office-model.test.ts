/* eslint-disable spectra/no-raw-hex-in-styles -- Native workbook fixture colors, not UI styles. */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { boundedArtifactRead } from "../ai/bounded-artifact-read";
import { encodeSheetCellsForStorage } from "../../../../shared/sheet-cells";
import { initializeNativeArtifactDocument, nativeArtifactProjection } from "../../../../scripts/collaboration-native-projection.mjs";
import { docxProjectionFromContent } from "../lenses/document-projection";
import type { DocxProjection } from "../lenses/projection-contracts";
import { normalizeArtifactContent } from "../ai/content-normalization";
import { validateArtifactContent } from "../artifacts/registry";
import { readNativeArtifactYjsDocument, planNativeArtifactYjsMutation } from "../work/models/yjs/native-artifact-model";
import type { SheetsContent } from "../sheets/model";

describe("large Office model boundaries", () => {
  it("keeps a one-cell AI patch local after canonical validation, retaining formatting and native cached truth", () => {
    const format = { bold: false, italic: false, underline: false, strike: true, align: "justify" as const, verticalAlign: "bottom" as const, wrap: false, rotation: -30, indent: 2, numberFormat: "custom" as const, customFormat: "0.000", currency: "EUR", decimals: 3, thousands: true, fontFamily: "Aptos, sans-serif", fontSize: 11, textColor: "#111111", fillColor: "#ffffff", borders: { top: { style: "double" as const, color: "#123456" }, right: null } };
    const content: SheetsContent = { workbook: { calculationMode: "automatic", locale: "en-US" }, activeSheetId: "sheet", sheets: [{ id: "sheet", name: "Dense", cells: {
      ...Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`A${index + 1}`, { value: index, format }])),
      P9996: { value: 1, format }, T10000: { formula: "=UNSUPPORTED(A1)", value: 42, nativeFormulaSupport: "cached-only", cachedValueStale: true, format, note: "Native cached result", provenance: { source: "Excel", importedAt: 1 } },
    }, tables: [{ id: "table", name: "Data", range: "A1:A1000", style: "striped", totalsRow: true, sortKeys: [{ column: 0, direction: "asc" }] }], charts: [], tabColor: "#123456", hidden: false, showGridlines: false, showHeadings: true, protection: { locked: false, note: "Editable" } }] };
    const doc = new Y.Doc();
    try {
      initializeNativeArtifactDocument(doc, { title: "Dense", typeKey: "sheets", schemaVersion: 4, tags: [], content });
      const current = readNativeArtifactYjsDocument(doc, "sheets")!;
      const next = structuredClone(current);
      const edited = next.content as SheetsContent;
      edited.sheets[0]!.cells.P9996!.value = 919296;
      const validated = validateArtifactContent("sheets", normalizeArtifactContent("sheets", edited));
      expect(validated.success).toBe(true);
      if (!validated.success) throw new Error("Expected valid workbook");
      next.content = validated.data;
      const result = next.content as SheetsContent;
      expect(result.sheets[0]!.cells.A1).toEqual((current.content as SheetsContent).sheets[0]!.cells.A1);
      expect(result.sheets[0]!.cells.T10000).toEqual((current.content as SheetsContent).sheets[0]!.cells.T10000);
      expect(result.sheets[0]!.cells.A1!.format).toEqual(format);
      const plan = planNativeArtifactYjsMutation(doc, "sheets", next, { clientId: "ai-validation-test", kind: "ai" });
      expect(plan.regions).toHaveLength(1);
      expect(plan.regions[0]!.regionId).toContain("9996");
      const invalid = structuredClone(result);
      invalid.sheets[0]!.cells.A1!.format!.rotation = 91;
      expect(validateArtifactContent("sheets", invalid).success).toBe(false);
    } finally { doc.destroy(); }
  });

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
