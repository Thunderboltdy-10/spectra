import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { getActiveMembership, getAuthenticatedAccount } from "./identityShared";
import { writeAuditEvent } from "./auditShared";
import {
  CONNECTION_COMPENSATION_TABLE,
  connectionSecretPurpose,
  requireProviderDescriptor,
  type ConnectionStatus,
  type ConnectorFamily,
} from "../src/features/spectra/connectors/core";

const STALLED_COMPENSATION_MS = 15 * 60_000;
const PAGE_SIZE = 100;

const family = v.union(
  v.literal("file-sync"),
  v.literal("calendar"),
  v.literal("school-data"),
);

const recoverableStatus = v.union(
  v.literal("expired"),
  v.literal("rate_limited"),
  v.literal("error"),
);

function cleanProvider(value: string) {
  const provider = value.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(provider))
    throw new Error("CONNECTION_PROVIDER_INVALID");
  return provider;
}

function cleanLabel(value?: string) {
  return value?.trim().replace(/\s+/g, " ").slice(0, 120) || undefined;
}

function cleanProviderAccountId(value?: string) {
  return value?.trim().slice(0, 240) || "default";
}

function cleanScopes(scopes: string[]) {
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))]
    .slice(0, 100)
    .map((scope) => scope.slice(0, 240));
}

function assertTransition(from: ConnectionStatus, to: ConnectionStatus) {
  if (from === to) return;
  const exits: readonly ConnectionStatus[] =
    CONNECTION_COMPENSATION_TABLE[from].exits;
  if (!exits.includes(to))
    throw new Error(`CONNECTION_TRANSITION_INVALID: ${from} -> ${to}`);
}

async function requireOwnedConnection(
  ctx: MutationCtx,
  connectionId: Id<"connections">,
) {
  const account = await getAuthenticatedAccount(ctx);
  if (!account) throw new Error("AUTH_ACCOUNT_REQUIRED");
  const connection = await ctx.db.get(connectionId);
  if (
    !connection ||
    connection.scopeKind !== "account" ||
    connection.accountId !== account._id
  )
    throw new Error("CONNECTION_NOT_FOUND");
  return { account, connection };
}

function safeConnection(connection: Doc<"connections">) {
  return {
    connectionId: connection._id,
    scopeKind: connection.scopeKind,
    provider: connection.provider,
    providerAccountId: connection.providerAccountId,
    displayLabel: connection.displayLabel,
    family: connection.family,
    authKind: connection.authKind,
    status: connection.status,
    grantedScopes: connection.grantedScopes,
    errorCode: connection.errorCode,
    retryAt: connection.retryAt,
    expiresAt: connection.expiresAt,
    lastHealthAt: connection.lastHealthAt,
    connectedAt: connection.connectedAt,
    revokedAt: connection.revokedAt,
    remoteRevocationConfirmed: connection.remoteRevocationConfirmed,
    updatedAt: connection.updatedAt,
  };
}

function manageBacHealth(integration: Doc<"schoolIntegrations"> | null) {
  if (!integration) {
    return {
      status: "error" as const,
      errorCode: "not_configured",
    };
  }
  if (integration.status === "connected") {
    return { status: "connected" as const, errorCode: undefined };
  }
  if (
    integration.status === "revoked" ||
    integration.status === "disconnected"
  ) {
    return { status: "revoked" as const, errorCode: undefined };
  }
  if (integration.status === "validating") {
    return {
      status: "error" as const,
      errorCode: "checking_connection",
    };
  }
  return {
    status: "error" as const,
    errorCode: integration.blockedReason
      ? "provider_blocked"
      : "provider_error",
  };
}

