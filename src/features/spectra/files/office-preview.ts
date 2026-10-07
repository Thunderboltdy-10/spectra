import type { JSONContent } from "@tiptap/core";
import type { RichComment, SpectraRichContentAst } from "../rich-content/ast";
import type { PresentationContent } from "../presentation/model";
import type { SheetCellFormat } from "../sheets/model";
import type { ChartPlotData } from "../sheets/chart-dataset";
import type { ConditionalCellStyle } from "../sheets/conditional-format";
import { EXCEL_DEFAULT_COLUMN_PIXELS, EXCEL_DEFAULT_ROW_PIXELS } from "../sheets/excel-units";
import type { XlsxDrawingAnchor, XlsxChartProjection } from "../lenses/projection-contracts";
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

export type DocumentPreview = {
  kind: "document";
  ast: SpectraRichContentAst;
  media: OfficePreviewMedia[];
  /** Word's comment threads, numbered as the text marks them. */
  comments: RichComment[];
  /** The last section's own header and footer text, when it has one. */
  header?: string;
  footer?: string;
  /** What the file holds that this view can't draw, named for the reader. */
  unshown: string[];
};
export type SlidesPreview = { kind: "slides"; deck: PresentationContent; media: OfficePreviewMedia[] };

export type SheetPreviewCell = { text: string; format?: SheetCellFormat; numeric?: boolean };
export type SheetPreviewMerge = { row: number; column: number; rows: number; columns: number };
/** Where a chart or picture sits: by cell when the file says, else by pixels. */
export type SheetPreviewPlacement = {
  anchor?: XlsxDrawingAnchor;
  position: { x: number; y: number; width: number; height: number };
};
export type SheetPreviewChart = SheetPreviewPlacement & {
  id: string;
  type: XlsxChartProjection["type"];
  title: string;
  plot: ChartPlotData;
};
/** A picture on the sheet. Without `mediaId` it is a kind the browser can't draw (EMF, WMF). */
export type SheetPreviewPicture = SheetPreviewPlacement & { id: string; label: string; mediaId?: string };
export type SheetPreviewNote = { author?: string; text: string };
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
  /** In pixels. Columns and rows without their own size take Excel's default. */
  columnWidths: Record<string, number>;
  rowHeights: Record<string, number>;
  merges: SheetPreviewMerge[];
  /** Conditional formats, already evaluated, by address. */
  conditional: Record<string, ConditionalCellStyle>;
  /** Excel's notes, by address. */
  notes: Record<string, SheetPreviewNote>;
  charts: SheetPreviewChart[];
  pictures: SheetPreviewPicture[];
  showGridlines: boolean;
  /** Keyed by the cell's address (`B4`). Empty cells are absent. */
  cells: Record<string, SheetPreviewCell>;
  /** The sheet is larger than the viewer draws; the rest opens in Excel. */
  clipped: boolean;
};
export type SheetPreview = { kind: "sheet"; sheets: SheetPreviewSheet[]; activeSheetId: string; media: OfficePreviewMedia[] };

export type OfficePreview = DocumentPreview | SlidesPreview | SheetPreview;

/** How far the workbook viewer reads. Past this it says so instead of freezing. */
export const SHEET_PREVIEW_LIMITS = { rows: 10_000, columns: 256, cells: 250_000, charts: 24, pictures: 48 } as const;

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
  return preview.media.map((item) => item.bytes);
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

/** Word's preserved features this view can't draw, as the reader would name them. */
const UNSHOWN_WORD_FEATURES: Record<string, string> = {
  smartArt: "SmartArt",
  ole: "embedded objects",
  textBox: "text boxes",
};

