/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { evaluateAccessForActorWithLoadedResource } from "./authorityShared";
import { getActorForAccountId } from "./identityShared";

const modules = import.meta.glob("./**/*.ts");

describe("authority discovery read reuse", () => {
  it("keeps owner access semantics when the artifact row is preloaded", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", {
        name: "Authority reuse school",
        slug: `authority-reuse-${crypto.randomUUID()}`,
        verifiedDomains: [],
        status: "active",
        timezone: "Europe/Madrid",
        policyVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      const accountId = await ctx.db.insert("accounts", {
        clerkId: `authority-reuse-${crypto.randomUUID()}`,
        email: "authority-reuse@example.test",
        emailVerified: true,
        name: "Authority reuse",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        accountId,
        schoolId,
        role: "student",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const artifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: accountId,
        schoolId,
        blueprintKey: "document",
        title: "Preloaded authority artifact",
        content: { blocks: [] },
        tags: [],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      return { accountId, artifactId };
    });

    const decision = await t.run(async (ctx) => {
      const actor = await getActorForAccountId(ctx, fixture.accountId);
      const artifact = await ctx.db.get(fixture.artifactId);
      if (!actor || !artifact) throw new Error("authority fixture missing");
      return evaluateAccessForActorWithLoadedResource(
        ctx,
        actor,
        "artifact",
        fixture.artifactId,
        {
          resource: artifact,
          ownerAccountId: artifact.ownerAccountId,
          schoolId: artifact.schoolId,
          lifecycle: artifact.status,
        },
      );
    });

    expect(decision).toMatchObject({
      allowed: true,
      level: "modify",
      reason: "owner",
    });
  });
});
