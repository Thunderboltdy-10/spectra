import type { Id } from "../../../../convex/_generated/dataModel";
import { resolveArtifactAssetBytes } from "./asset-resolver-server";
import type { PptxMediaWriteOptions } from "./pptx-media";

/** Native routes inject authenticated asset resolution; packages contain only
 * embedded bytes and durable IDs, never a temporary authenticated URL. */
export const pptxMediaWriteOptions: PptxMediaWriteOptions = {
  async resolveAsset(image) {
    const resolved = await resolveArtifactAssetBytes(image.assetId as Id<"artifactAssets">);
    if (resolved.mediaType.toLowerCase() !== image.mediaType || resolved.sha256 !== image.sha256)
      throw Object.assign(new Error("The durable picture asset differs from the requested image."), { code: "PPTX_IMAGE_ASSET_MISMATCH" });
    return resolved.bytes;
  },
};
