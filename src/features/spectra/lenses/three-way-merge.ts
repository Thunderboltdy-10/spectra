export type MergeConflict<T> = {
  id: string;
  base?: T;
  ours?: T;
  theirs?: T;
};

export type ThreeWayMergeResult<T> = {
  value: T[];
  conflicts: MergeConflict<T>[];
  changedByOurs: string[];
  changedByTheirs: string[];
};

type MergeOptions<T> = {
  base: readonly T[];
  ours: readonly T[];
  theirs: readonly T[];
  id: (value: T) => string;
  equal?: (left: T | undefined, right: T | undefined) => boolean;
  orderId?: string;
  mergeOrder?: boolean;
  conflictResolution?: "ours" | "theirs";
};

const defaultEqual = <T>(left: T | undefined, right: T | undefined) =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * Merge keyed regions against a persisted ancestor. Undefined represents a
 * deletion, so delete-vs-edit is reported as a real conflict rather than
 * silently resurrecting either side.
 */
export function mergeThreeWay<T>({
  base,
  ours,
  theirs,
  id,
  equal = defaultEqual,
  orderId = "order",
  mergeOrder = true,
  conflictResolution,
}: MergeOptions<T>): ThreeWayMergeResult<T> {
  const baseById = new Map(base.map((value) => [id(value), value]));
  const oursById = new Map(ours.map((value) => [id(value), value]));
  const theirsById = new Map(theirs.map((value) => [id(value), value]));
  const ids = new Set([...baseById.keys(), ...oursById.keys(), ...theirsById.keys()]);
  const conflicts: MergeConflict<T>[] = [];
  const changedByOurs: string[] = [];
  const changedByTheirs: string[] = [];
  const selected = new Map<string, T>();

  for (const regionId of ids) {
    const ancestor = baseById.get(regionId);
    const oursValue = oursById.get(regionId);
    const theirsValue = theirsById.get(regionId);
    const oursChanged = !equal(oursValue, ancestor);
    const theirsChanged = !equal(theirsValue, ancestor);
    if (oursChanged) changedByOurs.push(regionId);
    if (theirsChanged) changedByTheirs.push(regionId);

    if (oursChanged && theirsChanged && !equal(oursValue, theirsValue)) {
      conflicts.push({ id: regionId, base: ancestor, ours: oursValue, theirs: theirsValue });
      const resolved = conflictResolution === "ours" ? oursValue : conflictResolution === "theirs" ? theirsValue : undefined;
      if (resolved !== undefined) selected.set(regionId, resolved);
      continue;
    }
    const winner = oursChanged ? oursValue : theirsChanged ? theirsValue : ancestor;
    if (winner !== undefined) selected.set(regionId, winner);
  }

  if (!mergeOrder)
    return {
      value: [...selected.values()],
      conflicts,
      changedByOurs: [...new Set(changedByOurs)],
      changedByTheirs: [...new Set(changedByTheirs)],
    };

  const orderOf = (values: readonly T[]) => values.map(id);
  const baseOrder = orderOf(base);
  const oursOrder = orderOf(ours).filter((regionId) => selected.has(regionId));
  const theirsOrder = orderOf(theirs).filter((regionId) => selected.has(regionId));
  const baseSurvivors = baseOrder.filter((regionId) => selected.has(regionId));
  const baseSet = new Set(baseOrder);
  const oursBackbone = oursOrder.filter((regionId) => baseSet.has(regionId));
  const theirsBackbone = theirsOrder.filter((regionId) => baseSet.has(regionId));
  const oursOrderChanged = JSON.stringify(oursBackbone) !== JSON.stringify(baseSurvivors);
  const theirsOrderChanged = JSON.stringify(theirsBackbone) !== JSON.stringify(baseSurvivors);
  let order = baseSurvivors;
  if (oursOrderChanged && theirsOrderChanged && JSON.stringify(oursBackbone) !== JSON.stringify(theirsBackbone)) {
    conflicts.push({ id: orderId });
    if (conflictResolution === "ours") order = oursBackbone;
    else if (conflictResolution === "theirs") order = theirsBackbone;
  } else if (oursOrderChanged) {
    order = oursBackbone;
  } else if (theirsOrderChanged) {
    order = theirsBackbone;
  }

  // The chosen order is a linked list so each insertion is O(1); a document
  // with thousands of blocks inserted on both sides must not stall the server.
  const next = new Map<string, string | undefined>();
  const previous = new Map<string, string | undefined>();
  let head: string | undefined;
  let tail: string | undefined;
  const link = (regionId: string, before: string | undefined, after: string | undefined) => {
    previous.set(regionId, before);
    next.set(regionId, after);
    if (before === undefined) head = regionId;
    else next.set(before, regionId);
    if (after === undefined) tail = regionId;
    else previous.set(after, regionId);
  };
  for (const regionId of order) link(regionId, tail, undefined);

  // Each region is anchored before the nearest following region of its source
  // that was already placed when the pass began (later regions cannot have
  // been placed during it), else after the nearest preceding placed region.
  const weaveInsertions = (source: readonly string[]) => {
    const nextAnchor: Array<string | undefined> = new Array(source.length);
    let following: string | undefined;
    for (let index = source.length - 1; index >= 0; index -= 1) {
      nextAnchor[index] = following;
      if (next.has(source[index])) following = source[index];
    }
    let preceding: string | undefined;
    source.forEach((regionId, index) => {
      if (!next.has(regionId) && selected.has(regionId)) {
        const anchor = nextAnchor[index];
        if (anchor !== undefined) link(regionId, previous.get(anchor), anchor);
        else if (preceding !== undefined) link(regionId, preceding, next.get(preceding));
        else link(regionId, tail, undefined);
      }
      if (next.has(regionId)) preceding = regionId;
    });
  };
  weaveInsertions(oursOrder);
  weaveInsertions(theirsOrder);
  weaveInsertions([...selected.keys()]);
  const woven: string[] = [];
  for (let regionId = head; regionId !== undefined; regionId = next.get(regionId)) woven.push(regionId);
  return {
    value: woven.flatMap((regionId) => {
      const value = selected.get(regionId);
      return value === undefined ? [] : [value];
    }),
    conflicts,
    changedByOurs: [...new Set(changedByOurs)],
    changedByTheirs: [...new Set(changedByTheirs)],
  };
}
