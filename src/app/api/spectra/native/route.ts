import { NextResponse } from "next/server";
import { z } from "zod";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { sha256Payload } from "@/features/spectra/lenses/docx-lens";
import { fetchVerifiedNativePayload, uploadNativePayload } from "@/features/spectra/lenses/native-payload-server";
import { createSpectraPackage, SPECTRA_PACKAGE_TYPES } from "@/features/spectra/lenses/spectra-package";

export const runtime = "nodejs";

type ArtifactTruth = { _id: Id<"spectraArtifacts">; blueprintKey: string; title: string; content?: unknown };
type ActiveMount = { _id: Id<"bridgeMounts"> };

const materializeSchema = z.object({
  artifactId: z.string().min(1),
  mountId: z.string().optional(),
  fileName: z.string().trim().min(1).max(180).optional(),
});

const mediaTypes: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  docm: "application/vnd.ms-word.document.macroEnabled.12",
  dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  dotm: "application/vnd.ms-word.template.macroEnabled.12",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xltx: "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  xltm: "application/vnd.ms-excel.template.macroEnabled.12",
  xlam: "application/vnd.ms-excel.addin.macroEnabled.12",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pptm: "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
  potx: "application/vnd.openxmlformats-officedocument.presentationml.template",
  potm: "application/vnd.ms-powerpoint.template.macroEnabled.12",
  ppsx: "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
  ppsm: "application/vnd.ms-powerpoint.slideshow.macroEnabled.12",
  ppam: "application/vnd.ms-powerpoint.addin.macroEnabled.12",
  "spectra-pkg": "application/vnd.spectra.package+zip",
};

function artifactId(value: string) { return value as Id<"spectraArtifacts">; }
function safeBaseName(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").trim() || "Spectra work";
}

async function verifiedPayload(workId: Id<"spectraArtifacts">) {
  try { return await fetchVerifiedNativePayload(workId, "cloud"); } catch (error) {
    if (error instanceof Error && error.message === "NATIVE_PAYLOAD_UNAVAILABLE") return null;
    throw error;
  }
}

async function ensurePortablePayload(workId: Id<"spectraArtifacts">) {
  const existing = await verifiedPayload(workId);
  if (existing) return existing;
  const artifact = await convexQuery<{ artifactId: Id<"spectraArtifacts"> }, ArtifactTruth>("spectraArtifacts:get", { artifactId: workId });
  if (!SPECTRA_PACKAGE_TYPES.includes(artifact.blueprintKey as (typeof SPECTRA_PACKAGE_TYPES)[number])) throw new Error("NATIVE_PAYLOAD_UNAVAILABLE");
  const payload = createSpectraPackage({ artifactType: artifact.blueprintKey as (typeof SPECTRA_PACKAGE_TYPES)[number], schemaVersion: 1, createdByVersion: "spectra-n5", content: artifact.content ?? {} });
  const hash = await sha256Payload(payload);
  const mediaType = mediaTypes["spectra-pkg"]!;
  const stored = await uploadNativePayload(workId, payload, hash, "spectra-pkg");
  await convexMutation("replicas:attachPortablePayload", { workId, payloadRef: stored.payloadRef, contentHash: hash, nativeFormat: "spectra-pkg" });
  return { truth: { url: null, bytes: payload.byteLength, hash, mediaType, payloadRef: stored.payloadRef, nativeFormat: "spectra-pkg" }, payload };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workId = artifactId(z.string().min(1).parse(url.searchParams.get("artifactId")));
    const [artifact, retained] = await Promise.all([
      convexQuery<{ artifactId: Id<"spectraArtifacts"> }, ArtifactTruth>("spectraArtifacts:get", { artifactId: workId }),
      ensurePortablePayload(workId),
    ]);
    const extension = retained.truth.nativeFormat;
    const fileName = `${safeBaseName(artifact.title.replace(/\.[^.]+$/, ""))}.${extension}`;
    return new NextResponse(Buffer.from(retained.payload), { headers: { "Content-Type": retained.truth.mediaType || mediaTypes[extension] || "application/octet-stream", "Content-Length": String(retained.payload.byteLength), "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`, "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return NextResponse.json({ error: "NATIVE_DOWNLOAD_FAILED", message: error instanceof Error ? error.message : "The retained native file is unavailable." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    const input = materializeSchema.parse(await request.json());
    const workId = artifactId(input.artifactId);
    const [artifact, retained, mounts] = await Promise.all([
      convexQuery<{ artifactId: Id<"spectraArtifacts"> }, ArtifactTruth>("spectraArtifacts:get", { artifactId: workId }),
      ensurePortablePayload(workId),
      convexQuery<Record<string, never>, ActiveMount[]>("bridge:activeMounts", {}),
    ]);
    const mount = input.mountId ? mounts.find((candidate) => String(candidate._id) === input.mountId) : mounts[0];
    if (!mount) throw new Error("NO_ACTIVE_BRIDGE_FOLDER");
    const extension = retained.truth.nativeFormat;
    const requested = input.fileName ? safeBaseName(input.fileName.replace(/\.[^.]+$/, "")) : safeBaseName(artifact.title.replace(/\.[^.]+$/, ""));
    const relativePath = `${requested}.${extension}`;
    const result = await convexMutation<
      { workId: Id<"spectraArtifacts">; mountId: Id<"bridgeMounts">; relativePath: string; payloadRef: string; contentHash: string; nativeFormat: string; fidelityMap: unknown },
      { state: "pending" | "existing"; replicaId: string; requestId: string | null }
    >("replicas:createLocalReplica", { workId, mountId: mount._id, relativePath, payloadRef: retained.truth.payloadRef, contentHash: retained.truth.hash, nativeFormat: extension, fidelityMap: {} });
    return NextResponse.json({ ...result, relativePath });
  } catch (error) {
    return NextResponse.json({ error: "NATIVE_MATERIALIZATION_FAILED", message: error instanceof Error ? error.message : "The file could not be saved to the selected Bridge folder." }, { status: 400 });
  }
}
