import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { normalizeSha256 } from "../shared/intake-integrity";

// Leaf module: row + storage integrity only, no authority imports. Placement
// evidence reads through here so authorityShared never reaches itself again
// via collaborationDurablePayload at module-load time.
export async function validateDurablePayload(ctx: QueryCtx | MutationCtx, args: {
  payloadRef: string; digest: string; artifactId: Id<"spectraArtifacts">;
  kind: "projection" | "yjs-update" | "yjs-snapshot"; byteLength?: number;
  accountId?: Id<"accounts">; policyVersion?: number;
}) {
  const id = ctx.db.normalizeId("collaborationDurablePayloads", args.payloadRef);
  const row = id ? await ctx.db.get(id) : null;
  if (!row || row.status !== "active" || row.artifactId !== args.artifactId ||
    row.kind !== args.kind || row.digest !== args.digest ||
    (args.byteLength !== undefined && row.byteLength !== args.byteLength) ||
    (args.accountId !== undefined && row.accountId !== args.accountId) ||
    (args.policyVersion !== undefined && row.policyVersion !== args.policyVersion))
    throw new Error("COLLABORATION_DURABLE_PAYLOAD_INVALID");
  const metadata = await ctx.db.system.get(row.storageId);
  if (!metadata || metadata.size !== row.byteLength || normalizeSha256(metadata.sha256) !== row.digest)
    throw new Error("COLLABORATION_DURABLE_PAYLOAD_INTEGRITY");
  return row;
}
