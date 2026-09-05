import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import {
  getAccountByClerkId,
  getActiveMembership,
  isPlatformOperatorEmail,
} from "./identityShared";
import { writeAuditEvent } from "./auditShared";
import type { IdentityCtx } from "./identityShared";

async function authorize(
  ctx: IdentityCtx,
  subject: string,
  schoolId: string,
  operatorSessionId?: string,
) {
  const account = await getAccountByClerkId(ctx, subject);
  if (!account || account.status !== "active" || !account.emailVerified)
    throw new Error(
      "AUTH_ACCOUNT_REQUIRED: An active verified account is required.",
    );
  const normalizedSchool = ctx.db.normalizeId("schools", schoolId);
  if (!normalizedSchool)
    throw new Error("SECRET_SCHOOL_INVALID: The school is unavailable.");
  const membership = await getActiveMembership(ctx, account._id);
  const localAdmin =
    membership?.schoolId === normalizedSchool &&
    membership.role === "school_admin";
  let operatorSession = null;
  if (operatorSessionId) {
    const normalizedSession = ctx.db.normalizeId(
      "operatorSchoolSessions",
      operatorSessionId,
    );
    operatorSession = normalizedSession
      ? await ctx.db.get(normalizedSession)
      : null;
  }
  const operatorSessionActive =
    isPlatformOperatorEmail(account.email) &&
    operatorSession?.operatorAccountId === account._id &&
    operatorSession.schoolId === normalizedSchool &&
    !operatorSession.revokedAt &&
    operatorSession.expiresAt > Date.now();
  if (operatorSessionActive && operatorSession?.mode !== "manage") {
    throw new Error(
      "AUTH_OPERATOR_MANAGE_REQUIRED: Re-enter this school with manage access.",
    );
  }
  const operator = operatorSessionActive && operatorSession?.mode === "manage";
  if (!localAdmin && !operator)
    throw new Error(
      "AUTH_SECRET_MANAGE_REQUIRED: School administrator or operational manage access is required.",
    );
  return { account, schoolId: normalizedSchool, operatorSession };
}

export const reserveNonce = internalMutation({
  args: {
    subject: v.string(),
    nonce: v.string(),
    operation: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const account = await getAccountByClerkId(ctx, args.subject);
    if (!account || account.status !== "active")
      throw new Error("AUTH_ACCOUNT_REQUIRED: An active account is required.");
    const existing = await ctx.db
      .query("secretBridgeNonces")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .unique();
    if (existing)
      throw new Error(
        "SECRET_BRIDGE_REPLAYED: This server request has already been used.",
      );
    return ctx.db.insert("secretBridgeNonces", {
      nonce: args.nonce,
      operation: args.operation,
      accountId: account._id,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });
  },
});

export const readEnvelope = internalQuery({
  args: {
    subject: v.string(),
    schoolId: v.string(),
    purpose: v.string(),
    operatorSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await authorize(
      ctx,
      args.subject,
      args.schoolId,
      args.operatorSessionId,
    );
    const records = await ctx.db
      .query("secretRecords")
      .withIndex("by_school_purpose", (q) =>
        q.eq("schoolId", actor.schoolId).eq("purpose", args.purpose),
      )
      .collect();
    const active = records
      .filter((record) => record.status === "active")
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!active) return null;
    return {
      secretId: active._id,
      ciphertext: active.ciphertext,
      nonce: active.nonce,
      authTag: active.authTag,
      algorithm: active.algorithm,
      keyVersion: active.keyVersion,
      fingerprint: active.fingerprint,
      label: active.label,
      createdAt: active.createdAt,
    };
  },
});

