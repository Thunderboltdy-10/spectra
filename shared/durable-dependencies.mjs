/** Small ownership facts stay visible when the editor body moves to storage. */
export function contentDependencies(value) {
  const assetIds = new Set();
  const nativePayloadHashes = new Set();
  const visit = item => {
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      if (key === "assetId" && typeof child === "string") assetIds.add(child);
      else if (key === "sourcePayloadHash" && typeof child === "string" && /^[a-f0-9]{64}$/.test(child)) nativePayloadHashes.add(child);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(value);
  if (assetIds.size + nativePayloadHashes.size > 512) throw new Error("COLLABORATION_CONTENT_DEPENDENCIES_SIZE");
  return { assetIds: [...assetIds].sort(), nativePayloadHashes: [...nativePayloadHashes].sort() };
}
