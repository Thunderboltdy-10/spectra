import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

type ReplicaRevision = {
  replicaId: Id<"workReplicas">;
  revision: string;
};

type PendingOperation = {
  state: string;
  direction?: string;
  actorKind?: string;
  replicaId?: Id<"workReplicas">;
  revisionAfter?: string;
};

/** Presenter pending work is in-flight writes plus unreconciled external saves
 * whose bytes are still the replica's current revision. Applied cloud writes
 * already have a durable exit and must not keep every surface on Syncing. */
export function isActionablePendingOperation(
  operation: PendingOperation,
  replicaById: ReadonlyMap<string, { revision: string; state?: string }>,
) {
  if (operation.replicaId) {
    const replica = replicaById.get(String(operation.replicaId));
    if (replica?.state === "unavailable") return false;
  }
  if (operation.state === "pending") return true;
  if (operation.state !== "applied") return false;
  if (operation.direction !== "external" || operation.actorKind !== "external-edit")
    return false;
  if (!operation.replicaId) return false;
  const replica = replicaById.get(String(operation.replicaId));
  return Boolean(replica && replica.revision === operation.revisionAfter);
}

/**
 * An external upload is a whole-file snapshot. Once that replica advances,
 * older unreconciled snapshots cannot remain actionable: the newest bytes
 * supersede them. Give those operations a truthful terminal exit so they do
 * not leave every sync presenter permanently busy.
 */
export async function retireSupersededExternalOperations(
  ctx: Pick<MutationCtx, "db">,
  input: {
    workId: Id<"spectraArtifacts">;
    replicaRevisions: readonly ReplicaRevision[];
    now: number;
  },
) {
  const revisionByReplica = new Map(
    input.replicaRevisions.map(({ replicaId, revision }) => [
      String(replicaId),
      revision,
    ]),
  );
  if (!revisionByReplica.size) return 0;

  const recent = await ctx.db
    .query("syncOperations")
    .withIndex("by_work_created", (q) => q.eq("workId", input.workId))
    .order("desc")
    .take(50);
  const superseded = recent.filter((operation) => {
    if (
      operation.direction !== "external" ||
      operation.actorKind !== "external-edit" ||
      operation.state !== "applied" ||
      !operation.replicaId
    ) {
      return false;
    }
    const currentRevision = revisionByReplica.get(String(operation.replicaId));
    return Boolean(
      currentRevision && operation.revisionAfter !== currentRevision,
    );
  });

  await Promise.all(
    superseded.map((operation) =>
      ctx.db.patch(operation._id, {
        state: "failed",
        errorCode: "external-revision-superseded",
        updatedAt: input.now,
      }),
    ),
  );
  return superseded.length;
}

/** A verified Bridge write also reconciles an observed external save when
 * both replicas now name the same exact revision. Keep this bounded to recent
 * operations for the same artifact and local replica. */
export async function verifyReconciledExternalOperations(
  ctx: Pick<MutationCtx, "db">,
  input: {
    workId: Id<"spectraArtifacts">;
    replicaId: Id<"workReplicas">;
    revision: string;
    now: number;
  },
) {
  const recent = await ctx.db
    .query("syncOperations")
    .withIndex("by_work_created", (q) => q.eq("workId", input.workId))
    .order("desc")
    .take(50);
  const reconciled = recent.filter((operation) =>
    operation.direction === "external" &&
    operation.actorKind === "external-edit" &&
    operation.state === "applied" &&
    operation.replicaId === input.replicaId &&
    operation.revisionAfter === input.revision,
  );
  await Promise.all(
    reconciled.map((operation) =>
      ctx.db.patch(operation._id, {
        state: "verified",
        errorCode: undefined,
        updatedAt: input.now,
      }),
    ),
  );
  return reconciled.length;
}
