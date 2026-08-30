import { createHash } from "crypto";

export const MAX_EMBED_RUNTIME_BYTES = 14_000_000;

export async function readBoundedRuntimeResponse(
  response: Response,
  limit = MAX_EMBED_RUNTIME_BYTES,
) {
  if (!response.body)
    throw new Error(
      "RUNTIME_BUILD_UNAVAILABLE: The published build is unavailable.",
    );
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error(
          "RUNTIME_BUILD_LIMIT: The published build exceeds its safety budget.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

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
