import { query } from "./_generated/server";
import { internalMutation, mutation } from "./orgNodeMutation";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAuditEvent } from "./auditShared";
import {
  dissolveWorkspaceNode,
  ensureWorkspaceNode,
  findPrimaryNode,
  placeSourceNode,
  DISSOLVE_CHILD_BATCH,
} from "./orgTreeShared";
import {
  getAccountByClerkId,
  getActorForAccountId,
  getAuthenticatedActor,
} from "./identityShared";
import {
  buildArtifactTextIndex,
  defaultArtifactContent,
  defaultArtifactSchemaVersion,
} from "./spectraShared";
import { upsertSourceCalendarItem } from "./calendarShared";
import { refreshPlannerSourceContent } from "../shared/planner-source.mjs";

const EMPTY_COUNTS = {
  fetched: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  tombstoned: 0,
  projected: 0,
  skipped: 0,
  quarantined: 0,
  conflicts: 0,
  errors: 0,
};

const SYNC_LEASE_MS = 30 * 60_000;

function canonicalAcademicPeriodKey(value: unknown) {
  const key = text(value, 300);
  return key || undefined;
}

/**
 * Provider ids are only stable inside the provider account and academic
 * period. Personal rows additionally carry the Spectra account. Keeping this
 * key beside the raw provider key lets the bounded migration reconcile legacy
 * rows without ever treating equal provider ids as equal people.
 */
function sourceIdentityKey(
  integrationId: Id<"schoolIntegrations">,
  accountId: Id<"accounts"> | undefined,
  input: {
    providerRecordKey: string;
    audienceScope: string;
    academicPeriodKey?: string;
  },
) {
  const owner =
    input.audienceScope === "mapped_user"
      ? `account:${accountId ?? "unknown"}`
      : `scope:${input.audienceScope}`;
  return [
    String(integrationId),
    owner,
    `period:${canonicalAcademicPeriodKey(input.academicPeriodKey) ?? "unknown"}`,
    input.providerRecordKey.trim().slice(0, 700),
  ].join("|");
}

function projectionSourceKey(source: Doc<"externalRecords">) {
  // Keep the legacy raw calendar key stable when the provider supplied no
  // academic period. Period-bearing rows use the canonical identity so a
  // rollover cannot collide with the prior year's projection.
  return source.academicPeriodKey
    ? source.sourceIdentityKey ?? source.providerRecordKey
    : source.providerRecordKey;
}

async function selectionSnapshot(
  ctx: Ctx,
  integrationId: Id<"schoolIntegrations">,
  accountId: Id<"accounts">,
) {
  const rows = await ctx.db
    .query("managebacClassSelections")
    .withIndex("by_account_integration", (q) =>
      q.eq("accountId", accountId).eq("integrationId", integrationId),
    )
    .collect();
  return {
    revision: rows.reduce((highest, row) => Math.max(highest, row.selectionRevision), 0),
    selectedClassIds: rows.filter((row) => row.selected).map((row) => row.providerClassId),
  };
}

async function assertCurrentSyncLease(
  ctx: MutationCtx,
  syncRun: Doc<"externalSyncRuns">,
  leaseToken?: string,
  options: { allowSelectionChange?: boolean } = {},
) {
  if (syncRun.status === "completed" || syncRun.status === "failed" || syncRun.status === "cancelled")
    throw new Error("INTEGRATION_SYNC_FENCED: This sync is no longer current.");
  if (syncRun.leaseToken && syncRun.leaseToken !== leaseToken)
    throw new Error("INTEGRATION_SYNC_FENCED: A newer sync owns this work.");
  if (syncRun.leaseToken && (!syncRun.leaseExpiresAt || syncRun.leaseExpiresAt <= Date.now()))
    throw new Error("INTEGRATION_SYNC_FENCED: The sync lease expired.");
  if (syncRun.accountId && syncRun.selectionRevision !== undefined) {
    const current = await selectionSnapshot(ctx, syncRun.integrationId, syncRun.accountId);
    if (
      current.revision !== syncRun.selectionRevision &&
      !options.allowSelectionChange
    )
      throw new Error("INTEGRATION_SELECTION_CHANGED: Class selection changed while this sync was running.");
  }
}

/** A kept or archived class stops following at the source boundary, not just
 * at the provider fan-out. Whole-account routes and shared reconciliations
 * must also preserve that account's existing projections. */
function classFollowPolicy(ctx: Ctx, integrationId: Id<"schoolIntegrations">) {
  const selections = new Map<string, Promise<Doc<"managebacClassSelections">[]>>();
  return async (
    accountId: Id<"accounts"> | undefined,
    source: { providerClassId?: string; academicPeriodKey?: string; recordType: string },
  ) => {
    if (!accountId || !source.providerClassId || ["class", "course", "membership"].includes(source.recordType)) return true;
    const key = JSON.stringify([accountId, source.providerClassId]);
    let pending = selections.get(key);
    if (!pending) {
      pending = ctx.db.query("managebacClassSelections")
        .withIndex("by_integration_account_class", q => q.eq("integrationId", integrationId).eq("accountId", accountId).eq("providerClassId", source.providerClassId!))
        .collect();
      selections.set(key, pending);
    }
    const rows = await pending;
    const matching = rows.filter(row =>
      row.providerClassId === source.providerClassId &&
      (!source.academicPeriodKey || !row.academicPeriodKey || row.academicPeriodKey === source.academicPeriodKey));
    // A class-scoped record without a matching selection is not followed.
    // Class/course rows themselves are admitted by the early return above so
    // the selection UI can still discover available classes.
    return matching.some(row => row.selected);
  };
}

async function activeRunForScope(
  ctx: MutationCtx,
  integrationId: Id<"schoolIntegrations">,
  accountId: Id<"accounts"> | undefined,
  now: number,
) {
  const rows = (
    await Promise.all(
      (["queued", "leased", "running"] as const).map((status) =>
        ctx.db
          .query("externalSyncRuns")
          .withIndex("by_integration_account_status", (q) =>
            q.eq("integrationId", integrationId).eq("accountId", accountId).eq("status", status),
          )
          .collect(),
      ),
    )
  ).flat();
  for (const row of rows) {
    if (row.accountId && row.selectionRevision !== undefined) {
      const current = await selectionSnapshot(ctx, integrationId, row.accountId);
      if (current.revision !== row.selectionRevision) {
        await ctx.db.patch(row._id, {
          status: "failed",
          stage: "selection_changed",
          errorCode: "INTEGRATION_SELECTION_CHANGED",
          errorSummary: "This sync no longer owns the selected classes.",
          completedAt: now,
          updatedAt: now,
        });
        continue;
      }
    }
    if (row.leaseExpiresAt && row.leaseExpiresAt > now) return row;
    // Rows written before scoped leases were introduced cannot safely accept
    // a late response, so close them before allowing a replacement claim.
    await ctx.db.patch(row._id, {
      status: "failed",
      stage: "lease_expired",
      errorCode: "INTEGRATION_WORKER_LEASE_EXPIRED",
      errorSummary: "This older sync no longer owns provider work.",
      completedAt: now,
      updatedAt: now,
    });
  }
  return null;
}

function scheduleSync(
  ctx: MutationCtx,
  integrationId: Id<"schoolIntegrations">,
  scheduledFor: number,
) {
  return ctx.scheduler.runAt(
    Math.max(Date.now(), scheduledFor),
    internal.executionScheduler.dispatchManageBacSync,
    { integrationId, scheduledFor },
  );
}

export const scheduleExisting = internalMutation({
  args: {
    status: v.optional(v.union(v.literal("connected"), v.literal("degraded"))),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const status = args.status ?? "connected";
    const limit = Math.min(100, Math.max(1, Math.floor(args.limit ?? 100)));
    // A repair can cover many schools. Resume one indexed stream at a time
    // rather than loading every integration and queuing every job at once.
    const page = await ctx.db
      .query("schoolIntegrations")
      .withIndex("by_status_next_sync", (q) => q.eq("status", status))
      .paginate({ cursor: args.cursor ?? null, numItems: limit, maximumBytesRead: 1_000_000 });
    let scheduled = 0;
    for (const integration of page.page) {
      if (
        typeof integration.nextSyncAt !== "number" ||
        integration.blockedReason
      )
        continue;
      await scheduleSync(ctx, integration._id, integration.nextSyncAt);
      scheduled += 1;
    }
    const next = !page.isDone
      ? { status, cursor: page.continueCursor, limit }
      : status === "connected"
        ? { status: "degraded" as const, cursor: null, limit }
        : null;
    if (next)
      await ctx.scheduler.runAfter(0, internal.managebac.scheduleExisting, next);
    return { scheduled, scanned: page.page.length, done: next === null };
  },
});

const vCapabilityInput = v.object({
  category: v.string(),
  name: v.string(),
  recordType: v.string(),
  path: v.string(),
  purpose: v.string(),
  scope: v.union(
    v.literal("personal"),
    v.literal("class"),
    v.literal("school"),
  ),
  minimumRole: v.union(
    v.literal("student"),
    v.literal("teacher"),
    v.literal("school_admin"),
  ),
  pagination: v.union(
    v.literal("none"),
    v.literal("page"),
    v.literal("cursor"),
    v.literal("unknown"),
  ),
  changeStrategy: v.union(
    v.literal("full_reconciliation"),
    v.literal("modified_since"),
    v.literal("cursor"),
    v.literal("unknown"),
  ),
  freshnessSlaMinutes: v.number(),
  contractVersion: v.string(),
  responseSchemaHash: v.optional(v.string()),
  permissionState: v.union(
    v.literal("read_only"),
    v.literal("not_enabled"),
    v.literal("unverified"),
  ),
  verificationStatus: v.union(
    v.literal("verified"),
    v.literal("failed"),
    v.literal("quarantined"),
    v.literal("unverified"),
  ),
  routeSource: v.union(
    v.literal("tenant_reference"),
    v.literal("api_manager"),
    v.literal("manual_verified"),
  ),
  personalIdParameter: v.optional(v.string()),
  normalization: v.any(),
});

const vNormalizedRecord = v.object({
  providerRecordId: v.string(),
  providerRecordKey: v.string(),
  classification: v.union(
    v.literal("personal"),
    v.literal("class"),
    v.literal("school"),
    v.literal("public_resource"),
  ),
  audienceScope: v.union(
    v.literal("mapped_user"),
    v.literal("class_members"),
    v.literal("authorized_staff"),
    v.literal("school"),
  ),
  providerClassId: v.optional(v.string()),
  academicPeriodKey: v.optional(v.string()),
  normalized: v.any(),
  payloadVersion: v.string(),
  sourceHash: v.string(),
  sourceModifiedAt: v.optional(v.number()),
  provenanceUrl: v.optional(v.string()),
});

type Ctx = QueryCtx | MutationCtx;
type Actor = NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>>;

function text(value: unknown, maximum: number, fallback = "") {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maximum)
    : fallback;
}

/** Strip ManageBac HTML so planner summaries/descriptions never show raw tags. */
function plainText(value: unknown, maximum: number, fallback = "") {
  if (typeof value !== "string") return fallback;
  const stripped = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return (stripped || fallback).slice(0, maximum);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function timestampValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && !Number.isNaN(Date.parse(value)))
    return Date.parse(value);
  return undefined;
}

function isoValue(value: unknown) {
  const time = timestampValue(value);
  return time === undefined ? undefined : new Date(time).toISOString();
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256(value: string) {
  return base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

async function exactDigest(value: unknown) {
  return sha256(canonicalJson(value));
}

async function verifyBridge(
  ctx: MutationCtx,
  actor: Actor,
  input: {
    operation: string;
    integrationId: string;
    syncRunId?: string;
    timestamp: number;
    nonce: string;
    payloadDigest: string;
    signature: string;
  },
) {
  const key = process.env.SPECTRA_CONNECTOR_BRIDGE_KEY;
  if (!key || key.length < 32)
    throw new Error(
      "INTEGRATION_BRIDGE_CONFIG_MISSING: Configure a strong connector bridge key.",
    );
  if (Math.abs(Date.now() - input.timestamp) > 60_000)
    throw new Error("INTEGRATION_BRIDGE_EXPIRED: The server request expired.");
  const replay = await ctx.db
    .query("secretBridgeNonces")
    .withIndex("by_nonce", (q) => q.eq("nonce", input.nonce))
    .unique();
  if (replay)
    throw new Error(
      "INTEGRATION_BRIDGE_REPLAYED: This server request was already used.",
    );
  const canonical = [
    input.operation,
    actor.clerkId,
    input.integrationId,
    input.syncRunId ?? "-",
    input.timestamp,
    input.nonce,
    input.payloadDigest,
  ].join("|");
  const imported = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    imported,
    decodeBase64Url(input.signature),
    new TextEncoder().encode(canonical),
  );
  if (!valid)
    throw new Error(
      "INTEGRATION_BRIDGE_INVALID: The server signature is invalid.",
    );
  await ctx.db.insert("secretBridgeNonces", {
    nonce: input.nonce,
    operation: input.operation,
    accountId: actor.accountId,
    expiresAt: input.timestamp + 60_000,
    createdAt: Date.now(),
  });
}

async function requireActor(ctx: Ctx) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor)
    throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return actor;
}

async function requireActorOrService(
  ctx: MutationCtx,
  serviceSubject?: string,
) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity) {
    if (serviceSubject && serviceSubject !== identity.subject)
      throw new Error(
        "INTEGRATION_SUBJECT_MISMATCH: The service subject does not match the authenticated account.",
      );
    return requireActor(ctx);
  }
  if (!serviceSubject)
    throw new Error("AUTH_NOT_SIGNED_IN: Sign in to continue.");
  const account = await getAccountByClerkId(ctx, serviceSubject);
  const actor = account ? await getActorForAccountId(ctx, account._id) : null;
  if (!actor)
    throw new Error(
      "AUTH_ACCOUNT_REQUIRED: The scheduled connector owner is unavailable.",
    );
  return actor;
}

async function verifyScheduledClaim(
  ctx: MutationCtx,
  actor: Actor,
  input: {
    timestamp: number;
    nonce: string;
    payloadDigest: string;
    signature: string;
  },
) {
  const key = process.env.SPECTRA_CONNECTOR_BRIDGE_KEY;
  if (!key || key.length < 32)
    throw new Error(
      "INTEGRATION_BRIDGE_CONFIG_MISSING: Configure a strong connector bridge key.",
    );
  if (Math.abs(Date.now() - input.timestamp) > 60_000)
    throw new Error("INTEGRATION_BRIDGE_EXPIRED: The worker request expired.");
  const replay = await ctx.db
    .query("secretBridgeNonces")
    .withIndex("by_nonce", (q) => q.eq("nonce", input.nonce))
    .unique();
  if (replay)
    throw new Error(
      "INTEGRATION_BRIDGE_REPLAYED: This worker request was already used.",
    );
  const canonical = [
    "scheduled-claim",
    input.timestamp,
    input.nonce,
    input.payloadDigest,
  ].join("|");
  const imported = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    imported,
    decodeBase64Url(input.signature),
    new TextEncoder().encode(canonical),
  );
  if (!valid)
    throw new Error(
      "INTEGRATION_BRIDGE_INVALID: The worker signature is invalid.",
    );
  await ctx.db.insert("secretBridgeNonces", {
    nonce: input.nonce,
    operation: "scheduled-claim",
    accountId: actor.accountId,
    expiresAt: input.timestamp + 60_000,
    createdAt: Date.now(),
  });
}

async function requireSchoolAdmin(ctx: Ctx) {
  const actor = await requireActor(ctx);
  if (actor.schoolRole !== "school_admin")
    throw new Error(
      "AUTH_SCHOOL_ADMIN_REQUIRED: School administrator access is required.",
    );
  return actor;
}

async function integrationForSchool(ctx: Ctx, schoolId: Id<"schools">) {
  return ctx.db
    .query("schoolIntegrations")
    .withIndex("by_school_provider", (q) =>
      q.eq("schoolId", schoolId).eq("provider", "managebac"),
    )
    .unique();
}

async function requireIntegration(
  ctx: Ctx,
  actor: Actor,
  integrationId: Id<"schoolIntegrations">,
) {
  const integration = await ctx.db.get(integrationId);
  if (!integration || integration.schoolId !== actor.schoolId)
    throw new Error(
      "INTEGRATION_NOT_FOUND: The ManageBac integration is unavailable.",
    );
  return integration;
}

function coverage(capabilities: Array<Doc<"integrationCapabilities">>) {
  return {
    discovered: capabilities.length,
    verifiedReadable: capabilities.filter(
      (item) =>
        item.permissionState === "read_only" &&
        item.verificationStatus === "verified",
    ).length,
    unverified: capabilities.filter(
      (item) => item.verificationStatus === "unverified",
    ).length,
    failed: capabilities.filter((item) => item.verificationStatus === "failed")
      .length,
    quarantined: capabilities.filter(
      (item) => item.verificationStatus === "quarantined",
    ).length,
  };
}

function safeIntegration(integration: Doc<"schoolIntegrations">) {
  return {
    _id: integration._id,
    provider: integration.provider,
    baseUrl: integration.baseUrl,
    referenceUrl: integration.referenceUrl,
    authHeaderName: integration.authHeaderName,
    authScheme: integration.authScheme,
    status: integration.status,
    tokenMode: integration.tokenMode,
    credentialFingerprint: integration.credentialFingerprint,
    providerVersion: integration.providerVersion,
    manifestVersion: integration.manifestVersion,
    capabilityCoverage: integration.capabilityCoverage,
    syncPolicy: {
      ...integration.syncPolicy,
      autoCreateClasses: true,
      autoImportTasks: true,
    },
    freshnessSlaMinutes: integration.freshnessSlaMinutes,
    requestBudgetPerMinute: integration.requestBudgetPerMinute,
    bootstrapVersion: integration.bootstrapVersion,
    lastValidatedAt: integration.lastValidatedAt,
    lastSyncAt: integration.lastSyncAt,
    nextSyncAt: integration.nextSyncAt,
    blockedReason: integration.blockedReason,
    rotationDueAt: integration.rotationDueAt,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  };
}

