import type { Transaction } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";

/**
 * TipTap marks transactions hydrated from a remote Yjs update with
 * `isChangeOrigin`. Local typing, commands and undo/redo remain ordinary
 * doc-changing transactions. Keep this predicate tiny so native materializers
 * can subscribe without coupling themselves to the editor implementation.
 */
export function isLocalCollaborativeDocumentChange(
  transaction: Pick<Transaction, "docChanged" | "getMeta">,
) {
  if (!transaction.docChanged) return false;
  // Plugin/decoration/hydration transactions must not look like typing.
  // A native save's Yjs echo used to re-dirty the studio and nest updates.
  if (transaction.getMeta("addToHistory") === false) return false;
  const syncMeta = transaction.getMeta(ySyncPluginKey) as
    | { isChangeOrigin?: boolean }
    | undefined;
  return syncMeta?.isChangeOrigin !== true;
}
