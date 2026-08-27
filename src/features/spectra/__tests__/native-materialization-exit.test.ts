import { describe, expect, it } from "vitest";
import {
  nativeMaterializationStale,
  nativeMaterializationVerified,
} from "../bridge/native-materialization-exit";

describe("native materialization exit", () => {
  const pending = { state: "pending" as const, hash: "spectra-hash" };

  it("verifies only when local current bytes match the queued write", () => {
    expect(
      nativeMaterializationVerified(pending, {
        state: "current",
        contentHash: "spectra-hash",
      }),
    ).toBe(true);
    expect(
      nativeMaterializationVerified(pending, {
        state: "current",
        contentHash: "word-hash",
      }),
    ).toBe(false);
  });

  it("retires the in-flight write when Word saved newer bytes", () => {
    expect(
      nativeMaterializationStale(pending, {
        state: "ahead",
        contentHash: "word-hash",
      }),
    ).toBe(true);
    expect(
      nativeMaterializationStale(pending, {
        state: "current",
        contentHash: "word-hash",
      }),
    ).toBe(true);
    expect(
      nativeMaterializationStale(pending, {
        state: "current",
        contentHash: "spectra-hash",
      }),
    ).toBe(false);
  });
});
