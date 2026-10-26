/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const operator = { subject: "recovery-operator", email: "operator@example.test", emailVerified: true };
const admin = { subject: "recovery-admin", email: "replacement@example.test", emailVerified: true };

async function fixture() {
  const t = convexTest(schema, modules);
  for (const identity of [operator, admin])
    await t.withIdentity(identity).mutation(api.identity.registerSelf, { name: identity.subject });
  const asOperator = t.withIdentity(operator);
  const school = await asOperator.mutation(api.schools.create, {
    name: "Recovery School", slug: "recovery-school", timezone: "Europe/Madrid",
    verifiedDomains: ["example.test"], initialAdminEmail: "old@example.test",
    tokenHash: "old-token-hash".repeat(3), idempotencyKey: "recovery-school-onboarding",
  });
  return { t, asOperator, school };
}

beforeEach(() => vi.stubEnv("SUPER_ADMIN_EMAILS", operator.email));
afterEach(() => vi.unstubAllEnvs());

describe("initial school administrator invitation recovery", () => {
  it("revokes a lost link, changes the administrator, and lets the replacement complete onboarding", async () => {
    const { t, asOperator, school } = await fixture();
    const replacement = await asOperator.mutation(api.schools.recoverOnboardingInvitation, {
      sagaId: school.sagaId, initialAdminEmail: admin.email, tokenHash: "new-token-hash".repeat(3),
    });
    expect(await t.run((ctx) => ctx.db.get(school.invitationId!))).toMatchObject({ status: "revoked" });
    expect(await t.run((ctx) => ctx.db.get(replacement.invitationId))).toMatchObject({ email: admin.email, status: "pending" });
    expect(await t.run((ctx) => ctx.db.get(school.sagaId))).toMatchObject({ invitationId: replacement.invitationId, initialAdminEmail: admin.email });
    await expect(t.withIdentity(admin).mutation(api.memberships.acceptInvitation, { tokenHash: "old-token-hash".repeat(3) })).rejects.toThrow("INVITATION");
    await t.withIdentity(admin).mutation(api.memberships.acceptInvitation, { tokenHash: "new-token-hash".repeat(3) });
    expect(await t.run((ctx) => ctx.db.get(school.sagaId))).toMatchObject({ status: "ready" });
    await expect(asOperator.mutation(api.schools.recoverOnboardingInvitation, {
      sagaId: school.sagaId, initialAdminEmail: "another@example.test", tokenHash: "x".repeat(43),
    })).rejects.toThrow("already completed");
  });

  it("resumes a cancelled school without duplicating its school or limits", async () => {
    const { t, asOperator, school } = await fixture();
    await asOperator.mutation(api.schools.cancelOnboarding, { sagaId: school.sagaId, reason: "Lost administrator invitation" });
    expect(await t.run((ctx) => ctx.db.get(school.schoolId))).toMatchObject({ status: "archived" });
    await asOperator.mutation(api.schools.recoverOnboardingInvitation, {
      sagaId: school.sagaId, initialAdminEmail: admin.email, tokenHash: "x".repeat(43),
    });
    expect(await t.run((ctx) => ctx.db.get(school.schoolId))).toMatchObject({ status: "active" });
    const resumed = await t.run((ctx) => ctx.db.get(school.sagaId));
    expect(resumed).toMatchObject({ status: "invited" });
    expect(resumed?.errorSummary).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query("schools").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("limitPolicies").collect())).toHaveLength(1);
  });

  it("requires an operator and preserves the invitation when the replacement violates school domains", async () => {
    const { t, asOperator, school } = await fixture();
    const args = { sagaId: school.sagaId, initialAdminEmail: admin.email, tokenHash: "x".repeat(43) };
    await expect(t.withIdentity(admin).mutation(api.schools.recoverOnboardingInvitation, args)).rejects.toThrow("Platform operator access");
    await expect(asOperator.mutation(api.schools.recoverOnboardingInvitation, { ...args, initialAdminEmail: "admin@other.test" })).rejects.toThrow("verified school domain");
    expect(await t.run((ctx) => ctx.db.get(school.invitationId!))).toMatchObject({ status: "pending" });
  });

  it("refuses recovery if someone joined even when the onboarding record is still pending", async () => {
    const { t, asOperator, school } = await fixture();
    await t.run(async (ctx) => {
      const account = await ctx.db.query("accounts").withIndex("by_clerk_id", (q) => q.eq("clerkId", admin.subject)).unique();
      const now = Date.now();
      await ctx.db.insert("schoolMemberships", { schoolId: school.schoolId, accountId: account!._id, role: "teacher", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    });
    await expect(asOperator.mutation(api.schools.recoverOnboardingInvitation, {
      sagaId: school.sagaId, initialAdminEmail: admin.email, tokenHash: "x".repeat(43),
    })).rejects.toThrow("already joined");
    expect(await t.run((ctx) => ctx.db.get(school.invitationId!))).toMatchObject({ status: "pending" });
  });
});