export const configure = mutation({
  args: {
    baseUrl: v.string(),
    referenceUrl: v.optional(v.string()),
    authHeaderName: v.string(),
    authScheme: v.union(v.literal("raw"), v.literal("bearer")),
    credentialFingerprint: v.optional(v.string()),
    frequencyMinutes: v.optional(v.number()),
    autoApplySafeUpdates: v.optional(v.boolean()),
    conflictMode: v.optional(v.union(v.literal("review"), v.literal("ask_me"))),
    rotationDueAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSchoolAdmin(ctx);
    const baseUrl = args.baseUrl.trim().replace(/\/+$/, "");
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new Error(
        "INTEGRATION_URL_INVALID: Enter the tenant API base URL.",
      );
    }
    const localStack = process.env.SPECTRA_APP_URL?.startsWith(
      "http://localhost:",
    );
    const localFixture =
      (process.env.SPECTRA_ALLOW_LOCAL_MANAGEBAC_FIXTURE === "true" ||
        localStack) &&
      parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !localFixture)
      throw new Error("INTEGRATION_URL_INVALID: ManageBac must use HTTPS.");
    if (
      parsed.username ||
      parsed.password ||
      parsed.hostname === "localhost" ||
      parsed.hostname.endsWith(".local")
    )
      throw new Error(
        "INTEGRATION_EGRESS_BLOCKED: This API host is not allowed.",
      );
    const authHeaderName = text(args.authHeaderName, 120);
    if (
      !/^[A-Za-z0-9-]{2,120}$/.test(authHeaderName) ||
      /^(?:host|cookie|set-cookie|content-length|connection)$/i.test(
        authHeaderName,
      )
    )
      throw new Error(
        "INTEGRATION_AUTH_HEADER_INVALID: Use the header documented by the tenant reference.",
      );
    const current = await integrationForSchool(ctx, actor.schoolId);
    const now = Date.now();
    const connectionContractChanged = Boolean(
      current &&
      (current.baseUrl !== baseUrl ||
        current.authHeaderName !== authHeaderName ||
        current.authScheme !== args.authScheme),
    );
    const syncPolicy = {
      frequencyMinutes: Math.max(
        15,
        Math.min(
          1_440,
          Math.round(
            args.frequencyMinutes ??
              current?.syncPolicy.frequencyMinutes ??
              180,
          ),
        ),
      ),
      autoCreateClasses: true,
      autoImportTasks: true,
      autoApplySafeUpdates:
        args.autoApplySafeUpdates ??
        current?.syncPolicy.autoApplySafeUpdates ??
        true,
      conflictMode:
        args.conflictMode ?? current?.syncPolicy.conflictMode ?? "review",
    } as const;
    let nextStatus:
      | "disconnected"
      | "validating"
      | "connected"
      | "degraded"
      | "blocked"
      | "revoked" = "validating";
    if (current && !connectionContractChanged) {
      if (current.status === "revoked" || current.status === "validating") {
        const existingCapabilities = await ctx.db
          .query("integrationCapabilities")
          .withIndex("by_integration", (q) =>
            q.eq("integrationId", current._id),
          )
          .collect();
        const verifiedReadable = existingCapabilities.some(
          (item) =>
            item.permissionState === "read_only" &&
            item.verificationStatus === "verified",
        );
        nextStatus = verifiedReadable ? "connected" : "validating";
      } else {
        nextStatus = current.status;
      }
    }
    const patch = {
      baseUrl,
      referenceUrl: args.referenceUrl?.trim().slice(0, 2_000),
      authHeaderName,
      authScheme: args.authScheme,
      status: nextStatus,
      tokenMode: "read_only" as const,
      credentialFingerprint:
        args.credentialFingerprint ?? current?.credentialFingerprint,
      syncPolicy,
      freshnessSlaMinutes: Math.max(180, syncPolicy.frequencyMinutes + 20),
      rotationDueAt: args.rotationDueAt,
      updatedByAccountId: actor.accountId,
      blockedReason: undefined,
      updatedAt: now,
    };
    let integrationId: Id<"schoolIntegrations">;
    if (current) {
      await ctx.db.patch(current._id, patch);
      integrationId = current._id;
      if (connectionContractChanged) {
        const capabilities = await ctx.db
          .query("integrationCapabilities")
          .withIndex("by_integration", (q) =>
            q.eq("integrationId", current._id),
          )
          .collect();
        for (const capability of capabilities)
          await ctx.db.patch(capability._id, {
            permissionState: "unverified",
            verificationStatus: "unverified",
            lastVerifiedAt: undefined,
            lastErrorCode: "CONNECTION_CONTRACT_CHANGED",
            updatedAt: now,
          });
      }
    } else {
      integrationId = await ctx.db.insert("schoolIntegrations", {
        schoolId: actor.schoolId,
        provider: "managebac",
        ...patch,
        secretPurpose: "managebac-api-token",
        manifestVersion: 0,
        capabilityCoverage: {
          discovered: 0,
          verifiedReadable: 0,
          unverified: 0,
          failed: 0,
          quarantined: 0,
        },
        requestBudgetPerMinute: 180,
        bootstrapVersion: 1,
        createdByAccountId: actor.accountId,
        createdAt: now,
      });
    }
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: current
        ? "integration.managebac.configured"
        : "integration.managebac.created",
      targetType: "school_integration",
      targetId: integrationId,
      metadata: {
        host: parsed.hostname,
        authHeaderName,
        authScheme: args.authScheme,
        tokenMode: "read_only",
        credentialFingerprint: args.credentialFingerprint ?? null,
      },
      retentionClass: "security",
    });
    return { integrationId };
  },
});

export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const actor = await requireSchoolAdmin(ctx);
    const integration = await integrationForSchool(ctx, actor.schoolId);
    if (!integration) return { disconnected: false };
    const now = Date.now();
    const [mappings, activeRuns] = await Promise.all([
      ctx.db
        .query("externalIdentityMappings")
        .withIndex("by_school_status", (q) =>
          q.eq("schoolId", actor.schoolId).eq("status", "verified"),
        )
        .collect(),
      ctx.db
        .query("externalSyncRuns")
        .withIndex("by_integration_created", (q) =>
          q.eq("integrationId", integration._id),
        )
        .order("desc")
        .take(500),
    ]);
    for (const mapping of mappings)
      await ctx.db.patch(mapping._id, {
        status: "revoked",
        providerUserId: undefined,
        providerUserIdHash: undefined,
        revokedAt: now,
        updatedAt: now,
      });
    for (const run of activeRuns.filter((item) =>
      ["queued", "leased", "running", "awaiting_review"].includes(item.status),
    ))
      await ctx.db.patch(run._id, {
        status: "cancelled",
        stage: "integration_disconnected",
        completedAt: now,
        updatedAt: now,
      });
    const sources = await ctx.db
      .query("externalRecords")
      .withIndex("by_school_updated", (q) => q.eq("schoolId", actor.schoolId))
      .take(5_000);
    for (const source of sources.filter(
      (item) => item.integrationId === integration._id && !item.tombstone,
    ))
      await ctx.db.patch(source._id, {
        sourceState: "removed",
        sourceStateAt: now,
        sourceStateReason:
          "The ManageBac connection was disconnected by a school administrator.",
        updatedAt: now,
      });
    await ctx.db.patch(integration._id, {
      status: "revoked",
      blockedReason: "Disconnected by a school administrator.",
      nextSyncAt: undefined,
      updatedByAccountId: actor.accountId,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "integration.managebac.disconnected",
      targetType: "school_integration",
      targetId: integration._id,
      metadata: {
        mappingsRevoked: mappings.length,
        runsCancelled: activeRuns.filter((item) =>
          ["queued", "leased", "running", "awaiting_review"].includes(
            item.status,
          ),
        ).length,
      },
      retentionClass: "security",
    });
    return { disconnected: true };
  },
});

export const replaceCapabilityManifest = mutation({
  args: {
    integrationId: v.id("schoolIntegrations"),
    sourceHash: v.string(),
    providerVersion: v.optional(v.string()),
    capabilities: v.array(vCapabilityInput),
  },
  handler: async (ctx, args) => {
    const actor = await requireSchoolAdmin(ctx);
    const integration = await requireIntegration(
      ctx,
      actor,
      args.integrationId,
    );
    if (args.capabilities.length > 500)
      throw new Error("INTEGRATION_MANIFEST_TOO_LARGE: Too many routes.");
    const seen = new Set<string>();
    for (const item of args.capabilities) {
      if (!item.path.startsWith("/") || item.path.includes("://"))
        throw new Error(
          "INTEGRATION_ROUTE_INVALID: Route paths must be relative.",
        );
      const key = `GET ${item.path}`;
      if (seen.has(key)) throw new Error(`INTEGRATION_ROUTE_DUPLICATE: ${key}`);
      seen.add(key);
      if (
        item.permissionState === "read_only" &&
        item.verificationStatus === "verified" &&
        !item.responseSchemaHash
      )
        throw new Error(
          `INTEGRATION_CONTRACT_REQUIRED: ${key} needs a verified schema hash.`,
        );
    }
    const existing = await ctx.db
      .query("integrationCapabilities")
      .withIndex("by_integration", (q) =>
        q.eq("integrationId", integration._id),
      )
      .collect();
    for (const item of existing) await ctx.db.delete(item._id);
    const now = Date.now();
    const inserted: Array<Id<"integrationCapabilities">> = [];
    for (const item of args.capabilities) {
      inserted.push(
        await ctx.db.insert("integrationCapabilities", {
          integrationId: integration._id,
          schoolId: actor.schoolId,
          category: text(item.category, 100),
          name: text(item.name, 160),
          recordType: text(item.recordType, 100),
          method: "GET",
          path: item.path.slice(0, 1_000),
          purpose: text(item.purpose, 300),
          scope: item.scope,
          minimumRole: item.minimumRole,
          pagination: item.pagination,
          changeStrategy: item.changeStrategy,
          freshnessSlaMinutes: Math.max(
            5,
            Math.min(10_080, Math.round(item.freshnessSlaMinutes)),
          ),
          contractVersion: text(item.contractVersion, 100),
          responseSchemaHash: item.responseSchemaHash?.slice(0, 180),
          permissionState: item.permissionState,
          verificationStatus: item.verificationStatus,
          routeSource: item.routeSource,
          personalIdParameter: item.personalIdParameter?.slice(0, 120),
          normalization: item.normalization,
          lastVerifiedAt:
            item.verificationStatus === "verified" ? now : undefined,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    const capabilityRows = (
      await Promise.all(inserted.map((id) => ctx.db.get(id)))
    ).filter((item): item is Doc<"integrationCapabilities"> => Boolean(item));
    await ctx.db.patch(integration._id, {
      manifestVersion: integration.manifestVersion + 1,
      manifestSourceHash: args.sourceHash.slice(0, 180),
      providerVersion: args.providerVersion?.slice(0, 100),
      capabilityCoverage: coverage(capabilityRows),
      status: capabilityRows.some(
        (item) =>
          item.permissionState === "read_only" &&
          item.verificationStatus === "verified",
      )
        ? "connected"
        : "blocked",
      blockedReason:
        capabilityRows.length === 0
          ? "No tenant-reference routes have been imported."
          : capabilityRows.some(
                (item) =>
                  item.permissionState === "read_only" &&
                  item.verificationStatus === "verified",
              )
            ? undefined
            : "No readable route has a verified response contract.",
      lastValidatedAt: now,
      updatedByAccountId: actor.accountId,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "integration.managebac.manifest_replaced",
      targetType: "school_integration",
      targetId: integration._id,
      metadata: {
        routeCount: capabilityRows.length,
        verifiedReadable: coverage(capabilityRows).verifiedReadable,
        sourceHash: args.sourceHash.slice(0, 180),
      },
      retentionClass: "security",
    });
    return {
      integrationId: integration._id,
      manifestVersion: integration.manifestVersion + 1,
      coverage: coverage(capabilityRows),
    };
  },
});

export const adminOverview = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireSchoolAdmin(ctx);
    const periodMaps = await ctx.db
      .query("calendarPeriodMaps")
      .withIndex("by_school_updated", (q) => q.eq("schoolId", actor.schoolId))
      .collect();
    const integration = await integrationForSchool(ctx, actor.schoolId);
    if (!integration)
      return {
        integration: null,
        periodMaps,
        capabilities: [],
        syncRuns: [],
        conflicts: [],
        quarantine: [],
        identityQueue: [],
      };
    const [
      capabilities,
      syncRuns,
      conflicts,
      quarantine,
      ambiguousIdentityQueue,
      noMatchIdentityQueue,
      schoolRecords,
    ] = await Promise.all([
      ctx.db
        .query("integrationCapabilities")
        .withIndex("by_integration", (q) =>
          q.eq("integrationId", integration._id),
        )
        .collect(),
      ctx.db
        .query("externalSyncRuns")
        .withIndex("by_integration_created", (q) =>
          q.eq("integrationId", integration._id),
        )
        .order("desc")
        .take(50),
      ctx.db
        .query("externalSyncConflicts")
        .withIndex("by_integration_status", (q) =>
          q.eq("integrationId", integration._id).eq("status", "open"),
        )
        .take(100),
      ctx.db
        .query("externalQuarantineRecords")
        .withIndex("by_integration_status", (q) =>
          q.eq("integrationId", integration._id).eq("status", "open"),
        )
        .take(100),
      ctx.db
        .query("externalIdentityMappings")
        .withIndex("by_school_status", (q) =>
          q.eq("schoolId", actor.schoolId).eq("status", "ambiguous"),
        )
        .take(100)
        .then((rows) =>
          rows.filter((item) => item.integrationId === integration._id),
        ),
      ctx.db
        .query("externalIdentityMappings")
        .withIndex("by_school_status", (q) =>
          q.eq("schoolId", actor.schoolId).eq("status", "no_match"),
        )
        .take(100)
        .then((rows) =>
          rows.filter((item) => item.integrationId === integration._id),
        ),
      ctx.db
        .query("externalRecords")
        .withIndex("by_school_updated", (q) => q.eq("schoolId", actor.schoolId))
        .order("desc")
        .take(500),
    ]);
    const school = await ctx.db.get(actor.schoolId);
    return {
      integration: safeIntegration(integration),
      periodMaps,
      school: school ? { _id: school._id, name: school.name } : null,
      capabilities,
      syncRuns,
      conflicts,
      quarantine,
      previews: schoolRecords
        .filter(
          (item) =>
            item.integrationId === integration._id &&
            !item.mappedAccountId &&
            item.classification !== "personal" &&
            item.audienceScope !== "mapped_user",
        )
        .slice(0, 120)
        .map((item) => ({
          _id: item._id,
          recordType: item.recordType,
          providerClassId: item.providerClassId,
          academicPeriodKey: item.academicPeriodKey,
          normalized: item.normalized,
          sourceModifiedAt: item.sourceModifiedAt,
          fetchedAt: item.fetchedAt,
          tombstone: item.tombstone,
          provenanceUrl: item.provenanceUrl,
        })),
      identityQueue: await Promise.all(
        [...ambiguousIdentityQueue, ...noMatchIdentityQueue].map(
          async (mapping) => {
            const account = await ctx.db.get(mapping.accountId);
            return {
              mappingId: mapping._id,
              account: account
                ? { name: account.name, email: account.email }
                : null,
              status: mapping.status,
              matchCount: mapping.matchCount,
              updatedAt: mapping.updatedAt,
            };
          },
        ),
      ),
    };
  },
});

export const upsertCalendarPeriodMap = mutation({
  args: {
    periodKey: v.string(),
    label: v.string(),
    startMinutes: v.number(),
    endMinutes: v.number(),
    timezone: v.string(),
    weekdays: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireSchoolAdmin(ctx);
    const periodKey = args.periodKey.trim().slice(0, 120);
    const label = args.label.trim().slice(0, 160);
    const timezone = args.timezone.trim().slice(0, 100);
    const weekdays = [...new Set(args.weekdays.map(Math.floor))].filter(
      (weekday) => weekday >= 0 && weekday <= 6,
    );
    if (!periodKey || !label || !timezone)
      throw new Error("CALENDAR_PERIOD_REQUIRED: Key, label, and timezone are required.");
    if (
      !Number.isInteger(args.startMinutes) ||
      !Number.isInteger(args.endMinutes) ||
      args.startMinutes < 0 ||
      args.endMinutes > 24 * 60 ||
      args.endMinutes <= args.startMinutes
    )
      throw new Error("CALENDAR_PERIOD_TIME_INVALID: Choose a valid start and end time.");
    if (!weekdays.length)
      throw new Error("CALENDAR_PERIOD_WEEKDAYS_REQUIRED: Choose at least one weekday.");
    const existing = await ctx.db
      .query("calendarPeriodMaps")
      .withIndex("by_school_period", (q) =>
        q.eq("schoolId", actor.schoolId).eq("periodKey", periodKey),
      )
      .unique();
    const now = Date.now();
    const value = {
      label,
      startMinutes: args.startMinutes,
      endMinutes: args.endMinutes,
      timezone,
      weekdays,
      verifiedByAccountId: actor.accountId,
      verifiedAt: now,
      source: "school_admin" as const,
      updatedAt: now,
    };
    const periodMapId = existing
      ? (await ctx.db.patch(existing._id, value), existing._id)
      : await ctx.db.insert("calendarPeriodMaps", {
          schoolId: actor.schoolId,
          periodKey,
          ...value,
          createdAt: now,
        });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "integration.managebac.period_map.upserted",
      targetType: "calendar_period_map",
      targetId: periodMapId,
      metadata: { periodKey, timezone },
      retentionClass: "security",
    });
    return { periodMapId, verifiedAt: now };
  },
});

export const removeCalendarPeriodMap = mutation({
  args: { periodMapId: v.id("calendarPeriodMaps") },
  handler: async (ctx, args) => {
    const actor = await requireSchoolAdmin(ctx);
    const period = await ctx.db.get(args.periodMapId);
    if (!period || period.schoolId !== actor.schoolId)
      throw new Error("CALENDAR_PERIOD_NOT_FOUND");
    await ctx.db.delete(period._id);
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "integration.managebac.period_map.removed",
      targetType: "calendar_period_map",
      targetId: period._id,
      metadata: { periodKey: period.periodKey },
      retentionClass: "security",
    });
    return { removed: true };
  },
});

export const myOverview = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    const integration = await integrationForSchool(ctx, actor.schoolId);
    if (!integration || integration.status === "revoked")
      return {
        integration: null,
        mapping: null,
        capabilities: [],
        syncRuns: [],
        conflicts: [],
        records: [],
      };
    const mapping = await ctx.db
      .query("externalIdentityMappings")
      .withIndex("by_integration_account", (q) =>
        q.eq("integrationId", integration._id).eq("accountId", actor.accountId),
      )
      .unique();
    const selectedClassKeys = new Set(
      (await ctx.db
        .query("managebacClassSelections")
        .withIndex("by_account_integration", (q) =>
          q.eq("accountId", actor.accountId).eq("integrationId", integration._id),
        )
        .collect())
        .filter((row) => row.selected)
        .map((row) => `${row.providerClassId}|${row.academicPeriodKey ?? "unknown"}`),
    );
    const [capabilities, syncRuns, conflicts, records] = await Promise.all([
      ctx.db
        .query("integrationCapabilities")
        .withIndex("by_integration", (q) =>
          q.eq("integrationId", integration._id),
        )
        .collect(),
      ctx.db
        .query("externalSyncRuns")
        .withIndex("by_account_created", (q) =>
          q.eq("accountId", actor.accountId),
        )
        .order("desc")
        .take(30)
        .then((rows) =>
          rows.filter(
            (item) =>
              item.integrationId === integration._id &&
              item.schoolId === actor.schoolId &&
              (!item.providerClassId ||
                selectedClassKeys.has(`${item.providerClassId}|${item.academicPeriodKey ?? "unknown"}`) ||
                selectedClassKeys.has(`${item.providerClassId}|unknown`)),
          ),
        ),
      ctx.db
        .query("externalSyncConflicts")
        .withIndex("by_account_status", (q) =>
          q.eq("accountId", actor.accountId).eq("status", "open"),
        )
        .take(100)
        .then((rows) =>
          rows.filter(
            (item) =>
              item.integrationId === integration._id &&
              item.schoolId === actor.schoolId,
          ),
        ),
      ctx.db
        .query("externalRecords")
        .withIndex("by_account_type", (q) =>
          q.eq("mappedAccountId", actor.accountId),
        )
        .order("desc")
        .take(2_000)
        .then((rows) =>
          rows.filter(
            (item) =>
              item.integrationId === integration._id &&
              item.schoolId === actor.schoolId,
          ),
        ),
    ]);
    return {
      integration: safeIntegration(integration),
      mapping: mapping
        ? {
            status: mapping.status,
            matchCount:
              mapping.status === "ambiguous" ? undefined : mapping.matchCount,
            resolvedAt: mapping.resolvedAt,
            updatedAt: mapping.updatedAt,
          }
        : null,
      capabilities: capabilities.map((item) => ({
        _id: item._id,
        category: item.category,
        name: item.name,
        recordType: item.recordType,
        purpose: item.purpose,
        scope: item.scope,
        permissionState: item.permissionState,
        verificationStatus: item.verificationStatus,
        freshnessSlaMinutes: item.freshnessSlaMinutes,
        lastVerifiedAt: item.lastVerifiedAt,
        lastSuccessAt: item.lastSuccessAt,
        lastErrorCode: item.lastErrorCode,
      })),
      syncRuns,
      conflicts,
      records: records.map((item) => ({
        _id: item._id,
        recordType: item.recordType,
        classification: item.classification,
        audienceScope: item.audienceScope,
        sourceIdentityKey: item.sourceIdentityKey,
        providerClassId: item.providerClassId,
        academicPeriodKey: item.academicPeriodKey,
        normalized: item.normalized,
        sourceHash: item.sourceHash,
        sourceModifiedAt: item.sourceModifiedAt,
        fetchedAt: item.fetchedAt,
        tombstone: item.tombstone,
        sourceState: item.sourceState ?? (item.tombstone ? "removed" : "available"),
        sourceStateReason: item.sourceStateReason,
        provenanceUrl: item.provenanceUrl,
      })),
    };
  },
});

