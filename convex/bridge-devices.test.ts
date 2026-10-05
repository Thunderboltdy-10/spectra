/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api } from "./_generated/api";

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
    return { accountId, deviceId, pairedAt: now };
  });
}

describe("Bridge device health", () => {
  it("records what the Bridge says and moves last seen forward", async () => {
    const t = setupTest();
    const { deviceId, pairedAt } = await seedDevice(t);
    await t.mutation(api.bridge.reportHealth, {
      credential, paused: true, folders: 3, problem: "folder-unavailable",
      problemFolder: "Documents › Biology", lastSyncAt: pairedAt + 1_000, appVersion: "0.2.0",
    });
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
