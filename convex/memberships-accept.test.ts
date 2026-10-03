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
      outcome: "available",
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

  it("answers an unknown, revoked or expired link with an unavailable outcome instead of an error", async () => {
    const t = convexTest(schema, modules);
    const identity = {
      subject: "clerk_lv003_preview",
      email: "lv003-preview@example.test",
      emailVerified: true,
    };
    await t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", {
        name: "LV-003 School",
        slug: `lv003-${crypto.randomUUID()}`,
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
        name: "LV-003 Invitee",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      for (const [tokenHash, status, expiresAt] of [
        ["lv003-revoked", "revoked", now + 86_400_000],
        ["lv003-expired", "pending", now - 1],
      ] as const)
        await ctx.db.insert("membershipInvitations", {
          schoolId,
          email: identity.email,
          role: "student",
          tokenHash,
          status,
          invitedByAccountId: accountId,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        });
    });
    const asUser = t.withIdentity(identity);
    const preview = (tokenHash: string) =>
      asUser.query(api.memberships.previewInvitation, { tokenHash });
    await expect(preview("lv003-unknown")).resolves.toEqual({
      outcome: "unavailable",
      reason: "invalid",
      message: "This invitation is unavailable.",
    });
    await expect(preview("lv003-revoked")).resolves.toMatchObject({
      outcome: "unavailable",
      reason: "invalid",
    });
    await expect(preview("lv003-expired")).resolves.toEqual({
      outcome: "unavailable",
      reason: "expired",
      message: "This invitation has expired.",
    });
    await expect(
      t.query(api.memberships.previewInvitation, { tokenHash: "lv003-unknown" }),
    ).rejects.toThrow("AUTH_NOT_SIGNED_IN");
  });

  it("previews a mismatch but refuses acceptance for the wrong account", async () => {
    const t = convexTest(schema, modules);
    const invitedIdentity = {
      subject: "clerk_w2_14_invited",
      email: "invited-w2-14@example.test",
      emailVerified: true,
    };
    const wrongIdentity = {
      subject: "clerk_w2_14_wrong",
      email: "wrong-w2-14@example.test",
      emailVerified: true,
    };
    const fixture = await t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", {
        name: "W2-14 Wrong Account School",
        slug: `wrong-account-${crypto.randomUUID()}`,
        verifiedDomains: [],
        status: "active",
        timezone: "Europe/Madrid",
        policyVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      const invitedAccountId = await ctx.db.insert("accounts", {
        clerkId: invitedIdentity.subject,
        email: invitedIdentity.email,
        emailVerified: true,
        name: "Invited W2-14",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("accounts", {
        clerkId: wrongIdentity.subject,
        email: wrongIdentity.email,
        emailVerified: true,
        name: "Wrong W2-14",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const invitationId = await ctx.db.insert("membershipInvitations", {
        schoolId,
        email: invitedIdentity.email,
        role: "student",
        tokenHash: "wrong-account-hash",
        status: "pending",
        invitedByAccountId: invitedAccountId,
        expiresAt: now + 86_400_000,
        createdAt: now,
        updatedAt: now,
      });
      return { invitationId };
    });
    const asWrongUser = t.withIdentity(wrongIdentity);
    await expect(
      asWrongUser.query(api.memberships.previewInvitation, {
        tokenHash: "wrong-account-hash",
      }),
    ).resolves.toMatchObject({
      emailMatches: false,
      alreadyMember: false,
    });
    await expect(
      asWrongUser.mutation(api.memberships.acceptInvitation, {
        tokenHash: "wrong-account-hash",
      }),
    ).rejects.toThrow("INVITATION_EMAIL_MISMATCH");
    const invitation = await t.run(async (ctx) =>
      ctx.db.get(fixture.invitationId),
    );
    expect(invitation?.status).toBe("pending");
  });

  it("expires an invitation during acceptance and leaves no membership", async () => {
    const t = convexTest(schema, modules);
    const expiredIdentity = {
      subject: "clerk_w2_14_expired",
      email: "expired-w2-14@example.test",
      emailVerified: true,
    };
    const fixture = await t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", {
        name: "W2-14 Expired School",
        slug: `expired-${crypto.randomUUID()}`,
        verifiedDomains: [],
        status: "active",
        timezone: "Europe/Madrid",
        policyVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      const accountId = await ctx.db.insert("accounts", {
        clerkId: expiredIdentity.subject,
        email: expiredIdentity.email,
        emailVerified: true,
        name: "Expired W2-14",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const invitationId = await ctx.db.insert("membershipInvitations", {
        schoolId,
        email: expiredIdentity.email,
        role: "student",
        tokenHash: "expired-hash",
        status: "pending",
        invitedByAccountId: accountId,
        expiresAt: now - 1,
        createdAt: now,
        updatedAt: now,
      });
      return { invitationId, accountId };
    });
    const asExpiredUser = t.withIdentity(expiredIdentity);
    await expect(
      asExpiredUser.mutation(api.memberships.acceptInvitation, {
        tokenHash: "expired-hash",
      }),
    ).resolves.toMatchObject({ expired: true });
    const result = await t.run(async (ctx) => ({
      invitation: await ctx.db.get(fixture.invitationId),
      memberships: await ctx.db
        .query("schoolMemberships")
        .withIndex("by_account", (q) => q.eq("accountId", fixture.accountId))
        .collect(),
    }));
    expect(result.invitation?.status).toBe("expired");
    expect(result.memberships).toHaveLength(0);
  });
});
