import type { Editor } from "@tiptap/core";
import { applyDocumentAcademicOperations, type DocumentAcademicOperation } from "../commands/office/document-academic-operations";
import { documentBlocksFromJson, documentContentToProseMirrorJson, documentNodeText } from "../lenses/document-projection";
import type { WordTextAnchor } from "../lenses/docx-academic-schema";

export function academicSelection(editor: Editor): WordTextAnchor {
  const { $from, $to, from, to } = editor.state.selection;
  if (!$from.sameParent($to) || !$from.parent.isTextblock || typeof $from.parent.attrs.blockId !== "string") throw new Error("Select a caret or text range inside one paragraph.");
  const paragraph = $from.parent;
  const start = $from.start();
  const prefix = (end: number) => {
    let text = "";
    paragraph.forEach((node, offset) => {
      if (offset >= end) return;
      if (node.isText) text += (node.text ?? "").slice(0, Math.max(0, end - offset));
      else if (offset + node.nodeSize <= end) text += documentNodeText(node.toJSON());
    });
    return text;
  };
  return { regionId: paragraph.attrs.blockId, start: prefix(from - start).length, end: prefix(to - start).length, expectedText: documentNodeText(paragraph.toJSON()) };
}

/** Replace only changed stable blocks in a single undoable ProseMirror transaction. */
export function executeAcademicEditorOperations(editor: Editor, content: unknown, operations: DocumentAcademicOperation[]) {
  const source = content && typeof content === "object" ? content as Record<string, unknown> : {};
  const tiptap = editor.getJSON();
  const desired = applyDocumentAcademicOperations({ ...source, blocks: documentBlocksFromJson(tiptap), tiptap }, operations);
  const next = documentContentToProseMirrorJson(desired).content ?? [];
  const nextNodes = next.map((node) => editor.schema.nodeFromJSON(node));
  const nextById = new Map(nextNodes.map((node) => [String(node.attrs.blockId), node]));
  const current: Array<{ id: string; offset: number; size: number }> = [];
  editor.state.doc.forEach((node, offset) => current.push({ id: String(node.attrs.blockId), offset, size: node.nodeSize }));
  const transaction = editor.state.tr;
  for (const item of [...current].reverse()) {
    const next = nextById.get(item.id);
    const previous = transaction.doc.nodeAt(item.offset);
    const replacement = next && previous?.type === next.type ? next.type.create({ ...previous.attrs, ...Object.fromEntries(Object.entries(next.attrs).filter(([key]) => key === "blockId" || key === "nativeReadOnly")) }, next.content, next.marks) : next;
    if (!replacement) transaction.delete(item.offset, item.offset + item.size);
    else if (!transaction.doc.nodeAt(item.offset)?.eq(replacement)) transaction.replaceWith(item.offset, item.offset + item.size, replacement);
  }
  const previousIds = new Set(current.map((item) => item.id));
  nextNodes.forEach((node, index) => {
    if (previousIds.has(String(node.attrs.blockId))) return;
    const prior = nextNodes[index - 1];
    let position = 0;
    if (prior) transaction.doc.forEach((candidate, offset) => { if (candidate.attrs.blockId === prior.attrs.blockId) position = offset + candidate.nodeSize; });
    transaction.insert(position, node);
  });
  editor.view.dispatch(transaction.scrollIntoView());
}
