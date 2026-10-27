import type { Editor, JSONContent } from "@tiptap/core";

/**
 * Reconcile a studio projection without rewriting a bound collaborative tree.
 * A bound editor takes every change, native Word saves included, through its
 * Y.XmlFragment: native reconciliation writes the canonical file into the room.
 * The projection can lag that room by a version and carry other block ids, so
 * adopting "missing" nodes from it duplicated paragraphs after a Word save.
 */
export function applyDocumentStudioProjection(
  editor: Editor,
  incoming: JSONContent,
  options: { collaborative: boolean },
): number {
  if (options.collaborative) return 0;
  editor.commands.setContent(incoming, { emitUpdate: false });
  return 0;
}
