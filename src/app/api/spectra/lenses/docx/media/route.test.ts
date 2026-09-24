import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchVerifiedNativePayload = vi.fn();
const fetchVerifiedNativePayloadByHash = vi.fn();
const readImage = vi.fn();
const imageBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

vi.mock("@ariadng/office/docx", () => ({
  Document: {
    open: vi.fn(async () => ({
      office: {
        mainPart: { relationships: () => ({ byType: () => [{ id: "rId1" }] }) },
        package: {
          relatedPart: () => ({
            name: "/word/media/image1.png",
            contentType: "image/png",
            read: readImage,
          }),
        },
      },
    })),
  },
}));

vi.mock("@/features/spectra/lenses/native-payload-server", () => ({
  fetchVerifiedNativePayload,
  fetchVerifiedNativePayloadByHash,
}));

vi.mock("../../../../../../../shared/parser-limits", () => ({
  OFFICE_ARCHIVE_LIMITS: {},
  prepareBoundedArchiveBytes: async (payload: Uint8Array) => payload,
}));

const artifactId = "wx7bckbz85gt17zwfyn4wanzf18ezat3";
const payloadHash = "c1ed0617e67d2a8f1a734f6d81d2209ce3e1cabcb1aea0b2e8c38f96169e5212";

async function requestMedia() {
  const { GET } = await import("./route");
  return GET(
    new NextRequest(
      `http://localhost/api/spectra/lenses/docx/media?artifactId=${artifactId}&payloadHash=${payloadHash}&partName=%2Fword%2Fmedia%2Fimage1.png`,
    ),
  );
}

describe("DOCX media route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    readImage.mockResolvedValue(imageBytes);
  });

  it("serves the exact retained source package with immutable caching", async () => {
    fetchVerifiedNativePayloadByHash.mockResolvedValue({ payload: new Uint8Array([1]) });

    const response = await requestMedia();

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageBytes);
    expect(fetchVerifiedNativePayloadByHash).toHaveBeenCalledWith(payloadHash, artifactId);
    expect(fetchVerifiedNativePayload).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
  });

  it("uses the current package when the projection's old source payload was released", async () => {
    fetchVerifiedNativePayloadByHash.mockRejectedValue(
      new Error("NATIVE_PAYLOAD_UNAVAILABLE"),
    );
    fetchVerifiedNativePayload.mockResolvedValue({
      truth: { hash: "a58d6c7217ed2412fc3ee181c6e87517c1c0695ce61186d03bc8a886d9439795" },
      payload: new Uint8Array([2]),
    });

    const response = await requestMedia();

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageBytes);
    expect(fetchVerifiedNativePayload).toHaveBeenCalledWith(artifactId, "cloud");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not mask a failure reading an available historical payload", async () => {
    fetchVerifiedNativePayloadByHash.mockRejectedValue(
      new Error("NATIVE_PAYLOAD_VERIFICATION_FAILED"),
    );

    const response = await requestMedia();

    expect(response.status).toBe(404);
    expect(fetchVerifiedNativePayload).not.toHaveBeenCalled();
  });
});
