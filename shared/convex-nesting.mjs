/**
 * Convex rejects a document nested more than 16 levels, counting the row
 * itself as level 1. The backend reports it as a dump of the whole document,
 * not a worded code, so every place that embeds artifact content inside
 * another value must check depth before writing, not only size.
 */
export const CONVEX_MAX_NESTING = 16;

/**
 * Inline artifact content may be embedded up to four levels into a row
 * (`spectraOperations.conflict.baseSnapshot.content`). Deeper content travels
 * as an immutable content reference, exactly like oversized content.
 */
export const MAX_INLINE_CONTENT_DEPTH = CONVEX_MAX_NESTING - 3;

/** Object and array levels, counting `value` itself as 1. Scalars are 0. */
export function convexNestingDepth(value) {
  let deepest = 0;
  const stack = [[value, 1]];
  while (stack.length) {
    const [item, depth] = stack.pop();
    if (!item || typeof item !== "object" || ArrayBuffer.isView(item) || item instanceof ArrayBuffer) continue;
    if (depth > deepest) deepest = depth;
    for (const child of Array.isArray(item) ? item : Object.values(item))
      if (child && typeof child === "object") stack.push([child, depth + 1]);
  }
  return deepest;
}

/** Whether `row`, written as one Convex document, stays within the limit. */
export function fitsConvexNesting(row) {
  return convexNestingDepth(row) <= CONVEX_MAX_NESTING;
}

/** Whether artifact content can stay inline wherever Spectra embeds it. */
export function inlineContentFitsNesting(content) {
  return convexNestingDepth(content) <= MAX_INLINE_CONTENT_DEPTH;
}
