export const INTAKE_ATTESTATION_PURPOSE = "spectra-intake-attestation-v1" as const;
export const INTAKE_ATTESTATION_VERSION = 1 as const;

export type IntakeAttestationKind = "asset" | "original" | "content";

export type IntakeAttestation = {
  version: typeof INTAKE_ATTESTATION_VERSION;
  purpose: typeof INTAKE_ATTESTATION_PURPOSE;
  kind: IntakeAttestationKind;
  actorClerkId: string;
  actorAccountId: string;
  targetId: string;
  attemptId: string;
  storageId: string;
  bytes: number;
  sha256: string;
  mediaType: string;
  issuedAt: number;
  nonce: string;
  expiresAt: number;
  signature: string;
};

/**
 * The array shape is intentional: it fixes field order and keeps the signed
 * representation independent of object key enumeration in Next and Convex.
 */
export function canonicalIntakeAttestation(input: Omit<IntakeAttestation, "signature">) {
  return JSON.stringify([
    input.purpose,
    input.version,
    input.kind,
    input.actorClerkId,
    input.actorAccountId,
    input.targetId,
    input.attemptId,
    input.storageId,
    input.bytes,
    input.sha256,
    input.mediaType,
    input.issuedAt,
    input.nonce,
    input.expiresAt,
  ]);
}

export function intakeAttestationPayload(input: IntakeAttestation) {
  const { signature: _signature, ...payload } = input;
  return payload;
}
