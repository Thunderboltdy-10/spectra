import type { JSONContent } from "@tiptap/core";
import type { SpectraRichContentAst } from "../rich-content/ast";
import type { PresentationContent } from "../presentation/model";
import type { SheetCellFormat } from "../sheets/model";
import type { OfficeViewKind } from "./file-kind";

/*
 * An Office file read for showing, never for saving. The same lenses that
 * import a file into an editable work read it here (Word through the docx
 * adapter, PowerPoint and Excel through their lenses), so a file looks the
 * way it will look once copied into the Library. Everything here is plain
 * data with no DOM, so it runs in a worker; pictures travel as bytes and
 * become object URLs on the page that shows them.
 */

/** A picture taken out of the file. `id` is the placeholder its content points at. */
export type OfficePreviewMedia = { id: string; mediaType: string; bytes: ArrayBuffer };

export type DocumentPreview = { kind: "document"; ast: SpectraRichContentAst; media: OfficePreviewMedia[] };
export type SlidesPreview = { kind: "slides"; deck: PresentationContent; media: OfficePreviewMedia[] };

export type SheetPreviewCell = { text: string; format?: SheetCellFormat; numeric?: boolean };
export type SheetPreviewMerge = { row: number; column: number; rows: number; columns: number };
export type SheetPreviewSheet = {
  id: string;
  name: string;
  tabColor?: string;
  rowCount: number;
  columnCount: number;
  frozenRows: number;
  frozenColumns: number;
  hiddenRows: number[];
  hiddenColumns: number[];
  columnWidths: Record<string, number>;
  rowHeights: Record<string, number>;
  merges: SheetPreviewMerge[];
  showGridlines: boolean;
  /** Keyed by the cell's address (`B4`). Empty cells are absent. */
  cells: Record<string, SheetPreviewCell>;
  /** The sheet is larger than the viewer draws; the rest opens in Excel. */
  clipped: boolean;
};
export type SheetPreview = { kind: "sheet"; sheets: SheetPreviewSheet[]; activeSheetId: string };

export type OfficePreview = DocumentPreview | SlidesPreview | SheetPreview;

/** How far the workbook viewer reads. Past this it says so instead of freezing. */
export const SHEET_PREVIEW_LIMITS = { rows: 10_000, columns: 256, cells: 250_000 } as const;

const MEDIA_PREFIX = "spectra-preview-media:";
const RASTER_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/avif"]);

export function previewMediaId(index: number) {
  return `${MEDIA_PREFIX}${index}`;
}

export function isPreviewMediaId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(MEDIA_PREFIX);
}

/** The bytes a transfer can move rather than copy. */
export function previewTransferables(preview: OfficePreview): ArrayBuffer[] {
  return preview.kind === "sheet" ? [] : preview.media.map((item) => item.bytes);
}

function decodeDataUrl(value: string): { mediaType: string; bytes: ArrayBuffer } | null {
  const match = /^data:([a-z0-9.+/-]+);base64,([\s\S]*)$/i.exec(value);
  if (!match) return null;
  const mediaType = match[1]!.toLowerCase();
  if (!RASTER_TYPES.has(mediaType)) return null;
  const binary = atob(match[2]!);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { mediaType, bytes: bytes.buffer };
}

/** Swaps each embedded picture for a placeholder and keeps its bytes. */
function liftDocumentImages(node: JSONContent, media: OfficePreviewMedia[]): JSONContent {
  const src = node.type === "image" ? node.attrs?.src : undefined;
  if (typeof src === "string" && src.startsWith("data:")) {
    const decoded = decodeDataUrl(src);
    const id = previewMediaId(media.length);
    if (decoded) media.push({ id, ...decoded });
    return { ...node, attrs: { ...node.attrs, src: decoded ? id : "" } };
  }
  return node.content ? { ...node, content: node.content.map((child) => liftDocumentImages(child, media)) } : node;
}

async function documentPreview(bytes: Uint8Array): Promise<DocumentPreview> {
  const [{ importDocxPayload }, { richContentFromProseMirror }] = await Promise.all([
    import("../lenses/docx-adapter"),
    import("../rich-content/prosemirror"),
  ]);
  const { json } = await importDocxPayload(bytes);
  const media: OfficePreviewMedia[] = [];
  const doc = liftDocumentImages(json as JSONContent, media);
  return { kind: "document", ast: richContentFromProseMirror(doc), media };
}

