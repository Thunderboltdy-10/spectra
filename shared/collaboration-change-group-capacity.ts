/**
 * Open changeGroups must not dual-copy hot artifact rows past Convex's 1 MiB
 * document ceiling. Formal-paper / large-sheet content already fits once on
 * spectraArtifacts; embedding baseSnapshot+finalSnapshot doubles it (~1.48 MiB)
 * and blocks durable append with endless Saving retries.
 */
export const MAX_CHANGE_GROUP_SNAPSHOT_JSON_CHARS = 900_000;

export type ChangeGroupSnapshotLike = {
  title: string;
  summary?: string;
  content?: unknown;
  tags: string[];
  $spectraSnapshotOmitted?: boolean;
  contentHash?: string;
  [key: string]: unknown;
};

export function estimateJsonChars(value: unknown): number {
  try {
    const encoded = JSON.stringify(value);
    return typeof encoded === "string" ? encoded.length : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function slimChangeGroupSnapshot(
  snapshot: ChangeGroupSnapshotLike,
  contentHash?: string,
): ChangeGroupSnapshotLike {
  const hash =
    typeof contentHash === "string" && contentHash.length >= 16
      ? contentHash
      : typeof snapshot.contentHash === "string" &&
          snapshot.contentHash.length >= 16
        ? snapshot.contentHash
        : undefined;
  return {
    title: snapshot.title,
    summary: snapshot.summary,
    tags: Array.isArray(snapshot.tags) ? snapshot.tags : [],
    $spectraSnapshotOmitted: true,
    ...(hash ? { contentHash: hash } : {}),
  };
}

/**
 * Keep open change-group rows under the Convex document ceiling.
 * When base+final JSON would exceed the budget, omit inline content and attest
 * with an optional contentHash. Yjs collaborationUpdates remain the durable head.
 */
export function fitChangeGroupSnapshots(
  baseSnapshot: ChangeGroupSnapshotLike,
  finalSnapshot: ChangeGroupSnapshotLike,
  options: { contentHash?: string } = {},
): {
  baseSnapshot: ChangeGroupSnapshotLike;
  finalSnapshot: ChangeGroupSnapshotLike;
  omitted: boolean;
} {
  const inlineChars = estimateJsonChars({
    baseSnapshot,
    finalSnapshot,
  });
  if (inlineChars <= MAX_CHANGE_GROUP_SNAPSHOT_JSON_CHARS) {
    return { baseSnapshot, finalSnapshot, omitted: false };
  }
  const slimBase = slimChangeGroupSnapshot(baseSnapshot, options.contentHash);
  const slimFinal = slimChangeGroupSnapshot(finalSnapshot, options.contentHash);
  if (
    estimateJsonChars({
      baseSnapshot: slimBase,
      finalSnapshot: slimFinal,
    }) > MAX_CHANGE_GROUP_SNAPSHOT_JSON_CHARS
  ) {
    throw new Error("COLLABORATION_CHANGE_GROUP_SIZE");
  }
  return {
    baseSnapshot: slimBase,
    finalSnapshot: slimFinal,
    omitted: true,
  };
}

export function isOmittedChangeGroupSnapshot(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    return false;
  return Boolean(
    (snapshot as ChangeGroupSnapshotLike).$spectraSnapshotOmitted === true,
  );
}
