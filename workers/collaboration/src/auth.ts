import { jwtVerify } from "jose";
import type { ConnectionClaims } from "./protocol";
import { assertProtocol } from "./protocol";

export async function verifyConnectionToken(token: string, secret: string) {
  if (secret.length < 32) throw new Error("AUTH_SECRET_INVALID");
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    issuer: "spectra",
    audience: "spectra-collaboration-gateway",
  });
  const claims: ConnectionClaims = {
    workId: String(payload.workId ?? payload.artifactId ?? ""),
    roomId: String(payload.roomId ?? ""),
    workspaceId:
      typeof payload.workspaceId === "string" ? payload.workspaceId : undefined,
    actor: {
      accountId: String(payload.accountId ?? payload.sub ?? ""),
      clientId: String(payload.clientId ?? ""),
      actorKind:
        payload.actorKind === "ai" || payload.actorKind === "system"
          ? payload.actorKind
          : "human",
      displayName: String(payload.displayName ?? "Spectra collaborator"),
    },
    access: payload.access === "edit" || payload.level === "modify" ? "edit" : "read_only",
    capabilities: Array.isArray(payload.internalCapabilities)
      ? payload.internalCapabilities.map(String)
      : [],
    permissionEpoch: Number(payload.permissionEpoch ?? payload.policyVersion ?? 0),
    protocolVersion: Number(payload.protocolVersion ?? 0),
    expiresAt: Number(payload.exp ?? 0) * 1_000,
    runId: typeof payload.runId === "string" ? payload.runId : undefined,
    operationId:
      typeof payload.operationId === "string" ? payload.operationId : undefined,
  };
  assertProtocol(claims.protocolVersion);
  if (!claims.workId || !claims.roomId || !claims.actor.accountId || !claims.actor.clientId)
    throw new Error("AUTH_CLAIMS_INCOMPLETE");
  if (claims.expiresAt <= Date.now()) throw new Error("AUTH_TOKEN_EXPIRED");
  return claims;
}

export function canMutate(claims: ConnectionClaims, currentEpoch: number) {
  return (
    claims.access === "edit" &&
    claims.permissionEpoch === currentEpoch &&
    claims.expiresAt > Date.now()
  );
}