async function slidesPreview(bytes: Uint8Array): Promise<SlidesPreview> {
  const [{ pptxLens }, { pptxArtifactContent }, { unzipSync }] = await Promise.all([
    import("../lenses/pptx-lens"),
    import("../lenses/office-content"),
    import("fflate"),
  ]);
  const opened = await pptxLens.open(bytes, "strict-native");
  const deck = pptxArtifactContent(opened.projection);
  // Shown, not bound: no lens URL can serve this file's pictures, so they come
  // out of the package here and every image points at its own bytes.
  delete deck.nativeBinding;
  const parts = new Map<string, { id: string; mediaType: string }>();
  for (const slide of deck.slides)
    for (const object of slide.objects) {
      const content = object.content && typeof object.content === "object" && !Array.isArray(object.content)
        ? (object.content as Record<string, unknown>)
        : null;
      const part = typeof content?.nativeMediaPart === "string" ? content.nativeMediaPart : "";
      if (!content || object.type !== "image" || !part) continue;
      const mediaType = typeof content.nativeMediaType === "string" ? content.nativeMediaType.toLowerCase() : "";
      if (!RASTER_TYPES.has(mediaType)) continue;
      if (!parts.has(part)) parts.set(part, { id: previewMediaId(parts.size), mediaType });
      content.assetId = parts.get(part)!.id;
      delete content.sha256;
      delete content.nativeMediaSha256;
    }
  const media: OfficePreviewMedia[] = [];
  if (parts.size) {
    const wanted = new Set([...parts.keys()].map((part) => part.replace(/^\//, "")));
    const files = unzipSync(opened.preservedCarry.safePayload ?? bytes, { filter: (file) => wanted.has(file.name) });
    for (const [part, { id, mediaType }] of parts) {
      const file = files[part.replace(/^\//, "")];
      if (file) media.push({ id, mediaType, bytes: file.slice().buffer });
    }
  }
  return { kind: "slides", deck, media };
}

function rangeSpan(range: string, parseAddress: (address: string) => { row: number; column: number } | null): SheetPreviewMerge | null {
  const [from, to = from] = range.split(":");
  const start = from ? parseAddress(from) : null;
  const end = to ? parseAddress(to) : null;
  if (!start || !end) return null;
  return {
    row: Math.min(start.row, end.row),
    column: Math.min(start.column, end.column),
    rows: Math.abs(end.row - start.row) + 1,
    columns: Math.abs(end.column - start.column) + 1,
  };
}

async function sheetPreview(bytes: Uint8Array): Promise<SheetPreview> {
  const [{ xlsxLens }, { xlsxArtifactContent }, model] = await Promise.all([
    import("../lenses/xlsx-lens"),
    import("../lenses/office-content"),
    import("../sheets/model"),
  ]);
  const opened = await xlsxLens.open(bytes, "strict-native");
  const content = model.normalizeSheetsContent(xlsxArtifactContent(opened.projection));
  const calculation = model.sheetsCalculation(content);
  const locale = content.workbook.locale || "en-US";
  const date1904 = content.workbook.date1904 === true;
  let budget: number = SHEET_PREVIEW_LIMITS.cells;
  const sheets: SheetPreviewSheet[] = [];
  // A hidden sheet is hidden in Excel too; it still answers the formulas above.
  for (const sheet of content.sheets.filter((candidate) => !candidate.hidden)) {
    const cells: Record<string, SheetPreviewCell> = {};
    let usedRows = 0;
    let usedColumns = 0;
    let clipped = false;
    for (const [address, cell] of Object.entries(sheet.cells)) {
      const coordinate = model.parseAddress(address);
      if (!coordinate) continue;
      if (coordinate.row >= SHEET_PREVIEW_LIMITS.rows || coordinate.column >= SHEET_PREVIEW_LIMITS.columns || budget <= 0) {
        clipped = true;
        continue;
      }
      const calculated = cell.formula ? calculation.get(`${sheet.id}:${address}`) : undefined;
      const text = model.formatCalculatedCell(cell, calculated, locale, date1904);
      const value = calculated?.value ?? cell.value;
      if (!text && !cell.format?.fillColor && !cell.format?.borders) continue;
      budget -= 1;
      usedRows = Math.max(usedRows, coordinate.row + 1);
      usedColumns = Math.max(usedColumns, coordinate.column + 1);
      cells[address.toUpperCase()] = {
        text,
        ...(cell.format ? { format: cell.format } : {}),
        ...(typeof value === "number" && !calculated?.error ? { numeric: true } : {}),
      };
    }
    const merges = (sheet.mergedRanges ?? []).flatMap((range) => {
      const span = rangeSpan(range, model.parseAddress);
      return span && span.row < SHEET_PREVIEW_LIMITS.rows && span.column < SHEET_PREVIEW_LIMITS.columns ? [span] : [];
    });
    for (const merge of merges) {
      usedRows = Math.max(usedRows, merge.row + merge.rows);
      usedColumns = Math.max(usedColumns, merge.column + merge.columns);
    }
    sheets.push({
      id: sheet.id,
      name: sheet.name,
      ...(sheet.tabColor ? { tabColor: sheet.tabColor } : {}),
      // A little room past the last value, as a grid shows, without drawing
      // Excel's million empty rows.
      rowCount: Math.min(SHEET_PREVIEW_LIMITS.rows, Math.max(usedRows + 2, 24)),
      columnCount: Math.min(SHEET_PREVIEW_LIMITS.columns, Math.max(usedColumns + 1, 8)),
      frozenRows: Math.min(sheet.frozenRows ?? 0, 50),
      frozenColumns: Math.min(sheet.frozenColumns ?? 0, 20),
      hiddenRows: sheet.hiddenRows ?? [],
      hiddenColumns: sheet.hiddenColumns ?? [],
      columnWidths: sheet.columnWidths ?? {},
      rowHeights: sheet.rowHeights ?? {},
      merges,
      showGridlines: sheet.showGridlines !== false,
      cells,
      clipped,
    });
  }
  const active = sheets.find((sheet) => sheet.id === content.activeSheetId) ?? sheets[0];
  return { kind: "sheet", sheets, activeSheetId: active?.id ?? "" };
}

/** Reads an Office file for showing. Throws when the lens cannot open it safely. */
export async function parseOfficePreview(kind: OfficeViewKind, bytes: Uint8Array): Promise<OfficePreview> {
  if (kind === "document") return documentPreview(bytes);
  if (kind === "slides") return slidesPreview(bytes);
  return sheetPreview(bytes);
}