export const overview = query({
  args: {},
  handler: async (ctx) => {
    const account = await getAuthenticatedAccount(ctx);
    if (!account) return null;
    const membership = await getActiveMembership(ctx, account._id);
    const [accountConnections, schoolConnections, devices, mounts, manageBac] =
      await Promise.all([
        ctx.db
          .query("connections")
          .withIndex("by_account_provider", (q) =>
            q.eq("accountId", account._id),
          )
          .collect(),
        membership
          ? ctx.db
              .query("connections")
              .withIndex("by_school_provider", (q) =>
                q.eq("schoolId", membership.schoolId),
              )
              .collect()
          : Promise.resolve([]),
        ctx.db
          .query("bridgeDevices")
          .withIndex("by_account_state", (q) =>
            q.eq("accountId", account._id).eq("state", "active"),
          )
          .take(50),
        ctx.db
          .query("bridgeMounts")
          .withIndex("by_account_state", (q) => q.eq("accountId", account._id))
          .filter((q) => q.neq(q.field("state"), "revoked"))
          .take(200),
        membership
          ? ctx.db
              .query("schoolIntegrations")
              .withIndex("by_school_provider", (q) =>
                q
                  .eq("schoolId", membership.schoolId)
                  .eq("provider", "managebac"),
              )
              .unique()
          : Promise.resolve(null),
      ]);
    const legacyManageBac = manageBacHealth(manageBac);
    return {
      connections: [...accountConnections, ...schoolConnections]
        .filter(
          (connection) =>
            (connection.scopeKind === "account" &&
              connection.accountId === account._id) ||
            (connection.scopeKind === "school" &&
              connection.schoolId === membership?.schoolId),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(safeConnection),
      bridge: {
        devices: devices.map((device) => ({
          deviceId: device._id,
          name: device.name,
          platform: device.platform,
          appVersion: device.appVersion,
          protocolVersion: device.protocolVersion,
          pairedAt: device.pairedAt,
          lastSeenAt: device.lastSeenAt,
          mountCount: mounts.filter((mount) => mount.deviceId === device._id)
            .length,
        })),
        mountCount: mounts.length,
      },
      manageBac: membership
        ? {
            configured: Boolean(manageBac),
            status: legacyManageBac.status,
            errorCode: legacyManageBac.errorCode,
            lastHealthAt: manageBac?.lastValidatedAt,
            connectedAt: manageBac?.lastValidatedAt,
            updatedAt: manageBac?.updatedAt,
            canManage: membership.role === "school_admin",
          }
        : null,
    };
  },
});

export const prepareOAuth = mutation({
  args: {
    provider: v.string(),
    family,
    providerAccountId: v.optional(v.string()),
    displayLabel: v.optional(v.string()),
    grantedScopes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const account = await getAuthenticatedAccount(ctx);
    if (!account) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const provider = cleanProvider(args.provider);
    const descriptor = requireProviderDescriptor(provider);
    if (descriptor.auth.kind !== "oauth" || descriptor.family !== args.family)
      throw new Error("CONNECTION_PROVIDER_CONTRACT_MISMATCH");
    const providerAccountId = cleanProviderAccountId(args.providerAccountId);
    const scopeKey = `account:${account._id}`;
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_scope_provider_account", (q) =>
        q
          .eq("scopeKey", scopeKey)
          .eq("provider", provider)
          .eq("providerAccountId", providerAccountId),
      )
      .unique();
    const now = Date.now();
    const patch = {
      displayLabel: cleanLabel(args.displayLabel),
      family: args.family,
      authKind: "oauth" as const,
      status: "error" as const,
      grantedScopes: cleanScopes(args.grantedScopes),
      errorCode: "authorization_incomplete",
      statusReason: "OAuth callback is storing the verified token envelope.",
      retryAt: now + 10 * 60_000,
      expiresAt: undefined,
      revokedAt: undefined,
      remoteRevocationConfirmed: undefined,
      updatedAt: now,
    };
    let connectionId: Id<"connections">;
    if (existing) {
      assertTransition(existing.status, "error");
      await ctx.db.patch(existing._id, patch);
      connectionId = existing._id;
    } else {
      connectionId = await ctx.db.insert("connections", {
        scopeKind: "account",
        scopeKey,
        accountId: account._id,
        provider,
        providerAccountId,
        ...patch,
        consecutiveFailures: 0,
        createdByAccountId: account._id,
        createdAt: now,
      });
    }
    const secretPurpose = connectionSecretPurpose(
      provider,
      String(connectionId),
    );
    await ctx.db.patch(connectionId, { secretPurpose });
    await writeAuditEvent(ctx, {
      actorAccountId: account._id,
      action: "connection.oauth.prepared",
      targetType: "connection",
      targetId: connectionId,
      metadata: { provider, family: args.family },
      retentionClass: "security",
    });
    return {
      connectionId,
      accountId: account._id,
      secretPurpose,
    };
  },
});

