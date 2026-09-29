import { internalQuery } from "./functions";
import { v } from "convex/values";
import { validateDurablePayload } from "./collaborationDurablePayload";

export const candidate = internalQuery({
  args: { snapshotId: v.id("collaborationSnapshots") },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db.get(args.snapshotId);
    if (!snapshot?.payloadRef) throw new Error("COLLABORATION_SNAPSHOT_PAYLOAD_MISSING");
    const payload = await validateDurablePayload(ctx, { artifactId: snapshot.artifactId,
      payloadRef: snapshot.payloadRef, digest: snapshot.payloadDigest ?? "", kind: "yjs-snapshot", byteLength: snapshot.byteLength });
    return { snapshot, storageId: payload.storageId };
  },
});
