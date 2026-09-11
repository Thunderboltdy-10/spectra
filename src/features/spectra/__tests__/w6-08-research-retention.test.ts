import { describe, expect, it } from "vitest";
import {
  compactResearchEvidence,
} from "@/features/spectra/sources/research";
import {
  createEvidenceSpan,
  createVerifiedSource,
  contentHash,
} from "@/features/spectra/sources/records";
import {
  attachmentBytesAsInput,
  attachmentInputBytes,
  attachmentSha256,
} from "@/features/spectra/compute/files/attachment-retention";

describe("W6-08 research and attachment retention", () => {
  it("keeps source/evidence handles server-owned while bounding excerpts", () => {
    const source = createVerifiedSource({
      title: "Trusted source",
      url: "https://example.edu/research?utm_source=test",
      content: "A complete source representation.",
      accessedAt: "2026-09-11T10:00:00.000Z",
      sourceType: "web",
      authority: "primary",
      provider: "test-provider",
    });
    const span = createEvidenceSpan(source, "A cited excerpt");
    const bundle = compactResearchEvidence({
      sources: [source],
      evidence: [span],
      partial: true,
    });
    expect(bundle.sources[0]?.id).toBe(source.id);
    expect(bundle.sources[0]?.canonicalUrl).toBe("https://example.edu/research");
    expect(bundle.evidence[0]?.id).not.toBe(span.id);
    expect(bundle.evidence[0]?.sourceId).toBe(source.id);
    expect(bundle.evidence[0]?.excerptHash).toBe(
      contentHash(bundle.evidence[0]!.excerpt),
    );
    expect(bundle.partial).toBe(true);
    expect(bundle.citations).toEqual([]);
  });

  it("round-trips text and binary attachment bytes without persisting base64 metadata", () => {
    const text = { name: "notes.txt", mimeType: "text/plain", handling: "text", data: "évidence" } as const;
    const textBytes = attachmentInputBytes(text);
    expect(new TextDecoder().decode(textBytes)).toBe(text.data);
    expect(attachmentSha256(textBytes)).toMatch(/^[a-f0-9]{64}$/);

    const imageBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    const image = attachmentBytesAsInput(imageBytes, {
      id: "upload-1",
      name: "pixel.png",
      mimeType: "image/png",
      handling: "image",
    });
    expect(image.id).toBe("upload-1");
    expect(image.data).toBe("data:image/png;base64,iVBORw==");
    expect(attachmentInputBytes(image)).toEqual(Buffer.from(imageBytes));
    expect(Object.keys(image)).not.toContain("sourceMap");
  });
});
