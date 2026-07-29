import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { writeAuditEvent } from "./auditShared";
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
  args: {},
  handler: async (ctx) => {
    const integrations = (
      await Promise.all(
        (["connected", "degraded"] as const).map((status) =>
          ctx.db
            .query("schoolIntegrations")
            .withIndex("by_status_next_sync", (q) => q.eq("status", status))
            .collect(),
        ),
      )
    ).flat();
    let scheduled = 0;
    for (const integration of integrations) {
      if (
        typeof integration.nextSyncAt !== "number" ||
        integration.blockedReason
      )
        continue;
      await scheduleSync(ctx, integration._id, integration.nextSyncAt);
      scheduled += 1;
    }
    return { scheduled };
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
    if (parsed.protocol !== "https:")
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
    const patch = {
      baseUrl,
      referenceUrl: args.referenceUrl?.trim().slice(0, 2_000),
      authHeaderName,
      authScheme: args.authScheme,
      status:
        current && !connectionContractChanged && current.status !== "revoked"
          ? current.status
          : ("validating" as const),
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
    const integration = await integrationForSchool(ctx, actor.schoolId);
    if (!integration)
      return {
        integration: null,
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
        .take(100),
      ctx.db
        .query("externalIdentityMappings")
        .withIndex("by_school_status", (q) =>
          q.eq("schoolId", actor.schoolId).eq("status", "no_match"),
        )
        .take(100),
      ctx.db
        .query("externalRecords")
        .withIndex("by_school_updated", (q) => q.eq("schoolId", actor.schoolId))
        .order("desc")
        .take(500),
    ]);
    const school = await ctx.db.get(actor.schoolId);
    return {
      integration: safeIntegration(integration),
      school: school ? { _id: school._id, name: school.name } : null,
      capabilities,
      syncRuns,
      conflicts,
      quarantine,
      previews: schoolRecords
        .filter(
          (item) =>
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
        .take(30),
      ctx.db
        .query("externalSyncConflicts")
        .withIndex("by_account_status", (q) =>
          q.eq("accountId", actor.accountId).eq("status", "open"),
        )
        .take(100),
      ctx.db
        .query("externalRecords")
        .withIndex("by_account_type", (q) =>
          q.eq("mappedAccountId", actor.accountId),
        )
        .order("desc")
        .take(300),
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
      })),
      syncRuns,
      conflicts,
      records: records.map((item) => ({
        _id: item._id,
        recordType: item.recordType,
        classification: item.classification,
        audienceScope: item.audienceScope,
        providerClassId: item.providerClassId,
        academicPeriodKey: item.academicPeriodKey,
        normalized: item.normalized,
        sourceModifiedAt: item.sourceModifiedAt,
        fetchedAt: item.fetchedAt,
        tombstone: item.tombstone,
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
      const activeRuns = await ctx.db
        .query("externalSyncRuns")
        .withIndex("by_integration_created", (q) =>
          q.eq("integrationId", integration._id),
        )
        .order("desc")
        .take(20);
      if (
        activeRuns.some(
          (run) =>
            ["queued", "leased", "running"].includes(run.status) &&
            (!run.leaseExpiresAt || run.leaseExpiresAt > now),
        )
      )
        continue;
      for (const expired of activeRuns.filter(
        (run) =>
          ["queued", "leased", "running"].includes(run.status) &&
          Boolean(run.leaseExpiresAt && run.leaseExpiresAt <= now),
      ))
        await ctx.db.patch(expired._id, {
          status: "failed",
          stage: "lease_expired",
          errorCode: "INTEGRATION_WORKER_LEASE_EXPIRED",
          errorSummary:
            "The scheduled worker lease expired before the run settled.",
          completedAt: now,
          updatedAt: now,
        });
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
    const [capabilities, mapping] = await Promise.all([
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
    const syncRunId = await ctx.db.insert("externalSyncRuns", {
      integrationId: integration._id,
      schoolId: actor.schoolId,
      accountId:
        args.kind === "reconciliation" && actor.schoolRole === "school_admin"
          ? undefined
          : actor.accountId,
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
    return { syncRunId, integrationId: integration._id };
  },
});

/** AI-triggered refresh with anti-thrash cooldown (~15 minutes). */
export const requestAiRefresh = mutation({
  args: {
    reason: v.optional(v.string()),
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
    const cooldownMs = 15 * 60_000;
    if (integration.lastSyncAt && now - integration.lastSyncAt < cooldownMs)
      return {
        started: false,
        skipped: true,
        reason: "fresh" as const,
        lastSyncAt: integration.lastSyncAt,
        nextEligibleAt: integration.lastSyncAt + cooldownMs,
      };
    const active = await ctx.db
      .query("externalSyncRuns")
      .withIndex("by_integration_created", (q) =>
        q.eq("integrationId", integration._id),
      )
      .order("desc")
      .take(12);
    if (
      active.some(
        (run) =>
          ["queued", "leased", "running"].includes(run.status) &&
          (!run.leaseExpiresAt || run.leaseExpiresAt > now),
      )
    )
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
    .unique();
  if (existing) return { projection: existing, created: false };
  const normalized = record(source.normalized);
  const now = Date.now();
  const workspaceId = await ctx.db.insert("spectraWorkspaces", {
    ownerAccountId: accountId,
    schoolId: integration.schoolId,
    title: text(normalized.name ?? normalized.title, 180, "ManageBac class"),
    description: text(
      normalized.description ??
        `${text(normalized.course ?? normalized.programme, 120)} · Source-linked from ManageBac`,
      600,
    ),
    icon: "BookOpen",
    color: text(normalized.color, 32, "#429379"),
    starterKey: "managebac-class",
    status: "active",
    defaultView: "cards",
    createdAt: now,
    updatedAt: now,
    lastActivityAt: now,
  });
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
    .unique();
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
  const providerKey = `planner:${source.providerRecordKey}`;
  const existing = await ctx.db
    .query("externalProjections")
    .withIndex("by_provider_key", (q) =>
      q.eq("integrationId", integration._id).eq("providerKey", providerKey),
    )
    .unique();
  if (existing) return { projection: existing, created: false };
  const normalized = record(source.normalized);
  const now = Date.now();
  const content = {
    ...(defaultArtifactContent("planner_task") as Record<string, unknown>),
    taskTitle: text(normalized.title ?? normalized.name, 240, "ManageBac task"),
    description: text(normalized.description, 20_000),
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
    sourceRefs: [`managebac:${source.providerRecordKey}`],
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
    summary: text(normalized.description, 600, "Source-linked ManageBac task"),
    content,
    textIndex: buildArtifactTextIndex({
      title,
      summary: text(normalized.description, 600),
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
    source.providerClassId,
    source.academicPeriodKey,
  );
  if (workspaceId)
    await ctx.db.insert("spectraWorkspaceItems", {
      workspaceId,
      sourceType: "artifact",
      sourceId: artifactId,
      viewData: {
        compactSummary: "ManageBac source · user overlay preserved",
        pinned: false,
        hidden: false,
      },
      layout: { view: "cards" },
      placedByAccountId: accountId,
      accessProjection: true,
      createdAt: now,
      updatedAt: now,
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

async function timetableArtifactForAccount(
  ctx: MutationCtx,
  integration: Doc<"schoolIntegrations">,
  accountId: Id<"accounts">,
) {
  const existingProjections = await ctx.db
    .query("externalProjections")
    .withIndex("by_account_updated", (q) => q.eq("accountId", accountId))
    .collect();
  for (const projection of existingProjections) {
    if (
      projection.integrationId !== integration._id ||
      projection.projectionType !== "timetable_event"
    )
      continue;
    const artifactId = projection.projectionId.split("#", 1)[0];
    if (!artifactId) continue;
    const normalizedId = ctx.db.normalizeId("spectraArtifacts", artifactId);
    const artifact = normalizedId ? await ctx.db.get(normalizedId) : null;
    if (artifact?.blueprintKey === "timetable" && artifact.status === "active")
      return artifact;
  }
  const now = Date.now();
  const content = defaultArtifactContent("timetable") as Record<
    string,
    unknown
  >;
  const title = "My school timetable";
  const artifactId = await ctx.db.insert("spectraArtifacts", {
    ownerAccountId: accountId,
    schoolId: integration.schoolId,
    blueprintKey: "timetable",
    schemaVersion: defaultArtifactSchemaVersion("timetable"),
    title,
    summary: "Classes and school deadlines synchronized from ManageBac",
    content,
    textIndex: buildArtifactTextIndex({
      title,
      summary: "Classes and school deadlines synchronized from ManageBac",
      content,
      tags: ["managebac", "timetable", "source-linked"],
    }),
    tags: ["managebac", "source-linked"],
    status: "active",
    createdFrom: {
      source: "manual",
      contextSummary: "Automatic ManageBac timetable bootstrap",
    },
    createdAt: now,
    updatedAt: now,
  });
  return (await ctx.db.get(artifactId))!;
}

async function ensureTimetableProjection(
  ctx: MutationCtx,
  integration: Doc<"schoolIntegrations">,
  accountId: Id<"accounts">,
  source: Doc<"externalRecords">,
) {
  const providerKey = `timetable:${source.providerRecordKey}`;
  const existing = await ctx.db
    .query("externalProjections")
    .withIndex("by_provider_key", (q) =>
      q.eq("integrationId", integration._id).eq("providerKey", providerKey),
    )
    .unique();
  if (existing) return { projection: existing, created: false };
  const normalized = record(source.normalized);
  const start = isoValue(
    normalized.startAt ?? normalized.start ?? normalized.beginsAt,
  );
  const due = isoValue(normalized.dueAt ?? normalized.deadlineAt);
  if (!start && !due) return { projection: null, created: false };
  const eventStart = start ?? due!;
  const eventEnd =
    isoValue(normalized.endAt ?? normalized.end ?? normalized.finishesAt) ??
    new Date(
      Date.parse(eventStart) + (due && !start ? 30 : 60) * 60_000,
    ).toISOString();
  const artifact = await timetableArtifactForAccount(
    ctx,
    integration,
    accountId,
  );
  const content = record(artifact.content);
  const layers = array(content.layers).map(record);
  const layerId = source.providerClassId
    ? `managebac-class:${source.providerClassId.slice(0, 120)}`
    : source.recordType === "deadline" || source.recordType === "assessment"
      ? "tasks"
      : "classes";
  if (!layers.some((layer) => layer.id === layerId)) {
    layers.push({
      id: layerId,
      name: text(
        normalized.className ?? normalized.courseName,
        120,
        "ManageBac class",
      ),
      kind: source.providerClassId ? "class" : "external",
      visible: true,
      color: "#26a879",
      sourceId: source.providerClassId?.slice(0, 180),
      authority: "external",
      locked: true,
    });
  }
  const eventId = `managebac:${source.providerRecordKey}`.slice(0, 180);
  const plannerProjection = await ctx.db
    .query("externalProjections")
    .withIndex("by_provider_key", (q) =>
      q
        .eq("integrationId", integration._id)
        .eq("providerKey", `planner:${source.providerRecordKey}`),
    )
    .unique();
  const linkedTaskId =
    plannerProjection?.projectionType === "planner_task"
      ? plannerProjection.projectionId
      : undefined;
  const title = text(
    normalized.title ?? normalized.name,
    300,
    source.recordType === "deadline" ? "ManageBac deadline" : "ManageBac event",
  );
  const event = {
    id: eventId,
    layerId,
    title,
    start: eventStart,
    end:
      Date.parse(eventEnd) > Date.parse(eventStart)
        ? eventEnd
        : new Date(Date.parse(eventStart) + 30 * 60_000).toISOString(),
    allDay: normalized.allDay === true || Boolean(due && !start),
    timezone: text(normalized.timezone, 100, "UTC"),
    sourceRef: source.providerRecordKey.slice(0, 180),
    sourceVersion: source.payloadVersion.slice(0, 180),
    sourceHash: source.sourceHash.slice(0, 180),
    sourceStatus: "active",
    ...(text(normalized.location, 300)
      ? { location: text(normalized.location, 300) }
      : {}),
    ...(text(normalized.description ?? normalized.notes, 20_000)
      ? { notes: text(normalized.description ?? normalized.notes, 20_000) }
      : {}),
    ...(linkedTaskId
      ? { taskId: linkedTaskId, artifactIds: [linkedTaskId] }
      : {}),
    provenance: {
      actor: "source",
      source: "ManageBac",
      importedAt: Date.now(),
    },
    locked: true,
  };
  const nextContent = {
    timezone: text(content.timezone, 100, "UTC"),
    layers,
    events: [...array(content.events), event],
  };
  const now = Date.now();
  await ctx.db.patch(artifact._id, {
    content: nextContent,
    textIndex: buildArtifactTextIndex({
      title: artifact.title,
      summary: artifact.summary ?? "",
      content: nextContent,
      tags: artifact.tags,
    }),
    updatedAt: now,
  });
  const projectionId = await ctx.db.insert("externalProjections", {
    integrationId: integration._id,
    schoolId: integration.schoolId,
    recordId: source._id,
    accountId,
    projectionType: "timetable_event",
    projectionId: `${artifact._id}#${eventId}`,
    providerKey,
    sourceHash: source.sourceHash,
    state: "active",
    bootstrapVersion: integration.bootstrapVersion,
    createdAt: now,
    updatedAt: now,
  });
  return { projection: (await ctx.db.get(projectionId))!, created: true };
}

async function ensureResourceProjection(
  ctx: MutationCtx,
  integration: Doc<"schoolIntegrations">,
  accountId: Id<"accounts">,
  source: Doc<"externalRecords">,
) {
  const providerKey = `resource:${source.providerRecordKey}`;
  const existing = await ctx.db
    .query("externalProjections")
    .withIndex("by_provider_key", (q) =>
      q.eq("integrationId", integration._id).eq("providerKey", providerKey),
    )
    .unique();
  if (existing) return { projection: existing, created: false };
  const normalized = record(source.normalized);
  const workspaceId = await classWorkspaceId(
    ctx,
    integration._id,
    source.providerClassId,
    source.academicPeriodKey,
  );
  const now = Date.now();
  const sourceId = `managebac:${source._id}`;
  if (workspaceId) {
    const placed = await ctx.db
      .query("spectraWorkspaceItems")
      .withIndex("by_workspace_source", (q) =>
        q
          .eq("workspaceId", workspaceId)
          .eq("sourceType", "custom")
          .eq("sourceId", sourceId),
      )
      .unique();
    if (!placed)
      await ctx.db.insert("spectraWorkspaceItems", {
        workspaceId,
        sourceType: "custom",
        sourceId,
        viewData: {
          titleOverride: text(
            normalized.title ?? normalized.name,
            240,
            "ManageBac resource",
          ),
          compactSummary: text(
            normalized.description ?? normalized.fileName,
            500,
            "ManageBac source resource",
          ),
          cardVariant: "source-resource",
          pinned: false,
          hidden: false,
        },
        layout: { view: "cards" },
        placedByAccountId: accountId,
        accessProjection: true,
        createdAt: now,
        updatedAt: now,
      });
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
      item.providerRecordId === source.providerClassId ||
      item.providerClassId === source.providerClassId,
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
) {
  const normalized = record(source.normalized);
  if (projection.projectionType === "planner_task") {
    const artifactId = ctx.db.normalizeId(
      "spectraArtifacts",
      projection.projectionId,
    );
    const artifact = artifactId ? await ctx.db.get(artifactId) : null;
    if (!artifact || artifact.blueprintKey !== "planner_task") return false;
    const content = record(artifact.content);
    const sourceState = record(content.source);
    if (!force && sourceState.hash !== previousSourceHash) return false;
    const title = text(
      normalized.title ?? normalized.name,
      240,
      artifact.title,
    );
    const nextContent = {
      ...content,
      taskTitle: title,
      description: text(normalized.description, 20_000),
      dueAt: timestampValue(normalized.dueAt) ?? null,
      source: {
        ...sourceState,
        externalId: source.providerRecordId,
        version: source.payloadVersion,
        hash: source.sourceHash,
        status: "active",
        lockedFields: ["taskTitle", "description", "dueAt", "source"],
      },
    };
    const now = Date.now();
    await ctx.db.patch(artifact._id, {
      title,
      summary: text(normalized.description, 600, artifact.summary ?? ""),
      content: nextContent,
      textIndex: buildArtifactTextIndex({
        title,
        summary: text(normalized.description, 600, artifact.summary ?? ""),
        content: nextContent,
        tags: artifact.tags,
      }),
      updatedAt: now,
    });
    return true;
  }
  if (projection.projectionType === "timetable_event") {
    const [artifactValue, eventId] = projection.projectionId.split("#");
    const artifactId = artifactValue
      ? ctx.db.normalizeId("spectraArtifacts", artifactValue)
      : null;
    const artifact = artifactId ? await ctx.db.get(artifactId) : null;
    if (!artifact || artifact.blueprintKey !== "timetable" || !eventId)
      return false;
    const content = record(artifact.content);
    const events = array(content.events).map(record);
    const index = events.findIndex((event) => event.id === eventId);
    if (
      index < 0 ||
      (!force && events[index]!.sourceHash !== previousSourceHash)
    )
      return false;
    const oldEvent = events[index]!;
    const start =
      isoValue(normalized.startAt ?? normalized.start ?? normalized.beginsAt) ??
      text(oldEvent.start, 100);
    const end =
      isoValue(normalized.endAt ?? normalized.end ?? normalized.finishesAt) ??
      text(oldEvent.end, 100);
    events[index] = {
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
    const nextContent = { ...content, events };
    const now = Date.now();
    await ctx.db.patch(artifact._id, {
      content: nextContent,
      textIndex: buildArtifactTextIndex({
        title: artifact.title,
        summary: artifact.summary ?? "",
        content: nextContent,
        tags: artifact.tags,
      }),
      updatedAt: now,
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
    const [artifactValue, eventId] = projection.projectionId.split("#");
    const artifactId = artifactValue
      ? ctx.db.normalizeId("spectraArtifacts", artifactValue)
      : null;
    const artifact = artifactId ? await ctx.db.get(artifactId) : null;
    if (!artifact || artifact.blueprintKey !== "timetable" || !eventId) return;
    const content = record(artifact.content);
    const events = array(content.events).map((item) => {
      const event = record(item);
      return event.id === eventId
        ? { ...event, sourceStatus: "removed" }
        : event;
    });
    await ctx.db.patch(artifact._id, {
      content: { ...content, events },
      updatedAt: Date.now(),
    });
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
    if (["deadline", "assessment"].includes(source.recordType)) {
      const timetable = await ensureTimetableProjection(
        ctx,
        integration,
        syncRun.accountId,
        source,
      );
      return {
        projected: true,
        created: result.created || timetable.created,
      };
    }
    return { projected: true, created: result.created };
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
    const expectedDigest = await exactDigest({
      capabilityId: args.capabilityId,
      records: args.records,
      ...(args.nextCursor ? { nextCursor: args.nextCursor } : {}),
      pageNumber: args.pageNumber,
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
    for (const input of args.records) {
      const existing = await ctx.db
        .query("externalRecords")
        .withIndex("by_integration_key", (q) =>
          q
            .eq("integrationId", integration._id)
            .eq("providerRecordKey", input.providerRecordKey),
        )
        .unique();
      let source: Doc<"externalRecords">;
      if (existing?.sourceHash === input.sourceHash && !existing.tombstone) {
        counts.unchanged += 1;
        source = existing;
      } else if (existing) {
        const previousNormalized = existing.normalized;
        await ctx.db.patch(existing._id, {
          providerRecordId: input.providerRecordId.slice(0, 500),
          recordType: capability.recordType,
          classification: input.classification,
          audienceScope: input.audienceScope,
          mappedAccountId:
            input.audienceScope === "mapped_user"
              ? syncRun.accountId
              : undefined,
          providerClassId: input.providerClassId?.slice(0, 500),
          academicPeriodKey: input.academicPeriodKey?.slice(0, 300),
          normalized: input.normalized,
          payloadVersion: input.payloadVersion.slice(0, 100),
          sourceHash: input.sourceHash.slice(0, 180),
          sourceModifiedAt: input.sourceModifiedAt,
          provenanceUrl: input.provenanceUrl?.slice(0, 2_000),
          tombstone: false,
          tombstonedAt: undefined,
          fetchedAt: now,
          updatedAt: now,
        });
        source = (await ctx.db.get(existing._id))!;
        counts.updated += 1;
        const projections = await ctx.db
          .query("externalProjections")
          .withIndex("by_record_type", (q) => q.eq("recordId", existing._id))
          .collect();
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
          mappedAccountId:
            input.audienceScope === "mapped_user"
              ? syncRun.accountId
              : undefined,
          providerClassId: input.providerClassId?.slice(0, 500),
          academicPeriodKey: input.academicPeriodKey?.slice(0, 300),
          normalized: input.normalized,
          payloadVersion: input.payloadVersion.slice(0, 100),
          sourceHash: input.sourceHash.slice(0, 180),
          sourceModifiedAt: input.sourceModifiedAt,
          provenanceUrl: input.provenanceUrl?.slice(0, 2_000),
          tombstone: false,
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
    const expectedDigest = await exactDigest({
      capabilityId: args.capabilityId,
      reasonCode: args.reasonCode,
      payloadHash: args.payloadHash,
      providerRecordKeyHash: args.providerRecordKeyHash,
      ...(args.sanitizedSample !== undefined
        ? { sanitizedSample: args.sanitizedSample }
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
    const expectedDigest = await exactDigest({
      errorCode: args.errorCode,
      errorSummary: args.errorSummary,
      ...(args.retryAfterAt !== undefined
        ? { retryAfterAt: args.retryAfterAt }
        : {}),
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
      stage: "failed",
      errorCode: text(args.errorCode, 200),
      errorSummary: text(args.errorSummary, 500),
      nextAttemptAt: retryAt,
      attemptCount: syncRun.attemptCount + 1,
      completedAt: now,
      updatedAt: now,
    });
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
    return { failed: true, partial };
  },
});

export const completeSync = mutation({
  args: {
    integrationId: v.id("schoolIntegrations"),
    syncRunId: v.id("externalSyncRuns"),
    serviceSubject: v.optional(v.string()),
    seenProviderKeys: v.array(v.string()),
    reconciledCapabilityIds: v.array(v.id("integrationCapabilities")),
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
    const expectedDigest = await exactDigest({
      seenProviderKeys: args.seenProviderKeys,
      reconciledCapabilityIds: args.reconciledCapabilityIds,
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
          ).filter((item) => personalTypes.has(item.recordType))
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
    for (const source of currentRecords) {
      if (source.tombstone || seen.has(source.providerRecordKey)) continue;
      await ctx.db.patch(source._id, {
        tombstone: true,
        tombstonedAt: now,
        fetchedAt: now,
        updatedAt: now,
      });
      const projections = await ctx.db
        .query("externalProjections")
        .withIndex("by_record_type", (q) => q.eq("recordId", source._id))
        .collect();
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
    const conflicts = await ctx.db
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
    const patch = {
      notes: args.notes?.slice(0, 100_000),
      completion: args.completion,
      reminders: args.reminders
        ?.filter((item) => Number.isFinite(item))
        .slice(0, 20),
      tags: (args.tags ?? existing?.tags ?? [])
        .map((item) => item.trim().slice(0, 48))
        .filter(Boolean)
        .slice(0, 32),
      alternativeStartAt: args.alternativeStartAt,
      alternativeEndAt: args.alternativeEndAt,
      placementWorkspaceId: args.placementWorkspaceId,
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
      (conflict.accountId &&
        conflict.accountId !== actor.accountId &&
        actor.schoolRole !== "school_admin")
    )
      throw new Error(
        "INTEGRATION_CONFLICT_FORBIDDEN: Conflict is unavailable.",
      );
    const now = Date.now();
    const projections = await ctx.db
      .query("externalProjections")
      .withIndex("by_record_type", (q) => q.eq("recordId", conflict.recordId))
      .collect();
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
        const refreshed = await safelyRefreshProjection(
          ctx,
          projection,
          projection.sourceHash,
          source,
          true,
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
            .take(200),
        ),
      )
    ).flat();
    const membershipRows = await Promise.all(
      ["class", "course", "membership"].map((recordType) =>
        ctx.db
          .query("externalRecords")
          .withIndex("by_account_type", (q) =>
            q
              .eq("mappedAccountId", actor.accountId)
              .eq("recordType", recordType),
          )
          .take(500),
      ),
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
      [...personalRows, ...scopedRows].map((item) => [
        item.providerRecordKey,
        item,
      ]),
    );
    const limited = [...deduped.values()]
      .filter((item) => !item.tombstone)
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
        return (
          timestamp === null ||
          ((args.from === undefined || timestamp >= args.from) &&
            (args.to === undefined || timestamp <= args.to))
        );
      })
      .sort((a, b) => {
        const left = record(a.normalized);
        const right = record(b.normalized);
        return (
          (timestampValue(left.dueAt ?? left.startAt ?? left.start) ??
            Number.MAX_SAFE_INTEGER) -
          (timestampValue(right.dueAt ?? right.startAt ?? right.start) ??
            Number.MAX_SAFE_INTEGER)
        );
      })
      .slice(0, Math.max(1, Math.min(args.limit ?? 50, 200)));
    return {
      connected: true,
      records: limited.map((item) => ({
        id: item._id,
        recordType: item.recordType,
        normalized: item.normalized,
        providerClassId: item.providerClassId,
        sourceModifiedAt: item.sourceModifiedAt,
        fetchedAt: item.fetchedAt,
        provenanceUrl: item.provenanceUrl,
      })),
      stale:
        !integration.lastSyncAt ||
        Date.now() - integration.lastSyncAt >
          integration.freshnessSlaMinutes * 60_000,
      provenance: {
        provider: "ManageBac",
        lastSyncAt: integration.lastSyncAt,
        purpose: args.purpose,
      },
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
        lastSyncAt: integration.lastSyncAt,
        nextSyncAt: integration.nextSyncAt,
      };
    const [records, projections, membershipRows] = await Promise.all([
      ctx.db
        .query("externalRecords")
        .withIndex("by_school_updated", (q) => q.eq("schoolId", actor.schoolId))
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
            .take(500),
        ),
      ),
    ]);
    const accessibleClassIds = new Set(
      membershipRows
        .flat()
        .flatMap((item) =>
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
    const eligibleClasses = records
      .filter(
        (item) =>
          item.recordType === "class" &&
          !item.tombstone &&
          ((item.mappedAccountId === actor.accountId) ||
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
      const key = item.providerClassId ?? item.providerRecordId;
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
          description: text(normalized.description, 400),
          archived,
          workspaceId: workspaceId ?? null,
          fetchedAt: item.fetchedAt,
        };
      })
      .filter((item) => !item.archived)
      .sort((a, b) => a.title.localeCompare(b.title));
    return {
      integration: safeIntegration(integration),
      classes,
      lastSyncAt: integration.lastSyncAt,
      nextSyncAt: integration.nextSyncAt,
    };
  },
});

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
            .take(500),
        ),
      )
    ).flat();
    const accessibleClassIds = new Set(
      membershipRows.flatMap((item) =>
        item.providerClassId ? [item.providerClassId] : [],
      ),
    );
    const selected = args.recordIds.slice(0, 100);
    let created = 0;
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
      else skipped += 1;
    }
    return { created, skipped, requested: selected.length };
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
      const items = await ctx.db
        .query("spectraWorkspaceItems")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
        .collect();
      for (const item of items) await ctx.db.delete(item._id);
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
