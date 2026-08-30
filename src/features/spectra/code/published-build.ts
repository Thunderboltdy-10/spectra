import { normalizeCodeNetworkOrigins } from "./network-policy";
import {
  codeRuntimeVersion,
  normalizePythonPackages,
  type CodeContent,
  type CodeFile,
  type CodeParameter,
  type CodeRuntime,
} from "./model";

export const SPECTRA_RUNTIME_BUILD_FORMAT = "spectra-runtime-build" as const;
export const SPECTRA_RUNTIME_BUILD_VERSION = 4 as const;

export type PublishedCodeAsset = {
  id: string;
  path: string;
  mediaType: string;
  bytes: number;
  sha256: string;
  dataUrl: string;
};

export function runtimeSourceDescriptor(content: CodeContent) {
  return {
    runtime: content.runtime,
    runtimeVersion: codeRuntimeVersion(content.runtime),
    entryFileId: content.entryFileId,
    files: content.files.map((file) => ({
      id: file.id,
      path: file.path,
      language: file.language,
      source: file.source,
    })),
    dependencies: Object.fromEntries(
      Object.entries(content.dependencies ?? {}).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    pythonPackages: content.pythonPackages ?? [],
    notebook: content.notebook ?? { enabled: false },
    visualisation: content.visualisation,
    accessibility: content.accessibility ?? null,
    networkPolicy: content.networkPolicy ?? { mode: "none" },
    parameters: content.parameters ?? [],
    assets: (content.assets ?? []).map((asset) => ({
      id: asset.id,
      assetId: asset.assetId,
      path: asset.path,
      mediaType: asset.mediaType,
      bytes: asset.bytes,
      sha256: asset.sha256,
    })),
  };
}

export function runtimeSourceString(content: CodeContent) {
  return JSON.stringify(runtimeSourceDescriptor(content));
}

export async function runtimeSourceHash(content: CodeContent) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(runtimeSourceString(content)),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export type PublishedCodeBuildPayload = {
  format: typeof SPECTRA_RUNTIME_BUILD_FORMAT;
  version: typeof SPECTRA_RUNTIME_BUILD_VERSION;
  sdkVersion: string;
  artifactId: string;
  artifactVersionId: string;
  title: string;
  sourceHash: string;
  runtime: Exclude<CodeRuntime, "none">;
  runtimeVersion: string;
  entryFileId: string;
  dependencies: Record<string, string>;
  pythonPackages?: NonNullable<CodeContent["pythonPackages"]>;
  notebook?: NonNullable<CodeContent["notebook"]>;
  networkPolicy: { mode: "none" | "allowlist"; allowlist?: string[] };
  parameters: CodeParameter[];
  assets: PublishedCodeAsset[];
  files: CodeFile[];
  visualisation: {
    enabled: boolean;
    title?: string;
    description?: string;
    aspectRatio?: number;
  };
  accessibility?: {
    title?: string;
    description?: string;
    reducedMotion?: boolean;
  };
  createdAt: number;
};

export function isPublishedCodeBuildPayload(
  value: unknown,
): value is PublishedCodeBuildPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (
    row.format !== SPECTRA_RUNTIME_BUILD_FORMAT ||
    row.version !== SPECTRA_RUNTIME_BUILD_VERSION ||
    typeof row.sdkVersion !== "string" ||
    typeof row.artifactId !== "string" ||
    typeof row.artifactVersionId !== "string" ||
    typeof row.title !== "string" ||
    typeof row.sourceHash !== "string" ||
    !["browser", "react", "python"].includes(String(row.runtime)) ||
    typeof row.runtimeVersion !== "string" ||
    row.runtimeVersion !== codeRuntimeVersion(row.runtime as CodeRuntime) ||
    typeof row.entryFileId !== "string" ||
    !Array.isArray(row.files) ||
    !Array.isArray(row.parameters) ||
    !Array.isArray(row.assets)
  ) {
    return false;
  }
  if (row.files.length < 1 || row.files.length > 500) return false;
  if (row.parameters.length > 80) return false;
  if (row.assets.length > 100) return false;
  if (
    row.pythonPackages !== undefined &&
    (!Array.isArray(row.pythonPackages) ||
      !row.pythonPackages.every((entry) => typeof entry === "string") ||
      normalizePythonPackages(row.pythonPackages).length !==
        row.pythonPackages.length)
  )
    return false;
  if (
    row.notebook !== undefined &&
    (!row.notebook ||
      typeof row.notebook !== "object" ||
      Array.isArray(row.notebook) ||
      typeof (row.notebook as Record<string, unknown>).enabled !== "boolean")
  )
    return false;
  let assetBytes = 0;
  const assetIds = new Set<string>();
  const assetPaths = new Set<string>();
  for (const value of row.assets) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const asset = value as Record<string, unknown>;
    if (
      typeof asset.id !== "string" ||
      typeof asset.path !== "string" ||
      typeof asset.mediaType !== "string" ||
      typeof asset.bytes !== "number" ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes < 1 ||
      asset.bytes > 8_000_000 ||
      typeof asset.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(asset.sha256) ||
      typeof asset.dataUrl !== "string" ||
      !asset.dataUrl.startsWith(`data:${asset.mediaType};base64,`) ||
      assetIds.has(asset.id) ||
      assetPaths.has(asset.path.toLowerCase())
    )
      return false;
    assetIds.add(asset.id);
    assetPaths.add(asset.path.toLowerCase());
    assetBytes += asset.bytes;
  }
  if (assetBytes > 8_000_000) return false;
  const parameterIds = new Set<string>();
  const parameterKeys = new Set<string>();
  for (const value of row.parameters) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const parameter = value as Record<string, unknown>;
    if (
      typeof parameter.id !== "string" ||
      typeof parameter.key !== "string" ||
      typeof parameter.label !== "string" ||
      !["number", "text", "boolean", "select"].includes(
        String(parameter.type),
      ) ||
      !["string", "number", "boolean"].includes(typeof parameter.value) ||
      parameterIds.has(parameter.id) ||
      parameterKeys.has(parameter.key)
    ) {
      return false;
    }
    parameterIds.add(parameter.id);
    parameterKeys.add(parameter.key);
  }
  const networkPolicy = row.networkPolicy;
  if (
    !networkPolicy ||
    typeof networkPolicy !== "object" ||
    Array.isArray(networkPolicy)
  ) {
    return false;
  }
  const network = networkPolicy as Record<string, unknown>;
  if (!["none", "allowlist"].includes(String(network.mode))) return false;
  if (
    network.allowlist !== undefined &&
    (!Array.isArray(network.allowlist) ||
      !network.allowlist.every((origin) => typeof origin === "string") ||
      normalizeCodeNetworkOrigins(network.allowlist as string[]).length !==
        network.allowlist.length)
  ) {
    return false;
  }
  if (
    network.mode === "none" &&
    Array.isArray(network.allowlist) &&
    network.allowlist.length
  )
    return false;
  if (row.runtime === "python" && network.mode === "allowlist") return false;
  return row.files.every((file) => {
    if (!file || typeof file !== "object" || Array.isArray(file)) return false;
    const candidate = file as Record<string, unknown>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.path === "string" &&
      typeof candidate.language === "string" &&
      typeof candidate.source === "string"
    );
  });
}

export type PublishedCodeBuildProjection = {
  buildId: string;
  artifactId: string;
  artifactVersionId: string;
  runtime: Exclude<CodeRuntime, "none">;
  runtimeVersion: string;
  status: "published" | "superseded";
  sourceHash: string;
  payloadHash?: string;
  sdkVersion: string;
  entryFileId: string;
  dependencies: Record<string, string>;
  sourceBytes: number;
  outputBytes: number;
  payloadBytes?: number;
  publishedAt?: number;
  storageUrl: string;
};
