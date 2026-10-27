import { NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  PUBLIC_SERVER_FAILURE,
  withRouteErrorHandling,
} from "@/lib/route-handler";
import * as logging from "@/lib/logging";

describe("withRouteErrorHandling", () => {
  it.each([
    ["CALENDAR_WORK_BLOCK_NOT_FOUND: This work block is no longer on Calendar.", 404],
    ["CALENDAR_TASK_UNAVAILABLE: This task is no longer active.", 409],
    ["CALENDAR_TASK_PLAN_MISMATCH: This plan belongs to a different task.", 409],
    ["CALENDAR_SOURCE_LOCKED: Official school records cannot be removed here.", 409],
    ["QUIZ_PRACTICE_NOT_PUBLISHED: This quiz is still publishing. Try again in a moment.", 409],
  ])("answers a coded, worded domain refusal %s as a client error", async (message, status) => {
    const response = await withRouteErrorHandling(async () => {
      throw new Error(message);
    });
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    expect(response.status).toBe(status);
    expect(payload.error?.message).toBe(message.split(": ")[1]);
  });

  it("keeps a bare code without a sentence on the generic server failure", async () => {
    const response = await withRouteErrorHandling(async () => {
      throw new Error("PAYLOAD_HASH_MISMATCH");
    });
    const payload = (await response.json()) as { error?: { message?: string } };
    expect(response.status).toBe(500);
    expect(payload.error?.message).toBe(PUBLIC_SERVER_FAILURE);
  });

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

  it("never puts Unexpected server error on a 500 user message", async () => {
    const response = await withRouteErrorHandling(async () => {
      throw new Error("CONVEX_UNREACHABLE: fetch failed");
    });
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; status?: number };
    };

    expect(response.status).toBe(500);
    expect(payload.error?.message).toBe(PUBLIC_SERVER_FAILURE);
    expect(payload.error?.message).not.toMatch(/Unexpected server error/i);
    expect(payload.error?.message).not.toMatch(/CONVEX_UNREACHABLE/);
  });

  it("maps AUTH_NO_SCHOOL to 403 instead of a connection failure", async () => {
    const response = await withRouteErrorHandling(async () => {
      throw new Error(
        "AUTH_NO_SCHOOL: This account does not have an active school membership.",
      );
    });
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; status?: number };
    };

    expect(response.status).toBe(403);
    expect(payload.error).toEqual(
      expect.objectContaining({
        code: "AUTH_NO_SCHOOL",
        status: 403,
      }),
    );
    expect(payload.error?.message).not.toBe(PUBLIC_SERVER_FAILURE);
  });

  it("maps INTEGRATION_NOT_READY to 409 instead of a connection failure", async () => {
    const response = await withRouteErrorHandling(async () => {
      throw new Error(
        "INTEGRATION_NOT_READY: ManageBac must be connected with verified readable capabilities.",
      );
    });
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; status?: number };
    };

    expect(response.status).toBe(409);
    expect(payload.error).toEqual(
      expect.objectContaining({
        code: "INTEGRATION_NOT_READY",
        status: 409,
        message:
          "ManageBac must be connected with verified readable capabilities.",
      }),
    );
    expect(payload.error?.message).not.toBe(PUBLIC_SERVER_FAILURE);
  });

  it("maps fenced and busy integration work to recoverable 409 responses", async () => {
    for (const code of [
      "INTEGRATION_SYNC_BUSY",
      "INTEGRATION_SYNC_FENCED",
      "INTEGRATION_SELECTION_CHANGED",
    ]) {
      const response = await withRouteErrorHandling(async () => {
        throw new Error(`${code}: Retry with the current integration state.`);
      });
      const payload = (await response.json()) as {
        error?: { code?: string; message?: string; status?: number };
      };

      expect(response.status).toBe(409);
      expect(payload.error).toEqual(
        expect.objectContaining({
          code,
          status: 409,
          message: "Retry with the current integration state.",
        }),
      );
    }
  });

  it("unwraps Convex Request ID stacks into the named AUTH code", async () => {
    const response = await withRouteErrorHandling(async () => {
      throw new Error(
        "[Request ID: 778f1cc9ed400c49] Server Error\nUncaught Error: AUTH_OPERATOR_MANAGE_REQUIRED: Re-enter this school with manage access.\n    at requireSchoolManager (../../../../../convex/memberships.ts:25:6)",
      );
    });
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string; status?: number };
    };
    expect(response.status).toBe(403);
    expect(payload.error).toEqual(
      expect.objectContaining({
        code: "AUTH_OPERATOR_MANAGE_REQUIRED",
        status: 403,
        message: "Re-enter this school with manage access.",
      }),
    );
    expect(payload.error?.message).not.toMatch(/Request ID|memberships\.ts|Uncaught/i);
  });
});
