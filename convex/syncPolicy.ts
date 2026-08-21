import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";
import {
  POLICY_PRESETS,
  resolveEffectivePolicy,
  type EffectiveSyncPolicy,
  type ScopedSyncPolicy,
  type SyncPolicyScopeKind,
} from "../shared/sync-policy";

export { POLICY_PRESETS } from "../shared/sync-policy";
export type { EffectiveSyncPolicy } from "../shared/sync-policy";

const scopeKind = v.union(
  v.literal("account"),
  v.literal("mount"),
  v.literal("workspace"),
  v.literal("folder"),
  v.literal("item"),
);
const preset = v.union(
  v.literal("spectra"),
  v.literal("device"),
  v.literal("both"),
  v.literal("linked"),
);
const policyValues = {
  preset,
  contentDirection: v.union(
    v.literal("local-to-spectra"),
    v.literal("spectra-to-local"),
    v.literal("bidirectional"),
    v.literal("manual"),
  ),
  discovery: v.union(v.literal("auto"), v.literal("ask"), v.literal("explicit")),
  structure: v.union(
    v.literal("independent"),
    v.literal("mirror-to-disk"),
    v.literal("mirror-from-disk"),
    v.literal("mirror-both"),
    v.literal("ask"),
  ),
  cloudContent: v.union(
    v.literal("full"),
    v.literal("metadata-only"),
    v.literal("none"),
  ),
  localMirrorGrantId: v.optional(v.string()),
  includeGlobs: v.array(v.string()),
  excludeGlobs: v.array(v.string()),
  timing: v.union(
    v.literal("continuous"),
    v.literal("on-save-open"),
    v.literal("manual"),
  ),
  protectedOriginal: v.boolean(),
};

function policySnapshot(policy: {
  preset: string;
  contentDirection: string;
  discovery: string;
  structure: string;
  cloudContent: string;
  localMirrorGrantId?: string;
  includeGlobs: string[];
  excludeGlobs: string[];
  timing: string;
  protectedOriginal: boolean;
} | null) {
  if (!policy) return undefined;
  return {
    preset: policy.preset,
    contentDirection: policy.contentDirection,
    discovery: policy.discovery,
    structure: policy.structure,
    cloudContent: policy.cloudContent,
    localMirrorGrantId: policy.localMirrorGrantId,
    includeGlobs: policy.includeGlobs,
    excludeGlobs: policy.excludeGlobs,
    timing: policy.timing,
    protectedOriginal: policy.protectedOriginal,
  };
}

export async function computeEffectivePolicy(
  ctx: QueryCtx | MutationCtx,
  accountId: Id<"accounts">,
  scopes: Partial<Record<SyncPolicyScopeKind, string>>,
): Promise<EffectiveSyncPolicy> {
  const requested = { ...scopes, account: scopes.account ?? String(accountId) };
  const policies: ScopedSyncPolicy[] = [];
  for (const [kind, scopeId] of Object.entries(requested) as Array<
    [SyncPolicyScopeKind, string | undefined]
  >) {
    if (!scopeId) continue;
    const policy = await ctx.db
      .query("syncPolicies")
      .withIndex("by_account_scope", (q) =>
        q.eq("accountId", accountId).eq("scopeKind", kind).eq("scopeId", scopeId),
      )
      .unique();
    if (!policy) continue;
    const {
      _id: _id,
      _creationTime: _creationTime,
      accountId: _accountId,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...values
    } = policy;
    policies.push(values);
  }
  return resolveEffectivePolicy(requested, policies);
}

export const effective = query({
  args: { mountId: v.optional(v.string()), workspaceId: v.optional(v.string()), folderId: v.optional(v.string()), itemId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    return computeEffectivePolicy(ctx, actor.accountId, { account: String(actor.accountId), mount: args.mountId, workspace: args.workspaceId, folder: args.folderId, item: args.itemId });
  },
});

