import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

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

async function drainDeletion(t: ReturnType<typeof convexTest>, jobId: Id<"artifactDeletionJobs">, generation = 1) {
  const process = (internal as unknown as { spectraArtifactDeletion: { process: unknown } }).spectraArtifactDeletion.process as never;
  const runInternal = (t as unknown as { mutation: (fn: unknown, args: unknown) => Promise<unknown> }).mutation.bind(t);
  for (let i = 0; i < 100; i += 1) {
    const job = await t.run((ctx) => ctx.db.get(jobId));
    if (
      !job ||
      job.phase === "complete" ||
      job.phase === "failed" ||
      job.phase === "retained"
    )
      return;
    await runInternal(process, { jobId, generation });
  }
  throw new Error("deletion did not drain");
}

describe("Spectra embed deletion lifecycle", () => {
  it("runs the dispatcher handoff through the scheduled page worker", async () => {
    vi.useFakeTimers();
    try {
      const t = setupTest();
      const artifactId = await t.run(async (ctx) => {
        const now = Date.now();
        const schoolId = await ctx.db.insert("schools", {
          name: "Scheduled deletion school",
          slug: `scheduled-deletion-${crypto.randomUUID()}`,
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
          name: "Scheduled deletion owner",
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
        return ctx.db.insert("spectraArtifacts", {
          ownerAccountId: accountId,
          schoolId,
          blueprintKey: "document",
          schemaVersion: 2,
          title: "Scheduled deletion artifact",
          content: { blocks: [] },
          textIndex: "scheduled deletion artifact",
          tags: [],
          status: "active",
          createdAt: now,
          updatedAt: now,
        });
      });

      const deletion = await t.withIdentity(identity).mutation(api.spectraArtifacts.permanentlyDelete, { artifactId });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const result = await t.run(async (ctx) => ({
        artifact: await ctx.db.get(artifactId),
        job: await ctx.db.get(deletion.jobId),
      }));
      expect(result.artifact).toBeNull();
      expect(result.job?.phase).toBe("complete");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a pinned provisional placement alive when its source is deleted", async () => {
    const t = setupTest();
    const fixture = await t.run(async (ctx) => {
      const now = Date.now();
      const schoolId = await ctx.db.insert("schools", {
        name: "Pinned provisional school",
        slug: `pinned-provisional-${crypto.randomUUID()}`,
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
        name: "Pinned provisional owner",
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
      const sourceArtifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: accountId,
        schoolId,
        blueprintKey: "document",
        schemaVersion: 2,
        title: "Pinned source",
        content: { blocks: [] },
        textIndex: "Pinned source",
        tags: [],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const containerArtifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: accountId,
        schoolId,
        blueprintKey: "document",
        schemaVersion: 2,
        title: "Pinned container",
        content: { blocks: [] },
        textIndex: "Pinned container",
        tags: [],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const pinnedVersionId = await ctx.db.insert("spectraArtifactVersions", {
        artifactId: sourceArtifactId,
        ownerAccountId: accountId,
        schoolId,
        source: "import",
        schemaVersion: 2,
        after: { blocks: [{ type: "paragraph", text: "Pinned" }] },
        createdAt: now,
      });
      const embedId = await ctx.db.insert("artifactEmbeds", {
        containerType: "artifact",
        containerId: String(containerArtifactId),
        containerRegionId: "document:reference:pinned-provisional",
        sourceArtifactId,
        schoolId,
        mode: "compact",
        interaction: "read",
        versionPolicy: "pinned",
        pinnedVersionId,
        contextPolicy: "summary",
        createdByAccountId: accountId,
        placementOperationId: "pinned-provisional-operation",
        placementState: "provisional",
        placementExpiresAt: now - 1,
        createdAt: now,
        updatedAt: now,
      });
      return { sourceArtifactId, embedId };
    });

    const deletion = await t.withIdentity(identity).mutation(
      api.spectraArtifacts.permanentlyDelete,
      { artifactId: fixture.sourceArtifactId },
    );
    const afterTombstone = await t.run((ctx) => ctx.db.get(fixture.embedId));
    expect(afterTombstone).toMatchObject({
      sourceUnavailableAt: expect.any(Number),
      placementState: "provisional",
    });
    expect(afterTombstone?.placementExpiresAt).toBeUndefined();

    const expire = (internal as unknown as {
      artifactEmbeds: { expireProvisional: unknown };
    }).artifactEmbeds.expireProvisional as never;
    const runInternal = (
      t as unknown as {
        mutation: (fn: unknown, args: unknown) => Promise<unknown>;
      }
    ).mutation.bind(t);
    await expect(
      runInternal(expire, {
        embedId: fixture.embedId,
        placementOperationId: "pinned-provisional-operation",
      }),
    ).resolves.toMatchObject({ expired: false });

    await drainDeletion(t, deletion.jobId);
    const result = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(fixture.sourceArtifactId),
      embed: await ctx.db.get(fixture.embedId),
    }));
    expect(result.artifact).toBeDefined();
    expect(result.embed).toMatchObject({
      sourceUnavailableAt: expect.any(Number),
      pinnedVersionId: expect.any(String),
    });
    expect(result.embed?.removedAt).toBeUndefined();
  });

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

    const deletion = await t.withIdentity(identity).mutation(api.spectraArtifacts.permanentlyDelete, {
      artifactId: fixture.containerId,
    });
    await drainDeletion(t, deletion.jobId);

    const result = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(fixture.containerId),
      embeds: await ctx.db.query("artifactEmbeds").collect(),
      requests: await ctx.db.query("artifactAccessRequests").collect(),
    }));
    expect(result.artifact).toBeNull();
    expect(result.embeds).toHaveLength(2);
    expect(result.embeds.find((embed) => embed.containerId === String(fixture.containerId))?.removedAt).toBeDefined();
    expect(result.embeds.find((embed) => embed.sourceArtifactId === fixture.containerId)?.removedAt).toBeUndefined();
    expect(result.embeds.find((embed) => embed.sourceArtifactId === fixture.containerId)?.sourceUnavailableAt).toBeDefined();
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
      return { nodeId, containerId, sourceId };
    });

    await t.withIdentity(identity).mutation(api.orgTree.trash, { nodeIds: [fixture.nodeId] });
    await t.withIdentity(identity).mutation(api.orgTree.purge, { nodeIds: [fixture.nodeId] });
    const job = await t.run(async (ctx) => ctx.db.query("artifactDeletionJobs").first());
    if (job) await drainDeletion(t, job._id, job.generation);

    const result = await t.run(async (ctx) => ({
      node: await ctx.db.get(fixture.nodeId),
      artifacts: await ctx.db.query("spectraArtifacts").collect(),
      embeds: await ctx.db.query("artifactEmbeds").collect(),
      requests: await ctx.db.query("artifactAccessRequests").collect(),
    }));
    expect(result.node).toBeNull();
    expect(result.artifacts).toHaveLength(1);
    expect(result.embeds).toHaveLength(2);
    expect(result.embeds.find((embed) => embed.containerId === String(fixture.containerId))?.removedAt).toBeDefined();
    expect(result.embeds.find((embed) => embed.sourceArtifactId === fixture.containerId)?.removedAt).toBeUndefined();
    expect(result.embeds.find((embed) => embed.sourceArtifactId === fixture.containerId)?.sourceUnavailableAt).toBeDefined();
    expect(result.requests.every((request) => request.status === "cancelled")).toBe(true);
  });
});
