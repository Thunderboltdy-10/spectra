import * as Y from "yjs";
import { DOCUMENT_YJS_FRAGMENT } from "./document-adapter";

export type NativeRelativeSelection = {
  anchor: Uint8Array;
  head: Uint8Array;
};

export function encodeDocumentRelativeSelection(
  selection: NativeRelativeSelection & { blockId: string },
) {
  return new TextEncoder().encode(
    JSON.stringify({
      blockId: selection.blockId,
      anchor: Array.from(selection.anchor),
      head: Array.from(selection.head),
    }),
  );
}

export function decodeDocumentRelativeSelection(value: Uint8Array) {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(value)) as {
      blockId?: unknown;
      anchor?: unknown;
      head?: unknown;
    };
    if (
      typeof parsed.blockId !== "string" ||
      !Array.isArray(parsed.anchor) ||
      !Array.isArray(parsed.head) ||
      !parsed.anchor.every((entry) => Number.isInteger(entry)) ||
      !parsed.head.every((entry) => Number.isInteger(entry))
    )
      return null;
    return {
      blockId: parsed.blockId,
      anchor: new Uint8Array(parsed.anchor),
      head: new Uint8Array(parsed.head),
    };
  } catch {
    return null;
  }
}

export function createRelativeTextSelection(
  text: Y.Text | Y.XmlText,
  anchor: number,
  head = anchor,
): NativeRelativeSelection {
  return {
    anchor: Y.encodeRelativePosition(
      Y.createRelativePositionFromTypeIndex(text, Math.max(0, anchor)),
    ),
    head: Y.encodeRelativePosition(
      Y.createRelativePositionFromTypeIndex(text, Math.max(0, head)),
    ),
  };
}

export function resolveRelativeTextSelection(
  doc: Y.Doc,
  selection: NativeRelativeSelection,
) {
  const anchor = Y.createAbsolutePositionFromRelativePosition(
    Y.decodeRelativePosition(selection.anchor),
    doc,
  );
  const head = Y.createAbsolutePositionFromRelativePosition(
    Y.decodeRelativePosition(selection.head),
    doc,
  );
  if (!anchor || !head || anchor.type !== head.type) return null;
  return { type: anchor.type, anchor: anchor.index, head: head.index };
}

function xmlTextUnder(node: Y.XmlElement | Y.XmlFragment): Y.XmlText | null {
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) return child;
    if (child instanceof Y.XmlElement) {
      const nested = xmlTextUnder(child);
      if (nested) return nested;
    }
  }
  return null;
}

function elementWithBlockId(
  node: Y.XmlElement | Y.XmlFragment,
  blockId: string,
): Y.XmlElement | null {
  for (const child of node.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.getAttribute("blockId") === blockId) return child;
    const nested = elementWithBlockId(child, blockId);
    if (nested) return nested;
  }
  return null;
}

export function createDocumentRelativeSelection(
  doc: Y.Doc,
  blockId: string,
  anchor: number,
  head = anchor,
) {
  const block = elementWithBlockId(doc.getXmlFragment(DOCUMENT_YJS_FRAGMENT), blockId);
  const text = block ? xmlTextUnder(block) : null;
  if (!text) return null;
  return { blockId, ...createRelativeTextSelection(text, anchor, head) };
}

export function resolveDocumentRelativeSelection(
  doc: Y.Doc,
  selection: NativeRelativeSelection & { blockId: string },
) {
  const resolved = resolveRelativeTextSelection(doc, selection);
  if (!resolved) return null;
  const block = elementWithBlockId(doc.getXmlFragment(DOCUMENT_YJS_FRAGMENT), selection.blockId);
  if (!block) return null;
  return { blockId: selection.blockId, anchor: resolved.anchor, head: resolved.head };
}
