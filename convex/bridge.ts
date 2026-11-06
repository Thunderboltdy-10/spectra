import { v } from "convex/values";
import { internalMutation, mutation, query } from "./functions";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { getAuthenticatedActor, getOptionalAuthenticatedActor } from "./identityShared";
import { z } from "zod";
import { createFolderNode, findNodesForSource, trashNode } from "./orgTreeShared";
import type { SyncPolicyValues } from "../shared/sync-policy";
import { syncOperationForBridgeWrite } from "./bridgeWriteOperations";

const REVOCATION_BATCH_DELAY_MS = 100;
const REVOCATION_STEPS = [
  { kind: "replica", state: "current", limit: 100 },
  { kind: "replica", state: "ahead", limit: 100 },
  { kind: "replica", state: "behind", limit: 100 },
  { kind: "replica", state: "diverged", limit: 100 },
  { kind: "replica", state: "pending", limit: 100 },
  { kind: "replica", state: "error", limit: 100 },
  { kind: "mount", state: "active", limit: 100 },
  { kind: "mount", state: "detached", limit: 100 },
  { kind: "write", state: "pending", limit: 10 },
  { kind: "write", state: "claimed", limit: 10 },
  { kind: "structure", state: "approval-required", limit: 25 },
  { kind: "structure", state: "pending", limit: 25 },
  { kind: "structure", state: "claimed", limit: 25 },
] as const;

const originSchema = z.string().url().refine((value) => {
  const url = new URL(value); return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
}, "Origin must be HTTPS or localhost");

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomSecret() { return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", ""); }

async function failRevokedWrite(
  ctx: MutationCtx,
  request: Doc<"bridgeWriteRequests">,
  now: number,
) {
  await ctx.db.patch(request._id, {
    state: "failed",
    errorCode: "device-revoked",
    errorMessage: "The target Bridge device was revoked.",
    claimedAt: undefined,
    retryAt: undefined,
    updatedAt: now,
  });
  const operation = await syncOperationForBridgeWrite(ctx, request);
  if (operation) {
    await ctx.db.patch(operation._id, {
      state: "failed",
      errorCode: "device-revoked",
      updatedAt: now,
    });
  }

  const transitions = await ctx.db.query("storageStrategyTransitions")
    .withIndex("by_work_created", (q) => q.eq("workId", request.workId))
    .order("desc")
    .take(20);
  const transition = transitions.find((candidate) =>
    candidate.state === "pending" &&
    String((candidate.after as { materializationRequestId?: string } | undefined)?.materializationRequestId ?? "") === String(request._id),
  );
  if (!transition) return;
  const before = transition.before as { hadItemPolicy?: boolean; policy?: SyncPolicyValues };
  const policy = await ctx.db.query("syncPolicies")
    .withIndex("by_account_scope", (q) =>
      q.eq("accountId", transition.accountId)
        .eq("scopeKind", "item")
        .eq("scopeId", String(transition.workId)),
    )
    .unique();
  if (policy && before.hadItemPolicy && before.policy) {
    await ctx.db.patch(policy._id, { ...before.policy, updatedAt: now });
  } else if (policy) {
    await ctx.db.delete(policy._id);
  }
  await ctx.db.patch(transition._id, {
    state: "failed",
    errorCode: "device-revoked",
    updatedAt: now,
  });
}

export const requestPairing = mutation({
  args: { browserOrigin: v.string() },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx); if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const browserOrigin = originSchema.parse(args.browserOrigin); const challenge = randomSecret();
    const shortCode = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
    await ctx.db.insert("bridgePairingChallenges", { accountId: actor.accountId, challengeHash: await digest(challenge), shortCode, browserOrigin, expiresAt: Date.now() + 10 * 60_000 });
    return { challenge, shortCode, expiresAt: Date.now() + 10 * 60_000 };
  },
});

