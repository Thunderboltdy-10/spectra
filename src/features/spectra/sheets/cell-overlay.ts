export const SHEET_CELLS_OVERLAY = Symbol.for("spectra.sheetCellsOverlay");

type OverlayState<T> = {
  base: Record<string, T>;
  patch: Record<string, T | undefined>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function readSheetCellsOverlay<T>(
  cells: Record<string, T> | undefined,
): OverlayState<T> | null {
  if (!cells) return null;
  const state = (cells as Record<string | symbol, unknown>)[SHEET_CELLS_OVERLAY];
  if (!state || !isRecord(state) || !isRecord(state.base) || !isRecord(state.patch))
    return null;
  return state as OverlayState<T>;
}

export function patchSheetCellRecord<T>(
  cells: Record<string, T>,
  changes: Record<string, T | undefined>,
): Record<string, T> {
  const previous = readSheetCellsOverlay<T>(cells);
  const base = previous?.base ?? cells;
  const patch = { ...(previous?.patch ?? {}), ...changes };
  const state: OverlayState<T> = { base, patch };
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === SHEET_CELLS_OVERLAY) return state;
      if (
        typeof prop === "string" &&
        Object.prototype.hasOwnProperty.call(patch, prop)
      )
        return patch[prop];
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (
        typeof prop === "string" &&
        Object.prototype.hasOwnProperty.call(patch, prop)
      )
        return patch[prop] !== undefined;
      return Reflect.has(target, prop);
    },
    ownKeys(target) {
      const keys = new Set<string | symbol>(Reflect.ownKeys(target));
      for (const key of Object.keys(patch)) {
        if (patch[key] === undefined) keys.delete(key);
        else keys.add(key);
      }
      return [...keys];
    },
    getOwnPropertyDescriptor(target, prop) {
      if (
        typeof prop === "string" &&
        Object.prototype.hasOwnProperty.call(patch, prop)
      ) {
        if (patch[prop] === undefined) return undefined;
        return {
          configurable: true,
          enumerable: true,
          writable: true,
          value: patch[prop],
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  }) as Record<string, T>;
}

/**
 * Returns the addresses that differ when `after` is an overlay of `before`
 * (or they share a base). `null` means the caller must scan the full maps.
 */
export function changedSheetCellAddresses<T>(
  before: Record<string, T> | undefined,
  after: Record<string, T>,
): string[] | null {
  if (before === after) return [];
  const afterOverlay = readSheetCellsOverlay(after);
  if (!afterOverlay) return null;
  if (afterOverlay.base === before) return Object.keys(afterOverlay.patch);
  const beforeOverlay = readSheetCellsOverlay(before);
  if (!beforeOverlay || beforeOverlay.base !== afterOverlay.base) return null;
  const addresses = new Set([
    ...Object.keys(beforeOverlay.patch),
    ...Object.keys(afterOverlay.patch),
  ]);
  return [...addresses].filter(
    (address) => beforeOverlay.patch[address] !== afterOverlay.patch[address],
  );
}
