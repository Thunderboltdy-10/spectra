/** One timed block's horizontal place in its day column. */
export type TimedLane = { lane: number; lanes: number };

/**
 * Side-by-side lanes for blocks that share time in one day column. Without
 * them every block filled the column, so the last one painted covered the
 * others and they could not be opened. Blocks that overlap, directly or
 * through a chain of overlaps, form one group; each takes the first lane free
 * at its start, and every block in the group shares the group's lane count.
 */
export function layoutTimedLanes(
  blocks: ReadonlyArray<{ id: string; start: number; end: number }>,
): Map<string, TimedLane> {
  const sorted = [...blocks].sort(
    (left, right) =>
      left.start - right.start ||
      right.end - left.end ||
      left.id.localeCompare(right.id),
  );
  const result = new Map<string, TimedLane>();
  let group: string[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -Infinity;
  const closeGroup = () => {
    for (const id of group) result.get(id)!.lanes = laneEnds.length;
    group = [];
    laneEnds = [];
  };
  for (const block of sorted) {
    if (block.start >= groupEnd) closeGroup();
    let lane = laneEnds.findIndex((end) => end <= block.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = block.end;
    result.set(block.id, { lane, lanes: 1 });
    group.push(block.id);
    groupEnd = group.length === 1 ? block.end : Math.max(groupEnd, block.end);
  }
  closeGroup();
  return result;
}
