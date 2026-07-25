/**
 * Shared contentPatch verify matching. Exact JSON equality is preferred;
 * soft matches cover normalize-added defaults on list appends (`/-`) and
 * sheets cell / cells-map column appends without accepting unrelated no-ops.
 */

import {
  isSheetsCellPath,
  isSheetsCellsMapPath,
} from "./sheets-content-patch";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringishMatch(authored: string, saved: string) {
  const a = authored.trim();
  const s = saved.trim();
  return s === a || s.includes(a);
}

/** Authored object fields must appear on saved (normalize may add ids/defaults). */
export function authoredObjectFieldsMatch(
  authored: Record<string, unknown>,
  saved: Record<string, unknown>,
): boolean {
  const authoredKeys = Object.keys(authored).filter(
    (key) => authored[key] !== undefined && authored[key] !== null,
  );
  if (authoredKeys.length === 0) return false;
  return authoredKeys.every((key) => {
    if (!(key in saved)) return false;
    if (typeof authored[key] === "string" && typeof saved[key] === "string")
      return stringishMatch(String(authored[key]), String(saved[key]));
    if (isPlainObject(authored[key]) && isPlainObject(saved[key]))
      return authoredObjectFieldsMatch(authored[key], saved[key]);
    return JSON.stringify(saved[key]) === JSON.stringify(authored[key]);
  });
}

function sheetCellMatches(authored: unknown, saved: unknown): boolean {
  if (JSON.stringify(saved) === JSON.stringify(authored)) return true;
  if (!isPlainObject(saved)) return false;

  // Scalar authored value vs normalized `{ value }` / `{ formula }`.
  if (authored === null || typeof authored === "number" || typeof authored === "boolean")
    return saved.value === authored;
  if (typeof authored === "string") {
    const trimmed = authored.trim();
    if (trimmed.startsWith("="))
      return (
        typeof saved.formula === "string" &&
        stringishMatch(trimmed, saved.formula)
      );
    return (
      typeof saved.value === "string" &&
      stringishMatch(trimmed, String(saved.value))
    );
  }
  if (!isPlainObject(authored)) return false;
  return authoredObjectFieldsMatch(authored, saved);
}

function sheetCellsMapMatches(authored: unknown, saved: unknown): boolean {
  if (!isPlainObject(authored) || !isPlainObject(saved)) return false;
  const keys = Object.keys(authored);
  if (keys.length === 0) return false;
  return keys.every((address) => {
    const key = /^[A-Za-z]+[1-9][0-9]*$/.test(address)
      ? address.toUpperCase()
      : address;
    return sheetCellMatches(authored[address], saved[key] ?? saved[address]);
  });
}

/**
 * Returns true when the saved artifact content reflects the authored patch
 * change. Soft matches are intentional for append/normalize cases only.
 */
export function contentPatchChangeMatchesSaved(
  path: string,
  authoredValue: unknown,
  savedValue: unknown,
): boolean {
  if (JSON.stringify(savedValue) === JSON.stringify(authoredValue)) return true;

  // Append pointers (`/cards/-`, `/questions/-`, `/sheets/-`) land after
  // normalize, so saved objects often gain ids/defaults.
  if (
    /\/-$/.test(path) &&
    isPlainObject(savedValue) &&
    isPlainObject(authoredValue)
  )
    return authoredObjectFieldsMatch(authoredValue, savedValue);

  if (isSheetsCellPath(path)) return sheetCellMatches(authoredValue, savedValue);

  // `/sheets/N/cells` merges on apply; verify that every authored address landed.
  if (isSheetsCellsMapPath(path))
    return sheetCellsMapMatches(authoredValue, savedValue);

  return false;
}
