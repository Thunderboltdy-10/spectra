import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";

export type EffectiveSyncPolicy = Pick<Doc<"syncPolicies">,
  "preset" | "contentDirection" | "discovery" | "structure" | "cloudContent" |
  "localMirrorGrantId" | "includeGlobs" | "excludeGlobs" | "timing" | "protectedOriginal"
> & { source: { kind: Doc<"syncPolicies">["scopeKind"]; id: string } | { kind: "default"; id: "account" } };

export const POLICY_PRESETS: Record<Doc<"syncPolicies">["preset"], Omit<EffectiveSyncPolicy, "source">> = {
  spectra: { preset: "spectra", contentDirection: "manual", discovery: "explicit", structure: "independent", cloudContent: "full", includeGlobs: [], excludeGlobs: [], timing: "continuous", protectedOriginal: false },
  device: { preset: "device", contentDirection: "local-to-spectra", discovery: "auto", structure: "independent", cloudContent: "metadata-only", includeGlobs: [], excludeGlobs: [], timing: "continuous", protectedOriginal: false },
  both: { preset: "both", contentDirection: "bidirectional", discovery: "auto", structure: "independent", cloudContent: "full", includeGlobs: [], excludeGlobs: [], timing: "continuous", protectedOriginal: false },
  linked: { preset: "linked", contentDirection: "manual", discovery: "explicit", structure: "independent", cloudContent: "metadata-only", includeGlobs: [], excludeGlobs: [], timing: "manual", protectedOriginal: true },
};

export async function computeEffectivePolicy(
  ctx: QueryCtx | MutationCtx,
  accountId: Id<"accounts">,
  scopes: Partial<Record<Doc<"syncPolicies">["scopeKind"], string>>,
): Promise<EffectiveSyncPolicy> {
  const precedence = ["item", "folder", "workspace", "mount", "account"] as const;
  for (const kind of precedence) {
    const scopeId = scopes[kind] ?? (kind === "account" ? String(accountId) : undefined);
    if (!scopeId) continue;
    const policy = await ctx.db.query("syncPolicies").withIndex("by_account_scope", (q) =>
      q.eq("accountId", accountId).eq("scopeKind", kind).eq("scopeId", scopeId),
    ).unique();
    if (policy) {
      const { _id, _creationTime, accountId: _accountId, scopeKind, scopeId: id, createdAt: _createdAt, updatedAt: _updatedAt, ...values } = policy;
      return { ...values, source: { kind: scopeKind, id } };
    }
  }
  return { ...POLICY_PRESETS.spectra, source: { kind: "default", id: "account" } };
}

export const effective = query({
  args: { mountId: v.optional(v.string()), workspaceId: v.optional(v.string()), folderId: v.optional(v.string()), itemId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    return computeEffectivePolicy(ctx, actor.accountId, { account: String(actor.accountId), mount: args.mountId, workspace: args.workspaceId, folder: args.folderId, item: args.itemId });
  },
});
