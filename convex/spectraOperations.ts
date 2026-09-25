import { query } from "./_generated/server";
import { mutation } from "./orgNodeMutation";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getAuthenticatedActor } from "./identityShared";
import { regionDomainsIntersect } from "./regionClaims";
import { projectTimetableSnapshot } from "./quizPrivacy";
import { applicationWriteReceipt } from "./spectraApplicationWriteScope";
import { vUiObserverInterest, vUiObservationFence } from "./spectraUiObservationSchema";
import {
  mergeUiObserverInterest, prepareUiObservation, acknowledgeUiObservation,
  expireUiObservation, uiObservationSnapshot,
} from "./spectraUiObservation";

const uiOperationArgs = { runId: v.id("spectraAiRuns"), executionId: v.string(), operationId: v.id("spectraOperations") };

async function requireUiOperation(ctx: Parameters<typeof requireOwnedRun>[0], args: { runId: Id<"spectraAiRuns">; executionId: string; operationId: Id<"spectraOperations"> }) {
  const run = await requireOwnedRun(ctx, args.runId);
  const operation = await ctx.db.get(args.operationId);
  if (!operation || operation.runId !== run._id || operation.actorType !== "ai" ||
    run.executionId !== args.executionId || operation.executionId !== args.executionId)
    throw new Error("UI_OBSERVATION_STALE");
  if (!applicationWriteReceipt(operation.output) && (run.status !== "running" || operation.status !== "executing"))
    throw new Error("UI_OBSERVATION_INACTIVE");
  return { run, operation };
}

export const setUiObserverInterest = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string(), clientId: v.string(), mode: v.union(v.literal("ordinary"), v.literal("follow"), v.literal("released")) },
  handler: async (ctx, args) => {
    const run = await requireOwnedRun(ctx, args.runId);
    if (run.executionId !== args.executionId || !["queued", "running", "awaiting_confirmation", "awaiting_resolution"].includes(run.status))
      throw new Error("UI_OBSERVATION_INACTIVE");
    const next = mergeUiObserverInterest(run, args.executionId, args);
    if (JSON.stringify(next) !== JSON.stringify(run.uiObserverInterests))
      await ctx.db.patch(run._id, { uiObserverInterests: next });
    return { registered: args.mode !== "released" };
  },
});

export const prepareUiAction = mutation({
  args: uiOperationArgs,
  handler: async (ctx, args) => {
    const { run, operation } = await requireUiOperation(ctx, args);
    return prepareUiObservation(ctx, run, operation);
  },
});

export const readUiAction = query({
  args: uiOperationArgs,
  handler: async (ctx, args) => {
    const { run, operation } = await requireUiOperation(ctx, args);
    return uiObservationSnapshot(run, operation);
  },
});

export const acknowledgeUiAction = mutation({
  args: { ...uiOperationArgs, fence: vUiObservationFence, observer: vUiObserverInterest, outcome: v.union(v.literal("target_ready"), v.literal("invisible"), v.literal("released")) },
  handler: async (ctx, args) => {
    const { run, operation } = await requireUiOperation(ctx, args);
    return acknowledgeUiObservation(ctx, run, operation, { ...args.fence, ...args.observer, outcome: args.outcome });
  },
});

export const expireUiAction = mutation({
  args: { ...uiOperationArgs, epoch: v.number() },
  handler: async (ctx, args) => {
    const { run, operation } = await requireUiOperation(ctx, args);
    if (operation.uiObservation?.epoch !== args.epoch) return uiObservationSnapshot(run, operation);
    return uiObservationSnapshot(run, await expireUiObservation(ctx, run, operation, Date.now()));
  },
});

function artifactSnapshot(artifact: {
  blueprintKey: string;
  title: string;
  summary?: string;
  content: unknown;
  tags: string[];
}) {
  const snapshot = {
    title: artifact.title,
    summary: artifact.summary,
    content: artifact.content,
    tags: artifact.tags,
  };
  return artifact.blueprintKey === "timetable"
    ? projectTimetableSnapshot(snapshot)
    : snapshot;
}

