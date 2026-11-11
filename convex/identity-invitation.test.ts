/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

async function invitation(t: ReturnType<typeof convexTest>, email: string, fields: { status?: "pending" | "revoked"; expiresAt?: number } = {}) {
  await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Gate School", slug: `gate-${crypto.randomUUID()}`, verifiedDomains: [], status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now });
    const inviter = await ctx.db.insert("accounts", { clerkId: `inviter-${crypto.randomUUID()}`, email: `inviter-${crypto.randomUUID()}@example.test`, emailVerified: true, name: "Inviter", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("membershipInvitations", {
      schoolId, email, role: "student", tokenHash: crypto.randomUUID(), status: fields.status ?? "pending",
      invitedByAccountId: inviter, expiresAt: fields.expiresAt ?? now + 86_400_000, createdAt: now, updatedAt: now,
    });
  });
}

const person = (email: string) => ({ subject: `user-${email}`, email, emailVerified: true });

afterEach(() => vi.unstubAllEnvs());

describe("sign-up is by invitation", () => {
  it("refuses a new account whose email nobody invited", async () => {
    const t = convexTest(schema, modules);
    await invitation(t, "someone-else@example.test");
    await expect(t.withIdentity(person("stranger@example.test")).mutation(api.identity.registerSelf, {})).rejects.toThrow("IDENTITY_NOT_INVITED");
    expect(await t.run((ctx) => ctx.db.query("accounts").withIndex("by_email", (q) => q.eq("email", "stranger@example.test")).first())).toBeNull();
  });

  it("refuses an expired or withdrawn invitation", async () => {
    const t = convexTest(schema, modules);
    await invitation(t, "late@example.test", { expiresAt: Date.now() - 1 });
    await invitation(t, "withdrawn@example.test", { status: "revoked" });
    await expect(t.withIdentity(person("late@example.test")).mutation(api.identity.registerSelf, {})).rejects.toThrow("IDENTITY_NOT_INVITED");
    await expect(t.withIdentity(person("withdrawn@example.test")).mutation(api.identity.registerSelf, {})).rejects.toThrow("IDENTITY_NOT_INVITED");
  });

  it("makes the account for the exact invited email, whatever its case", async () => {
    const t = convexTest(schema, modules);
    await invitation(t, "invited@example.test");
    expect(await t.withIdentity(person("Invited@Example.test")).mutation(api.identity.registerSelf, {})).toBeTruthy();
  });

  it("lets a platform operator in without an invitation", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "operator@example.test");
    const t = convexTest(schema, modules);
    expect(await t.withIdentity(person("operator@example.test")).mutation(api.identity.registerSelf, {})).toBeTruthy();
  });

  it("keeps an existing account working after its invitation is used", async () => {
    const t = convexTest(schema, modules);
    await invitation(t, "member@example.test");
    const identity = t.withIdentity(person("member@example.test"));
    const id = await identity.mutation(api.identity.registerSelf, {});
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("membershipInvitations").collect()) await ctx.db.patch(row._id, { status: "accepted" });
    });
    expect(await identity.mutation(api.identity.registerSelf, {})).toBe(id);
  });
});
