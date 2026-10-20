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


describe("ordinary-student invite → accept → class selection", () => {
  it("invites a student, accepts, selects a class subset, and gates resources by selection", async () => {
    const t = convexTest(schema, modules);
    const adminIdentity = {
      subject: "clerk_e1_admin",
      email: "admin-e1@example.test",
      emailVerified: true,
    };
    const studentIdentity = {
      subject: "clerk_e1_student",
      email: "student-e1@example.test",
      emailVerified: true,
    };

    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", {
        name: "E1 Ordinary Student School",
        slug: `e1-student-${crypto.randomUUID()}`,
        verifiedDomains: ["example.test"],
        status: "active",
        timezone: "Europe/Madrid",
        policyVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      const adminId = await ctx.db.insert("accounts", {
        clerkId: adminIdentity.subject,
        email: adminIdentity.email,
        emailVerified: true,
        name: "E1 Admin",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const studentId = await ctx.db.insert("accounts", {
        clerkId: studentIdentity.subject,
        email: studentIdentity.email,
        emailVerified: true,
        name: "E1 Student",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        accountId: adminId,
        schoolId,
        role: "school_admin",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const integrationId = await ctx.db.insert("schoolIntegrations", {
        schoolId,
        provider: "managebac",
        baseUrl: "https://e1-managebac.example.test",
        authHeaderName: "X-API-Key",
        authScheme: "raw",
        status: "connected",
        tokenMode: "read_only",
        secretPurpose: "managebac-e1",
        manifestVersion: 1,
        capabilityCoverage: {
          discovered: 1,
          verifiedReadable: 1,
          unverified: 0,
          failed: 0,
          quarantined: 0,
        },
        syncPolicy: {
          frequencyMinutes: 60,
          autoCreateClasses: false,
          autoImportTasks: true,
          autoApplySafeUpdates: true,
          conflictMode: "review",
        },
        freshnessSlaMinutes: 60,
        requestBudgetPerMinute: 30,
        bootstrapVersion: 1,
        createdByAccountId: adminId,
        updatedByAccountId: adminId,
        createdAt: now,
        updatedAt: now,
      });
      return { schoolId, adminId, studentId, integrationId };
    });

    const asAdmin = t.withIdentity(adminIdentity);
    const invite = await asAdmin.mutation(api.memberships.invite, {
      schoolId: seeded.schoolId,
      email: studentIdentity.email,
      role: "student",
      tokenHash: "e1-student-invite-hash",
      expiresAt: Date.now() + 86_400_000,
      requestId: "LA-E1-ordinary-student",
    });
    expect(invite.invitationId).toBeTruthy();

    const asStudent = t.withIdentity(studentIdentity);
    const accepted = await asStudent.mutation(api.memberships.acceptInvitation, {
      tokenHash: "e1-student-invite-hash",
    });
    expect(accepted).toMatchObject({
      schoolId: seeded.schoolId,
      alreadyMember: false,
    });

    const classIds = await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("externalIdentityMappings", {
        integrationId: seeded.integrationId,
        schoolId: seeded.schoolId,
        accountId: seeded.studentId,
        verifiedEmailHash: "e1-student-email-hash",
        status: "verified",
        matchCount: 1,
        providerUserId: "mb-student-e1",
        resolvedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const insertClass = async (providerClassId: string, title: string) => {
        await ctx.db.insert("externalRecords", {
          integrationId: seeded.integrationId,
          schoolId: seeded.schoolId,
          providerRecordId: `membership-${providerClassId}`,
          providerRecordKey: `membership:membership-${providerClassId}`,
          recordType: "membership",
          classification: "personal",
          audienceScope: "mapped_user",
          mappedAccountId: seeded.studentId,
          providerClassId,
          normalized: { title: `${title} membership` },
          payloadVersion: "v2p2",
          sourceHash: `membership-${providerClassId}-hash`,
          tombstone: false,
          fetchedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        const classRecordId = await ctx.db.insert("externalRecords", {
          integrationId: seeded.integrationId,
          schoolId: seeded.schoolId,
          providerRecordId: providerClassId,
          providerRecordKey: `class:${providerClassId}`,
          recordType: "class",
          classification: "class",
          audienceScope: "class_members",
          mappedAccountId: seeded.studentId,
          providerClassId,
          normalized: { title },
          payloadVersion: "v2p2",
          sourceHash: `${providerClassId}-hash`,
          tombstone: false,
          fetchedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert("externalRecords", {
          integrationId: seeded.integrationId,
          schoolId: seeded.schoolId,
          providerRecordId: `resource-${providerClassId}`,
          providerRecordKey: `assignment:resource-${providerClassId}`,
          recordType: "assignment",
          classification: "class",
          audienceScope: "class_members",
          providerClassId,
          normalized: { title: `${title} resource` },
          payloadVersion: "v2p2",
          sourceHash: `resource-${providerClassId}-hash`,
          tombstone: false,
          fetchedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        return classRecordId;
      };
      const selectedClassId = await insertClass("class-follow", "Follow me");
      await insertClass("class-skip", "Skip me");
      return { selectedClassId };
    });

    const selected = await asStudent.mutation(api.managebac.setSelectedClasses, {
      recordIds: [classIds.selectedClassId],
      expectedRevision: 0,
      retention: "keep_in_spectra",
    });
    expect(selected.selectionRevision).toBe(1);
    expect(selected.selectedClassIds).toEqual(["class-follow|unknown"]);
    expect(selected.selectedRecordIds).toEqual([classIds.selectedClassId]);

    const resources = await asStudent.query(api.managebac.recordsForPurpose, {
      purpose: "upcoming_deadlines",
    });
    expect(resources.records.map((item) => item.providerClassId)).toEqual([
      "class-follow",
    ]);

    const candidates = await asStudent.query(
      api.managebac.listMyClassCandidates,
      {},
    );
    expect(candidates?.selectionRevision).toBe(1);
    expect(candidates?.selectedClassIds).toEqual(["class-follow|unknown"]);
  });

  it("surfaces identity no_match without inventing a Clerk provider match", async () => {
    const t = convexTest(schema, modules);
    const studentIdentity = {
      subject: "clerk_e1_nomatch",
      email: "nomatch-e1@example.test",
      emailVerified: true,
    };
    await t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", {
        name: "E1 No Match School",
        slug: `e1-nomatch-${crypto.randomUUID()}`,
        verifiedDomains: [],
        status: "active",
        timezone: "Europe/Madrid",
        policyVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      const studentId = await ctx.db.insert("accounts", {
        clerkId: studentIdentity.subject,
        email: studentIdentity.email,
        emailVerified: true,
        name: "E1 No Match",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        accountId: studentId,
        schoolId,
        role: "student",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const integrationId = await ctx.db.insert("schoolIntegrations", {
        schoolId,
        provider: "managebac",
        baseUrl: "https://e1-nomatch.example.test",
        authHeaderName: "X-API-Key",
        authScheme: "raw",
        status: "connected",
        tokenMode: "read_only",
        secretPurpose: "managebac-e1-nomatch",
        manifestVersion: 1,
        capabilityCoverage: {
          discovered: 1,
          verifiedReadable: 1,
          unverified: 0,
          failed: 0,
          quarantined: 0,
        },
        syncPolicy: {
          frequencyMinutes: 60,
          autoCreateClasses: false,
          autoImportTasks: true,
          autoApplySafeUpdates: true,
          conflictMode: "review",
        },
        freshnessSlaMinutes: 60,
        requestBudgetPerMinute: 30,
        bootstrapVersion: 1,
        createdByAccountId: studentId,
        updatedByAccountId: studentId,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("externalIdentityMappings", {
        integrationId,
        schoolId,
        accountId: studentId,
        verifiedEmailHash: "e1-nomatch-email-hash",
        status: "no_match",
        matchCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    });

    const asStudent = t.withIdentity(studentIdentity);
    const candidates = await asStudent.query(
      api.managebac.listMyClassCandidates,
      {},
    );
    expect(candidates).toMatchObject({
      identityRequired: true,
      identityStatus: "no_match",
    });
    expect(candidates?.classes ?? []).toEqual([]);
  });
});