async function requireOwnedRun(
  ctx: Parameters<typeof getAuthenticatedActor>[0],
  runId: Id<"spectraAiRuns">,
) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor)
    throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  const run = await ctx.db.get(runId);
  if (
    !run ||
    run.ownerAccountId !== actor._id ||
    run.schoolId !== actor.schoolId
  )
    throw new Error("AI run not found");
  return run;
}

export const recordPlan = mutation({
  args: {
    runId: v.id("spectraAiRuns"),
    executionId: v.string(),
    operations: v.array(
      v.object({
        type: v.string(),
        input: v.any(),
        requiresConfirmation: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const run = await requireOwnedRun(ctx, args.runId);
    if (run.status !== "running" || run.executionId !== args.executionId)
      throw new Error("This run attempt is no longer active");
    const now = Date.now();
    const operationIds = await Promise.all(
      args.operations.map((operation) =>
        ctx.db.insert("spectraOperations", {
          runId: args.runId,
          executionId: args.executionId,
          actorType: "ai",
          type: operation.type,
          status: "proposed",
          input: operation.input,
          affected: [],
          requiresConfirmation: operation.requiresConfirmation,
          createdAt: now,
        }),
      ),
    );
    return { operationIds };
  },
});

export const listForRun = query({
  args: { runId: v.id("spectraAiRuns") },
  handler: async (ctx, args) => {
    await requireOwnedRun(ctx, args.runId);
    return ctx.db
      .query("spectraOperations")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});

export const conflictForOperation = query({
  args: { operationId: v.id("spectraOperations") },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (
      !operation?.runId ||
      operation.status !== "waiting" ||
      !operation.conflict
    )
      throw new Error("REGION_CONFLICT_UNAVAILABLE");
    const run = await requireOwnedRun(ctx, operation.runId);
    const [artifact, claim] = await Promise.all([
      ctx.db.get(operation.conflict.artifactId),
      ctx.db.get(operation.conflict.claimId),
    ]);
    if (!artifact || !claim || artifact.schoolId !== run.schoolId)
      throw new Error("REGION_CONFLICT_UNAVAILABLE");
    return {
      runId: run._id,
      executionId: operation.executionId,
      operationId: operation._id,
      operationType: operation.type,
      input: operation.input,
      conflict: operation.conflict,
      claimStatus: claim.status,
      artifactType: artifact.blueprintKey,
      currentStateVectorHash:
        artifact.liveStateVectorHash ?? `initial:${artifact._id}`,
      currentSnapshot: artifactSnapshot(artifact),
    };
  },
});

export const attachPendingArtifact = mutation({
  args: {
    operationId: v.id("spectraOperations"),
    artifactId: v.id("spectraArtifacts"),
    executionId: v.string(),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation?.runId || operation.status !== "proposed")
      throw new Error("Operation is no longer pending");
    const run = await requireOwnedRun(ctx, operation.runId);
    if (
      run.status !== "running" ||
      operation.executionId !== run.executionId ||
      run.executionId !== args.executionId
    )
      throw new Error("Operation belongs to an older run attempt");
    const artifact = await ctx.db.get(args.artifactId);
    if (
      !artifact ||
      artifact.ownerAccountId !== run.ownerAccountId ||
      artifact.aiRunId !== run._id ||
      artifact.aiExecutionId !== run.executionId ||
      artifact.aiState !== "creating"
    )
      throw new Error("Pending artifact not found");
    await ctx.db.patch(args.operationId, {
      pendingArtifactId: args.artifactId,
    });
    return { operationId: args.operationId };
  },
});

export const attachPendingWorkspace = mutation({
  args: {
    operationId: v.id("spectraOperations"),
    workspaceId: v.id("spectraWorkspaces"),
    executionId: v.string(),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation?.runId || operation.status !== "proposed")
      throw new Error("Operation is no longer pending");
    const run = await requireOwnedRun(ctx, operation.runId);
    if (
      run.status !== "running" ||
      operation.executionId !== run.executionId ||
      run.executionId !== args.executionId
    )
      throw new Error("Operation belongs to an older run attempt");
    const workspace = await ctx.db.get(args.workspaceId);
    if (
      !workspace ||
      workspace.ownerAccountId !== run.ownerAccountId ||
      workspace.aiRunId !== run._id ||
      workspace.aiExecutionId !== run.executionId ||
      workspace.aiState !== "creating"
    )
      throw new Error("Pending workspace not found");
    await ctx.db.patch(args.operationId, {
      pendingWorkspaceId: args.workspaceId,
    });
    return { operationId: args.operationId };
  },
});

export const claim = mutation({
  args: { operationId: v.id("spectraOperations"), executionId: v.string() },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation?.runId) throw new Error("Operation not found");
    const run = await requireOwnedRun(ctx, operation.runId);
    if (run.status !== "running")
      throw new Error("This run is no longer allowed to apply changes");
    if (
      operation.executionId !== run.executionId ||
      run.executionId !== args.executionId
    )
      throw new Error("Operation belongs to an older run attempt");
    if (operation.status !== "proposed")
      throw new Error("Operation is no longer pending");
    await ctx.db.patch(args.operationId, { status: "executing" });
    return { operationId: args.operationId };
  },
});

