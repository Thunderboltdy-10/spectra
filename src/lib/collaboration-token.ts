import "server-only";

import { SignJWT } from "jose";

export type CollaborationSessionClaims = {
  artifactId: string;
  roomId: string;
  partitionKey: string;
  documentName: string;
  accountId: string;
  schoolId: string;
  clientId: string;
  displayName: string;
  level: "read" | "modify";
  policyVersion: number;
  schemaVersion: number;
};

function signingKey() {
  const value = process.env.SPECTRA_COLLAB_TOKEN_SECRET;
  if (!value || value.length < 32) throw new Error("COLLABORATION_TOKEN_CONFIG_MISSING: Configure SPECTRA_COLLAB_TOKEN_SECRET.");
  return new TextEncoder().encode(value);
}

export async function signCollaborationSession(claims: CollaborationSessionClaims) {
  return new SignJWT({ ...claims, kind: "spectra_collaboration" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("spectra")
    .setAudience("spectra-collaboration-gateway")
    .setSubject(claims.accountId)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(signingKey());
}