async function documentPreview(bytes: Uint8Array): Promise<DocumentPreview> {
  const [{ importDocxPayload }, { richDocumentFromProseMirror }] = await Promise.all([
    import("../lenses/docx-adapter"),
    import("../rich-content/prosemirror"),
  ]);
  const { json, projection, conversion } = await importDocxPayload(bytes);
  const media: OfficePreviewMedia[] = [];
  const doc = liftDocumentImages(json as JSONContent, media);
  const { ast, comments } = richDocumentFromProseMirror(doc);
  const unshown = new Set<string>();
  for (const placeholder of projection.nativeBinding?.nativePlaceholders ?? []) {
    const name = placeholder.feature ? UNSHOWN_WORD_FEATURES[placeholder.feature] : undefined;
    if (name) unshown.add(name);
  }
  if (conversion.notes.some((note) => note.scope === "unsupported media")) unshown.add("pictures in formats a browser can't draw");
  const chrome = (text: string | undefined) => (text?.trim() ? { value: text } : null);
  const header = chrome(projection.pageSetup?.header);
  const footer = chrome(projection.pageSetup?.footer);
  return {
    kind: "document",
    ast,
    media,
    comments,
    ...(header ? { header: header.value } : {}),
    ...(footer ? { footer: footer.value } : {}),
    unshown: [...unshown],
  };
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
      // Pictures, and the picture PowerPoint saved in place of an embedded object.
      if (!content || (object.type !== "image" && object.type !== "embed") || !part) continue;
      const mediaType = typeof content.nativeMediaType === "string" ? content.nativeMediaType.toLowerCase() : "";
      if (!RASTER_TYPES.has(mediaType)) continue;
      if (!parts.has(part)) parts.set(part, { id: previewMediaId(parts.size), mediaType });
      content.assetId = parts.get(part)!.id;
      delete content.sha256;
      delete content.nativeMediaSha256;
    }
  return { kind: "slides", deck, media: packageMedia(unzipSync, opened.preservedCarry.safePayload ?? bytes, parts) };
}