export const readEnvelopeForSchoolUse = internalQuery({
  args: { subject: v.string(), schoolId: v.string(), purpose: v.string() },
  handler: async (ctx, args) => {
    const account = await getAccountByClerkId(ctx, args.subject);
    if (!account || account.status !== "active" || !account.emailVerified)
      throw new Error(
        "AUTH_ACCOUNT_REQUIRED: An active verified account is required.",
      );
    const schoolId = ctx.db.normalizeId("schools", args.schoolId);
    if (!schoolId)
      throw new Error("SECRET_SCHOOL_INVALID: The school is unavailable.");
    const membership = await getActiveMembership(ctx, account._id);
    if (!membership || membership.schoolId !== schoolId)
      throw new Error(
        "AUTH_SCHOOL_REQUIRED: Active school membership is required.",
      );
    if (args.purpose !== "managebac-api-token")
      throw new Error(
        "SECRET_USE_FORBIDDEN: This secret cannot be used by a school connector.",
      );
    const records = await ctx.db
      .query("secretRecords")
      .withIndex("by_school_purpose", (q) =>
        q.eq("schoolId", schoolId).eq("purpose", args.purpose),
      )
      .collect();
    const active = records
      .filter((record) => record.status === "active")
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!active) return null;
    return {
      secretId: active._id,
      ciphertext: active.ciphertext,
      nonce: active.nonce,
      authTag: active.authTag,
      algorithm: active.algorithm,
      keyVersion: active.keyVersion,
      fingerprint: active.fingerprint,
      label: active.label,
      createdAt: active.createdAt,
    };
  },
});

export const writeEnvelope = internalMutation({
  args: {
    subject: v.string(),
    schoolId: v.string(),
    operatorSessionId: v.optional(v.string()),
    purpose: v.string(),
    label: v.string(),
    ciphertext: v.string(),
    nonce: v.string(),
    authTag: v.string(),
    keyVersion: v.number(),
    fingerprint: v.string(),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await authorize(
      ctx,
      args.subject,
      args.schoolId,
      args.operatorSessionId,
    );
    const now = Date.now();
    const existing = await ctx.db
      .query("secretRecords")
      .withIndex("by_school_purpose", (q) =>
        q.eq("schoolId", actor.schoolId).eq("purpose", args.purpose),
      )
      .collect();
    for (const record of existing)
      if (record.status === "active")
        await ctx.db.patch(record._id, { status: "rotated", rotatedAt: now });
    const secretId = await ctx.db.insert("secretRecords", {
      schoolId: actor.schoolId,
      purpose: args.purpose.slice(0, 100),
      label: args.label.slice(0, 120),
      ciphertext: args.ciphertext,
      nonce: args.nonce,
      authTag: args.authTag,
      algorithm: "aes-256-gcm",
      keyVersion: args.keyVersion,
      fingerprint: args.fingerprint,
      status: "active",
      createdByAccountId: actor.account._id,
      createdAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.account._id,
      schoolId: actor.schoolId,
      operatorSessionId: actor.operatorSession?._id,
      action: "secret.rotated",
      targetType: "secret",
      targetId: secretId,
      metadata: {
        purpose: args.purpose,
        label: args.label,
        keyVersion: args.keyVersion,
        fingerprint: args.fingerprint,
      },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return {
      secretId,
      fingerprint: args.fingerprint,
      keyVersion: args.keyVersion,
      status: "active" as const,
    };
  },
});

export const revoke = internalMutation({
  args: {
    subject: v.string(),
    schoolId: v.string(),
    operatorSessionId: v.optional(v.string()),
    purpose: v.string(),
    requestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await authorize(
      ctx,
      args.subject,
      args.schoolId,
      args.operatorSessionId,
    );
    const records = await ctx.db
      .query("secretRecords")
      .withIndex("by_school_purpose", (q) =>
        q.eq("schoolId", actor.schoolId).eq("purpose", args.purpose),
      )
      .collect();
    const now = Date.now();
    const active = records.filter((record) => record.status === "active");
    for (const record of active)
      await ctx.db.patch(record._id, { status: "revoked", revokedAt: now });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.account._id,
      schoolId: actor.schoolId,
      operatorSessionId: actor.operatorSession?._id,
      action: "secret.revoked",
      targetType: "secret",
      metadata: { purpose: args.purpose, count: active.length },
      requestId: args.requestId,
      retentionClass: "security",
    });
    return { revoked: active.length, revokedAt: now };
  },
});
