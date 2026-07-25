import { NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { withRouteErrorHandling } from "@/lib/route-handler";
import * as logging from "@/lib/logging";

describe("withRouteErrorHandling", () => {
  it("maps AUTH_ORG_INACTIVE errors to 403 responses", async () => {
    const response = await withRouteErrorHandling(async () => {
      throw new Error("AUTH_ORG_INACTIVE: School access is inactive.");
    });
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; status?: number };
    };

    expect(response.status).toBe(403);
    expect(payload.error).toEqual(expect.objectContaining({
      code: "AUTH_ORG_INACTIVE",
      message: "School access is inactive.",
      status: 403,
    }));
  });

  it("logs the actual status for intentional non-200 responses", async () => {
    const request = {
      method: "POST",
      nextUrl: {
        pathname: "/api/demo",
        searchParams: { get: () => null },
      },
    };
    const logSpy = vi.spyOn(logging, "logAPIResponse").mockImplementation(() => undefined);

    const response = await withRouteErrorHandling(
      async () => NextResponse.json({ ok: false }, { status: 409 }),
      request as never,
    );

    expect(response.status).toBe(409);
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 409 }));

    logSpy.mockRestore();
  });
});