export const assertClaimed = mutation({
  args: { operationId: v.id("spectraOperations"), executionId: v.string() },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation?.runId) throw new Error("Operation not found");
    const run = await requireOwnedRun(ctx, operation.runId);
    if (run.status !== "running")
      throw new Error("This run is no longer allowed to apply changes");
    if (
      operation.executionId !== run.executionId ||
      run.executionId !== args.executionId
    )
      throw new Error("Operation belongs to an older run attempt");
    if (operation.status !== "executing")
      throw new Error("Operation is no longer approved for execution");
    return { operationId: args.operationId };
  },
});

export const reopenForCurrentStateRetry = mutation({
  args: { operationId: v.id("spectraOperations"), executionId: v.string() },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation?.runId) throw new Error("Operation not found");
    const run = await requireOwnedRun(ctx, operation.runId);
    if (
      run.status !== "running" ||
      operation.executionId !== run.executionId ||
      run.executionId !== args.executionId
    )
      throw new Error("Operation belongs to an older run attempt");
    if (operation.status !== "executed")
      throw new Error("Only a committed operation can resume from current state");
    await ctx.db.patch(args.operationId, {
      status: "executing",
      output: {
        ...(operation.output &&
        typeof operation.output === "object" &&
        !Array.isArray(operation.output)
          ? operation.output
          : {}),
        currentStateRetryStartedAt: Date.now(),
      },
    });
    return { operationId: args.operationId };
  },
});

export const markExecuted = mutation({
  args: {
    operationId: v.id("spectraOperations"),
    output: v.optional(v.any()),
    executionId: v.string(),
    affected: v.array(v.object({ type: v.string(), id: v.string() })),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation?.runId) throw new Error("Operation not found");
    const run = await requireOwnedRun(ctx, operation.runId);
    if (
      run.status !== "running" ||
      operation.executionId !== run.executionId ||
      run.executionId !== args.executionId
    )
      throw new Error("Operation belongs to an older run attempt");
    if (operation.status !== "executing")
      throw new Error("Operation was not claimed for execution");
    await ctx.db.patch(args.operationId, {
      status: "executed",
      output: applicationWriteReceipt(operation.output)
        ? { ...(args.output && typeof args.output === "object" ? args.output : {}), applicationWriteReceipt: applicationWriteReceipt(operation.output) }
        : args.output,
      affected: args.affected,
      executedAt: Date.now(),
    });
    return { operationId: args.operationId };
  },
});

export const markFailed = mutation({
  args: {
    operationId: v.id("spectraOperations"),
    executionId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation?.runId) throw new Error("Operation not found");
    const run = await requireOwnedRun(ctx, operation.runId);
    if (
      operation.executionId !== run.executionId ||
      run.executionId !== args.executionId
    )
      throw new Error("Operation belongs to an older run attempt");
    await ctx.db.patch(args.operationId, {
      status: "failed",
      // Reporting or transport failure cannot erase an already committed effect.
      // Keep both its receipt and the approved scope for same-attempt recovery.
      output: {
        ...(operation.output && typeof operation.output === "object" && !Array.isArray(operation.output)
          ? operation.output : {}),
        error: args.error,
      },
      executedAt: Date.now(),
    });
    return { operationId: args.operationId };
  },
});

