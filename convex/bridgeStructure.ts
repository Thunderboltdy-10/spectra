import { v } from "convex/values";
import { mutation } from "./functions";
import { getAuthenticatedActor } from "./identityShared";
import { getActorForAccountId } from "./identityShared";
import { computeEffectivePolicy } from "./syncPolicy";
import {
  decideStructureOperation,
  collisionSafeRelativePath,
  initialStructureRequestState,
} from "../shared/sync-policy";
import { z } from "zod";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { BRIDGE_CLAIM_REDRIVE_MS } from "../shared/replica-truth";
import { evaluateAccessForActor } from "./authorityShared";
import { syncRetryAt } from "../shared/sync-retry-policy";

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requireDevice(ctx: Parameters<typeof getActorForAccountId>[0], credential: string) {
  const credentialHash = await digest(z.string().min(32).max(256).parse(credential));
  const device = await ctx.db.query("bridgeDevices").withIndex("by_credential_hash", (q) => q.eq("credentialHash", credentialHash)).unique();
  if (!device || device.state !== "active") throw new Error("BRIDGE_CREDENTIAL_INVALID");
  const actor = await getActorForAccountId(ctx, device.accountId);
  if (!actor) throw new Error("BRIDGE_ACCOUNT_UNAVAILABLE");
  return { device, actor };
}

const DELETED_WORK_ERROR = "work-no-longer-exists";
const DELETED_WORK_MESSAGE = "The work no longer exists. Try again with another item.";

async function failDeletedStructureRequest(
  ctx: MutationCtx,
  request: { _id: Id<"bridgeFsRequests">; replicaId: Id<"workReplicas"> },
  now: number,
) {
  await ctx.db.patch(request._id, {
    state: "failed",
    errorCode: DELETED_WORK_ERROR,
    errorMessage: DELETED_WORK_MESSAGE,
    claimedAt: undefined,
    updatedAt: now,
  });
  const replica = await ctx.db.get(request.replicaId);
  if (replica) {
    await ctx.db.patch(replica._id, {
      state: "unavailable",
      unavailableReason: DELETED_WORK_ERROR,
      errorCode: DELETED_WORK_ERROR,
      errorMessage: DELETED_WORK_MESSAGE,
      errorAt: now,
      payloadRef: undefined,
      pendingPayloadRef: undefined,
      pendingContentHash: undefined,
      pendingBaseRevision: undefined,
      projectionBasePayloadRef: undefined,
      projectionBaseRevision: undefined,
      projectionBaseContent: undefined,
      projectionBaseContentHash: undefined,
      projectionBaseTextIndex: undefined,
      projectionBaseFidelityMap: undefined,
      updatedAt: now,
    });
  }
}

const relativePath = z.string().trim().min(1).max(1024).refine((value) =>
  !value.startsWith("/") && !/^[A-Za-z]:/.test(value) && !value.split(/[\\/]/).includes(".."),
);

async function rememberedDecision(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  input: { nodeId?: Id<"orgNodes">; workId: Id<"spectraArtifacts">; mountId: Id<"bridgeMounts"> },
  direction: "spectra-to-disk" | "disk-to-spectra",
) {
  const scopes: ReadonlyArray<readonly ["folder" | "item" | "mount" | "account", string]> = [
    ...(input.nodeId ? [["folder", String(input.nodeId)] as const] : []),
    ["item", String(input.workId)] as const,
    ["mount", String(input.mountId)] as const,
    ["account", String(accountId)] as const,
  ];
  for (const [scopeKind, scopeId] of scopes) {
    const decision = await ctx.db.query("syncStructureDecisions")
      .withIndex("by_account_scope_direction", (q) => q.eq("accountId", accountId).eq("scopeKind", scopeKind).eq("scopeId", scopeId).eq("direction", direction))
      .unique();
    if (decision) return decision;
  }
  return null;
}

