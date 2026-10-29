import { NextRequest, type NextFetchEvent } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/clerk-config", () => ({ hasClerkServerConfig: () => true }));
vi.mock("@clerk/nextjs/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/nextjs/server")>();
  return {
    ...actual,
    clerkMiddleware: (handler: (resolveAuth: typeof auth, request: NextRequest) => unknown) =>
      (request: NextRequest) => handler(auth, request),
  };
});

import proxy from "../proxy";

const request = (path: string) => proxy(
  new NextRequest(`https://spectra.test${path}`),
  {} as NextFetchEvent,
);

beforeEach(() => auth.mockResolvedValue({ userId: null }));

describe("signed-out route boundaries", () => {
  it("lets a future member read invitation instructions without an account", async () => {
    const response = await request("/request-access");
    expect(response?.headers.get("x-middleware-next")).toBe("1");
    expect(auth).not.toHaveBeenCalled();
  });

  it("still sends a protected admin destination through sign-in", async () => {
    const response = await request("/admin?section=people");
    const destination = new URL(response!.headers.get("location")!);
    expect(destination.pathname).toBe("/sign-in");
    expect(destination.searchParams.get("redirect_url")).toBe("/admin?section=people");
  });

  it("keeps unauthenticated API requests unauthorized", async () => {
    const response = await request("/api/spectra");
    expect(response?.status).toBe(401);
    expect(await response?.json()).toMatchObject({ error: { code: "AUTH_NOT_SIGNED_IN" } });
  });
});
