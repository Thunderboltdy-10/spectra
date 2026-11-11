/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { evaluateAccessForActor, evaluateAccessForActorWithLoadedResource, evaluateArtifactAccessForActor } from "./authorityShared";
import { getActorForAccountId } from "./identityShared";
import type { Id } from "./_generated/dataModel";
import { observeDatabase } from "../scripts/perf-read-ledger";

const modules = import.meta.glob("./**/*.ts");

async function seedAuthorityFixture(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
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
    const ownerId = await ctx.db.insert("accounts", {
      clerkId: `authority-owner-${crypto.randomUUID()}`,
      email: `authority-owner-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
      name: "Authority owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const viewerId = await ctx.db.insert("accounts", {
      clerkId: `authority-viewer-${crypto.randomUUID()}`,
      email: `authority-viewer-${crypto.randomUUID()}@example.test`,
      emailVerified: true,
      name: "Authority viewer",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    for (const accountId of [ownerId, viewerId]) {
      await ctx.db.insert("schoolMemberships", {
        accountId,
        schoolId,
        role: "student",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    const workspaceId = await ctx.db.insert("spectraWorkspaces", {
      ownerAccountId: ownerId,
      schoolId,
      title: "Shared workspace",
      status: "active",
      defaultView: "cards",
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    });
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: ownerId,
      schoolId,
      blueprintKey: "document",
      title: "Preloaded authority artifact",
      content: { blocks: [] },
      tags: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const agentId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: ownerId,
      schoolId,
      blueprintKey: "agent",
      title: "Preloaded authority agent",
      content: { instructions: "Use the fixture" },
      tags: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const nodeId = await ctx.db.insert("orgNodes", {
      accountId: ownerId,
      schoolId,
      parentId: null,
      kind: "work",
      name: "Preloaded authority artifact",
      sourceId: artifactId,
      orderKey: "a0",
      typeKey: "document",
      workspaceContextId: workspaceId,
      placedByAccountId: ownerId,
      accessProjection: true,
      createdAt: now,
      updatedAt: now,
    });
    return { schoolId, ownerId, viewerId, workspaceId, artifactId, agentId, nodeId };
  });
}

async function actorFor(
  t: ReturnType<typeof convexTest>,
  accountId: Id<"accounts">,
) {
  return t.run(async (ctx) => {
    const actor = await getActorForAccountId(ctx, accountId);
    if (!actor) throw new Error("authority fixture actor missing");
    return actor;
  });
}

async function loadedResource(
  t: ReturnType<typeof convexTest>,
  artifactId: Id<"spectraArtifacts">,
) {
  return t.run(async (ctx) => {
    const resource = await ctx.db.get(artifactId);
    if (!resource) throw new Error("authority fixture resource missing");
    return {
      resource,
      ownerAccountId: resource.ownerAccountId,
      schoolId: resource.schoolId,
      lifecycle: resource.status,
    };
  });
}

async function grant(
  t: ReturnType<typeof convexTest>,
  fixture: Awaited<ReturnType<typeof seedAuthorityFixture>>,
  resourceType: "workspace" | "artifact" | "agent",
  resourceId: string,
  level: "read" | "modify",
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("accessGrants", {
      schoolId: fixture.schoolId,
      resourceType,
      resourceId,
      principalType: "account",
      principalId: fixture.viewerId,
      level,
      capabilities: level === "modify" ? ["read", "modify"] : ["read"],
      source: "direct",
      createdByAccountId: fixture.ownerId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

async function evaluateLoaded(
  t: ReturnType<typeof convexTest>,
  fixture: Awaited<ReturnType<typeof seedAuthorityFixture>>,
  resourceType: "artifact" | "agent",
  resourceId: Id<"spectraArtifacts">,
) {
  const actor = await actorFor(t, fixture.viewerId);
  const loaded = await loadedResource(t, resourceId);
  return t.run((ctx) =>
    evaluateAccessForActorWithLoadedResource(
      ctx,
      actor,
      resourceType,
      resourceId,
      loaded,
    ),
  );
}

describe("authority discovery read reuse", () => {
  it("keeps owner metadata reads independent of recipient grants", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAuthorityFixture(t);
    const actor = await actorFor(t, fixture.ownerId);
    const measure = () => t.run(async (ctx) => {
      const observed = observeDatabase(ctx.db);
      const access = await evaluateArtifactAccessForActor({ ...ctx, db: observed.db }, actor, fixture.artifactId);
      return { access, ...observed.snapshot() };
    });
    const sparse = await measure();
    for (let index = 0; index < 12; index++) {
      await grant(t, fixture, "artifact", fixture.artifactId, "read");
    }
    const shared = await measure();
    expect(shared.access).toEqual(sparse.access);
    expect(shared.access).toMatchObject({ allowed: true, reason: "owner", level: "modify", sources: [{ kind: "owner" }] });
    expect(shared.serializedDocumentBytes).toBe(sparse.serializedDocumentBytes);
    expect(shared.reads.filter((read) => read.table === "accessGrants")).toEqual([]);
    expect(shared.writes).toBe(0);
  });

  it("keeps owner access semantics when the artifact row is preloaded", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAuthorityFixture(t);

    const actor = await actorFor(t, fixture.ownerId);
    const loaded = await loadedResource(t, fixture.artifactId);
    const decision = await t.run((ctx) =>
      evaluateAccessForActorWithLoadedResource(
        ctx,
        actor,
        "artifact",
        fixture.artifactId,
        loaded,
      ),
    );

    expect(decision).toMatchObject({
      allowed: true,
      level: "modify",
      reason: "owner",
    });
  });

  it("reuses the loaded row for workspace inheritance", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAuthorityFixture(t);
    await grant(t, fixture, "workspace", fixture.workspaceId, "modify");

    await expect(
      evaluateLoaded(t, fixture, "artifact", fixture.artifactId),
    ).resolves.toMatchObject({
      allowed: true,
      level: "modify",
      reason: "workspace_inheritance",
    });
  });

  it("preserves a direct account grant without requiring a placement", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAuthorityFixture(t);
    await grant(t, fixture, "artifact", fixture.artifactId, "read");

    await expect(
      evaluateLoaded(t, fixture, "artifact", fixture.artifactId),
    ).resolves.toMatchObject({
      allowed: true,
      level: "read",
      reason: "grant",
      capabilities: ["read", "use", "comment"],
    });
  });

  it("honors an artifact deny override over inherited workspace access", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAuthorityFixture(t);
    await grant(t, fixture, "workspace", fixture.workspaceId, "modify");
    await t.run(async (ctx) => {
      await ctx.db.insert("artifactAccessOverrides", {
        schoolId: fixture.schoolId,
        artifactId: fixture.artifactId,
        accountId: fixture.viewerId,
        effect: "deny",
        createdByAccountId: fixture.ownerId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    await expect(
      evaluateLoaded(t, fixture, "artifact", fixture.artifactId),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "artifact_exception",
    });
  });

  it("fails closed for a deleted preloaded artifact", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAuthorityFixture(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(fixture.artifactId, { status: "deleted" });
    });

    await expect(
      evaluateLoaded(t, fixture, "artifact", fixture.artifactId),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "deleted",
    });
  });

  it("preserves generic artifact access for an agent owner", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAuthorityFixture(t);
    const decision = await t.run(async (ctx) => {
      const actor = await getActorForAccountId(ctx, fixture.ownerId);
      if (!actor) throw new Error("Owner fixture missing");
      return evaluateAccessForActor(ctx, actor, "artifact", fixture.agentId);
    });
    expect(decision).toMatchObject({ allowed: true, reason: "owner" });
  });

  it("keeps agent grants scoped to an agent resource", async () => {
    const t = convexTest(schema, modules);
    const fixture = await seedAuthorityFixture(t);
    await grant(t, fixture, "agent", fixture.agentId, "modify");

    await expect(
      evaluateLoaded(t, fixture, "agent", fixture.agentId),
    ).resolves.toMatchObject({
      allowed: true,
      level: "modify",
      reason: "grant",
    });
    await expect(
      evaluateLoaded(t, fixture, "artifact", fixture.agentId),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "not_found",
    });
  });
});
