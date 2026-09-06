import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
});

function mockActor() {
  return {
    clerkId: "user_spectra",
    email: "student@spectra.test",
    name: "Spectra Student",
    role: "student",
    schoolId: "school_1",
    userId: "account_1",
    onboardingComplete: true,
  };
}

describe("Library resource import route", () => {
  it("deletes the hollow citizen when payload upload fails", async () => {
    const convexMutation = vi
      .fn()
      .mockResolvedValueOnce({
        artifactId: "artifact_hollow",
        nodeId: "node_hollow",
      })
      .mockResolvedValueOnce("https://upload.test/put")
      .mockResolvedValueOnce({ ok: true }); // permanentlyDelete compensation

    vi.doMock("@/lib/auth-server", () => ({
      requireActor: vi.fn().mockResolvedValue(mockActor()),
    }));
    vi.doMock("@/lib/convex-server", () => ({ convexMutation }));

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      }),
    );

    const { POST } = await import("../route");
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([1, 2, 3, 4])], "qa-resource.pdf", {
        type: "application/pdf",
      }),
    );
    const response = await POST(
      new NextRequest("http://localhost/api/spectra/resources", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(convexMutation).toHaveBeenCalledWith(
      "spectraArtifacts:createImportedResource",
      expect.objectContaining({
        title: "qa-resource",
        nativeFormat: "pdf",
      }),
    );
    expect(convexMutation).toHaveBeenCalledWith("payloads:issueUpload", {
      workId: "artifact_hollow",
    });
    expect(convexMutation).toHaveBeenCalledWith(
      "spectraArtifacts:permanentlyDelete",
      { artifactId: "artifact_hollow" },
    );
    // Never attach a payload after a failed upload.
    expect(
      convexMutation.mock.calls.some(
        (call) => call[0] === "replicas:attachPortablePayload",
      ),
    ).toBe(false);
    expect(
      convexMutation.mock.calls.some((call) => call[0] === "payloads:put"),
    ).toBe(false);
  });

  it("does not leave an orphan when attach fails after upload", async () => {
    const convexMutation = vi
      .fn()
      .mockResolvedValueOnce({
        artifactId: "artifact_orphan",
        nodeId: "node_orphan",
      })
      .mockResolvedValueOnce("https://upload.test/put")
      .mockResolvedValueOnce({ payloadRef: "payload_1", deduplicated: false })
      .mockRejectedValueOnce(new Error("ATTACH_FAILED"))
      .mockResolvedValueOnce({ ok: true });

    vi.doMock("@/lib/auth-server", () => ({
      requireActor: vi.fn().mockResolvedValue(mockActor()),
    }));
    vi.doMock("@/lib/convex-server", () => ({ convexMutation }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ storageId: "storage_1" }),
      }),
    );

    const { POST } = await import("../route");
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array([9])], "photo.png", { type: "image/png" }),
    );
    const response = await POST(
      new NextRequest("http://localhost/api/spectra/resources", {
        method: "POST",
        body: form,
      }),
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(convexMutation).toHaveBeenCalledWith(
      "spectraArtifacts:permanentlyDelete",
      { artifactId: "artifact_orphan" },
    );
  });
});
