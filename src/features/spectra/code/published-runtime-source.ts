export function publishedRuntimeSourceUrl(
  build: { storageUrl?: string },
  embedId?: string,
) {
  if (embedId)
    return `/api/spectra/runtime/embed?embedId=${encodeURIComponent(embedId)}`;
  if (build.storageUrl) return build.storageUrl;
  throw new Error("The retained runtime package is unavailable.");
}
