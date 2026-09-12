import { createHash } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";

const actor = {
  clerkId: "route-owner",
  accountId: "account-route-owner",
  email: "route-owner@example.test",
  name: "Route owner",
  schoolId: "school-route",
  schoolRole: "student" as const,
  membershipId: "membership-route",
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

describe("trusted asset intake route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.SPECTRA_SECRET_BRIDGE_KEY = "w6-route-secret-which-is-long-enough-123456";
    convexMutation.mockResolvedValue({
      assetId: "asset-route",
      reused: false,
      uploadReceipt: "receipt-route",
      uploadUrl: "https://storage.test/upload",
    });
    convexAction.mockResolvedValue({ assetId: "asset-route", status: "active", committed: true });
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body) {
        const body = init.body instanceof ReadableStream
          ? await new Response(init.body).arrayBuffer()
          : await new Response(init.body as BodyInit).arrayBuffer();
        expect(new Uint8Array(body)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
      }
      return new Response(JSON.stringify({ storageId: "storage-route" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
  });

  it("hashes/counts the actual stream and forwards a signed storage receipt", async () => {
    const { NextRequest } = await import("next/server");
    const { PUT } = await import("../assets/route");
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const response = await PUT(new NextRequest("http://localhost/api/spectra/assets?artifactId=artifact-route&path=images%2Fw6.png&name=w6.png", {
      method: "PUT",
      headers: { "Content-Type": "image/png", "X-Spectra-Sha256": digest, "X-Spectra-Bytes": String(bytes.byteLength) },
      body: bytes,
    }));
    expect(response.status).toBe(200);
    expect(convexAction).toHaveBeenCalledWith("artifactIntakeActions:verifyUploadedStorage", expect.objectContaining({
      assetId: "asset-route",
      storageId: "storage-route",
      uploadReceipt: "receipt-route",
      attestation: expect.objectContaining({ bytes: 5, sha256: digest, mediaType: "image/png", actorAccountId: actor.accountId, targetId: "asset-route" }),
    }));
    const attestation = convexAction.mock.calls[0]![1].attestation as { signature: string; nonce: string; expiresAt: number };
    expect(attestation.signature.length).toBeGreaterThan(40);
    expect(attestation.nonce.length).toBeGreaterThan(16);
    expect(attestation.expiresAt).toBeGreaterThan(Date.now());
  });
});
