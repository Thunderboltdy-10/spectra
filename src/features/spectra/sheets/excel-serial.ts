/**
 * Excel serial dates. The numbers and epochs match `@ariadng/office`
 * `xlsx/internal.js` (`serialToDate` / `dateToSerial`, EPOCH_1900/1904).
 * The public xlsx module does not re-export those helpers, so this is the
 * one Spectra-side copy — evaluator, display, entry, and native projection
 * all go through here instead of inventing a third date system.
 */

export const MS_PER_DAY = 86_400_000;
/** 1900 system epoch: 1899-12-30 UTC (Excel's leap-year-bug compensation). */
export const EPOCH_1900 = Date.UTC(1899, 11, 30);
/** 1904 system epoch: 1904-01-01 UTC. */
export const EPOCH_1904 = Date.UTC(1904, 0, 1);
export const EXCEL_MAX_COL = 16_384;
export const EXCEL_MAX_ROW = 1_048_576;

export function serialToDate(serial: number, date1904 = false) {
  const epoch = date1904 ? EPOCH_1904 : EPOCH_1900;
  return new Date(epoch + Math.round(serial * MS_PER_DAY));
}

export function dateToSerial(date: Date, date1904 = false) {
  const ms = date.getTime();
  if (Number.isNaN(ms)) throw new Error("#VALUE!");
  const epoch = date1904 ? EPOCH_1904 : EPOCH_1900;
  return (ms - epoch) / MS_PER_DAY;
}

/** True when a string is an ISO-8601 date Spectra used to store instead of a serial. */
export function isIsoDateString(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value.trim()) &&
    !Number.isNaN(Date.parse(value))
  );
}