export const pauseForRegionConflict = mutation({
  args: {
    operationId: v.id("spectraOperations"),
    executionId: v.string(),
    artifactId: v.id("spectraArtifacts"),
    claimId: v.id("regionClaims"),
    clientId: v.string(),
    regionId: v.string(),
    blockerActorKind: v.union(v.literal("human"), v.literal("ai")),
    queuePosition: v.number(),
    baseSnapshot: v.optional(v.any()),
    proposedSnapshot: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation?.runId) throw new Error("Operation not found");
    const run = await requireOwnedRun(ctx, operation.runId);
    if (
      run.status !== "running" ||
      operation.executionId !== run.executionId ||
      run.executionId !== args.executionId ||
      operation.status !== "executing"
    )
      throw new Error("Operation is no longer available to pause");
    const [artifact, claim] = await Promise.all([
      ctx.db.get(args.artifactId),
      ctx.db.get(args.claimId),
    ]);
    if (
      !artifact ||
      artifact.schoolId !== run.schoolId ||
      !claim ||
      claim.operationId !== operation._id ||
      claim.runId !== run._id ||
      claim.clientId !== args.clientId ||
      claim.status !== "queued"
    )
      throw new Error("REGION_CONFLICT_STATE_INVALID");
    const now = Date.now();
    await ctx.db.patch(claim._id, {
      leaseExpiresAt: now + 7 * 24 * 60 * 60_000,
      updatedAt: now,
    });
    await ctx.db.patch(operation._id, {
      status: "waiting",
      conflict: {
        claimId: claim._id,
        artifactId: artifact._id,
        clientId: args.clientId,
        regionId: args.regionId.slice(0, 240),
        blockerActorKind: args.blockerActorKind,
        queuePosition: Math.max(1, Math.floor(args.queuePosition)),
        baseSnapshot:
          artifact.blueprintKey === "timetable"
            ? projectTimetableSnapshot(
                args.baseSnapshot ?? artifactSnapshot(artifact),
              )
            : (args.baseSnapshot ?? artifactSnapshot(artifact)),
        proposedSnapshot:
          artifact.blueprintKey === "timetable"
            ? projectTimetableSnapshot(
                args.proposedSnapshot ?? artifact.aiPreview,
              )
            : (args.proposedSnapshot ?? artifact.aiPreview),
        createdAt: now,
      },
    });
    await ctx.db.patch(run._id, {
      status: "awaiting_resolution",
      phase: "conflict",
      workerId: undefined,
      leaseExpiresAt: undefined,
      heartbeatAt: now,
      updatedAt: now,
    });
    const cards = await ctx.db
      .query("spectraResultCards")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .collect();
    await Promise.all(
      cards.map((card) =>
        ctx.db.patch(card._id, {
          status: "awaiting_resolution",
          variant: "operation",
          title: "Edit conflict",
          summary:
            "Another collaborator changed the same region. Compare the current content with Spectra's proposal before applying it.",
          actions: [
            {
              key: "resolve_conflict",
              label: "Review conflict",
              targetType: "run",
              targetId: run._id,
            },
          ],
          updatedAt: now,
        }),
      ),
    );
    return {
      operationId: operation._id,
      runId: run._id,
      status: "awaiting_resolution" as const,
    };
  },
});

