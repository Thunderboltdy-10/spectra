import { createHash } from "crypto";
import type { Id } from "../../../../convex/_generated/dataModel";
import { convexQuery } from "@/lib/convex-server";

export type ResolvedArtifactAsset = {
  assetId: Id<"artifactAssets">;
  bytes: Uint8Array;
  mediaType: string;
  name: string;
  sha256: string;
};

/**
 * Resolve a durable asset identity to verified bytes for a native writer.
 * Writers must pass the identity, never persist the authenticated content URL
 * into a DOCX/XLSX/PPTX package. The Convex query performs the access check and
 * this helper verifies the physical object again before returning it.
 */
export async function resolveArtifactAssetBytes(assetId: Id<"artifactAssets">) {
  const asset = await convexQuery<
    { assetId: Id<"artifactAssets"> },
    { url: string | null; mediaType: string; name: string; bytes: number; sha256: string; assetId: Id<"artifactAssets"> }
  >("artifactAssets:getContent", { assetId });
  if (!asset.url) throw new Error("ASSET_NOT_AVAILABLE");
  const response = await fetch(asset.url, { cache: "no-store" });
  if (!response.ok) throw new Error("ASSET_FETCH_FAILED");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== asset.bytes || digest !== asset.sha256)
    throw new Error("ASSET_INTEGRITY_FAILED");
  return {
    assetId: asset.assetId,
    bytes,
    mediaType: asset.mediaType,
    name: asset.name,
    sha256: asset.sha256,
  } satisfies ResolvedArtifactAsset;
}
