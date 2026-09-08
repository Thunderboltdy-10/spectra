import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "clerk_spectra_embed_deletion",
  email: "spectra-embed-deletion@example.test",
  emailVerified: true,
};

describe("Spectra embed deletion lifecycle", () => {
  it("tombstones embeds in both directions and cancels their pending requests", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", {
        name: "Embed deletion school",
        slug: `embed-deletion-${crypto.randomUUID()}`,
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
        name: "Embed deletion owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        accountId,
        schoolId,
        role: "school_admin",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const createArtifact = (title: string) =>
        ctx.db.insert("spectraArtifacts", {
          ownerAccountId: accountId,
          schoolId,
          blueprintKey: "document",
          schemaVersion: 2,
          title,
          content: { blocks: [] },
          textIndex: title,
          tags: [],
          status: "active",
          createdAt: now,
          updatedAt: now,
        });
      const containerId = await createArtifact("Container");
      const embeddedSourceId = await createArtifact("Embedded source");
      const firstEmbedId = await ctx.db.insert("artifactEmbeds", {
        containerType: "artifact",
        containerId: String(containerId),
        containerRegionId: "document:reference:first",
        sourceArtifactId: embeddedSourceId,
        schoolId,
        mode: "compact",
        interaction: "read",
        versionPolicy: "live",
        contextPolicy: "summary",
        createdByAccountId: accountId,
        createdAt: now,
        updatedAt: now,
      });
      const secondEmbedId = await ctx.db.insert("artifactEmbeds", {
        containerType: "artifact",
        containerId: "another-container",
        containerRegionId: "document:reference:second",
        sourceArtifactId: containerId,
        schoolId,
        mode: "expanded",
        interaction: "interact",
        versionPolicy: "live",
        contextPolicy: "visible_region",
        createdByAccountId: accountId,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("artifactAccessRequests", {
        embedId: firstEmbedId,
        sourceArtifactId: embeddedSourceId,
        schoolId,
        requesterAccountId: accountId,
        ownerAccountId: accountId,
        requestedLevel: "read",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("artifactAccessRequests", {
        embedId: secondEmbedId,
        sourceArtifactId: containerId,
        schoolId,
        requesterAccountId: accountId,
        ownerAccountId: accountId,
        requestedLevel: "modify",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      return { containerId };
    });

    await t.withIdentity(identity).mutation(api.spectraArtifacts.permanentlyDelete, {
      artifactId: fixture.containerId,
    });

    const result = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(fixture.containerId),
      embeds: await ctx.db.query("artifactEmbeds").collect(),
      requests: await ctx.db.query("artifactAccessRequests").collect(),
    }));
    expect(result.artifact).toBeNull();
    expect(result.embeds).toHaveLength(2);
    expect(result.embeds.every((embed) => embed.removedAt)).toBe(true);
    expect(result.requests.every((request) => request.status === "cancelled")).toBe(true);
  });
});
