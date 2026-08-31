/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "clerk_p9_library_efficiency",
  email: "p9-library@example.test",
  emailVerified: true,
};

function setupTest() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}

async function seedActor(t: ReturnType<typeof setupTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "P9 Efficiency School",
      slug: `p9-efficiency-${crypto.randomUUID()}`,
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
      name: "P9 Library",
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
    return { accountId, schoolId };
  });
}

describe("P9.I3 Library summary projection", () => {
  it("lists placement and share state without returning payload-bearing fields", async () => {
    const t = setupTest();
    const actor = await seedActor(t);
    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      const marker = "HEAVY-PAYLOAD-MUST-NOT-REACH-LIBRARY";
      const artifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        blueprintKey: "document",
        schemaVersion: 2,
        title: "Bounded essay",
        summary: "A compact card summary",
        content: { blocks: [{ id: "body", type: "paragraph", text: marker }] },
        textIndex: marker.repeat(2_000),
        protectedBaseContent: { blocks: [{ id: "base", text: marker }] },
        protectedBaseTextIndex: marker.repeat(1_000),
        aiPreview: {
          title: `Preview title ${"P".repeat(20_000)}`,
          summary: "S".repeat(20_000),
          tags: Array.from({ length: 200 }, (_, index) =>
            `preview-tag-${index}-${"T".repeat(200)}`,
          ),
          content: { blocks: [{ id: "preview", text: marker }] },
          changedPaths: Array.from(
            { length: 200 },
            (_, index) => `/oversized/${index}/${"C".repeat(200)}`,
          ),
          startedAt: now,
        },
        createdFrom: {
          source: "ai",
          sourceAttachmentNames: Array.from(
            { length: 200 },
            (_, index) => `attachment-${index}-${"A".repeat(200)}`,
          ),
          contextSummary: "M".repeat(20_000),
        },
        tags: ["bounded"],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const invitees = [];
      for (const suffix of ["one", "two"]) {
        invitees.push(
          await ctx.db.insert("accounts", {
            clerkId: `clerk_invitee_${suffix}`,
            email: `invitee-${suffix}@example.test`,
            emailVerified: true,
            name: `Invitee ${suffix}`,
            status: "active",
            createdAt: now,
            updatedAt: now,
          }),
        );
      }
      for (const [index, inviteeAccountId] of invitees.entries())
        await ctx.db.insert("shareInvitations", {
          schoolId: actor.schoolId,
          resourceType: "artifact",
          resourceId: artifactId,
          inviterAccountId: actor.accountId,
          inviteeAccountId,
          level: "read",
          status: index === 0 ? "pending" : "accepted",
          createdAt: now,
          updatedAt: now,
        });
      return { artifactId, marker };
    });
    const asUser = t.withIdentity(identity);
    await t.mutation(internal.spectraArtifacts.backfillSummaries, {
      cursor: null,
    });
    await asUser.mutation(api.orgTree.placeWork, {
      artifactId: seeded.artifactId,
    });

    const projectionSizes = await t.run(async (ctx) => {
      const artifact = await ctx.db.get(seeded.artifactId);
      const summary = await ctx.db
        .query("spectraArtifactSummaries")
        .withIndex("by_artifact", (q) => q.eq("artifactId", seeded.artifactId))
        .unique();
      const bytes = (value: unknown) =>
        new TextEncoder().encode(JSON.stringify(value)).byteLength;
      return { artifact: bytes(artifact), summary: bytes(summary) };
    });
    expect(projectionSizes.artifact).toBeGreaterThan(100_000);
    expect(projectionSizes.summary).toBeLessThan(10_000);
    expect(projectionSizes.summary).toBeLessThan(projectionSizes.artifact / 10);

    const listed = await asUser.query(api.spectraArtifacts.list, {
      status: "active",
      limit: 20,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      _id: seeded.artifactId,
      title: "Bounded essay",
      sharedWithCount: 2,
      isShared: true,
      placementStatus: "workspace",
    });
    expect(listed[0]?.placements?.[0]?.workspaceTitle).toBe("General");
    expect(listed[0]).not.toHaveProperty("content");
    expect(listed[0]).not.toHaveProperty("textIndex");
    expect(listed[0]).not.toHaveProperty("protectedBaseContent");
    expect(listed[0]).not.toHaveProperty("protectedBaseTextIndex");
    expect((listed[0] as { aiPreview?: unknown }).aiPreview).not.toHaveProperty(
      "content",
    );
    expect(JSON.stringify(listed[0])).not.toContain(seeded.marker);
  });

  it("keeps deny overrides from strengthening a separate direct grant", async () => {
    const t = setupTest();
    const actor = await seedActor(t);
    const sharedArtifactId = await t.run(async (ctx) => {
      const now = Date.now();
      const ownerAccountId = await ctx.db.insert("accounts", {
        clerkId: "clerk_p9_override_owner",
        email: "p9-override-owner@example.test",
        emailVerified: true,
        name: "Override Owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const artifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId,
        schoolId: actor.schoolId,
        blueprintKey: "document",
        schemaVersion: 2,
        title: "Override-protected essay",
        content: { blocks: [] },
        tags: [],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const workspaceId = await ctx.db.insert("spectraWorkspaces", {
        ownerAccountId,
        schoolId: actor.schoolId,
        title: "Shared workspace",
        status: "active",
        defaultView: "cards",
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
      });
      await ctx.db.insert("orgNodes", {
        accountId: ownerAccountId,
        kind: "work",
        sourceId: artifactId,
        name: "Override-protected essay",
        typeKey: "document",
        parentId: null,
        orderKey: "a0",
        activityAt: now,
        workspaceContextId: workspaceId,
        placedByAccountId: ownerAccountId,
        accessProjection: true,
        createdAt: now,
        updatedAt: now,
      });
      const grant = async (
        resourceType: "workspace" | "artifact",
        resourceId: string,
        level: "read" | "modify",
      ) =>
        ctx.db.insert("accessGrants", {
          schoolId: actor.schoolId,
          resourceType,
          resourceId,
          principalType: "account",
          principalId: actor.accountId,
          level,
          capabilities:
            level === "modify"
              ? ["read", "modify", "restore", "use", "comment"]
              : ["read", "use", "comment"],
          source: "direct",
          createdByAccountId: ownerAccountId,
          createdAt: now,
          updatedAt: now,
        });
      await grant("workspace", workspaceId, "modify");
      await grant("artifact", artifactId, "read");
      await ctx.db.insert("artifactAccessOverrides", {
        schoolId: actor.schoolId,
        artifactId,
        accountId: actor.accountId,
        effect: "deny",
        createdByAccountId: ownerAccountId,
        createdAt: now,
        updatedAt: now,
      });
      return artifactId;
    });
    await t.mutation(internal.spectraArtifacts.backfillSummaries, {
      cursor: null,
    });

    const listed = await t.withIdentity(identity).query(api.spectraArtifacts.list, {
      status: "active",
      limit: 20,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      _id: sharedArtifactId,
      accessLevel: "read",
      accessReason: "grant",
    });
  });
});

