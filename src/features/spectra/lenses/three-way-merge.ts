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

  const weaveInsertions = (source: readonly string[]) => {
    for (const regionId of source) {
      if (order.includes(regionId) || !selected.has(regionId)) continue;
      const sourceIndex = source.indexOf(regionId);
      const nextAnchor = source
        .slice(sourceIndex + 1)
        .find((candidate) => order.includes(candidate));
      if (nextAnchor) {
        order.splice(order.indexOf(nextAnchor), 0, regionId);
        continue;
      }
      const previousAnchor = source
        .slice(0, sourceIndex)
        .reverse()
        .find((candidate) => order.includes(candidate));
      if (previousAnchor) order.splice(order.indexOf(previousAnchor) + 1, 0, regionId);
      else order.push(regionId);
    }
  };
  weaveInsertions(oursOrder);
  weaveInsertions(theirsOrder);
  weaveInsertions([...selected.keys()]);
  return {
    value: order.flatMap((regionId) => {
      const value = selected.get(regionId);
      return value === undefined ? [] : [value];
    }),
    conflicts,
    changedByOurs: [...new Set(changedByOurs)],
    changedByTheirs: [...new Set(changedByTheirs)],
  };
}
