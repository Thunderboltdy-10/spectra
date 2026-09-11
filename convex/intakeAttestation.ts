import { v } from "convex/values";
import {
  INTAKE_ATTESTATION_PURPOSE,
  INTAKE_ATTESTATION_VERSION,
  canonicalIntakeAttestation,
  intakeAttestationPayload,
  type IntakeAttestation,
} from "../shared/intake-attestation";
import { normalizeMediaType, normalizeSha256 } from "../shared/intake-integrity";

export const vIntakeAttestation = v.object({
  version: v.literal(INTAKE_ATTESTATION_VERSION),
  purpose: v.literal(INTAKE_ATTESTATION_PURPOSE),
  kind: v.union(v.literal("asset"), v.literal("original")),
  actorClerkId: v.string(),
  actorAccountId: v.string(),
  targetId: v.string(),
  attemptId: v.string(),
  storageId: v.string(),
  bytes: v.number(),
  sha256: v.string(),
  mediaType: v.string(),
  issuedAt: v.number(),
  nonce: v.string(),
  expiresAt: v.number(),
  signature: v.string(),
});

export function validateIntakeAttestation(
  input: IntakeAttestation,
  expected: { kind: IntakeAttestation["kind"]; targetId: string; attemptId: string },
  options: { allowExpired?: boolean } = {},
) {
  if (
    input.version !== INTAKE_ATTESTATION_VERSION ||
    input.purpose !== INTAKE_ATTESTATION_PURPOSE ||
    input.kind !== expected.kind ||
    input.targetId !== expected.targetId ||
    input.attemptId !== expected.attemptId ||
    !input.actorClerkId.trim() ||
    !input.actorAccountId.trim() ||
    !input.storageId.trim() ||
    !input.nonce.trim() ||
    !/^[A-Za-z0-9_-]{16,160}$/.test(input.nonce) ||
    !/^[A-Za-z0-9_-]{40,100}$/.test(input.signature) ||
    !Number.isSafeInteger(input.bytes) ||
    input.bytes < 0 ||
    !normalizeSha256(input.sha256) ||
    normalizeSha256(input.sha256) !== input.sha256 ||
    !normalizeMediaType(input.mediaType) ||
    normalizeMediaType(input.mediaType) !== input.mediaType ||
    !Number.isSafeInteger(input.issuedAt) ||
    !Number.isSafeInteger(input.expiresAt) ||
    input.expiresAt <= input.issuedAt ||
    input.expiresAt - input.issuedAt > 120_000 ||
    (!options.allowExpired && Date.now() > input.expiresAt) ||
    input.issuedAt > Date.now() + 30_000
  ) {
    throw new Error("INTAKE_ATTESTATION_INVALID");
  }
  return canonicalIntakePayload(input);
}

function canonicalIntakePayload(input: IntakeAttestation) {
  return canonicalIntakeAttestation(intakeAttestationPayload(input));
}
