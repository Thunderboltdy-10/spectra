/// <reference types="vite/client" />
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { evaluateRetainedPinAccess } from "./retainedPinAccess";
import { evaluateAccessForActor } from "./authorityShared";
import { getActorForAccountId } from "./identityShared";
import { canReadPinnedContent } from "./retainedContentAccess";
import { isSurvivingPinnedEmbed } from "./artifactEmbedOwnership";
import { NATIVE_VERSION_OWNER_TABLE } from "./durablePayloadOwnership";

const modules = import.meta.glob("./**/*.ts");

async function fixture(blueprintKey = "document") {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "Pin authority", slug: "pin-authority", verifiedDomains: [], status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now });
    const foreignSchoolId = await ctx.db.insert("schools", { name: "Foreign school", slug: "foreign-pin", verifiedDomains: [], status: "active", timezone: "Europe/Madrid", policyVersion: 1, createdAt: now, updatedAt: now });
    const accounts = [];
    const memberships = [];
    for (const name of ["pin-owner", "pin-reader"]) {
      const accountId = await ctx.db.insert("accounts", { clerkId: name, email: `${name}@example.test`, emailVerified: true, name, status: "active", createdAt: now, updatedAt: now });
      accounts.push(accountId);
      memberships.push(await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now }));
    }
    const [ownerId, readerId] = accounts;
    const sourceId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: ownerId, schoolId, blueprintKey, title: "Deleted source", content: {}, tags: [], status: "deleted", createdAt: now, updatedAt: now });
    const threadId = await ctx.db.insert("spectraThreads", { ownerAccountId: readerId, schoolId, title: "Current host", origin: "chat", status: "active", createdAt: now, updatedAt: now });
    const versionId = await ctx.db.insert("spectraArtifactVersions", { artifactId: sourceId, ownerAccountId: ownerId, schoolId, source: "manual", after: { blocks: [{ id: "p", type: "paragraph", text: "Exact pinned body" }] }, createdAt: now });
    const embedId = await ctx.db.insert("artifactEmbeds", { containerType: "thread", containerId: String(threadId), containerRegionId: "message:pin", sourceArtifactId: sourceId, schoolId, mode: "compact", interaction: "read", versionPolicy: "pinned", pinnedVersionId: versionId, contextPolicy: "summary", createdByAccountId: readerId, placementState: "confirmed", createdAt: now, updatedAt: now });
    return { schoolId, foreignSchoolId, ownerId, readerId, membershipId: memberships[1], sourceId, threadId, versionId, embedId };
  });
  const actor = (await t.run(ctx => getActorForAccountId(ctx, ids.readerId)))!;
  const reader = t.withIdentity({ subject: "pin-reader", email: "pin-reader@example.test", emailVerified: true });
  const evaluate = () => t.run(ctx => evaluateRetainedPinAccess(ctx, actor, ids.embedId));
  const grant = (overrides: Partial<Doc<"accessGrants">> = {}) => t.run(ctx => ctx.db.insert("accessGrants", {
    schoolId: ids.schoolId, resourceType: blueprintKey === "agent" ? "agent" : "artifact", resourceId: ids.sourceId,
    principalType: "account", principalId: ids.readerId, level: "read", capabilities: ["read"], source: "direct",
    createdByAccountId: ids.ownerId, createdAt: Date.now(), updatedAt: Date.now(), ...overrides,
  }));
  return { t, ids, actor, reader, evaluate, grant };
}

