import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "clerk_spectra_embed_placement_idempotency",
  email: "spectra-embed-placement-idempotency@example.test",
  emailVerified: true,
};

function setupTest() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "orgNodeCountByType");
  aggregateTest.register(t, "orgNodeCountByWorkspace");
  aggregateTest.register(t, "orgNodeCountByParent");
  return t;
}

async function seedPlacementFixture(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Placement idempotency school",
      slug: `placement-idempotency-${crypto.randomUUID()}`,
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
      name: "Placement idempotency owner",
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
      title: "Placement source",
      content: { blocks: [] },
      textIndex: "Placement source",
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
      title: "Placement container",
      content: { blocks: [] },
      textIndex: "Placement container",
      tags: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { sourceArtifactId, containerArtifactId };
  });
}

function createArgs(
  fixture: { sourceArtifactId: Awaited<ReturnType<typeof seedPlacementFixture>>["sourceArtifactId"]; containerArtifactId: Awaited<ReturnType<typeof seedPlacementFixture>>["containerArtifactId"] },
  placementOperationId: string,
  region = "document:body:idempotency",
) {
  return {
    containerType: "artifact" as const,
    containerId: String(fixture.containerArtifactId),
    containerRegionId: region,
    sourceArtifactId: fixture.sourceArtifactId,
    mode: "compact" as const,
    interaction: "read" as const,
    versionPolicy: "live" as const,
    contextPolicy: "summary" as const,
    placementOperationId,
  };
}

async function rowsForOp(
  t: ReturnType<typeof convexTest>,
  containerArtifactId: string,
  placementOperationId: string,
) {
  return t.run(async (ctx) =>
    ctx.db
      .query("artifactEmbeds")
      .withIndex("by_placement_operation", (q) =>
        q
          .eq("containerType", "artifact")
          .eq("containerId", containerArtifactId)
          .eq("placementOperationId", placementOperationId),
      )
      .collect(),
  );
}

describe("Spectra embed placementOperationId idempotency", () => {
  it("revives the soft-removed row instead of inserting a second live embed for the same placementOperationId", async () => {
    const t = setupTest();
    const fixture = await seedPlacementFixture(t);
    const asOwner = t.withIdentity(identity);
    const placementOperationId = "soft-remove-then-recreate-same-op";
    const args = createArgs(fixture, placementOperationId);

    const first = await asOwner.mutation(api.artifactEmbeds.create, args);
    expect(first).toMatchObject({ embedId: expect.any(String) });
    expect("idempotent" in first ? first.idempotent : false).toBeFalsy();

    const removed = await asOwner.mutation(api.artifactEmbeds.remove, {
      embedId: first.embedId,
    });
    expect(removed).toEqual({ removed: true });

    const afterRemove = await t.run((ctx) => ctx.db.get(first.embedId));
    expect(afterRemove?.removedAt).toEqual(expect.any(Number));
    expect(afterRemove?.placementState).toBe("removed");

    const second = await asOwner.mutation(api.artifactEmbeds.create, args);
    const rows = await rowsForOp(
      t,
      String(fixture.containerArtifactId),
      placementOperationId,
    );
    const liveRows = rows.filter((row) => row.removedAt === undefined);

    // Contract: same placementOperationId must revive/reuse the soft-removed row.
    // A second create must not leave a removed+live pair (or two live rows).
    expect(rows).toHaveLength(1);
    expect(liveRows).toHaveLength(1);
    expect(second.embedId).toBe(first.embedId);
    expect(second).toMatchObject({ idempotent: true });
    expect(liveRows[0]?._id).toBe(first.embedId);
    expect(liveRows[0]?.placementState).toBe("provisional");
    expect(liveRows[0]?.removedAt).toBeUndefined();
  });

  it("short-circuits a second create while the row is still live", async () => {
    const t = setupTest();
    const fixture = await seedPlacementFixture(t);
    const asOwner = t.withIdentity(identity);
    const placementOperationId = "live-idempotent-same-op";
    const args = createArgs(fixture, placementOperationId);
    const first = await asOwner.mutation(api.artifactEmbeds.create, args);
    const second = await asOwner.mutation(api.artifactEmbeds.create, args);
    expect(second).toEqual({ embedId: first.embedId, idempotent: true });
    expect(
      await rowsForOp(t, String(fixture.containerArtifactId), placementOperationId),
    ).toHaveLength(1);
  });

  it("keeps restore as the host Undo path without colliding with create revive", async () => {
    const t = setupTest();
    const fixture = await seedPlacementFixture(t);
    const asOwner = t.withIdentity(identity);
    const placementOperationId = "restore-undo-same-op";
    const args = createArgs(fixture, placementOperationId);
    const first = await asOwner.mutation(api.artifactEmbeds.create, args);
    await asOwner.mutation(api.artifactEmbeds.remove, { embedId: first.embedId });
    const restored = await asOwner.mutation(api.artifactEmbeds.restore, {
      embedId: first.embedId,
    });
    expect(restored).toEqual({ restored: true });
    const row = await t.run((ctx) => ctx.db.get(first.embedId));
    expect(row?.removedAt).toBeUndefined();
    // restore of a soft-removed provisional marks confirmed (host undo path).
    expect(row?.placementState).toBe("confirmed");
    expect(
      await rowsForOp(t, String(fixture.containerArtifactId), placementOperationId),
    ).toHaveLength(1);
  });

  it("inserts a fresh row after provisional purge/expiry hard-deletes the prior placement", async () => {
    const t = setupTest();
    const fixture = await seedPlacementFixture(t);
    const asOwner = t.withIdentity(identity);
    const placementOperationId = "purge-then-recreate-same-op";
    const args = createArgs(fixture, placementOperationId);
    const first = await asOwner.mutation(api.artifactEmbeds.create, args);
    await t.run((ctx) =>
      ctx.db.patch(first.embedId, { placementExpiresAt: Date.now() - 1 }),
    );
    const expire = (
      internal as unknown as { artifactEmbeds: { expireProvisional: unknown } }
    ).artifactEmbeds.expireProvisional as never;
    const runInternal = (
      t as unknown as { mutation: (fn: unknown, args: unknown) => Promise<unknown> }
    ).mutation.bind(t);
    await expect(
      runInternal(expire, {
        embedId: first.embedId,
        placementOperationId,
      }),
    ).resolves.toMatchObject({ expired: true });
    expect(await t.run((ctx) => ctx.db.get(first.embedId))).toBeNull();

    const second = await asOwner.mutation(api.artifactEmbeds.create, args);
    expect(second.embedId).not.toBe(first.embedId);
    expect("idempotent" in second ? second.idempotent : false).toBeFalsy();
    const rows = await rowsForOp(
      t,
      String(fixture.containerArtifactId),
      placementOperationId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?._id).toBe(second.embedId);
  });

  it("survives repeated soft-remove then create cycles on one placementOperationId", async () => {
    const t = setupTest();
    const fixture = await seedPlacementFixture(t);
    const asOwner = t.withIdentity(identity);
    const placementOperationId = "repeated-soft-remove-create";
    const args = createArgs(fixture, placementOperationId);
    const first = await asOwner.mutation(api.artifactEmbeds.create, args);
    for (let i = 0; i < 3; i += 1) {
      await asOwner.mutation(api.artifactEmbeds.remove, { embedId: first.embedId });
      const again = await asOwner.mutation(api.artifactEmbeds.create, args);
      expect(again.embedId).toBe(first.embedId);
    }
    expect(
      await rowsForOp(t, String(fixture.containerArtifactId), placementOperationId),
    ).toHaveLength(1);
  });
});
