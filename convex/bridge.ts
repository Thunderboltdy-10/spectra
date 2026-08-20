import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";
import { z } from "zod";
import { createFolderNode } from "./orgTreeShared";

const originSchema = z.string().url().refine((value) => {
  const url = new URL(value); return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
}, "Origin must be HTTPS or localhost");

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomSecret() { return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", ""); }

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
  args: { challenge: v.string(), shortCode: v.string(), deviceName: v.string(), platform: v.string(), appVersion: v.string(), protocolVersion: v.string() },
  handler: async (ctx, args) => {
    const challengeHash = await digest(z.string().min(32).max(256).parse(args.challenge));
    const row = await ctx.db.query("bridgePairingChallenges").withIndex("by_challenge_hash", (q) => q.eq("challengeHash", challengeHash)).unique();
    if (!row || row.expiresAt <= Date.now() || row.consumedAt || row.shortCode !== args.shortCode) throw new Error("PAIRING_CHALLENGE_INVALID");
    const credential = randomSecret(); const now = Date.now();
    const deviceId = await ctx.db.insert("bridgeDevices", { accountId: row.accountId, name: z.string().trim().min(1).max(80).parse(args.deviceName), platform: z.string().trim().min(1).max(40).parse(args.platform), credentialHash: await digest(credential), protocolVersion: z.string().regex(/^\d+\.\d+$/).parse(args.protocolVersion), appVersion: z.string().trim().min(1).max(40).parse(args.appVersion), pairedAt: now, lastSeenAt: now, state: "active" });
    await ctx.db.patch(row._id, { confirmedAt: now, consumedAt: now });
    return { deviceId, deviceCredential: credential, browserOrigin: row.browserOrigin };
  },
});

export const devices = query({ args: {}, handler: async (ctx) => { const actor = await getAuthenticatedActor(ctx); if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED"); return ctx.db.query("bridgeDevices").withIndex("by_account_state", (q) => q.eq("accountId", actor.accountId).eq("state", "active")).take(50); } });

export const overview = query({ args: {}, handler: async (ctx) => {
  const actor = await getAuthenticatedActor(ctx); if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED");
  const devices = await ctx.db.query("bridgeDevices").withIndex("by_account_state", (q) => q.eq("accountId", actor.accountId).eq("state", "active")).take(50);
  const mounts = await ctx.db.query("bridgeMounts").withIndex("by_account_state", (q) => q.eq("accountId", actor.accountId).eq("state", "active")).take(200);
  return { devices: devices.map(({ credentialHash: _credentialHash, ...device }) => device), mounts };
} });

export const registerMount = mutation({
  args: { deviceId: v.id("bridgeDevices"), rootLabel: v.string(), grantId: v.string(), fileCount: v.number(), doubleSyncRisk: v.boolean() },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx); if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED"); const device = await ctx.db.get(args.deviceId);
    if (!device || device.accountId !== actor.accountId || device.state !== "active") throw new Error("BRIDGE_DEVICE_INVALID");
    const values = z.object({ rootLabel: z.string().trim().min(1).max(120), grantId: z.string().regex(/^grant_[a-f0-9]+$/), fileCount: z.number().int().min(0).max(10_000_000) }).parse(args);
    const existing = await ctx.db.query("bridgeMounts").withIndex("by_device_grant", (q) => q.eq("deviceId", args.deviceId).eq("grantId", values.grantId)).unique(); const now = Date.now();
    if (existing) { await ctx.db.patch(existing._id, { rootLabel: values.rootLabel, fileCount: values.fileCount, doubleSyncRisk: args.doubleSyncRisk, state: "active", lastScanAt: now, updatedAt: now }); return existing._id; }
    const rootNode = await createFolderNode(ctx, { accountId: actor.accountId, schoolId: actor.schoolId, name: values.rootLabel });
    return ctx.db.insert("bridgeMounts", { accountId: actor.accountId, deviceId: args.deviceId, rootLabel: values.rootLabel, grantId: values.grantId, rootOrgNodeId: rootNode._id, state: "active", fileCount: values.fileCount, doubleSyncRisk: args.doubleSyncRisk, lastScanAt: now, createdAt: now, updatedAt: now });
  },
});

export const revokeDevice = mutation({ args: { deviceId: v.id("bridgeDevices") }, handler: async (ctx, { deviceId }) => { const actor = await getAuthenticatedActor(ctx); if (!actor) throw new Error("AUTH_ACCOUNT_REQUIRED"); const device = await ctx.db.get(deviceId); if (!device || device.accountId !== actor.accountId) throw new Error("BRIDGE_DEVICE_INVALID"); await ctx.db.patch(deviceId, { state: "revoked", credentialHash: `revoked:${crypto.randomUUID()}`, lastSeenAt: Date.now() }); const replicas = await ctx.db.query("workReplicas").withIndex("by_account_state", (q) => q.eq("accountId", actor.accountId)).filter((q) => q.eq(q.field("deviceId"), deviceId)).take(2_000); for (const replica of replicas) await ctx.db.patch(replica._id, { state: "unavailable", unavailableReason: "device-revoked", updatedAt: Date.now() }); } });