export const oauthContext = query({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, args) => {
    const account = await getAuthenticatedAccount(ctx);
    if (!account) throw new Error("AUTH_ACCOUNT_REQUIRED");
    const connection = await ctx.db.get(args.connectionId);
    if (
      !connection ||
      connection.scopeKind !== "account" ||
      connection.accountId !== account._id ||
      connection.authKind !== "oauth" ||
      !connection.secretPurpose
    ) {
      throw new Error("CONNECTION_NOT_FOUND");
    }
    return {
      connectionId: connection._id,
      accountId: account._id,
      provider: connection.provider,
      displayLabel: connection.displayLabel,
      secretPurpose: connection.secretPurpose,
      grantedScopes: connection.grantedScopes,
      expiresAt: connection.expiresAt,
    };
  },
});

export const markConnected = mutation({
  args: {
    connectionId: v.id("connections"),
    grantedScopes: v.optional(v.array(v.string())),
    displayLabel: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { account, connection } = await requireOwnedConnection(
      ctx,
      args.connectionId,
    );
    assertTransition(connection.status, "connected");
    const now = Date.now();
    await ctx.db.patch(connection._id, {
      status: "connected",
      grantedScopes: args.grantedScopes
        ? cleanScopes(args.grantedScopes)
        : connection.grantedScopes,
      displayLabel: cleanLabel(args.displayLabel) ?? connection.displayLabel,
      errorCode: undefined,
      statusReason: undefined,
      retryAt: undefined,
      expiresAt: args.expiresAt,
      lastHealthAt: now,
      connectedAt: connection.connectedAt ?? now,
      revokedAt: undefined,
      remoteRevocationConfirmed: undefined,
      consecutiveFailures: 0,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: account._id,
      action: "connection.connected",
      targetType: "connection",
      targetId: connection._id,
      metadata: { provider: connection.provider },
      retentionClass: "security",
    });
    return { connected: true, connectedAt: now };
  },
});

export const markFailure = mutation({
  args: {
    connectionId: v.id("connections"),
    status: recoverableStatus,
    errorCode: v.string(),
    statusReason: v.optional(v.string()),
    retryAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { account, connection } = await requireOwnedConnection(
      ctx,
      args.connectionId,
    );
    assertTransition(connection.status, args.status);
    const now = Date.now();
    await ctx.db.patch(connection._id, {
      status: args.status,
      errorCode: args.errorCode.trim().slice(0, 100),
      statusReason: args.statusReason?.trim().slice(0, 240),
      retryAt: args.retryAt,
      lastHealthAt: now,
      consecutiveFailures: connection.consecutiveFailures + 1,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: account._id,
      action: "connection.health.failed",
      targetType: "connection",
      targetId: connection._id,
      metadata: {
        provider: connection.provider,
        status: args.status,
        errorCode: args.errorCode.trim().slice(0, 100),
      },
      retentionClass: "security",
    });
    return { status: args.status, updatedAt: now };
  },
});

