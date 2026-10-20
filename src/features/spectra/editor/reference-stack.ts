/*
 * A stack of references (EDITORS.md, "Embeds"): one card in the page with a
 * tab for each work. The node's own attributes are the work shown first; the
 * others ride in `stack`, each with exactly what its placement is confirmed
 * by (embed, operation, region), so a stacked work is as placed as any other.
 */

export type StackEntry = {
  embedId: string;
  placementOperationId?: string | null;
  containerRegionId?: string | null;
  sourceArtifactId?: string | null;
};

type Attrs = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

/** The works stacked behind the first, in tab order. */
export function stackOf(attrs: Attrs): StackEntry[] {
  const stack = attrs.stack;
  if (!Array.isArray(stack)) return [];
  return stack.flatMap((entry) => {
    const embedId = text((entry as Attrs | null)?.embedId);
    return embedId ? [{ ...(entry as StackEntry), embedId }] : [];
  });
}

/** A reference node's own work, as a stack entry. */
export function entryOf(attrs: Attrs): StackEntry | null {
  const embedId = text(attrs.embedId);
  if (!embedId) return null;
  return {
    embedId,
    placementOperationId: text(attrs.placementOperationId),
    containerRegionId: text(attrs.containerRegionId),
    sourceArtifactId: text(attrs.sourceArtifactId),
  };
}

/** Every embed a reference node shows, the first included. */
export function stackedEmbedIds(attrs: Attrs): string[] {
  const first = entryOf(attrs);
  return [...(first ? [first.embedId] : []), ...stackOf(attrs).map((entry) => entry.embedId)];
}

/** The node's attributes with one embed taken out; null when nothing is left. */
export function withoutStacked(attrs: Attrs, embedId: string): Attrs | null {
  const rest = stackOf(attrs).filter((entry) => entry.embedId !== embedId);
  if (attrs.embedId !== embedId) return { ...attrs, stack: rest.length ? rest : null };
  const [next, ...after] = rest;
  if (!next) return null;
  return { ...attrs, ...next, stack: after.length ? after : null };
}

/** The node's attributes with more works laid on it. */
export function withStacked(attrs: Attrs, entries: StackEntry[]): Attrs {
  const present = new Set(stackedEmbedIds(attrs));
  const added = entries.filter((entry) => !present.has(entry.embedId));
  return { ...attrs, stack: [...stackOf(attrs), ...added] };
}
