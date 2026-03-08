import { describe, expect, it } from "vitest";
import {
  MAX_RESOURCE_PROCESSING_ATTEMPTS,
  RESOURCE_QUEUE_STALE_MS,
  RESOURCE_PROCESSING_STALE_MS,
  canReuseResourceUpload,
  isResourceProcessingStale,
  shouldRetryResourceProcessing,
  toClientFileStatus,
} from "../../../shared/resource-processing";

describe("resource processing helpers", () => {
  it("treats old queued and processing resources as stale instead of reusable", () => {
    const now = Date.now();

    expect(
      isResourceProcessingStale({
        status: "uploaded",
        updatedAt: now - RESOURCE_QUEUE_STALE_MS - 1,
        now,
      }),
    ).toBe(true);
    expect(
      isResourceProcessingStale({
        status: "processing",
        updatedAt: now - RESOURCE_PROCESSING_STALE_MS - 1,
        now,
      }),
    ).toBe(true);

    expect(
      canReuseResourceUpload({
        status: "uploaded",
        updatedAt: now - RESOURCE_QUEUE_STALE_MS - 1,
        now,
      }),
    ).toBe(false);
    expect(
      canReuseResourceUpload({
        status: "processing",
        updatedAt: now - RESOURCE_PROCESSING_STALE_MS - 1,
        now,
      }),
    ).toBe(false);
  });

  it("reuses only fully processed resources", () => {
    expect(
      canReuseResourceUpload({
        status: "processed",
        updatedAt: Date.now(),
      }),
    ).toBe(true);
  });

  it("maps queued and processing results to a processing client state", () => {
    expect(toClientFileStatus("uploaded")).toBe("processing");
    expect(toClientFileStatus("processing")).toBe("processing");
    expect(toClientFileStatus("processed")).toBe("ready");
    expect(toClientFileStatus("reused")).toBe("ready");
    expect(toClientFileStatus("failed")).toBe("error");
  });

  it("retries only stale resources with attempts remaining", () => {
    const now = Date.now();

    expect(
      shouldRetryResourceProcessing({
        status: "uploaded",
        updatedAt: now - RESOURCE_QUEUE_STALE_MS - 1,
        processingAttempts: 0,
        now,
      }),
    ).toBe(true);

    expect(
      shouldRetryResourceProcessing({
        status: "processing",
        updatedAt: now - RESOURCE_PROCESSING_STALE_MS - 1,
        processingAttempts: MAX_RESOURCE_PROCESSING_ATTEMPTS,
        now,
      }),
    ).toBe(false);
  });
});
