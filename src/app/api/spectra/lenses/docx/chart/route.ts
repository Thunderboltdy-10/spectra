import { Document } from "@ariadng/office/docx";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import {
  fetchVerifiedNativePayload,
  fetchVerifiedNativePayloadByHash,
} from "@/features/spectra/lenses/native-payload-server";
import { renderWordChartSvg } from "@/features/spectra/lenses/docx-chart-svg";
import { OFFICE_ARCHIVE_LIMITS, prepareBoundedArchiveBytes } from "../../../../../../../shared/parser-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHART_RELATIONSHIP =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart";
const MAX_CHART_BYTES = 8 * 1024 * 1024;

const requestSchema = z.object({
  artifactId: z.string().min(1),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  partName: z.string().regex(/^\/word\/charts\/chart\d{1,5}\.xml$/iu),
  width: z.coerce.number().int().min(16).max(4_000),
  height: z.coerce.number().int().min(16).max(4_000),
});

/** A Word chart, drawn as SVG from the values cached in its part. */
export async function GET(request: NextRequest) {
  try {
    const input = requestSchema.parse({
      artifactId: request.nextUrl.searchParams.get("artifactId"),
      payloadHash: request.nextUrl.searchParams.get("payloadHash"),
      partName: request.nextUrl.searchParams.get("partName"),
      width: request.nextUrl.searchParams.get("width"),
      height: request.nextUrl.searchParams.get("height"),
    });
    let payload: Uint8Array;
    let servedFromCurrentRevision = false;
    try {
      payload = (
        await fetchVerifiedNativePayloadByHash(
          input.payloadHash,
          input.artifactId as Id<"spectraArtifacts">,
        )
      ).payload;
    } catch (error) {
      // A released package falls back to the current linked file, never cached.
      if (!(error instanceof Error) || error.message !== "NATIVE_PAYLOAD_UNAVAILABLE") throw error;
      payload = (
        await fetchVerifiedNativePayload(input.artifactId as Id<"spectraArtifacts">, "cloud")
      ).payload;
      servedFromCurrentRevision = true;
    }
    const document = await Document.open(await prepareBoundedArchiveBytes(payload, OFFICE_ARCHIVE_LIMITS));
    // Only a chart the document itself draws is served.
    const part = document.office.mainPart
      .relationships()
      .byType(CHART_RELATIONSHIP)
      .map((relationship) => document.office.package.relatedPart(document.office.mainPart, relationship.id))
      .find((candidate) => candidate?.name.toLowerCase() === input.partName.toLowerCase());
    if (!part) throw new Error("NATIVE_CHART_PART_UNAVAILABLE");
    const bytes = await part.read();
    if (!bytes.byteLength || bytes.byteLength > MAX_CHART_BYTES) throw new Error("NATIVE_CHART_PART_UNAVAILABLE");
    const svg = renderWordChartSvg(new TextDecoder().decode(bytes), input.width, input.height);
    return new NextResponse(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Disposition": "inline",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
        "Cache-Control": servedFromCurrentRevision
          ? "private, no-store"
          : "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "NATIVE_CHART_UNAVAILABLE" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
