import {
  isPublishedCodeBuildPayload,
  type PublishedCodeBuildPayload,
} from "./published-build";
import { publishedRuntimeSourceUrl } from "./published-runtime-source";
import {
  MAX_EMBED_RUNTIME_BYTES,
  readBoundedRuntimeResponse,
} from "./runtime-response";

export type RuntimeBuild = {
  buildId: string;
  artifactVersionId: string;
  runtime: "browser" | "react" | "python";
  payloadHash?: string;
  sdkVersion: string;
  payloadBytes?: number;
  storageUrl?: string;
};

export const PUBLISHED_RUNTIME_LOAD_TIMEOUT_MS = 30_000;

async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyEmbeddedAssets(
  payload: PublishedCodeBuildPayload,
  signal: AbortSignal,
) {
  for (const asset of payload.assets) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const marker = `data:${asset.mediaType};base64,`;
    if (!asset.dataUrl.startsWith(marker))
      throw new Error(
        `Published asset ${asset.path} has an invalid media envelope.`,
      );
    const encoded = asset.dataUrl.slice(marker.length);
    if (encoded.length > Math.ceil(asset.bytes / 3) * 4 + 8)
      throw new Error(
        `Published asset ${asset.path} exceeds its recorded size.`,
      );
    let binary: string;
    try {
      binary = atob(encoded);
    } catch {
      throw new Error(
        `Published asset ${asset.path} is not valid base64 data.`,
      );
    }
    if (binary.length !== asset.bytes)
      throw new Error(`Published asset ${asset.path} has an unexpected size.`);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1)
      bytes[index] = binary.charCodeAt(index);
    const digest = await sha256(bytes.buffer);
    if (digest !== asset.sha256)
      throw new Error(
        `Published asset ${asset.path} failed its integrity check.`,
      );
  }
}

async function readBuild(
  build: RuntimeBuild,
  signal: AbortSignal,
  embedId?: string,
) {
  signal.throwIfAborted();
  if (
    build.payloadBytes !== undefined &&
    build.payloadBytes > MAX_EMBED_RUNTIME_BYTES
  )
    throw new Error("The runtime package exceeds its safety budget.");
  const sourceUrl = publishedRuntimeSourceUrl(build, embedId);
  const response = await fetch(sourceUrl, {
    cache: "no-store",
    signal,
    credentials: embedId ? "same-origin" : "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    if (response.status === 401)
      throw new Error("Sign in again to open this published preview.");
    if (response.status === 403)
      throw new Error("You no longer have access to this published preview.");
    throw new Error("The retained runtime package is unavailable.");
  }
  const bytes = await readBoundedRuntimeResponse(
    response,
    MAX_EMBED_RUNTIME_BYTES,
    signal,
  );
  if (
    build.payloadBytes !== undefined &&
    bytes.byteLength !== build.payloadBytes
  ) {
    throw new Error("The retained runtime package has an unexpected size.");
  }
  const digest = await sha256(bytes.buffer);
  if (build.payloadHash && digest !== build.payloadHash) {
    throw new Error("The retained runtime package failed its integrity check.");
  }
  const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (!isPublishedCodeBuildPayload(value))
    throw new Error(
      "The retained runtime package is not valid Spectra output.",
    );
  if (
    value.artifactVersionId !== build.artifactVersionId ||
    value.runtime !== build.runtime ||
    value.sdkVersion !== build.sdkVersion
  ) {
    throw new Error(
      "The retained runtime package does not match its published record.",
    );
  }
  await verifyEmbeddedAssets(value, signal);
  signal.throwIfAborted();
  return value;
}

/** One attempt, with a deadline; a retry is an explicit reader action. */
export async function loadPublishedRuntimeBuild(
  build: RuntimeBuild,
  signal: AbortSignal,
  embedId?: string,
) {
  signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () =>
      controller.abort(
        new Error("The published preview took too long to load. Try again."),
      ),
    PUBLISHED_RUNTIME_LOAD_TIMEOUT_MS,
  );
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      readBuild(build, controller.signal, embedId),
      cancelled,
    ]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
