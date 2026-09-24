/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { PAYLOAD_RELEASE_GRACE_MS } from "../shared/replica-truth";
import { releaseArtifactIntakePage } from "./artifactIntakeLifecycle";
import { reconcileDurablePayloadOwners } from "./durablePayloadOwnership";

const modules = import.meta.glob("./**/*.ts");

async function fixture() {
  const t = convexTest(schema, modules);
  for (const name of ["orgNodeCountByType", "orgNodeCountByWorkspace", "orgNodeCountByParent"]) aggregateTest.register(t, name);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", {
      name: "Durable review", slug: "durable-review", verifiedDomains: [],
      status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now,
    });
    const accountId = await ctx.db.insert("accounts", {
      clerkId: "durable-review", email: "review@example.test", emailVerified: true,
      name: "Review", status: "active", createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("schoolMemberships", {
      schoolId, accountId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now,
    });
    const artifactId = await ctx.db.insert("spectraArtifacts", {
      schoolId, ownerAccountId: accountId, blueprintKey: "document", title: "Fixture",
      content: {}, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now,
    });
    return { accountId, artifactId, schoolId };
  });
  const bytes = "immutable native or durable bytes";
  const storageId = await t.run(ctx => ctx.storage.store(new Blob([bytes], { type: "application/octet-stream" })));
  const hash = createHash("sha256").update(bytes).digest("hex");
  const actor = t.withIdentity({ subject: "durable-review", email: "review@example.test", emailVerified: true });
  return { t, ids, bytes, hash, storageId, actor };
}

it.each(["durable", "native", "quarantined-native"] as const)(
  "preserves a third %s storage binding through asset revocation and releases only the final owner",
  async family => {
    const { t, ids, bytes, hash, storageId, actor } = await fixture();
    const { assetId, activeId } = await t.run(async ctx => {
      const now = Date.now();
      let activeId = "";
      for (let index = 0; index < 3; index++) {
        if (family === "durable") {
          activeId = await ctx.db.insert("collaborationDurablePayloads", {
            artifactId: ids.artifactId, accountId: ids.accountId, storageId,
            kind: "projection", digest: hash, byteLength: Buffer.byteLength(bytes),
            mediaType: "application/octet-stream", manifestVersion: 1, policyVersion: 0,
            status: index === 2 ? "active" : "released", createdAt: now - PAYLOAD_RELEASE_GRACE_MS - 1,
          });
        } else {
          activeId = await ctx.db.insert("payloadObjects", {
            accountId: ids.accountId, storageId, hash, bytes: Buffer.byteLength(bytes),
            mediaType: "application/octet-stream", refCount: 0,
            state: index === 2 ? family === "native" ? "active" : "quarantined" : "released",
            createdAt: now, verifiedAt: now,
          });
        }
      }
      const assetId = await ctx.db.insert("artifactAssets", {
        artifactId: ids.artifactId, uploadedByAccountId: ids.accountId, storageId,
        path: "legacy/shared", name: "Shared legacy bytes", mediaType: "application/octet-stream",
        bytes: Buffer.byteLength(bytes), sha256: hash, status: "active", createdAt: now, updatedAt: now,
      });
      return { assetId, activeId };
    });
    expect(await actor.mutation(api.artifactAssets.revoke, { assetId })).toMatchObject({ revoked: true });
    expect(await t.run(async ctx => (await ctx.storage.get(storageId))?.text())).toBe(bytes);
    if (family === "quarantined-native") {
      // Quarantine is a live binding; administrative resolution owns its release.
      expect(await t.mutation(internal.durablePayloadOwnership.release, { payloadRef: activeId })).toBe(false);
      expect(await t.run(ctx => ctx.db.system.get(storageId))).not.toBeNull();
    } else {
      expect(await t.mutation(internal.durablePayloadOwnership.release, { payloadRef: activeId })).toBe(true);
      expect(await t.run(ctx => ctx.db.system.get(storageId))).toBeNull();
    }
  },
);

it("rejects a native upload with a correct size and a false digest before creating a verified payload", async () => {
  const { t, ids, bytes, storageId, actor } = await fixture();
  await expect(actor.mutation(api.payloads.put, {
    workId: ids.artifactId, storageId, hash: "0".repeat(64),
    bytes: Buffer.byteLength(bytes), mediaType: "application/octet-stream",
  })).rejects.toThrow("PAYLOAD_HASH_MISMATCH");
  expect(await t.run(ctx => ctx.db.query("payloadObjects").collect())).toHaveLength(0);
  expect(await t.run(ctx => ctx.db.system.get(storageId))).not.toBeNull();
});

