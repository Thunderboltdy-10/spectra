"use client";

import { getArtifactAssets } from "../data/api";
import type { SpectraSandboxAsset } from "../embed/sandbox-protocol";
import type { CodeAssetReference } from "./model";

const MAX_RUNTIME_ASSET_BYTES = 8_000_000;

async function sha256(blob: Blob) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("The asset could not be prepared for preview."));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Asset read failed."));
    reader.readAsDataURL(blob);
  });
}

export async function loadCodeRuntimeAssets(
  artifactId: string,
  references: readonly CodeAssetReference[],
) {
  if (!references.length)
    return { assets: [] as SpectraSandboxAsset[], diagnostics: [] as string[] };
  const result = await getArtifactAssets(
    artifactId,
    references.map((reference) => reference.assetId),
  );
  const byId = new Map(result.assets.map((asset) => [asset.assetId, asset]));
  const assets: SpectraSandboxAsset[] = [];
  const diagnostics: string[] = [];
  let preparedBytes = 0;
  for (const reference of references) {
    const asset = byId.get(reference.assetId);
    if (
      !asset ||
      asset.status !== "active" ||
      !asset.downloadUrl ||
      asset.sha256 !== reference.sha256 ||
      asset.mediaType !== reference.mediaType ||
      asset.bytes !== reference.bytes
    ) {
      diagnostics.push(
        `${reference.path} is missing, revoked, or no longer matches its immutable reference.`,
      );
      continue;
    }
    if (preparedBytes + reference.bytes > MAX_RUNTIME_ASSET_BYTES) {
      diagnostics.push(
        `${reference.path} was not loaded because live preview assets exceed 8 MB.`,
      );
      continue;
    }
    try {
      const response = await fetch(asset.downloadUrl, {
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("download unavailable");
      const downloaded = await response.blob();
      if (
        downloaded.size !== reference.bytes ||
        (await sha256(downloaded)) !== reference.sha256
      )
        throw new Error("integrity check failed");
      const typed =
        downloaded.type === reference.mediaType
          ? downloaded
          : downloaded.slice(0, downloaded.size, reference.mediaType);
      assets.push({
        id: reference.id,
        path: reference.path,
        mediaType: reference.mediaType,
        dataUrl: await dataUrl(typed),
      });
      preparedBytes += reference.bytes;
    } catch {
      diagnostics.push(
        `${reference.path} could not be loaded without weakening asset integrity.`,
      );
    }
  }
  return { assets, diagnostics };
}
