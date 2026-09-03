import { Presentation } from "@ariadng/office/pptx";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { fetchVerifiedNativePayload } from "@/features/spectra/lenses/native-payload-server";
import { sniffOfficeRasterMedia } from "@/features/spectra/lenses/office-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_RELATIONSHIP =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

const requestSchema = z.object({
  artifactId: z.string().min(1),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  partName: z.string().regex(/^\/ppt\/media\/[^/\\\u0000-\u001f]{1,400}$/u),
});

function relatedImagePart(
  deck: Presentation,
  partName: string,
) {
  for (const slide of deck.slides()) {
    const slidePart = deck.office.package.getPart(slide.partName);
    if (!slidePart) continue;
    const relationship = slidePart
      .relationships()
      .byType(IMAGE_RELATIONSHIP)
      .find((candidate) => {
        const part = deck.office.package.relatedPart(slidePart, candidate.id);
        return part?.name.toLowerCase() === partName.toLowerCase();
      });
    if (!relationship) continue;
    return deck.office.package.relatedPart(slidePart, relationship.id);
  }
  return undefined;
}

export async function GET(request: NextRequest) {
  try {
    const input = requestSchema.parse({
      artifactId: request.nextUrl.searchParams.get("artifactId"),
      payloadHash: request.nextUrl.searchParams.get("payloadHash"),
      partName: request.nextUrl.searchParams.get("partName"),
    });
    const retained = await fetchVerifiedNativePayload(
      input.artifactId as Id<"spectraArtifacts">,
      "cloud",
    );
    if (retained.truth.hash !== input.payloadHash)
      throw new Error("NATIVE_MEDIA_REVISION_STALE");

    const deck = await Presentation.open(retained.payload);
    const part = relatedImagePart(deck, input.partName);
    if (!part) throw new Error("NATIVE_MEDIA_PART_UNAVAILABLE");
    const bytes = await part.read();
    const mediaType = sniffOfficeRasterMedia(bytes);
    if (!bytes.byteLength || !mediaType)
      throw new Error("NATIVE_MEDIA_CONTENT_MISMATCH");

    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": mediaType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    // Keep authorization, stale-revision and missing-part failures
    // indistinguishable to callers probing package internals.
    return NextResponse.json(
      { error: "NATIVE_MEDIA_UNAVAILABLE" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
