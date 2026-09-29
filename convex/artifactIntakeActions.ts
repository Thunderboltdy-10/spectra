"use node";

import { v } from "convex/values";
import { type ActionCtx } from "./_generated/server";
import { action } from "./functions";
import { api, internal } from "./_generated/api";
import { normalizeMediaType, normalizeSha256, verifyContentSignature } from "../shared/intake-integrity";
import { canonicalIntakeAttestation, INTAKE_ATTESTATION_PURPOSE, type IntakeAttestation } from "../shared/intake-attestation";
import { validateIntakeAttestation, vIntakeAttestation } from "./intakeAttestation";

type UploadResult = {
  assetId?: string;
  runAttachmentId?: string;
  jobId?: string;
  status: string;
  committed?: boolean;
  reused?: boolean;
  storageId?: string;
  errorCode?: string;
};

function decodeBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function verifyAttestationSignature(attestation: IntakeAttestation) {
  const secret = process.env.SPECTRA_SECRET_BRIDGE_KEY;
  if (!secret || secret.length < 32) throw new Error("INTAKE_ATTESTATION_CONFIG_MISSING");
  const root = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const derivedBytes = await crypto.subtle.sign(
    "HMAC",
    root,
    new TextEncoder().encode(INTAKE_ATTESTATION_PURPOSE),
  );
  const derived = await crypto.subtle.importKey(
    "raw",
    derivedBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    derived,
    decodeBase64Url(attestation.signature),
    new TextEncoder().encode(canonicalIntakeAttestation({
      version: attestation.version,
      purpose: attestation.purpose,
      kind: attestation.kind,
      actorClerkId: attestation.actorClerkId,
      actorAccountId: attestation.actorAccountId,
      targetId: attestation.targetId,
      attemptId: attestation.attemptId,
      storageId: attestation.storageId,
      bytes: attestation.bytes,
      sha256: attestation.sha256,
      mediaType: attestation.mediaType,
      issuedAt: attestation.issuedAt,
      nonce: attestation.nonce,
      expiresAt: attestation.expiresAt,
    })),
  );
  if (!valid) throw new Error("INTAKE_ATTESTATION_SIGNATURE_INVALID");
}

async function authenticateAttestation(
  ctx: Pick<ActionCtx, "auth" | "runQuery">,
  attestation: IntakeAttestation,
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || identity.subject !== attestation.actorClerkId)
    throw new Error("INTAKE_ATTESTATION_ACTOR_INVALID");
  const actor = await ctx.runQuery(api.identity.me, {});
  if (!actor || actor.clerkId !== attestation.actorClerkId || actor.accountId !== attestation.actorAccountId)
    throw new Error("INTAKE_ATTESTATION_ACTOR_INVALID");
  return actor;
}

function assertIntentMatches(
  attestation: IntakeAttestation,
  intent: {
    bytes: number;
    sha256: string;
    mediaType?: string;
    mimeType?: string;
  },
) {
  const mediaType = normalizeMediaType(intent.mediaType ?? intent.mimeType ?? "");
  if (
    attestation.bytes !== intent.bytes ||
    attestation.sha256 !== intent.sha256 ||
    attestation.mediaType !== mediaType
  ) throw new Error("INTAKE_ATTESTATION_TARGET_CHANGED");
}

async function observedBytes(blob: Blob, attestation: IntakeAttestation) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = normalizeSha256(await crypto.subtle.digest("SHA-256", bytes));
  const blobType = normalizeMediaType(blob.type || attestation.mediaType);
  if (
    bytes.byteLength !== attestation.bytes ||
    digest !== attestation.sha256 ||
    blobType !== attestation.mediaType
  ) throw new Error("INTAKE_UPLOAD_INTEGRITY_FAILED");
  verifyContentSignature(attestation.mediaType, bytes);
}

