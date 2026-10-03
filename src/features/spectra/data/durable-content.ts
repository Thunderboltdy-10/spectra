import { MAX_INLINE_CONTENT_BYTES, MAX_DURABLE_PAYLOAD_BYTES, isDurableContentRef, type DurableContentRef } from "../../../../shared/durable-content";
import { inlineContentFitsNesting } from "../../../../shared/convex-nesting.mjs";
import { requestSpectra } from "./request";

/** Only native/version operations upload a full body; editing uses Yjs deltas. */
export async function contentForDurableRequest(artifactId: string, value: unknown) {
  if (isDurableContentRef(value)) return value;
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.byteLength <= MAX_INLINE_CONTENT_BYTES && inlineContentFitsNesting(value)) return value;
  if (bytes.byteLength > MAX_DURABLE_PAYLOAD_BYTES) throw new Error("COLLABORATION_DURABLE_PAYLOAD_SIZE");
  const response = await requestSpectra(`/api/spectra/content?artifactId=${encodeURIComponent(artifactId)}`, {
    method: "POST", headers: {"Content-Type": "application/json"}, body: bytes,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "CONTENT_UPLOAD_FAILED");
  return result as DurableContentRef;
}
