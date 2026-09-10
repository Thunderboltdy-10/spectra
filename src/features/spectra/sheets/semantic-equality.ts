import type { SheetCell, SheetsContent, WorkbookSheet } from "./model";
import { changedSheetCellAddresses } from "./cell-overlay";

/**
 * Compare JSON-like editor state without making property order part of the
 * meaning. This is deliberately a proof function, not a digest: callers use
 * it to decide whether a write is a no-op, so a hash collision must never be
 * able to suppress an incoming update.
 */
export function sheetsValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sheetsValueEqual(value, right[index]))
    );
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object")
    return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) &&
        sheetsValueEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

export function sheetsCellEqual(
  left: SheetCell | undefined,
  right: SheetCell | undefined,
) {
  return sheetsValueEqual(left, right);
}

function sheetMetadata(sheet: WorkbookSheet) {
  const { cells: _cells, ...metadata } = sheet;
  return metadata;
}

function sheetCellsEqual(left: WorkbookSheet, right: WorkbookSheet): boolean {
  if (left.cells === right.cells) return true;
  const hinted = changedSheetCellAddresses(left.cells, right.cells);
  if (hinted) {
    return hinted.every((address) =>
      sheetsCellEqual(left.cells[address], right.cells[address]),
    );
  }
  const leftAddresses = Object.keys(left.cells);
  const rightAddresses = Object.keys(right.cells);
  if (leftAddresses.length !== rightAddresses.length) return false;
  return leftAddresses.every(
    (address) =>
      Object.prototype.hasOwnProperty.call(right.cells, address) &&
      sheetsCellEqual(left.cells[address], right.cells[address]),
  );
}

/**
 * Complete semantic equality for a Sheets snapshot.
 *
 * Metadata is checked before cells so chart/table/dimension/style/name and
 * workbook-only changes are visible even when the cell map is shared. When a
 * cell overlay or shared base is available, only its changed addresses are
 * visited; external replacement maps fall back to an address walk without
 * sorting or serializing the workbook.
 */
export function sheetsContentEqual(
  left: SheetsContent,
  right: SheetsContent,
): boolean {
  if (left === right) return true;
  if (
    left.activeSheetId !== right.activeSheetId ||
    !sheetsValueEqual(left.workbook, right.workbook) ||
    !sheetsValueEqual(left.nativeBinding, right.nativeBinding) ||
    left.sheets.length !== right.sheets.length
  )
    return false;
  return left.sheets.every((sheet, index) => {
    const other = right.sheets[index];
    if (!other || sheet.id !== other.id) return false;
    if (
      sheet !== other &&
      !sheetsValueEqual(sheetMetadata(sheet), sheetMetadata(other))
    )
      return false;
    return sheet === other || sheetCellsEqual(sheet, other);
  });
}
