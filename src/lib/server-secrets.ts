import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { convexAction, convexPublicAction } from "@/lib/convex-server";
import {
  INTAKE_ATTESTATION_PURPOSE,
  INTAKE_ATTESTATION_VERSION,
  canonicalIntakeAttestation,
  type IntakeAttestation,
} from "../../shared/intake-attestation";

type Envelope = {
  ciphertext: string;
  nonce: string;
  authTag: string;
  algorithm: "aes-256-gcm";
  keyVersion: number;
  fingerprint: string;
  label: string;
};

function encryptionKey() {
  const encoded = process.env.SPECTRA_MASTER_ENCRYPTION_KEY;
  if (!encoded)
    throw new Error(
      "SECRET_ENCRYPTION_CONFIG_MISSING: Configure SPECTRA_MASTER_ENCRYPTION_KEY.",
    );
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32)
    throw new Error(
      "SECRET_ENCRYPTION_CONFIG_INVALID: The master key must be 32 base64-encoded bytes.",
    );
  return key;
}

function bridgeKey() {
  const value = process.env.SPECTRA_SECRET_BRIDGE_KEY;
  if (!value || value.length < 32)
    throw new Error(
      "SECRET_BRIDGE_CONFIG_MISSING: Configure a strong bridge key.",
    );
  return value;
}

function intakeAttestationKey() {
  return createHmac("sha256", bridgeKey())
    .update(INTAKE_ATTESTATION_PURPOSE)
    .digest();
}

export function signTrustedIntakeAttestation(
  input: Omit<
    IntakeAttestation,
    "version" | "purpose" | "issuedAt" | "nonce" | "expiresAt" | "signature"
  >,
) {
  const issuedAt = Date.now();
  const payload = {
    ...input,
    version: INTAKE_ATTESTATION_VERSION,
    purpose: INTAKE_ATTESTATION_PURPOSE,
    issuedAt,
    nonce: randomBytes(24).toString("base64url"),
    expiresAt: issuedAt + 120_000,
  } as const;
  return {
    ...payload,
    signature: createHmac("sha256", intakeAttestationKey())
      .update(canonicalIntakeAttestation(payload))
      .digest("base64url"),
  } satisfies IntakeAttestation;
}

function aad(schoolId: string, purpose: string, keyVersion: number) {
  return Buffer.from(
    `spectra-secret|${schoolId}|${purpose}|${keyVersion}`,
    "utf8",
  );
}

function encrypt(
  value: string,
  schoolId: string,
  purpose: string,
  keyVersion: number,
) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  cipher.setAAD(aad(schoolId, purpose, keyVersion));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion,
    fingerprint: createHash("sha256")
      .update(value)
      .digest("base64url")
      .slice(0, 22),
  };
}

function decrypt(envelope: Envelope, schoolId: string, purpose: string) {
  if (envelope.algorithm !== "aes-256-gcm")
    throw new Error(
      "SECRET_ALGORITHM_UNSUPPORTED: The stored envelope cannot be decrypted.",
    );
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(envelope.nonce, "base64"),
  );
  decipher.setAAD(aad(schoolId, purpose, envelope.keyVersion));
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function envelopeDigest(envelope?: {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: number;
  fingerprint: string;
}) {
  if (!envelope) return "-";
  return createHash("sha256")
    .update(
      `${envelope.ciphertext}|${envelope.nonce}|${envelope.authTag}|${envelope.keyVersion}|${envelope.fingerprint}`,
    )
    .digest("base64url");
}

async function bridgeArgs(
  operation: "read" | "use" | "status" | "write" | "revoke" | "erase-account",
  schoolId: string,
  purpose: string,
  envelope?: {
    ciphertext: string;
    nonce: string;
    authTag: string;
    keyVersion: number;
    fingerprint: string;
  },
  serviceSubject?: string,
) {
  const subject =
    serviceSubject ??
    (await import("@clerk/nextjs/server").then(
      async ({ auth }) => (await auth()).userId,
    ));
  if (!subject) throw new Error("AUTH_NOT_SIGNED_IN: Sign in to continue.");
  const timestamp = Date.now();
  const nonce = randomBytes(24).toString("base64url");
  const digest = envelopeDigest(envelope);
  const canonical = [
    operation,
    subject,
    schoolId,
    purpose,
    timestamp,
    nonce,
    digest,
  ].join("|");
  const signature = createHmac("sha256", bridgeKey())
    .update(canonical)
    .digest("base64url");
  return { timestamp, nonce, signature };
}

/**
 * Ask Convex to erase the account of an identity Clerk deleted. Only the
 * svix-verified webhook calls this; the bridge key is the authority because
 * no session exists for a deleted user.
 */
export async function requestIdentityErasure(clerkId: string) {
  const bridge = await bridgeArgs("erase-account", "-", "clerk-user-deleted", undefined, clerkId);
  return convexPublicAction<Record<string, unknown>, { status: "running" | "completed" }>(
    "secretBridge:eraseDeletedIdentity",
    { clerkId, ...bridge },
  );
}