it("does not deduplicate a verified upload onto a corrupt existing native hash slot", async () => {
  const { t, ids, bytes, hash, storageId, actor } = await fixture();
  const corruptStorage = await t.run(ctx => ctx.storage.store(new Blob(["x".repeat(Buffer.byteLength(bytes))])));
  await t.run(ctx => ctx.db.insert("payloadObjects", {
    accountId: ids.accountId, hash, storageId: corruptStorage, bytes: Buffer.byteLength(bytes),
    mediaType: "application/octet-stream", refCount: 0, state: "active", createdAt: Date.now(), verifiedAt: Date.now(),
  }));
  await expect(actor.mutation(api.payloads.put, {
    workId: ids.artifactId, storageId, hash, bytes: Buffer.byteLength(bytes), mediaType: "application/octet-stream",
  })).rejects.toThrow("PAYLOAD_HASH_MISMATCH");
  expect(await t.run(ctx => ctx.db.system.get(storageId))).not.toBeNull();
});

it("adopts genuine native bytes and retries without removing an independent redundant upload", async () => {
  const { t, ids, bytes, hash, storageId, actor } = await fixture();
  const args = { workId: ids.artifactId, storageId, hash, bytes: Buffer.byteLength(bytes), mediaType: "application/octet-stream" };
  const first = await actor.mutation(api.payloads.put, args);
  expect(first.deduplicated).toBe(false);
  expect(await actor.mutation(api.payloads.put, args)).toEqual({ ...first, deduplicated: true });
  const redundantId = await t.run(ctx => ctx.storage.store(new Blob([bytes], { type: "application/octet-stream" })));
  expect(await actor.mutation(api.payloads.put, { ...args, storageId: redundantId })).toEqual({ ...first, deduplicated: true });
  expect(await t.run(ctx => ctx.db.system.get(redundantId))).not.toBeNull();
});

it("rejects native dependency overflow instead of adopting a silently truncated owner set", async () => {
  const { t, ids, bytes, hash, storageId, actor } = await fixture();
  await t.run(async ctx => {
    for (let index = 0; index < 51; index++) await ctx.db.insert("workReplicas", {
      accountId: ids.accountId, workId: ids.artifactId, kind: "local", nativeFormat: "docx",
      revision: `fixture-${index}`, state: "unavailable", updatedAt: Date.now(),
    });
  });
  await expect(actor.mutation(internal.artifactContent.adopt, {
    artifactId: ids.artifactId, storageId, digest: hash, byteLength: Buffer.byteLength(bytes), policyVersion: 0,
  })).rejects.toThrow("COLLABORATION_CONTENT_DEPENDENCIES_SIZE");
  expect(await t.run(ctx => ctx.db.query("collaborationDurablePayloads").collect())).toHaveLength(0);
  expect(await t.run(ctx => ctx.db.system.get(storageId))).not.toBeNull();
});

it.each(["wide", "deep", "unreadable"] as const)(
  "retains pinned intake bytes when the snapshot reference scan is %s, then releases after unpinning",
  async shape => {
    const { t, ids, bytes, hash, storageId } = await fixture();
    const { assetId, pinId } = await t.run(async ctx => {
      const now = Date.now();
      await ctx.db.patch(ids.artifactId, { status: "deleted" });
      const containerId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: ids.accountId, schoolId: ids.schoolId, blueprintKey: "document", title: "Pin owner",
        content: {}, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now,
      });
      const assetId = await ctx.db.insert("artifactAssets", {
        artifactId: ids.artifactId, schoolId: ids.schoolId, uploadedByAccountId: ids.accountId, storageId,
        path: "pinned/image", name: "Retained asset", mediaType: "application/octet-stream",
        bytes: Buffer.byteLength(bytes), sha256: hash, status: "active", createdAt: now, updatedAt: now,
      });
      let after: unknown = { assetId };
      if (shape === "wide") after = { cells: Array(12_010).fill(0), image: { assetId } };
      if (shape === "deep") for (let depth = 0; depth < 12; depth++) after = { nested: after };
      const pinnedVersionId = await ctx.db.insert("spectraArtifactVersions", {
        artifactId: ids.artifactId, ownerAccountId: ids.accountId, schoolId: ids.schoolId,
        source: "manual", schemaVersion: 2, createdAt: now,
        ...(shape === "unreadable" ? { snapshotRef: "missing-snapshot" } : { after }),
      });
      const pinId = await ctx.db.insert("artifactEmbeds", {
        containerType: "artifact", containerId: String(containerId), containerRegionId: "fixture:pin",
        sourceArtifactId: ids.artifactId, schoolId: ids.schoolId, mode: "compact", interaction: "read",
        versionPolicy: "pinned", pinnedVersionId, contextPolicy: "summary", createdByAccountId: ids.accountId,
        createdAt: now, updatedAt: now,
      });
      return { assetId, pinId };
    });
    const releasePage = () => t.run(ctx => releaseArtifactIntakePage(ctx, {
      artifactId: ids.artifactId, ownerAccountId: ids.accountId, cursor: null,
    }));
    expect(await releasePage()).toMatchObject({ retainedRows: 1, releasedBytes: 0 });
    expect(await t.run(ctx => ctx.db.get(assetId))).toMatchObject({ status: "active" });
    expect(await t.run(async ctx => (await ctx.storage.get(storageId))?.text())).toBe(bytes);
    await t.run(ctx => ctx.db.patch(pinId, { removedAt: Date.now() }));
    expect(await releasePage()).toMatchObject({ retainedRows: 0, releasedBytes: Buffer.byteLength(bytes) });
    expect(await t.run(ctx => ctx.db.system.get(storageId))).toBeNull();
  },
);