describe("P9.I3 collaboration room upgrades", () => {
  it("rotates immediately and compacts the retired history in bounded pages", async () => {
    const t = setupTest();
    const actor = await seedActor(t);
    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      const artifactId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: actor.accountId,
        schoolId: actor.schoolId,
        blueprintKey: "document",
        schemaVersion: 1,
        title: "Room upgrade",
        content: { blocks: [] },
        tags: [],
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      const roomId = await ctx.db.insert("collaborationRooms", {
        artifactId,
        schoolId: actor.schoolId,
        typeKey: "document",
        provider: "self_hosted_yjs",
        partitionKey: "root",
        schemaVersion: 1,
        policyVersion: 0,
        status: "active",
        nextSequence: 261,
        snapshotSequence: 0,
        uncompactedBytes: 260,
        createdAt: now,
        updatedAt: now,
      });
      const byte = new Uint8Array([1]).buffer;
      for (let sequence = 1; sequence <= 260; sequence += 1)
        await ctx.db.insert("collaborationUpdates", {
          roomId,
          schoolId: actor.schoolId,
          sequence,
          update: byte,
          byteLength: 1,
          stateVectorHash: `state-${sequence}`,
          actorAccountId: actor.accountId,
          clientId: "upgrade-client",
          idempotencyKey: `upgrade:${sequence}`,
          regionIds: ["artifact:structure"],
          createdAt: now,
        });
      for (
        let throughSequence = 10;
        throughSequence <= 30;
        throughSequence += 10
      )
        await ctx.db.insert("collaborationSnapshots", {
          roomId,
          artifactId,
          schoolId: actor.schoolId,
          throughSequence,
          update: byte,
          stateVector: byte,
          contentHash: `snapshot-${throughSequence}`,
          schemaVersion: 1,
          status: "superseded",
          createdBy: "compactor",
          createdAt: now,
        });
      return { artifactId, roomId };
    });

    const upgraded = await t
      .withIdentity(identity)
      .mutation(api.collaboration.ensureRoom, {
        artifactId: seeded.artifactId,
        schemaVersion: 2,
      });
    expect(upgraded.roomId).not.toBe(seeded.roomId);
    expect(upgraded).toMatchObject({ schemaVersion: 2, nextSequence: 1 });
    const afterRotate = await t.run(async (ctx) => ({
      oldRoom: await ctx.db.get(seeded.roomId),
      newRoom: await ctx.db.get(upgraded.roomId),
      oldUpdates: await ctx.db
        .query("collaborationUpdates")
        .withIndex("by_room_sequence", (q) => q.eq("roomId", seeded.roomId))
        .collect(),
    }));
    expect(afterRotate.oldRoom?.status).toBe("closed");
    expect(afterRotate.oldRoom?.partitionKey).toMatch(/^__retired__:/);
    expect(afterRotate.newRoom).toMatchObject({
      status: "active",
      partitionKey: "root",
      schemaVersion: 2,
      nextSequence: 1,
    });
    expect(afterRotate.oldUpdates).toHaveLength(260);

    const firstPage = await t.mutation(
      internal.collaboration.compactRetiredRoom,
      { roomId: seeded.roomId },
    );
    expect(firstPage.cleaned).toBeLessThanOrEqual(256);
    await t.mutation(internal.collaboration.compactRetiredRoom, {
      roomId: seeded.roomId,
    });
    await t.mutation(internal.collaboration.compactRetiredRoom, {
      roomId: seeded.roomId,
    });
    const remaining = await t.run(async (ctx) => ({
      updates: await ctx.db
        .query("collaborationUpdates")
        .withIndex("by_room_sequence", (q) => q.eq("roomId", seeded.roomId))
        .collect(),
      snapshots: await ctx.db
        .query("collaborationSnapshots")
        .withIndex("by_room_sequence", (q) => q.eq("roomId", seeded.roomId))
        .collect(),
    }));
    expect(remaining.updates).toHaveLength(0);
    expect(remaining.snapshots).toHaveLength(0);
  });
});

