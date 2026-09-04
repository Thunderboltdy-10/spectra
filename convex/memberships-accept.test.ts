/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "clerk_p6i4_invite",
  email: "invitee@example.test",
  emailVerified: true,
};

describe("school invitation accept is idempotent", () => {
  it("returns alreadyMember when the same person opens an already-accepted invite", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", {
        name: "P6 I4 School",
        slug: `p6-i4-${crypto.randomUUID()}`,
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
        name: "Invitee",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const membershipId = await ctx.db.insert("schoolMemberships", {
        accountId,
        schoolId,
        role: "student",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const invitationId = await ctx.db.insert("membershipInvitations", {
        schoolId,
        email: identity.email,
        role: "student",
        tokenHash: "invite-hash",
        status: "accepted",
        invitedByAccountId: accountId,
        expiresAt: now + 86_400_000,
        createdAt: now,
        updatedAt: now,
      });
      return { schoolId, membershipId, invitationId };
    });
    const asUser = t.withIdentity(identity);
    const result = await asUser.mutation(api.memberships.acceptInvitation, {
      tokenHash: "invite-hash",
    });
    expect(result).toEqual({
      membershipId: fixture.membershipId,
      schoolId: fixture.schoolId,
      alreadyMember: true,
    });
    const invitation = await t.run(async (ctx) =>
      ctx.db.get(fixture.invitationId),
    );
    expect(invitation?.status).toBe("accepted");
  });

  it("previews school name and role without accepting", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", {
        name: "The Global College",
        slug: `preview-${crypto.randomUUID()}`,
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
        name: "Invitee",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("membershipInvitations", {
        schoolId,
        email: identity.email,
        role: "school_admin",
        tokenHash: "preview-hash",
        status: "pending",
        invitedByAccountId: accountId,
        expiresAt: now + 86_400_000,
        createdAt: now,
        updatedAt: now,
      });
    });
    const asUser = t.withIdentity(identity);
    const preview = await asUser.query(api.memberships.previewInvitation, {
      tokenHash: "preview-hash",
    });
    expect(preview).toMatchObject({
      schoolName: "The Global College",
      role: "school_admin",
      emailMatches: true,
      alreadyMember: false,
    });
    const invitation = await t.run(async (ctx) =>
      ctx.db
        .query("membershipInvitations")
        .withIndex("by_token_hash", (q) => q.eq("tokenHash", "preview-hash"))
        .unique(),
    );
    expect(invitation?.status).toBe("pending");
  });
});
