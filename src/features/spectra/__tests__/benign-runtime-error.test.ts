import { describe, expect, it } from "vitest";
import { isBenignRuntimeError } from "../embed/sandbox-protocol";

/* F13: a working graph showed "Preview stopped" for the browser's ResizeObserver notice. */
describe("a preview's harmless browser notices (F13)", () => {
  it("never stops a preview for a deferred resize", () => {
    expect(isBenignRuntimeError("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
    expect(isBenignRuntimeError("ResizeObserver loop limit exceeded")).toBe(true);
    expect(isBenignRuntimeError("TypeError: x is undefined")).toBe(false);
    expect(isBenignRuntimeError(undefined)).toBe(false);
  });
});
