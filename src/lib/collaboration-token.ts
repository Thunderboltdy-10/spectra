import "server-only";

import { SignJWT } from "jose";
import { SPECTRA_PROTOCOL_VERSIONS } from "@/features/spectra/migrations/protocol";
import { COLLABORATION_SESSION_TTL } from "../../shared/collaboration-session-ttl";

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
  protocolVersion: number;
  permissionEpoch: number;
  actorKind: "human" | "ai" | "system";
  access: "read_only" | "edit";
  internalCapabilities: string[];
  runId?: string;
  operationId?: string;
};

export function collaborationDocumentName(
  artifactId: string,
  partitionKey: string,
  typeKey: string,
) {
  return `artifact:${artifactId}:${Buffer.from(partitionKey).toString("base64url")}:${Buffer.from(typeKey).toString("base64url")}`;
}

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
    .setExpirationTime(COLLABORATION_SESSION_TTL)
    .sign(signingKey());
}

export { COLLABORATION_SESSION_TTL, COLLABORATION_SESSION_TTL_MS } from "../../shared/collaboration-session-ttl";

export function collaborationProtocolVersion() {
  return SPECTRA_PROTOCOL_VERSIONS.collaboration;
}

/**
 * Realtime gateway URL handed to browsers and to server-side AI edits. Local
 * stacks always set NEXT_PUBLIC_SPECTRA_COLLAB_URL (scripts/local/stack-config.mjs),
 * so the localhost defaults only serve ad-hoc development. A production
 * deployment without it used to hand every client ws://localhost and leave all
 * editors silently offline; it now fails with a configuration error instead.
 */
export function collaborationGatewayUrl() {
  const configured = process.env.NEXT_PUBLIC_SPECTRA_COLLAB_URL?.trim();
  if (configured) return configured;
  if (process.env.NODE_ENV !== "production")
    return "ws://localhost:1234";
  throw new Error(
    "COLLABORATION_GATEWAY_CONFIG_MISSING: Configure NEXT_PUBLIC_SPECTRA_COLLAB_URL.",
  );
}