export const override = mutation({
  args: {
    scopeKind,
    scopeId: v.string(),
    values: v.object(policyValues),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const scopeId = args.scopeId.trim();
    if (!scopeId || scopeId.length > 200) throw new Error("SYNC_POLICY_SCOPE_INVALID");
    if (args.scopeKind === "account" && scopeId !== String(actor.accountId))
      throw new Error("SYNC_POLICY_ACCOUNT_SCOPE_INVALID");
    const idempotencyKey = args.idempotencyKey.trim();
    if (!idempotencyKey || idempotencyKey.length > 200)
      throw new Error("SYNC_POLICY_IDEMPOTENCY_KEY_INVALID");
    const existingChange = await ctx.db
      .query("syncPolicyChanges")
      .withIndex("by_account_key", (q) =>
        q.eq("accountId", actor.accountId).eq("idempotencyKey", idempotencyKey),
      )
      .unique();
    if (existingChange) return { changed: false, changeId: existingChange._id };
    const existing = await ctx.db
      .query("syncPolicies")
      .withIndex("by_account_scope", (q) =>
        q.eq("accountId", actor.accountId).eq("scopeKind", args.scopeKind).eq("scopeId", scopeId),
      )
      .unique();
    const now = Date.now();
    const next = {
      ...args.values,
      includeGlobs: [...new Set(args.values.includeGlobs.map((glob) => glob.trim()).filter(Boolean))],
      excludeGlobs: [...new Set(args.values.excludeGlobs.map((glob) => glob.trim()).filter(Boolean))],
    };
    if (next.includeGlobs.length > 100 || next.excludeGlobs.length > 100)
      throw new Error("SYNC_POLICY_FILTER_LIMIT");
    const policyId = existing
      ? (await ctx.db.patch(existing._id, { ...next, updatedAt: now }), existing._id)
      : await ctx.db.insert("syncPolicies", {
          accountId: actor.accountId,
          scopeKind: args.scopeKind,
          scopeId,
          ...next,
          createdAt: now,
          updatedAt: now,
        });
    const changeId = await ctx.db.insert("syncPolicyChanges", {
      accountId: actor.accountId,
      scopeKind: args.scopeKind,
      scopeId,
      action: "override",
      before: policySnapshot(existing),
      after: policySnapshot(next),
      actorKind: "user",
      idempotencyKey,
      createdAt: now,
    });
    return { changed: true, policyId, changeId };
  },
});

export const overrideAccount = mutation({
  args: { values: v.object(policyValues), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const scopeId = String(actor.accountId);
    const existingChange = await ctx.db.query("syncPolicyChanges").withIndex("by_account_key", (q) => q.eq("accountId", actor.accountId).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (existingChange) return { changed: false, changeId: existingChange._id };
    const existing = await ctx.db.query("syncPolicies").withIndex("by_account_scope", (q) => q.eq("accountId", actor.accountId).eq("scopeKind", "account").eq("scopeId", scopeId)).unique();
    const now = Date.now();
    const next = { ...args.values, includeGlobs: [...new Set(args.values.includeGlobs.map((glob) => glob.trim()).filter(Boolean))], excludeGlobs: [...new Set(args.values.excludeGlobs.map((glob) => glob.trim()).filter(Boolean))] };
    const policyId = existing
      ? (await ctx.db.patch(existing._id, { ...next, updatedAt: now }), existing._id)
      : await ctx.db.insert("syncPolicies", { accountId: actor.accountId, scopeKind: "account", scopeId, ...next, createdAt: now, updatedAt: now });
    const changeId = await ctx.db.insert("syncPolicyChanges", { accountId: actor.accountId, scopeKind: "account", scopeId, action: "override", before: policySnapshot(existing), after: policySnapshot(next), actorKind: "user", idempotencyKey: args.idempotencyKey, createdAt: now });
    return { changed: true, policyId, changeId };
  },
});

export const revert = mutation({
  args: { scopeKind, scopeId: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    if (args.scopeKind === "account") throw new Error("SYNC_POLICY_ACCOUNT_CANNOT_REVERT");
    const scopeId = args.scopeId.trim();
    const idempotencyKey = args.idempotencyKey.trim();
    if (!scopeId || !idempotencyKey) throw new Error("SYNC_POLICY_REVERT_INVALID");
    const existingChange = await ctx.db
      .query("syncPolicyChanges")
      .withIndex("by_account_key", (q) =>
        q.eq("accountId", actor.accountId).eq("idempotencyKey", idempotencyKey),
      )
      .unique();
    if (existingChange) return { changed: false, changeId: existingChange._id };
    const existing = await ctx.db
      .query("syncPolicies")
      .withIndex("by_account_scope", (q) =>
        q.eq("accountId", actor.accountId).eq("scopeKind", args.scopeKind).eq("scopeId", scopeId),
      )
      .unique();
    const now = Date.now();
    if (existing) await ctx.db.delete(existing._id);
    const changeId = await ctx.db.insert("syncPolicyChanges", {
      accountId: actor.accountId,
      scopeKind: args.scopeKind,
      scopeId,
      action: "revert",
      before: policySnapshot(existing),
      actorKind: "user",
      idempotencyKey,
      createdAt: now,
    });
    return { changed: Boolean(existing), changeId };
  },
});
