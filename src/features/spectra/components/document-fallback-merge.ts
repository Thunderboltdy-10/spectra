import type { JSONContent } from "@tiptap/core";

/**
 * While a document's room is out of reach its editor runs unbound, from a copy
 * that may be behind the room. What someone typed there is a set of changes to
 * that copy, not a new version of the whole document: replaying the copy would
 * erase everything the room gained in the meantime.
 */

function comparable(node: JSONContent, top = true): unknown {
  const attrs = Object.fromEntries(
    Object.entries(node.attrs ?? {})
      .filter(([key, value]) => {
        if (value === null || value === undefined || value === false) return false;
        // A nested id is regenerated whenever an editor rebuilds its tree.
        return top || key !== "blockId";
      })
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    type: node.type,
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(Object.keys(attrs).length ? { attrs } : {}),
    ...(node.marks?.length ? { marks: node.marks } : {}),
    ...(node.content?.length ? { content: node.content.map((child) => comparable(child, false)) } : {}),
  };
}

const same = (left: JSONContent, right: JSONContent) =>
  JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
const idOf = (node: JSONContent) =>
  typeof node.attrs?.blockId === "string" ? node.attrs.blockId : null;

export function mergeFallbackDocumentEdit(input: {
  /** What the unbound editor started from. */
  seed: JSONContent;
  /** What it holds now. */
  draft: JSONContent;
  /** What the room holds now. */
  live: JSONContent;
}): { json: JSONContent; changed: boolean } {
  const seedNodes = input.seed.content ?? [];
  const draftNodes = input.draft.content ?? [];
  const liveNodes = input.live.content ?? [];
  const seedById = new Map(seedNodes.flatMap((node) => {
    const id = idOf(node);
    return id ? [[id, node] as const] : [];
  }));
  const draftIds = new Set(draftNodes.flatMap((node) => idOf(node) ?? []));
  const removed = new Set([...seedById.keys()].filter((id) => !draftIds.has(id)));
  const replaced = new Map<string, JSONContent>();
  const START = Symbol("start");
  const inserted = new Map<string | typeof START, JSONContent[]>();
  let anchor: string | typeof START = START;
  for (const node of draftNodes) {
    const id = idOf(node);
    const before = id ? seedById.get(id) : seedNodes.find((candidate) => same(candidate, node));
    if (id && before) {
      if (!same(before, node)) replaced.set(id, node);
      anchor = id;
    } else if (!before) {
      inserted.set(anchor, [...(inserted.get(anchor) ?? []), node]);
    }
  }
  if (!removed.size && !replaced.size && !inserted.size)
    return { json: input.live, changed: false };

  const liveIds = new Set(liveNodes.flatMap((node) => idOf(node) ?? []));
  const content: JSONContent[] = [...(inserted.get(START) ?? [])];
  for (const node of liveNodes) {
    const id = idOf(node);
    if (id && removed.has(id)) {
      // What followed a removed block still belongs here.
      content.push(...(inserted.get(id) ?? []));
      continue;
    }
    content.push(id ? (replaced.get(id) ?? node) : node);
    if (id) content.push(...(inserted.get(id) ?? []));
  }
  // The block this followed is gone from the room: nothing typed is dropped.
  for (const [key, nodes] of inserted)
    if (key !== START && !liveIds.has(key)) content.push(...nodes);
  for (const [id, node] of replaced) if (!liveIds.has(id)) content.push(node);
  return { json: { ...input.live, content }, changed: true };
}
