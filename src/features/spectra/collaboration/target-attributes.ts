/**
 * The DOM contract for the interaction fabric.
 *
 * An editor marks each control with its canonical content path. That single
 * annotation is what lets cursors, carets, selections, drag ghosts, resize
 * frames and held-control affordances all resolve to the *exact* control — and
 * it is why none of those features need per-artifact code.
 *
 * Spread the result onto the element that visually *is* the control (the input,
 * the select, the cell, the node), not onto a wrapper, so caret geometry lands on
 * real text rather than on a container's padding.
 */

import { canonicalPath } from "./interaction-model";

export type TargetAttributes = {
  "data-spectra-target": string;
  "data-spectra-part"?: string;
};

/** Annotate a control with its content path. */
export function targetAttrs(
  path: string,
  part?: string,
): TargetAttributes {
  return {
    "data-spectra-target": canonicalPath(path),
    ...(part ? { "data-spectra-part": part } : {}),
  };
}

/** Annotate a sub-element such as a resize handle or drag grip. */
export function partAttrs(part: string): { "data-spectra-part": string } {
  return { "data-spectra-part": part };
}

/** Build an indexed collection path, e.g. `collectionPath("cards", 2, "front")`. */
export function collectionPath(
  collection: string,
  index: number | string,
  ...rest: (string | number)[]
): string {
  return canonicalPath(
    [collection, index, ...rest].map((part) => String(part)).join("/"),
  );
}

/** The eight box handles a spatial object exposes, in visual order. */
export const BOX_HANDLE_PARTS = [
  "handle:nw",
  "handle:n",
  "handle:ne",
  "handle:e",
  "handle:se",
  "handle:s",
  "handle:sw",
  "handle:w",
] as const;