export const markRevoked = mutation({
  args: {
    connectionId: v.id("connections"),
    remoteRevocationConfirmed: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { account, connection } = await requireOwnedConnection(
      ctx,
      args.connectionId,
    );
    assertTransition(connection.status, "revoked");
    const now = Date.now();
    await ctx.db.patch(connection._id, {
      status: "revoked",
      errorCode: args.remoteRevocationConfirmed
        ? undefined
        : "remote_revocation_unconfirmed",
      statusReason: args.remoteRevocationConfirmed
        ? undefined
        : "Spectra removed its local access. The provider did not confirm remote revocation.",
      retryAt: undefined,
      expiresAt: undefined,
      lastHealthAt: now,
      revokedAt: now,
      remoteRevocationConfirmed: args.remoteRevocationConfirmed,
      updatedAt: now,
    });
    await writeAuditEvent(ctx, {
      actorAccountId: account._id,
      action: "connection.revoked",
      targetType: "connection",
      targetId: connection._id,
      metadata: {
        provider: connection.provider,
        remoteRevocationConfirmed: args.remoteRevocationConfirmed,
      },
      retentionClass: "security",
    });
    return { revoked: true, revokedAt: now };
  },
});

export const setHealthFromWorker = internalMutation({
  args: {
    connectionId: v.id("connections"),
    status: v.union(
      v.literal("connected"),
      v.literal("expired"),
      v.literal("rate_limited"),
      v.literal("revoked"),
      v.literal("error"),
    ),
    errorCode: v.optional(v.string()),
    statusReason: v.optional(v.string()),
    retryAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return { updated: false };
    assertTransition(connection.status, args.status);
    const now = Date.now();
    await ctx.db.patch(connection._id, {
      status: args.status,
      errorCode: args.errorCode?.slice(0, 100),
      statusReason: args.statusReason?.slice(0, 240),
      retryAt: args.retryAt,
      expiresAt: args.expiresAt,
      lastHealthAt: now,
      connectedAt:
        args.status === "connected"
          ? (connection.connectedAt ?? now)
          : connection.connectedAt,
      revokedAt: args.status === "revoked" ? now : undefined,
      consecutiveFailures:
        args.status === "connected" ? 0 : connection.consecutiveFailures + 1,
      updatedAt: now,
    });
    return { updated: true };
  },
});

export const sweepStalledHealth = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expiring = await ctx.db
      .query("connections")
      .withIndex("by_status_expiry", (q) =>
        q.eq("status", "connected").lt("expiresAt", now),
      )
      .take(PAGE_SIZE);
    for (const connection of expiring) {
      await ctx.db.patch(connection._id, {
        status: "expired",
        errorCode: "token_expired",
        statusReason: "The provider access token expired.",
        retryAt: now,
        lastHealthAt: now,
        consecutiveFailures: connection.consecutiveFailures + 1,
        updatedAt: now,
      });
    }
    const stalledCutoff = now - STALLED_COMPENSATION_MS;
    const [expired, rateLimited] = await Promise.all([
      ctx.db
        .query("connections")
        .withIndex("by_status_retry", (q) =>
          q.eq("status", "expired").lt("retryAt", stalledCutoff),
        )
        .take(PAGE_SIZE),
      ctx.db
        .query("connections")
        .withIndex("by_status_retry", (q) =>
          q.eq("status", "rate_limited").lt("retryAt", stalledCutoff),
        )
        .take(PAGE_SIZE),
    ]);
    for (const connection of [...expired, ...rateLimited]) {
      await ctx.db.patch(connection._id, {
        status: "error",
        errorCode:
          connection.status === "expired"
            ? "token_refresh_stalled"
            : "rate_limit_retry_stalled",
        statusReason:
          connection.status === "expired"
            ? "Automatic token refresh did not finish."
            : "The scheduled provider retry did not finish.",
        retryAt: undefined,
        lastHealthAt: now,
        consecutiveFailures: connection.consecutiveFailures + 1,
        updatedAt: now,
      });
    }
    return {
      expired: expiring.length,
      compensated: expired.length + rateLimited.length,
    };
  },
});

export type ConnectionFamily = ConnectorFamily;
