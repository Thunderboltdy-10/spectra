import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

describe("proxy invitation handling", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("keeps /join?token=... on the join page while persisting the invitation cookie", async () => {
    vi.doMock("@clerk/nextjs/server", () => ({
      createRouteMatcher: () => () => false,
      clerkMiddleware:
        (handler: (auth: () => Promise<{ userId: string | null }>, req: NextRequest) => Promise<Response>) =>
        (request: NextRequest) =>
          handler(async () => ({ userId: null }), request),
    }));

    const { default: proxy } = await import("@/proxy");
    const response = await proxy(
      new NextRequest("http://localhost/join?token=tok_123"),
      {} as never,
    );

    expect(response).toBeDefined();
    expect(response!.headers.get("location")).toBeNull();
  });

  it("redirects signed-in recovery traffic with invitation cookie back to /join", async () => {
    vi.doMock("@/lib/clerk-config", () => ({ hasClerkServerConfig: () => true }));
    vi.doMock("@clerk/nextjs/server", () => ({
      createRouteMatcher: () => () => true,
      clerkMiddleware:
        (handler: (auth: () => Promise<{ userId: string | null }>, req: NextRequest) => Promise<Response>) =>
        (request: NextRequest) =>
          handler(async () => ({ userId: "user_1" }), request),
    }));

    const { default: proxy } = await import("@/proxy");
    const request = new NextRequest("http://localhost/no-access", {
      headers: {
        Cookie: "ai-school-invitation-token=tok_cookie_1",
      },
    });
    const response = await proxy(request, {} as never);

    expect(response).toBeDefined();
    expect(response!.headers.get("location")).toBe("http://localhost/join?token=tok_cookie_1");
  });
});
