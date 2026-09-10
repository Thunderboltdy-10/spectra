/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

type Fixture = {
  owner: typeof ownerIdentity;
  peer: typeof peerIdentity;
  foreign: typeof foreignIdentity;
  unverified: typeof unverifiedIdentity;
  ownerAccountId: Id<"accounts">;
  peerAccountId: Id<"accounts">;
  foreignAccountId: Id<"accounts">;
  artifactId: Id<"spectraArtifacts">;
  containerArtifactId: Id<"spectraArtifacts">;
  pinnedVersionId: Id<"spectraArtifactVersions">;
  schoolId: Id<"schools">;
  foreignSchoolId: Id<"schools">;
};

const ownerIdentity = {
  subject: "authority-owner",
  email: "owner@authority.test",
  emailVerified: true,
};
const peerIdentity = {
  subject: "authority-peer",
  email: "peer@authority.test",
  emailVerified: true,
};
const foreignIdentity = {
  subject: "authority-foreign",
  email: "foreign@other-school.test",
  emailVerified: true,
};
const unverifiedIdentity = {
  subject: "authority-unverified",
  email: "peer@authority.test",
  emailVerified: false,
};

async function seedFixture(t: ReturnType<typeof convexTest>): Promise<Fixture> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Authority School",
      slug: `authority-${crypto.randomUUID()}`,
      verifiedDomains: ["authority.test"],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const foreignSchoolId = await ctx.db.insert("schools", {
      name: "Other School",
      slug: `other-${crypto.randomUUID()}`,
      verifiedDomains: ["other-school.test"],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    const ownerAccountId = await ctx.db.insert("accounts", {
      clerkId: ownerIdentity.subject,
      email: ownerIdentity.email,
      emailVerified: true,
      name: "Owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const peerAccountId = await ctx.db.insert("accounts", {
      clerkId: peerIdentity.subject,
      email: peerIdentity.email,
      emailVerified: true,
      name: "Peer",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const foreignAccountId = await ctx.db.insert("accounts", {
      clerkId: foreignIdentity.subject,
      email: foreignIdentity.email,
      emailVerified: true,
      name: "Foreign",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("schoolMemberships", {
      accountId: ownerAccountId,
      schoolId,
      role: "teacher",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId: peerAccountId,
      schoolId,
      role: "student",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId: foreignAccountId,
      schoolId: foreignSchoolId,
      role: "student",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId,
      schoolId,
      resourceClass: "resource",
      nativeFormat: "docx",
      compatibilityProfile: "strict-native",
      blueprintKey: "resource",
      title: "Authority fixture",
      summary: "A deliberately scoped authority test resource.",
      content: { blocks: [{ type: "paragraph", text: "private content" }] },
      contentHash: "a".repeat(64),
      textIndex: "private content",
      tags: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const containerArtifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId,
      schoolId,
      resourceClass: "resource",
      nativeFormat: "docx",
      compatibilityProfile: "strict-native",
      blueprintKey: "resource",
      title: "Container fixture",
      content: { blocks: [{ type: "paragraph", text: "container content" }] },
      contentHash: "c".repeat(64),
      textIndex: "container content",
      tags: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const pinnedVersionId = await ctx.db.insert("spectraArtifactVersions", {
      artifactId,
      ownerAccountId,
      schoolId,
      source: "manual",
      snapshotStrategy: "normalized",
      after: {
        title: "Authority fixture pinned",
        summary: "Pinned source",
        tags: [],
        content: { blocks: [{ type: "paragraph", text: "pinned content" }] },
      },
      summary: "Pinned source",
      name: "Pinned authority fixture",
      createdAt: now,
    });

    return {
      owner: ownerIdentity,
      peer: peerIdentity,
      foreign: foreignIdentity,
      unverified: unverifiedIdentity,
      ownerAccountId,
      peerAccountId,
      foreignAccountId,
      artifactId,
      containerArtifactId,
      pinnedVersionId,
      schoolId,
      foreignSchoolId,
    };
  });
}

function setupTest() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}

describe("ordinary student and peer authority boundaries", () => {
  it("grants only the invited level, enforces school scope, and revokes access", async () => {
    const t = setupTest();
    const fixture = await seedFixture(t);

    const invitation = await t.withIdentity(fixture.owner).mutation(api.authority.invite, {
      resourceType: "artifact",
      resourceId: fixture.artifactId,
      inviteeAccountId: fixture.peerAccountId,
      level: "read",
      message: "Read-only peer review",
    });
    const accepted = await t.withIdentity(fixture.peer).mutation(
      api.authority.acceptShareInvitation,
      { invitationId: invitation.invitationId },
    );

    const peerAccess = await t.withIdentity(fixture.peer).query(api.authority.access, {
      resourceType: "artifact",
      resourceId: fixture.artifactId,
    });
    expect(peerAccess).toMatchObject({
      allowed: true,
      level: "read",
      reason: "grant",
    });
    expect(peerAccess.capabilities).toEqual(["read", "use", "comment"]);
    expect(peerAccess.capabilities).not.toContain("modify");
    expect(peerAccess.capabilities).not.toContain("share");

    const peerArtifact = await t.withIdentity(fixture.peer).query(api.spectraArtifacts.get, {
      artifactId: fixture.artifactId,
    });
    expect(peerArtifact).toMatchObject({
      accessLevel: "read",
      ownership: "shared",
      isShared: true,
    });

    const foreignAccess = await t.withIdentity(fixture.foreign).query(api.authority.access, {
      resourceType: "artifact",
      resourceId: fixture.artifactId,
    });
    expect(foreignAccess).toMatchObject({
      allowed: false,
      level: null,
      reason: "school_boundary",
    });
    await expect(
      t.withIdentity(fixture.foreign).query(api.spectraArtifacts.get, {
        artifactId: fixture.artifactId,
      }),
    ).rejects.toThrow();

    await t.withIdentity(fixture.owner).mutation(api.authority.revoke, {
      resourceType: "artifact",
      resourceId: fixture.artifactId,
      grantId: accepted.grantId,
    });
    const afterRevoke = await t.withIdentity(fixture.peer).query(api.authority.access, {
      resourceType: "artifact",
      resourceId: fixture.artifactId,
    });
    expect(afterRevoke).toMatchObject({
      allowed: false,
      level: null,
      reason: "private",
    });
  });

  it("derives restricted-link eligibility from a verified identity and preserves expiry, revocation, and native privacy", async () => {
    const t = setupTest();
    const fixture = await seedFixture(t);
    const tokenHash = "b".repeat(64);

    const created = await t.withIdentity(fixture.owner).mutation(api.authority.createPublicLink, {
      resourceType: "artifact",
      resourceId: fixture.artifactId,
      tokenHash,
      domainRestriction: "Authority.Test",
    });

    expect(await t.query(api.authority.publicProjection, { tokenHash })).toEqual({
      access: "sign_in_required",
    });
    const trustedProjection = await t.withIdentity(fixture.peer).query(
      api.authority.publicProjection,
      { tokenHash },
    );
    expect(trustedProjection).toMatchObject({
      resourceType: "artifact",
      level: "read",
      artifact: { title: "Authority fixture", blueprintKey: "resource" },
    });
    expect(trustedProjection?.artifact?.content).toEqual({
      blocks: [{ type: "paragraph", text: "private content" }],
    });
    expect(
      await t.withIdentity(fixture.foreign).query(
        api.authority.publicProjection,
        { tokenHash },
      ),
    ).toEqual({ access: "domain_restricted" });
    expect(
      await t.withIdentity(fixture.unverified).query(
        api.authority.publicProjection,
        { tokenHash },
      ),
    ).toEqual({ access: "email_unverified" });

    await t.withIdentity(fixture.owner).mutation(api.authority.revokePublicLink, {
      linkId: created.linkId,
    });
    expect(
      await t.withIdentity(fixture.peer).query(api.authority.publicProjection, {
        tokenHash,
      }),
    ).toBeNull();

    const expiredHash = "e".repeat(64);
    const expired = await t.withIdentity(fixture.owner).mutation(
      api.authority.createPublicLink,
      {
        resourceType: "artifact",
        resourceId: fixture.artifactId,
        tokenHash: expiredHash,
      },
    );
    await t.run(async (ctx) => {
      await ctx.db.patch(expired.linkId, { expiresAt: Date.now() - 1 });
    });
    expect(
      await t.withIdentity(fixture.foreign).query(api.authority.publicProjection, {
        tokenHash: expiredHash,
      }),
    ).toBeNull();

    const unrestrictedHash = "u".repeat(64);
    await t.withIdentity(fixture.owner).mutation(api.authority.createPublicLink, {
      resourceType: "artifact",
      resourceId: fixture.artifactId,
      tokenHash: unrestrictedHash,
    });
    const foreignPublic = await t.withIdentity(fixture.foreign).query(
      api.authority.publicProjection,
      { tokenHash: unrestrictedHash },
    );
    expect(foreignPublic).toMatchObject({
      resourceType: "artifact",
      level: "read",
      artifact: { title: "Authority fixture" },
    });
    expect(foreignPublic?.artifact).not.toHaveProperty("contentHash");
    expect(foreignPublic?.artifact).not.toHaveProperty("deviceId");
    expect(foreignPublic?.artifact).not.toHaveProperty("mountId");
    expect(foreignPublic?.artifact).not.toHaveProperty("relativePath");
  });

  it("rechecks source authority for live and pinned embeds after a peer grant is revoked", async () => {
    const t = setupTest();
    const fixture = await seedFixture(t);

    const sourceInvitation = await t.withIdentity(fixture.owner).mutation(
      api.authority.invite,
      {
        resourceType: "artifact",
        resourceId: fixture.artifactId,
        inviteeAccountId: fixture.peerAccountId,
        level: "read",
      },
    );
    const containerInvitation = await t.withIdentity(fixture.owner).mutation(
      api.authority.invite,
      {
        resourceType: "artifact",
        resourceId: fixture.containerArtifactId,
        inviteeAccountId: fixture.peerAccountId,
        level: "modify",
      },
    );
    const sourceGrant = await t.withIdentity(fixture.peer).mutation(
      api.authority.acceptShareInvitation,
      { invitationId: sourceInvitation.invitationId },
    );
    await t.withIdentity(fixture.peer).mutation(
      api.authority.acceptShareInvitation,
      { invitationId: containerInvitation.invitationId },
    );

    const live = await t.withIdentity(fixture.peer).mutation(api.artifactEmbeds.create, {
      containerType: "artifact",
      containerId: fixture.containerArtifactId,
      containerRegionId: "body:live",
      sourceArtifactId: fixture.artifactId,
      mode: "compact",
      interaction: "read",
      versionPolicy: "live",
      contextPolicy: "summary",
    });
    const pinned = await t.withIdentity(fixture.peer).mutation(api.artifactEmbeds.create, {
      containerType: "artifact",
      containerId: fixture.containerArtifactId,
      containerRegionId: "body:pinned",
      sourceArtifactId: fixture.artifactId,
      mode: "compact",
      interaction: "read",
      versionPolicy: "pinned",
      pinnedVersionId: fixture.pinnedVersionId,
      contextPolicy: "summary",
    });

    const beforeRevoke = await t.withIdentity(fixture.peer).query(
      api.artifactEmbeds.getProjection,
      { embedId: live.embedId },
    );
    const pinnedBeforeRevoke = await t.withIdentity(fixture.peer).query(
      api.artifactEmbeds.getProjection,
      { embedId: pinned.embedId },
    );
    expect(beforeRevoke).toMatchObject({
      state: "ready",
      source: { snapshot: { content: { blocks: [{ type: "paragraph", text: "private content" }] } } },
    });
    expect(pinnedBeforeRevoke).toMatchObject({
      state: "ready",
      version: { versionId: fixture.pinnedVersionId },
      source: { snapshot: { content: { blocks: [{ type: "paragraph", text: "pinned content" }] } } },
    });

    await t.withIdentity(fixture.owner).mutation(api.authority.revoke, {
      resourceType: "artifact",
      resourceId: fixture.artifactId,
      grantId: sourceGrant.grantId,
    });
    expect(
      await t.withIdentity(fixture.peer).query(api.artifactEmbeds.getProjection, {
        embedId: live.embedId,
      }),
    ).toMatchObject({ state: "no_access", canRequestAccess: true });
    expect(
      await t.withIdentity(fixture.peer).query(api.artifactEmbeds.getProjection, {
        embedId: pinned.embedId,
      }),
    ).toMatchObject({ state: "no_access", canRequestAccess: true });
  });
});