describe("exact retained pin source authority", () => {
  it("denies host-only access without changing retained ownership", async () => {
    const f = await fixture();
    const before = await f.t.run(ctx => ctx.db.get(f.ids.embedId));
    expect(await f.evaluate()).toEqual({ allowed: false, reason: "source_forbidden" });
    expect(await f.t.run(ctx => canReadPinnedContent(ctx, f.actor, f.ids.sourceId, () => true))).toBe(false);
    const after = await f.t.run(ctx => ctx.db.get(f.ids.embedId));
    expect(after).toEqual(before);
    expect(isSurvivingPinnedEmbed(after!)).toBe(true);
  });

  it.each(["owner", "read", "modify"] as const)("grants only retained read with independent %s source permission", async level => {
    const f = await fixture("quiz");
    if (level === "owner") await f.t.run(ctx => ctx.db.patch(f.ids.sourceId, { ownerAccountId: f.ids.readerId }));
    else await f.grant({ level });
    expect(await f.evaluate()).toMatchObject({ allowed: true, sourceLevel: level === "read" ? "read" : "modify", capabilities: ["read"], version: { _id: f.ids.versionId } });
    expect(await f.t.run(ctx => evaluateAccessForActor(ctx, f.actor, "artifact", f.ids.sourceId))).toMatchObject({ allowed: false, reason: "deleted" });
    expect(await f.t.run(ctx => canReadPinnedContent(ctx, f.actor, f.ids.sourceId,
      (snapshot, version) => version._id === f.ids.versionId && JSON.stringify(snapshot).includes("Exact pinned body")))).toBe(true);
  });

  it.each(["revoked", "expired", "membership", "account", "school"] as const)("rechecks current %s authority", async change => {
    const f = await fixture();
    const grantId = await f.grant();
    expect((await f.evaluate()).allowed).toBe(true);
    await f.t.run(async ctx => {
      if (change === "revoked") await ctx.db.patch(grantId, { revokedAt: Date.now() });
      if (change === "expired") await ctx.db.patch(grantId, { expiresAt: Date.now() - 1 });
      if (change === "membership") await ctx.db.delete(f.ids.membershipId);
      if (change === "account") await ctx.db.patch(f.ids.readerId, { status: "deactivated" });
      if (change === "school") await ctx.db.patch(f.ids.membershipId, { schoolId: f.ids.foreignSchoolId });
    });
    expect(await f.evaluate()).toEqual({ allowed: false, reason: "source_forbidden" });
  });

  it("requires an account grant for a foreign source and preserves agent grant scope", async () => {
    const f = await fixture("agent");
    await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.sourceId, { schoolId: f.ids.foreignSchoolId });
      await ctx.db.patch(f.ids.versionId, { schoolId: f.ids.foreignSchoolId });
    });
    await f.grant({ principalType: "school", principalId: f.ids.schoolId });
    await f.grant({ resourceType: "artifact" });
    expect(await f.evaluate()).toEqual({ allowed: false, reason: "source_forbidden" });
    await f.grant();
    expect(await f.evaluate()).toMatchObject({ allowed: true, capabilities: ["read"] });
  });

  it.each([
    { placementState: "provisional" }, { placementState: undefined }, { placementState: "removed", removedAt: 1 },
    { placementExpiresAt: 1 }, { versionPolicy: "live" }, { pinnedVersionId: undefined },
  ] as Array<Partial<Doc<"artifactEmbeds">>>)("rejects an unavailable thread placement %j", async patch => {
    const f = await fixture();
    await f.grant();
    await f.t.run(ctx => ctx.db.patch(f.ids.embedId, patch));
    expect(await f.evaluate()).toEqual({ allowed: false, reason: "placement_unavailable" });
  });

  it("accepts omitted legacy school fields only through current host and exact version binding", async () => {
    const f = await fixture();
    await f.grant();
    await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.embedId, { schoolId: undefined });
      await ctx.db.patch(f.ids.versionId, { schoolId: undefined });
    });
    expect((await f.evaluate()).allowed).toBe(true);
    await f.t.run(ctx => ctx.db.patch(f.ids.versionId, { schoolId: f.ids.foreignSchoolId }));
    expect(await f.evaluate()).toEqual({ allowed: false, reason: "version_unavailable" });
  });

  it("rejects a mismatched version and a deleted or foreign host", async () => {
    const f = await fixture();
    await f.grant();
    await f.t.run(async ctx => {
      const other = await ctx.db.insert("spectraArtifacts", { ownerAccountId: f.ids.readerId, schoolId: f.ids.schoolId, blueprintKey: "document", title: "Unrelated", content: {}, tags: [], status: "active", createdAt: Date.now(), updatedAt: Date.now() });
      await ctx.db.patch(f.ids.versionId, { artifactId: other });
    });
    expect(await f.evaluate()).toEqual({ allowed: false, reason: "version_unavailable" });
    await f.t.run(async ctx => {
      await ctx.db.patch(f.ids.versionId, { artifactId: f.ids.sourceId });
      await ctx.db.patch(f.ids.threadId, { status: "deleted" });
    });
    expect(await f.evaluate()).toEqual({ allowed: false, reason: "host_unavailable" });
    await f.t.run(ctx => ctx.db.patch(f.ids.threadId, { status: "active", schoolId: f.ids.foreignSchoolId }));
    expect(await f.evaluate()).toEqual({ allowed: false, reason: "host_unavailable" });
  });

  it("keeps unavailable snapshot data unavailable instead of falling back to current source content", async () => {
    const f = await fixture();
    await f.grant();
    await f.t.run(ctx => ctx.db.patch(f.ids.versionId, { after: undefined }));
    expect(await f.t.run(ctx => canReadPinnedContent(ctx, f.actor, f.ids.sourceId, () => true))).toBe(false);
  });

  it.each(["provisional", "confirmed", undefined] as const)("proves actual artifact placement independently of the %s state flag", async placementState => {
    const f = await fixture();
    await f.grant();
    const hostId = await f.t.run(async ctx => {
      const now = Date.now();
      const hostId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: f.ids.readerId, schoolId: f.ids.schoolId, blueprintKey: "document", title: "Host document", content: {}, tags: [], status: "draft", createdAt: now, updatedAt: now });
      await ctx.db.patch(f.ids.embedId, { containerType: "artifact", containerId: String(hostId), containerRegionId: "reference:one", placementState });
      const attrs = { embedId: String(f.ids.embedId), containerType: "artifact", containerId: String(hostId), containerRegionId: "reference:one", sourceArtifactId: String(f.ids.sourceId), versionPolicy: "pinned", pinnedVersionId: String(f.ids.versionId), blockId: "reference:one" };
      await ctx.db.patch(hostId, { content: { tiptap: { type: "doc", content: [{ type: "spectraReference", attrs }] } } });
      return hostId;
    });
    expect(await f.evaluate()).toMatchObject({ allowed: true, capabilities: ["read"] });
    await f.t.run(ctx => ctx.db.patch(hostId, { content: { blocks: [], metadata: { embedId: f.ids.embedId } } }));
    const missing = await f.evaluate();
    expect(missing).toEqual({ allowed: false, reason: "placement_unavailable", placementRefreshKey: expect.any(String) });
    await f.t.run(ctx => ctx.db.patch(hostId, { updatedAt: Date.now() + 500 }));
    expect(await f.evaluate()).toEqual(missing);
    await f.t.run(ctx => ctx.db.patch(hostId, { content: { blocks: [{ id: "p", type: "paragraph", text: "New head" }] } }));
    const changed = await f.evaluate();
    expect(changed).toMatchObject({ allowed: false, reason: "placement_unavailable" });
    expect(changed).not.toEqual(missing);
    await f.t.run(ctx => ctx.db.patch(hostId, { ownerAccountId: f.ids.ownerId }));
    expect(await f.evaluate()).toEqual({ allowed: false, reason: "host_unavailable" });
  });

  it("uses current independent workspace inheritance and its deny override", async () => {
    const f = await fixture();
    await f.t.run(async ctx => {
      const now = Date.now();
      const workspaceId = await ctx.db.insert("spectraWorkspaces", { ownerAccountId: f.ids.ownerId, schoolId: f.ids.schoolId, title: "Source workspace", status: "active", defaultView: "cards", createdAt: now, updatedAt: now, lastActivityAt: now });
      await ctx.db.insert("orgNodes", { accountId: f.ids.ownerId, schoolId: f.ids.schoolId, parentId: null, kind: "work", name: "Source placement", sourceId: f.ids.sourceId, orderKey: "a0", typeKey: "document", workspaceContextId: workspaceId, placedByAccountId: f.ids.ownerId, accessProjection: true, createdAt: now, updatedAt: now });
      await ctx.db.insert("accessGrants", { schoolId: f.ids.schoolId, resourceType: "workspace", resourceId: workspaceId, principalType: "account", principalId: f.ids.readerId, level: "modify", capabilities: ["read", "modify"], source: "direct", createdByAccountId: f.ids.ownerId, createdAt: now, updatedAt: now });
    });
    expect(await f.evaluate()).toMatchObject({ allowed: true, sourceLevel: "modify", capabilities: ["read"] });
    await f.t.run(ctx => ctx.db.insert("artifactAccessOverrides", { artifactId: f.ids.sourceId, accountId: f.ids.readerId, effect: "deny", createdByAccountId: f.ids.ownerId, createdAt: Date.now(), updatedAt: Date.now() }));
    expect(await f.evaluate()).toEqual({ allowed: false, reason: "source_forbidden" });
    await f.grant();
    expect(await f.evaluate()).toMatchObject({ allowed: true, sourceLevel: "read" });
  });
});

