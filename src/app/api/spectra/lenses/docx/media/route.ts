import { Document } from "@ariadng/office/docx";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { fetchVerifiedNativePayload } from "@/features/spectra/lenses/native-payload-server";
import { OFFICE_ARCHIVE_LIMITS, prepareBoundedArchiveBytes } from "../../../../../../../shared/parser-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_RELATIONSHIP =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

const requestSchema = z.object({
  artifactId: z.string().min(1),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  partName: z.string().regex(/^\/word\/media\/[^/\\\u0000-\u001f]{1,400}$/u),
});

function hasMagic(mediaType: string, bytes: Uint8Array) {
  if (mediaType === "image/png")
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => bytes[index] === byte,
    );
  return (
    mediaType === "image/jpeg" &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  );
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

    const document = await Document.open(
      await prepareBoundedArchiveBytes(retained.payload, OFFICE_ARCHIVE_LIMITS),
    );
    const relationship = document.office.mainPart
      .relationships()
      .byType(IMAGE_RELATIONSHIP)
      .find((candidate) => {
        const part = document.office.package.relatedPart(
          document.office.mainPart,
          candidate.id,
        );
        return part?.name.toLowerCase() === input.partName.toLowerCase();
      });
    const part = relationship
      ? document.office.package.relatedPart(
          document.office.mainPart,
          relationship.id,
        )
      : undefined;
    const mediaType = part?.contentType.toLowerCase() ?? "";
    if (!part || !["image/png", "image/jpeg"].includes(mediaType))
      throw new Error("NATIVE_MEDIA_PART_UNAVAILABLE");
    const bytes = await part.read();
    if (!bytes.byteLength || !hasMagic(mediaType, bytes))
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