export const confirmPairing = mutation({
  args: { challenge: v.string(), shortCode: v.string(), installationId: v.string(), deviceName: v.string(), platform: v.string(), appVersion: v.string(), protocolVersion: v.string() },
  handler: async (ctx, args) => {
    const challengeHash = await digest(z.string().min(32).max(256).parse(args.challenge));
    const row = await ctx.db.query("bridgePairingChallenges").withIndex("by_challenge_hash", (q) => q.eq("challengeHash", challengeHash)).unique();
    if (!row || row.expiresAt <= Date.now() || row.consumedAt || row.shortCode !== args.shortCode) throw new Error("PAIRING_CHALLENGE_INVALID");
    const credential = randomSecret(); const now = Date.now();
    const installationId = z.string().uuid().parse(args.installationId);
    const values = { installationId, name: z.string().trim().min(1).max(80).parse(args.deviceName), platform: z.string().trim().min(1).max(40).parse(args.platform), credentialHash: await digest(credential), protocolVersion: z.string().regex(/^\d+\.\d+$/).parse(args.protocolVersion), appVersion: z.string().trim().min(1).max(40).parse(args.appVersion), pairedAt: now, lastSeenAt: now, state: "active" as const };
    const existingDevice = await ctx.db.query("bridgeDevices")
      .withIndex("by_account_installation", (q) => q.eq("accountId", row.accountId).eq("installationId", installationId))
      .unique();
    const deviceId = existingDevice?._id ?? await ctx.db.insert("bridgeDevices", { accountId: row.accountId, ...values });
    if (existingDevice) await ctx.db.patch(existingDevice._id, values);
    // A reinstalled Bridge pairs as another installation. The same computer's
    // other records (same name and platform) are retired, so this computer
    // never also shows as another one that went offline.
    const sameComputer = await ctx.db.query("bridgeDevices")
      .withIndex("by_account_state", (q) => q.eq("accountId", row.accountId).eq("state", "active"))
      .collect();
    for (const device of sameComputer) {
      if (device._id !== deviceId && device.name === values.name && device.platform === values.platform)
        await retireDevice(ctx, device._id, now);
    }
    await ctx.db.patch(row._id, { confirmedAt: now, consumedAt: now });
    return { deviceId, deviceCredential: credential, browserOrigin: row.browserOrigin };
  },
});

export const resumePairing = mutation({
  args: { credential: v.string(), challenge: v.string(), shortCode: v.string(), installationId: v.string(), deviceName: v.string(), platform: v.string(), appVersion: v.string(), protocolVersion: v.string() },
  handler: async (ctx, args) => {
    const challengeHash = await digest(z.string().min(32).max(256).parse(args.challenge));
    const credentialHash = await digest(z.string().min(32).max(256).parse(args.credential));
    const [row, device] = await Promise.all([
      ctx.db.query("bridgePairingChallenges").withIndex("by_challenge_hash", (q) => q.eq("challengeHash", challengeHash)).unique(),
      ctx.db.query("bridgeDevices").withIndex("by_credential_hash", (q) => q.eq("credentialHash", credentialHash)).unique(),
    ]);
    if (!row || row.expiresAt <= Date.now() || row.consumedAt || row.shortCode !== args.shortCode) throw new Error("PAIRING_CHALLENGE_INVALID");
    const installationId = z.string().uuid().parse(args.installationId);
    if (!device || device.state !== "active" || device.accountId !== row.accountId || (device.installationId && device.installationId !== installationId)) throw new Error("BRIDGE_CREDENTIAL_INVALID");
    const now = Date.now();
    await ctx.db.patch(device._id, {
      name: z.string().trim().min(1).max(80).parse(args.deviceName),
      installationId,
      platform: z.string().trim().min(1).max(40).parse(args.platform),
      protocolVersion: z.string().regex(/^\d+\.\d+$/).parse(args.protocolVersion),
      appVersion: z.string().trim().min(1).max(40).parse(args.appVersion),
      lastSeenAt: now,
    });
    await ctx.db.patch(row._id, { confirmedAt: now, consumedAt: now });
    return { deviceId: device._id, browserOrigin: row.browserOrigin };
  },
});

/**
 * A paired Bridge reports its health once a minute or when it changes. This
 * keeps "last seen" honest and lets the Devices page on another device say
 * whether that computer is paused or has a problem.
 */
export const reportHealth = mutation({
  args: {
    credential: v.string(),
    paused: v.boolean(),
    folders: v.number(),
    problem: v.optional(v.string()),
    problemFolder: v.optional(v.string()),
    lastSyncAt: v.optional(v.number()),
    appVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const credentialHash = await digest(z.string().min(32).max(256).parse(args.credential));
    const device = await ctx.db.query("bridgeDevices").withIndex("by_credential_hash", (q) => q.eq("credentialHash", credentialHash)).unique();
    if (!device || device.state !== "active") throw new Error("BRIDGE_CREDENTIAL_INVALID");
    const now = Date.now();
    const health = {
      paused: args.paused,
      folders: z.number().int().min(0).max(10_000).parse(args.folders),
      problem: z.string().regex(/^[a-z][a-z-]{0,59}$/).optional().parse(args.problem),
      problemFolder: z.string().trim().min(1).max(255).optional().parse(args.problemFolder),
      lastSyncAt: z.number().int().min(0).max(now + 60_000).optional().parse(args.lastSyncAt),
      reportedAt: now,
    };
    await ctx.db.patch(device._id, {
      lastSeenAt: now,
      appVersion: z.string().trim().min(1).max(40).parse(args.appVersion),
      health,
    });
    return null;
  },
});

