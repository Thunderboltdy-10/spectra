/**
 * A cross-reference in Word is a link to a bookmark (`w:hyperlink w:anchor`).
 * Spectra names the bookmark after the heading it marks, so the link written
 * in the editor (`#_Spx…`) finds its heading again when the file is saved,
 * and Word's own bookmark keeps working after that.
 */

const PREFIX = "_Spx";

/** The bookmark a cross-reference to this block points at. Hidden in Word (it starts with "_"). */
export function crossReferenceAnchor(blockId: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < blockId.length; index += 1) {
    hash ^= blockId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${PREFIX}${hash.toString(16).padStart(8, "0")}`;
}

export function isCrossReferenceAnchor(name: string) {
  return /^_Spx[0-9a-f]{8}$/u.test(name);
}

/** The bookmark name of an in-document link (`#name`), or undefined for any other link. */
export function internalAnchor(href: string) {
  if (!href.startsWith("#")) return undefined;
  const name = href.slice(1);
  return name && name.length <= 200 && !/[\s\u0000-\u001f\u007f"<>]/u.test(name) ? name : undefined;
}
