/** Immutable content handles travel through the existing artifact/version APIs. */
export type DurableContentRef = {
  spectraContentRef: {
    version: 1;
    artifactId: string;
    payloadRef: string;
    digest: string;
    byteLength: number;
    path: "content" | "value";
    dependencies?: { assetIds: string[]; nativePayloadHashes: string[]; nativePayloadRefs: string[] };
  };
};

export function isDurableContentRef(value: unknown): value is DurableContentRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const ref = (value as DurableContentRef).spectraContentRef;
  return Boolean(ref && ref.version === 1 && typeof ref.artifactId === "string" &&
    typeof ref.payloadRef === "string" && /^[a-f0-9]{64}$/.test(ref.digest) &&
    Number.isSafeInteger(ref.byteLength) && ref.byteLength > 0 &&
    (ref.path === "content" || ref.path === "value"));
}

export const MAX_INLINE_CONTENT_BYTES = 256 * 1024;
export const MAX_DURABLE_PAYLOAD_BYTES = 256 * 1024 * 1024;
export const MAX_BRIDGE_ENVELOPE_BYTES = 1500 * 1024;
