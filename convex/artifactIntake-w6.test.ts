import { createHmac } from "node:crypto";
import { describe, expect, it, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";
import { canonicalIntakeAttestation, INTAKE_ATTESTATION_PURPOSE, type IntakeAttestation } from "../shared/intake-attestation";
import { verifyContentSignature } from "../shared/intake-integrity";

const modules = import.meta.glob("./**/*.ts");
const owner = { subject: "w6-owner", email: "w6-owner@example.test", emailVerified: true };

function pngBytes() {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
}

function signProof(input: Omit<IntakeAttestation, "version" | "purpose" | "issuedAt" | "nonce" | "expiresAt" | "signature">) {
  const issuedAt = Date.now();
  const payload = {
    ...input,
    version: 1 as const,
    purpose: INTAKE_ATTESTATION_PURPOSE,
    issuedAt,
    nonce: `w6-${crypto.randomUUID().replaceAll("-", "")}`,
    expiresAt: issuedAt + 120_000,
  } as const;
  const derived = createHmac("sha256", process.env.SPECTRA_SECRET_BRIDGE_KEY!).update(INTAKE_ATTESTATION_PURPOSE).digest();
  return {
    ...payload,
    signature: createHmac("sha256", derived).update(canonicalIntakeAttestation(payload)).digest("base64url"),
  } satisfies IntakeAttestation;
}

async function fixture(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const schoolId = await ctx.db.insert("schools", { name: "W6", slug: crypto.randomUUID(), verifiedDomains: [], status: "active", timezone: "UTC", policyVersion: 1, createdAt: now, updatedAt: now });
    const accountId = await ctx.db.insert("accounts", { clerkId: owner.subject, email: owner.email, emailVerified: true, name: "W6 owner", status: "active", createdAt: now, updatedAt: now });
    await ctx.db.insert("schoolMemberships", { accountId, schoolId, role: "student", status: "active", joinedAt: now, createdAt: now, updatedAt: now });
    const artifactId = await ctx.db.insert("spectraArtifacts", { ownerAccountId: accountId, schoolId, blueprintKey: "document", schemaVersion: 2, title: "Causal", content: { blocks: [{ id: "seed", text: "seed" }] }, textIndex: "seed", tags: [], status: "active", createdAt: now, updatedAt: now });
    const roomId = await ctx.db.insert("collaborationRooms", { artifactId, schoolId, typeKey: "document", provider: "self_hosted_yjs", partitionKey: "root", schemaVersion: 2, policyVersion: 0, status: "active", nextSequence: 1, snapshotSequence: 0, uncompactedBytes: 0, lastProjectionSequence: 0, createdAt: now, updatedAt: now });
    return { schoolId, accountId, artifactId, roomId, now };
  });
}

