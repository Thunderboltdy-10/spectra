import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/env", () => ({
  getConvexUrl: () => "https://worded-errors.convex.cloud",
}));

import { convexPublicMutation } from "@/lib/convex-server";

/** A production deployment's answer to a failed mutation (HTTP 560). */
function failedMutation(errorData?: unknown) {
  return new Response(
    JSON.stringify({
      status: "error",
      errorMessage: "[Request ID: 8f2c0a61d9b34e57] Server Error",
      ...(errorData === undefined ? {} : { errorData }),
      logLines: [],
    }),
    { status: 560, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => vi.restoreAllMocks());

describe("server-side Convex calls under production redaction", () => {
  it("put the ConvexError's words back on error.message for route code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      failedMutation({
        code: "MATERIALIZATION_BASE_STALE",
        message: "MATERIALIZATION_BASE_STALE: The file changed since it was read.",
      }),
    );
    const error = (await convexPublicMutation("replicas:commit", {}).catch(
      (reason: unknown) => reason,
    )) as Error & { data?: { code?: string } };
    expect(error.message).toBe(
      "MATERIALIZATION_BASE_STALE: The file changed since it was read.",
    );
    expect(error.data?.code).toBe("MATERIALIZATION_BASE_STALE");
  });

  it("leave a failure with no words as Convex sent it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(failedMutation());
    await expect(convexPublicMutation("replicas:commit", {})).rejects.toThrow(
      "[Request ID: 8f2c0a61d9b34e57] Server Error",
    );
  });
});
