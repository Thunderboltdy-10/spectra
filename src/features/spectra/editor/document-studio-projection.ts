import type { Editor, JSONContent } from "@tiptap/core";
import { NATIVE_PROJECTION_TRANSACTION_META } from "./collaboration-change";

/** Reconcile a studio projection without rewriting a bound collaborative tree. */
export function applyDocumentStudioProjection(
  editor: Editor,
  incoming: JSONContent,
  options: { collaborative: boolean; native: boolean; provisional: boolean },
): number {
  if (!options.collaborative) {
    editor.commands.setContent(incoming, { emitUpdate: false });
    return 0;
  }
  // Awareness and early canonical snapshots are projections, not Yjs authors.
  // Only canonical Keep Word reconciliation may adopt nodes into the binding.
  if (!options.native || options.provisional) return 0;
  const missing = (incoming.content ?? []).filter((node) => {
    const blockId = node.attrs?.["blockId"];
    if (typeof blockId !== "string" || !blockId) return false;
    let found = false;
    editor.state.doc.descendants((candidate) => {
      if (candidate.attrs.blockId === blockId) found = true;
      return !found;
    });
    return !found;
  });
  const nodes = missing.flatMap((json) => {
    try { return [editor.schema.nodeFromJSON(json)]; }
    catch { return []; }
  });
  if (nodes.length) editor.view.dispatch(
    editor.state.tr.insert(editor.state.doc.content.size, nodes)
      .setMeta(NATIVE_PROJECTION_TRANSACTION_META, true)
      .setMeta("addToHistory", false),
  );
  return nodes.length;
}