export const devices = query({ args: {}, handler: async (ctx) => {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
  const devices = await ctx.db.query("bridgeDevices").withIndex("by_account_state", (q) => q.eq("accountId", actor.accountId).eq("state", "active")).take(50);
  return devices.map(({ credentialHash: _credentialHash, ...device }) => device);
} });

/** Whether the account has connected Bridge on any computer, so its browsers may look for it. */
export const hasDevice = query({ args: {}, handler: async (ctx) => {
  const actor = await getOptionalAuthenticatedActor(ctx);
  if (!actor) return false;
  const device = await ctx.db.query("bridgeDevices").withIndex("by_account_state", (q) => q.eq("accountId", actor.accountId).eq("state", "active")).first();
  return device !== null;
} });

export const overview = query({ args: {}, handler: async (ctx) => {
  const actor = await getOptionalAuthenticatedActor(ctx);
  if (!actor) return null;
  const devices = await ctx.db.query("bridgeDevices").withIndex("by_account_state", (q) => q.eq("accountId", actor.accountId).eq("state", "active")).take(50);
  const mounts = await ctx.db.query("bridgeMounts").withIndex("by_account_state", (q) => q.eq("accountId", actor.accountId)).filter((q) => q.neq(q.field("state"), "revoked")).take(200);
  return { devices: devices.map(({ credentialHash: _credentialHash, ...device }) => device), mounts };
} });

export const activeMounts = query({
  args: {},
  handler: async (ctx) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const mounts = await ctx.db.query("bridgeMounts")
      .withIndex("by_account_state", (q) => q.eq("accountId", actor.accountId).eq("state", "active"))
      .take(50);
    const active: typeof mounts = [];
    for (const mount of mounts) {
      const device = await ctx.db.get(mount.deviceId);
      if (device?.state === "active") active.push(mount);
    }
    return active;
  },
});

export const registerMount = mutation({
  args: { deviceId: v.id("bridgeDevices"), rootLabel: v.string(), grantId: v.string(), rootKey: v.string(), fileCount: v.number(), doubleSyncRisk: v.boolean() },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx); if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED"); const device = await ctx.db.get(args.deviceId);
    if (!device || device.accountId !== actor.accountId || device.state !== "active") throw new Error("BRIDGE_DEVICE_INVALID");
    const values = z.object({ rootLabel: z.string().trim().min(1).max(120), grantId: z.string().regex(/^grant_[a-f0-9]+$/), rootKey: z.string().regex(/^[a-f0-9]{64}$/), fileCount: z.number().int().min(0).max(10_000_000) }).parse(args);
    const byRootKey = await ctx.db.query("bridgeMounts").withIndex("by_device_root_key", (q) => q.eq("deviceId", args.deviceId).eq("rootKey", values.rootKey)).unique();
    const legacy = byRootKey ? [] : (await ctx.db.query("bridgeMounts").withIndex("by_device_state", (q) => q.eq("deviceId", args.deviceId).eq("state", "active")).take(500)).filter((mount) => mount.rootLabel === values.rootLabel && !mount.rootKey);
    const existing = byRootKey ?? (legacy.length === 1 ? legacy[0] : null) ?? await ctx.db.query("bridgeMounts").withIndex("by_device_grant", (q) => q.eq("deviceId", args.deviceId).eq("grantId", values.grantId)).unique(); const now = Date.now();
    if (existing) { await ctx.db.patch(existing._id, { rootLabel: values.rootLabel, grantId: values.grantId, rootKey: values.rootKey, fileCount: values.fileCount, doubleSyncRisk: args.doubleSyncRisk, state: "active", lastScanAt: now, updatedAt: now }); return existing._id; }
    const rootNode = await createFolderNode(ctx, { accountId: actor.accountId, schoolId: actor.schoolId, name: values.rootLabel });
    return ctx.db.insert("bridgeMounts", { accountId: actor.accountId, deviceId: args.deviceId, rootLabel: values.rootLabel, grantId: values.grantId, rootKey: values.rootKey, rootOrgNodeId: rootNode._id, state: "active", fileCount: values.fileCount, doubleSyncRisk: args.doubleSyncRisk, lastScanAt: now, createdAt: now, updatedAt: now });
  },
});

