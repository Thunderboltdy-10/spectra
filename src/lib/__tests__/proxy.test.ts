import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

describe("proxy invitation handling", () => {
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
});