it.each(["runtime", "attachment"] as const)(
  "deleting a %s storage alias preserves the other artifact's durable body until its final release",
  async family => {
    const { t, ids, bytes, hash, storageId, actor } = await fixture();
    const { survivorId, payloadRef } = await t.run(async ctx => {
      const now = Date.now();
      const survivorId = await ctx.db.insert("spectraArtifacts", {
        ownerAccountId: ids.accountId, schoolId: ids.schoolId, blueprintKey: "document", title: "Survivor",
        content: {}, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now,
      });
      const payloadRef = await ctx.db.insert("collaborationDurablePayloads", {
        artifactId: survivorId, accountId: ids.accountId, storageId, kind: "projection", digest: hash,
        byteLength: Buffer.byteLength(bytes), mediaType: "application/octet-stream", manifestVersion: 1,
        status: "active", createdAt: now - PAYLOAD_RELEASE_GRACE_MS - 1,
      });
      await reconcileDurablePayloadOwners(ctx, "spectraArtifacts", String(survivorId), { payloadRef });
      if (family === "runtime") {
        const versionId = await ctx.db.insert("spectraArtifactVersions", {
          artifactId: ids.artifactId, ownerAccountId: ids.accountId, schoolId: ids.schoolId,
          source: "manual", schemaVersion: 2, after: {}, createdAt: now,
        });
        await ctx.db.insert("spectraRuntimeBuilds", {
          artifactId: ids.artifactId, artifactVersionId: versionId, createdByAccountId: ids.accountId,
          runtime: "browser", status: "published", sourceHash: hash, payloadHash: hash,
          sdkVersion: "fixture", entryFileId: "index.html", dependencies: {}, storageId,
          sourceBytes: Buffer.byteLength(bytes), outputBytes: Buffer.byteLength(bytes), payloadBytes: Buffer.byteLength(bytes),
          createdAt: now, updatedAt: now,
        });
      } else {
        const runId = await ctx.db.insert("spectraAiRuns", {
          ownerAccountId: ids.accountId, schoolId: ids.schoolId, sourceSurface: "artifact",
          artifactId: ids.artifactId, status: "completed", userPrompt: "Fixture", createdAt: now, updatedAt: now,
        });
        await ctx.db.insert("spectraRunAttachments", {
          runId, executionId: "fixture", ownerAccountId: ids.accountId, storageId, sha256: hash,
          status: "active", name: "legacy.txt", mimeType: "application/octet-stream",
          size: Buffer.byteLength(bytes), handling: "text", createdAt: now,
        });
      }
      return { survivorId, payloadRef: String(payloadRef) };
    });
    const deletion = await actor.mutation(api.spectraArtifacts.permanentlyDelete, { artifactId: ids.artifactId });
    for (let step = 0; step < 100; step++) {
      const job = await t.run(ctx => ctx.db.get(deletion.jobId));
      if (job?.phase === "complete") break;
      expect(job?.phase).not.toBe("failed");
      await t.mutation(internal.spectraArtifactDeletion.process, { jobId: deletion.jobId, generation: 1 });
    }
    expect(await t.run(ctx => ctx.db.get(deletion.jobId))).toMatchObject({ phase: "complete", releasedBytes: 0 });
    expect(await t.run(async ctx => (await ctx.storage.get(storageId))?.text())).toBe(bytes);
    await t.run(ctx => reconcileDurablePayloadOwners(ctx, "spectraArtifacts", String(survivorId), null));
    expect(await t.mutation(internal.durablePayloadOwnership.release, { payloadRef })).toBe(true);
    expect(await t.run(ctx => ctx.db.system.get(storageId))).toBeNull();
  },
);
