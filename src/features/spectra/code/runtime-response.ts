/** Shared by the authenticated proxy and the browser package loader. */
export const MAX_EMBED_RUNTIME_BYTES = 14_000_000;

export async function readBoundedRuntimeResponse(
  response: Response,
  limit = MAX_EMBED_RUNTIME_BYTES,
  signal?: AbortSignal,
) {
  if (!response.body) {
    signal?.throwIfAborted();
    throw new Error(
      "RUNTIME_BUILD_UNAVAILABLE: The published build is unavailable.",
    );
  }
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel(signal?.reason).catch(() => {});
  };
  signal?.addEventListener("abort", cancel, { once: true });
  // Grow a single buffer so tiny chunks cannot create an unbounded list of
  // retained objects. Both the buffer and its growth are capped by the budget.
  let bytes = new Uint8Array(Math.min(limit, 65_536));
  let length = 0;
  let complete = false;
  try {
    if (Number(response.headers.get("content-length") ?? 0) > limit)
      throw new Error(
        "RUNTIME_BUILD_LIMIT: The published build exceeds its safety budget.",
      );
    for (;;) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) {
        complete = true;
        break;
      }
      if (!value) continue;
      const nextLength = length + value.byteLength;
      if (nextLength > limit)
        throw new Error(
          "RUNTIME_BUILD_LIMIT: The published build exceeds its safety budget.",
        );
      if (nextLength > bytes.length) {
        const grown = new Uint8Array(
          Math.min(limit, Math.max(nextLength, bytes.length * 2)),
        );
        grown.set(bytes);
        bytes = grown;
      }
      bytes.set(value, length);
      length = nextLength;
    }
    return bytes.slice(0, length);
  } finally {
    signal?.removeEventListener("abort", cancel);
    if (!complete) cancel();
    reader.releaseLock();
  }
}