export const resumeAfterRegionConflict = mutation({
  args: {
    operationId: v.id("spectraOperations"),
    executionId: v.string(),
    resolution: v.union(
      v.literal("apply"),
      v.literal("keep_current"),
      v.literal("merge"),
      v.literal("cancel"),
    ),
    mergedInput: v.optional(v.any()),
    newBaseStateVectorHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (
      !operation?.runId ||
      operation.status !== "waiting" ||
      !operation.conflict
    )
      throw new Error("REGION_CONFLICT_UNAVAILABLE");
    const run = await requireOwnedRun(ctx, operation.runId);
    if (
      run.status !== "awaiting_resolution" ||
      run.executionId !== args.executionId ||
      operation.executionId !== args.executionId
    )
      throw new Error("REGION_CONFLICT_RUN_STALE");
    const claim = await ctx.db.get(operation.conflict.claimId);
    const applying = args.resolution === "apply" || args.resolution === "merge";
    const now = Date.now();
    if (
      !claim ||
      claim.operationId !== operation._id ||
      claim.runId !== run._id ||
      claim.actorAccountId !== run.ownerAccountId ||
      (claim.status !== "queued" && claim.status !== "paused")
    ) {
      throw new Error(
        "REGION_CONFLICT_NOT_RESOLVED: This proposal is no longer available.",
      );
    }
    if (applying) {
      if (
        !args.newBaseStateVectorHash ||
        args.newBaseStateVectorHash.length < 16
      )
        throw new Error(
          "REGION_CONFLICT_BASE_REQUIRED: Refresh the current artifact before applying.",
        );
      const active = (
        await ctx.db
          .query("regionClaims")
          .withIndex("by_artifact_status", (q) =>
            q.eq("artifactId", claim.artifactId).eq("status", "active"),
          )
          .collect()
      ).filter((candidate) => candidate.leaseExpiresAt > now);
      if (
        active.some((candidate) =>
          regionDomainsIntersect(
            candidate.overlapDomains,
            claim.overlapDomains,
          ),
        )
      ) {
        throw new Error(
          "REGION_CONFLICT_STILL_OCCUPIED: Wait for the active edit to finish.",
        );
      }
      await ctx.db.patch(claim._id, {
        status: "active",
        resolution: args.resolution,
        baseStateVectorHash: args.newBaseStateVectorHash,
        queuePosition: undefined,
        leaseExpiresAt: now + 45_000,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(claim._id, {
        status: "rejected",
        resolution: args.resolution,
        queuePosition: undefined,
        releasedAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(operation._id, {
      status: applying ? "proposed" : "cancelled",
      input:
        args.resolution === "merge" && args.mergedInput !== undefined
          ? args.mergedInput
          : operation.input,
      conflict: undefined,
    });
    await ctx.db.patch(run._id, {
      status: "queued",
      phase: "applying",
      workerId: undefined,
      leaseExpiresAt: undefined,
      heartbeatAt: now,
      updatedAt: now,
    });
    const cards = await ctx.db
      .query("spectraResultCards")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .collect();
    const resultCard = cards[0];
    const actor = await getAuthenticatedActor(ctx);
    if (!resultCard || !actor)
      throw new Error("REGION_CONFLICT_RUN_STALE");
    await Promise.all(
      cards.map((card) =>
        ctx.db.patch(card._id, {
          status: "queued",
          variant: "operation",
          title: applying
            ? "Applying the resolved edit"
            : "Continuing without the conflicting edit",
          summary: applying
            ? "The region is available and Spectra is applying the selected proposal."
            : "Spectra kept the current region and will continue with any remaining independent work.",
          actions: [],
          updatedAt: now,
        }),
      ),
    );
    await ctx.scheduler.runAfter(
      0,
      internal.executionScheduler.dispatchSpectraResume,
      {
        actorClerkId: actor.clerkId,
        runId: run._id,
        resultCardId: resultCard._id,
        executionId: args.executionId,
        conflictOperationId: operation._id,
        collaborationClientId: operation.conflict.clientId,
      },
    );
    return { runId: run._id, operationId: operation._id, queued: true };
  },
});

export const cancelPending = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string() },
  handler: async (ctx, args) => {
    const run = await requireOwnedRun(ctx, args.runId);
    if (run.executionId !== args.executionId)
      throw new Error("This run attempt is no longer active");
    const operations = await ctx.db
      .query("spectraOperations")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    const pending = operations.filter(
      (operation) =>
        operation.status === "proposed" &&
        operation.executionId === args.executionId,
    );
    await Promise.all(
      pending.map((operation) =>
        ctx.db.patch(operation._id, { status: "cancelled" }),
      ),
    );
    return { cancelled: pending.length };
  },
});
