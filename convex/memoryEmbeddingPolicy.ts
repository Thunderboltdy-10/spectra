/** Shared by Convex mutations and Node actions; no provider I/O in this module. */
import type { Doc } from "./_generated/dataModel";
export const MEMORY_EMBEDDING_VERSION = "openrouter:OpenAI:text-embedding-3-small:256:v1";
export const MEMORY_EMBEDDING_MODEL = "openai/text-embedding-3-small";
export const MEMORY_EMBEDDING_DIMENSIONS = 256;
export const MEMORY_QUERY_MAX_BYTES = 8_192;
export const MEMORY_QUERY_MAX_TOKENS = 2_048;
export const MEMORY_EMBEDDING_LEASE_MS = 30_000;
export const MEMORY_EMBEDDING_MAX_ATTEMPTS = 3;

export type MemoryEmbeddingFailure = "missing_key" | "query_too_large" | "timeout" | "network" |
  "rate_limited" | "provider_unavailable" | "provider_rejected" | "invalid_response";
export type MemoryEmbeddingResult = { ok: true; vector: number[]; cacheHit?: boolean } |
  { ok: false; code: MemoryEmbeddingFailure; retryable: boolean; cacheHit?: boolean };

type PartitionClaim = Pick<Doc<"memoryClaims">, "scope" | "accountId" | "schoolId" | "workspaceId" | "artifactId">;

/** Convex vector filters only support eq/or; one key binds the entire partition. */
export function memoryEmbeddingPartition(claim: PartitionClaim, version = MEMORY_EMBEDDING_VERSION) {
  const destination = claim.scope === "workspace" ? claim.workspaceId :
    claim.scope === "shared_artifact" ? claim.artifactId : claim.accountId;
  if (!destination) return undefined;
  return JSON.stringify([version, "active", claim.scope, destination,
    claim.scope === "private_school" ? claim.schoolId : null]);
}

export function validMemoryVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === MEMORY_EMBEDDING_DIMENSIONS &&
    value.every((number) => typeof number === "number" && Number.isFinite(number)) &&
    value.some((number) => number !== 0);
}

export function memoryQueryFitsBytes(value: string) {
  return value.length <= MEMORY_QUERY_MAX_BYTES &&
    new TextEncoder().encode(value).byteLength <= MEMORY_QUERY_MAX_BYTES;
}

export async function memoryInputHash(proposition: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(proposition));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