describe("P9.I3 denormalized child counts", () => {
  it("updates counts across create, move, trash and restore", async () => {
    const t = setupTest();
    await seedActor(t);
    const asUser = t.withIdentity(identity);
    const roots = await asUser.mutation(api.orgTree.ensureAccountRoots, {});
    const parent = await asUser.mutation(api.orgTree.createFolder, {
      name: "Parent",
      parentId: roots.generalNodeId,
    });
    const first = await asUser.mutation(api.orgTree.createFolder, {
      name: "First",
      parentId: parent.nodeId,
    });
    const second = await asUser.mutation(api.orgTree.createFolder, {
      name: "Second",
      parentId: parent.nodeId,
    });

    const count = async () => {
      const result = await asUser.query(api.orgTree.listContainers, {
        parentId: roots.generalNodeId,
      });
      return result.nodes.find((node) => node.nodeId === parent.nodeId)
        ?.childCount;
    };
    expect(await count()).toBe(2);
    await asUser.mutation(api.orgTree.move, {
      nodeIds: [first.nodeId],
      parentId: roots.generalNodeId,
    });
    expect(await count()).toBe(1);
    await asUser.mutation(api.orgTree.trash, { nodeIds: [second.nodeId] });
    expect(await count()).toBe(0);
    await asUser.mutation(api.orgTree.restore, { nodeIds: [second.nodeId] });
    expect(await count()).toBe(1);
  });
});
