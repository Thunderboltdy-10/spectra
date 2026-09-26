import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const DELETION_CURSOR_VERSION = "w7-02:v3";
export const DELETION_PAGE_TIMEOUT_MS = 60_000;

type ExpectedCursor = { phase: string; cursor?: string };

export function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function decodeBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

function internalDeletionFunction(name: "dispatch" | "process" | "recover") {
  return (internal as unknown as {
    spectraArtifactDeletion: Record<string, unknown>;
  }).spectraArtifactDeletion[name];
}

export function initialDeletionCursor(
  artifactId: Id<"spectraArtifacts">,
  generation: number,
) {
  return encodeBase64Url(
    JSON.stringify({
      version: DELETION_CURSOR_VERSION,
      artifactId: String(artifactId),
      generation,
      family: "embeds",
      cursor: null,
      embedScope: "source",
    }),
  );
}

export async function queueDeletionProcess(
  ctx: MutationCtx,
  jobId: Id<"artifactDeletionJobs">,
  generation: number,
  attemptId: string,
  expected: ExpectedCursor,
  delay = 0,
) {
  await (ctx.scheduler.runAfter as unknown as (
    delay: number,
    fn: unknown,
    args: unknown,
  ) => Promise<unknown>)(
    delay,
    internalDeletionFunction("process"),
    {
      jobId,
      generation,
      attemptId,
      expectedPhase: expected.phase,
      expectedCursor: expected.cursor,
    },
  );
}

export async function queueDeletionDispatch(
  ctx: MutationCtx,
  jobId: Id<"artifactDeletionJobs">,
  generation: number,
  delay = 0,
  expected?: ExpectedCursor,
) {
  await (ctx.scheduler.runAfter as unknown as (
    delay: number,
    fn: unknown,
    args: unknown,
  ) => Promise<unknown>)(
    delay,
    internalDeletionFunction("dispatch"),
    {
      jobId,
      generation,
      ...(expected
        ? {
            expectedPhase: expected.phase,
            expectedCursor: expected.cursor,
          }
        : {}),
    },
  );
}

export async function queueDeletionRecovery(
  ctx: MutationCtx,
  jobId: Id<"artifactDeletionJobs">,
  generation: number,
  attemptId: string,
  expected: ExpectedCursor,
  delay = DELETION_PAGE_TIMEOUT_MS,
) {
  await (ctx.scheduler.runAfter as unknown as (
    delay: number,
    fn: unknown,
    args: unknown,
  ) => Promise<unknown>)(
    delay,
    internalDeletionFunction("recover"),
    {
      jobId,
      generation,
      attemptId,
      expectedPhase: expected.phase,
      expectedCursor: expected.cursor,
    },
  );
}

/**
 * Start a bounded reconciliation after the last pinned version is released.
 * An active job is merely nudged; a retained job revisits retained children, and
 * a completed/failed job gets a new generation
 * whose cursor starts at the indexed embed family, so this never launches a
 * global unbounded sweep.
 */
export async function ensureArtifactDeletionReconciliation(
  ctx: MutationCtx,
  artifactId: Id<"spectraArtifacts">,
) {
  const artifact = await ctx.db.get(artifactId);
  if (!artifact || artifact.status !== "deleted") return null;
  const existing = await ctx.db
    .query("artifactDeletionJobs")
    .withIndex("by_artifact_generation", (q) => q.eq("artifactId", artifactId))
    .order("desc")
    .first();
  if (existing?.phase === "retained") {
    const now = Date.now();
    // The previous pass intentionally kept pinned versions, intake bytes and
    // runtime output. A final artifact-only check would orphan those children
    // after the last pin disappears. Resume their bounded families in the same
    // generation; completed embed/placement pages do not need to be repeated.
    const cursor = encodeBase64Url(JSON.stringify({ version: DELETION_CURSOR_VERSION,
      artifactId: String(artifactId), generation: existing.generation, family: "versions", cursor: null }));
    await ctx.db.patch(existing._id, { phase: "children", cursor, completedAt: undefined, nextAttemptAt: undefined, updatedAt: now });
    await queueDeletionDispatch(ctx, existing._id, existing.generation, 0, {
      phase: "children",
      cursor,
    });
    return existing._id;
  }
  if (existing && !["complete", "failed", "retained"].includes(existing.phase)) {
    await queueDeletionDispatch(
      ctx,
      existing._id,
      existing.generation,
      0,
      { phase: existing.phase, cursor: existing.cursor },
    );
    return existing._id;
  }

  const now = Date.now();
  const generation = Math.max(
    existing?.generation ?? 0,
    artifact.deletionGeneration ?? 0,
  ) + 1;
  await ctx.db.patch(artifact._id, {
    deletionGeneration: generation,
    updatedAt: now,
  });
  const cursor = initialDeletionCursor(artifact._id, generation);
  const jobId = await ctx.db.insert("artifactDeletionJobs", {
    artifactId: artifact._id,
    ownerAccountId: artifact.ownerAccountId,
    schoolId: artifact.schoolId,
    generation,
    phase: "placements",
    cursor,
    deletedRows: 0,
    releasedBytes: 0,
    scannedRows: 0,
    retainedRows: 0,
    terminalRows: 0,
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  await queueDeletionDispatch(ctx, jobId, generation, 0, {
    phase: "placements",
    cursor,
  });
  return jobId;
}
