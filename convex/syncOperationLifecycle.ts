import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

type ReplicaRevision = {
  replicaId: Id<"workReplicas">;
  revision: string;
};

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
