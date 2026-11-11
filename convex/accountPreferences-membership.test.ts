/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

/** Spectra is invitation-only: a new account needs a live invitation to its email. */
async function invite(t: ReturnType<typeof convexTest>, ...emails: string[]) {
  await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Invite School", slug: `invite-${crypto.randomUUID()}`, verifiedDomains: [], status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now });
    const inviter = await ctx.db.insert("accounts", { clerkId: `inviter-${crypto.randomUUID()}`, email: `inviter-${crypto.randomUUID()}@example.test`, emailVerified: true, name: "Inviter", status: "active", createdAt: now, updatedAt: now });
    for (const email of emails)
      await ctx.db.insert("membershipInvitations", { schoolId, email, role: "student", tokenHash: crypto.randomUUID(), status: "pending", invitedByAccountId: inviter, expiresAt: now + 86_400_000, createdAt: now, updatedAt: now });
  });
}

const args = { scope: "device" as const, scopeKey: "device-one", values: { appearance: { density: "compact" } } };

async function fixture() {
  const t = convexTest(schema, modules);
  await invite(t, "new@example.test", "other@example.test");
  const account = t.withIdentity({ subject: "new-user", email: "new@example.test", emailVerified: true });
  return { t, account };
}

describe("account preferences before joining a school", () => {
  it("distinguishes registration pending from an account with no saved preferences", async () => {
    const { account } = await fixture();
    expect(await account.query(api.accountPreferences.layers, { deviceId: "device-one" })).toBeNull();
    await account.mutation(api.identity.registerSelf, {});
    expect(await account.query(api.accountPreferences.layers, { deviceId: "device-one" })).toEqual([]);
  });

  it("persists device and account layers without school membership and keeps them private", async () => {
    const { t, account } = await fixture();
    await account.mutation(api.identity.registerSelf, {});
    await account.mutation(api.accountPreferences.writeLayer, args);
    await account.mutation(api.accountPreferences.writeLayer, { scope: "account", scopeKey: "account", values: { writing: { smartCompletion: false } } });
    const layers = await account.query(api.accountPreferences.layers, { deviceId: "device-one" });
    expect(layers).toHaveLength(2);
    expect(layers?.find(layer => layer.scope === "device")?.values).toMatchObject(args.values);
    expect(layers?.find(layer => layer.scope === "account")?.values).toMatchObject({ writing: { smartCompletion: false } });
    const other = t.withIdentity({ subject: "other-user", email: "other@example.test", emailVerified: true });
    await other.mutation(api.identity.registerSelf, {});
    expect(await other.query(api.accountPreferences.layers, { deviceId: "device-one" })).toEqual([]);
  });

  it("still rejects unregistered and inactive accounts", async () => {
    const { t, account } = await fixture();
    await expect(account.mutation(api.accountPreferences.writeLayer, args)).rejects.toThrow("AUTH_ACCOUNT_REQUIRED");
    const id = await account.mutation(api.identity.registerSelf, {});
    const unverified = t.withIdentity({ subject: "new-user", email: "new@example.test", emailVerified: false });
    await expect(unverified.mutation(api.accountPreferences.writeLayer, args)).rejects.toThrow("AUTH_EMAIL_UNVERIFIED");
    await t.run(ctx => ctx.db.patch(id, { status: "deactivated" }));
    await expect(account.mutation(api.accountPreferences.writeLayer, args)).rejects.toThrow("AUTH_ACCOUNT_REQUIRED");
    expect(await account.query(api.accountPreferences.layers, { deviceId: "device-one" })).toBeNull();
  });
});
