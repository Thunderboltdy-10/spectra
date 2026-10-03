/** Shared by Convex mutations and actions; no provider I/O in this module. */
import type { Doc } from "./_generated/dataModel";
import { embeddingInputFits, embeddingVersion } from "./embeddingProvider";

export const MEMORY_EMBEDDING_LEASE_MS = 30_000;
export const MEMORY_EMBEDDING_MAX_ATTEMPTS = 3;

type PartitionClaim = Pick<Doc<"memoryClaims">, "scope" | "accountId" | "schoolId" | "workspaceId" | "artifactId">;

/**
 * Convex vector filters only support eq/or; one key binds the entire partition, including the
 * vector version, so vectors from another model never match. `undefined` when embeddings are off.
 */
export function memoryEmbeddingPartition(claim: PartitionClaim, version = embeddingVersion()) {
  const destination = claim.scope === "workspace" ? claim.workspaceId :
    claim.scope === "shared_artifact" ? claim.artifactId : claim.accountId;
  if (!destination || !version) return undefined;
  return JSON.stringify([version, "active", claim.scope, destination,
    claim.scope === "private_school" ? claim.schoolId : null]);
}

export const memoryQueryFitsBytes = embeddingInputFits;

export async function memoryInputHash(proposition: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proposition));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
