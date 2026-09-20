import type { Id } from "../../../../convex/_generated/dataModel";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { sha256Payload } from "./docx-lens";

export const nativeMediaTypes: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  docm: "application/vnd.ms-word.document.macroEnabled.12",
  dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  dotm: "application/vnd.ms-word.template.macroEnabled.12",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xltx: "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  xltm: "application/vnd.ms-excel.template.macroEnabled.12",
  xlam: "application/vnd.ms-excel.addin.macroEnabled.12",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pptm: "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
  potx: "application/vnd.openxmlformats-officedocument.presentationml.template",
  potm: "application/vnd.ms-powerpoint.template.macroEnabled.12",
  ppsx: "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
  ppsm: "application/vnd.ms-powerpoint.slideshow.macroEnabled.12",
  ppam: "application/vnd.ms-powerpoint.addin.macroEnabled.12",
  "spectra-pkg": "application/vnd.spectra.package+zip",
};

export type NativePayloadTruth = {
  url: string | null;
  bytes: number;
  hash: string;
  mediaType: string;
  payloadRef: string;
  replicaId: string;
  replicaKind: "cloud" | "local";
  revision: string;
  baseRevision?: string;
  state: string;
  nativeFormat: string;
  fidelityMap?: unknown;
  projectionBasePayloadRef?: string;
  projectionBaseRevision?: string;
  projectionBaseContent?: unknown;
  projectionBaseContentHash?: string;
  projectionBaseTextIndex?: string;
  projectionBaseFidelityMap?: unknown;
  compatibilityProfile: "strict-native" | "enhanced" | "spectra-native";
};

export async function fetchVerifiedNativePayload(
  workId: Id<"spectraArtifacts">,
  prefer: "cloud" | "local-latest" = "cloud",
) {
  const truth = await convexQuery<
    { workId: Id<"spectraArtifacts">; prefer: typeof prefer },
    NativePayloadTruth | null
  >("replicas:payloadForWork", { workId, prefer });
  if (!truth?.url) throw new Error("NATIVE_PAYLOAD_UNAVAILABLE");
  const response = await fetch(truth.url, { cache: "no-store" });
  if (!response.ok) throw new Error("NATIVE_PAYLOAD_FETCH_FAILED");
  const payload = new Uint8Array(await response.arrayBuffer());
  if (
    payload.byteLength !== truth.bytes ||
    (await sha256Payload(payload)) !== truth.hash
  )
    throw new Error("NATIVE_PAYLOAD_VERIFICATION_FAILED");
  return { truth, payload };
}

export async function fetchVerifiedNativePayloadByHash(
  hash: string,
  workId?: Id<"spectraArtifacts">,
) {
  const truth = await convexQuery<
    { hash: string; workId?: Id<"spectraArtifacts"> },
    { url: string | null; bytes: number; mediaType: string; hash: string } | null
  >("payloads:get", { hash, ...(workId ? { workId } : {}) });
  if (!truth?.url) throw new Error("NATIVE_PAYLOAD_UNAVAILABLE");
  const response = await fetch(truth.url, { cache: "no-store" });
  if (!response.ok) throw new Error("NATIVE_PAYLOAD_FETCH_FAILED");
  const payload = new Uint8Array(await response.arrayBuffer());
  if (payload.byteLength !== truth.bytes || (await sha256Payload(payload)) !== truth.hash)
    throw new Error("NATIVE_PAYLOAD_VERIFICATION_FAILED");
  return { truth, payload };
}

export async function fetchStoredNativeBase(
  workId: Id<"spectraArtifacts">,
  truth: NativePayloadTruth,
  fallback: Uint8Array,
) {
  const hash = truth.projectionBaseRevision;
  if (!hash || hash === truth.hash) return fallback;
  return (await fetchVerifiedNativePayloadByHash(hash, workId)).payload;
}

export async function uploadNativePayload(
  workId: Id<"spectraArtifacts">,
  payload: Uint8Array,
  hash: string,
  nativeFormat: string,
) {
  const mediaType = nativeMediaTypes[nativeFormat] ?? "application/octet-stream";
  const uploadUrl = await convexMutation<{ workId: Id<"spectraArtifacts"> }, string>(
    "payloads:issueUpload",
    { workId },
  );
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": mediaType },
    body: Buffer.from(payload),
  });
  const stored = (await response.json().catch(() => null)) as
    | { storageId?: string }
    | null;
  if (!response.ok || !stored?.storageId)
    throw new Error("NATIVE_PAYLOAD_UPLOAD_FAILED");
  return convexMutation<
    {
      hash: string;
      workId: Id<"spectraArtifacts">;
      storageId: Id<"_storage">;
      bytes: number;
      mediaType: string;
    },
    { payloadRef: string; deduplicated: boolean }
  >("payloads:put", {
    workId,
    hash,
    storageId: stored.storageId as Id<"_storage">,
    bytes: payload.byteLength,
    mediaType,
  });
}

/** Legacy Library imports kept their exact original but lacked a native replica.
 * Adopt a separate verified copy into the existing payload/replica lifecycle. */
export async function ensureImportedNativePayload(workId: Id<"spectraArtifacts">) {
  const existing = await convexQuery("replicas:payloadForWork",{workId,prefer:"cloud"});
  if (existing) return;
  const original = await convexQuery<{artifactId:Id<"spectraArtifacts">},{url:string|null;hash:string;bytes:number;nativeFormat:string;content:unknown}|null>("artifactImports:nativeOriginal",{artifactId:workId});
  if (!original?.url) return;
  const response = await fetch(original.url,{cache:"no-store"});
  if (!response.ok) throw new Error("NATIVE_PAYLOAD_FETCH_FAILED");
  const payload = new Uint8Array(await response.arrayBuffer());
  if (payload.byteLength !== original.bytes || await sha256Payload(payload) !== original.hash) throw new Error("NATIVE_PAYLOAD_VERIFICATION_FAILED");
  const stored = await uploadNativePayload(workId,payload,original.hash,original.nativeFormat);
  await convexMutation("replicas:attachPortablePayload",{workId,payloadRef:stored.payloadRef,contentHash:original.hash,nativeFormat:original.nativeFormat,projectionBaseContent:original.content});
}
