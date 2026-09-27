import * as Y from "yjs";
import { DOCUMENT_YJS_FRAGMENT } from "./document-adapter";
import { WORK_YJS_SCHEMA_VERSION, type WorkTransactionOrigin } from "./contracts";
import { assertWorkModelMetadata } from "./shared";

export type DocumentParagraphTextSplice = {
  blockId: string;
  expectedText: string;
  /** UTF-16 offsets, as used by Yjs and the editor. */
  index: number;
  deleteCount: number;
  insertText: string;
};

function splitsSurrogate(text: string, index: number): boolean {
  const left = text.charCodeAt(index - 1);
  const right = text.charCodeAt(index);
  return left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff;
}

/** Apply one plain, top-level paragraph splice to the caller's scratch Y.Doc.
 * This is a semantic delta builder, not a write permit or durable receipt.
 * The caller must admit its exact bytes under the current native/room fence.
 * Marks, references and inline atoms require their own lossless edit contract;
 * never flatten them through the block mirror to fit this plain-text path. */
export function applyDocumentParagraphTextSplice(
  document: Y.Doc,
  splice: DocumentParagraphTextSplice,
  origin: WorkTransactionOrigin,
): { blockId: string; beforeText: string; afterText: string; changed: boolean } {
  assertWorkModelMetadata(document, "document", WORK_YJS_SCHEMA_VERSION);
  if (!splice.blockId || typeof splice.expectedText !== "string" || typeof splice.insertText !== "string" ||
    !Number.isSafeInteger(splice.index) || !Number.isSafeInteger(splice.deleteCount) ||
    splice.index < 0 || splice.deleteCount < 0 || splice.index + splice.deleteCount > splice.expectedText.length ||
    splitsSurrogate(splice.expectedText, splice.index) || splitsSurrogate(splice.expectedText, splice.index + splice.deleteCount))
    throw new Error("DOCUMENT_TEXT_SPLICE_INVALID");

  const fragment = document.getXmlFragment(DOCUMENT_YJS_FRAGMENT);
  const matches = fragment.toArray().filter((node): node is Y.XmlElement =>
    node instanceof Y.XmlElement && node.getAttribute("blockId") === splice.blockId,
  );
  if (matches.length !== 1) throw new Error("DOCUMENT_TEXT_SPLICE_TARGET");
  const paragraph = matches[0]!;
  const children = paragraph.toArray();
  if (paragraph.nodeName !== "paragraph" || children.length > 1 ||
    (children.length === 1 && !(children[0] instanceof Y.XmlText)))
    throw new Error("DOCUMENT_TEXT_SPLICE_UNSUPPORTED");
  const text = children[0] as Y.XmlText | undefined;
  const delta: Array<{ insert?: unknown; attributes?: Record<string, unknown> }> = text?.toDelta() ?? [];
  if (delta.some((part) => typeof part.insert !== "string" || Object.keys(part.attributes ?? {}).length > 0))
    throw new Error("DOCUMENT_TEXT_SPLICE_UNSUPPORTED");
  const beforeText = delta.map((part) => part.insert as string).join("");
  if (beforeText !== splice.expectedText) throw new Error("DOCUMENT_TEXT_SPLICE_STALE");
  const afterText = beforeText.slice(0, splice.index) + splice.insertText + beforeText.slice(splice.index + splice.deleteCount);
  if (afterText === beforeText) return { blockId: splice.blockId, beforeText, afterText, changed: false };

  document.transact(() => {
    const target = text ?? new Y.XmlText();
    if (!text) paragraph.push([target]);
    if (splice.deleteCount) target.delete(splice.index, splice.deleteCount);
    if (splice.insertText) target.insert(splice.index, splice.insertText);
  }, origin);
  return { blockId: splice.blockId, beforeText, afterText, changed: true };
}
