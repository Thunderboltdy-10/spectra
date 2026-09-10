import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "crypto";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("anonymous public projection route", () => {
  it("does not forward a browser-supplied domain into the authority query", async () => {
    const convexPublicQuery = vi.fn().mockResolvedValue(null);
    const auth = vi.fn();
    vi.doMock("@/lib/convex-server", () => ({ convexPublicQuery }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth }));

    const { POST } = await import("../route");
    const token = "A".repeat(40);
    const response = await POST(
      new NextRequest("http://localhost/api/spectra/public", {
        method: "POST",
        body: JSON.stringify({ token, viewerDomain: "trusted.example" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(404);
    expect(convexPublicQuery).toHaveBeenCalledWith(
      "authority:publicProjection",
      { tokenHash: createHash("sha256").update(token).digest("hex") },
    );
    expect(convexPublicQuery.mock.calls[0]?.[1]).not.toHaveProperty(
      "viewerDomain",
    );
    expect(auth).not.toHaveBeenCalled();
  });

  it("uses the authenticated Convex path when Clerk reports a signed-in viewer", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "test-secret");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_example");
    const convexQuery = vi.fn().mockResolvedValue({
      resourceType: "artifact",
      level: "read",
      artifact: { artifactId: "artifact-1", title: "Shared work" },
    });
    const convexPublicQuery = vi.fn();
    const auth = vi.fn().mockResolvedValue({ userId: "viewer-1" });
    vi.doMock("@/lib/convex-server", () => ({
      convexQuery,
      convexPublicQuery,
    }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth }));

    const { POST } = await import("../route");
    const token = "B".repeat(40);
    const response = await POST(
      new NextRequest("http://localhost/api/spectra/public", {
        method: "POST",
        body: JSON.stringify({ token, viewerDomain: "forged.example" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(auth).toHaveBeenCalledOnce();
    expect(convexQuery).toHaveBeenCalledWith(
      "authority:publicProjection",
      { tokenHash: createHash("sha256").update(token).digest("hex") },
    );
    expect(convexPublicQuery).not.toHaveBeenCalled();
  });

  it("returns a sign-in response for a restricted link without leaking a browser domain", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "test-secret");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_example");
    const convexPublicQuery = vi.fn().mockResolvedValue({
      access: "sign_in_required",
    });
    const auth = vi.fn().mockResolvedValue({ userId: null });
    vi.doMock("@/lib/convex-server", () => ({ convexPublicQuery }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth }));

    const { POST } = await import("../route");
    const response = await POST(
      new NextRequest("http://localhost/api/spectra/public", {
        method: "POST",
        body: JSON.stringify({
          token: "C".repeat(40),
          viewerDomain: "trusted.example",
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
    expect(convexPublicQuery.mock.calls[0]?.[1]).toEqual({
      tokenHash: createHash("sha256").update("C".repeat(40)).digest("hex"),
    });
  });

  it("maps verified-identity restriction failures to actionable HTTP errors", async () => {
    vi.stubEnv("CLERK_SECRET_KEY", "test-secret");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_example");
    const convexQuery = vi
      .fn()
      .mockResolvedValueOnce({ access: "email_unverified" })
      .mockResolvedValueOnce({ access: "domain_restricted" });
    const auth = vi.fn().mockResolvedValue({ userId: "viewer-1" });
    vi.doMock("@/lib/convex-server", () => ({ convexQuery }));
    vi.doMock("@clerk/nextjs/server", () => ({ auth }));

    const { POST } = await import("../route");
    const request = (token: string) =>
      new NextRequest("http://localhost/api/spectra/public", {
        method: "POST",
        body: JSON.stringify({ token }),
        headers: { "content-type": "application/json" },
      });

    const unverified = await POST(request("D".repeat(40)));
    expect(unverified.status).toBe(403);
    expect(await unverified.json()).toMatchObject({
      code: "AUTH_EMAIL_UNVERIFIED",
    });

    const wrongDomain = await POST(request("E".repeat(40)));
    expect(wrongDomain.status).toBe(403);
    expect(await wrongDomain.json()).toMatchObject({
      code: "PUBLIC_DOMAIN_RESTRICTED",
    });
  });
});
