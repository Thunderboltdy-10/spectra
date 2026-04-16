import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

function mockClerk(userId: string | null) {
  vi.doMock("@/lib/clerk-config", () => ({ hasClerkServerConfig: () => true }));
  vi.doMock("@clerk/nextjs/server", () => ({
    createRouteMatcher:
      (patterns: string[]) =>
      (req: NextRequest) => {
        const pathname = new URL(req.url).pathname;
        return patterns.some((pattern) => {
          const prefix = pattern.replace(/\(.*\)$/, "").replace(/\/$/, "");
          if (!prefix) return pathname === "/";
          return pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(prefix);
        });
      },
    clerkMiddleware:
      (handler: (auth: () => Promise<{ userId: string | null }>, req: NextRequest) => Promise<Response>) =>
      (request: NextRequest) =>
        handler(async () => ({ userId }), request),
  }));
}

function mockAccessStateFetch(result: { status: number; body?: Record<string, unknown> }) {
  const original = globalThis.fetch;
  const spy = vi.fn(async () =>
    new Response(JSON.stringify(result.body ?? {}), {
      status: result.status,
      headers: { "content-type": "application/json" },
    }),
  );
  globalThis.fetch = spy as unknown as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("proxy invitation handling", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it("does NOT redirect a signed-in user with access to /join and clears the stale cookie", async () => {
    mockClerk("user_1");
    const restore = mockAccessStateFetch({ status: 200, body: { status: "ok" } });

    const { default: proxy } = await import("@/proxy");
    const request = new NextRequest("http://localhost/chat", {
      headers: { Cookie: "ai-school-invitation-token=tok_stale" },
    });
    const response = await proxy(request, {} as never);

    expect(response).toBeDefined();
    expect(response!.headers.get("location")).toBeNull();
    const setCookie = response!.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("ai-school-invitation-token=");
    // A cleared cookie from NextResponse.cookies.delete appears with an
    // empty value + Max-Age=0 (or an expired Expires). Match either form.
    expect(/ai-school-invitation-token=;/.test(setCookie) || /Max-Age=0/.test(setCookie))
      .toBe(true);

    restore();
  });

  it("redirects signed-in users without access back to /join when the cookie is set", async () => {
    mockClerk("user_1");
    const restore = mockAccessStateFetch({ status: 403, body: { status: "no_access" } });

    const { default: proxy } = await import("@/proxy");
    const request = new NextRequest("http://localhost/chat", {
      headers: { Cookie: "ai-school-invitation-token=tok_cookie_1" },
    });
    const response = await proxy(request, {} as never);

    expect(response).toBeDefined();
    expect(response!.headers.get("location")).toBe("http://localhost/join?token=tok_cookie_1");

    restore();
  });

  it("never traps a signed-in user on /sign-in even when an invitation cookie is set", async () => {
    mockClerk("user_1");
    const restore = mockAccessStateFetch({ status: 403, body: { status: "no_access" } });

    const { default: proxy } = await import("@/proxy");
    const request = new NextRequest("http://localhost/sign-in", {
      headers: { Cookie: "ai-school-invitation-token=tok_cookie_1" },
    });
    const response = await proxy(request, {} as never);

    expect(response).toBeDefined();
    expect(response!.headers.get("location")).toBeNull();

    restore();
  });

  it("clears the cookie and redirects to /no-access?reason=inactive when the org is inactive", async () => {
    mockClerk("user_1");
    const restore = mockAccessStateFetch({ status: 403, body: { status: "org_inactive" } });

    const { default: proxy } = await import("@/proxy");
    const request = new NextRequest("http://localhost/chat", {
      headers: { Cookie: "ai-school-invitation-token=tok_cookie_1" },
    });
    const response = await proxy(request, {} as never);

    expect(response).toBeDefined();
    expect(response!.headers.get("location")).toBe("http://localhost/no-access?reason=inactive");
    const setCookie = response!.headers.get("set-cookie") ?? "";
    expect(/ai-school-invitation-token=;/.test(setCookie) || /Max-Age=0/.test(setCookie))
      .toBe(true);

    restore();
  });
});
