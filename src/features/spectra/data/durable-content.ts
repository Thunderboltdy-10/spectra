import { MAX_INLINE_CONTENT_BYTES, MAX_DURABLE_PAYLOAD_BYTES, isDurableContentRef, type DurableContentRef } from "../../../../shared/durable-content";
import { contentDependencies } from "../../../../shared/durable-dependencies.mjs";

/** Only native/version operations upload a full body; editing uses Yjs deltas. */
export async function contentForDurableRequest(artifactId: string, value: unknown) {
  if (isDurableContentRef(value)) return value;
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.byteLength <= MAX_INLINE_CONTENT_BYTES) return value;
  if (bytes.byteLength > MAX_DURABLE_PAYLOAD_BYTES) throw new Error("COLLABORATION_DURABLE_PAYLOAD_SIZE");
  const post = async (body: unknown) => {
    const response = await fetch("/api/spectra/content", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "CONTENT_UPLOAD_FAILED");
    return result;
  };
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2,"0")).join("");
  const upload = await post({action:"upload",artifactId});
  const response = await fetch(upload.url, {method:"POST",headers:{"Content-Type":"application/vnd.spectra.content+json"},body:bytes});
  if (!response.ok) throw new Error("CONTENT_UPLOAD_FAILED");
  const {storageId} = await response.json();
  const stored = await post({action:"adopt",artifactId,storageId,digest,byteLength:bytes.byteLength,policyVersion:upload.policyVersion,dependencies:contentDependencies(value)});
  return {spectraContentRef:{version:1,artifactId,payloadRef:stored.payloadRef,digest,byteLength:bytes.byteLength,path:"value",dependencies:stored.dependencies}} satisfies DurableContentRef;
}
