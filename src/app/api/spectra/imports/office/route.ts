import { NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { docxLens } from "@/features/spectra/lenses/docx-lens";
import { xlsxLens } from "@/features/spectra/lenses/xlsx-lens";
import { pptxLens } from "@/features/spectra/lenses/pptx-lens";
import {
  xlsxArtifactContent,
  pptxArtifactContent,
  convexSafeOfficeActivationContent,
  convexSafeFidelityMap,
} from "@/features/spectra/lenses/office-content";
import { compactDocxProjectionForStorage } from "@/features/spectra/lenses/document-projection";
import { MAX_PERSISTED_CONTENT_BYTES } from "../../../../../../shared/intake-limits";

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

function utf8JsonBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

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

function tooLargeResponse(kind: "document" | "sheets" | "presentation") {
  const label =
    kind === "sheets"
      ? "workbook"
      : kind === "presentation"
        ? "deck"
        : "document";
  return NextResponse.json(
    {
      ok: false,
      error: "IMPORT_SNAPSHOT_TOO_LARGE",
      // Soft fail — never ship a multi-MB projection into the tab (Aw Snap 9).
      message: `This ${label} is too large to open as editable Spectra content in one step. The original file was not imported. Try a smaller file, or open it through Bridge so the native package stays off the hot artifact row.`,
      durableFailed: true,
    },
    { status: 413 },
  );
}

export async function POST(request: Request) {
  try {
    await requireActor();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      return NextResponse.json({ error: "IMPORT_FILE_REQUIRED" }, { status: 400 });
    const format = file.name.split(".").pop()?.toLowerCase() ?? "";
    const payload = new Uint8Array(await file.arrayBuffer());
    if (format === "docx") {
      const opened = await docxLens.open(payload, "strict-native");
      const content = compactDocxProjectionForStorage(opened.projection);
      if (utf8JsonBytes(content) > MAX_PERSISTED_CONTENT_BYTES)
        return tooLargeResponse("document");
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
      // Never return the full 200k-cell map to the browser — that OOMs the tab
      // (Chrome Aw Snap error code 9). Persist/open use the activation stub;
      // occupied cells live in the native package + lens HTTP open.
      const content = convexSafeOfficeActivationContent(
        "sheets",
        xlsxArtifactContent(opened.projection),
      );
      if (utf8JsonBytes(content) > MAX_PERSISTED_CONTENT_BYTES)
        return tooLargeResponse("sheets");
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
        activationStub: true,
      });
    }
    if (presentationFormats.has(format)) {
      const opened = await pptxLens.open(payload, "strict-native");
      const content = convexSafeOfficeActivationContent(
        "presentation",
        pptxArtifactContent(opened.projection),
      );
      if (utf8JsonBytes(content) > MAX_PERSISTED_CONTENT_BYTES)
        return tooLargeResponse("presentation");
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
        activationStub: true,
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
