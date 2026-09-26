export function readDurableRoomAnchor(value) {
  if (!value || typeof value !== "object" || typeof value.roomId !== "string" ||
      !value.roomId || value.roomId.length > 200 || !Number.isSafeInteger(value.nextSequence) ||
      value.nextSequence < 1 || typeof value.frontierHash !== "string" || !/^[a-f0-9]{64}$/.test(value.frontierHash)) return null;
  return { roomId: value.roomId, nextSequence: value.nextSequence, frontierHash: value.frontierHash };
}

export function recoveryRegionIds(values) {
  const regions = [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === "string" && value.length > 0 && value.length <= 500))];
  return regions.length > 128 || regions.includes("artifact:structure") ? ["artifact:structure"] : regions.sort();
}

/** Pending branches keep their actual oldest known ancestor. Unknown ancestry
 * remains unknown; a different tab's clean/younger anchor cannot replace it. */
export function mergeRecoveryAncestry(previous, incoming, previousCovered) {
  const nextAnchor = readDurableRoomAnchor(incoming.recoveryAnchor);
  if (!previous?.pendingRemoteSync || previousCovered) return {
    recoveryAnchor: nextAnchor ?? undefined,
    authoredRegionIds: incoming.pendingRemoteSync ? recoveryRegionIds(incoming.authoredRegionIds) : [],
  };
  const oldAnchor = readDurableRoomAnchor(previous.recoveryAnchor);
  let anchor;
  if (oldAnchor && nextAnchor && oldAnchor.roomId === nextAnchor.roomId &&
      (oldAnchor.nextSequence !== nextAnchor.nextSequence || oldAnchor.frontierHash === nextAnchor.frontierHash))
    anchor = oldAnchor.nextSequence <= nextAnchor.nextSequence ? oldAnchor : nextAnchor;
  return { recoveryAnchor: anchor,
    authoredRegionIds: recoveryRegionIds([...(previous.authoredRegionIds ?? ["artifact:structure"]),
      ...(incoming.authoredRegionIds ?? (incoming.pendingRemoteSync ? ["artifact:structure"] : []))]) };
}
