import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { asDeployedError } from "../src/test/convex-redaction";
import { readConvexError, toWordedConvexError } from "./convex-error.mjs";

describe("toWordedConvexError (the Convex function boundary)", () => {
  it("carries a worded Error as ConvexError data and keeps its message and stack", () => {
    const thrown = new Error("CALENDAR_GESTURE_CONFLICT: Re-resolve the block before moving it.");
    const converted = toWordedConvexError(thrown) as ConvexError<{ code: string; message: string }>;
    expect(converted).toBeInstanceOf(ConvexError);
    expect(converted.data).toEqual({
      code: "CALENDAR_GESTURE_CONFLICT",
      message: "CALENDAR_GESTURE_CONFLICT: Re-resolve the block before moving it.",
    });
    expect(converted.message).toBe(thrown.message);
    expect(converted.stack).toBe(thrown.stack);
  });

  it("gives a sentence without a code a null code", () => {
    const converted = toWordedConvexError(new Error("A name is required.")) as ConvexError<{ code: string | null; message: string }>;
    expect(converted.data).toEqual({ code: null, message: "A name is required." });
  });

  it("reads the words out of a nested call's Uncaught frame", () => {
    const converted = toWordedConvexError(
      new Error("Uncaught Error: INVITATION_INVALID: This invitation is unavailable.\n    at handler (x.ts:1:1)"),
    ) as ConvexError<{ code: string | null; message: string }>;
    expect(converted.data).toEqual({
      code: "INVITATION_INVALID",
      message: "INVITATION_INVALID: This invitation is unavailable.",
    });
  });

  it("passes ConvexErrors, runtime faults and non-errors through unchanged", () => {
    const convexError = new ConvexError({ code: "X", message: "X" });
    const fault = new TypeError("Cannot read properties of undefined");
    expect(toWordedConvexError(convexError)).toBe(convexError);
    expect(toWordedConvexError(fault)).toBe(fault);
    expect(toWordedConvexError("text")).toBe("text");
  });
});

describe("readConvexError (the one reader)", () => {
  const thrown = new Error("LIBRARY_TARGETS_REQUIRED: Select something first.");

  it.each(["http", "react"] as const)("reads a redacted %s failure from its data", (surface) => {
    const error = asDeployedError(toWordedConvexError(thrown), { surface, udf: "M(orgTree:move)" });
    expect(error.message).toContain("Server Error");
    expect(readConvexError(error)).toEqual({
      code: "LIBRARY_TARGETS_REQUIRED",
      message: "LIBRARY_TARGETS_REQUIRED: Select something first.",
    });
  });

  it("has no words for a redacted failure without data", () => {
    for (const surface of ["http", "react"] as const)
      expect(readConvexError(asDeployedError(thrown, { surface, udf: "M(orgTree:move)" }))).toEqual({
        code: null,
        message: "",
      });
  });

  it("reads the unredacted dev frame", () => {
    expect(
      readConvexError(
        new Error(
          "[CONVEX M(orgTree:move)] [Request ID: 5c2b] Server Error\nUncaught Error: AUTH_NO_SCHOOL: No school.\n    at handler\n  Called by client",
        ),
      ),
    ).toEqual({ code: "AUTH_NO_SCHOOL", message: "AUTH_NO_SCHOOL: No school." });
  });

  it("reads plain errors and strings as they are", () => {
    expect(readConvexError(new Error("permission denied"))).toEqual({
      code: null,
      message: "permission denied",
    });
    expect(readConvexError("PAYLOAD_HASH_MISMATCH")).toEqual({
      code: "PAYLOAD_HASH_MISMATCH",
      message: "PAYLOAD_HASH_MISMATCH",
    });
    expect(readConvexError(undefined)).toEqual({ code: null, message: "" });
  });
});

describe("the collaboration gateway's Convex calls", () => {
  it("rethrow a redacted failure with its words, so the gateway can branch on the code", async () => {
    const { createCollaborationGatewayBridgeClient } = await import(
      "../scripts/collaboration-gateway-bridge-client.mjs"
    );
    const overlap = new Error("COLLABORATION_NATIVE_OVERLAP: The native file changed this region.");
    const bridge = createCollaborationGatewayBridgeClient({
      convexUrl: "https://fixture.invalid",
      bridgeKey: "fixture-key".repeat(4),
      retryAttempts: 1,
      client: {
        action: async () => {
          throw asDeployedError(toWordedConvexError(overlap), {
            surface: "http",
            udf: "A(collaborationGatewayBridge:exchange)",
          });
        },
      } as never,
    });
    await expect(bridge("authorize", {})).rejects.toThrow(overlap.message);
  });
});
