import type { Transaction } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";

export const NATIVE_PROJECTION_TRANSACTION_META =
  "spectra-native-projection" as const;

function ySyncMeta(transaction: Pick<Transaction, "getMeta">) {
  return transaction.getMeta(ySyncPluginKey) as
    | { isChangeOrigin?: boolean }
    | undefined;
}

/**
 * Keep Word / native Office reconciliation writes the canonical file into the
 * bound Y.XmlFragment. Those hydrations must reach ProseMirror even when the
 * document contains protected OMML or tables; local typing still cannot.
 */
export function isYjsOriginDocumentTransaction(
  transaction: Pick<Transaction, "getMeta">,
) {
  if (transaction.getMeta(NATIVE_PROJECTION_TRANSACTION_META) === true)
    return true;
  return ySyncMeta(transaction)?.isChangeOrigin === true;
}

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
  return ySyncMeta(transaction)?.isChangeOrigin !== true;
}
