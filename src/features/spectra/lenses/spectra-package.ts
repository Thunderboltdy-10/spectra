import { strFromU8, strToU8, zipSync } from "fflate";
import { z } from "zod";
import { validateArtifactContent } from "../artifacts/registry";
import { readBoundedArchive } from "../../../../shared/parser-limits";

export const SPECTRA_PACKAGE_VERSION = 1;
export const SPECTRA_PACKAGE_TYPES = ["flashcard_deck", "quiz", "planner_task", "agent", "whiteboard", "presentation"] as const;

const manifestSchema = z.object({ packageFormatVersion: z.number().int().positive(), artifactType: z.enum(SPECTRA_PACKAGE_TYPES), schemaVersion: z.number().int().positive(), createdByVersion: z.string().min(1) }).strict();
export type SpectraPackageManifest = z.infer<typeof manifestSchema>;
export type SpectraPackage = { manifest: SpectraPackageManifest; content: unknown; assets: Record<string, Uint8Array>; history: Record<string, Uint8Array>; readme: string };

const README = "Spectra package\n\nThis ZIP container stores manifest.json, content.json, assets/, and optional history/. It is a portable Spectra artifact and never masquerades as an Office file.\n";
const FIXED_ZIP_MTIME = new Date("1980-01-01T00:00:00.000Z");

function canonicalJson(value: unknown) {
  const seen = new WeakSet<object>();
  const normalize = (entry: unknown): unknown => {
    if (entry === null || typeof entry !== "object") return entry;
    if (entry instanceof Date) return entry.toJSON();
    if (seen.has(entry)) throw new Error("SPECTRA_PACKAGE_CONTENT_CIRCULAR");
    seen.add(entry);
    const result = Array.isArray(entry)
      ? entry.map(normalize)
      : Object.fromEntries(Object.keys(entry as Record<string, unknown>).sort().map((key) => [key, normalize((entry as Record<string, unknown>)[key])]));
    seen.delete(entry);
    return result;
  };
  const encoded = JSON.stringify(normalize(value));
  if (encoded === undefined) throw new Error("SPECTRA_PACKAGE_CONTENT_INVALID");
  return encoded;
}

export function createSpectraPackage(input: { artifactType: SpectraPackageManifest["artifactType"]; schemaVersion: number; createdByVersion: string; content: unknown; assets?: Record<string, Uint8Array>; history?: Record<string, Uint8Array> }) {
  const manifest = manifestSchema.parse({ packageFormatVersion: SPECTRA_PACKAGE_VERSION, artifactType: input.artifactType, schemaVersion: input.schemaVersion, createdByVersion: input.createdByVersion });
  if (!validateArtifactContent(manifest.artifactType, input.content).success)
    throw new Error("SPECTRA_PACKAGE_CONTENT_INVALID");
  const files: Record<string, Uint8Array> = { "README.txt": strToU8(README), "content.json": strToU8(canonicalJson(input.content)), "manifest.json": strToU8(canonicalJson(manifest)) };
  for (const [name, bytes] of Object.entries(input.assets ?? {}).sort(([a], [b]) => a.localeCompare(b))) files[`assets/${safePath(name)}`] = bytes;
  for (const [name, bytes] of Object.entries(input.history ?? {}).sort(([a], [b]) => a.localeCompare(b))) files[`history/${safePath(name)}`] = bytes;
  return zipSync(files, { level: 6, mtime: FIXED_ZIP_MTIME });
}

function safePath(name: string) {
  const normalized = name.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === ".."))
    throw new Error("SPECTRA_PACKAGE_PATH_INVALID");
  return normalized;
}

export async function openSpectraPackage(bytes: Uint8Array): Promise<SpectraPackage> {
  let files: Record<string, Uint8Array>;
  try {
    files = (await readBoundedArchive(bytes)).entries;
  } catch (error) {
    if (
      error instanceof Error &&
      /escapes the archive root|ARCHIVE_PATH_INVALID/.test(error.message)
    ) {
      throw new Error("SPECTRA_PACKAGE_PATH_INVALID");
    }
    throw new Error("SPECTRA_PACKAGE_CORRUPT");
  }
  for (const name of Object.keys(files)) {
    const directory = name.endsWith("/");
    const normalized = safePath(directory ? name.slice(0, -1) : name);
    if (`${normalized}${directory ? "/" : ""}` !== name)
      throw new Error("SPECTRA_PACKAGE_PATH_INVALID");
    if (
      !["README.txt", "content.json", "manifest.json"].includes(name) &&
      !name.startsWith("assets/") &&
      !name.startsWith("history/")
    )
      throw new Error("SPECTRA_PACKAGE_ENTRY_INVALID");
  }
  if (!files["manifest.json"] || !files["content.json"] || !files["README.txt"]) throw new Error("SPECTRA_PACKAGE_INCOMPLETE");
  let rawManifest: unknown; let content: unknown;
  try { rawManifest = JSON.parse(strFromU8(files["manifest.json"]!)); content = JSON.parse(strFromU8(files["content.json"]!)); } catch { throw new Error("SPECTRA_PACKAGE_JSON_INVALID"); }
  const assets: Record<string, Uint8Array> = {}; const history: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) { if (name.startsWith("assets/") && !name.endsWith("/")) assets[name.slice(7)] = data; if (name.startsWith("history/") && !name.endsWith("/")) history[name.slice(8)] = data; }
  const manifest = upgradeManifest(rawManifest);
  if (!validateArtifactContent(manifest.artifactType, content).success)
    throw new Error("SPECTRA_PACKAGE_CONTENT_INVALID");
  return { manifest, content, assets, history, readme: strFromU8(files["README.txt"]!) };
}

export function upgradeManifest(value: unknown): SpectraPackageManifest {
  const legacy = z.object({ version: z.literal(0), type: z.enum(SPECTRA_PACKAGE_TYPES), schemaVersion: z.number().int().positive(), createdBy: z.string().min(1) }).strict().safeParse(value);
  if (legacy.success) return { packageFormatVersion: 1, artifactType: legacy.data.type, schemaVersion: legacy.data.schemaVersion, createdByVersion: legacy.data.createdBy };
  const manifest = manifestSchema.parse(value);
  if (manifest.packageFormatVersion > SPECTRA_PACKAGE_VERSION) throw new Error("SPECTRA_PACKAGE_VERSION_NEWER");
  return manifest;
}

export async function summarizeSpectraPackage(bytes: Uint8Array) { const pkg = await openSpectraPackage(bytes); return { artifactType: pkg.manifest.artifactType, schemaVersion: pkg.manifest.schemaVersion, packageFormatVersion: pkg.manifest.packageFormatVersion, assetCount: Object.keys(pkg.assets).length, historyEntryCount: Object.keys(pkg.history).length, contentKeys: pkg.content && typeof pkg.content === "object" && !Array.isArray(pkg.content) ? Object.keys(pkg.content as Record<string, unknown>) : [] }; }
