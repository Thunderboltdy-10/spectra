/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { connectionSecretPurpose } from "../src/features/spectra/connectors/core/secret-purpose";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "clerk_connections_owner",
  email: "connections-owner@example.test",
  emailVerified: true,
};

async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Connection School",
      slug: `connection-school-${crypto.randomUUID()}`,
      verifiedDomains: [],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject,
      email: identity.email,
      emailVerified: true,
      name: "Connection Owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId,
      schoolId,
      role: "school_admin",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const connectionId = await ctx.db.insert("connections", {
      scopeKind: "account",
      scopeKey: `account:${accountId}`,
      accountId,
      provider: "recorded-oauth",
      providerAccountId: "provider-user-1",
      displayLabel: "Recorded account",
      family: "file-sync",
      authKind: "oauth",
      status: "error",
      grantedScopes: ["files.read"],
      errorCode: "authorization_incomplete",
      retryAt: now + 60_000,
      consecutiveFailures: 0,
      createdByAccountId: accountId,
      createdAt: now,
      updatedAt: now,
    });
    const secretPurpose = connectionSecretPurpose(
      "recorded-oauth",
      String(connectionId),
    );
    await ctx.db.patch(connectionId, { secretPurpose });
    const deviceId = await ctx.db.insert("bridgeDevices", {
      accountId,
      name: "Study PC",
      platform: "windows",
      credentialHash: "credential-hash",
      protocolVersion: "1.0",
      appVersion: "1.0",
      pairedAt: now,
      lastSeenAt: now,
      state: "active",
    });
    await ctx.db.insert("bridgeMounts", {
      accountId,
      deviceId,
      rootLabel: "Schoolwork",
      grantId: "grant_deadbeef",
      rootKey: "a".repeat(64),
      state: "active",
      fileCount: 3,
      doubleSyncRisk: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolIntegrations", {
      schoolId,
      provider: "managebac",
      baseUrl: "https://api.managebac.com",
      authHeaderName: "auth-token",
      authScheme: "raw",
      status: "connected",
      tokenMode: "read_only",
      secretPurpose: "managebac-api-token",
      manifestVersion: 1,
      capabilityCoverage: {
        discovered: 1,
        verifiedReadable: 1,
        unverified: 0,
        failed: 0,
        quarantined: 0,
      },
      syncPolicy: {
        frequencyMinutes: 180,
        autoCreateClasses: true,
        autoImportTasks: true,
        autoApplySafeUpdates: true,
        conflictMode: "review",
      },
      freshnessSlaMinutes: 200,
      requestBudgetPerMinute: 180,
      bootstrapVersion: 1,
      lastValidatedAt: now,
      createdByAccountId: accountId,
      updatedByAccountId: accountId,
      createdAt: now,
      updatedAt: now,
    });
    return { accountId, schoolId, connectionId, secretPurpose };
  });
}

describe("connection model", () => {
  it("presents stored, Bridge, and ManageBac connections without token material", async () => {
    const t = convexTest(schema, modules);
    await seed(t);
    const overview = await t
      .withIdentity(identity)
      .query(api.connections.overview, {});
    expect(overview).toMatchObject({
      connections: [
        expect.objectContaining({
          provider: "recorded-oauth",
          status: "error",
          authKind: "oauth",
        }),
      ],
      bridge: {
        mountCount: 1,
        devices: [expect.objectContaining({ name: "Study PC", mountCount: 1 })],
      },
      manageBac: {
        configured: true,
        status: "connected",
        canManage: true,
      },
    });
    expect(JSON.stringify(overview)).not.toContain("credential-hash");
    expect(JSON.stringify(overview)).not.toContain("secretPurpose");
  });

  it("stores an account OAuth envelope only under its provider-bound purpose", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seed(t);
    await t.mutation(internal.secretStore.writeAccountEnvelope, {
      subject: identity.subject,
      accountId: String(fixture.accountId),
      purpose: fixture.secretPurpose,
      label: "Recorded token",
      ciphertext: "ciphertext",
      nonce: "nonce",
      authTag: "tag",
      keyVersion: 1,
      fingerprint: "fingerprint",
    });
    const truth = await t.run(async (ctx) => ({
      connection: await ctx.db.get(fixture.connectionId),
      secrets: await ctx.db.query("secretRecords").collect(),
    }));
    expect(truth.connection).not.toHaveProperty("accessToken");
    expect(truth.connection).not.toHaveProperty("refreshToken");
    expect(truth.secrets).toEqual([
      expect.objectContaining({
        accountId: fixture.accountId,
        purpose: fixture.secretPurpose,
        status: "active",
      }),
    ]);
    await expect(
      t.mutation(internal.secretStore.writeAccountEnvelope, {
        subject: identity.subject,
        accountId: String(fixture.accountId),
        purpose: "connector:other:bad:oauth-token",
        label: "Wrong token",
        ciphertext: "ciphertext",
        nonce: "nonce",
        authTag: "tag",
        keyVersion: 1,
        fingerprint: "fingerprint",
      }),
    ).rejects.toThrow("SECRET_USE_FORBIDDEN");
  });

  it("compensates expired and stalled refresh states instead of leaving them stranded", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seed(t);
    await t.run(async (ctx) =>
      ctx.db.patch(fixture.connectionId, {
        status: "connected",
        errorCode: undefined,
        retryAt: undefined,
        expiresAt: Date.now() - 1,
      }),
    );
    const first = await t.mutation(internal.connections.sweepStalledHealth, {});
    expect(first.expired).toBe(1);
    let row = await t.run(async (ctx) => ctx.db.get(fixture.connectionId));
    expect(row).toMatchObject({
      status: "expired",
      errorCode: "token_expired",
    });

    await t.run(async (ctx) =>
      ctx.db.patch(fixture.connectionId, {
        retryAt: Date.now() - 16 * 60_000,
      }),
    );
    const second = await t.mutation(
      internal.connections.sweepStalledHealth,
      {},
    );
    expect(second.compensated).toBe(1);
    row = await t.run(async (ctx) => ctx.db.get(fixture.connectionId));
    expect(row).toMatchObject({
      status: "error",
      errorCode: "token_refresh_stalled",
    });
  });
});
