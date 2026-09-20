import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexQuery, storeArtifactContent } from "@/lib/convex-server";
import { docxLens } from "@/features/spectra/lenses/docx-lens";
import { xlsxLens } from "@/features/spectra/lenses/xlsx-lens";
import { pptxLens } from "@/features/spectra/lenses/pptx-lens";
import {
  xlsxArtifactContent,
  pptxArtifactContent,
  convexSafeFidelityMap,
} from "@/features/spectra/lenses/office-content";
import { bindDocxProjectionSource } from "@/features/spectra/lenses/document-projection";
import { encodeArtifactContentForStorage } from "../../../../../../shared/sheet-cells";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const spreadsheetFormats = new Set(["xlsx", "xlsm", "xltx", "xltm", "xlam"]);
const presentationFormats = new Set([
  "pptx",
  "pptm",
  "potx",
  "potm",
  "ppsx",
  "ppsm",
  "ppam",
]);

function fidelityReportFromMap(
  entries: Array<{
    feature: string;
    class: string;
    reason?: string;
  }>,
) {
  const report = entries.map((entry) => ({
    scope: entry.feature,
    level:
      entry.class === "NATIVE"
        ? ("exact" as const)
        : entry.class === "PRESERVED"
          ? ("exact" as const)
          : ("adapted" as const),
    message:
      entry.reason ??
      `Preserved by the Spectra Office lens: ${entry.feature}.`,
  }));
  const bounded = convexSafeFidelityMap(report);
  if (Array.isArray(bounded)) return bounded;
  return [
    {
      scope: "native",
      level: "adapted" as const,
      message:
        "Native features Spectra cannot edit remain in the original package.",
    },
  ];
}

export async function POST(request: Request) {
  try {
    await requireActor();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      return NextResponse.json({ error: "IMPORT_FILE_REQUIRED" }, { status: 400 });
    const format = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (format !== "docx" && !spreadsheetFormats.has(format) && !presentationFormats.has(format))
      return NextResponse.json({ error: "IMPORT_OFFICE_FORMAT_UNSUPPORTED" }, { status: 400 });
    const artifactId = form.get("artifactId");
    if (typeof artifactId !== "string" || !artifactId)
      throw new Error("IMPORT_ARTIFACT_REQUIRED");
    // Check access before parsing an expensive package; adoption rechecks the
    // current permission epoch when the immutable body is complete.
    await convexQuery("spectraArtifacts:get", { artifactId });
    const payload = new Uint8Array(await file.arrayBuffer());
    if (format === "docx") {
      const opened = await docxLens.open(payload, "strict-native");
      const content = await storeArtifactContent(artifactId, bindDocxProjectionSource(
        opened.projection, artifactId, createHash("sha256").update(payload).digest("hex"),
      ));
      return NextResponse.json({
        ok: true,
        blueprintKey: "document",
        nativeFormat: format,
        content,
        fidelityReport: fidelityReportFromMap(opened.fidelityMap.entries),
        unsupportedFeatures: opened.fidelityMap.entries
          .filter((entry) => entry.class === "EXTENSION")
          .map((entry) => entry.feature),
        parserVersion: "spectra-office-lens/1",
        activationStub: false,
      });
    }
    if (spreadsheetFormats.has(format)) {
      const opened = await xlsxLens.open(payload, "strict-native");
      opened.projection.nativeBinding.sourceArtifactId = artifactId;
      opened.projection.nativeBinding.sourcePayloadHash = createHash("sha256").update(payload).digest("hex");
      const content = await storeArtifactContent(artifactId, encodeArtifactContentForStorage(
        "sheets",
        xlsxArtifactContent(opened.projection),
      ));
      return NextResponse.json({
        ok: true,
        blueprintKey: "sheets",
        nativeFormat: format,
        content,
        fidelityReport: fidelityReportFromMap(opened.fidelityMap.entries),
        unsupportedFeatures: opened.fidelityMap.entries
          .filter((entry) => entry.class === "EXTENSION")
          .map((entry) => entry.feature),
        parserVersion: "spectra-office-lens/1",
        activationStub: false,
      });
    }
    if (presentationFormats.has(format)) {
      const opened = await pptxLens.open(payload, "strict-native");
      opened.projection.nativeBinding.sourceArtifactId = artifactId;
      opened.projection.nativeBinding.sourcePayloadHash = createHash("sha256").update(payload).digest("hex");
      const content = await storeArtifactContent(artifactId, encodeArtifactContentForStorage(
        "presentation",
        pptxArtifactContent(opened.projection),
      ));
      return NextResponse.json({
        ok: true,
        blueprintKey: "presentation",
        nativeFormat: format,
        content,
        fidelityReport: fidelityReportFromMap(opened.fidelityMap.entries),
        unsupportedFeatures: opened.fidelityMap.entries
          .filter((entry) => entry.class === "EXTENSION")
          .map((entry) => entry.feature),
        parserVersion: "spectra-office-lens/1",
        activationStub: false,
      });
    }
    return NextResponse.json(
      { error: "IMPORT_OFFICE_FORMAT_UNSUPPORTED" },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "IMPORT_OFFICE_LENS_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "Could not parse this Office file.",
      },
      { status: 400 },
    );
  }
}