export async function storeSchoolSecret(input: {
  schoolId: string;
  purpose: string;
  label: string;
  value: string;
  operatorSessionId?: string;
  requestId?: string;
  keyVersion?: number;
}) {
  const purpose = input.purpose.trim().toLowerCase().slice(0, 100);
  const value = input.value.trim();
  if (!purpose || !value)
    throw new Error(
      "SECRET_VALUE_REQUIRED: Purpose and secret value are required.",
    );
  const envelope = encrypt(
    value,
    input.schoolId,
    purpose,
    Math.max(1, Math.round(input.keyVersion ?? 1)),
  );
  const bridge = await bridgeArgs("write", input.schoolId, purpose, envelope);
  return convexAction<
    Record<string, unknown>,
    {
      secretId: string;
      fingerprint: string;
      keyVersion: number;
      status: "active";
    }
  >("secretBridge:write", {
    schoolId: input.schoolId,
    purpose,
    label: input.label.trim().slice(0, 120) || purpose,
    operatorSessionId: input.operatorSessionId,
    requestId: input.requestId,
    ...bridge,
    ciphertext: envelope.ciphertext,
    encryptionNonce: envelope.nonce,
    authTag: envelope.authTag,
    keyVersion: envelope.keyVersion,
    fingerprint: envelope.fingerprint,
  });
}

export async function loadSchoolSecret(input: {
  schoolId: string;
  purpose: string;
  operatorSessionId?: string;
}) {
  const purpose = input.purpose.trim().toLowerCase().slice(0, 100);
  const bridge = await bridgeArgs("read", input.schoolId, purpose);
  const envelope = await convexAction<Record<string, unknown>, Envelope | null>(
    "secretBridge:read",
    {
      schoolId: input.schoolId,
      purpose,
      operatorSessionId: input.operatorSessionId,
      ...bridge,
    },
  );
  if (!envelope) return null;
  const value = decrypt(envelope, input.schoolId, purpose);
  const fingerprint = createHash("sha256")
    .update(value)
    .digest("base64url")
    .slice(0, 22);
  const expected = Buffer.from(envelope.fingerprint);
  const actual = Buffer.from(fingerprint);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new Error(
      "SECRET_INTEGRITY_FAILED: The decrypted secret fingerprint does not match.",
    );
  return {
    value,
    fingerprint,
    keyVersion: envelope.keyVersion,
    label: envelope.label,
  };
}

export async function loadSchoolSecretForConnector(input: {
  schoolId: string;
  purpose: "managebac-api-token";
  serviceSubject?: string;
}) {
  const purpose = input.purpose;
  const bridge = await bridgeArgs(
    "use",
    input.schoolId,
    purpose,
    undefined,
    input.serviceSubject,
  );
  const args = {
    schoolId: input.schoolId,
    purpose,
    ...(input.serviceSubject ? { workerSubject: input.serviceSubject } : {}),
    ...bridge,
  };
  const envelope = input.serviceSubject
    ? await import("@/lib/convex-server").then(({ convexPublicAction }) =>
        convexPublicAction<Record<string, unknown>, Envelope | null>(
          "secretBridge:useForSchoolConnector",
          args,
        ),
      )
    : await convexAction<Record<string, unknown>, Envelope | null>(
        "secretBridge:useForSchoolConnector",
        args,
      );
  if (!envelope) return null;
  const value = decrypt(envelope, input.schoolId, purpose);
  const fingerprint = createHash("sha256")
    .update(value)
    .digest("base64url")
    .slice(0, 22);
  const expected = Buffer.from(envelope.fingerprint);
  const actual = Buffer.from(fingerprint);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new Error(
      "SECRET_INTEGRITY_FAILED: The decrypted secret fingerprint does not match.",
    );
  return {
    value,
    fingerprint,
    keyVersion: envelope.keyVersion,
    label: envelope.label,
  };
}

export async function getSchoolSecretStatus(input: {
  schoolId: string;
  purpose: string;
  operatorSessionId?: string;
}) {
  const purpose = input.purpose.trim().toLowerCase().slice(0, 100);
  const bridge = await bridgeArgs("status", input.schoolId, purpose);
  return convexAction("secretBridge:status", {
    schoolId: input.schoolId,
    purpose,
    operatorSessionId: input.operatorSessionId,
    ...bridge,
  });
}

export async function revokeSchoolSecret(input: {
  schoolId: string;
  purpose: string;
  operatorSessionId?: string;
  requestId?: string;
}) {
  const purpose = input.purpose.trim().toLowerCase().slice(0, 100);
  const bridge = await bridgeArgs("revoke", input.schoolId, purpose);
  return convexAction("secretBridge:revoke", {
    schoolId: input.schoolId,
    purpose,
    operatorSessionId: input.operatorSessionId,
    requestId: input.requestId,
    ...bridge,
  });
}
