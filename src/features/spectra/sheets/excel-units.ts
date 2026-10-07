/*
 * Excel stores a column's width in characters of the default font's widest
 * digit (7px for Calibri 11, padding included) and a row's height in points.
 * Spectra's grid draws pixels. These convert at the boundary, the way Excel
 * itself rounds, so a width read and written back is the width it was.
 */

const DIGIT_WIDTH = 7;

/** Excel's own default column: 8.43 characters in its UI, stored as width 9.140625. */
export const EXCEL_DEFAULT_COLUMN_PIXELS = 64;
/** Excel's own default row, 15 points. */
export const EXCEL_DEFAULT_ROW_PIXELS = 20;

export function excelWidthToPixels(width: number) {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return Math.trunc(((256 * width + Math.trunc(128 / DIGIT_WIDTH)) / 256) * DIGIT_WIDTH);
}

export function pixelsToExcelWidth(pixels: number) {
  if (!Number.isFinite(pixels) || pixels <= 0) return 0;
  return Math.trunc((pixels / DIGIT_WIDTH) * 256) / 256;
}

export function pointsToPixels(points: number) {
  if (!Number.isFinite(points) || points <= 0) return 0;
  return Math.round((points * 4) / 3);
}

export function pixelsToPoints(pixels: number) {
  if (!Number.isFinite(pixels) || pixels <= 0) return 0;
  return Math.round(pixels * 0.75 * 100) / 100;
}

/** A map of stored sizes, converted entry by entry. */
export function convertSizes(sizes: Record<string, number> | undefined, convert: (value: number) => number) {
  return Object.fromEntries(
    Object.entries(sizes ?? {}).flatMap(([key, value]) => {
      const converted = convert(value);
      return converted > 0 ? [[key, converted] as const] : [];
    }),
  );
}

/**
 * Pixel sizes back to Excel's units. A size that still draws the pixels the
 * file gave keeps the file's exact value, so opening and saving never
 * rewrites a width Excel chose.
 */
export function sizesToExcel(
  pixels: Record<string, number>,
  base: Record<string, number> | undefined,
  toPixels: (value: number) => number,
  fromPixels: (value: number) => number,
) {
  const result: Record<string, number> = {};
  // A size that draws nothing (Excel writes width 0 for some hidden columns)
  // never reached the editor, so it is still the file's.
  for (const [key, value] of Object.entries(base ?? {})) if (toPixels(value) <= 0) result[key] = value;
  for (const [key, value] of Object.entries(pixels)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    const original = base?.[key];
    result[key] = original !== undefined && toPixels(original) === Math.round(value) ? original : fromPixels(value);
  }
  return result;
}
