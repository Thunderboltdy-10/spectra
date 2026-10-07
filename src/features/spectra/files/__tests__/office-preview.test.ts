import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Workbook } from "@ariadng/office/xlsx";
import { isPreviewMediaId, parseOfficePreview, previewTransferables } from "../office-preview";

const fixture = (...path: string[]) => readFile(join(process.cwd(), "fixtures", "office", ...path)).then((buffer) => new Uint8Array(buffer));

describe("parseOfficePreview", () => {
  it("reads a Word document into the shared rich-content model", async () => {
    const preview = await parseOfficePreview("document", await fixture("docx", "complex-structure.docx"));
    if (preview.kind !== "document") throw new Error("expected a document");
    expect(preview.ast.blocks.length).toBeGreaterThan(0);
    expect(preview.ast.blocks.some((block) => block.type === "heading" || block.type === "paragraph")).toBe(true);
    // Plain data only: it crosses from the worker by structured clone.
    expect(structuredClone(preview.ast)).toEqual(preview.ast);
  });

  it("reads a deck with its pictures as bytes and no lens binding", async () => {
    const preview = await parseOfficePreview("slides", await fixture("pptx", "media-preservation.pptx"));
    if (preview.kind !== "slides") throw new Error("expected slides");
    expect(preview.deck.slides.length).toBeGreaterThan(0);
    expect(preview.deck.nativeBinding).toBeUndefined();
    const images = preview.deck.slides.flatMap((slide) => slide.objects).filter((object) => object.type === "image");
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) expect(isPreviewMediaId((image.content as Record<string, unknown>).assetId)).toBe(true);
    expect(preview.media.length).toBeGreaterThan(0);
    for (const item of preview.media) {
      expect(item.mediaType).toMatch(/^image\//);
      expect(item.bytes.byteLength).toBeGreaterThan(0);
    }
    expect(previewTransferables(preview)).toHaveLength(preview.media.length);
  });

  it("reads a workbook into display text with calculated formulas", async () => {
    const workbook = Workbook.create();
    const sheet = workbook.sheet("Sheet1")!;
    sheet.setCell("A1", "Mark");
    sheet.setCell("A2", 6);
    sheet.setCell("A3", 7);
    sheet.setFormula("A4", "=SUM(A2:A3)");
    const preview = await parseOfficePreview("sheet", await workbook.save());
    if (preview.kind !== "sheet") throw new Error("expected a workbook");
    const [first] = preview.sheets;
    expect(first?.name).toBe("Sheet1");
    expect(preview.activeSheetId).toBe(first?.id);
    expect(first?.cells.A1).toMatchObject({ text: "Mark" });
    expect(first?.cells.A2).toMatchObject({ text: "6", numeric: true });
    expect(first?.cells.A4).toMatchObject({ text: "13", numeric: true });
    // A little room past the last value, never Excel's million rows.
    expect(first?.rowCount).toBe(24);
    expect(first?.clipped).toBe(false);
  });

  it("refuses a file the lens cannot open safely", async () => {
    await expect(parseOfficePreview("document", await fixture("docx", "corrupt.docx"))).rejects.toThrow();
    await expect(parseOfficePreview("slides", new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});
