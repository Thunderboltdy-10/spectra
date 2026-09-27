import { v } from "convex/values";
import { query } from "./_generated/server";
import { internalMutation } from "./orgNodeMutation";
import { getAuthenticatedActor, getActorForAccountId } from "./identityShared";
import { requireActorArtifactCapability } from "./authorityShared";
import { queueMaterializationArgs, commitCloudMaterializationArgs,
  queueMaterializationInTransaction, commitCloudMaterializationInTransaction } from "./replicaMaterialization";

export const head = query({
  args: { workId: v.id("spectraArtifacts") },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    await requireActorArtifactCapability(ctx, actor, args.workId, "modify");
    return { accountId: actor.accountId };
  },
});

/** Only the signed Node bridge can attest native readback. Human preparation
 * remains human; AI and history use their own atomic admission mutations. */
export const commitHuman = internalMutation({
  args: {
    accountId: v.id("accounts"), artifactId: v.id("spectraArtifacts"),
    candidate: v.union(v.object({ destination: v.literal("bridge"), queue: queueMaterializationArgs }),
      v.object({ destination: v.literal("cloud"), cloud: commitCloudMaterializationArgs })),
  },
  handler: async (ctx, { accountId, artifactId, candidate }) => {
    const actor = await getActorForAccountId(ctx, accountId);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const args = candidate.destination === "bridge" ? candidate.queue : candidate.cloud;
    if (args.workId !== artifactId) throw new Error("MATERIALIZATION_ARTIFACT_MISMATCH");
    const effects = { actorKind: "user" as const, canonicalProjection: "legacy" as const };
    return candidate.destination === "bridge"
      ? queueMaterializationInTransaction(ctx, actor, candidate.queue, effects)
      : commitCloudMaterializationInTransaction(ctx, actor, candidate.cloud, effects);
  },
});
