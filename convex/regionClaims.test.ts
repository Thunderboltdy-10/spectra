/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { claimAcquireAction } from "../shared/region-claim-policy";
import { regionDomainsIntersect } from "./regionClaims";

const modules = import.meta.glob("./**/*.ts");
const ownerIdentity = {
  subject: "clerk_region_claim_owner",
  email: "region-owner@example.test",
  emailVerified: true,
};
const collaboratorIdentity = {
  subject: "clerk_region_claim_collab",
  email: "region-collab@example.test",
  emailVerified: true,
};
const baseHash = "base-vector-hash-1234";

async function seedDocument(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Region Claim School",
      slug: `region-claim-${crypto.randomUUID()}`,
      verifiedDomains: [],
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
      name: "Region Owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId: ownerAccountId,
      schoolId,
      role: "student",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const collaboratorAccountId = await ctx.db.insert("accounts", {
      clerkId: collaboratorIdentity.subject,
      email: collaboratorIdentity.email,
      emailVerified: true,
      name: "Region Collaborator",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      accountId: collaboratorAccountId,
      schoolId,
      role: "student",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId,
      schoolId,
      blueprintKey: "document",
      title: "Same region",
      content: {},
      tags: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("accessGrants", {
      schoolId,
      resourceType: "artifact",
      resourceId: artifactId,
      principalType: "account",
      principalId: collaboratorAccountId,
      level: "modify",
      capabilities: ["read", "modify", "restore", "use", "comment"],
      source: "direct",
      createdByAccountId: ownerAccountId,
      createdAt: now,
      updatedAt: now,
    });
    const ownerRunId = await ctx.db.insert("spectraAiRuns", {
      ownerAccountId,
      schoolId,
      sourceSurface: "artifact",
      artifactId,
      status: "running",
      phase: "updating",
      userPrompt: "Append AI1",
      executionId: "owner-exec",
      eventSequence: 1,
      createdAt: now,
      updatedAt: now,
    });
    const collabRunId = await ctx.db.insert("spectraAiRuns", {
      ownerAccountId: collaboratorAccountId,
      schoolId,
      sourceSurface: "artifact",
      artifactId,
      status: "running",
      phase: "updating",
      userPrompt: "Append AI2",
      executionId: "collab-exec",
      eventSequence: 1,
      createdAt: now,
      updatedAt: now,
    });
    return { artifactId, ownerRunId, collabRunId };
  });
}

describe("region claim serialize", () => {
  it("keeps a second overlapping AI queued until the first lease is released, then activates it", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedDocument(t);
    const first = await t.withIdentity(ownerIdentity).mutation(api.regionClaims.acquire, {
      artifactId: fixture.artifactId,
      clientId: "client-owner",
      regionId: "block:same",
      overlapDomains: ["block:same"],
      baseStateVectorHash: baseHash,
      actorKind: "ai",
      runId: fixture.ownerRunId,
    });
    expect(first.status).toBe("active");
    expect(claimAcquireAction(first.status)).toBe("apply");

    const second = await t
      .withIdentity(collaboratorIdentity)
      .mutation(api.regionClaims.acquire, {
        artifactId: fixture.artifactId,
        clientId: "client-collab",
        regionId: "block:same",
        overlapDomains: ["block:same"],
        baseStateVectorHash: baseHash,
        actorKind: "ai",
        runId: fixture.collabRunId,
      });
    expect(second.status).toBe("queued");
    expect(claimAcquireAction(second.status)).toBe("wait");
    expect(second.conflict?.claimId).toBe(first.claimId);

    await t.withIdentity(ownerIdentity).mutation(api.regionClaims.release, {
      claimId: first.claimId,
      clientId: "client-owner",
      resolution: "apply",
    });

    const promoted = await t
      .withIdentity(collaboratorIdentity)
      .mutation(api.regionClaims.acquire, {
        artifactId: fixture.artifactId,
        clientId: "client-collab",
        regionId: "block:same",
        overlapDomains: ["block:same"],
        baseStateVectorHash: baseHash,
        actorKind: "ai",
        runId: fixture.collabRunId,
      });
    expect(promoted.status).toBe("active");
    expect(promoted.claimId).toBe(second.claimId);
    expect(claimAcquireAction(promoted.status)).toBe("apply");
  });

  it("treats artifact structure as overlapping every region", () => {
    expect(regionDomainsIntersect(["artifact:structure"], ["block:same"])).toBe(
      true,
    );
  });
});
