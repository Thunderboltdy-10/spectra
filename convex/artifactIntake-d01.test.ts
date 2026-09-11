import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { normalizeSha256, verifyContentSignature } from "../shared/intake-integrity";

const modules = import.meta.glob("./**/*.ts");
const owner = { subject: "d01-owner", email: "d01-owner@example.test", emailVerified: true };
const peer = { subject: "d01-peer", email: "d01-peer@example.test", emailVerified: true };

async function fixture(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "D01", slug: crypto.randomUUID(), verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const ownerId = await ctx.db.insert("accounts", { clerkId: owner.subject, email: owner.email, emailVerified: true, name: "Owner", status: "active", createdAt: now, updatedAt: now });
    const peerId = await ctx.db.insert("accounts", { clerkId: peer.subject, email: peer.email, emailVerified: true, name: "Peer", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId: ownerId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId: peerId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const artifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: ownerId, schoolId, blueprintKey: "document", schemaVersion: 2, title: "D01", content: { type: "doc", content: [{ type: "paragraph" }] }, textIndex: "", tags: [], status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("accessGrants", { schoolId, resourceType: "artifact", resourceId: String(artifactId), principalType: "account", principalId: String(peerId), level: "modify", capabilities: ["read", "modify", "use", "comment", "restore"], source: "direct", createdByAccountId: ownerId, createdAt: now, updatedAt: now });
    return { schoolId, ownerId, peerId, artifactId, now };
  });
}

describe("D01 upload and saved-work boundaries", () => {
  it("allows an editing peer to create an upload receipt", async () => {
    const t = convexTest(schema, modules); const f = await fixture(t);
    await expect(t.withIdentity(peer).mutation(api.artifactAssets.beginUpload, { artifactId: f.artifactId, path: "images/p.png", name: "p.png", mediaType: "image/png", bytes: 8, sha256: "a".repeat(64) })).resolves.toMatchObject({ reused: false });
  });

  it("normalizes base64 storage checksums without lowercasing their alphabet", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    expect(normalizeSha256(base64)).toBe(Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join(""));
    expect(() => verifyContentSignature("text/plain", bytes)).not.toThrow();
  });

  it("finalizes an uploaded original through the trusted metadata path", async () => {
    const t = convexTest(schema, modules); const f = await fixture(t);
    const bytes = new Uint8Array([1, 2, 3]);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
    const jobId = await t.run((ctx) => ctx.db.insert("artifactImportJobs", { artifactId: f.artifactId, ownerAccountId: f.ownerId, schoolId: f.schoolId, typeKey: "document", format: "txt", originalAssetRef: "storage:fixture", originalBytes: 3, originalSha256: Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join(""), originalMimeType: "text/plain", status: "uploading", uploadReceipt: "r", unsupportedFeatures: [], parserVersion: "d01", createdAt: f.now, updatedAt: f.now }));
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([bytes], { type: "text/plain" }), { sha256: base64 }));
    await expect(t.withIdentity(owner).mutation(internal.artifactImports.finalizeStoredOriginal, { jobId, storageId, uploadReceipt: "r" })).resolves.toMatchObject({ status: "uploaded" });
  });

  it("does not let a changed import payload borrow a committed retry", async () => {
    const t = convexTest(schema, modules); const f = await fixture(t);
    const jobId = await t.run((ctx) => ctx.db.insert("artifactImportJobs", { artifactId: f.artifactId, ownerAccountId: f.ownerId, schoolId: f.schoolId, typeKey: "document", format: "txt", originalAssetRef: "fixture", status: "imported", importedContent: { type: "doc", content: [{ type: "paragraph", text: "one" }] }, importedContentHash: "0".repeat(64), unsupportedFeatures: [], parserVersion: "d01", createdAt: f.now, updatedAt: f.now }));
    await expect(t.withIdentity(owner).mutation(api.changeGroups.commitImport, { artifactId: f.artifactId, importJobId: jobId })).rejects.toThrow("ARTIFACT_IMPORT_CONTENT_CHANGED");
  });

});
