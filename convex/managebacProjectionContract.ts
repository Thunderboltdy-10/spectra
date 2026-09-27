import { v, type Infer } from "convex/values";

/** Persisted on the existing projection while its canonical room update is
 * prepared. It holds provider facts and the provider baseline, never a copy of
 * the person's planner. Only signed ingestion, source reconciliation or an
 * explicit authorized conflict resolution can stage it. */
export const providerProjectionIntent = v.object({
  operationId: v.string(),
  /** Monotonic per projection; each staged generation supersedes the last. */
  generation: v.number(),
  mode: v.union(v.literal("refresh"), v.literal("removed"), v.literal("rebase"), v.literal("keep_overlay")),
  syncRunId: v.id("externalSyncRuns"),
  /** Explicit resolutions count against their conflict, never a finished run. */
  conflictId: v.optional(v.id("externalSyncConflicts")),
  /** The authorized sync principal. An administrator imports as themselves. */
  importerAccountId: v.id("accounts"),
  sourceHash: v.string(),
  previousSourceHash: v.string(),
  previousText: v.optional(v.object({
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    summary: v.optional(v.string()),
  })),
  attempts: v.number(),
  nextAttemptAt: v.number(),
  state: v.union(v.literal("pending"), v.literal("failed")),
  error: v.optional(v.string()),
});

export type ProviderProjectionIntent = Infer<typeof providerProjectionIntent>;

export const providerProjectionReceipt = v.object({
  operationId: v.string(),
  generation: v.number(),
  state: v.union(v.literal("committed"), v.literal("unchanged")),
  roomId: v.optional(v.id("collaborationRooms")),
  sequence: v.optional(v.number()),
  versionId: v.optional(v.id("spectraArtifactVersions")),
  completedAt: v.number(),
});
