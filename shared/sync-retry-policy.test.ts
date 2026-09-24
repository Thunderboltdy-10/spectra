import { describe, expect, it } from "vitest";
import {
  SYNC_RETRY_POLICY,
  bridgeMountRepairRetryDelayMs,
  syncRetryAt,
  syncRetryDelayMs,
} from "./sync-retry-policy";

describe("shared sync retry policy", () => {
  it("is stable per operation while spreading different operations", () => {
    expect(syncRetryDelayMs(1, "work-a")).toBe(
      syncRetryDelayMs(1, "work-a"),
    );
    expect(syncRetryDelayMs(1, "work-a")).not.toBe(
      syncRetryDelayMs(1, "work-b"),
    );
  });

  it("backs off exponentially and stays within the shared ceiling", () => {
    const delays = Array.from({ length: 20 }, (_, index) =>
      syncRetryDelayMs(index + 1, "work-a"),
    );
    expect(delays[1]).toBeGreaterThan(delays[0]!);
    expect(delays[5]).toBeGreaterThan(delays[4]!);
    expect(Math.max(...delays)).toBeLessThanOrEqual(
      SYNC_RETRY_POLICY.maxDelayMs,
    );
    expect(syncRetryAt(10_000, 3, "work-a")).toBe(
      10_000 + syncRetryDelayMs(3, "work-a"),
    );
  });

  it("supports a lower ceiling for active run refreshes", () => {
    const delays = Array.from({ length: 20 }, (_, index) =>
      syncRetryDelayMs(
        index + 1,
        "active-run",
        SYNC_RETRY_POLICY.activeRunPollMaxDelayMs,
      ),
    );
    expect(delays[0]).toBeGreaterThanOrEqual(
      SYNC_RETRY_POLICY.initialDelayMs,
    );
    expect(Math.max(...delays)).toBeLessThanOrEqual(
      SYNC_RETRY_POLICY.activeRunPollMaxDelayMs,
    );
    const cappedRange =
      SYNC_RETRY_POLICY.activeRunPollMaxDelayMs *
      (1 - SYNC_RETRY_POLICY.jitterPercent / 100);
    expect(Math.min(...delays.slice(-5))).toBeGreaterThanOrEqual(
      cappedRange - 1,
    );
  });

  it("spaces durable mount repair scans and caps prolonged outages", () => {
    const first = bridgeMountRepairRetryDelayMs(1, "grant-safe");
    const second = bridgeMountRepairRetryDelayMs(2, "grant-safe");
    expect(first).toBeGreaterThanOrEqual(
      SYNC_RETRY_POLICY.bridgeMountRepairInitialDelayMs * 0.8,
    );
    expect(second).toBeGreaterThan(first);
    expect(bridgeMountRepairRetryDelayMs(100, "grant-safe")).toBeLessThanOrEqual(
      SYNC_RETRY_POLICY.bridgeMountRepairMaxDelayMs,
    );
    expect(bridgeMountRepairRetryDelayMs(1, "grant-safe")).toBe(first);
  });
});
