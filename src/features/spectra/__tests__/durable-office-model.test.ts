/* eslint-disable spectra/no-raw-hex-in-styles -- Native workbook fixture colors, not UI styles. */
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { initializeNativeArtifactDocument, nativeArtifactProjection, nativeChangedRegionIds } from "../../../../scripts/collaboration-native-projection.mjs";
import { docxProjectionFromContent } from "../lenses/document-projection";
import type { DocxProjection } from "../lenses/projection-contracts";
import { normalizeArtifactContent } from "../ai/content-normalization";
import { validateArtifactContent } from "../artifacts/registry";
import { NativeArtifactYjsModel, readNativeArtifactYjsDocument, planNativeArtifactYjsMutation } from "../work/models/yjs/native-artifact-model";
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
      const gatewayBefore = nativeArtifactProjection(doc, 4)!;
      plan.apply();
      expect(nativeChangedRegionIds(gatewayBefore, nativeArtifactProjection(doc, 4)!)).toEqual(plan.regions.map(region => region.regionId));
      const invalid = structuredClone(result);
      invalid.sheets[0]!.cells.A1!.format!.rotation = 91;
      expect(validateArtifactContent("sheets", invalid).success).toBe(false);
    } finally { doc.destroy(); }
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


it("persists a distant edit and a legitimate clear as small replayable deltas in a 200k-cell room", () => {
  const doc = new Y.Doc();
  const peer = new Y.Doc();
  try {
    const cells = Object.fromEntries(Array.from({length: 200_000}, (_, i) => [`A${i + 1}`, {value: i === 99_999 ? "界é" : i}]));
    initializeNativeArtifactDocument(doc, {title: "Dense", typeKey: "sheets", schemaVersion: 4, tags: [],
      content: {sheets: [{id: "dense", name: "Dense", cells}]}});
    const baseline = Y.encodeStateAsUpdate(doc);
    expect(baseline.byteLength).toBeGreaterThan(760 * 1024);
    Y.applyUpdate(peer, baseline);
    const value = readNativeArtifactYjsDocument(doc, "sheets")!;
    const next = structuredClone(value);
    (next.content as SheetsContent).sheets[0]!.cells.A200000!.value = "distant edit";
    const vector = Y.encodeStateVector(doc);
    planNativeArtifactYjsMutation(doc, "sheets", next, {clientId: "human", kind: "human"}).apply();
    const delta = Y.encodeStateAsUpdate(doc, vector);
    expect(delta.byteLength).toBeLessThan(2048);
    Y.applyUpdate(peer, delta);
    Y.applyUpdate(peer, delta); // lost receipt replay
    const replayed = readNativeArtifactYjsDocument(peer, "sheets")!.content as SheetsContent;
    expect(Object.keys(replayed.sheets[0]!.cells)).toHaveLength(200_000);
    expect(replayed.sheets[0]!.cells.A1!.value).toBe(0);
    expect(replayed.sheets[0]!.cells.A100000!.value).toBe("界é");
    expect(replayed.sheets[0]!.cells.A200000!.value).toBe("distant edit");
    const cleared = readNativeArtifactYjsDocument(doc, "sheets")!;
    delete (cleared.content as SheetsContent).sheets[0]!.cells.A200000;
    const beforeClear = Y.encodeStateVector(doc);
    planNativeArtifactYjsMutation(doc, "sheets", cleared, {clientId: "human", kind: "human"}).apply();
    const clearDelta = Y.encodeStateAsUpdate(doc, beforeClear);
    expect(clearDelta.byteLength).toBeLessThan(2048);
    Y.applyUpdate(peer, clearDelta);
    expect((readNativeArtifactYjsDocument(peer, "sheets")!.content as SheetsContent).sheets[0]!.cells.A200000).toBeUndefined();
  } finally {doc.destroy(); peer.destroy();}
}, 60_000);

it("allows an explicit empty replacement through the live model API", async () => {
  const doc = new Y.Doc();
  initializeNativeArtifactDocument(doc, {title: "Sheet", typeKey: "sheets", schemaVersion: 4, tags: [],
    content: {sheets: [{id: "s", name: "Sheet", cells: {A1: {value: "Keep until cleared"}}}]}});
  const model = new NativeArtifactYjsModel("sheets", {clientId: "clear", document: doc,
    getSnapshot: () => ({state: "synchronized", level: "modify", accountId: "account", displayName: "Fixture", unsynchronizedChanges: 0, presence: []}),
  } as unknown as ConstructorParameters<typeof NativeArtifactYjsModel>[1]);
  try {
    const value = readNativeArtifactYjsDocument(doc, "sheets")!;
    (value.content as SheetsContent).sheets[0]!.cells = {};
    const edit = async (...args: unknown[]) => {doc.transact(args.at(-1) as () => void); return {applied: true, claims: []};};
    await model.replaceSnapshot(value, {edit, editMany: edit} as unknown as Parameters<typeof model.replaceSnapshot>[1]);
    expect((readNativeArtifactYjsDocument(doc, "sheets")!.content as SheetsContent).sheets[0]!.cells).toEqual({});
  } finally {model.destroy(); doc.destroy();}
});
