/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import { ownedStoredWorks } from "./bridgeSync";
import { observeDatabase } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");
const credential = "bridge-devices-test-credential-000001";
const identity = {
  subject: "clerk_bridge_devices", issuer: "https://clerk.test", tokenIdentifier: "clerk|bridge_devices",
  email: "devices@example.test", emailVerified: true,
};

function setupTest() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}

async function seedDevice(t: ReturnType<typeof setupTest>) {
  return t.run(async (ctx) => {
    const now = Date.now() - 10 * 60_000;
    const schoolId = await ctx.db.insert("schools", {
      name: "Devices School", slug: `devices-${crypto.randomUUID()}`, verifiedDomains: [], status: "active",
      timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: identity.subject, email: "devices@example.test", emailVerified: true, name: "Devices",
      status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
    });
    const credentialHash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential))),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const deviceId = await ctx.db.insert("bridgeDevices", {
      accountId, name: "Studio PC", platform: "windows", credentialHash, protocolVersion: "1.0",
      appVersion: "0.1.0", pairedAt: now, lastSeenAt: now, state: "active",
    });
    return { accountId, deviceId, schoolId, pairedAt: now };
  });
}

describe("Bridge device health", () => {
  it("returns the verified hub owner with its existing ticket response", async () => {
    const t = setupTest();
    const { accountId } = await seedDevice(t);
    try {
      vi.stubEnv("SPECTRA_AGENT_HUB_URL", "");
      vi.stubEnv("SPECTRA_COLLAB_BRIDGE_KEY", "fixture-only-hub-key");
      expect(await t.mutation(api.bridgeSync.agentHubTicket, { credential })).toEqual({ url: null, ticket: null, accountId });
      vi.stubEnv("SPECTRA_AGENT_HUB_URL", "wss://fixture-hub");
      const ticket = await t.mutation(api.bridgeSync.agentHubTicket, { credential });
      expect(ticket.accountId).toBe(accountId);
      expect(ticket.url).toBe("wss://fixture-hub");
      const body = ticket.ticket!.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
      expect(JSON.parse(atob(body))).toMatchObject({ sub: accountId, aud: "spectra-agent-hub" });
      await expect(t.mutation(api.bridgeSync.agentHubTicket, { credential: "invalid-bridge-devices-credential-000000000" })).rejects.toThrow("BRIDGE_CREDENTIAL_INVALID");
    } finally { vi.unstubAllEnvs(); }
  });
  it("authorizes only the caller's exact active local device", async () => {
    const t = setupTest();
    const { deviceId, accountId, schoolId } = await seedDevice(t);
    expect(await t.query(api.bridge.localRelayAccount, { deviceId })).toBeNull();
    expect(await t.withIdentity(identity).query(api.bridge.localRelayAccount, { deviceId })).toBe(String(accountId));
    await t.run(async ctx => {
      const now = Date.now();
      const otherId = await ctx.db.insert("accounts", { clerkId: "other-owner", email: "other@example.test", emailVerified: true, name: "Other", status: "active", createdAt: now, updatedAt: now });
      await ctx.db.insert("schoolMemberships", { accountId: otherId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    });
    expect(await t.withIdentity({ ...identity, subject: "other-owner", tokenIdentifier: "other-owner", email: "other@example.test" }).query(api.bridge.localRelayAccount, { deviceId })).toBeNull();
    await t.run(ctx => ctx.db.patch(deviceId, { state: "revoked" }));
    expect(await t.withIdentity(identity).query(api.bridge.localRelayAccount, { deviceId })).toBeNull();
  });

  it("records what the Bridge says and moves last seen forward", async () => {
    const t = setupTest();
    const { deviceId, accountId, pairedAt } = await seedDevice(t);
    const owner = await t.mutation(api.bridge.reportHealth, {
      credential, paused: true, folders: 3, problem: "folder-unavailable",
      problemFolder: "Documents › Biology", lastSyncAt: pairedAt + 1_000, appVersion: "0.2.0",
    });
    expect(owner).toBe(String(accountId));
    const device = await t.run((ctx) => ctx.db.get(deviceId));
    expect(device?.lastSeenAt).toBeGreaterThan(pairedAt);
    expect(device?.appVersion).toBe("0.2.0");
    expect(device?.health).toMatchObject({
      paused: true, folders: 3, problem: "folder-unavailable", problemFolder: "Documents › Biology",
      lastSyncAt: pairedAt + 1_000,
    });

    const overview = await t.withIdentity(identity).query(api.bridge.overview, {});
    expect(overview?.devices).toHaveLength(1);
    expect(overview?.devices[0]).toMatchObject({ name: "Studio PC", health: { paused: true, folders: 3 } });
    expect(overview?.devices[0]).not.toHaveProperty("credentialHash");
  });

  it("clears a problem once the Bridge stops reporting one", async () => {
    const t = setupTest();
    const { deviceId } = await seedDevice(t);
    await t.mutation(api.bridge.reportHealth, { credential, paused: false, folders: 1, problem: "folder-error", appVersion: "0.1.0" });
    await t.mutation(api.bridge.reportHealth, { credential, paused: false, folders: 1, appVersion: "0.1.0" });
    expect((await t.run((ctx) => ctx.db.get(deviceId)))?.health?.problem).toBeUndefined();
  });

  it("rejects a removed device so its Bridge forgets itself", async () => {
    const t = setupTest();
    const { deviceId } = await seedDevice(t);
    await t.withIdentity(identity).mutation(api.bridge.revokeDevice, { deviceId });
    await expect(
      t.mutation(api.bridge.reportHealth, { credential, paused: false, folders: 0, appVersion: "0.1.0" }),
    ).rejects.toThrow("BRIDGE_CREDENTIAL_INVALID");
  });

  it("refuses malformed problem codes", async () => {
    const t = setupTest();
    await seedDevice(t);
    await expect(
      t.mutation(api.bridge.reportHealth, { credential, paused: false, folders: 0, problem: "Not A Code", appVersion: "0.1.0" }),
    ).rejects.toThrow();
  });
});

describe("Bridge retained-work ownership", () => {
  it("keeps current ownership checks independent of the artifact body size", async () => {
    const t = setupTest();
    const { accountId } = await seedDevice(t);
    const workId = await t.run(async ctx => {
      const now = Date.now();
      const id = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, blueprintKey: "document", title: "Large local work", content: {}, tags: [], status: "active", createdAt: now, updatedAt: now });
      await ctx.db.insert("spectraArtifactSummaries", { readModelVersion: 2, artifactId: id, ownerAccountId: accountId, blueprintKey: "document", status: "active", updatedAt: now, searchText: "", projection: {} });
      return id;
    });
    const handler = Reflect.get(ownedStoredWorks, "_handler") as (ctx: QueryCtx, args: { credential: string; artifactIds: string[] }) => Promise<unknown>;
    const measure = () => t.run(async ctx => {
      const observer = observeDatabase(ctx.db);
      const result = await handler({ ...ctx, db: observer.db }, { credential, artifactIds: [workId, workId] });
      return { result, ...observer.snapshot() };
    });
    const before = await measure();
    await t.run(ctx => ctx.db.patch(workId, { content: { text: "private large body ".repeat(10_000) } }));
    const after = await measure();
    expect(after.result).toEqual({ accountId, artifactIds: [workId] });
    expect(after.serializedDocumentBytes).toBe(before.serializedDocumentBytes);
    expect(after.calls).toBe(before.calls);
    expect(after.reads.filter(read => read.table === "spectraArtifactSummaries")).toHaveLength(1);
    expect(after.writes).toBe(0);
  });

  it("returns the verified owner during pairing and resumption", async () => {
    const t = setupTest();
    const { accountId } = await seedDevice(t);
    const user = t.withIdentity(identity);
    const installationId = crypto.randomUUID();
    const device = { installationId, deviceName: "Ownership fixture", platform: "windows", appVersion: "0.1.0", protocolVersion: "1.0" };
    const offer = await user.mutation(api.bridge.requestPairing, { browserOrigin: "http://localhost:3000" });
    const paired = await t.mutation(api.bridge.confirmPairing, { ...device, challenge: offer.challenge, shortCode: offer.shortCode });
    expect(paired.accountId).toBe(accountId);
    const resumedOffer = await user.mutation(api.bridge.requestPairing, { browserOrigin: "http://localhost:3000" });
    const resumed = await t.mutation(api.bridge.resumePairing, { ...device, credential: paired.deviceCredential, challenge: resumedOffer.challenge, shortCode: resumedOffer.shortCode });
    expect(resumed).toMatchObject({ deviceId: paired.deviceId, accountId });
  });

  it("proves ownership from compact or legacy cloud rows without trusting local labels", async () => {
    const t = setupTest();
    const { accountId, deviceId } = await seedDevice(t);
    const ids = await t.run(async ctx => {
      const now = Date.now();
      const other = await ctx.db.insert("accounts", { clerkId: "other-store-owner", email: "other-store@example.test", name: "Other", emailVerified: true, status: "active", createdAt: now, updatedAt: now });
      const ids = [];
      for (const [owner, summary] of [[accountId, true], [accountId, false], [other, true], [other, false]] as const) {
        const id = await ctx.db.insert("spectraArtifacts", { ownerAccountId: owner, blueprintKey: "document", title: "Private", content: {}, tags: [], status: "active", createdAt: now, updatedAt: now });
        if (summary) await ctx.db.insert("spectraArtifactSummaries", { readModelVersion: 2, artifactId: id, ownerAccountId: owner, blueprintKey: "document", status: "active", updatedAt: now, searchText: "", projection: {} });
        ids.push(id);
      }
      return ids;
    });
    const args = { credential, artifactIds: [...ids, ids[0], "not-an-artifact"] };
    expect(await t.query(api.bridgeSync.ownedStoredWorks, args)).toEqual({ accountId, artifactIds: ids.slice(0, 2) });
    await expect(t.query(api.bridgeSync.ownedStoredWorks, { ...args, credential: "invalid-credential-long-enough-00001" })).rejects.toThrow("BRIDGE_CREDENTIAL_INVALID");
    await t.run(ctx => ctx.db.patch(deviceId, { state: "revoked" }));
    await expect(t.query(api.bridgeSync.ownedStoredWorks, args)).rejects.toThrow("BRIDGE_CREDENTIAL_INVALID");
  });

  it("bounds explicit migration batches before reading work rows", async () => {
    const t = setupTest();
    await seedDevice(t);
    await expect(t.query(api.bridgeSync.ownedStoredWorks, { credential, artifactIds: Array(101).fill("not-an-artifact") })).rejects.toThrow();
    expect(await t.query(api.bridgeSync.ownedStoredWorks, { credential, artifactIds: [] })).toMatchObject({ artifactIds: [] });
  });
});