async function verifyEnvelopeAndActor(
  ctx: Pick<ActionCtx, "auth" | "runQuery">,
  attestation: IntakeAttestation,
  expected: { kind: IntakeAttestation["kind"]; targetId: string; attemptId: string },
) {
  validateIntakeAttestation(attestation, expected, { allowExpired: true });
  await verifyAttestationSignature(attestation);
  return authenticateAttestation(ctx, attestation);
}
export const verifyUploadedStorage = action({
  args: {
    assetId: v.id("artifactAssets"),
    storageId: v.id("_storage"),
    uploadReceipt: v.string(),
    attestation: vIntakeAttestation,
  },
  handler: async (ctx, args): Promise<UploadResult> => {
    const attestation = args.attestation as IntakeAttestation;
    const actor = await verifyEnvelopeAndActor(ctx, attestation, {
      kind: "asset",
      targetId: String(args.assetId),
      attemptId: args.uploadReceipt,
    });
    if (attestation.storageId !== String(args.storageId)) throw new Error("INTAKE_ATTESTATION_STORAGE_INVALID");
    const intent = await ctx.runQuery(api.artifactAssets.getUploadIntent, {
      assetId: args.assetId,
      uploadReceipt: args.uploadReceipt,
      expectedStorageId: args.storageId,
    });
    try {
      assertIntentMatches(attestation, intent);
    } catch (error) {
      if (intent.status === "uploading") {
        await ctx.runMutation(internal.artifactAssets.quarantineUntrustedUpload, {
          assetId: args.assetId,
          storageId: args.storageId,
          uploadReceipt: args.uploadReceipt,
          reason: error instanceof Error ? error.message : "INTAKE_ATTESTATION_TARGET_CHANGED",
        });
      }
      throw error;
    }
    if (intent.status !== "uploading") {
      if (intent.storageId === String(args.storageId) || intent.candidateStorageId === String(args.storageId)) {
        return { assetId: String(args.assetId), status: intent.status, committed: true, storageId: intent.storageId ?? undefined };
      }
      if (Date.now() > attestation.expiresAt) throw new Error("INTAKE_ATTESTATION_EXPIRED");
      const extra = await ctx.storage.get(args.storageId);
      if (!extra) throw new Error("ASSET_UPLOAD_STORAGE_MISSING");
      try {
        await observedBytes(extra, attestation);
      } catch {
        throw new Error("ASSET_UPLOAD_REPLAY_MISMATCH");
      }
      await ctx.storage.delete(args.storageId);
      return { assetId: String(args.assetId), status: intent.status, committed: true, reused: true, storageId: intent.storageId ?? undefined };
    }
    if (Date.now() > attestation.expiresAt) throw new Error("INTAKE_ATTESTATION_EXPIRED");
    if (actor.accountId !== intent.uploadedByAccountId) throw new Error("ASSET_UPLOAD_UPLOADER_INVALID");
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) throw new Error("ASSET_UPLOAD_STORAGE_MISSING");
    try {
      await observedBytes(blob, attestation);
    } catch (error) {
      await ctx.runMutation(internal.artifactAssets.quarantineUntrustedUpload, {
        assetId: args.assetId,
        storageId: args.storageId,
        uploadReceipt: args.uploadReceipt,
        reason: error instanceof Error ? error.message : "ASSET_UPLOAD_INTEGRITY_FAILED",
      });
      throw error;
    }
    return ctx.runMutation(internal.artifactAssets.commitVerifiedUpload, {
      assetId: args.assetId,
      storageId: args.storageId,
      uploadReceipt: args.uploadReceipt,
      attestation: args.attestation,
    });
  },
});