export const sweepRevokedDevice = internalMutation({
  args: {
    deviceId: v.id("bridgeDevices"),
    step: v.number(),
  },
  handler: async (ctx, args) => {
    const device = await ctx.db.get(args.deviceId);
    if (!device || device.state !== "revoked") return { done: true, processed: 0 };
    if (!Number.isInteger(args.step) || args.step < 0)
      throw new Error("BRIDGE_REVOCATION_STEP_INVALID");

    const step = REVOCATION_STEPS[args.step];
    if (!step) return { done: true, processed: 0 };
    const now = Date.now();
    let processed = 0;

    if (step.kind === "replica") {
      const replicas = await ctx.db
        .query("workReplicas")
        .withIndex("by_device_state", (q) =>
          q.eq("deviceId", args.deviceId).eq("state", step.state),
        )
        .take(step.limit);
      for (const replica of replicas) {
        await ctx.db.patch(replica._id, {
          state: "unavailable",
          unavailableReason: "device-revoked",
          updatedAt: now,
        });
      }
      processed = replicas.length;
    } else if (step.kind === "mount") {
      const mounts = await ctx.db
        .query("bridgeMounts")
        .withIndex("by_device_state", (q) =>
          q.eq("deviceId", args.deviceId).eq("state", step.state),
        )
        .take(step.limit);
      for (const mount of mounts) {
        await ctx.db.patch(mount._id, { state: "revoked", updatedAt: now });
      }
      processed = mounts.length;
    } else if (step.kind === "write") {
      const requests = await ctx.db
        .query("bridgeWriteRequests")
        .withIndex("by_device_state", (q) =>
          q.eq("deviceId", args.deviceId).eq("state", step.state),
        )
        .take(step.limit);
      for (const request of requests) {
        await failRevokedWrite(ctx, request, now);
      }
      processed = requests.length;
    } else {
      const requests = await ctx.db
        .query("bridgeFsRequests")
        .withIndex("by_device_state", (q) =>
          q.eq("deviceId", args.deviceId).eq("state", step.state),
        )
        .take(step.limit);
      for (const request of requests) {
        await ctx.db.patch(request._id, {
          state: "failed",
          errorCode: "device-revoked",
          errorMessage: "The target Bridge device was revoked.",
          claimedAt: undefined,
          updatedAt: now,
        });
      }
      processed = requests.length;
    }

    const nextStep = processed === step.limit ? args.step : args.step + 1;
    if (nextStep < REVOCATION_STEPS.length) {
      await ctx.scheduler.runAfter(
        REVOCATION_BATCH_DELAY_MS,
        internal.bridge.sweepRevokedDevice,
        { deviceId: args.deviceId, step: nextStep },
      );
    }
    return {
      done: nextStep >= REVOCATION_STEPS.length,
      nextStep,
      processed,
    };
  },
});

/** What this computer brought into Spectra goes to the Trash, where it can still be restored. */
async function trashDeviceFiles(ctx: MutationCtx, accountId: Id<"accounts">, deviceId: Id<"bridgeDevices">) {
  const mounts = await ctx.db.query("bridgeMounts")
    .withIndex("by_device_state", (q) => q.eq("deviceId", deviceId).eq("state", "active"))
    .take(200);
  for (const mount of mounts) {
    if (!mount.selectedFile && mount.rootOrgNodeId) {
      const root = await ctx.db.get(mount.rootOrgNodeId);
      if (root && root.accountId === accountId) await trashNode(ctx, root);
      continue;
    }
    // Single files share General, so only their own works go.
    const replicas = await ctx.db.query("workReplicas")
      .withIndex("by_device_mount_path", (q) => q.eq("deviceId", deviceId).eq("mountId", mount._id))
      .take(50);
    for (const replica of replicas) {
      for (const node of await findNodesForSource(ctx, "work", String(replica.workId))) {
        if (node.accountId === accountId) await trashNode(ctx, node);
      }
    }
  }
}

/**
 * Revokes a device: its credential stops working at once and its folders,
 * replicas and queued requests are swept in batches.
 */
async function retireDevice(ctx: MutationCtx, deviceId: Id<"bridgeDevices">, now: number) {
  await ctx.db.patch(deviceId, {
    state: "revoked",
    credentialHash: `revoked:${crypto.randomUUID()}`,
    payloadUploadCursor: undefined,
    lastSeenAt: now,
  });
  await ctx.scheduler.runAfter(
    REVOCATION_BATCH_DELAY_MS,
    internal.bridge.sweepRevokedDevice,
    { deviceId, step: 0 },
  );
}

export const revokeDevice = mutation({
  args: { deviceId: v.id("bridgeDevices"), removeFiles: v.optional(v.boolean()) },
  handler: async (ctx, { deviceId, removeFiles }) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const device = await ctx.db.get(deviceId);
    if (!device || device.accountId !== actor.accountId)
      throw new Error("BRIDGE_DEVICE_INVALID");
    if (device.state === "revoked")
      return { deviceId, cleanupQueued: false, alreadyRevoked: true };
    if (removeFiles) await trashDeviceFiles(ctx, actor.accountId, deviceId);
    await retireDevice(ctx, deviceId, Date.now());
    return { deviceId, cleanupQueued: true, alreadyRevoked: false };
  },
});
