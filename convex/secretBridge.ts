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
  if (!value || value.length < 32)
    throw new Error(
      "SECRET_BRIDGE_CONFIG_MISSING: Configure a strong bridge key.",
    );
  return value;
}

function digestEnvelope(envelope?: {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: number;
  fingerprint: string;
}) {
  if (!envelope) return "-";
  return createHash("sha256")
    .update(
      `${envelope.ciphertext}|${envelope.nonce}|${envelope.authTag}|${envelope.keyVersion}|${envelope.fingerprint}`,
    )
    .digest("base64url");
}

function verify(input: {
  operation: string;
  subject: string;
  schoolId: string;
  purpose: string;
  timestamp: number;
  nonce: string;
  signature: string;
  envelopeDigest: string;
}) {
  if (Math.abs(Date.now() - input.timestamp) > 60_000)
    throw new Error("SECRET_BRIDGE_EXPIRED: The server request expired.");
  const canonical = [
    input.operation,
    input.subject,
    input.schoolId,
    input.purpose,
    input.timestamp,
    input.nonce,
    input.envelopeDigest,
  ].join("|");
  const expected = createHmac("sha256", key()).update(canonical).digest();
  const received = Buffer.from(input.signature, "base64url");
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    throw new Error("SECRET_BRIDGE_INVALID: Server authorization failed.");
}

const bridge = {
  schoolId: v.string(),
  purpose: v.string(),
  operatorSessionId: v.optional(v.string()),
  timestamp: v.number(),
  nonce: v.string(),
  signature: v.string(),
  requestId: v.optional(v.string()),
};

async function authenticatedSubject(ctx: ActionCtx, workerSubject?: string) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    if (workerSubject && workerSubject !== identity.subject)
      throw new Error(
        "SECRET_BRIDGE_SUBJECT_MISMATCH: The service subject does not match the authenticated account.",
      );
    return identity.subject;
  }
  if (workerSubject) return workerSubject;
  throw new Error("AUTH_NOT_SIGNED_IN: Sign in to continue.");
}

export const read = action({
  args: bridge,
  handler: async (ctx, args): Promise<StoredEnvelope | null> => {
    const subject = await authenticatedSubject(ctx);
    verify({
      operation: "read",
      subject,
      schoolId: args.schoolId,
      purpose: args.purpose,
      timestamp: args.timestamp,
      nonce: args.nonce,
      signature: args.signature,
      envelopeDigest: "-",
    });
    await ctx.runMutation(internal.secretStore.reserveNonce, {
      subject,
      nonce: args.nonce,
      operation: "read",
      expiresAt: args.timestamp + 60_000,
    });
    return ctx.runQuery(internal.secretStore.readEnvelope, {
      subject,
      schoolId: args.schoolId,
      purpose: args.purpose,
      operatorSessionId: args.operatorSessionId,
    });
  },
});

export const useForSchoolConnector = action({
  args: { ...bridge, workerSubject: v.optional(v.string()) },
  handler: async (ctx, args): Promise<StoredEnvelope | null> => {
    const subject = await authenticatedSubject(ctx, args.workerSubject);
    verify({
      operation: "use",
      subject,
      schoolId: args.schoolId,
      purpose: args.purpose,
      timestamp: args.timestamp,
      nonce: args.nonce,
      signature: args.signature,
      envelopeDigest: "-",
    });
    await ctx.runMutation(internal.secretStore.reserveNonce, {
      subject,
      nonce: args.nonce,
      operation: "use",
      expiresAt: args.timestamp + 60_000,
    });
    return ctx.runQuery(internal.secretStore.readEnvelopeForSchoolUse, {
      subject,
      schoolId: args.schoolId,
      purpose: args.purpose,
    });
  },
});

