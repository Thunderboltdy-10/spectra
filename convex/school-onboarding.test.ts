/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

describe("school onboarding fixture", () => {
  it("creates the school, limits, admin invite, and resumable saga exactly once", async () => {
    vi.stubEnv("SUPER_ADMIN_EMAILS", "operator@example.test");
    try {
      const t = convexTest(schema, modules);
      const identity = {
        subject: "clerk_w3_07_operator",
        email: "operator@example.test",
        emailVerified: true,
      };
      await t.run(async (ctx) => {
        const now = Date.now();
        await ctx.db.insert("accounts", {
          clerkId: identity.subject,
          email: identity.email,
          emailVerified: true,
          name: "Wave 3 Operator",
          status: "active",
          createdAt: now,
          updatedAt: now,
        });
      });

      const idempotencyKey = `w3-07-school-${crypto.randomUUID()}`;
      const args = {
        name: "Wave 3 Fixture School",
        slug: `w3-07-${crypto.randomUUID()}`,
        timezone: "Europe/Madrid",
        verifiedDomains: ["example.test"],
        initialAdminEmail: "admin@example.test",
        tokenHash: "w3-07-token-hash",
        idempotencyKey,
        requestId: "LA-W3-07-school-onboarding",
      };

      const asOperator = t.withIdentity(identity);
      const first = await asOperator.mutation(api.schools.create, args);
      expect(first.status).toBe("invited");
      expect(first.duplicate).toBe(false);

      const duplicate = await asOperator.mutation(api.schools.create, args);
      expect(duplicate).toEqual({ ...first, duplicate: true });

      const persisted = await t.run(async (ctx) => {
        const school = await ctx.db.get(first.schoolId);
        const invitation = first.invitationId
          ? await ctx.db.get(first.invitationId)
          : null;
        const saga = await ctx.db.get(first.sagaId);
        const policies = (await ctx.db.query("limitPolicies").collect()).filter(
          (policy) => policy.schoolId === first.schoolId,
        );
        const invitations = (await ctx.db.query("membershipInvitations").collect()).filter(
          (record) => record.schoolId === first.schoolId,
        );
        const sagas = (await ctx.db.query("schoolOnboardingSagas").collect()).filter(
          (record) => record.schoolId === first.schoolId,
        );
        return { school, invitation, saga, policies, invitations, sagas };
      });

      expect(persisted.school?.status).toBe("active");
      expect(persisted.school?.verifiedDomains).toEqual(["example.test"]);
      expect(persisted.invitation).toMatchObject({
        email: "admin@example.test",
        role: "school_admin",
        status: "pending",
      });
      expect(persisted.policies).toHaveLength(1);
      expect(persisted.policies[0]?.enforcement).toBe("disabled");
      expect(persisted.invitations).toHaveLength(1);
      expect(persisted.sagas).toHaveLength(1);
      expect(persisted.saga?.completedSteps).toEqual([
        "identity_reserved",
        "capability_charter_applied",
        "limits_created",
        "admin_invited",
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
