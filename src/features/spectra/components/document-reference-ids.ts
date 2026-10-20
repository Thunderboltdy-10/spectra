import { stackedEmbedIds } from "../editor/reference-stack";

/** The part of a ProseMirror node the reference walk reads. */
export type ReferenceNode = {
  type: { name: string };
  attrs: Record<string, unknown>;
  forEach: (callback: (child: ReferenceNode) => void) => void;
};

const NONE: readonly string[] = [];
const idsByNode = new WeakMap<ReferenceNode, readonly string[]>();

function nodeReferenceIds(node: ReferenceNode): readonly string[] {
  const cached = idsByNode.get(node);
  if (cached) return cached;
  let ids: string[] | undefined;
  if (node.type.name === "spectraReference") {
    const stacked = stackedEmbedIds(node.attrs);
    if (stacked.length) ids = stacked;
  }
  node.forEach((child) => {
    const childIds = nodeReferenceIds(child);
    if (childIds.length) (ids ??= []).push(...childIds);
  });
  const result = ids ?? NONE;
  idsByNode.set(node, result);
  return result;
}

/**
 * The reference embeds a document holds. Runs on every local transaction, so
 * it is remembered per node: an edit replaces only the nodes on its path, and
 * every untouched subtree answers from the last walk.
 */
export function documentReferenceIds(document: ReferenceNode) {
  return new Set(nodeReferenceIds(document));
}