export const status = action({
  args: bridge,
  handler: async (
    ctx,
    args,
  ): Promise<
    | { configured: false }
    | {
        configured: true;
        fingerprint: string;
        keyVersion: number;
        label: string;
        createdAt: number;
      }
  > => {
    const subject = await authenticatedSubject(ctx);
    verify({
      operation: "status",
      subject,
      schoolId: args.schoolId,
      purpose: args.purpose,
      timestamp: args.timestamp,
      nonce: args.nonce,
      signature: args.signature,
      envelopeDigest: "-",
    });
    await ctx.runMutation(internal.secretStore.reserveNonce, {
      subject,
      nonce: args.nonce,
      operation: "status",
      expiresAt: args.timestamp + 60_000,
    });
    const envelope: StoredEnvelope | null = await ctx.runQuery(
      internal.secretStore.readEnvelope,
      {
        subject,
        schoolId: args.schoolId,
        purpose: args.purpose,
        operatorSessionId: args.operatorSessionId,
      },
    );
    return envelope
      ? {
          configured: true,
          fingerprint: envelope.fingerprint,
          keyVersion: envelope.keyVersion,
          label: envelope.label,
          createdAt: envelope.createdAt,
        }
      : { configured: false };
  },
});

export const write = action({
  args: {
    ...bridge,
    label: v.string(),
    ciphertext: v.string(),
    encryptionNonce: v.string(),
    authTag: v.string(),
    keyVersion: v.number(),
    fingerprint: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    secretId: Id<"secretRecords">;
    fingerprint: string;
    keyVersion: number;
    status: "active";
  }> => {
    const subject = await authenticatedSubject(ctx);
    const envelope = {
      ciphertext: args.ciphertext,
      nonce: args.encryptionNonce,
      authTag: args.authTag,
      keyVersion: args.keyVersion,
      fingerprint: args.fingerprint,
    };
    verify({
      operation: "write",
      subject,
      schoolId: args.schoolId,
      purpose: args.purpose,
      timestamp: args.timestamp,
      nonce: args.nonce,
      signature: args.signature,
      envelopeDigest: digestEnvelope(envelope),
    });
    await ctx.runMutation(internal.secretStore.reserveNonce, {
      subject,
      nonce: args.nonce,
      operation: "write",
      expiresAt: args.timestamp + 60_000,
    });
    return ctx.runMutation(internal.secretStore.writeEnvelope, {
      subject,
      schoolId: args.schoolId,
      operatorSessionId: args.operatorSessionId,
      purpose: args.purpose,
      label: args.label,
      ciphertext: args.ciphertext,
      nonce: args.encryptionNonce,
      authTag: args.authTag,
      keyVersion: args.keyVersion,
      fingerprint: args.fingerprint,
      requestId: args.requestId,
    });
  },
});

export const revoke = action({
  args: bridge,
  handler: async (
    ctx,
    args,
  ): Promise<{ revoked: number; revokedAt: number }> => {
    const subject = await authenticatedSubject(ctx);
    verify({
      operation: "revoke",
      subject,
      schoolId: args.schoolId,
      purpose: args.purpose,
      timestamp: args.timestamp,
      nonce: args.nonce,
      signature: args.signature,
      envelopeDigest: "-",
    });
    await ctx.runMutation(internal.secretStore.reserveNonce, {
      subject,
      nonce: args.nonce,
      operation: "revoke",
      expiresAt: args.timestamp + 60_000,
    });
    return ctx.runMutation(internal.secretStore.revoke, {
      subject,
      schoolId: args.schoolId,
      operatorSessionId: args.operatorSessionId,
      purpose: args.purpose,
      requestId: args.requestId,
    });
  },
});

const ACCOUNT_ERASURE_OPERATION = "erase-account";
const ACCOUNT_ERASURE_PURPOSE = "clerk-user-deleted";

/**
 * The Clerk webhook route (after its svix check) asks for a deleted
 * identity's erasure. There is no user session, so the server-held bridge
 * key signs the subject. Erasure is idempotent, so a replay inside the
 * signature window changes nothing and needs no nonce reservation.
 */
export const eraseDeletedIdentity = action({
  args: { clerkId: v.string(), timestamp: v.number(), nonce: v.string(), signature: v.string() },
  handler: async (ctx, args): Promise<{ status: "running" | "completed" }> => {
    verify({
      operation: ACCOUNT_ERASURE_OPERATION,
      subject: args.clerkId,
      schoolId: "-",
      purpose: ACCOUNT_ERASURE_PURPOSE,
      timestamp: args.timestamp,
      nonce: args.nonce,
      signature: args.signature,
      envelopeDigest: "-",
    });
    const result = await ctx.runMutation(internal.accountErasure.requestForDeletedIdentity, { clerkId: args.clerkId });
    return { status: result.status };
  },
});