describe("retained native and asset readers", () => {
  it("reads only exact version native owners and never falls back to an original import", async () => {
    const f = await fixture();
    await f.grant();
    const hash = createHash("sha256").update("native bytes").digest("hex");
    const seeded = await f.t.run(async ctx => {
      const storageId = await ctx.storage.store(new Blob(["native bytes"]));
      const payloadId = await ctx.db.insert("payloadObjects", { accountId: f.ids.ownerId, hash, storageId, bytes: 12, mediaType: "application/octet-stream", refCount: 1, state: "active", createdAt: Date.now(), verifiedAt: Date.now() });
      await ctx.db.insert("artifactImportJobs", { artifactId: f.ids.sourceId, ownerAccountId: f.ids.ownerId, schoolId: f.ids.schoolId, typeKey: "document", format: "docx", originalAssetRef: "fixture", originalStorageId: storageId, originalSha256: hash, status: "imported", unsupportedFeatures: [], parserVersion: "fixture", createdAt: Date.now(), updatedAt: Date.now() });
      await ctx.db.patch(f.ids.versionId, { after: { nativeBinding: { sourcePayloadHash: hash } } });
      return { payloadId, storageId };
    });
    expect(await f.reader.query(api.payloads.get, { workId: f.ids.sourceId, hash })).toBeNull();
    await f.t.run(ctx => ctx.db.insert("collaborationPayloadOwners", { ownerTable: NATIVE_VERSION_OWNER_TABLE, ownerId: String(f.ids.versionId), payloadRef: String(seeded.payloadId) }));
    // Real source-verified ancestors need not repeat an authored hash claim.
    await f.t.run(ctx => ctx.db.patch(f.ids.versionId, { after: { blocks: [] } }));
    expect(await f.reader.query(api.payloads.get, { workId: f.ids.sourceId, hash })).toMatchObject({ hash });
    await f.t.run(ctx => ctx.db.patch(f.ids.embedId, { removedAt: Date.now() }));
    await expect(f.reader.query(api.payloads.get, { workId: f.ids.sourceId, hash })).rejects.toThrow();
    expect(await f.t.run(async ctx => (await ctx.storage.get(seeded.storageId))?.text())).toBe("native bytes");
  });

  it("uses the same source permission for asset URLs and retains bytes after revocation", async () => {
    const f = await fixture();
    const asset = await f.t.run(async ctx => {
      const storageId = await ctx.storage.store(new Blob(["image bytes"]));
      const assetId = await ctx.db.insert("artifactAssets", { artifactId: f.ids.sourceId, schoolId: f.ids.schoolId, uploadedByAccountId: f.ids.ownerId, storageId, path: "image.png", name: "image.png", mediaType: "image/png", bytes: 11, sha256: "a".repeat(64), status: "active", createdAt: Date.now(), updatedAt: Date.now() });
      await ctx.db.patch(f.ids.versionId, { after: { blocks: [{ type: "image", assetId }] } });
      return { assetId, storageId };
    });
    await expect(f.reader.query(api.artifactAssets.getContent, { assetId: asset.assetId })).rejects.toThrow();
    const grantId = await f.grant();
    expect(await f.reader.query(api.artifactAssets.getContent, { assetId: asset.assetId })).toMatchObject({ assetId: asset.assetId });
    await f.t.run(ctx => ctx.db.patch(grantId, { revokedAt: Date.now() }));
    await expect(f.reader.query(api.artifactAssets.getContent, { assetId: asset.assetId })).rejects.toThrow();
    expect(await f.t.run(async ctx => (await ctx.storage.get(asset.storageId))?.text())).toBe("image bytes");
  });
});
