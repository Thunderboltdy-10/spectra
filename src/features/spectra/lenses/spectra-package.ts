import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";

export const SPECTRA_PACKAGE_VERSION = 1;
export const SPECTRA_PACKAGE_TYPES = ["flashcard_deck", "quiz", "planner_task", "agent", "whiteboard", "presentation"] as const;

const manifestSchema = z.object({ packageFormatVersion: z.number().int().positive(), artifactType: z.enum(SPECTRA_PACKAGE_TYPES), schemaVersion: z.number().int().positive(), createdByVersion: z.string().min(1) });
export type SpectraPackageManifest = z.infer<typeof manifestSchema>;
export type SpectraPackage = { manifest: SpectraPackageManifest; content: unknown; assets: Record<string, Uint8Array>; history: Record<string, Uint8Array>; readme: string };

const README = "Spectra package\n\nThis ZIP container stores manifest.json, content.json, assets/, and optional history/. It is a portable Spectra artifact and never masquerades as an Office file.\n";

export function createSpectraPackage(input: { artifactType: SpectraPackageManifest["artifactType"]; schemaVersion: number; createdByVersion: string; content: unknown; assets?: Record<string, Uint8Array>; history?: Record<string, Uint8Array> }) {
  const manifest = manifestSchema.parse({ packageFormatVersion: SPECTRA_PACKAGE_VERSION, artifactType: input.artifactType, schemaVersion: input.schemaVersion, createdByVersion: input.createdByVersion });
  const files: Record<string, Uint8Array> = { "manifest.json": strToU8(JSON.stringify(manifest, null, 2)), "content.json": strToU8(JSON.stringify(input.content)), "README.txt": strToU8(README) };
  for (const [name, bytes] of Object.entries(input.assets ?? {})) files[`assets/${safePath(name)}`] = bytes;
  for (const [name, bytes] of Object.entries(input.history ?? {})) files[`history/${safePath(name)}`] = bytes;
  return zipSync(files, { level: 6 });
}

function safePath(name: string) { const normalized = name.replaceAll("\\", "/").replace(/^\/+/, ""); if (!normalized || normalized.split("/").includes("..")) throw new Error("SPECTRA_PACKAGE_PATH_INVALID"); return normalized; }

export function openSpectraPackage(bytes: Uint8Array): SpectraPackage {
  const files = unzipSync(bytes);
  if (!files["manifest.json"] || !files["content.json"] || !files["README.txt"]) throw new Error("SPECTRA_PACKAGE_INCOMPLETE");
  const rawManifest = JSON.parse(strFromU8(files["manifest.json"]!));
  const upgraded = upgradeManifest(rawManifest);
  const content = JSON.parse(strFromU8(files["content.json"]!));
  const assets: Record<string, Uint8Array> = {}; const history: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(files)) { if (name.startsWith("assets/") && !name.endsWith("/")) assets[name.slice(7)] = data; if (name.startsWith("history/") && !name.endsWith("/")) history[name.slice(8)] = data; }
  return { manifest: upgraded, content, assets, history, readme: strFromU8(files["README.txt"]!) };
}

export function upgradeManifest(value: unknown): SpectraPackageManifest {
  const legacy = z.object({ version: z.literal(0), type: z.enum(SPECTRA_PACKAGE_TYPES), schemaVersion: z.number().int().positive(), createdBy: z.string().min(1) }).safeParse(value);
  if (legacy.success) return { packageFormatVersion: 1, artifactType: legacy.data.type, schemaVersion: legacy.data.schemaVersion, createdByVersion: legacy.data.createdBy };
  const manifest = manifestSchema.parse(value);
  if (manifest.packageFormatVersion > SPECTRA_PACKAGE_VERSION) throw new Error("SPECTRA_PACKAGE_VERSION_NEWER");
  return manifest;
}

export function summarizeSpectraPackage(bytes: Uint8Array) { const pkg = openSpectraPackage(bytes); return { artifactType: pkg.manifest.artifactType, schemaVersion: pkg.manifest.schemaVersion, packageFormatVersion: pkg.manifest.packageFormatVersion, assetCount: Object.keys(pkg.assets).length, historyEntryCount: Object.keys(pkg.history).length, contentKeys: pkg.content && typeof pkg.content === "object" && !Array.isArray(pkg.content) ? Object.keys(pkg.content as Record<string, unknown>) : [] }; }
