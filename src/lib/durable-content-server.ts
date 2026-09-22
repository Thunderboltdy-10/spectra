import { signTrustedIntakeAttestation } from "./server-secrets";
import { createHash } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import type { ConvexHttpClient } from "convex/browser";
import { isDurableContentRef, MAX_INLINE_CONTENT_BYTES, MAX_DURABLE_PAYLOAD_BYTES, type DurableContentRef } from "../../shared/durable-content";
import { contentDependencies } from "../../shared/durable-dependencies.mjs";

/** Hydration happens outside Convex values; permission is checked on each read. */
export async function hydrateDurableContent(value: unknown, client: ConvexHttpClient, cache = new Map<string, Promise<unknown>>()): Promise<unknown> {
  if (isDurableContentRef(value)) {
    const ref = value.spectraContentRef;
    const key = JSON.stringify(ref);
    const existing = cache.get(key);
    if (existing) return existing;
    const pending = (async () => {
    const descriptor = await client.query(makeFunctionReference<"query">("artifactContent:read"), {
      artifactId: ref.artifactId, payloadRef: ref.payloadRef, digest: ref.digest,
    });
    if (!descriptor?.url) throw new Error("COLLABORATION_DURABLE_PAYLOAD_MISSING");
    const response = await fetch(descriptor.url, { cache: "no-store" });
    if (!response.ok) throw new Error("COLLABORATION_DURABLE_PAYLOAD_MISSING");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== ref.byteLength || createHash("sha256").update(bytes).digest("hex") !== ref.digest)
      throw new Error("COLLABORATION_DURABLE_PAYLOAD_INTEGRITY");
    const body = JSON.parse(bytes.toString("utf8"));
    return ref.path === "content" ? body.content : body;
    })();
    cache.set(key, pending);
    return pending;
  }
  if (Array.isArray(value)) return Promise.all(value.map(item => hydrateDurableContent(item, client, cache)));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await hydrateDurableContent(item, client, cache)]));
    return Object.fromEntries(entries);
  }
  return value;
}

export async function persistDurableContent(value: unknown, artifactId: string, client: ConvexHttpClient): Promise<unknown> {
  if (isDurableContentRef(value)) return value;
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length <= MAX_INLINE_CONTENT_BYTES) return value;
  if (bytes.length > MAX_DURABLE_PAYLOAD_BYTES) throw new Error("COLLABORATION_DURABLE_PAYLOAD_SIZE");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const upload = await client.mutation(makeFunctionReference<"mutation">("artifactContent:issueUpload"), { artifactId });
  const response = await fetch(upload.url, { method: "POST", headers: { "Content-Type": "application/vnd.spectra.content+json" }, body: bytes });
  if (!response.ok) throw new Error("COLLABORATION_DURABLE_UPLOAD_FAILED");
  const { storageId } = await response.json();
  const dependencies = contentDependencies(value);
  const stored = await client.action(makeFunctionReference<"action">("artifactIntakeActions:adoptDurableContent"), {
    artifactId, policyVersion: upload.policyVersion,
    attestation: signTrustedIntakeAttestation({kind: "content", actorClerkId: upload.clerkId, actorAccountId: upload.accountId, targetId: artifactId, attemptId: JSON.stringify([upload.policyVersion, dependencies]), storageId, sha256: digest, bytes: bytes.length, mediaType: "application/vnd.spectra.content+json"}),
    dependencies,
  });
  return { spectraContentRef: { version: 1, artifactId, payloadRef: stored.payloadRef,
    digest, byteLength: bytes.length, path: "value", dependencies: stored.dependencies } } satisfies DurableContentRef;
}
