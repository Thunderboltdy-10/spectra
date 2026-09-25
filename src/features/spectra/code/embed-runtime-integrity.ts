import { createHash } from "crypto";
import { MAX_EMBED_RUNTIME_BYTES } from "./runtime-response";
export {
  MAX_EMBED_RUNTIME_BYTES,
  readBoundedRuntimeResponse,
} from "./runtime-response";

export function verifyEmbeddedRuntimeBytes(
  bytes: Uint8Array,
  access: { payloadHash: string; payloadBytes: number },
) {
  if (
    bytes.byteLength > MAX_EMBED_RUNTIME_BYTES ||
    access.payloadBytes > MAX_EMBED_RUNTIME_BYTES
  )
    throw new Error(
      "RUNTIME_BUILD_LIMIT: The published build exceeds its safety budget.",
    );
  if (bytes.byteLength !== access.payloadBytes)
    throw new Error(
      "RUNTIME_BUILD_SIZE_MISMATCH: The published build has an unexpected size.",
    );
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== access.payloadHash.toLowerCase())
    throw new Error(
      "RUNTIME_BUILD_INTEGRITY_FAILED: The published build failed its integrity check.",
    );
}