export const verifyUploadedOriginal = action({
  args: {
    jobId: v.id("artifactImportJobs"),
    storageId: v.id("_storage"),
    uploadReceipt: v.string(),
    attestation: vIntakeAttestation,
  },
  handler: async (ctx, args): Promise<UploadResult> => {
    const attestation = args.attestation as IntakeAttestation;
    const actor = await verifyEnvelopeAndActor(ctx, attestation, {
      kind: "original",
      targetId: String(args.jobId),
      attemptId: args.uploadReceipt,
    });
    if (attestation.storageId !== String(args.storageId)) throw new Error("INTAKE_ATTESTATION_STORAGE_INVALID");
    const intent = await ctx.runQuery(api.artifactImports.getUploadIntent, {
      jobId: args.jobId,
      uploadReceipt: args.uploadReceipt,
      expectedStorageId: args.storageId,
    });
    try {
      assertIntentMatches(attestation, intent);
    } catch (error) {
      if (intent.status === "uploading") {
        await ctx.runMutation(internal.artifactImports.quarantineUntrustedOriginal, {
          jobId: args.jobId,
          storageId: args.storageId,
          uploadReceipt: args.uploadReceipt,
          reason: error instanceof Error ? error.message : "INTAKE_ATTESTATION_TARGET_CHANGED",
        });
      }
      throw error;
    }
    if (intent.status !== "uploading") {
      if (intent.storageId === String(args.storageId) || intent.candidateStorageId === String(args.storageId)) {
        return { jobId: String(args.jobId), status: intent.status, committed: true };
      }
      if (Date.now() > attestation.expiresAt) throw new Error("INTAKE_ATTESTATION_EXPIRED");
      const extra = await ctx.storage.get(args.storageId);
      if (!extra) throw new Error("IMPORT_UPLOAD_STORAGE_MISSING");
      try {
        await observedBytes(extra, attestation);
      } catch {
        throw new Error("IMPORT_UPLOAD_REPLAY_MISMATCH");
      }
      await ctx.storage.delete(args.storageId);
      return { jobId: String(args.jobId), status: intent.status, committed: true, reused: true };
    }
    if (Date.now() > attestation.expiresAt) throw new Error("INTAKE_ATTESTATION_EXPIRED");
    if (actor.accountId !== intent.ownerAccountId) throw new Error("IMPORT_UPLOAD_UPLOADER_INVALID");
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) throw new Error("IMPORT_UPLOAD_STORAGE_MISSING");
    try {
      await observedBytes(blob, attestation);
    } catch (error) {
      await ctx.runMutation(internal.artifactImports.quarantineUntrustedOriginal, {
        jobId: args.jobId,
        storageId: args.storageId,
        uploadReceipt: args.uploadReceipt,
        reason: error instanceof Error ? error.message : "IMPORT_UPLOAD_INTEGRITY_FAILED",
      });
      throw error;
    }
    return ctx.runMutation(internal.artifactImports.commitVerifiedOriginal, {
      jobId: args.jobId,
      storageId: args.storageId,
      uploadReceipt: args.uploadReceipt,
      attestation: args.attestation,
    });
  },
});

export const verifyUploadedRunAttachment = action({
  args: {
    runAttachmentId: v.id("spectraRunAttachments"),
    storageId: v.id("_storage"),
    uploadReceipt: v.string(),
  },
  handler: async (ctx, args): Promise<UploadResult> => {
    const intent = await ctx.runQuery(
      api.spectraRuns.getRunAttachmentUploadIntent,
      {
        runAttachmentId: args.runAttachmentId,
        uploadReceipt: args.uploadReceipt,
      },
    );
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) throw new Error("ATTACHMENT_UPLOAD_STORAGE_MISSING");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    try {
      if (bytes.byteLength !== intent.bytes) throw new Error("ATTACHMENT_SIZE_INVALID");
      const digest = normalizeSha256(await crypto.subtle.digest("SHA-256", bytes));
      if (!digest || digest !== intent.sha256) throw new Error("ATTACHMENT_DIGEST_MISMATCH");
      verifyContentSignature(intent.mimeType, bytes);
    } catch (error) {
      await ctx.runMutation(internal.spectraRuns.quarantineRunAttachmentUpload, {
        runAttachmentId: args.runAttachmentId,
        uploadReceipt: args.uploadReceipt,
        reason: error instanceof Error ? error.message : "ATTACHMENT_UPLOAD_INTEGRITY_FAILED",
      });
      throw error;
    }
    return ctx.runMutation(internal.spectraRuns.finalizeRunAttachmentUpload, {
      runAttachmentId: args.runAttachmentId,
      storageId: args.storageId,
      uploadReceipt: args.uploadReceipt,
    });
  },
});

/** Only the trusted server that uploaded these bytes can attest their origin.
 * Replays remain valid, but the atomic adoption rechecks current actor/epoch. */
export const adoptDurableContent = action({
  args: { artifactId: v.id("spectraArtifacts"), policyVersion: v.number(),
    attestation: vIntakeAttestation,
    dependencies: v.optional(v.object({assetIds: v.array(v.string()), nativePayloadHashes: v.array(v.string())})),
  },
  handler: async (ctx, args): Promise<{payloadRef: string; dependencies?: {assetIds: string[]; nativePayloadHashes: string[]; nativePayloadRefs: string[]}}> => {
    const attestation = args.attestation;
    await verifyEnvelopeAndActor(ctx, attestation, {
      kind: "content", targetId: args.artifactId, attemptId: JSON.stringify([args.policyVersion, args.dependencies ?? null]),
    });
    return ctx.runMutation(internal.artifactContent.adopt, {
      artifactId: args.artifactId, policyVersion: args.policyVersion,
      storageId: attestation.storageId as import("./_generated/dataModel").Id<"_storage">,
      digest: attestation.sha256, byteLength: attestation.bytes, dependencies: args.dependencies,
    });
  },
});
