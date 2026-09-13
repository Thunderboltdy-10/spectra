import { createHash } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";

const actor = {
  clerkId: "route-import-owner",
  accountId: "account-route-import-owner",
  email: "route-import-owner@example.test",
  emailVerified: true,
  name: "Route import owner",
  schoolId: "school-route-import",
  schoolRole: "school_admin" as const,
  membershipId: "membership-route-import",
};

const convexMutation = vi.fn();
const convexAction = vi.fn();

vi.mock("@/lib/auth-server", () => ({
  requireActor: vi.fn(async () => actor),
}));
vi.mock("@/lib/convex-server", () => ({
  convexMutation,
  convexAction,
  convexQuery: vi.fn(),
}));

describe("streaming original import route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.SPECTRA_SECRET_BRIDGE_KEY = "v8-route-secret-which-is-long-enough-123456";
    convexMutation.mockResolvedValue({
      uploadUrl: "https://storage.test/import-upload",
      uploadReceipt: "receipt-import-route",
      bytes: 5,
      sha256: createHash("sha256").update(new Uint8Array([1, 2, 3, 4, 5])).digest("hex"),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      status: "uploading",
    });
    convexAction.mockResolvedValue({ jobId: "job-import-route", status: "uploaded" });
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) {
        const body = init.body instanceof ReadableStream
          ? await new Response(init.body).arrayBuffer()
          : await new Response(init.body as BodyInit).arrayBuffer();
        return new Response(JSON.stringify({ storageId: "storage-import-route" }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Observed-Bytes": String(body.byteLength),
          },
        });
      }
      return new Response(JSON.stringify({ storageId: "storage-import-route" }), { status: 200 });
    }));
  });

  it("streams the request and forwards the exact byte count and digest", async () => {
    const { NextRequest } = await import("next/server");
    const { PUT } = await import("../imports/route");
    const response = await PUT(new NextRequest("http://localhost/api/spectra/imports?jobId=job-import-route", {
      method: "PUT",
      body: new Uint8Array([1, 2, 3, 4, 5]),
    }));

    expect(response.status).toBe(200);
    expect(convexAction).toHaveBeenCalledWith("artifactIntakeActions:verifyUploadedOriginal", expect.objectContaining({
      jobId: "job-import-route",
      storageId: "storage-import-route",
      attestation: expect.objectContaining({ bytes: 5 }),
    }));
  });

  it("quarantines a short streamed candidate instead of finalizing it", async () => {
    convexAction.mockResolvedValue({
      jobId: "job-import-route",
      status: "quarantined",
      errorCode: "IMPORT_UPLOAD_INTEGRITY_FAILED",
    });
    const { NextRequest } = await import("next/server");
    const { PUT } = await import("../imports/route");
    const response = await PUT(new NextRequest("http://localhost/api/spectra/imports?jobId=job-import-route", {
      method: "PUT",
      body: new Uint8Array([1, 2, 3, 4]),
    }));

    expect(response.status).not.toBe(200);
    expect(convexAction).toHaveBeenCalledWith("artifactIntakeActions:verifyUploadedOriginal", expect.objectContaining({
      jobId: "job-import-route",
      storageId: "storage-import-route",
      attestation: expect.objectContaining({ bytes: 4 }),
    }));
  });
});
