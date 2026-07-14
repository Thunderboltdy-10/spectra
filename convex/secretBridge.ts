"use node";

import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import type { Id } from "./_generated/dataModel";

type StoredEnvelope = {
  secretId: Id<"secretRecords">;
  ciphertext: string;
  nonce: string;
  authTag: string;
  algorithm: "aes-256-gcm";
  keyVersion: number;
  fingerprint: string;
  label: string;
  createdAt: number;
};

function key() {
  const value = process.env.SPECTRA_SECRET_BRIDGE_KEY;
  if (!value || value.length < 32) throw new Error("SECRET_BRIDGE_CONFIG_MISSING: Configure a strong bridge key.");
  return value;
}

function digestEnvelope(envelope?: { ciphertext: string; nonce: string; authTag: string; keyVersion: number; fingerprint: string }) {
  if (!envelope) return "-";
  return createHash("sha256").update(`${envelope.ciphertext}|${envelope.nonce}|${envelope.authTag}|${envelope.keyVersion}|${envelope.fingerprint}`).digest("base64url");
}

function verify(input: { operation: string; subject: string; schoolId: string; purpose: string; timestamp: number; nonce: string; signature: string; envelopeDigest: string }) {
  if (Math.abs(Date.now() - input.timestamp) > 60_000) throw new Error("SECRET_BRIDGE_EXPIRED: The server request expired.");
  const canonical = [input.operation, input.subject, input.schoolId, input.purpose, input.timestamp, input.nonce, input.envelopeDigest].join("|");
  const expected = createHmac("sha256", key()).update(canonical).digest();
  const received = Buffer.from(input.signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error("SECRET_BRIDGE_INVALID: Server authorization failed.");
}

const bridge = { schoolId: v.string(), purpose: v.string(), operatorSessionId: v.optional(v.string()), timestamp: v.number(), nonce: v.string(), signature: v.string(), requestId: v.optional(v.string()) };

async function authenticatedSubject(ctx: ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("AUTH_NOT_SIGNED_IN: Sign in to continue.");
  return identity.subject;
}

export const read = action({
  args: bridge,
  handler: async (ctx, args): Promise<StoredEnvelope | null> => {
    const subject = await authenticatedSubject(ctx);
    verify({ operation: "read", subject, schoolId: args.schoolId, purpose: args.purpose, timestamp: args.timestamp, nonce: args.nonce, signature: args.signature, envelopeDigest: "-" });
    await ctx.runMutation(internal.secretStore.reserveNonce, { subject, nonce: args.nonce, operation: "read", expiresAt: args.timestamp + 60_000 });
    return ctx.runQuery(internal.secretStore.readEnvelope, { subject, schoolId: args.schoolId, purpose: args.purpose, operatorSessionId: args.operatorSessionId });
  },
});

export const status = action({
  args: bridge,
  handler: async (ctx, args): Promise<{ configured: false } | { configured: true; fingerprint: string; keyVersion: number; label: string; createdAt: number }> => {
    const subject = await authenticatedSubject(ctx);
    verify({ operation: "status", subject, schoolId: args.schoolId, purpose: args.purpose, timestamp: args.timestamp, nonce: args.nonce, signature: args.signature, envelopeDigest: "-" });
    await ctx.runMutation(internal.secretStore.reserveNonce, { subject, nonce: args.nonce, operation: "status", expiresAt: args.timestamp + 60_000 });
    const envelope: StoredEnvelope | null = await ctx.runQuery(internal.secretStore.readEnvelope, { subject, schoolId: args.schoolId, purpose: args.purpose, operatorSessionId: args.operatorSessionId });
    return envelope ? { configured: true, fingerprint: envelope.fingerprint, keyVersion: envelope.keyVersion, label: envelope.label, createdAt: envelope.createdAt } : { configured: false };
  },
});

export const write = action({
  args: { ...bridge, label: v.string(), ciphertext: v.string(), encryptionNonce: v.string(), authTag: v.string(), keyVersion: v.number(), fingerprint: v.string() },
  handler: async (ctx, args): Promise<{ secretId: Id<"secretRecords">; fingerprint: string; keyVersion: number; status: "active" }> => {
    const subject = await authenticatedSubject(ctx);
    const envelope = { ciphertext: args.ciphertext, nonce: args.encryptionNonce, authTag: args.authTag, keyVersion: args.keyVersion, fingerprint: args.fingerprint };
    verify({ operation: "write", subject, schoolId: args.schoolId, purpose: args.purpose, timestamp: args.timestamp, nonce: args.nonce, signature: args.signature, envelopeDigest: digestEnvelope(envelope) });
    await ctx.runMutation(internal.secretStore.reserveNonce, { subject, nonce: args.nonce, operation: "write", expiresAt: args.timestamp + 60_000 });
    return ctx.runMutation(internal.secretStore.writeEnvelope, { subject, schoolId: args.schoolId, operatorSessionId: args.operatorSessionId, purpose: args.purpose, label: args.label, ciphertext: args.ciphertext, nonce: args.encryptionNonce, authTag: args.authTag, keyVersion: args.keyVersion, fingerprint: args.fingerprint, requestId: args.requestId });
  },
});

export const revoke = action({
  args: bridge,
  handler: async (ctx, args): Promise<{ revoked: number; revokedAt: number }> => {
    const subject = await authenticatedSubject(ctx);
    verify({ operation: "revoke", subject, schoolId: args.schoolId, purpose: args.purpose, timestamp: args.timestamp, nonce: args.nonce, signature: args.signature, envelopeDigest: "-" });
    await ctx.runMutation(internal.secretStore.reserveNonce, { subject, nonce: args.nonce, operation: "revoke", expiresAt: args.timestamp + 60_000 });
    return ctx.runMutation(internal.secretStore.revoke, { subject, schoolId: args.schoolId, operatorSessionId: args.operatorSessionId, purpose: args.purpose, requestId: args.requestId });
  },
});
