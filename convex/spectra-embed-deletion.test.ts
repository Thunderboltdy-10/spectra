import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "clerk_spectra_embed_deletion",
  email: "spectra-embed-deletion@example.test",
  emailVerified: true,
};

function setupTest() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}

describe("Spectra embed deletion lifecycle", () => {
  it("tombstones embeds in both directions and cancels their pending requests", async () => {
    const t = setupTest();
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

  it("keeps the same embed tombstone contract for permanent Trash purge", async () => {
    const t = setupTest();
    const fixture = await t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", {
        name: "Tree embed deletion school",
        slug: `tree-embed-deletion-${crypto.randomUUID()}`,
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
        name: "Tree embed deletion owner",
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
      const containerId = await createArtifact("Tree container");
      const sourceId = await createArtifact("Tree source");
      const containerEmbedId = await ctx.db.insert("artifactEmbeds", {
        containerType: "artifact",
        containerId: String(containerId),
        containerRegionId: "document:tree:first",
        sourceArtifactId: sourceId,
        schoolId,
        mode: "compact",
        interaction: "read",
        versionPolicy: "live",
        contextPolicy: "summary",
        createdByAccountId: accountId,
        createdAt: now,
        updatedAt: now,
      });
      const sourceEmbedId = await ctx.db.insert("artifactEmbeds", {
        containerType: "artifact",
        containerId: "tree-another-container",
        containerRegionId: "document:tree:second",
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
      for (const [embedId, sourceArtifactId] of [[containerEmbedId, sourceId], [sourceEmbedId, containerId]] as const) {
        await ctx.db.insert("artifactAccessRequests", {
          embedId,
          sourceArtifactId,
          schoolId,
          requesterAccountId: accountId,
          ownerAccountId: accountId,
          requestedLevel: "read",
          status: "pending",
          createdAt: now,
          updatedAt: now,
        });
      }
      const nodeId = await ctx.db.insert("orgNodes", {
        accountId,
        schoolId,
        parentId: null,
        kind: "work",
        name: "Tree container",
        sourceId: String(containerId),
        orderKey: "a",
        typeKey: "document",
        createdAt: now,
        updatedAt: now,
      });
      return { nodeId };
    });

    await t.withIdentity(identity).mutation(api.orgTree.trash, { nodeIds: [fixture.nodeId] });
    await t.withIdentity(identity).mutation(api.orgTree.purge, { nodeIds: [fixture.nodeId] });

    const result = await t.run(async (ctx) => ({
      node: await ctx.db.get(fixture.nodeId),
      artifacts: await ctx.db.query("spectraArtifacts").collect(),
      embeds: await ctx.db.query("artifactEmbeds").collect(),
      requests: await ctx.db.query("artifactAccessRequests").collect(),
    }));
    expect(result.node).toBeNull();
    expect(result.artifacts).toHaveLength(1);
    expect(result.embeds).toHaveLength(2);
    expect(result.embeds.every((embed) => embed.removedAt)).toBe(true);
    expect(result.requests.every((request) => request.status === "cancelled")).toBe(true);
  });
});
