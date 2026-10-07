/*
 * What Spectra can show a file as, in place, read-only. Photos and PDFs are
 * drawn by the browser; Word, PowerPoint and Excel files are read by Spectra's
 * own Office lenses. The pre-2007 binary formats have no reader here, so they
 * are named honestly instead of being opened into a blank page.
 */

export type FileViewKind = "image" | "pdf" | "document" | "slides" | "sheet" | "legacy";
/** The kinds read by an Office lens. */
export type OfficeViewKind = Extract<FileViewKind, "document" | "slides" | "sheet">;

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"]);
const OFFICE_EXTENSIONS: Record<string, OfficeViewKind> = {
  docx: "document",
  pptx: "slides",
  ppsx: "slides",
  xlsx: "sheet",
  xlsm: "sheet",
};
const OFFICE_TYPES: Record<string, OfficeViewKind> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "slides",
  "application/vnd.openxmlformats-officedocument.presentationml.slideshow": "slides",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12": "sheet",
};
const LEGACY_EXTENSIONS = new Set(["doc", "ppt", "pps", "xls"]);
const LEGACY_TYPES = new Set(["application/msword", "application/vnd.ms-powerpoint", "application/vnd.ms-excel"]);

function extensionOf(filename: string) {
  return filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
}

export function fileViewKind(mimeType: string | undefined, filename: string): FileViewKind | null {
  const type = (mimeType ?? "").toLowerCase();
  const extension = extensionOf(filename);
  if (type === "application/pdf" || extension === "pdf") return "pdf";
  // SVG can carry script; it stays out of the in-place viewer.
  if (type === "image/svg+xml" || extension === "svg") return null;
  if (type.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) return "image";
  // The name decides before a generic type: school systems label most files
  // application/octet-stream.
  if (OFFICE_EXTENSIONS[extension]) return OFFICE_EXTENSIONS[extension];
  if (LEGACY_EXTENSIONS.has(extension)) return "legacy";
  if (OFFICE_TYPES[type]) return OFFICE_TYPES[type];
  if (LEGACY_TYPES.has(type)) return "legacy";
  return null;
}

export function isOfficeViewKind(kind: FileViewKind | null | undefined): kind is OfficeViewKind {
  return kind === "document" || kind === "slides" || kind === "sheet";
}

/** The largest file each Office reader opens here; past it the file opens in a new tab. */
export const OFFICE_VIEW_LIMIT_BYTES: Record<OfficeViewKind, number> = {
  document: 40_000_000,
  slides: 80_000_000,
  sheet: 30_000_000,
};

const KIND_NOUN: Record<FileViewKind, string> = {
  image: "photo",
  pdf: "PDF",
  document: "Word document",
  slides: "PowerPoint deck",
  sheet: "Excel workbook",
  legacy: "older Office file",
};

export function fileKindNoun(kind: FileViewKind) {
  return KIND_NOUN[kind];
}

export function formatMegabytes(bytes: number) {
  const value = bytes / 1_000_000;
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} MB`;
}

/** Why a file is too big to read here, in one plain sentence, or nothing when it fits. */
export function officeSizeRefusal(kind: OfficeViewKind, bytes: number | undefined) {
  const limit = OFFICE_VIEW_LIMIT_BYTES[kind];
  if (!bytes || bytes <= limit) return null;
  return `This ${KIND_NOUN[kind]} is ${formatMegabytes(bytes)}. Spectra shows ${KIND_NOUN[kind]}s up to ${formatMegabytes(limit)} here.`;
}