export const claimScheduledSync = mutation({
  args: {
    workerId: v.string(),
    payloadDigest: v.string(),
    timestamp: v.number(),
    nonce: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const due = (
      await Promise.all(
        (["connected", "degraded"] as const).map((status) =>
          ctx.db
            .query("schoolIntegrations")
            .withIndex("by_status_next_sync", (q) =>
              q.eq("status", status).lte("nextSyncAt", now),
            )
            .take(20),
        ),
      )
    )
      .flat()
      .filter(
        (integration) =>
          integration.status === "connected" || !integration.blockedReason,
      )
      .sort(
        (a, b) => (a.nextSyncAt ?? a.createdAt) - (b.nextSyncAt ?? b.createdAt),
    );
    for (const integration of due) {
      if (await activeRunForScope(ctx, integration._id, undefined, now))
        continue;
      const admins = await ctx.db
        .query("schoolMemberships")
        .withIndex("by_school_role", (q) =>
          q.eq("schoolId", integration.schoolId).eq("role", "school_admin"),
        )
        .collect();
      const activeAdmins = admins.filter((item) => item.status === "active");
      const preferred =
        activeAdmins.find(
          (item) => item.accountId === integration.createdByAccountId,
        ) ?? activeAdmins[0];
      if (!preferred) {
        await ctx.db.patch(integration._id, {
          status: "degraded",
          blockedReason:
            "Scheduled synchronization needs an active school administrator.",
          updatedAt: now,
        });
        continue;
      }
      const actor = await getActorForAccountId(ctx, preferred.accountId);
      if (!actor) continue;
      const expectedDigest = await exactDigest({
        workerId: text(args.workerId, 200),
      });
      if (expectedDigest !== args.payloadDigest)
        throw new Error(
          "INTEGRATION_PAYLOAD_INVALID: Scheduled claim payload changed.",
        );
      await verifyScheduledClaim(ctx, actor, args);
      const capabilities = await ctx.db
        .query("integrationCapabilities")
        .withIndex("by_integration", (q) =>
          q.eq("integrationId", integration._id),
        )
        .collect();
      const readable = capabilities.filter(
        (item) =>
          item.permissionState === "read_only" &&
          item.verificationStatus === "verified" &&
          item.scope !== "personal",
      );
      if (readable.length === 0) {
        await ctx.db.patch(integration._id, {
          status: "degraded",
          blockedReason:
            "No verified school- or class-scoped read-only route is available for scheduled sync.",
          updatedAt: now,
        });
        return null;
      }
      const workerId = text(args.workerId, 200);
      const leaseExpiresAt = now + 30 * 60_000;
      const leaseToken = crypto.randomUUID();
      const syncRunId = await ctx.db.insert("externalSyncRuns", {
        integrationId: integration._id,
        schoolId: integration.schoolId,
        kind: "scheduled",
        status: "leased",
        trigger: "schedule",
        stage: "claimed",
        capabilityIds: readable.map((item) => item._id),
        counts: EMPTY_COUNTS,
        leaseOwner: workerId,
        leaseToken,
        leaseExpiresAt,
        attemptCount: 1,
        nextAttemptAt: now,
        startedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      for (const capability of readable)
        await ctx.db.insert("externalSyncCapabilityRuns", {
          syncRunId,
          integrationId: integration._id,
          capabilityId: capability._id,
          status: "queued",
          pageCount: 0,
          recordCount: 0,
          createdAt: now,
          updatedAt: now,
        });
      const nextSyncAt =
        now + integration.syncPolicy.frequencyMinutes * 60_000;
      await ctx.db.patch(integration._id, {
        nextSyncAt,
        blockedReason: undefined,
        updatedAt: now,
      });
      await scheduleSync(ctx, integration._id, nextSyncAt);
      return {
        integrationId: integration._id,
        syncRunId,
        leaseToken,
        selectionRevision: 0,
        schoolId: integration.schoolId,
        serviceSubject: actor.clerkId,
        actor: {
          clerkId: actor.clerkId,
          accountId: actor.accountId,
          email: actor.email,
          name: actor.name,
          schoolId: actor.schoolId,
          schoolRole: actor.schoolRole,
          membershipId: actor.membershipId,
        },
      };
    }
    return null;
  },
});

export const connectorContext = mutation({
  args: {
    integrationId: v.id("schoolIntegrations"),
    serviceSubject: v.optional(v.string()),
    payloadDigest: v.string(),
    timestamp: v.number(),
    nonce: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorOrService(ctx, args.serviceSubject);
    const integration = await requireIntegration(
      ctx,
      actor,
      args.integrationId,
    );
    await verifyBridge(ctx, actor, {
      operation: "context",
      integrationId: integration._id,
      timestamp: args.timestamp,
      nonce: args.nonce,
      payloadDigest: args.payloadDigest,
      signature: args.signature,
    });
    const [capabilities, mapping, selection] = await Promise.all([
      ctx.db
        .query("integrationCapabilities")
        .withIndex("by_integration", (q) =>
          q.eq("integrationId", integration._id),
        )
        .collect(),
      ctx.db
        .query("externalIdentityMappings")
        .withIndex("by_integration_account", (q) =>
          q
            .eq("integrationId", integration._id)
            .eq("accountId", actor.accountId),
        )
        .unique(),
      selectionSnapshot(ctx, integration._id, actor.accountId),
    ]);
    return {
      integration: {
        _id: integration._id,
        schoolId: integration.schoolId,
        baseUrl: integration.baseUrl,
        authHeaderName: integration.authHeaderName,
        authScheme: integration.authScheme,
        requestBudgetPerMinute: integration.requestBudgetPerMinute,
        bootstrapVersion: integration.bootstrapVersion,
        status: integration.status,
      },
      capabilities: capabilities
        .filter(
          (item) =>
            item.permissionState === "read_only" &&
            item.verificationStatus === "verified",
        )
        .map((item) => ({
          _id: item._id,
          category: item.category,
          name: item.name,
          recordType: item.recordType,
          path: item.path,
          purpose: item.purpose,
          scope: item.scope,
          minimumRole: item.minimumRole,
          pagination: item.pagination,
          changeStrategy: item.changeStrategy,
          contractVersion: item.contractVersion,
          responseSchemaHash: item.responseSchemaHash,
          personalIdParameter: item.personalIdParameter,
          normalization: item.normalization,
        })),
      mapping:
        mapping?.status === "verified"
          ? {
              status: mapping.status,
              providerUserId: mapping.providerUserId,
            }
          : { status: mapping?.status ?? "pending" },
      selection,
      actor: {
        accountId: actor.accountId,
        email: actor.email,
        schoolRole: actor.schoolRole,
      },
    };
  },
});

export const beginSync = mutation({
  args: {
    kind: v.union(
      v.literal("identity"),
      v.literal("bootstrap"),
      v.literal("manual"),
      v.literal("reconciliation"),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const integration = await integrationForSchool(ctx, actor.schoolId);
    if (
      !integration ||
      !["connected", "degraded"].includes(integration.status)
    )
      throw new Error(
        "INTEGRATION_NOT_READY: ManageBac must be connected with verified readable capabilities.",
      );
    if (args.kind !== "identity" && actor.schoolRole !== "school_admin") {
      const mapping = await ctx.db
        .query("externalIdentityMappings")
        .withIndex("by_integration_account", (q) =>
          q
            .eq("integrationId", integration._id)
            .eq("accountId", actor.accountId),
        )
        .unique();
      if (!mapping || mapping.status !== "verified")
        throw new Error(
          "INTEGRATION_IDENTITY_REQUIRED: Resolve your school identity first.",
        );
    }
    const capabilities = await ctx.db
      .query("integrationCapabilities")
      .withIndex("by_integration", (q) =>
        q.eq("integrationId", integration._id),
      )
      .collect();
    const readable = capabilities.filter(
      (item) =>
        item.permissionState === "read_only" &&
        item.verificationStatus === "verified",
    );
    if (readable.length === 0)
      throw new Error("INTEGRATION_CAPABILITY_REQUIRED: No route is verified.");
    const now = Date.now();
    const accountId =
      args.kind === "reconciliation" && actor.schoolRole === "school_admin"
        ? undefined
        : actor.accountId;
    const active = await activeRunForScope(
      ctx,
      integration._id,
      accountId,
      now,
    );
    if (active)
      throw new Error(
        "INTEGRATION_SYNC_BUSY: A sync for this account and connection is already running.",
      );
    const selection = accountId
      ? await selectionSnapshot(ctx, integration._id, accountId)
      : undefined;
    const leaseToken = crypto.randomUUID();
    const syncRunId = await ctx.db.insert("externalSyncRuns", {
      integrationId: integration._id,
      schoolId: actor.schoolId,
      accountId,
      kind: args.kind,
      status: "queued",
      trigger:
        args.kind === "bootstrap"
          ? "bootstrap"
          : actor.schoolRole === "school_admin"
            ? "school_admin"
            : "user",
      bootstrapVersion:
        args.kind === "bootstrap" ? integration.bootstrapVersion : undefined,
      stage: args.kind === "identity" ? "resolving_identity" : "queued",
      capabilityIds:
        args.kind === "identity"
          ? readable
              .filter(
                (item) =>
                  item.recordType === "person" ||
                  item.recordType === "membership",
              )
              .map((item) => item._id)
          : readable.map((item) => item._id),
      counts: EMPTY_COUNTS,
      leaseOwner: actor.clerkId,
      leaseToken,
      leaseExpiresAt: now + SYNC_LEASE_MS,
      selectionRevision: selection?.revision,
      attemptCount: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    });
    for (const capabilityId of (await ctx.db.get(syncRunId))!.capabilityIds)
      await ctx.db.insert("externalSyncCapabilityRuns", {
        syncRunId,
        integrationId: integration._id,
        capabilityId,
        status: "queued",
        pageCount: 0,
        recordCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    return {
      syncRunId,
      integrationId: integration._id,
      leaseToken,
      selectionRevision: selection?.revision ?? 0,
    };
  },
});

/** AI-triggered refresh with anti-thrash cooldown (~15 minutes). */
export const requestAiRefresh = mutation({
  args: {
    reason: v.optional(v.string()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const integration = await integrationForSchool(ctx, actor.schoolId);
    if (!integration || integration.status !== "connected")
      return {
        started: false,
        skipped: true,
        reason: "not_connected" as const,
      };
    const now = Date.now();
    const cooldownMs = args.force ? 2 * 60_000 : 15 * 60_000;
    if (integration.lastSyncAt && now - integration.lastSyncAt < cooldownMs)
      return {
        started: false,
        skipped: true,
        reason: "fresh" as const,
        lastSyncAt: integration.lastSyncAt,
        nextEligibleAt: integration.lastSyncAt + cooldownMs,
      };
    if (await activeRunForScope(ctx, integration._id, undefined, now))
      return {
        started: false,
        skipped: true,
        reason: "already_running" as const,
        lastSyncAt: integration.lastSyncAt,
      };
    const mapping = await ctx.db
      .query("externalIdentityMappings")
      .withIndex("by_integration_account", (q) =>
        q
          .eq("integrationId", integration._id)
          .eq("accountId", actor.accountId),
      )
      .unique();
    if (
      actor.schoolRole !== "school_admin" &&
      (!mapping || mapping.status !== "verified")
    )
      return {
        started: false,
        skipped: true,
        reason: "identity_required" as const,
      };
    // Pull the scheduled worker forward instead of orphaning a queued run.
    await ctx.db.patch(integration._id, {
      nextSyncAt: now,
      updatedAt: now,
    });
    await scheduleSync(ctx, integration._id, now);
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "integration.managebac.ai_refresh",
      targetType: "school_integration",
      targetId: integration._id,
      metadata: {
        reason: (args.reason ?? "stale_school_data").slice(0, 240),
        nextSyncAt: now,
      },
      retentionClass: "operational",
    });
    return {
      started: true,
      skipped: false,
      lastSyncAt: integration.lastSyncAt,
      nextSyncAt: now,
    };
  },
});

export const commitIdentityResolution = mutation({
  args: {
    integrationId: v.id("schoolIntegrations"),
    syncRunId: v.id("externalSyncRuns"),
    matchCount: v.number(),
    providerUserId: v.optional(v.string()),
    providerUserIdHash: v.optional(v.string()),
    verifiedEmailHash: v.string(),
    evidenceCapabilityId: v.optional(v.id("integrationCapabilities")),
    leaseToken: v.optional(v.string()),
    payloadDigest: v.string(),
    timestamp: v.number(),
    nonce: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const integration = await requireIntegration(
      ctx,
      actor,
      args.integrationId,
    );
    const syncRun = await ctx.db.get(args.syncRunId);
    if (
      !syncRun ||
      syncRun.integrationId !== integration._id ||
      syncRun.accountId !== actor.accountId ||
      syncRun.kind !== "identity"
    )
      throw new Error("INTEGRATION_SYNC_FORBIDDEN: Identity run mismatch.");
    await assertCurrentSyncLease(ctx, syncRun, args.leaseToken);
    const expectedDigest = await exactDigest({
      matchCount: args.matchCount,
      ...(args.providerUserId ? { providerUserId: args.providerUserId } : {}),
      ...(args.providerUserIdHash
        ? { providerUserIdHash: args.providerUserIdHash }
        : {}),
      verifiedEmailHash: args.verifiedEmailHash,
      ...(args.evidenceCapabilityId
        ? { evidenceCapabilityId: args.evidenceCapabilityId }
        : {}),
      ...(args.leaseToken ? { leaseToken: args.leaseToken } : {}),
    });
    if (expectedDigest !== args.payloadDigest)
      throw new Error("INTEGRATION_PAYLOAD_INVALID: Identity payload changed.");
    await verifyBridge(ctx, actor, {
      operation: "identity",
      integrationId: integration._id,
      syncRunId: syncRun._id,
      timestamp: args.timestamp,
      nonce: args.nonce,
      payloadDigest: args.payloadDigest,
      signature: args.signature,
    });
    const matchCount = Math.max(0, Math.floor(args.matchCount));
    if (matchCount === 1 && !args.providerUserId)
      throw new Error("INTEGRATION_IDENTITY_INVALID: Exact match needs an id.");
    const existing = await ctx.db
      .query("externalIdentityMappings")
      .withIndex("by_integration_account", (q) =>
        q.eq("integrationId", integration._id).eq("accountId", actor.accountId),
      )
      .unique();
    const now = Date.now();
    const status =
      matchCount === 1
        ? ("verified" as const)
        : matchCount === 0
          ? ("no_match" as const)
          : ("ambiguous" as const);
    const patch = {
      providerUserId: status === "verified" ? args.providerUserId : undefined,
      providerUserIdHash:
        status === "verified" ? args.providerUserIdHash : undefined,
      verifiedEmailHash: args.verifiedEmailHash.slice(0, 180),
      status,
      evidenceCapabilityId: args.evidenceCapabilityId,
      matchCount,
      resolvedAt: status === "verified" ? now : undefined,
      revokedAt: undefined,
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, patch);
    else
      await ctx.db.insert("externalIdentityMappings", {
        integrationId: integration._id,
        schoolId: actor.schoolId,
        accountId: actor.accountId,
        ...patch,
        createdAt: now,
      });
    await ctx.db.patch(syncRun._id, {
      status: status === "verified" ? "completed" : "awaiting_review",
      stage: status,
      completedAt: status === "verified" ? now : undefined,
      counts: { ...syncRun.counts, fetched: matchCount },
      updatedAt: now,
    });
    return { status };
  },
});

async function ensureClassWorkspace(
  ctx: MutationCtx,
  integration: Doc<"schoolIntegrations">,
  accountId: Id<"accounts">,
  source: Doc<"externalRecords">,
) {
  const providerKey = `class:${source.providerClassId ?? source.providerRecordId}:${source.academicPeriodKey ?? "current"}`;
  const existing = await ctx.db
    .query("externalProjections")
    .withIndex("by_provider_key", (q) =>
      q.eq("integrationId", integration._id).eq("providerKey", providerKey),
    )
    .collect()
    .then(
      (rows) =>
        rows.find(
          (item) =>
            item.schoolId === integration.schoolId &&
            item.accountId === accountId &&
            item.projectionType === "workspace",
        ) ?? null,
    );
  const normalized = record(source.normalized);
  const now = Date.now();
  const projectedTitle = text(
    normalized.name ?? normalized.title,
    180,
    "ManageBac class",
  );
  const capabilities = await ctx.db
    .query("integrationCapabilities")
    .withIndex("by_integration", (q) => q.eq("integrationId", integration._id))
    .collect();
  const availableCapabilities = capabilities
    .filter(
      (capability) =>
        capability.permissionState === "read_only" &&
        capability.verificationStatus === "verified" &&
        capability.lastSuccessAt !== undefined,
    )
    .map((capability) => capability.category);
  const missingCapabilities = capabilities
    .filter(
      (capability) =>
        capability.permissionState !== "read_only" ||
        capability.verificationStatus !== "verified" ||
        capability.lastErrorCode !== undefined,
    )
    .map((capability) => capability.category);
  const sourceContext = {
    provider: "managebac",
    integrationId: integration._id,
    sourceRecordId: source._id,
    providerClassId: source.providerClassId,
    academicPeriodKey: source.academicPeriodKey,
    sourceHash: source.sourceHash,
    freshAt: source.fetchedAt,
    projectedTitle,
    capabilityState:
      now - source.fetchedAt > integration.freshnessSlaMinutes * 60_000
        ? ("stale" as const)
        : missingCapabilities.length
          ? ("partial" as const)
          : ("available" as const),
    availableCapabilities: [...new Set(availableCapabilities)].sort(),
    missingCapabilities: [...new Set(missingCapabilities)].sort(),
  };
  if (existing) {
    const existingWorkspaceId =
      existing.projectionType === "workspace"
        ? ctx.db.normalizeId("spectraWorkspaces", existing.projectionId)
        : null;
    const existingWorkspace = existingWorkspaceId
      ? await ctx.db.get(existingWorkspaceId)
      : null;
    if (existingWorkspace) {
      const previouslyProjectedTitle =
        existingWorkspace.sourceContext?.projectedTitle;
      await ctx.db.patch(existingWorkspace._id, {
        ...(previouslyProjectedTitle &&
        existingWorkspace.title === previouslyProjectedTitle
          ? { title: projectedTitle }
          : {}),
        description:
          text(normalized.description, 600) ||
          `${text(normalized.course ?? normalized.programme, 120)} - Source-linked from ManageBac`,
        sourceContext,
        status: "active",
        updatedAt: now,
      });
      await ctx.db.patch(existing._id, {
        recordId: source._id,
        sourceHash: source.sourceHash,
        state: "active",
        updatedAt: now,
      });
      return {
        projection: (await ctx.db.get(existing._id))!,
        created: false,
        refreshed: true,
      };
    }
  }
  const workspaceId = await ctx.db.insert("spectraWorkspaces", {
    ownerAccountId: accountId,
    schoolId: integration.schoolId,
    title: projectedTitle,
    description: text(
      normalized.description ??
        `${text(normalized.course ?? normalized.programme, 120)} · Source-linked from ManageBac`,
      600,
    ),
    icon: "BookOpen",
    color: text(normalized.color, 32, "#429379"),
    starterKey: "managebac-class",
    sourceContext,
    status: "active",
    defaultView: "cards",
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  });
  /* A projected class is a workspace like any other, so it is a place in the
     tree from the moment it exists (D32). Without this the class is real but
     unreachable: nothing in the Library or on the board can show a workspace
     that has no node. */
  const projected = await ctx.db.get(workspaceId);
  if (projected) await ensureWorkspaceNode(ctx, projected);
  if (existing) {
    await ctx.db.patch(existing._id, {
      recordId: source._id,
      projectionType: "workspace",
      projectionId: String(workspaceId),
      sourceHash: source.sourceHash,
      state: "active",
      updatedAt: now,
    });
    return {
      projection: (await ctx.db.get(existing._id))!,
      created: true,
      refreshed: false,
    };
  }
  const projectionId = await ctx.db.insert("externalProjections", {
    integrationId: integration._id,
    schoolId: integration.schoolId,
    recordId: source._id,
    accountId,
    projectionType: "workspace",
    projectionId: workspaceId,
    providerKey,
    sourceHash: source.sourceHash,
    state: "active",
    bootstrapVersion: integration.bootstrapVersion,
    createdAt: now,
    updatedAt: now,
  });
  return { projection: (await ctx.db.get(projectionId))!, created: true };
}

async function classWorkspaceId(
  ctx: MutationCtx,
  integrationId: Id<"schoolIntegrations">,
  accountId: Id<"accounts">,
  providerClassId?: string,
  academicPeriodKey?: string,
) {
  if (!providerClassId) return null;
  const providerKey = `class:${providerClassId}:${academicPeriodKey ?? "current"}`;
  const projection = await ctx.db
    .query("externalProjections")
    .withIndex("by_provider_key", (q) =>
      q.eq("integrationId", integrationId).eq("providerKey", providerKey),
    )
    .collect()
    .then(
      (rows) =>
        rows.find(
          (item) =>
            item.accountId === accountId && item.projectionType === "workspace",
        ) ?? null,
    );
  return projection?.projectionType === "workspace"
    ? ctx.db.normalizeId("spectraWorkspaces", projection.projectionId)
    : null;
}

async function ensurePlannerProjection(
  ctx: MutationCtx,
  integration: Doc<"schoolIntegrations">,
  accountId: Id<"accounts">,
  source: Doc<"externalRecords">,
) {
  const sourceKey = projectionSourceKey(source);
  const providerKey = `planner:${sourceKey}`;
  const existingByKey = await ctx.db
    .query("externalProjections")
    .withIndex("by_provider_key", (q) =>
      q.eq("integrationId", integration._id).eq("providerKey", providerKey),
    )
    .collect();
  const existingByRecord = await ctx.db
    .query("externalProjections")
    .withIndex("by_record_type", (q) =>
      q.eq("recordId", source._id).eq("projectionType", "planner_task"),
    )
    .collect();
  const existing =
    existingByKey.find(
      (item) =>
        item.schoolId === integration.schoolId &&
        item.accountId === accountId &&
        item.projectionType === "planner_task",
    ) ??
    existingByRecord.find(
      (item) => item.schoolId === integration.schoolId && item.accountId === accountId,
    ) ??
    null;
  if (existing) {
    if (existing.providerKey !== providerKey || existing.state !== "active")
      await ctx.db.patch(existing._id, {
        providerKey,
        state: "active",
        updatedAt: Date.now(),
      });
    return {
      projection: (await ctx.db.get(existing._id))!,
      created: false,
    };
  }
  const normalized = record(source.normalized);
  const now = Date.now();
  const content = {
    ...(defaultArtifactContent("planner_task") as Record<string, unknown>),
    taskTitle: text(normalized.title ?? normalized.name, 240, "ManageBac task"),
    description: plainText(normalized.description, 20_000),
    status: "todo",
    priority:
      normalized.priority === "high" || normalized.priority === "low"
        ? normalized.priority
        : "medium",
    dueAt:
      typeof normalized.dueAt === "number"
        ? normalized.dueAt
        : typeof normalized.dueAt === "string" &&
            !Number.isNaN(Date.parse(normalized.dueAt))
          ? Date.parse(normalized.dueAt)
          : undefined,
    source: {
      provider: "managebac",
      externalId: source.providerRecordId,
      version: source.payloadVersion,
      hash: source.sourceHash,
      status: source.tombstone ? "removed" : "active",
      lockedFields: ["taskTitle", "description", "dueAt", "source"],
    },
    sourceRefs: [`managebac:${sourceKey}`],
    personalOverlay: {},
  };
  const title = text(
    normalized.title ?? normalized.name,
    240,
    "ManageBac task",
  );
  const artifactId = await ctx.db.insert("spectraArtifacts", {
    ownerAccountId: accountId,
    schoolId: integration.schoolId,
    blueprintKey: "planner_task",
    schemaVersion: defaultArtifactSchemaVersion("planner_task"),
    title,
    summary: plainText(
      normalized.description,
      600,
      "Source-linked ManageBac task",
    ),
    content,
    textIndex: buildArtifactTextIndex({
      title,
      summary: plainText(normalized.description, 600),
      content,
      tags: ["managebac", "source-linked"],
    }),
    tags: ["managebac", "source-linked"],
    status: "active",
    createdFrom: {
      source: "manual",
      contextSummary: `ManageBac ${source.recordType} ${source.providerRecordKey}`,
    },
    createdAt: now,
    updatedAt: now,
  });
  const workspaceId = await classWorkspaceId(
    ctx,
    integration._id,
    accountId,
    source.providerClassId,
    source.academicPeriodKey,
  );
  await placeSourceNode(ctx, {
    accountId,
    schoolId: integration.schoolId,
    kind: "work",
    sourceId: artifactId,
    name: title,
    target: workspaceId ? { workspaceId } : {},
    placedByAccountId: accountId,
    accessProjection: true,
  });
  const projectionId = await ctx.db.insert("externalProjections", {
    integrationId: integration._id,
    schoolId: integration.schoolId,
    recordId: source._id,
    accountId,
    projectionType: "planner_task",
    projectionId: artifactId,
    providerKey,
    sourceHash: source.sourceHash,
    state: "active",
    bootstrapVersion: integration.bootstrapVersion,
    createdAt: now,
    updatedAt: now,
  });
  return { projection: (await ctx.db.get(projectionId))!, created: true };
}

async function ensureTimetableProjection(
  ctx: MutationCtx,
  integration: Doc<"schoolIntegrations">,
  accountId: Id<"accounts">,
  source: Doc<"externalRecords">,
) {
  const sourceKey = projectionSourceKey(source);
  const providerKey = `timetable:${sourceKey}`;
  const existingByKey = await ctx.db
    .query("externalProjections")
    .withIndex("by_provider_key", (q) =>
      q.eq("integrationId", integration._id).eq("providerKey", providerKey),
    )
    .collect();
  const existingByRecord = await ctx.db
    .query("externalProjections")
    .withIndex("by_record_type", (q) =>
      q.eq("recordId", source._id).eq("projectionType", "timetable_event"),
    )
    .collect();
  const existing =
    existingByKey.find(
      (item) =>
        item.schoolId === integration.schoolId &&
        item.accountId === accountId &&
        item.projectionType === "timetable_event",
    ) ??
    existingByRecord.find(
      (item) => item.schoolId === integration.schoolId && item.accountId === accountId,
    ) ??
    null;
  const legacyCalendarItem = existing
    ? await legacyTimetableCalendarItem(
        ctx,
        existing,
        integration.schoolId,
        accountId,
      )
    : null;
  const calendar = await upsertSourceCalendarItem(ctx, {
    ownerAccountId: accountId,
    schoolId: integration.schoolId,
    sourceRecordId: source._id,
    ...(legacyCalendarItem ? { existingItemId: legacyCalendarItem._id } : {}),
    sourceKey,
    sourceHash: source.sourceHash,
    sourceUrl: source.provenanceUrl,
    fetchedAt: source.fetchedAt,
    recordType: source.recordType,
    normalized: record(source.normalized),
  });
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, {
      projectionId: String(calendar.itemId),
      providerKey,
      sourceHash: source.sourceHash,
      state: "active",
      updatedAt: now,
    });
    return { projection: (await ctx.db.get(existing._id))!, created: calendar.created };
  }
  const projectionId = await ctx.db.insert("externalProjections", {
      integrationId: integration._id,
      schoolId: integration.schoolId,
      recordId: source._id,
      accountId,
      projectionType: "timetable_event",
      projectionId: String(calendar.itemId),
      providerKey,
      sourceHash: source.sourceHash,
      state: "active",
      bootstrapVersion: integration.bootstrapVersion,
      createdAt: now,
      updatedAt: now,
    });
  return { projection: (await ctx.db.get(projectionId))!, created: calendar.created };
}

function legacyTimetableParts(projectionId: string) {
  const separator = projectionId.indexOf("#");
  if (separator <= 0 || separator === projectionId.length - 1) return null;
  return {
    artifactValue: projectionId.slice(0, separator),
    eventId: projectionId.slice(separator + 1),
  };
}

async function legacyTimetableCalendarItem(
  ctx: MutationCtx,
  projection: Doc<"externalProjections">,
  schoolId: Id<"schools">,
  accountId: Id<"accounts">,
) {
  if (!accountId) return null;
  const legacy = legacyTimetableParts(projection.projectionId);
  if (!legacy) return null;
  const artifactId = ctx.db.normalizeId("spectraArtifacts", legacy.artifactValue);
  if (!artifactId) return null;
  const item = await ctx.db
    .query("calendarItems")
    .withIndex("by_legacy_event", (q) =>
      q.eq("legacyArtifactId", artifactId).eq("legacyEventId", legacy.eventId),
    )
    .unique();
  if (
    !item ||
    item.ownerAccountId !== accountId ||
    item.schoolId !== schoolId ||
    !item.sourceLocked
  )
    return null;
  return item;
}

async function legacyTimetableArtifactEvent(
  ctx: MutationCtx,
  projection: Doc<"externalProjections">,
) {
  const legacy = legacyTimetableParts(projection.projectionId);
  if (!legacy) return null;
  const artifactId = ctx.db.normalizeId("spectraArtifacts", legacy.artifactValue);
  if (!artifactId) return null;
  const artifact = await ctx.db.get(artifactId);
  if (
    !artifact ||
    artifact.blueprintKey !== "timetable" ||
    (projection.accountId && artifact.ownerAccountId !== projection.accountId) ||
    artifact.schoolId !== projection.schoolId
  )
    return null;
  const content = record(artifact.content);
  const events = array(content.events).map(record);
  const index = events.findIndex((event) => event.id === legacy.eventId);
  if (index < 0) return null;
  return {
    artifact,
    content,
    events,
    eventId: legacy.eventId,
    index,
  };
}

async function directTimetableCalendarItem(
  ctx: MutationCtx,
  projection: Doc<"externalProjections">,
  source: Doc<"externalRecords">,
) {
  if (!projection.accountId) return null;
  const itemId = ctx.db.normalizeId("calendarItems", projection.projectionId);
  if (!itemId) return null;
  const item = await ctx.db.get(itemId);
  if (
    !item ||
    item.ownerAccountId !== projection.accountId ||
    item.schoolId !== projection.schoolId ||
    item.sourceProvider !== "managebac" ||
    item.sourceRecordId !== source._id ||
    !item.sourceLocked
  )
    return null;
  return item;
}

async function ensureResourceProjection(
  ctx: MutationCtx,
  integration: Doc<"schoolIntegrations">,
  accountId: Id<"accounts">,
  source: Doc<"externalRecords">,
) {
  const sourceKey = projectionSourceKey(source);
  const providerKey = `resource:${sourceKey}`;
  const existingByKey = await ctx.db
    .query("externalProjections")
    .withIndex("by_provider_key", (q) =>
      q.eq("integrationId", integration._id).eq("providerKey", providerKey),
    )
    .collect();
  const existingByRecord = await ctx.db
    .query("externalProjections")
    .withIndex("by_record_type", (q) =>
      q.eq("recordId", source._id).eq("projectionType", "resource"),
    )
    .collect();
  const existing =
    existingByKey.find(
      (item) =>
        item.schoolId === integration.schoolId &&
        item.accountId === accountId &&
        item.projectionType === "resource",
    ) ??
    existingByRecord.find(
      (item) => item.schoolId === integration.schoolId && item.accountId === accountId,
    ) ??
    null;
  const now = Date.now();
  const sourceId = `managebac:${source._id}`;
  /* The projection below is the record of this resource. It gets no tree node:
     the tree holds identities, and a provider resource has none here until it
     becomes a real artifact. */
  if (existing) {
    await ctx.db.patch(existing._id, {
      recordId: source._id,
      sourceHash: source.sourceHash,
      providerKey,
      state: "active",
      updatedAt: now,
    });
    return { projection: (await ctx.db.get(existing._id))!, created: false };
  }
  const projectionId = await ctx.db.insert("externalProjections", {
    integrationId: integration._id,
    schoolId: integration.schoolId,
    recordId: source._id,
    accountId,
    projectionType: "resource",
    projectionId: sourceId,
    providerKey,
    sourceHash: source.sourceHash,
    state: "active",
    bootstrapVersion: integration.bootstrapVersion,
    createdAt: now,
    updatedAt: now,
  });
  return { projection: (await ctx.db.get(projectionId))!, created: true };
}

async function ensureSourceRelations(
  ctx: MutationCtx,
  integration: Doc<"schoolIntegrations">,
  source: Doc<"externalRecords">,
) {
  if (!source.providerClassId || source.recordType === "class") return;
  const classCandidates = await ctx.db
    .query("externalRecords")
    .withIndex("by_integration_type", (q) =>
      q.eq("integrationId", integration._id).eq("recordType", "class"),
    )
    .take(500);
  const target = classCandidates.find(
    (item) =>
      item.schoolId === integration.schoolId &&
      (item.mappedAccountId === undefined ||
        item.mappedAccountId === source.mappedAccountId) &&
      (item.providerRecordId === source.providerClassId ||
        item.providerClassId === source.providerClassId),
  );
  if (!target) return;
  const relationType =
    source.recordType === "assessment"
      ? ("assessment_for" as const)
      : source.recordType === "deadline"
        ? ("deadline_for" as const)
        : ["resource", "file", "class_resource", "school_resource"].includes(
              source.recordType,
            )
          ? ("resource_for" as const)
          : ("belongs_to_class" as const);
  const existing = (
    await ctx.db
      .query("externalRecordRelations")
      .withIndex("by_source", (q) => q.eq("sourceRecordId", source._id))
      .collect()
  ).find(
    (item) =>
      item.targetRecordId === target._id && item.relationType === relationType,
  );
  if (existing) return;
  await ctx.db.insert("externalRecordRelations", {
    integrationId: integration._id,
    schoolId: integration.schoolId,
    sourceRecordId: source._id,
    targetRecordId: target._id,
    relationType,
    createdAt: Date.now(),
  });
}

async function safelyRefreshProjection(
  ctx: MutationCtx,
  projection: Doc<"externalProjections">,
  previousSourceHash: string,
  source: Doc<"externalRecords">,
  force = false,
  previousNormalized?: unknown,
) {
  const normalized = record(source.normalized);
  if (projection.projectionType === "planner_task") {
    const artifactId = ctx.db.normalizeId(
      "spectraArtifacts",
      projection.projectionId,
    );
    const artifact = artifactId ? await ctx.db.get(artifactId) : null;
    if (!artifact || artifact.blueprintKey !== "planner_task" ||
      artifact.ownerAccountId !== projection.accountId || artifact.schoolId !== projection.schoolId) return false;
    const content = record(artifact.content);
    const sourceState = record(content.source);
    if (!force && sourceState.hash !== previousSourceHash) return false;
    const title = text(
      normalized.title ?? normalized.name,
      240,
      artifact.title,
    );
    const previous = previousNormalized !== undefined && sourceState.hash === previousSourceHash
      ? record(previousNormalized) : undefined;
    const previousText = previous ? {
      title: text(previous.title ?? previous.name, 240, "ManageBac task"),
      description: plainText(previous.description, 20_000),
    } : undefined;
    const nextContent = refreshPlannerSourceContent(content, {
      title,
      description: plainText(normalized.description, 20_000),
      dueAt: timestampValue(normalized.dueAt),
      source: {
        ...sourceState,
        provider: "managebac",
        externalId: source.providerRecordId,
        version: source.payloadVersion,
        hash: source.sourceHash,
        status: "active",
        lockedFields: ["taskTitle", "description", "dueAt", "source"],
      },
    }, previousText);
    const nextTitle = previousText && artifact.title === previousText.title ? title : artifact.title;
    const nextSummary = previous && artifact.summary === plainText(previous.description, 600)
      ? plainText(normalized.description, 600, artifact.summary ?? "") : artifact.summary;
    const now = Date.now();
    await ctx.db.patch(artifact._id, {
      title: nextTitle,
      summary: nextSummary,
      content: nextContent,
      textIndex: buildArtifactTextIndex({
        title: nextTitle,
        summary: nextSummary,
        content: nextContent,
        tags: artifact.tags,
      }),
      updatedAt: now,
    });
    return true;
  }
  if (projection.projectionType === "timetable_event") {
    const directItem = await directTimetableCalendarItem(ctx, projection, source);
    if (directItem) {
      if (!force && directItem.sourceHash !== previousSourceHash) return false;
      await upsertSourceCalendarItem(ctx, {
        ownerAccountId: projection.accountId!,
        schoolId: projection.schoolId,
        sourceRecordId: source._id,
        existingItemId: directItem._id,
        sourceKey: projectionSourceKey(source),
        sourceHash: source.sourceHash,
        sourceUrl: source.provenanceUrl,
        fetchedAt: source.fetchedAt,
        recordType: source.recordType,
        normalized,
      });
      return true;
    }

    const legacy = await legacyTimetableArtifactEvent(ctx, projection);
    if (!legacy) return false;
    const oldEvent = legacy.events[legacy.index]!;
    if (!force && oldEvent.sourceHash !== previousSourceHash) return false;
    const start =
      isoValue(normalized.startAt ?? normalized.start ?? normalized.beginsAt) ??
      text(oldEvent.start, 100);
    const end =
      isoValue(normalized.endAt ?? normalized.end ?? normalized.finishesAt) ??
      text(oldEvent.end, 100);
    legacy.events[legacy.index] = {
      ...oldEvent,
      title: text(
        normalized.title ?? normalized.name,
        300,
        text(oldEvent.title, 300),
      ),
      start,
      end:
        Date.parse(end) > Date.parse(start)
          ? end
          : new Date(Date.parse(start) + 30 * 60_000).toISOString(),
      sourceVersion: source.payloadVersion,
      sourceHash: source.sourceHash,
      sourceStatus: "active",
      ...(text(normalized.location, 300)
        ? { location: text(normalized.location, 300) }
        : {}),
      ...(text(normalized.description ?? normalized.notes, 20_000)
        ? { notes: text(normalized.description ?? normalized.notes, 20_000) }
        : {}),
    };
    const nextContent = { ...legacy.content, events: legacy.events };
    const now = Date.now();
    await ctx.db.patch(legacy.artifact._id, {
      content: nextContent,
      textIndex: buildArtifactTextIndex({
        title: legacy.artifact.title,
        summary: legacy.artifact.summary ?? "",
        content: nextContent,
        tags: legacy.artifact.tags,
      }),
      updatedAt: now,
    });
    const legacyCalendarItem = projection.accountId
      ? await legacyTimetableCalendarItem(
          ctx,
          projection,
          projection.schoolId,
          projection.accountId,
        )
      : null;
    if (legacyCalendarItem)
      await upsertSourceCalendarItem(ctx, {
        ownerAccountId: projection.accountId!,
        schoolId: projection.schoolId,
        sourceRecordId: source._id,
        existingItemId: legacyCalendarItem._id,
        sourceKey: projectionSourceKey(source),
        sourceHash: source.sourceHash,
        sourceUrl: source.provenanceUrl,
        fetchedAt: source.fetchedAt,
        recordType: source.recordType,
        normalized,
      });
    return true;
  }
  return true;
}

async function markProjectionSourceRemoved(
  ctx: MutationCtx,
  projection: Doc<"externalProjections">,
) {
  if (projection.projectionType === "planner_task") {
    const artifactId = ctx.db.normalizeId(
      "spectraArtifacts",
      projection.projectionId,
    );
    const artifact = artifactId ? await ctx.db.get(artifactId) : null;
    if (!artifact || artifact.blueprintKey !== "planner_task") return;
    const content = record(artifact.content);
    const source = record(content.source);
    await ctx.db.patch(artifact._id, {
      content: {
        ...content,
        source: { ...source, status: "removed" },
      },
      updatedAt: Date.now(),
    });
    return;
  }
  if (projection.projectionType === "timetable_event") {
    const source = await ctx.db.get(projection.recordId);
    const directItem = source
      ? await directTimetableCalendarItem(ctx, projection, source)
      : null;
    if (directItem) {
      if (directItem.status !== "removed" || directItem.sourceCapabilityState !== "stale")
        await ctx.db.patch(directItem._id, {
          status: "removed",
          sourceCapabilityState: "stale",
          revision: directItem.revision + 1,
          updatedAt: Date.now(),
        });
      return;
    }
    const legacy = await legacyTimetableArtifactEvent(ctx, projection);
    if (!legacy) return;
    legacy.events[legacy.index] = {
      ...legacy.events[legacy.index],
      sourceStatus: "removed",
    };
    const now = Date.now();
    const nextContent = { ...legacy.content, events: legacy.events };
    await ctx.db.patch(legacy.artifact._id, {
      content: nextContent,
      textIndex: buildArtifactTextIndex({
        title: legacy.artifact.title,
        summary: legacy.artifact.summary ?? "",
        content: nextContent,
        tags: legacy.artifact.tags,
      }),
      updatedAt: now,
    });
    if (source) {
      const legacyCalendarItem = projection.accountId
        ? await legacyTimetableCalendarItem(
            ctx,
            projection,
            projection.schoolId,
            projection.accountId,
          )
        : null;
      if (
        legacyCalendarItem &&
        (legacyCalendarItem.status !== "removed" ||
          legacyCalendarItem.sourceCapabilityState !== "stale")
      )
        await ctx.db.patch(legacyCalendarItem._id, {
          status: "removed",
          sourceCapabilityState: "stale",
          revision: legacyCalendarItem.revision + 1,
          updatedAt: now,
        });
    }
  }
}

async function projectRecord(
  ctx: MutationCtx,
  integration: Doc<"schoolIntegrations">,
  syncRun: Doc<"externalSyncRuns">,
  source: Doc<"externalRecords">,
) {
  if (!syncRun.accountId) return { projected: false, created: false };
  if (source.recordType === "class") {
    // Class workspaces are never auto-created. Sync stores the record only;
    // each user chooses which classes to materialize from the school-data dashboard.
    return { projected: false, created: false };
  }
  if (["assignment", "deadline", "assessment"].includes(source.recordType)) {
    const result = await ensurePlannerProjection(
      ctx,
      integration,
      syncRun.accountId,
      source,
    );
    const calendar = await ensureTimetableProjection(
      ctx,
      integration,
      syncRun.accountId,
      source,
    );
    return {
      projected: true,
      created: result.created || calendar.created,
    };
  }
  if (
    ["timetable", "lesson", "class_event", "calendar_event"].includes(
      source.recordType,
    )
  ) {
    const result = await ensureTimetableProjection(
      ctx,
      integration,
      syncRun.accountId,
      source,
    );
    return { projected: Boolean(result.projection), created: result.created };
  }
  if (
    ["resource", "file", "class_resource", "school_resource"].includes(
      source.recordType,
    )
  ) {
    const result = await ensureResourceProjection(
      ctx,
      integration,
      syncRun.accountId,
      source,
    );
    return { projected: true, created: result.created };
  }
  return { projected: false, created: false };
}

export const commitNormalizedPage = mutation({
  args: {
    integrationId: v.id("schoolIntegrations"),
    syncRunId: v.id("externalSyncRuns"),
    serviceSubject: v.optional(v.string()),
    capabilityId: v.id("integrationCapabilities"),
    records: v.array(vNormalizedRecord),
    nextCursor: v.optional(v.string()),
    pageNumber: v.number(),
    leaseToken: v.optional(v.string()),
    selectionRevision: v.optional(v.number()),
    payloadDigest: v.string(),
    timestamp: v.number(),
    nonce: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorOrService(ctx, args.serviceSubject);
    const integration = await requireIntegration(
      ctx,
      actor,
      args.integrationId,
    );
    const [syncRun, capability] = await Promise.all([
      ctx.db.get(args.syncRunId),
      ctx.db.get(args.capabilityId),
    ]);
    if (
      !syncRun ||
      syncRun.integrationId !== integration._id ||
      (syncRun.accountId &&
        syncRun.accountId !== actor.accountId &&
        actor.schoolRole !== "school_admin") ||
      !capability ||
      capability.integrationId !== integration._id ||
      !syncRun.capabilityIds.includes(capability._id)
    )
      throw new Error("INTEGRATION_SYNC_FORBIDDEN: Sync scope mismatch.");
    await assertCurrentSyncLease(ctx, syncRun, args.leaseToken);
    if (
      args.selectionRevision !== undefined &&
      args.selectionRevision !== (syncRun.selectionRevision ?? 0)
    )
      throw new Error(
        "INTEGRATION_SELECTION_CHANGED: This page belongs to an older class selection.",
      );
    const expectedDigest = await exactDigest({
      capabilityId: args.capabilityId,
      records: args.records,
      ...(args.nextCursor ? { nextCursor: args.nextCursor } : {}),
      pageNumber: args.pageNumber,
      ...(args.leaseToken ? { leaseToken: args.leaseToken } : {}),
      ...(args.selectionRevision !== undefined
        ? { selectionRevision: args.selectionRevision }
        : {}),
    });
    if (expectedDigest !== args.payloadDigest)
      throw new Error("INTEGRATION_PAYLOAD_INVALID: Sync page changed.");
    await verifyBridge(ctx, actor, {
      operation: "sync-page",
      integrationId: integration._id,
      syncRunId: syncRun._id,
      timestamp: args.timestamp,
      nonce: args.nonce,
      payloadDigest: args.payloadDigest,
      signature: args.signature,
    });
    if (
      capability.permissionState !== "read_only" ||
      capability.verificationStatus !== "verified"
    )
      throw new Error(
        "INTEGRATION_CAPABILITY_UNVERIFIED: Route is not usable.",
      );
    if (args.records.length > 500)
      throw new Error(
        "INTEGRATION_PAGE_TOO_LARGE: Page exceeds the safe bound.",
      );
    const now = Date.now();
    const counts = { ...syncRun.counts };
    counts.fetched += args.records.length;
    const followsClass = classFollowPolicy(ctx, integration._id);
    for (const input of args.records) {
      if (!await followsClass(syncRun.accountId, { ...input, recordType: capability.recordType })) {
        counts.skipped += 1;
        continue;
      }
      const mappedAccountId =
        input.audienceScope === "mapped_user" ? syncRun.accountId : undefined;
      const canonicalKey = sourceIdentityKey(integration._id, mappedAccountId, {
        providerRecordKey: input.providerRecordKey,
        audienceScope: input.audienceScope,
        academicPeriodKey: input.academicPeriodKey,
      });
      const canonicalMatches = await ctx.db
        .query("externalRecords")
        .withIndex("by_source_identity", (q) =>
          q.eq("integrationId", integration._id).eq("sourceIdentityKey", canonicalKey),
        )
        .collect();
      const existing =
        canonicalMatches.find(
          (item) =>
            item.schoolId === integration.schoolId &&
            item.sourceIdentityKey === canonicalKey,
        ) ??
        (
          await ctx.db
        .query("externalRecords")
        .withIndex("by_integration_key", (q) =>
          q
            .eq("integrationId", integration._id)
            .eq("providerRecordKey", input.providerRecordKey),
        )
        .collect()
        ).find(
          (item) =>
            item.schoolId === integration.schoolId &&
            item.sourceIdentityKey === undefined &&
            item.audienceScope === input.audienceScope &&
            item.mappedAccountId === mappedAccountId &&
            canonicalAcademicPeriodKey(item.academicPeriodKey) ===
              canonicalAcademicPeriodKey(input.academicPeriodKey),
        );
      let source: Doc<"externalRecords">;
      if (existing?.sourceHash === input.sourceHash && !existing.tombstone) {
        counts.unchanged += 1;
        await ctx.db.patch(existing._id, {
          sourceIdentityKey: canonicalKey,
          sourceState: "available",
          sourceStateAt: now,
          sourceStateReason: undefined,
          updatedAt: now,
        });
        source = (await ctx.db.get(existing._id))!;
      } else if (existing) {
        const previousNormalized = existing.normalized;
        await ctx.db.patch(existing._id, {
          providerRecordId: input.providerRecordId.slice(0, 500),
          recordType: capability.recordType,
          classification: input.classification,
          audienceScope: input.audienceScope,
          mappedAccountId,
          providerClassId: input.providerClassId?.slice(0, 500),
          academicPeriodKey: input.academicPeriodKey?.slice(0, 300),
          normalized: input.normalized,
          payloadVersion: input.payloadVersion.slice(0, 100),
          sourceHash: input.sourceHash.slice(0, 180),
          sourceModifiedAt: input.sourceModifiedAt,
          provenanceUrl: input.provenanceUrl?.slice(0, 2_000),
          tombstone: false,
          tombstonedAt: undefined,
          sourceIdentityKey: canonicalKey,
          sourceState:
            existing.sourceHash === input.sourceHash ? "available" : "changed",
          sourceStateAt: now,
          sourceStateReason: undefined,
          fetchedAt: now,
          updatedAt: now,
        });
        source = (await ctx.db.get(existing._id))!;
        counts.updated += 1;
        const candidateProjections = await ctx.db
          .query("externalProjections")
          .withIndex("by_record_type", (q) => q.eq("recordId", existing._id))
          .collect()
          .then((rows) =>
            syncRun.accountId
              ? rows.filter((item) => item.accountId === syncRun.accountId)
              : rows,
          );
        const following = await Promise.all(candidateProjections.map(projection => followsClass(projection.accountId, source)));
        const projections = candidateProjections.filter((_, index) => following[index]);
        const overlays = syncRun.accountId
          ? await ctx.db
              .query("externalRecordOverlays")
              .withIndex("by_record_account", (q) =>
                q
                  .eq("recordId", existing._id)
                  .eq("accountId", syncRun.accountId!),
              )
              .unique()
          : null;
        const sourceChangedUnderOverlay =
          Boolean(overlays) && overlays!.sourceHashAtEdit !== input.sourceHash;
        let projectionRefreshFailed = false;
        if (!sourceChangedUnderOverlay) {
          for (const projection of projections) {
            const refreshed = await safelyRefreshProjection(
              ctx,
              projection,
              existing.sourceHash,
              source,
              false,
              previousNormalized,
            );
            if (!refreshed) projectionRefreshFailed = true;
          }
        }
        if (
          projections.length &&
          (sourceChangedUnderOverlay || projectionRefreshFailed)
        ) {
          await ctx.db.insert("externalSyncConflicts", {
            syncRunId: syncRun._id,
            integrationId: integration._id,
            schoolId: integration.schoolId,
            accountId: syncRun.accountId,
            recordId: existing._id,
            projectionType: projections[0]!.projectionType,
            projectionId: projections[0]!.projectionId,
            kind: "customization_overlap",
            oldSource: previousNormalized,
            newSource: input.normalized,
            overlay: overlays ?? {
              reason:
                "A source-controlled field no longer matches the last synchronized value.",
            },
            affectedLinks: projections.map((item) => item.projectionId),
            suggestedActions: ["rebase", "keep_overlay", "detach"],
            status: "open",
            createdAt: now,
            updatedAt: now,
          });
          for (const projection of projections)
            await ctx.db.patch(projection._id, {
              state: "conflicted",
              updatedAt: now,
            });
          counts.conflicts += 1;
        } else {
          for (const projection of projections)
            await ctx.db.patch(projection._id, {
              sourceHash: input.sourceHash,
              state: "active",
              updatedAt: now,
            });
        }
      } else {
        const id = await ctx.db.insert("externalRecords", {
          integrationId: integration._id,
          schoolId: integration.schoolId,
          providerRecordId: input.providerRecordId.slice(0, 500),
          providerRecordKey: input.providerRecordKey.slice(0, 700),
          recordType: capability.recordType,
          classification: input.classification,
          audienceScope: input.audienceScope,
          mappedAccountId,
          providerClassId: input.providerClassId?.slice(0, 500),
          academicPeriodKey: input.academicPeriodKey?.slice(0, 300),
          normalized: input.normalized,
          payloadVersion: input.payloadVersion.slice(0, 100),
          sourceHash: input.sourceHash.slice(0, 180),
          sourceModifiedAt: input.sourceModifiedAt,
          provenanceUrl: input.provenanceUrl?.slice(0, 2_000),
          tombstone: false,
          sourceIdentityKey: canonicalKey,
          sourceState: "available",
          sourceStateAt: now,
          fetchedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        source = (await ctx.db.get(id))!;
        counts.created += 1;
      }
      await ensureSourceRelations(ctx, integration, source);
      const projection = await projectRecord(ctx, integration, syncRun, source);
      if (projection.projected) counts.projected += projection.created ? 1 : 0;
    }
    const capabilityRun = (
      await ctx.db
        .query("externalSyncCapabilityRuns")
        .withIndex("by_sync_run", (q) => q.eq("syncRunId", syncRun._id))
        .collect()
    ).find((item) => item.capabilityId === capability._id);
    if (capabilityRun)
      await ctx.db.patch(capabilityRun._id, {
        status: args.nextCursor ? "running" : "completed",
        pageCount: capabilityRun.pageCount + 1,
        recordCount: capabilityRun.recordCount + args.records.length,
        cursor: args.nextCursor,
        schemaHash: capability.responseSchemaHash,
        startedAt: capabilityRun.startedAt ?? now,
        completedAt: args.nextCursor ? undefined : now,
        updatedAt: now,
      });
    await ctx.db.patch(syncRun._id, {
      status: "running",
      stage: `syncing:${capability.category}`,
      currentCapabilityId: capability._id,
      cursorState: args.nextCursor
        ? { capabilityId: capability._id, cursor: args.nextCursor }
        : undefined,
      counts,
      startedAt: syncRun.startedAt ?? now,
      leaseExpiresAt: syncRun.leaseToken
        ? now + SYNC_LEASE_MS
        : syncRun.leaseExpiresAt,
      updatedAt: now,
    });
    return { counts, nextCursor: args.nextCursor };
  },
});

export const commitQuarantine = mutation({
  args: {
    integrationId: v.id("schoolIntegrations"),
    syncRunId: v.id("externalSyncRuns"),
    serviceSubject: v.optional(v.string()),
    capabilityId: v.id("integrationCapabilities"),
    reasonCode: v.string(),
    payloadHash: v.string(),
    providerRecordKeyHash: v.string(),
    sanitizedSample: v.optional(v.any()),
    leaseToken: v.optional(v.string()),
    selectionRevision: v.optional(v.number()),
    payloadDigest: v.string(),
    timestamp: v.number(),
    nonce: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorOrService(ctx, args.serviceSubject);
    const integration = await requireIntegration(
      ctx,
      actor,
      args.integrationId,
    );
    const [syncRun, capability] = await Promise.all([
      ctx.db.get(args.syncRunId),
      ctx.db.get(args.capabilityId),
    ]);
    if (
      !syncRun ||
      syncRun.integrationId !== integration._id ||
      (syncRun.accountId &&
        syncRun.accountId !== actor.accountId &&
        actor.schoolRole !== "school_admin") ||
      !capability ||
      capability.integrationId !== integration._id
    )
      throw new Error("INTEGRATION_SYNC_FORBIDDEN: Quarantine scope mismatch.");
    await assertCurrentSyncLease(ctx, syncRun, args.leaseToken);
    if (
      args.selectionRevision !== undefined &&
      args.selectionRevision !== (syncRun.selectionRevision ?? 0)
    )
      throw new Error(
        "INTEGRATION_SELECTION_CHANGED: This quarantine belongs to an older class selection.",
      );
    const expectedDigest = await exactDigest({
      capabilityId: args.capabilityId,
      reasonCode: args.reasonCode,
      payloadHash: args.payloadHash,
      providerRecordKeyHash: args.providerRecordKeyHash,
      ...(args.sanitizedSample !== undefined
        ? { sanitizedSample: args.sanitizedSample }
        : {}),
      ...(args.leaseToken ? { leaseToken: args.leaseToken } : {}),
      ...(args.selectionRevision !== undefined
        ? { selectionRevision: args.selectionRevision }
        : {}),
    });
    if (expectedDigest !== args.payloadDigest)
      throw new Error(
        "INTEGRATION_PAYLOAD_INVALID: Quarantine payload changed.",
      );
    await verifyBridge(ctx, actor, {
      operation: "quarantine",
      integrationId: integration._id,
      syncRunId: syncRun._id,
      timestamp: args.timestamp,
      nonce: args.nonce,
      payloadDigest: args.payloadDigest,
      signature: args.signature,
    });
    const now = Date.now();
    const quarantineId = await ctx.db.insert("externalQuarantineRecords", {
      syncRunId: syncRun._id,
      integrationId: integration._id,
      schoolId: integration.schoolId,
      capabilityId: capability._id,
      providerRecordKeyHash: args.providerRecordKeyHash.slice(0, 180),
      payloadHash: args.payloadHash.slice(0, 180),
      sanitizedSample: args.sanitizedSample,
      reasonCode: text(args.reasonCode, 200),
      contractVersion: capability.contractVersion,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(capability._id, {
      verificationStatus: "quarantined",
      lastErrorCode: text(args.reasonCode, 200),
      updatedAt: now,
    });
    const capabilityRun = (
      await ctx.db
        .query("externalSyncCapabilityRuns")
        .withIndex("by_sync_run", (q) => q.eq("syncRunId", syncRun._id))
        .collect()
    ).find((item) => item.capabilityId === capability._id);
    if (capabilityRun)
      await ctx.db.patch(capabilityRun._id, {
        status: "quarantined",
        errorCode: text(args.reasonCode, 200),
        errorSummary:
          "Provider response shape or route behavior requires administrator review.",
        completedAt: now,
        updatedAt: now,
      });
    await ctx.db.patch(syncRun._id, {
      status: "running",
      stage: `quarantined:${capability.category}`,
      counts: {
        ...syncRun.counts,
        quarantined: syncRun.counts.quarantined + 1,
        errors: syncRun.counts.errors + 1,
      },
      updatedAt: now,
    });
    return { quarantineId };
  },
});

export const failSync = mutation({
  args: {
    integrationId: v.id("schoolIntegrations"),
    syncRunId: v.id("externalSyncRuns"),
    serviceSubject: v.optional(v.string()),
    errorCode: v.string(),
    errorSummary: v.string(),
    retryAfterAt: v.optional(v.number()),
    leaseToken: v.optional(v.string()),
    payloadDigest: v.string(),
    timestamp: v.number(),
    nonce: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorOrService(ctx, args.serviceSubject);
    const integration = await requireIntegration(
      ctx,
      actor,
      args.integrationId,
    );
    const syncRun = await ctx.db.get(args.syncRunId);
    if (
      !syncRun ||
      syncRun.integrationId !== integration._id ||
      (syncRun.accountId &&
        syncRun.accountId !== actor.accountId &&
        actor.schoolRole !== "school_admin")
    )
      throw new Error("INTEGRATION_SYNC_FORBIDDEN: Sync run mismatch.");
    const selectionChanged = args.errorCode === "INTEGRATION_SELECTION_CHANGED";
    await assertCurrentSyncLease(ctx, syncRun, args.leaseToken, {
      allowSelectionChange: selectionChanged,
    });
    const expectedDigest = await exactDigest({
      errorCode: args.errorCode,
      errorSummary: args.errorSummary,
      ...(args.retryAfterAt !== undefined
        ? { retryAfterAt: args.retryAfterAt }
        : {}),
      ...(args.leaseToken ? { leaseToken: args.leaseToken } : {}),
    });
    if (expectedDigest !== args.payloadDigest)
      throw new Error("INTEGRATION_PAYLOAD_INVALID: Failure payload changed.");
    await verifyBridge(ctx, actor, {
      operation: "sync-fail",
      integrationId: integration._id,
      syncRunId: syncRun._id,
      timestamp: args.timestamp,
      nonce: args.nonce,
      payloadDigest: args.payloadDigest,
      signature: args.signature,
    });
    const now = Date.now();
    const retryAt =
      args.retryAfterAt ??
      (args.errorCode === "INTEGRATION_CREDENTIAL_REJECTED"
        ? now + 365 * 24 * 60 * 60_000
        : now + Math.min(30 * 60_000, 30_000 * 2 ** syncRun.attemptCount));
    const partial =
      syncRun.counts.created +
        syncRun.counts.updated +
        syncRun.counts.unchanged >
      0;
    if (!selectionChanged) {
      const sources = await ctx.db
        .query("externalRecords")
        .withIndex("by_school_updated", (q) => q.eq("schoolId", actor.schoolId))
        .take(5_000);
      const scopedSources = sources.filter(
        (item) =>
          item.integrationId === integration._id &&
          !item.tombstone &&
          (syncRun.accountId
            ? item.mappedAccountId === syncRun.accountId
            : item.mappedAccountId === undefined),
      );
      for (const source of scopedSources)
        await ctx.db.patch(source._id, {
          sourceState: "temporarily_unavailable",
          sourceStateAt: now,
          sourceStateReason: text(args.errorSummary, 500),
          updatedAt: now,
        });
    }
    const capabilityRuns = await ctx.db
      .query("externalSyncCapabilityRuns")
      .withIndex("by_sync_run", (q) => q.eq("syncRunId", syncRun._id))
      .collect();
    for (const capabilityRun of capabilityRuns.filter((item) =>
      ["queued", "running"].includes(item.status),
    ))
      await ctx.db.patch(capabilityRun._id, {
        status: partial ? "partial" : "failed",
        errorCode: text(args.errorCode, 200),
        errorSummary: text(args.errorSummary, 500),
        retryAfterAt: args.retryAfterAt,
        completedAt: now,
        updatedAt: now,
      });
    await ctx.db.patch(syncRun._id, {
      status: partial ? "partial" : "failed",
      stage: selectionChanged ? "selection_changed" : "failed",
      errorCode: text(args.errorCode, 200),
      errorSummary: text(args.errorSummary, 500),
      nextAttemptAt: retryAt,
      attemptCount: syncRun.attemptCount + 1,
      leaseExpiresAt: undefined,
      completedAt: now,
      updatedAt: now,
    });
    if (!selectionChanged) {
      await ctx.db.patch(integration._id, {
        status:
          args.errorCode === "INTEGRATION_CREDENTIAL_REJECTED"
            ? "blocked"
            : "degraded",
        blockedReason:
          args.errorCode === "INTEGRATION_CREDENTIAL_REJECTED"
            ? "The stored read-only credential was rejected by ManageBac."
            : undefined,
        nextSyncAt:
          args.errorCode === "INTEGRATION_CREDENTIAL_REJECTED"
            ? undefined
            : retryAt,
        updatedAt: now,
      });
      if (args.errorCode !== "INTEGRATION_CREDENTIAL_REJECTED")
        await scheduleSync(ctx, integration._id, retryAt);
    }
    return { failed: true, partial };
  },
});

export const completeSync = mutation({
  args: {
    integrationId: v.id("schoolIntegrations"),
    syncRunId: v.id("externalSyncRuns"),
    serviceSubject: v.optional(v.string()),
    seenProviderKeys: v.array(v.string()),
    seenSourceIdentityKeys: v.optional(v.array(v.string())),
    reconciledCapabilityIds: v.array(v.id("integrationCapabilities")),
    leaseToken: v.optional(v.string()),
    selectionRevision: v.optional(v.number()),
    payloadDigest: v.string(),
    timestamp: v.number(),
    nonce: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorOrService(ctx, args.serviceSubject);
    const integration = await requireIntegration(
      ctx,
      actor,
      args.integrationId,
    );
    const syncRun = await ctx.db.get(args.syncRunId);
    if (
      !syncRun ||
      syncRun.integrationId !== integration._id ||
      (syncRun.accountId &&
        syncRun.accountId !== actor.accountId &&
        actor.schoolRole !== "school_admin")
    )
      throw new Error("INTEGRATION_SYNC_FORBIDDEN: Sync run mismatch.");
    await assertCurrentSyncLease(ctx, syncRun, args.leaseToken);
    if (
      args.selectionRevision !== undefined &&
      args.selectionRevision !== (syncRun.selectionRevision ?? 0)
    )
      throw new Error(
        "INTEGRATION_SELECTION_CHANGED: This completion belongs to an older class selection.",
      );
    const expectedDigest = await exactDigest({
      seenProviderKeys: args.seenProviderKeys,
      ...(args.seenSourceIdentityKeys
        ? { seenSourceIdentityKeys: args.seenSourceIdentityKeys }
        : {}),
      reconciledCapabilityIds: args.reconciledCapabilityIds,
      ...(args.leaseToken ? { leaseToken: args.leaseToken } : {}),
      ...(args.selectionRevision !== undefined
        ? { selectionRevision: args.selectionRevision }
        : {}),
    });
    if (expectedDigest !== args.payloadDigest)
      throw new Error(
        "INTEGRATION_PAYLOAD_INVALID: Reconciliation set changed.",
      );
    await verifyBridge(ctx, actor, {
      operation: "sync-complete",
      integrationId: integration._id,
      syncRunId: syncRun._id,
      timestamp: args.timestamp,
      nonce: args.nonce,
      payloadDigest: args.payloadDigest,
      signature: args.signature,
    });
    const seen = new Set(args.seenProviderKeys.slice(0, 100_000));
    const seenSourceIdentities = new Set(
      (args.seenSourceIdentityKeys ?? []).slice(0, 100_000),
    );
    const capabilities = (
      await Promise.all(
        args.reconciledCapabilityIds
          .slice(0, 500)
          .map((capabilityId) => ctx.db.get(capabilityId)),
      )
    ).filter((capability): capability is Doc<"integrationCapabilities"> =>
      Boolean(
        capability &&
        capability.integrationId === integration._id &&
        syncRun.capabilityIds.includes(capability._id) &&
        capability.changeStrategy === "full_reconciliation",
      ),
    );
    const personalTypes = new Set(
      capabilities
        .filter((capability) => capability.scope === "personal")
        .map((capability) => capability.recordType),
    );
    const sharedTypes = new Set(
      capabilities
        .filter((capability) => capability.scope !== "personal")
        .map((capability) => capability.recordType),
    );
    const personalRecords =
      syncRun.accountId && personalTypes.size
        ? (
            await ctx.db
              .query("externalRecords")
              .withIndex("by_account_type", (q) =>
                q.eq("mappedAccountId", syncRun.accountId),
              )
              .collect()
          ).filter(
            (item) =>
              item.integrationId === integration._id &&
              item.schoolId === integration.schoolId &&
              personalTypes.has(item.recordType),
          )
        : [];
    const sharedRecords =
      actor.schoolRole === "school_admin" && sharedTypes.size
        ? (
            await Promise.all(
              [...sharedTypes].map((recordType) =>
                ctx.db
                  .query("externalRecords")
                  .withIndex("by_integration_type", (q) =>
                    q
                      .eq("integrationId", integration._id)
                      .eq("recordType", recordType),
                  )
                  .collect(),
              ),
            )
          )
            .flat()
            .filter((item) => !item.mappedAccountId)
        : [];
    const currentRecords = [...personalRecords, ...sharedRecords];
    const now = Date.now();
    const capabilityRuns = await ctx.db
      .query("externalSyncCapabilityRuns")
      .withIndex("by_sync_run", (q) => q.eq("syncRunId", syncRun._id))
      .collect();
    const unfinishedCapabilityRuns = capabilityRuns.filter((item) =>
      ["queued", "running"].includes(item.status),
    );
    for (const capabilityRun of unfinishedCapabilityRuns)
      await ctx.db.patch(capabilityRun._id, {
        status: "skipped",
        errorCode: "CAPABILITY_NOT_APPLICABLE",
        errorSummary:
          "The route was outside this actor’s verified identity or permission scope.",
        completedAt: now,
        updatedAt: now,
      });
    let tombstoned = 0;
    const followsClass = classFollowPolicy(ctx, integration._id);
    for (const source of currentRecords) {
      if (
        source.tombstone ||
        !await followsClass(source.mappedAccountId ?? syncRun.accountId, source) ||
        (source.sourceIdentityKey !== undefined
          ? seenSourceIdentities.has(source.sourceIdentityKey)
          : seen.has(source.providerRecordKey))
      )
        continue;
      await ctx.db.patch(source._id, {
        tombstone: true,
        tombstonedAt: now,
        sourceState: "missing",
        sourceStateAt: now,
        sourceStateReason: "The provider omitted this record from a complete reconciliation.",
        fetchedAt: now,
        updatedAt: now,
      });
      const candidateProjections = await ctx.db
        .query("externalProjections")
        .withIndex("by_record_type", (q) => q.eq("recordId", source._id))
        .collect()
        .then((rows) =>
          syncRun.accountId
            ? rows.filter((item) => item.accountId === syncRun.accountId)
            : rows,
        );
      const following = await Promise.all(candidateProjections.map(projection => followsClass(projection.accountId, source)));
      const projections = candidateProjections.filter((_, index) => following[index]);
      for (const projection of projections) {
        await markProjectionSourceRemoved(ctx, projection);
        await ctx.db.patch(projection._id, {
          state: "tombstoned",
          updatedAt: now,
        });
      }
      if (projections.length)
        await ctx.db.insert("externalSyncConflicts", {
          syncRunId: syncRun._id,
          integrationId: integration._id,
          schoolId: integration.schoolId,
          accountId: syncRun.accountId,
          recordId: source._id,
          projectionType: projections[0]!.projectionType,
          projectionId: projections[0]!.projectionId,
          kind: "source_removed",
          oldSource: source.normalized,
          newSource: null,
          affectedLinks: projections.map((item) => item.projectionId),
          suggestedActions: ["detach", "archive_projection"],
          status: "open",
          createdAt: now,
          updatedAt: now,
        });
      tombstoned += 1;
    }
    const conflicts = syncRun.accountId
      ? (
          await ctx.db
            .query("externalSyncConflicts")
            .withIndex("by_account_status", (q) =>
              q.eq("accountId", syncRun.accountId!).eq("status", "open"),
            )
            .collect()
        ).filter(
          (item) =>
            item.integrationId === integration._id &&
            item.schoolId === integration.schoolId,
        )
      : await ctx.db
          .query("externalSyncConflicts")
          .withIndex("by_integration_status", (q) =>
            q.eq("integrationId", integration._id).eq("status", "open"),
          )
          .collect();
    const status =
      syncRun.counts.errors > 0
        ? ("partial" as const)
        : conflicts.length > 0
          ? ("awaiting_review" as const)
          : ("completed" as const);
    const counts = {
      ...syncRun.counts,
      tombstoned: syncRun.counts.tombstoned + tombstoned,
      conflicts: conflicts.length,
      skipped: syncRun.counts.skipped + unfinishedCapabilityRuns.length,
    };
    await ctx.db.patch(syncRun._id, {
      status,
      stage: status === "awaiting_review" ? "review_conflicts" : "complete",
      currentCapabilityId: undefined,
      cursorState: undefined,
      counts,
      leaseExpiresAt: undefined,
      completedAt: now,
      updatedAt: now,
    });
    const nextSyncAt =
      now + integration.syncPolicy.frequencyMinutes * 60_000;
    await ctx.db.patch(integration._id, {
      status: syncRun.counts.errors > 0 ? "degraded" : "connected",
      lastSyncAt: now,
      nextSyncAt,
      updatedAt: now,
    });
    await scheduleSync(ctx, integration._id, nextSyncAt);
    return { status, counts };
  },
});

export const setOverlay = mutation({
  args: {
    recordId: v.id("externalRecords"),
    notes: v.optional(v.string()),
    completion: v.optional(v.boolean()),
    reminders: v.optional(v.array(v.number())),
    tags: v.optional(v.array(v.string())),
    alternativeStartAt: v.optional(v.number()),
    alternativeEndAt: v.optional(v.number()),
    placementWorkspaceId: v.optional(v.id("spectraWorkspaces")),
    linkedArtifactIds: v.optional(v.array(v.id("spectraArtifacts"))),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const source = await ctx.db.get(args.recordId);
    if (
      !source ||
      source.schoolId !== actor.schoolId ||
      (source.audienceScope === "mapped_user" &&
        source.mappedAccountId !== actor.accountId)
    )
      throw new Error("INTEGRATION_RECORD_FORBIDDEN: Record is unavailable.");
    const existing = await ctx.db
      .query("externalRecordOverlays")
      .withIndex("by_record_account", (q) =>
        q.eq("recordId", source._id).eq("accountId", actor.accountId),
      )
      .unique();
    const now = Date.now();
    /* Omit-means-preserve for personal fields so a completion-only write
       cannot wipe notes (and vice versa). Pass "" / [] / false explicitly
       to clear. Tags and linkedArtifactIds already merged with existing. */
    const patch = {
      notes:
        args.notes !== undefined
          ? args.notes.slice(0, 100_000)
          : existing?.notes,
      completion:
        args.completion !== undefined
          ? args.completion
          : existing?.completion,
      reminders:
        args.reminders !== undefined
          ? args.reminders
              .filter((item) => Number.isFinite(item))
              .slice(0, 20)
          : existing?.reminders,
      tags: (args.tags ?? existing?.tags ?? [])
        .map((item) => item.trim().slice(0, 48))
        .filter(Boolean)
        .slice(0, 32),
      alternativeStartAt:
        args.alternativeStartAt !== undefined
          ? args.alternativeStartAt
          : existing?.alternativeStartAt,
      alternativeEndAt:
        args.alternativeEndAt !== undefined
          ? args.alternativeEndAt
          : existing?.alternativeEndAt,
      placementWorkspaceId:
        args.placementWorkspaceId !== undefined
          ? args.placementWorkspaceId
          : existing?.placementWorkspaceId,
      linkedArtifactIds: (
        args.linkedArtifactIds ??
        existing?.linkedArtifactIds ??
        []
      ).slice(0, 50),
      sourceHashAtEdit: source.sourceHash,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { overlayId: existing._id };
    }
    const overlayId = await ctx.db.insert("externalRecordOverlays", {
      recordId: source._id,
      schoolId: actor.schoolId,
      accountId: actor.accountId,
      ...patch,
      createdAt: now,
    });
    return { overlayId };
  },
});

export const resolveConflict = mutation({
  args: {
    conflictId: v.id("externalSyncConflicts"),
    resolution: v.union(
      v.literal("rebase"),
      v.literal("keep_overlay"),
      v.literal("detach"),
      v.literal("archive_projection"),
      v.literal("link_existing"),
    ),
    linkProjectionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const conflict = await ctx.db.get(args.conflictId);
    if (
      !conflict ||
      conflict.schoolId !== actor.schoolId ||
      conflict.status !== "open" ||
      (conflict.accountId === undefined &&
        actor.schoolRole !== "school_admin") ||
      (conflict.accountId &&
        conflict.accountId !== actor.accountId &&
        actor.schoolRole !== "school_admin")
    )
      throw new Error(
        "INTEGRATION_CONFLICT_FORBIDDEN: Conflict is unavailable.",
      );
    const now = Date.now();
    const projections = (
      await ctx.db
        .query("externalProjections")
        .withIndex("by_record_type", (q) => q.eq("recordId", conflict.recordId))
        .collect()
    ).filter(
      (projection) =>
        projection.schoolId === actor.schoolId &&
        projection.integrationId === conflict.integrationId &&
        (conflict.accountId === undefined ||
          projection.accountId === conflict.accountId),
    );
    if (args.resolution === "link_existing" && args.linkProjectionId) {
      const linkTarget = (
        await ctx.db
          .query("externalProjections")
          .withIndex("by_projection", (q) =>
            q
              .eq("projectionType", conflict.projectionType)
              .eq("projectionId", args.linkProjectionId!),
          )
          .take(20)
      ).find(
        (projection) =>
          projection.schoolId === actor.schoolId &&
          projection.integrationId === conflict.integrationId &&
          projection.state === "active" &&
          (conflict.accountId === undefined ||
            projection.accountId === conflict.accountId),
      );
      if (!linkTarget)
        throw new Error(
          "INTEGRATION_CONFLICT_LINK_FORBIDDEN: Target projection is unavailable.",
        );
    }
    for (const projection of projections) {
      if (args.resolution === "detach")
        await ctx.db.patch(projection._id, {
          state: "detached",
          updatedAt: now,
        });
      else if (args.resolution === "archive_projection")
        await ctx.db.patch(projection._id, {
          state: "tombstoned",
          updatedAt: now,
        });
      else
        await ctx.db.patch(projection._id, {
          state: "active",
          projectionId:
            args.resolution === "link_existing" && args.linkProjectionId
              ? args.linkProjectionId
              : projection.projectionId,
          updatedAt: now,
        });
    }
    const overlay = conflict.accountId
      ? await ctx.db
          .query("externalRecordOverlays")
          .withIndex("by_record_account", (q) =>
            q
              .eq("recordId", conflict.recordId)
              .eq("accountId", conflict.accountId!),
          )
          .unique()
      : null;
    const source = await ctx.db.get(conflict.recordId);
    if (
      source &&
      (args.resolution === "rebase" || args.resolution === "keep_overlay")
    ) {
      for (const projection of projections) {
        if (
          args.resolution === "keep_overlay" &&
          projection.projectionType === "planner_task"
        ) {
          await ctx.db.patch(projection._id, {
            sourceHash: source.sourceHash,
            state: "active",
            updatedAt: now,
          });
          continue;
        }
        const refreshed = await safelyRefreshProjection(
          ctx,
          projection,
          projection.sourceHash,
          source,
          true,
          conflict.oldSource,
        );
        if (!refreshed)
          throw new Error(
            "INTEGRATION_CONFLICT_REBASE_FAILED: The source projection is unavailable or no longer has a compatible shape.",
          );
        await ctx.db.patch(projection._id, {
          sourceHash: source.sourceHash,
          state: "active",
          updatedAt: now,
        });
      }
    }
    if (
      overlay &&
      source &&
      (args.resolution === "rebase" || args.resolution === "keep_overlay")
    )
      await ctx.db.patch(overlay._id, {
        sourceHashAtEdit: source.sourceHash,
        updatedAt: now,
      });
    await ctx.db.patch(conflict._id, {
      status: "resolved",
      resolution: args.resolution,
      resolvedByAccountId: actor.accountId,
      resolvedAt: now,
      updatedAt: now,
    });
    return { conflictId: conflict._id, resolution: args.resolution };
  },
});

export const recordsForPurpose = query({
  args: {
    purpose: v.union(
      v.literal("upcoming_deadlines"),
      v.literal("class_resources"),
      v.literal("timetable"),
      v.literal("classes"),
      v.literal("cas"),
    ),
    classId: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const integration = await integrationForSchool(ctx, actor.schoolId);
    if (!integration)
      return {
        connected: false,
        records: [],
        stale: true,
        unavailableReason: "not_connected",
        provenance: null,
      };
    const mapping = await ctx.db
      .query("externalIdentityMappings")
      .withIndex("by_integration_account", (q) =>
        q.eq("integrationId", integration._id).eq("accountId", actor.accountId),
      )
      .unique();
    if (!mapping || mapping.status !== "verified")
      return {
        connected: true,
        records: [],
        stale: true,
        identityRequired: true,
        unavailableReason: "identity_required",
        provenance: {
          provider: "ManageBac",
          lastSyncAt: integration.lastSyncAt,
          purpose: args.purpose,
        },
      };
    const typeMap = {
      upcoming_deadlines: ["assignment", "deadline", "assessment"],
      class_resources: [
        "class_resource",
        "school_resource",
        "resource",
        "file",
      ],
      timetable: [
        "timetable",
        "timetable_event",
        "lesson",
        "class_event",
        "calendar_event",
      ],
      classes: ["class", "course", "membership"],
      cas: ["cas_experience", "cas_reflection", "cas_evidence"],
    } as const;
    const allowed = new Set<string>(typeMap[args.purpose]);
    const personalRows = (
      await Promise.all(
        [...allowed].map((recordType) =>
          ctx.db
            .query("externalRecords")
            .withIndex("by_account_type", (q) =>
              q
                .eq("mappedAccountId", actor.accountId)
                .eq("recordType", recordType),
            )
            .order("desc")
            .take(500)
            .then((rows) =>
              rows.filter((item) => item.mappedAccountId === actor.accountId),
            ),
        ),
      )
    )
      .flat()
      .filter(
        (item) =>
          item.integrationId === integration._id &&
          item.schoolId === actor.schoolId,
      );
    const selectedKeys = new Set(
      (await ctx.db
        .query("managebacClassSelections")
        .withIndex("by_account_integration", (q) =>
          q.eq("accountId", actor.accountId).eq("integrationId", integration._id),
        )
        .collect())
        .filter((row) => row.selected)
        .map(
          (row) =>
            `${row.providerClassId}|${row.academicPeriodKey ?? "unknown"}`,
        ),
    );
    const membershipRows = (
      await Promise.all(
        ["class", "course", "membership"].map((recordType) =>
          ctx.db
            .query("externalRecords")
            .withIndex("by_account_type", (q) =>
              q
                .eq("mappedAccountId", actor.accountId)
                .eq("recordType", recordType),
            )
            .take(500)
            .then((rows) =>
              rows.filter((item) => item.mappedAccountId === actor.accountId),
            ),
        ),
      )
    )
      .flat()
      .filter(
        (item) =>
          item.integrationId === integration._id &&
          item.schoolId === actor.schoolId &&
          !item.tombstone,
      );
    const accessibleClassIds = new Set(
      membershipRows
        .flat()
        .flatMap((item) =>
          item.providerClassId ? [item.providerClassId] : [],
        ),
    );
    const scopedRows = (
      await Promise.all(
        [...allowed].map((recordType) =>
          ctx.db
            .query("externalRecords")
            .withIndex("by_integration_type", (q) =>
              q
                .eq("integrationId", integration._id)
                .eq("recordType", recordType),
            )
            .order("desc")
            .take(500),
        ),
      )
    )
      .flat()
      .filter((item) => !item.mappedAccountId)
      .filter(
        (item) =>
          item.audienceScope === "school" ||
          (item.audienceScope === "class_members" &&
            Boolean(
              item.providerClassId &&
              accessibleClassIds.has(item.providerClassId),
            )) ||
          (item.audienceScope === "authorized_staff" &&
            (actor.schoolRole === "teacher" ||
              actor.schoolRole === "school_admin")),
      );
    const deduped = new Map(
      [...scopedRows, ...personalRows].map((item) => [
        item.sourceIdentityKey ??
          `${item.mappedAccountId ?? "shared"}|${item.academicPeriodKey ?? "unknown"}|${item.providerRecordKey}`,
        item,
      ]),
    );
    const limited = [...deduped.values()]
      .filter((item) => !item.tombstone)
      .filter(
        (item) =>
          args.purpose === "classes" ||
          !item.providerClassId ||
          selectedKeys.has(
            `${item.providerClassId}|${item.academicPeriodKey ?? "unknown"}`,
          ) ||
          selectedKeys.has(`${item.providerClassId}|unknown`) ||
          (item.academicPeriodKey === undefined &&
            [...selectedKeys].some((key) =>
              key.startsWith(`${item.providerClassId}|`),
            )),
      )
      .filter(
        (item) =>
          !args.classId ||
          (accessibleClassIds.has(args.classId) &&
            item.providerClassId === args.classId),
      )
      .filter((item) => {
        const normalized = record(item.normalized);
        const timestamp =
          timestampValue(normalized.dueAt ?? normalized.deadlineAt) ??
          timestampValue(normalized.startAt ?? normalized.start) ??
          null;
        // Upcoming deadlines default to "now onward" so stale historical tasks
        // do not crowd out current ManageBac work when the model omits a range.
        const effectiveFrom =
          args.from ??
          (args.purpose === "upcoming_deadlines"
            ? Date.now() - 2 * 24 * 60 * 60_000
            : undefined);
        return (
          timestamp === null ||
          ((effectiveFrom === undefined || timestamp >= effectiveFrom) &&
            (args.to === undefined || timestamp <= args.to))
        );
      })
      .sort((a, b) => {
        const left = record(a.normalized);
        const right = record(b.normalized);
        const leftTs =
          timestampValue(left.dueAt ?? left.startAt ?? left.start) ??
          Number.MAX_SAFE_INTEGER;
        const rightTs =
          timestampValue(right.dueAt ?? right.startAt ?? right.start) ??
          Number.MAX_SAFE_INTEGER;
        if (args.purpose === "upcoming_deadlines") return leftTs - rightTs;
        // Prefer freshest provider updates for CAS/classes/resources.
        return (
          (b.sourceModifiedAt ?? b.fetchedAt ?? 0) -
          (a.sourceModifiedAt ?? a.fetchedAt ?? 0)
        );
      })
      .slice(0, Math.max(1, Math.min(args.limit ?? 50, 200)));
    const staleByAge =
      !integration.lastSyncAt ||
      Date.now() - integration.lastSyncAt >
        integration.freshnessSlaMinutes * 60_000;
    // Empty CAS/deadlines while connected usually means the cache never
    // ingested those routes — treat as stale so the AI can refresh.
    const staleByEmptyPurpose =
      limited.length === 0 &&
      (args.purpose === "cas" ||
        args.purpose === "upcoming_deadlines" ||
        args.purpose === "class_resources");
    return {
      connected: true,
      records: limited.map((item) => ({
        id: item._id,
        recordType: item.recordType,
        normalized: item.normalized,
        providerClassId: item.providerClassId,
        academicPeriodKey: item.academicPeriodKey,
        sourceIdentityKey: item.sourceIdentityKey,
        sourceState: item.sourceState ?? (item.tombstone ? "removed" : "available"),
        sourceHash: item.sourceHash,
        sourceModifiedAt: item.sourceModifiedAt,
        fetchedAt: item.fetchedAt,
        provenanceUrl: item.provenanceUrl,
      })),
      stale: staleByAge || staleByEmptyPurpose,
      provenance: {
        provider: "ManageBac",
        lastSyncAt: integration.lastSyncAt,
        purpose: args.purpose,
      },
    };
  },
});

async function permissionedResourceImportSource(
  ctx: Ctx,
  sourceRecordId: Id<"externalRecords">,
) {
  const actor = await requireActor(ctx);
  const integration = await integrationForSchool(ctx, actor.schoolId);
  if (!integration || integration.status === "revoked")
    throw new Error("INTEGRATION_NOT_CONNECTED: ManageBac is not connected.");
  const mapping = await ctx.db
    .query("externalIdentityMappings")
    .withIndex("by_integration_account", (q) =>
      q.eq("integrationId", integration._id).eq("accountId", actor.accountId),
    )
    .unique();
  if (actor.schoolRole !== "school_admin" && (!mapping || mapping.status !== "verified"))
    throw new Error("INTEGRATION_IDENTITY_REQUIRED: Resolve your verified provider identity first.");
  const source = await ctx.db.get(sourceRecordId);
  if (
    !source ||
    source.integrationId !== integration._id ||
    source.schoolId !== actor.schoolId ||
    !["resource", "class_resource", "school_resource", "file"].includes(
      source.recordType,
    ) ||
    (source.mappedAccountId !== undefined &&
      source.mappedAccountId !== actor.accountId) ||
    !source.providerClassId
  )
    throw new Error(
      "INTEGRATION_RESOURCE_NOT_ALLOWED: Choose a resource from your selected class shelf.",
    );
  const selected = await ctx.db
    .query("managebacClassSelections")
    .withIndex("by_integration_account_class", (q) =>
      q
        .eq("integrationId", integration._id)
        .eq("accountId", actor.accountId)
        .eq("providerClassId", source.providerClassId!),
    )
    .collect();
  if (
    !selected.some(
      (row) =>
        row.selected &&
        (row.academicPeriodKey ?? "unknown") ===
          (source.academicPeriodKey ?? "unknown"),
    )
  )
    throw new Error(
      "INTEGRATION_RESOURCE_CLASS_NOT_SELECTED: Select this class before importing its resources.",
    );
  return { actor, integration, source };
}

export const beginResourceImport = mutation({
  args: {
    sourceRecordId: v.id("externalRecords"),
    requestKey: v.optional(v.string()),
    refresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { actor, integration, source } = await permissionedResourceImportSource(
      ctx,
      args.sourceRecordId,
    );
    const requestKey =
      args.requestKey?.trim() || `${source._id}:${source.sourceHash}`;
    if (!requestKey || requestKey.length > 240)
      throw new Error("INTEGRATION_RESOURCE_REQUEST_KEY_INVALID");
    const priorForRequest = await ctx.db
      .query("managebacResourceImports")
      .withIndex("by_account_request", (q) =>
        q.eq("accountId", actor.accountId).eq("requestKey", requestKey),
      )
      .unique();
    if (priorForRequest && priorForRequest.sourceRecordId !== source._id)
      throw new Error("INTEGRATION_RESOURCE_REQUEST_REUSED");
    const prior =
      priorForRequest ??
      (
        await ctx.db
          .query("managebacResourceImports")
          .withIndex("by_account_source", (q) =>
            q
              .eq("accountId", actor.accountId)
              .eq("sourceRecordId", source._id)
              .eq("sourceHash", source.sourceHash),
          )
          .collect()
      ).sort((left, right) => right.updatedAt - left.updatedAt)[0];
    const sourceState = source.sourceState ?? (source.tombstone ? "removed" : "available");
    if (["temporarily_unavailable", "missing", "removed"].includes(sourceState)) {
      const retained = (await ctx.db
        .query("managebacResourceImports")
        .withIndex("by_account_source_record", (q) =>
          q.eq("accountId", actor.accountId).eq("sourceRecordId", source._id),
        )
        .collect())
        .find((row) => row.status === "imported" && row.artifactId);
      if (retained)
        return {
          status: "source_unavailable" as const,
          importId: retained._id,
          artifactId: retained.artifactId,
          sourceHash: retained.sourceHash,
          sourceState,
        };
      throw new Error(
        `INTEGRATION_RESOURCE_UNAVAILABLE: This resource is currently ${sourceState.replaceAll("_", " ")}.`,
      );
    }
    if (prior && prior.status === "imported")
      return {
        status: "imported" as const,
        importId: prior._id,
        artifactId: prior.artifactId,
        sourceHash: prior.sourceHash,
        providerRecordId: source.providerRecordId,
        providerClassId: source.providerClassId,
        title: typeof source.normalized?.title === "string" ? source.normalized.title : "School resource",
        normalized: source.normalized,
        replayed: true,
      };
    if (prior && prior.status !== "failed")
      return {
        status: "resume" as const,
        importId: prior._id,
        artifactId: prior.artifactId,
        sourceHash: prior.sourceHash,
        providerRecordId: source.providerRecordId,
        providerClassId: source.providerClassId,
        title: typeof source.normalized?.title === "string" ? source.normalized.title : "School resource",
        normalized: source.normalized,
        replayed: true,
      };
    if (prior && prior.status === "failed") {
      await ctx.db.patch(prior._id, {
        status: "started",
        errorCode: undefined,
        errorSummary: undefined,
        updatedAt: Date.now(),
      });
      return {
        status: "resume" as const,
        importId: prior._id,
        artifactId: prior.artifactId,
        sourceHash: prior.sourceHash,
        providerRecordId: source.providerRecordId,
        providerClassId: source.providerClassId,
        title: typeof source.normalized?.title === "string" ? source.normalized.title : "School resource",
        normalized: source.normalized,
        replayed: true,
      };
    }
    const priorRevision = await ctx.db
      .query("managebacResourceImports")
      .withIndex("by_account_source_record", (q) =>
        q
          .eq("accountId", actor.accountId)
          .eq("sourceRecordId", source._id),
      )
      .collect();
    if (!args.refresh && priorRevision.some((row) => row.status === "imported"))
      return {
        status: "update_available" as const,
        sourceHash: source.sourceHash,
        priorArtifactId: priorRevision.find((row) => row.status === "imported")
          ?.artifactId,
      };
    const now = Date.now();
    const importId = await ctx.db.insert("managebacResourceImports", {
      integrationId: integration._id,
      schoolId: actor.schoolId,
      accountId: actor.accountId,
      sourceRecordId: source._id,
      sourceHash: source.sourceHash,
      requestKey,
      status: "started",
      createdAt: now,
      updatedAt: now,
    });
    return {
      status: "started" as const,
      importId,
      sourceHash: source.sourceHash,
      providerRecordId: source.providerRecordId,
      providerClassId: source.providerClassId,
      title:
        typeof source.normalized?.title === "string"
          ? source.normalized.title
          : "School resource",
      normalized: source.normalized,
    };
  },
});

export const attachResourceImportArtifact = mutation({
  args: {
    importId: v.id("managebacResourceImports"),
    artifactId: v.id("spectraArtifacts"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const row = await ctx.db.get(args.importId);
    const artifact = await ctx.db.get(args.artifactId);
    if (
      !row ||
      row.accountId !== actor.accountId ||
      row.schoolId !== actor.schoolId ||
      !artifact ||
      artifact.ownerAccountId !== actor.accountId ||
      artifact.schoolId !== actor.schoolId
    )
      throw new Error("INTEGRATION_RESOURCE_IMPORT_NOT_ALLOWED");
    if (row.artifactId && row.artifactId !== artifact._id)
      throw new Error("INTEGRATION_RESOURCE_IMPORT_ARTIFACT_CONFLICT");
    await ctx.db.patch(row._id, {
      artifactId: artifact._id,
      status: "importing",
      updatedAt: Date.now(),
    });
    return { importId: row._id, artifactId: artifact._id };
  },
});

export const completeResourceImport = mutation({
  args: {
    importId: v.id("managebacResourceImports"),
    sourceHash: v.string(),
    contentHash: v.string(),
    bytes: v.number(),
    mimeType: v.string(),
    nativeFormat: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const row = await ctx.db.get(args.importId);
    if (!row || row.accountId !== actor.accountId || row.schoolId !== actor.schoolId)
      throw new Error("INTEGRATION_RESOURCE_IMPORT_NOT_ALLOWED");
    if (row.status === "imported")
      return { status: "imported" as const, importId: row._id, artifactId: row.artifactId, replayed: true };
    const { source } = await permissionedResourceImportSource(ctx, row.sourceRecordId);
    if (["temporarily_unavailable", "missing", "removed"].includes(source.sourceState ?? (source.tombstone ? "removed" : "available")))
      throw new Error("INTEGRATION_RESOURCE_UNAVAILABLE: The provider resource is no longer available; the existing Library copy remains retained.");
    if (source.sourceHash !== args.sourceHash || row.sourceHash !== args.sourceHash)
      throw new Error("INTEGRATION_RESOURCE_SOURCE_CHANGED: Refresh the source and import the new revision explicitly.");
    if (!row.artifactId) throw new Error("INTEGRATION_RESOURCE_ARTIFACT_MISSING");
    const artifact = await ctx.db.get(row.artifactId);
    if (!artifact || artifact.ownerAccountId !== actor.accountId || artifact.schoolId !== actor.schoolId)
      throw new Error("INTEGRATION_RESOURCE_ARTIFACT_NOT_OWNED");
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: "imported",
      contentHash: args.contentHash,
      bytes: args.bytes,
      mimeType: args.mimeType.slice(0, 160),
      nativeFormat: args.nativeFormat.slice(0, 40),
      errorCode: undefined,
      errorSummary: undefined,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "integration.managebac.resource_imported",
      targetType: "spectra_artifact",
      targetId: String(row.artifactId),
      metadata: {
        sourceRecordId: String(row.sourceRecordId),
        sourceHash: args.sourceHash,
        bytes: args.bytes,
      },
      retentionClass: "operational",
    });
    return { status: "imported" as const, importId: row._id, artifactId: row.artifactId };
  },
});

export const failResourceImport = mutation({
  args: {
    importId: v.id("managebacResourceImports"),
    errorCode: v.string(),
    errorSummary: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const row = await ctx.db.get(args.importId);
    if (!row || row.accountId !== actor.accountId || row.schoolId !== actor.schoolId)
      throw new Error("INTEGRATION_RESOURCE_IMPORT_NOT_ALLOWED");
    await ctx.db.patch(row._id, {
      status: "failed",
      artifactId: undefined,
      errorCode: args.errorCode.slice(0, 120),
      errorSummary: args.errorSummary.slice(0, 500),
      updatedAt: Date.now(),
    });
    return { importId: row._id, status: "failed" as const };
  },
});

export const setSelectedClasses = mutation({
  args: {
    recordIds: v.array(v.id("externalRecords")),
    expectedRevision: v.optional(v.number()),
    retention: v.optional(
      v.union(v.literal("keep_in_spectra"), v.literal("archive_projection")),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const integration = await integrationForSchool(ctx, actor.schoolId);
    if (!integration || integration.status === "revoked")
      throw new Error("INTEGRATION_NOT_CONNECTED: ManageBac is not connected.");
    const currentRows = await ctx.db
      .query("managebacClassSelections")
      .withIndex("by_account_integration", (q) =>
        q.eq("accountId", actor.accountId).eq("integrationId", integration._id),
      )
      .collect();
    const currentRevision = currentRows.reduce(
      (highest, row) => Math.max(highest, row.selectionRevision),
      0,
    );
    if (
      args.expectedRevision !== undefined &&
      args.expectedRevision !== currentRevision
    )
      throw new Error(
        "INTEGRATION_SELECTION_CONFLICT: Class choices changed. Reload the class list and try again.",
      );
    const membershipRows = (
      await Promise.all(
        ["class", "course", "membership"].map((recordType) =>
          ctx.db
            .query("externalRecords")
            .withIndex("by_account_type", (q) =>
              q.eq("mappedAccountId", actor.accountId).eq("recordType", recordType),
            )
            .take(500),
        ),
      )
    )
      .flat()
      .filter(
        (row) =>
          row.integrationId === integration._id &&
          row.schoolId === actor.schoolId &&
          !row.tombstone &&
          Boolean(row.providerClassId),
      );
    const accessibleClassIds = new Set(
      membershipRows.map((row) => row.providerClassId!),
    );
    const selectedRecords: Array<Doc<"externalRecords">> = [];
    for (const recordId of [...new Set(args.recordIds)].slice(0, 100)) {
      const source = await ctx.db.get(recordId);
      if (
        !source ||
        source.integrationId !== integration._id ||
        source.schoolId !== actor.schoolId ||
        source.recordType !== "class" ||
        source.tombstone ||
        (source.mappedAccountId !== actor.accountId &&
          (!source.providerClassId ||
            !accessibleClassIds.has(source.providerClassId))) ||
        !source.providerClassId
      )
        throw new Error(
          "INTEGRATION_CLASS_SELECTION_INVALID: Choose only current classes from your ManageBac membership.",
        );
      selectedRecords.push(source);
    }
    const selectedKeys = new Set(
      selectedRecords.map(
        (source) =>
          `${source.providerClassId}|${canonicalAcademicPeriodKey(source.academicPeriodKey) ?? "unknown"}`,
      ),
    );
    const currentSelectedKeys = new Set(
      currentRows
        .filter((row) => row.selected)
        .map((row) => `${row.providerClassId}|${row.academicPeriodKey ?? "unknown"}`),
    );
    const deselectedKeys = new Set(
      [...currentSelectedKeys].filter((key) => !selectedKeys.has(key)),
    );
    const deselectedRecordIds = membershipRows
      .filter(
        (source) =>
          source.recordType === "class" &&
          source.providerClassId &&
          deselectedKeys.has(
            `${source.providerClassId}|${canonicalAcademicPeriodKey(source.academicPeriodKey) ?? "unknown"}`,
          ),
      )
      .map((source) => source._id);
    const revision = currentRevision + 1;
    const now = Date.now();
    /* Retention is the deselect policy for rows leaving the selection.
       Do not stamp archive_projection onto classes that remain selected —
       that polluted the onboarding radio (any selected row with archive)
       without changing release behavior for kept shelves. */
    const nextRetention = args.retention ?? "keep_in_spectra";
    for (const row of currentRows) {
      const key = `${row.providerClassId}|${row.academicPeriodKey ?? "unknown"}`;
      const shouldSelect = selectedKeys.has(key);
      if (row.selected === shouldSelect) {
        if (row.selectionRevision === revision) continue;
        if (shouldSelect) {
          await ctx.db.patch(row._id, {
            selectionRevision: revision,
            updatedAt: now,
          });
        }
        continue;
      }
      await ctx.db.patch(row._id, {
        selected: shouldSelect,
        retention: shouldSelect
          ? row.retention ?? "keep_in_spectra"
          : nextRetention,
        selectionRevision: revision,
        ...(shouldSelect
          ? { selectedAt: now, deselectedAt: undefined }
          : { deselectedAt: now }),
        updatedAt: now,
      });
    }
    for (const source of selectedRecords) {
      const periodKey = canonicalAcademicPeriodKey(source.academicPeriodKey);
      const existing = currentRows.find(
        (row) =>
          row.providerClassId === source.providerClassId &&
          (row.academicPeriodKey ?? undefined) === periodKey,
      );
      if (existing) {
        if (!existing.selected)
          await ctx.db.patch(existing._id, {
            selected: true,
            /* Re-select restores follow without inheriting a prior archive
               stamp as the live radio source of truth. */
            retention: "keep_in_spectra",
            selectionRevision: revision,
            selectedAt: now,
            deselectedAt: undefined,
            updatedAt: now,
          });
        else if (existing.selectionRevision !== revision)
          await ctx.db.patch(existing._id, {
            selectionRevision: revision,
            updatedAt: now,
          });
        continue;
      }
      await ctx.db.insert("managebacClassSelections", {
        integrationId: integration._id,
        schoolId: actor.schoolId,
        accountId: actor.accountId,
        providerClassId: source.providerClassId!,
        providerRecordKey: source.providerRecordKey,
        ...(periodKey ? { academicPeriodKey: periodKey } : {}),
        selected: true,
        retention: "keep_in_spectra",
        selectionRevision: revision,
        selectedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "integration.managebac.class_selection_changed",
      targetType: "school_integration",
      targetId: integration._id,
      metadata: {
        selectionRevision: revision,
        selectedClassCount: selectedKeys.size,
      },
      retentionClass: "operational",
    });
    return {
      selectionRevision: revision,
      selectedClassIds: [...selectedKeys],
      selectedRecordIds: selectedRecords.map((source) => source._id),
      deselectedRecordIds,
      retention: nextRetention,
    };
  },
});

/**
 * Backfill canonical provider identities for records written before account
 * and academic-period scoping existed. This is intentionally bounded and
 * resumable. Collisions are ledgered rather than deleted, preserving the
 * legacy row's overlays/projections for an administrator to review.
 */
export const migrateSourceIdentityKeys = mutation({
  args: {
    integrationId: v.optional(v.id("schoolIntegrations")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const integration = args.integrationId
      ? await requireIntegration(ctx, actor, args.integrationId)
      : await integrationForSchool(ctx, actor.schoolId);
    if (!integration || integration.status === "revoked")
      throw new Error("INTEGRATION_NOT_CONNECTED: ManageBac is not connected.");
    const limit = Math.max(1, Math.min(args.limit ?? 250, 500));
    const rows = await ctx.db
      .query("externalRecords")
      .withIndex("by_school_updated", (q) => q.eq("schoolId", actor.schoolId))
      .order("asc")
      .take(limit * 4);
    const candidates = rows.filter(
      (row) =>
        row.integrationId === integration._id &&
        row.sourceIdentityKey === undefined &&
        (actor.schoolRole === "school_admin" ||
          row.mappedAccountId === actor.accountId),
    ).slice(0, limit);
    let linked = 0;
    let duplicates = 0;
    let skipped = 0;
    const now = Date.now();
    for (const row of candidates) {
      const canonicalKey = sourceIdentityKey(
        integration._id,
        row.mappedAccountId,
        {
          providerRecordKey: row.providerRecordKey,
          audienceScope: row.audienceScope,
          academicPeriodKey: row.academicPeriodKey,
        },
      );
      const priorLedger = await ctx.db
        .query("externalRecordIdentityMigrations")
        .withIndex("by_legacy_record", (q) => q.eq("legacyRecordId", row._id))
        .collect();
      if (priorLedger.some((item) => item.canonicalKey === canonicalKey)) {
        skipped += 1;
        continue;
      }
      const matches = await ctx.db
        .query("externalRecords")
        .withIndex("by_source_identity", (q) =>
          q.eq("integrationId", integration._id).eq("sourceIdentityKey", canonicalKey),
        )
        .collect();
      const survivor = matches.find((item) => item._id !== row._id);
      if (survivor) {
        await ctx.db.insert("externalRecordIdentityMigrations", {
          integrationId: integration._id,
          schoolId: actor.schoolId,
          legacyRecordId: row._id,
          canonicalKey,
          status: "duplicate",
          survivorRecordId: survivor._id,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.patch(row._id, {
          sourceState: "changed",
          sourceStateAt: now,
          sourceStateReason:
            "Legacy provider identity collided with a newer account- or period-scoped record; links were preserved for review.",
          updatedAt: now,
        });
        duplicates += 1;
        continue;
      }
      await ctx.db.patch(row._id, {
        sourceIdentityKey: canonicalKey,
        sourceState: row.tombstone ? "removed" : "available",
        sourceStateAt: now,
        sourceStateReason: undefined,
        updatedAt: now,
      });
      await ctx.db.insert("externalRecordIdentityMigrations", {
        integrationId: integration._id,
        schoolId: actor.schoolId,
        legacyRecordId: row._id,
        canonicalKey,
        status: "linked",
        createdAt: now,
        updatedAt: now,
      });
      linked += 1;
    }
    return {
      scanned: candidates.length,
      linked,
      duplicates,
      skipped,
      hasMore: candidates.length >= limit,
    };
  },
});

export const listMyClassCandidates = query({
  args: {},
  handler: async (ctx) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor) return null;
    const integration = await ctx.db
      .query("schoolIntegrations")
      .withIndex("by_school_provider", (q) =>
        q.eq("schoolId", actor.schoolId).eq("provider", "managebac"),
      )
      .unique();
    if (!integration || integration.status === "revoked")
      return { integration: null, classes: [] as Array<Record<string, unknown>>, lastSyncAt: undefined as number | undefined, nextSyncAt: undefined as number | undefined };
    const mapping = await ctx.db
      .query("externalIdentityMappings")
      .withIndex("by_integration_account", (q) =>
        q.eq("integrationId", integration._id).eq("accountId", actor.accountId),
      )
      .unique();
    if (!mapping || mapping.status !== "verified")
      return {
        integration: safeIntegration(integration),
        classes: [] as Array<Record<string, unknown>>,
        identityRequired: true,
        identityStatus: mapping?.status ?? "pending",
        identityMatchCount: mapping?.matchCount ?? 0,
        lastSyncAt: integration.lastSyncAt,
        nextSyncAt: integration.nextSyncAt,
      };
    const selectionRows = await ctx.db
      .query("managebacClassSelections")
      .withIndex("by_account_integration", (q) =>
        q.eq("accountId", actor.accountId).eq("integrationId", integration._id),
      )
      .collect();
    const selection = {
      revision: selectionRows.reduce(
        (highest, row) => Math.max(highest, row.selectionRevision),
        0,
      ),
      selectedClassIds: selectionRows
        .filter((row) => row.selected)
        .map((row) => row.providerClassId),
    };
    const selectedKeys = new Set(
      selectionRows
        .filter((row) => row.selected)
        .map((row) => `${row.providerClassId}|${row.academicPeriodKey ?? "unknown"}`),
    );
    const retentionByKey = new Map(
      selectionRows.map((row) => [
        `${row.providerClassId}|${row.academicPeriodKey ?? "unknown"}`,
        row.retention,
      ]),
    );
    const [records, projections, membershipRows] = await Promise.all([
      ctx.db
        .query("externalRecords")
        .withIndex("by_integration_type", (q) =>
          q.eq("integrationId", integration._id).eq("recordType", "class"),
        )
        .order("desc")
        .take(2_000),
      ctx.db
        .query("externalProjections")
        .withIndex("by_account_updated", (q) => q.eq("accountId", actor.accountId))
        .order("desc")
        .take(2_000),
      Promise.all(
        ["class", "course", "membership"].map((recordType) =>
          ctx.db
            .query("externalRecords")
            .withIndex("by_account_type", (q) =>
              q
                .eq("mappedAccountId", actor.accountId)
                .eq("recordType", recordType),
            )
            .take(500)
            .then((rows) =>
              rows.filter((item) => item.mappedAccountId === actor.accountId),
            ),
        ),
      ),
    ]);
    const integrationRecords = records.filter(
      (item) =>
        item.integrationId === integration._id &&
        item.schoolId === actor.schoolId,
    );
    const integrationMemberships = membershipRows
      .flat()
      .filter(
        (item) =>
          item.integrationId === integration._id &&
          item.schoolId === actor.schoolId &&
          !item.tombstone,
      );
    const accessibleClassIds = new Set(
      integrationMemberships.flatMap((item) =>
        item.providerClassId ? [item.providerClassId] : [],
      ),
    );
    const workspaceByProviderKey = new Map(
      projections
        .filter(
          (item) =>
            item.integrationId === integration._id &&
            item.projectionType === "workspace" &&
            item.state === "active",
        )
        .map((item) => [item.providerKey, item.projectionId] as const),
    );
    const eligibleClasses = integrationRecords.filter(
      (item) =>
        item.recordType === "class" &&
        !item.tombstone &&
        (item.mappedAccountId === actor.accountId ||
          Boolean(
            item.providerClassId &&
            accessibleClassIds.has(item.providerClassId),
          )),
    );
    const bestClassByProvider = new Map<
      string,
      (typeof eligibleClasses)[number]
    >();
    const candidateScore = (item: (typeof eligibleClasses)[number]) => {
      const normalized = record(item.normalized);
      const title = text(normalized.name ?? normalized.title, 180);
      return (
        (item.mappedAccountId === actor.accountId ? 10_000 : 0) +
        (title && title !== "ManageBac class" ? 1_000 : 0) +
        item.fetchedAt / 1_000_000_000_000
      );
    };
    for (const item of eligibleClasses) {
      const key = `${item.providerClassId ?? item.providerRecordId}|${item.academicPeriodKey ?? "unknown"}`;
      const current = bestClassByProvider.get(key);
      if (!current || candidateScore(item) > candidateScore(current))
        bestClassByProvider.set(key, item);
    }
    const classes = [...bestClassByProvider.values()]
      .map((item) => {
        const normalized = record(item.normalized);
        const archived =
          normalized.archived === true || normalized.archived === "true";
        const providerKey = `class:${item.providerClassId ?? item.providerRecordId}:${item.academicPeriodKey ?? "current"}`;
        const workspaceId = workspaceByProviderKey.get(providerKey);
        return {
          recordId: item._id,
          providerRecordId: item.providerRecordId,
          providerClassId: item.providerClassId,
          title: text(normalized.name ?? normalized.title, 180, "ManageBac class"),
          program: text(normalized.program ?? normalized.programme, 120),
          grade: text(normalized.grade, 80),
          description: plainText(normalized.description, 400),
          archived,
          workspaceId: workspaceId ?? null,
          selected: selectedKeys.has(
            `${item.providerClassId ?? item.providerRecordId}|${item.academicPeriodKey ?? "unknown"}`,
          ),
          retention: retentionByKey.get(
            `${item.providerClassId ?? item.providerRecordId}|${item.academicPeriodKey ?? "unknown"}`,
          ),
          academicPeriodKey: item.academicPeriodKey,
          fetchedAt: item.fetchedAt,
        };
      })
      .filter((item) => !item.archived)
      .sort((a, b) => a.title.localeCompare(b.title));
    return {
      integration: safeIntegration(integration),
      classes,
      selectionRevision: selection.revision,
      selectedClassIds: [...selectedKeys],
      identityStatus: mapping.status,
      identityMatchCount: mapping.matchCount,
      lastSyncAt: integration.lastSyncAt,
      nextSyncAt: integration.nextSyncAt,
    };
  },
});

/**
 * File a projected school artifact in its class workspace. Returns whether this
 * call is what put it there, so the caller can report honest counts.
 */
async function ensureClassWorkPlacement(
  ctx: MutationCtx,
  workspaceId: Id<"spectraWorkspaces">,
  accountId: Id<"accounts">,
  schoolId: Id<"schools">,
  artifactId: Id<"spectraArtifacts">,
) {
  const artifact = await ctx.db.get(artifactId);
  if (!artifact) return false;
  const before = await findPrimaryNode(ctx, accountId, "work", artifactId);
  await placeSourceNode(ctx, {
    accountId,
    schoolId,
    kind: "work",
    sourceId: artifactId,
    name: artifact.title,
    target: { workspaceId },
    placedByAccountId: accountId,
    accessProjection: true,
  });
  return before === null || before.workspaceContextId !== workspaceId;
}

export const materializeClassWorkspaces = mutation({
  args: {
    recordIds: v.array(v.id("externalRecords")),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor)
      throw new Error("AUTH_REQUIRED: Sign in to create class workspaces.");
    const integration = await ctx.db
      .query("schoolIntegrations")
      .withIndex("by_school_provider", (q) =>
        q.eq("schoolId", actor.schoolId).eq("provider", "managebac"),
      )
      .unique();
    if (!integration || integration.status === "revoked")
      throw new Error(
        "INTEGRATION_NOT_CONNECTED: ManageBac is not connected for this school.",
      );
    const mapping = await ctx.db
      .query("externalIdentityMappings")
      .withIndex("by_integration_account", (q) =>
        q.eq("integrationId", integration._id).eq("accountId", actor.accountId),
      )
      .unique();
    if (!mapping || mapping.status !== "verified")
      throw new Error(
        "INTEGRATION_IDENTITY_REQUIRED: Verify your ManageBac email before creating class workspaces.",
      );
    const membershipRows = (
      await Promise.all(
        ["class", "course", "membership"].map((recordType) =>
          ctx.db
            .query("externalRecords")
            .withIndex("by_account_type", (q) =>
              q
                .eq("mappedAccountId", actor.accountId)
                .eq("recordType", recordType),
            )
            .take(500)
            .then((rows) =>
              rows.filter((item) => item.mappedAccountId === actor.accountId),
            ),
        ),
      )
    )
      .flat()
      .filter(
        (item) =>
          item.integrationId === integration._id &&
          item.schoolId === actor.schoolId &&
          !item.tombstone,
      );
    const accessibleClassIds = new Set(
      membershipRows.flatMap((item) =>
        item.providerClassId ? [item.providerClassId] : [],
      ),
    );
    const selected = args.recordIds.slice(0, 100);
    let created = 0;
    let refreshed = 0;
    let projected = 0;
    let skipped = 0;
    for (const recordId of selected) {
      const source = await ctx.db.get(recordId);
      if (
        !source ||
        source.schoolId !== actor.schoolId ||
        source.integrationId !== integration._id ||
        source.recordType !== "class" ||
        source.tombstone ||
        (source.mappedAccountId !== actor.accountId &&
          (!source.providerClassId ||
            !accessibleClassIds.has(source.providerClassId)))
      ) {
        skipped += 1;
        continue;
      }
      const result = await ensureClassWorkspace(
        ctx,
        integration,
        actor.accountId,
        source,
      );
      if (result.created) created += 1;
      else refreshed += 1;
      const workspaceId = ctx.db.normalizeId(
        "spectraWorkspaces",
        result.projection.projectionId,
      );
      if (!workspaceId || !source.providerClassId) continue;
      const relatedTypes = [
        "assignment",
        "deadline",
        "assessment",
        "resource",
        "file",
        "class_resource",
        "school_resource",
        "discussion",
        "announcement",
      ];
      const related = (
        await Promise.all(
          relatedTypes.map((recordType) =>
            ctx.db
              .query("externalRecords")
              .withIndex("by_class_type", (q) =>
                q
                  .eq("providerClassId", source.providerClassId)
                  .eq("recordType", recordType),
              )
              .take(500),
          ),
        )
      )
        .flat()
        .filter(
          (record) =>
            record.integrationId === integration._id &&
            !record.tombstone &&
            (!source.academicPeriodKey ||
              !record.academicPeriodKey ||
              record.academicPeriodKey === source.academicPeriodKey) &&
            (record.mappedAccountId === undefined ||
              record.mappedAccountId === actor.accountId),
        );
      for (const relatedRecord of related) {
        if (["assignment", "deadline", "assessment"].includes(relatedRecord.recordType)) {
          const task = await ensurePlannerProjection(
            ctx,
            integration,
            actor.accountId,
            relatedRecord,
          );
          const taskId = ctx.db.normalizeId(
            "spectraArtifacts",
            task.projection.projectionId,
          );
          if (
            taskId &&
            (await ensureClassWorkPlacement(
              ctx,
              workspaceId,
              actor.accountId,
              integration.schoolId,
              taskId,
            ))
          )
            projected += 1;
          continue;
        }
        if (["resource", "file", "class_resource", "school_resource"].includes(relatedRecord.recordType)) {
          await ensureResourceProjection(
            ctx,
            integration,
            actor.accountId,
            relatedRecord,
          );
          projected += 1;
          continue;
        }
        /* Discussions and announcements have no local identity, so there is
           nothing to file in the tree. They are counted as skipped rather than
           reported as projected content that a reader cannot open. */
        skipped += 1;
      }
    }
    return { created, refreshed, projected, skipped, requested: selected.length };
  },
});

export const purgeAutoCreatedClassWorkspaces = mutation({
  args: {
    confirmation: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor)
      throw new Error("AUTH_REQUIRED: Sign in to clean up class workspaces.");
    if (args.confirmation !== "Remove auto-created ManageBac workspaces")
      throw new Error(
        "INTEGRATION_CONFIRMATION_REQUIRED: Type the confirmation phrase to continue.",
      );
    const integration = await ctx.db
      .query("schoolIntegrations")
      .withIndex("by_school_provider", (q) =>
        q.eq("schoolId", actor.schoolId).eq("provider", "managebac"),
      )
      .unique();
    const owned = await ctx.db
      .query("spectraWorkspaces")
      .withIndex("by_account_starter", (q) =>
        q
          .eq("ownerAccountId", actor.accountId)
          .eq("starterKey", "managebac-class"),
      )
      .collect();
    const now = Date.now();
    let removed = 0;
    for (const workspace of owned) {
      /* Removing an auto-created shelf must not remove the work on it: the
         contents move to General (D31). Large shelves continue on a fresh
         mutation budget so aggregate btree writes cannot 16 MB the request. */
      const dissolved = await dissolveWorkspaceNode(ctx, workspace, {
        limit: DISSOLVE_CHILD_BATCH,
      });
      if (dissolved.remaining > 0) {
        await ctx.scheduler.runAfter(
          0,
          internal.managebac.continueDissolveClassWorkspace,
          { workspaceId: workspace._id },
        );
        continue;
      }
      await ctx.db.delete(workspace._id);
      removed += 1;
    }
    if (integration) {
      const projections = await ctx.db
        .query("externalProjections")
        .withIndex("by_account_updated", (q) =>
          q.eq("accountId", actor.accountId),
        )
        .order("desc")
        .take(5_000);
      for (const projection of projections) {
        if (
          projection.integrationId !== integration._id ||
          projection.projectionType !== "workspace"
        )
          continue;
        await ctx.db.patch(projection._id, {
          state: "detached",
          updatedAt: now,
        });
      }
    }
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "integration.managebac.class_workspaces_purged",
      targetType: "school_integration",
      targetId: integration?._id ?? actor.schoolId,
      metadata: { removed },
      retentionClass: "security",
    });
    return { removed };
  },
});

export const releaseClassWorkspaces = mutation({
  args: {
    recordIds: v.array(v.id("externalRecords")),
    retention: v.optional(
      v.union(v.literal("keep_in_spectra"), v.literal("archive_projection")),
    ),
  },
  handler: async (ctx, args) => {
    const actor = await getAuthenticatedActor(ctx);
    if (!actor)
      throw new Error("AUTH_REQUIRED: Sign in to update class workspaces.");
    const integration = await ctx.db
      .query("schoolIntegrations")
      .withIndex("by_school_provider", (q) =>
        q.eq("schoolId", actor.schoolId).eq("provider", "managebac"),
      )
      .unique();
    const selected = args.recordIds.slice(0, 100);
    const now = Date.now();
    let removed = 0;
    let skipped = 0;
    let kept = 0;
    for (const recordId of selected) {
      const source = await ctx.db.get(recordId);
      if (
        !source ||
        source.schoolId !== actor.schoolId ||
        source.recordType !== "class" ||
        (integration && source.integrationId !== integration._id)
      ) {
        skipped += 1;
        continue;
      }
      const providerKey = `class:${source.providerClassId ?? source.providerRecordId}:${source.academicPeriodKey ?? "current"}`;
      const projection = integration
        ? await ctx.db
            .query("externalProjections")
            .withIndex("by_provider_key", (q) =>
              q
                .eq("integrationId", integration._id)
                .eq("providerKey", providerKey),
            )
            .collect()
            .then(
              (rows) =>
                rows.find(
                  (item) =>
                    item.schoolId === actor.schoolId &&
                    item.accountId === actor.accountId &&
                    item.projectionType === "workspace",
                ) ?? null,
            )
        : null;
      const workspaceId =
        projection?.projectionType === "workspace"
          ? ctx.db.normalizeId("spectraWorkspaces", projection.projectionId)
          : null;
      const workspace = workspaceId ? await ctx.db.get(workspaceId) : null;
      if (!workspace || workspace.starterKey !== "managebac-class") {
        skipped += 1;
        continue;
      }
      if (workspace.ownerAccountId !== actor.accountId) {
        skipped += 1;
        continue;
      }
      if (args.retention === "archive_projection") {
        const relatedTypes = [
          "assignment",
          "deadline",
          "assessment",
          "timetable",
          "timetable_event",
          "lesson",
          "class_event",
          "calendar_event",
          "resource",
          "file",
          "class_resource",
          "school_resource",
        ];
        const related = (
          await Promise.all(
            relatedTypes.map((recordType) =>
              ctx.db
                .query("externalRecords")
                .withIndex("by_class_type", (q) =>
                  q.eq("providerClassId", source.providerClassId).eq("recordType", recordType),
                )
                .take(500),
            ),
          )
        )
          .flat()
          .filter(
            (record) =>
              record.integrationId === integration?._id &&
              record.schoolId === actor.schoolId &&
              (!source.academicPeriodKey ||
                !record.academicPeriodKey ||
                record.academicPeriodKey === source.academicPeriodKey),
          );
        const sourceIds = [source._id, ...related.map((record) => record._id)];
        const projections = (
          await Promise.all(
            sourceIds.map((recordId) =>
              ctx.db
                .query("externalProjections")
                .withIndex("by_record_type", (q) => q.eq("recordId", recordId))
                .collect(),
            ),
          )
        )
          .flat()
          .filter(
            (projection) =>
              projection.integrationId === integration?._id &&
              projection.schoolId === actor.schoolId &&
              projection.accountId === actor.accountId,
          );
        for (const projection of projections)
          await ctx.db.patch(projection._id, {
            state: "tombstoned",
            updatedAt: now,
          });
        await ctx.db.patch(workspace._id, {
          status: "archived",
          updatedAt: now,
        });
        removed += 1;
        continue;
      }
      /* keep_in_spectra (default): stop school updates only. Leave the class
         workspace, its children, and projections in place. Do not dissolve
         work into General or delete the shelf. ManageBac source records are
         not tombstoned. Selection already dropped this class, so later syncs
         will not fan out to it. Conflict "Keep" (detach) is a different path. */
      kept += 1;
    }
    await writeAuditEvent(ctx, {
      actorAccountId: actor.accountId,
      schoolId: actor.schoolId,
      action: "integration.managebac.class_workspaces_released",
      targetType: "school_integration",
      targetId: integration?._id ?? actor.schoolId,
      metadata: { removed, skipped, kept, requested: selected.length },
      retentionClass: "security",
    });
    return {
      removed,
      skipped,
      kept,
      requested: selected.length,
      remaining: 0,
      done: true,
    };
  },
});

export const continueDissolveClassWorkspace = internalMutation({
  args: { workspaceId: v.id("spectraWorkspaces") },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace || workspace.starterKey !== "managebac-class") return;
    const dissolved = await dissolveWorkspaceNode(ctx, workspace, {
      limit: DISSOLVE_CHILD_BATCH,
    });
    if (dissolved.remaining > 0) {
      await ctx.scheduler.runAfter(
        0,
        internal.managebac.continueDissolveClassWorkspace,
        { workspaceId: args.workspaceId },
      );
      return;
    }
    await ctx.db.delete(args.workspaceId);
  },
});