export async function enqueueStructureRequest(
  ctx: MutationCtx,
  accountId: Id<"accounts">,
  workId: Id<"spectraArtifacts">,
  kind: "move" | "rename" | "delete",
  sourceRelativePath: string,
  targetRelativePath?: string,
  nodeId?: Id<"orgNodes">,
) {
  const replica = (await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", workId).eq("kind", "local")).take(20)).find((candidate) => candidate.state !== "unavailable");
  if (!replica?.deviceId || !replica.mountId || !replica.localResourceId) return null;
  const mount = await ctx.db.get(replica.mountId);
  const device = await ctx.db.get(replica.deviceId);
  if (!mount || mount.state !== "active" || !device || device.state !== "active") return null;
  const policy = await computeEffectivePolicy(ctx, accountId, { account: String(accountId), mount: String(mount._id), item: String(workId) });
  let decision = decideStructureOperation(policy.structure, "spectra-to-disk");
  if (mount.selectedFile && kind !== "delete") decision = "ignore";
  if (decision === "ask") {
    const remembered = await rememberedDecision(ctx, accountId, { nodeId, workId, mountId: mount._id }, "spectra-to-disk");
    if (remembered) decision = remembered.action;
  }
  const idempotencyKey = `structure:${workId}:${replica.updatedAt}:${kind}:${sourceRelativePath}:${targetRelativePath ?? ""}`;
  const existing = await ctx.db.query("bridgeFsRequests").withIndex("by_account_key", (q) => q.eq("accountId", accountId).eq("idempotencyKey", idempotencyKey)).unique();
  if (existing) return existing._id;
  const now = Date.now();
  const state = initialStructureRequestState(
    decision,
    "spectra-to-disk",
    kind,
  );
  return ctx.db.insert("bridgeFsRequests", {
    accountId, workId, replicaId: replica._id, deviceId: device._id, mountId: mount._id, nodeId,
    localResourceId: replica.localResourceId, direction: "spectra-to-disk", kind,
    sourceRelativePath: relativePath.parse(sourceRelativePath).replaceAll("\\", "/"),
    targetRelativePath: targetRelativePath ? relativePath.parse(targetRelativePath).replaceAll("\\", "/") : undefined,
    idempotencyKey,
    baseRevision: replica.revision,
    state,
    explanation:
      state === "ignored"
        ? mount.selectedFile
          ? "This file was selected on its own. Its name and location on disk stay the same."
          : "This policy keeps Spectra organization independent from the folder on disk."
        : kind === "delete"
          ? "Confirm moving 1 real file to the Recycle Bin. The Spectra item is already in Trash."
          : state === "approval-required"
            ? "Choose whether this organization change should also change the file on disk."
            : "This organization change will be mirrored to the selected folder.",
    createdAt: now,
    updatedAt: now,
  });
}

export const request = mutation({
  args: {
    workId: v.id("spectraArtifacts"),
    replicaId: v.optional(v.id("workReplicas")),
    nodeId: v.optional(v.id("orgNodes")),
    kind: v.union(v.literal("move"), v.literal("rename"), v.literal("delete")),
    sourceRelativePath: v.string(),
    targetRelativePath: v.optional(v.string()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const work = await ctx.db.get(args.workId);
    if (!work || work.ownerAccountId !== actor.accountId) throw new Error("WORK_NOT_FOUND");
    const replica = args.replicaId
      ? await ctx.db.get(args.replicaId)
      : (await ctx.db.query("workReplicas").withIndex("by_work_kind", (q) => q.eq("workId", args.workId).eq("kind", "local")).take(20)).find((candidate) => candidate.state !== "unavailable");
    if (!replica || replica.workId !== args.workId || replica.kind !== "local" || replica.accountId !== actor.accountId || !replica.deviceId || !replica.mountId || !replica.localResourceId)
      throw new Error("LOCAL_REPLICA_REQUIRED");
    const mount = await ctx.db.get(replica.mountId);
    const device = await ctx.db.get(replica.deviceId);
    if (!mount || mount.state !== "active" || !device || device.state !== "active") throw new Error("MOUNT_NOT_ACTIVE");
    const source = relativePath.parse(args.sourceRelativePath).replaceAll("\\", "/");
    const target = args.targetRelativePath === undefined ? undefined : relativePath.parse(args.targetRelativePath).replaceAll("\\", "/");
    if (mount.selectedFile && (source !== mount.selectedFile || (target !== undefined && target !== mount.selectedFile)))
      throw new Error("This file was selected on its own. Choose its folder to allow moving or renaming files on disk.");
    if ((args.kind === "move" || args.kind === "rename") && !target) throw new Error("STRUCTURE_TARGET_REQUIRED");
    const policy = await computeEffectivePolicy(ctx, actor.accountId, { account: String(actor.accountId), mount: String(mount._id), item: String(args.workId) });
    let decision = decideStructureOperation(policy.structure, "spectra-to-disk");
    if (decision === "ask") {
      const remembered = await rememberedDecision(ctx, actor.accountId, { nodeId: args.nodeId, workId: args.workId, mountId: mount._id }, "spectra-to-disk");
      if (remembered) decision = remembered.action;
    }
    const existing = await ctx.db.query("bridgeFsRequests").withIndex("by_account_key", (q) => q.eq("accountId", actor.accountId).eq("idempotencyKey", args.idempotencyKey)).unique();
    if (existing) return existing;
    const now = Date.now();
    const state = initialStructureRequestState(
      decision,
      "spectra-to-disk",
      args.kind,
    );
    if (state === "ignored") {
      const id = await ctx.db.insert("bridgeFsRequests", {
        accountId: actor.accountId, workId: args.workId, replicaId: replica._id, deviceId: device._id, mountId: mount._id, nodeId: args.nodeId,
        localResourceId: replica.localResourceId, direction: "spectra-to-disk", kind: args.kind, sourceRelativePath: source, targetRelativePath: target,
        idempotencyKey: args.idempotencyKey, baseRevision: replica.revision, state: "ignored", explanation: "This policy keeps Spectra organization independent from the folder on disk.", createdAt: now, updatedAt: now,
      });
      return await ctx.db.get(id);
    }
    const id = await ctx.db.insert("bridgeFsRequests", {
      accountId: actor.accountId, workId: args.workId, replicaId: replica._id, deviceId: device._id, mountId: mount._id, nodeId: args.nodeId,
      localResourceId: replica.localResourceId, direction: "spectra-to-disk", kind: args.kind, sourceRelativePath: source, targetRelativePath: target,
      idempotencyKey: args.idempotencyKey, baseRevision: replica.revision, state,
      explanation: args.kind === "delete"
        ? "Confirm moving 1 real file to the Recycle Bin. The Spectra item is already in Trash."
        : state === "approval-required"
          ? "Choose whether this organization change should also change the file on disk."
          : "This organization change will be mirrored to the selected folder.", createdAt: now, updatedAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const approve = mutation({
  args: { requestId: v.id("bridgeFsRequests"), alwaysHere: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const request = await ctx.db.get(args.requestId);
    if (!request || request.accountId !== actor.accountId || request.state !== "approval-required") throw new Error("STRUCTURE_REQUEST_NOT_APPROVABLE");
    const now = Date.now();
    await ctx.db.patch(request._id, { state: "pending", updatedAt: now });
    if (args.alwaysHere) {
      const policyScope = request.nodeId ? "folder" : "item";
      const scopeId = request.nodeId ? String(request.nodeId) : String(request.workId);
      const existing = await ctx.db.query("syncStructureDecisions")
        .withIndex("by_account_scope_direction", (q) => q.eq("accountId", actor.accountId).eq("scopeKind", policyScope).eq("scopeId", scopeId).eq("direction", request.direction))
        .unique();
      if (existing) await ctx.db.patch(existing._id, { action: "propagate", updatedAt: now });
      else await ctx.db.insert("syncStructureDecisions", { accountId: actor.accountId, scopeKind: policyScope, scopeId, direction: request.direction, action: "propagate", createdAt: now, updatedAt: now });
    }
    return { approved: true, alwaysHere: Boolean(args.alwaysHere) };
  },
});

function matchesStructureClaim(request: Doc<"bridgeFsRequests">, args: { claimGeneration?: number; claimToken?: string }) {
  return request.state === "claimed" && request.claimGeneration === args.claimGeneration && request.claimToken === args.claimToken;
}

export const claim = mutation({
  args: { credential: v.string(), supportsFencing: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { device, actor } = await requireDevice(ctx, args.credential);
    if (!args.supportsFencing) return { request: null, upgradeRequired: true };
    const now = Date.now();
    const pending = await ctx.db.query("bridgeFsRequests").withIndex("by_device_state_retry", (q) => q.eq("deviceId", device._id).eq("state", "pending").lte("retryAt", now)).take(20);
    const abandoned = await ctx.db.query("bridgeFsRequests")
      .withIndex("by_device_state_claimed", (q) => q.eq("deviceId", device._id).eq("state", "claimed").lt("claimedAt", now - BRIDGE_CLAIM_REDRIVE_MS))
      .take(20);
    const request = [...pending, ...abandoned].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!request) return { request: null };
    const work = await ctx.db.get(request.workId);
    if (!work || work.status === "deleted") {
      await failDeletedStructureRequest(ctx, request, now);
      return { request: null };
    }
    const access = await evaluateAccessForActor(ctx, actor, "artifact", request.workId);
    if (!access.allowed || !access.capabilities.includes("modify")) {
      await ctx.db.patch(request._id, { state: "failed", errorCode: "permission-revoked", claimedAt: undefined, updatedAt: now });
      return { request: null };
    }
    const mount = await ctx.db.get(request.mountId);
    if (!mount || mount.state !== "active" || mount.deviceId !== device._id || mount.accountId !== actor.accountId) {
      await ctx.db.patch(request._id, { state: "failed", errorCode: "mount-unavailable", errorMessage: "The selected folder is unavailable.", updatedAt: Date.now() });
      return { request: null };
    }
    const replica = await ctx.db.get(request.replicaId);
    if (!request.baseRevision || !replica || replica.kind !== "local" || replica.state === "unavailable" || replica.accountId !== actor.accountId ||
        replica.workId !== request.workId || replica.deviceId !== device._id || replica.mountId !== request.mountId ||
        replica.localResourceId !== request.localResourceId ||
        replica.revision !== request.baseRevision) {
      await ctx.db.patch(request._id, { state: "conflicted", errorCode: !request.baseRevision ? "structure-base-unavailable" : "stale-revision",
        errorMessage: "The original file revision could not be confirmed. Request the organization change again.",
        claimedAt: undefined, retryAt: undefined, updatedAt: now });
      return { request: null };
    }
    const claimGeneration = (request.claimGeneration ?? 0) + 1;
    const claimToken = crypto.randomUUID();
    await ctx.db.patch(request._id, { state: "claimed", claimedAt: now, claimGeneration, claimToken,
      attemptCount: (request.attemptCount ?? 0) + 1, retryAt: undefined, errorCode: undefined, errorMessage: undefined, updatedAt: now });
    return { request: { requestId: request._id, grantId: mount.grantId, localResourceId: request.localResourceId, kind: request.kind, sourceRelativePath: request.sourceRelativePath, targetRelativePath: request.targetRelativePath, idempotencyKey: request.idempotencyKey, baseRevision: request.baseRevision, claimGeneration, claimToken } };
  },
});

export const refreshClaim = mutation({
  args: { credential: v.string(), requestId: v.id("bridgeFsRequests"), claimGeneration: v.optional(v.number()), claimToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { device, actor } = await requireDevice(ctx, args.credential);
    const request = await ctx.db.get(args.requestId);
    if (!request || request.accountId !== actor.accountId || request.deviceId !== device._id ||
        !request.baseRevision || !matchesStructureClaim(request, args)) return { valid: false };
    const [work, replica, mount] = await Promise.all([ctx.db.get(request.workId), ctx.db.get(request.replicaId), ctx.db.get(request.mountId)]);
    if (!work || work.status === "deleted" || !replica || replica.kind !== "local" || replica.state === "unavailable" || replica.workId !== request.workId ||
        replica.deviceId !== device._id || replica.mountId !== request.mountId || replica.accountId !== actor.accountId ||
        replica.localResourceId !== request.localResourceId || replica.revision !== request.baseRevision ||
        !mount || mount.state !== "active" || mount.deviceId !== device._id || mount.accountId !== actor.accountId) return { valid: false };
    const access = await evaluateAccessForActor(ctx, actor, "artifact", request.workId);
    if (!access.allowed || !access.capabilities.includes("modify")) return { valid: false };
    await ctx.db.patch(request._id, { claimedAt: Date.now(), updatedAt: Date.now() });
    return { valid: true };
  },
});

export const complete = mutation({
  args: { credential: v.string(), requestId: v.id("bridgeFsRequests"), outcome: v.union(v.literal("verified"), v.literal("waiting"), v.literal("failed"), v.literal("conflicted")), actualRelativePath: v.optional(v.string()), claimGeneration: v.optional(v.number()), claimToken: v.optional(v.string()), errorCode: v.optional(v.string()), errorMessage: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { device, actor } = await requireDevice(ctx, args.credential);
    const request = await ctx.db.get(args.requestId);
    if (!request || request.deviceId !== device._id || request.accountId !== device.accountId) throw new Error("STRUCTURE_REQUEST_NOT_OWNED");
    // Replaying a lost response must not alter a later replica move.
    if (["verified", "failed", "conflicted", "ignored"].includes(request.state)) return { state: request.state };
    if (!matchesStructureClaim(request, args)) return { state: request.state, ignored: true, reason: "stale-claim" };
    const now = Date.now();
    const work = await ctx.db.get(request.workId);
    if (!work || work.status === "deleted") {
      await failDeletedStructureRequest(ctx, request, now);
      return { state: "failed" as const };
    }
    const access = await evaluateAccessForActor(ctx, actor, "artifact", request.workId);
    if (!access.allowed || !access.capabilities.includes("modify")) {
      await ctx.db.patch(request._id, { state: "failed", errorCode: "permission-revoked", claimedAt: undefined, updatedAt: now });
      return { state: "failed" as const };
    }
    if (args.outcome === "waiting") {
      const retryAt = syncRetryAt(now, Math.max(1, request.attemptCount ?? 1), request.idempotencyKey);
      await ctx.db.patch(request._id, { state: "pending", retryAt, claimedAt: undefined,
        errorCode: args.errorCode ?? "structure-waiting", errorMessage: args.errorMessage, updatedAt: now });
      return { state: "pending", retryAt };
    }
    const replica = await ctx.db.get(request.replicaId);
    const mount = await ctx.db.get(request.mountId);
    const actualRelativePath = args.actualRelativePath === undefined ? undefined : relativePath.parse(args.actualRelativePath).replaceAll("\\", "/");
    const target = actualRelativePath ?? request.targetRelativePath;
    // A different structural request may already have moved the same bytes
    // while this worker's durable acknowledgement waited for the network.
    const pathStillMatches = replica?.relativePath === request.sourceRelativePath ||
      (request.kind !== "delete" && replica?.relativePath === target);
    if (args.outcome === "verified" && (!replica || replica.kind !== "local" || replica.state === "unavailable" ||
        replica.accountId !== actor.accountId || replica.workId !== request.workId || replica.localResourceId !== request.localResourceId ||
        replica.deviceId !== device._id || replica.mountId !== request.mountId || !mount || mount.state !== "active" ||
        mount.deviceId !== device._id || mount.accountId !== actor.accountId || !pathStillMatches ||
        (request.baseRevision !== undefined && replica.revision !== request.baseRevision))) {
      await ctx.db.patch(request._id, { state: "conflicted", errorCode: "stale-revision", retryAt: undefined, claimedAt: undefined, updatedAt: now });
      return { state: "conflicted" };
    }
    await ctx.db.patch(request._id, { state: args.outcome, actualRelativePath, retryAt: undefined, claimedAt: undefined, errorCode: args.errorCode, errorMessage: args.errorMessage, updatedAt: now });
    if (args.outcome === "verified" && request.kind !== "delete") {
      if (target) await ctx.db.patch(request.replicaId, { relativePath: target, lastVerifiedAt: now, updatedAt: now });
    }
    if (args.outcome === "verified" && request.kind === "delete") await ctx.db.patch(request.replicaId, { state: "unavailable", unavailableReason: "deleted-by-policy", updatedAt: now });
    return { state: args.outcome };
  },
});

export { collisionSafeRelativePath };
