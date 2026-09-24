/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => vi.unstubAllEnvs());

describe("onboarding cancellation membership boundary", () => {
  it("rejects an active member after inactive history and permits cancellation after that member leaves", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "platform-fixture@example.test");
    const identity = { subject: "platform-fixture", email: "platform-fixture@example.test", emailVerified: true };
    const t = convexTest(schema, modules);
    const otherAccount = await t.run(async ctx => {
      const now = Date.now();
      await ctx.db.insert("accounts", {
        clerkId: identity.subject, email: identity.email, emailVerified: true,
        name: "Operator fixture", status: "active", createdAt: now, updatedAt: now,
      });
      return ctx.db.insert("accounts", {
        clerkId: "school-member-fixture", email: "school-member@example.test", emailVerified: true,
        name: "Member fixture", status: "active", createdAt: now, updatedAt: now,
      });
    });
    const user = t.withIdentity(identity);
    const school = await user.mutation(api.schools.create, {
      name: "Bounded onboarding", slug: "bounded-onboarding", timezone: "Europe/Madrid",
      initialAdminEmail: "admin@example.test", tokenHash: "fixture-token-hash",
      idempotencyKey: "bounded-onboarding-fixture",
    });
    const activeId = await t.run(async ctx => {
      const now = Date.now();
      const membership = {
        accountId: otherAccount, schoolId: school.schoolId, role: "school_admin" as const,
        joinedAt: now, createdAt: now, updatedAt: now,
      };
      for (let index = 0; index < 300; index++)
        await ctx.db.insert("schoolMemberships", { ...membership, status: "suspended" });
      return ctx.db.insert("schoolMemberships", { ...membership, status: "active" });
    });
    const args = { sagaId: school.sagaId, reason: "Disposable fixture cancellation" };
    await expect(user.mutation(api.schools.cancelOnboarding, args)).rejects.toThrow("SCHOOL_ONBOARDING_NOT_REVERSIBLE");
    expect((await t.run(ctx => ctx.db.get(school.schoolId)))?.status).toBe("active");
    await t.run(ctx => ctx.db.patch(activeId, { status: "suspended" }));
    expect(await user.mutation(api.schools.cancelOnboarding, args)).toEqual({ sagaId: school.sagaId, status: "cancelled" });
    expect((await t.run(ctx => ctx.db.get(school.schoolId)))?.status).toBe("archived");
  });
});