describe("W6-01 trusted intake and causal commit", () => {
  beforeEach(() => {
    process.env.SPECTRA_SECRET_BRIDGE_KEY = "w6-test-secret-which-is-long-enough-123456";
  });

  it("verifies a real stored PNG through the action and returns an exact terminal replay", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    const bytes = pngBytes();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
    const beginning = await t.withIdentity(owner).mutation(api.artifactAssets.beginUpload, { artifactId: f.artifactId, path: "images/w6.png", name: "w6.png", mediaType: "image/png", bytes: bytes.byteLength, sha256: digest });
    const storageSha = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))));
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([bytes], { type: "image/png" }), { sha256: storageSha }));
    const foreignStorageId = await t.run((ctx) => ctx.storage.store(new Blob([bytes], { type: "image/png" }), { sha256: storageSha }));
    const attestation = signProof({ kind: "asset", actorClerkId: owner.subject, actorAccountId: String(f.accountId), targetId: String(beginning.assetId), attemptId: beginning.uploadReceipt!, storageId: String(storageId), bytes: bytes.byteLength, sha256: digest, mediaType: "image/png" });
    const action = t.withIdentity(owner);
    await expect(action.action(api.artifactIntakeActions.verifyUploadedStorage, { assetId: beginning.assetId, storageId: foreignStorageId, uploadReceipt: beginning.uploadReceipt!, attestation })).rejects.toThrow("INTAKE_ATTESTATION_STORAGE_INVALID");
    await expect(t.run((ctx) => ctx.db.get(beginning.assetId))).resolves.toMatchObject({ status: "uploading" });
    await expect(t.run((ctx) => ctx.db.get(beginning.assetId))).resolves.not.toHaveProperty("storageId");
    await expect(t.run(async (ctx) => Boolean(await ctx.storage.get(foreignStorageId)))).resolves.toBe(true);
    await expect(action.action(api.artifactIntakeActions.verifyUploadedStorage, { assetId: beginning.assetId, storageId, uploadReceipt: beginning.uploadReceipt!, attestation })).resolves.toMatchObject({ status: "active", committed: true });
    await expect(action.action(api.artifactIntakeActions.verifyUploadedStorage, { assetId: beginning.assetId, storageId, uploadReceipt: beginning.uploadReceipt!, attestation })).resolves.toMatchObject({ status: "active", committed: true, storageId });
    await expect(t.withIdentity({ subject: "w6-other", email: "w6-other@example.test", emailVerified: true }).action(api.artifactIntakeActions.verifyUploadedStorage, { assetId: beginning.assetId, storageId, uploadReceipt: beginning.uploadReceipt!, attestation })).rejects.toThrow("INTAKE_ATTESTATION_ACTOR_INVALID");
  });

  it("verifies the original-import action with the same attested storage contract", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    const bytes = new TextEncoder().encode("test");
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
    const job = await t.withIdentity(owner).mutation(api.artifactImports.begin, { artifactId: f.artifactId, typeKey: "document", format: "txt", name: "original.txt", mimeType: "text/plain", bytes: bytes.byteLength, sha256: digest });
    const intent = await t.withIdentity(owner).mutation(api.artifactImports.prepareUpload, { jobId: job.jobId });
    const storageSha = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))));
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob([bytes], { type: "text/plain" }), { sha256: storageSha }));
    const attestation = signProof({ kind: "original", actorClerkId: owner.subject, actorAccountId: String(f.accountId), targetId: String(job.jobId), attemptId: intent.uploadReceipt!, storageId: String(storageId), bytes: bytes.byteLength, sha256: digest, mediaType: "text/plain" });
    await expect(t.withIdentity(owner).action(api.artifactIntakeActions.verifyUploadedOriginal, { jobId: job.jobId, storageId, uploadReceipt: intent.uploadReceipt!, attestation })).resolves.toMatchObject({ status: "uploaded", committed: true });
    await expect(t.withIdentity(owner).mutation(api.artifactImports.prepareUpload, { jobId: job.jobId })).resolves.toMatchObject({ status: "uploaded", storageId });
  });

  it("keeps parsed awaiting-commit distinct and fences append/projection races", async () => {
    const t = convexTest(schema, modules);
    const f = await fixture(t);
    const job = await t.withIdentity(owner).mutation(api.artifactImports.begin, { artifactId: f.artifactId, typeKey: "document", format: "txt", name: "causal.txt", mimeType: "text/plain", bytes: 4, sha256: "a".repeat(64) });
    const original = new TextEncoder().encode("test");
    const originalDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", original)), (value) => value.toString(16).padStart(2, "0")).join("");
    const originalStorageId = await t.run((ctx) => ctx.storage.store(new Blob([original], { type: "text/plain" })));
    await t.run((ctx) => ctx.db.patch(job.jobId, { status: "uploaded", originalStorageId, originalAssetRef: `storage:${originalStorageId}`, originalSha256: originalDigest }));
    await expect(t.withIdentity(owner).mutation(api.artifactImports.complete, { jobId: job.jobId, typeKey: "document", status: "imported", fidelityReport: [], unsupportedFeatures: [], importedContent: { blocks: [{ id: "p", text: "parsed content" }] } })).resolves.toMatchObject({ status: "awaiting_commit" });
    await t.run((ctx) => ctx.db.patch(f.roomId, { nextSequence: 2 }));
    await expect(t.withIdentity(owner).mutation(api.changeGroups.commitImport, { artifactId: f.artifactId, importJobId: job.jobId })).rejects.toThrow("ARTIFACT_IMPORT_CAUSAL_BASE_STALE");
  });

  it("accepts representative allowed audio and font signatures", () => {
    expect(() => verifyContentSignature("audio/mpeg", new TextEncoder().encode("ID3\u0004\u0000\u0000"))).not.toThrow();
    expect(() => verifyContentSignature("font/woff", new TextEncoder().encode("wOFF\u0001\u0000\u0000\u0000"))).not.toThrow();
  });
});
