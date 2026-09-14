/**
 * Open changeGroups must not dual-copy hot artifact rows past Convex's 1 MiB
 * document ceiling. Formal-paper / large-sheet content already fits once on
 * spectraArtifacts; embedding baseSnapshot+finalSnapshot doubles it (~1.48 MiB)
 * and blocks durable append with endless Saving retries.
 */
export const MAX_CHANGE_GROUP_SNAPSHOT_JSON_CHARS = 900_000;
/**
 * One side of an open changeGroup must leave room for the sibling snapshot plus
 * envelope fields under Convex's ~1 MiB document ceiling. Checkpoint/repair
 * often passes an already-slim baseSnapshot with a full finalSnapshot; the pair
 * can sit under the dual budget while the whole row still Value-too-large.
 */
export const MAX_CHANGE_GROUP_SINGLE_SNAPSHOT_JSON_CHARS = 700_000;

export type ChangeGroupSnapshotLike = {
  title: string;
  summary?: string;
  content?: unknown;
  tags: string[];
  /** Omit marker — must NOT start with '$' (Convex reserved field names). */
  spectraSnapshotOmitted?: boolean;
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
    // Legal Convex field (no leading '$') — content lives on artifact / Yjs head.
    spectraSnapshotOmitted: true,
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
  const baseChars = estimateJsonChars(baseSnapshot);
  const finalChars = estimateJsonChars(finalSnapshot);
  const inlineChars = estimateJsonChars({
    baseSnapshot,
    finalSnapshot,
  });
  const needsOmit =
    inlineChars > MAX_CHANGE_GROUP_SNAPSHOT_JSON_CHARS ||
    baseChars > MAX_CHANGE_GROUP_SINGLE_SNAPSHOT_JSON_CHARS ||
    finalChars > MAX_CHANGE_GROUP_SINGLE_SNAPSHOT_JSON_CHARS;
  if (!needsOmit) {
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
    (snapshot as ChangeGroupSnapshotLike).spectraSnapshotOmitted === true,
  );
}

export const CONTENT_ADDRESSED_BLUEPRINT_KEYS = [
  "presentation",
  "sheets",
  "code",
  "whiteboard",
] as const;

export function baseSnapshotStrategyForType(
  typeKey: string,
): "normalized" | "content_addressed" {
  return (CONTENT_ADDRESSED_BLUEPRINT_KEYS as readonly string[]).includes(typeKey)
    ? "content_addressed"
    : "normalized";
}

/**
 * spectraArtifactVersions dual-inlines before+after for normalized docs.
 * Large formal-paper (~2× hot row) still Value-too-large at commit/idle even
 * after open changeGroups omit. Promote to content_addressed so payloads live
 * only in artifactSnapshotObjects (snapshotRef / beforeSnapshotRef).
 */
export function resolveCommitSnapshotStrategy(
  typeKey: string,
  before: unknown,
  after: unknown,
): {
  strategy: "normalized" | "content_addressed";
  inline: boolean;
  promotedOffRow: boolean;
} {
  const base = baseSnapshotStrategyForType(typeKey);
  if (base === "content_addressed") {
    return { strategy: base, inline: false, promotedOffRow: false };
  }
  if (
    estimateJsonChars({ before, after }) <= MAX_CHANGE_GROUP_SNAPSHOT_JSON_CHARS
  ) {
    return { strategy: "normalized", inline: true, promotedOffRow: false };
  }
  return {
    strategy: "content_addressed",
    inline: false,
    promotedOffRow: true,
  };
}
