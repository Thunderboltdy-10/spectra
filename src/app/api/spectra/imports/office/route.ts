import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { docxLens } from "@/features/spectra/lenses/docx-lens";
import { xlsxLens } from "@/features/spectra/lenses/xlsx-lens";
import { pptxLens } from "@/features/spectra/lenses/pptx-lens";
import {
  xlsxArtifactContent,
  pptxArtifactContent,
} from "@/features/spectra/lenses/office-content";

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

export async function POST(request: Request) {
  try {
    await requireActor();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      return NextResponse.json({ error: "IMPORT_FILE_REQUIRED" }, { status: 400 });
    const format = file.name.split(".").pop()?.toLowerCase() ?? "";
    const payload = new Uint8Array(await file.arrayBuffer());
    if (format === "docx" || format === "doc") {
      const opened = await docxLens.open(payload, "strict-native");
      return NextResponse.json({
        ok: true,
        blueprintKey: "document",
        nativeFormat: format,
        content: opened.projection,
        fidelityReport: opened.fidelityMap.entries.map((entry) => ({
          scope: entry.feature,
          level: entry.class === "NATIVE" ? "exact" : entry.class === "PRESERVED" ? "exact" : "adapted",
          message: entry.reason ?? `Preserved by the Spectra Office lens: ${entry.feature}.`,
        })),
        unsupportedFeatures: opened.fidelityMap.entries
          .filter((entry) => entry.class === "EXTENSION")
          .map((entry) => entry.feature),
        parserVersion: "spectra-office-lens/1",
      });
    }
    if (spreadsheetFormats.has(format)) {
      const opened = await xlsxLens.open(payload, "strict-native");
      return NextResponse.json({
        ok: true,
        blueprintKey: "sheets",
        nativeFormat: format,
        content: xlsxArtifactContent(opened.projection),
        fidelityReport: opened.fidelityMap.entries.map((entry) => ({
          scope: entry.feature,
          level: entry.class === "NATIVE" ? "exact" : entry.class === "PRESERVED" ? "exact" : "adapted",
          message: entry.reason ?? `Preserved by the Spectra Office lens: ${entry.feature}.`,
        })),
        unsupportedFeatures: opened.fidelityMap.entries
          .filter((entry) => entry.class === "EXTENSION")
          .map((entry) => entry.feature),
        parserVersion: "spectra-office-lens/1",
      });
    }
    if (presentationFormats.has(format)) {
      const opened = await pptxLens.open(payload, "strict-native");
      return NextResponse.json({
        ok: true,
        blueprintKey: "presentation",
        nativeFormat: format,
        content: pptxArtifactContent(opened.projection),
        fidelityReport: opened.fidelityMap.entries.map((entry) => ({
          scope: entry.feature,
          level: entry.class === "NATIVE" ? "exact" : entry.class === "PRESERVED" ? "exact" : "adapted",
          message: entry.reason ?? `Preserved by the Spectra Office lens: ${entry.feature}.`,
        })),
        unsupportedFeatures: opened.fidelityMap.entries
          .filter((entry) => entry.class === "EXTENSION")
          .map((entry) => entry.feature),
        parserVersion: "spectra-office-lens/1",
      });
    }
    return NextResponse.json({ error: "IMPORT_OFFICE_FORMAT_UNSUPPORTED" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: "IMPORT_OFFICE_LENS_FAILED", message: error instanceof Error ? error.message : "Could not parse this Office file." },
      { status: 400 },
    );
  }
}
