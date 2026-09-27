/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const identity = {
  subject: "retained-reader",
  email: "retained-reader@example.test",
  emailVerified: true,
};

async function fixture(
  level: "read" | "modify" = "read",
  kind: "code" | "quiz" = "code",
) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Retained consumer fixtures",
      slug: "retained-consumers",
      verifiedDomains: [],
      status: "active",
      timezone: "Europe/Madrid",
      policyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const accounts = [];
    for (const clerkId of [identity.subject, "retained-source-owner"]) {
      const id = await ctx.db.insert("accounts", {
        clerkId,
        email: `${clerkId}@example.test`,
        emailVerified: true,
        name: clerkId,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("schoolMemberships", {
        accountId: id,
        schoolId,
        role: "student",
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      accounts.push(id);
    }
    const [readerId, ownerId] = accounts;
    const resourceId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: readerId,
      schoolId,
      blueprintKey: "document",
      title: "Current resource",
      content: { text: "CURRENT_RESOURCE_SECRET" },
      tags: [],
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const sourceId = await ctx.db.insert("spectraArtifacts", {
      ownerAccountId: ownerId,
      schoolId,
      blueprintKey: kind,
      title: "LATEST_TITLE",
      summary: "LATEST_SUMMARY",
      tags: ["LATEST_TAG"],
      content: {
        resourceBindings: [
          {
            id: "LATEST_BINDING",
            artifactId: String(resourceId),
            kind: "artifact",
          },
        ],
      },
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const pinnedVersionId = await ctx.db.insert("spectraArtifactVersions", {
      artifactId: sourceId,
      ownerAccountId: ownerId,
      schoolId,
      source: "manual",
      createdAt: now - 10,
      after: {
        title: "PINNED_TITLE",
        summary: "PINNED_SUMMARY",
        tags: ["PINNED_TAG"],
        content:
          kind === "quiz"
            ? {
                questions: [
                  {
                    id: "q1",
                    question: "Question",
                    correctAnswer: "PRIVATE_ANSWER",
                    explanation: "PRIVATE_EXPLANATION",
                  },
                ],
              }
            : {
                files: [
                  { path: "index.html", source: "<main>PINNED_BODY</main>" },
                ],
              },
      },
    });
    const latestVersionId = await ctx.db.insert("spectraArtifactVersions", {
      artifactId: sourceId,
      ownerAccountId: ownerId,
      schoolId,
      source: "manual",
      createdAt: now,
      after: { title: "LATEST_TITLE", content: { text: "LATEST_BODY" } },
    });
    await ctx.db.patch(sourceId, { currentVersionId: latestVersionId });
    const grantId = await ctx.db.insert("accessGrants", {
      schoolId,
      resourceType: "artifact",
      resourceId: String(sourceId),
      principalType: "account",
      principalId: String(readerId),
      level,
      capabilities: level === "modify" ? ["read", "modify"] : ["read"],
      source: "direct",
      createdByAccountId: ownerId,
      createdAt: now,
      updatedAt: now,
    });
    const threadId = await ctx.db.insert("spectraThreads", {
      ownerAccountId: readerId,
      schoolId,
      title: "Reader's conversation",
      origin: "chat",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const bytes = JSON.stringify({ version: "pinned" });
    const storageId = await ctx.storage.store(
      new Blob([bytes], { type: "application/json" }),
    );
    const payloadHash = createHash("sha256").update(bytes).digest("hex");
    const commonBuild = {
      artifactId: sourceId,
      schoolId,
      createdByAccountId: ownerId,
      runtime: "browser" as const,
      runtimeVersion: "1",
      sourceHash: "a".repeat(64),
      sdkVersion: "1",
      entryFileId: "index.html",
      dependencies: {},
      sourceBytes: 2,
      outputBytes: 2,
      payloadBytes: Buffer.byteLength(bytes),
      storageId,
      payloadHash,
      createdAt: now,
    };
    const pinnedBuildId = await ctx.db.insert("spectraRuntimeBuilds", {
      ...commonBuild,
      artifactVersionId: pinnedVersionId,
      status: "superseded",
      updatedAt: now - 10,
    });
    await ctx.db.insert("spectraRuntimeBuilds", {
      ...commonBuild,
      artifactVersionId: latestVersionId,
      status: "published",
      updatedAt: now,
    });
    return {
      sourceId,
      resourceId,
      pinnedVersionId,
      latestVersionId,
      grantId,
      threadId,
      pinnedBuildId,
      payloadHash,
    };
  });
  const reader = t.withIdentity(identity);
  // Thread placements have no second canonical write; exercise the real creator
  // rather than assigning a successful placement state in the positive fixture.
  const { embedId } = await reader.mutation(api.artifactEmbeds.create, {
    containerType: "thread",
    containerId: String(ids.threadId),
    containerRegionId: `thread:work:${ids.sourceId}`,
    sourceArtifactId: ids.sourceId,
    mode: "compact",
    interaction: level === "modify" ? "edit" : "read",
    versionPolicy: "pinned",
    pinnedVersionId: ids.pinnedVersionId,
    contextPolicy: "summary",
  });
  // Isolate consumer authorization from the separately owned deletion/GC job.
  await t.run((ctx) => ctx.db.patch(ids.sourceId, { status: "deleted" }));
  return {
    t,
    reader,
    ...ids,
    embedId,
    projection: () =>
      reader.query(api.artifactEmbeds.getProjection, { embedId }),
    runtime: () =>
      reader.query(api.artifactEmbeds.runtimeBuildAccess, { embedId }),
  };
}

describe("retained embed projection and authenticated runtime consumers", () => {
  it("returns only the independently authorized pinned snapshot and exact build", async () => {
    const f = await fixture();
    const projection = await f.projection();
    expect(projection).toMatchObject({
      state: "ready",
      sourceUnavailable: true,
      source: {
        title: "PINNED_TITLE",
        summary: "PINNED_SUMMARY",
        tags: ["PINNED_TAG"],
      },
      runtimeBuild: {
        buildId: f.pinnedBuildId,
        artifactVersionId: f.pinnedVersionId,
      },
    });
    expect(JSON.stringify(projection)).toContain("PINNED_BODY");
    expect(JSON.stringify(projection)).not.toContain("LATEST_");
    expect(await f.runtime()).toMatchObject({
      artifactVersionId: f.pinnedVersionId,
      payloadHash: f.payloadHash,
    });
  });

  it.each(["absent", "revoked", "expired"] as const)(
    "denies retained content when the independent source grant is %s",
    async (state) => {
      const f = await fixture();
      await f.t.run(async (ctx) => {
        if (state === "absent") await ctx.db.delete(f.grantId);
        else if (state === "revoked")
          await ctx.db.patch(f.grantId, { revokedAt: Date.now() });
        else await ctx.db.patch(f.grantId, { expiresAt: Date.now() - 1 });
      });
      const projection = await f.projection();
      expect(projection).toMatchObject({ state: "no_access" });
      expect(JSON.stringify(projection)).not.toContain("PINNED_BODY");
      await expect(f.runtime()).rejects.toThrow();
    },
  );

  it("does not use the newer published build when the pinned build is unavailable", async () => {
    const f = await fixture();
    await f.t.run((ctx) => ctx.db.patch(f.pinnedBuildId, { status: "failed" }));
    expect(await f.projection()).not.toHaveProperty("runtimeBuild.buildId");
    await expect(f.runtime()).rejects.toThrow("RUNTIME_BUILD_UNAVAILABLE");
  });

  it.each(["missing", "wrong_source"] as const)(
    "does not expose current metadata when the exact pinned version is %s",
    async (state) => {
      const f = await fixture();
      await f.t.run(async (ctx) => {
        if (state === "missing") await ctx.db.delete(f.pinnedVersionId);
        else
          await ctx.db.patch(f.pinnedVersionId, { artifactId: f.resourceId });
      });
      const projection = await f.projection();
      expect(projection).toMatchObject({ state: "version_unavailable" });
      expect(JSON.stringify(projection)).not.toContain("LATEST_");
      expect(JSON.stringify(projection)).not.toContain("PINNED_BODY");
      await expect(f.runtime()).rejects.toThrow();
    },
  );

  it.each(["provisional", "removed", "missing"] as const)(
    "does not expose a %s thread placement",
    async (state) => {
      const f = await fixture();
      await f.t.run((ctx) =>
        ctx.db.patch(f.embedId, {
          placementState: state === "missing" ? undefined : state,
          ...(state === "removed" ? { removedAt: Date.now() } : {}),
        }),
      );
      const projection = await f.projection();
      expect(projection?.state).not.toBe("ready");
      expect(JSON.stringify(projection)).not.toContain("PINNED_BODY");
      await expect(f.runtime()).rejects.toThrow();
    },
  );

  it("denies a deleted host even when the independent source grant survives", async () => {
    const f = await fixture();
    await f.t.run((ctx) => ctx.db.patch(f.threadId, { status: "deleted" }));
    expect(await f.projection()).toBeNull();
    await expect(f.runtime()).rejects.toThrow();
  });

  it("does not resolve current resource bindings when the pinned snapshot has no content", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
      ctx.db.patch(f.pinnedVersionId, { after: { title: "PINNED_TITLE" } }),
    );
    const projection = await f.projection();
    expect(projection).toMatchObject({ state: "ready" });
    expect(projection).not.toHaveProperty("runtimeResources.LATEST_BINDING");
    expect(JSON.stringify(projection)).not.toContain("CURRENT_RESOURCE_SECRET");
  });

  it("preserves ordinary active-source behavior after the source is restored", async () => {
    const f = await fixture();
    await f.t.run((ctx) => ctx.db.patch(f.sourceId, { status: "active" }));
    expect(await f.projection()).toMatchObject({
      state: "ready",
      sourceUnavailable: false,
      source: { title: "LATEST_TITLE" },
    });
    expect(await f.runtime()).toMatchObject({
      artifactVersionId: f.pinnedVersionId,
    });
  });

  it.each(["read", "modify"] as const)(
    "keeps retained quiz redaction for %s source access without granting edits",
    async (level) => {
      const f = await fixture(level, "quiz");
      const projection = await f.projection();
      expect(projection).toMatchObject({
        state: "ready",
        effectiveInteraction: "read",
      });
      if (level === "read")
        expect(JSON.stringify(projection)).not.toContain("PRIVATE_ANSWER");
      else expect(JSON.stringify(projection)).toContain("PRIVATE_ANSWER");
    },
  );
});