/** The bytes of each wanted package part, under the id its content points at. */
function packageMedia(
  unzip: typeof import("fflate").unzipSync,
  payload: Uint8Array,
  parts: ReadonlyMap<string, { id: string; mediaType: string }>,
) {
  const media: OfficePreviewMedia[] = [];
  if (!parts.size) return media;
  const wanted = new Set([...parts.keys()].map((part) => part.replace(/^\//, "")));
  const files = unzip(payload, { filter: (file) => wanted.has(file.name) });
  for (const [part, { id, mediaType }] of parts) {
    const file = files[part.replace(/^\//, "")];
    if (file) media.push({ id, mediaType, bytes: file.slice().buffer });
  }
  return media;
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

/** The last row and column (exclusive) a placed object reaches, by cell. */
function placementExtent(placement: SheetPreviewPlacement) {
  const anchor = placement.anchor;
  if (anchor?.to) return { rows: anchor.to.row + 1, columns: anchor.to.column + 1 };
  if (anchor) {
    const width = anchor.width ?? placement.position.width;
    const height = anchor.height ?? placement.position.height;
    return {
      rows: anchor.from.row + Math.ceil((anchor.from.y + height) / EXCEL_DEFAULT_ROW_PIXELS) + 1,
      columns: anchor.from.column + Math.ceil((anchor.from.x + width) / EXCEL_DEFAULT_COLUMN_PIXELS) + 1,
    };
  }
  return {
    rows: Math.ceil((placement.position.y + placement.position.height) / EXCEL_DEFAULT_ROW_PIXELS) + 1,
    columns: Math.ceil((placement.position.x + placement.position.width) / EXCEL_DEFAULT_COLUMN_PIXELS) + 1,
  };
}

async function sheetPreview(bytes: Uint8Array): Promise<SheetPreview> {
  const [{ xlsxLens }, { xlsxArtifactContent }, model, { chartPlotData }, { conditionalFormatStyles }, { unzipSync }] = await Promise.all([
    import("../lenses/xlsx-lens"),
    import("../lenses/office-content"),
    import("../sheets/model"),
    import("../sheets/chart-dataset"),
    import("../sheets/conditional-format"),
    import("fflate"),
  ]);
  const opened = await xlsxLens.open(bytes, "strict-native");
  const content = model.normalizeSheetsContent(xlsxArtifactContent(opened.projection));
  const projected = new Map(opened.projection.sheets.map((sheet) => [sheet.id, sheet]));
  const calculation = model.sheetsCalculation(content);
  const locale = content.workbook.locale || "en-US";
  const date1904 = content.workbook.date1904 === true;
  let budget: number = SHEET_PREVIEW_LIMITS.cells;
  const sheets: SheetPreviewSheet[] = [];
  const mediaParts = new Map<string, { id: string; mediaType: string }>();
  // A hidden sheet is hidden in Excel too; it still answers the formulas above.
  for (const sheet of content.sheets.filter((candidate) => !candidate.hidden)) {
    const native = projected.get(sheet.id);
    const cells: Record<string, SheetPreviewCell> = {};
    let usedRows = 0;
    let usedColumns = 0;
    let clipped = false;
    const reach = (rows: number, columns: number) => {
      usedRows = Math.max(usedRows, Math.min(rows, SHEET_PREVIEW_LIMITS.rows));
      usedColumns = Math.max(usedColumns, Math.min(columns, SHEET_PREVIEW_LIMITS.columns));
    };
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
      reach(coordinate.row + 1, coordinate.column + 1);
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
    for (const merge of merges) reach(merge.row + merge.rows, merge.column + merge.columns);
    const notes: Record<string, SheetPreviewNote> = {};
    for (const comment of native?.comments ?? []) {
      const coordinate = model.parseAddress(comment.ref);
      if (!coordinate || coordinate.row >= SHEET_PREVIEW_LIMITS.rows || coordinate.column >= SHEET_PREVIEW_LIMITS.columns) continue;
      notes[comment.ref] = { ...(comment.author ? { author: comment.author } : {}), text: comment.text };
      reach(coordinate.row + 1, coordinate.column + 1);
    }
    // Charts read their series wherever the file points, on any sheet.
    const charts: SheetPreviewChart[] = (native?.charts ?? []).slice(0, SHEET_PREVIEW_LIMITS.charts).map((chart) => ({
      id: chart.id,
      type: chart.type,
      title: chart.title,
      plot: chartPlotData(content.sheets, sheet, sheet.charts.find((candidate) => candidate.id === chart.id) ?? chart, calculation, locale),
      position: chart.position,
      ...(chart.anchor ? { anchor: chart.anchor } : {}),
    }));
    const pictures: SheetPreviewPicture[] = (native?.pictures ?? []).slice(0, SHEET_PREVIEW_LIMITS.pictures).map((picture) => {
      const drawable = RASTER_TYPES.has(picture.mediaType);
      if (drawable && !mediaParts.has(picture.mediaPart))
        mediaParts.set(picture.mediaPart, { id: previewMediaId(mediaParts.size), mediaType: picture.mediaType });
      return {
        id: picture.id,
        label: picture.description || picture.name || "Picture",
        ...(drawable ? { mediaId: mediaParts.get(picture.mediaPart)!.id } : {}),
        position: picture.position,
        ...(picture.anchor ? { anchor: picture.anchor } : {}),
      };
    });
    for (const placed of [...charts, ...pictures]) {
      const extent = placementExtent(placed);
      reach(extent.rows, extent.columns);
    }
    // A little room past the last value, as a grid shows, without drawing
    // Excel's million empty rows.
    const rowCount = Math.min(SHEET_PREVIEW_LIMITS.rows, Math.max(usedRows + 2, 24));
    const columnCount = Math.min(SHEET_PREVIEW_LIMITS.columns, Math.max(usedColumns + 1, 8));
    const conditional = Object.fromEntries(
      conditionalFormatStyles(
        sheet.conditionalFormats,
        (address) => {
          const cell = sheet.cells[address];
          if (!cell) return undefined;
          return cell.formula ? calculation.get(`${sheet.id}:${address}`)?.value : cell.value;
        },
        { rows: rowCount, columns: columnCount },
      ),
    );
    sheets.push({
      id: sheet.id,
      name: sheet.name,
      ...(sheet.tabColor ? { tabColor: sheet.tabColor } : {}),
      rowCount,
      columnCount,
      frozenRows: Math.min(sheet.frozenRows ?? 0, 50),
      frozenColumns: Math.min(sheet.frozenColumns ?? 0, 20),
      hiddenRows: sheet.hiddenRows ?? [],
      hiddenColumns: sheet.hiddenColumns ?? [],
      columnWidths: sheet.columnWidths ?? {},
      rowHeights: sheet.rowHeights ?? {},
      merges,
      showGridlines: sheet.showGridlines !== false,
      cells,
      conditional,
      notes,
      charts,
      pictures,
      clipped,
    });
  }
  const active = sheets.find((sheet) => sheet.id === content.activeSheetId) ?? sheets[0];
  return {
    kind: "sheet",
    sheets,
    activeSheetId: active?.id ?? "",
    media: packageMedia(unzipSync, opened.preservedCarry.safePayload ?? bytes, mediaParts),
  };
}

/** Reads an Office file for showing. Throws when the lens cannot open it safely. */
export async function parseOfficePreview(kind: OfficeViewKind, bytes: Uint8Array): Promise<OfficePreview> {
  if (kind === "document") return documentPreview(bytes);
  if (kind === "slides") return slidesPreview(bytes);
  return sheetPreview(bytes);
}
