import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthenticatedActor, getOptionalAuthenticatedActor } from "./identityShared";
import {
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
const recordedActorKind = v.optional(
  v.union(v.literal("user"), v.literal("ai")),
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
const policyPatch = {
  preset: v.optional(policyValues.preset),
  contentDirection: v.optional(policyValues.contentDirection),
  discovery: v.optional(policyValues.discovery),
  structure: v.optional(policyValues.structure),
  cloudContent: v.optional(policyValues.cloudContent),
  localMirrorGrantId: v.optional(v.union(v.string(), v.null())),
  includeGlobs: v.optional(v.array(v.string())),
  excludeGlobs: v.optional(v.array(v.string())),
  timing: v.optional(policyValues.timing),
  protectedOriginal: v.optional(v.boolean()),
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
  const policyRows = await Promise.all(
    (Object.entries(requested) as Array<
      [SyncPolicyScopeKind, string | undefined]
    >)
      .filter((entry): entry is [SyncPolicyScopeKind, string] => Boolean(entry[1]))
      .map(([kind, scopeId]) =>
        ctx.db
          .query("syncPolicies")
          .withIndex("by_account_scope", (q) =>
            q.eq("accountId", accountId).eq("scopeKind", kind).eq("scopeId", scopeId),
          )
          .unique(),
      ),
  );
  for (const policy of policyRows) {
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

/** Payload bytes may enter Spectra only when the effective policy for the
 * exact work permits full cloud content. Call this at both upload issuance and
 * commit time so a policy change cannot race an already-issued URL. */
export async function assertPayloadWriteAllowed(
  ctx: QueryCtx | MutationCtx,
  accountId: Id<"accounts">,
  workId: Id<"spectraArtifacts">,
  mountId?: Id<"bridgeMounts">,
) {
  const policy = await computeEffectivePolicy(ctx, accountId, {
    account: String(accountId),
    mount: mountId ? String(mountId) : undefined,
    item: String(workId),
  });
  if (policy.cloudContent !== "full")
    throw new Error(
      policy.cloudContent === "none"
        ? "CLOUD_CONTENT_DISABLED"
        : "CLOUD_CONTENT_METADATA_ONLY",
    );
  return policy;
}

export const effective = query({
  args: { mountId: v.optional(v.string()), workspaceId: v.optional(v.string()), folderId: v.optional(v.string()), itemId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const actor = await getOptionalAuthenticatedActor(ctx);
    if (!actor) return null;
    return computeEffectivePolicy(ctx, actor.accountId, { account: String(actor.accountId), mount: args.mountId, workspace: args.workspaceId, folder: args.folderId, item: args.itemId });
  },
});

export const override = mutation({
  args: {
    scopeKind,
    scopeId: v.string(),
    values: v.object(policyValues),
    idempotencyKey: v.string(),
    actorKind: recordedActorKind,
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
      actorKind: args.actorKind === "ai" ? "ai" : "user",
      idempotencyKey,
      createdAt: now,
    });
    return { changed: true, policyId, changeId };
  },
});

export const overrideAccount = mutation({
  args: {
    values: v.object(policyValues),
    idempotencyKey: v.string(),
    actorKind: recordedActorKind,
  },
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
    const changeId = await ctx.db.insert("syncPolicyChanges", { accountId: actor.accountId, scopeKind: "account", scopeId, action: "override", before: policySnapshot(existing), after: policySnapshot(next), actorKind: args.actorKind === "ai" ? "ai" : "user", idempotencyKey: args.idempotencyKey, createdAt: now });
    return { changed: true, policyId, changeId };
  },
});

/** Apply a partial item policy without widening it to the account scope. The
 * current effective value is resolved per item so inherited folder/workspace
 * policy is preserved before the requested fields are overlaid. */
export const patchItems = mutation({
  args: {
    itemIds: v.array(v.string()),
    patch: v.object(policyPatch),
    idempotencyKey: v.string(),
    actorKind: recordedActorKind,
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const itemIds = [...new Set(args.itemIds.map((id) => id.trim()).filter(Boolean))];
    if (itemIds.length === 0 || itemIds.length > 100) throw new Error("SYNC_POLICY_TARGETS_INVALID");
    const rootKey = args.idempotencyKey.trim();
    if (!rootKey || rootKey.length > 160) throw new Error("SYNC_POLICY_IDEMPOTENCY_KEY_INVALID");
    const results = [];
    for (const itemId of itemIds) {
      const key = `${rootKey}:${itemId}`.slice(0, 200);
      const duplicate = await ctx.db.query("syncPolicyChanges").withIndex("by_account_key", (q) =>
        q.eq("accountId", actor.accountId).eq("idempotencyKey", key),
      ).unique();
      if (duplicate) {
        results.push({ itemId, changed: false, changeId: duplicate._id });
        continue;
      }
      const effective = await computeEffectivePolicy(ctx, actor.accountId, { item: itemId });
      const existing = await ctx.db.query("syncPolicies").withIndex("by_account_scope", (q) =>
        q.eq("accountId", actor.accountId).eq("scopeKind", "item").eq("scopeId", itemId),
      ).unique();
      const next = {
        ...effective,
        ...args.patch,
        localMirrorGrantId: args.patch.localMirrorGrantId === null
          ? undefined
          : (args.patch.localMirrorGrantId ?? effective.localMirrorGrantId),
        includeGlobs: [...new Set((args.patch.includeGlobs ?? effective.includeGlobs).map((glob) => glob.trim()).filter(Boolean))],
        excludeGlobs: [...new Set((args.patch.excludeGlobs ?? effective.excludeGlobs).map((glob) => glob.trim()).filter(Boolean))],
      };
      if (next.includeGlobs.length > 100 || next.excludeGlobs.length > 100)
        throw new Error("SYNC_POLICY_FILTER_LIMIT");
      const now = Date.now();
      const policyId = existing
        ? (await ctx.db.patch(existing._id, { ...next, updatedAt: now }), existing._id)
        : await ctx.db.insert("syncPolicies", { accountId: actor.accountId, scopeKind: "item", scopeId: itemId, ...next, createdAt: now, updatedAt: now });
      const changeId = await ctx.db.insert("syncPolicyChanges", {
        accountId: actor.accountId,
        scopeKind: "item",
        scopeId: itemId,
        action: "override",
        before: policySnapshot(existing),
        after: policySnapshot(next),
        actorKind: args.actorKind === "ai" ? "ai" : "user",
        idempotencyKey: key,
        createdAt: now,
      });
      results.push({ itemId, changed: true, policyId, changeId });
    }
    return { changed: results.filter((result) => result.changed).length, results };
  },
});

export const revert = mutation({
  args: {
    scopeKind,
    scopeId: v.string(),
    idempotencyKey: v.string(),
    actorKind: recordedActorKind,
  },
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
      actorKind: args.actorKind === "ai" ? "ai" : "user",
      idempotencyKey,
      createdAt: now,
    });
    return { changed: Boolean(existing), changeId };
  },
});
