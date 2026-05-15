import { describe, expect, it } from "vitest";
import { isUsableResourceForLimit, resourceRuntimeStatus } from "../../../convex/resources";
import {
  isRuntimeUsableAttachment,
  normalizeRuntimeResourceStatus,
  normalizeAttachments,
} from "../attachments/normalizer";
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

  it("normalizes runtime attachment statuses separately from ingestion statuses", () => {
    expect(normalizeRuntimeResourceStatus({ status: "processed", storageId: "storage_1" })).toBe("indexed");
    expect(normalizeRuntimeResourceStatus({ status: "processing", storageId: "storage_1" })).toBe("processing");
    expect(normalizeRuntimeResourceStatus({ status: "failed", storageId: "storage_1" })).toBe("failed_processing");
    expect(normalizeRuntimeResourceStatus({ status: "processed" })).toBe("storage_missing");
  });

  it("keeps only runtime-usable attachments for model context", () => {
    expect(
      isRuntimeUsableAttachment({
        filename: "diagram.png",
        mimeType: "image/png",
        status: "processing",
        storageId: "storage_1",
      }),
    ).toBe(true);
    expect(
      isRuntimeUsableAttachment({
        filename: "notes.pdf",
        mimeType: "application/pdf",
        status: "processing",
        storageId: "storage_1",
      }),
    ).toBe(false);
    expect(
      isRuntimeUsableAttachment({
        filename: "notes.pdf",
        mimeType: "application/pdf",
        status: "processed",
      }),
    ).toBe(false);
    expect(
      isRuntimeUsableAttachment({
        filename: "diagram.png",
        mimeType: "image/png",
        status: "failed",
        storageId: "storage_1",
      }),
    ).toBe(false);
  });

  it("excludes failed and chat-only resources from usable limit counts", () => {
    expect(isUsableResourceForLimit({ status: "processed", storageId: "storage_1" })).toBe(true);
    expect(isUsableResourceForLimit({ status: "processing", storageId: "storage_1" })).toBe(true);
    expect(isUsableResourceForLimit({ status: "uploaded", storageId: "storage_1" })).toBe(true);
    expect(isUsableResourceForLimit({ status: "processed" })).toBe(false);
    expect(isUsableResourceForLimit({ status: "failed", storageId: "storage_1" })).toBe(false);
    expect(isUsableResourceForLimit({ status: "processed", storageId: "storage_1", saveToLibrary: false })).toBe(false);
  });

  it("returns runtime status fields for saved, failed, and missing-storage resources", () => {
    expect(resourceRuntimeStatus({ status: "processed", storageId: "storage_1" })).toBe("indexed");
    expect(resourceRuntimeStatus({ status: "failed", storageId: "storage_1" })).toBe("failed_processing");
    expect(resourceRuntimeStatus({ status: "processed" })).toBe("storage_missing");
    expect(resourceRuntimeStatus({ status: "uploaded", storageId: "storage_1" })).toBe("uploaded");
  });

  it("drops failed and missing-storage resources during attachment normalization", async () => {
    const resources = [
      {
        _id: "ready_pdf",
        filename: "ready.pdf",
        mimeType: "application/pdf",
        size: 100,
        scope: "personal" as const,
        status: "processed" as const,
        storageId: "storage_ready",
        quickExtractText: "Ready notes",
      },
      {
        _id: "failed_png",
        filename: "failed.png",
        mimeType: "image/png",
        size: 100,
        scope: "personal" as const,
        status: "failed" as const,
        storageId: "storage_failed",
      },
      {
        _id: "missing_pdf",
        filename: "missing.pdf",
        mimeType: "application/pdf",
        size: 100,
        scope: "personal" as const,
        status: "processed" as const,
      },
    ];

    const normalized = await normalizeAttachments({
      actorClerkId: "actor_1",
      resourceIds: resources.map((resource) => resource._id),
      convexQuery: async <T,>(name: string): Promise<T> => {
        expect(name).toBe("resources:getResourcesByIds");
        return resources as T;
      },
    });

    expect(normalized.prepared.map((attachment) => attachment.resourceId)).toEqual(["ready_pdf"]);
    expect(normalized.quickExtractBlock).toContain("Ready notes");
    expect(normalized.quickExtractBlock).not.toContain("failed.png");
    expect(normalized.quickExtractBlock).not.toContain("missing.pdf");
  });
});
