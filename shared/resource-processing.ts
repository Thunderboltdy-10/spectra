export type ResourceProcessingStatus = "uploaded" | "processing" | "processed" | "failed";

export const RESOURCE_QUEUE_STALE_MS = 12_000;
export const RESOURCE_PROCESSING_STALE_MS = 90_000;
export const MAX_RESOURCE_PROCESSING_ATTEMPTS = 3;

export function isResourceProcessingStale(params: {
  status: ResourceProcessingStatus;
  updatedAt?: number;
  now?: number;
}) {
  if (params.status !== "uploaded" && params.status !== "processing") return false;
  if (typeof params.updatedAt !== "number" || !Number.isFinite(params.updatedAt)) return true;
  const now = typeof params.now === "number" && Number.isFinite(params.now) ? params.now : Date.now();
  const staleMs = params.status === "uploaded" ? RESOURCE_QUEUE_STALE_MS : RESOURCE_PROCESSING_STALE_MS;
  return now - params.updatedAt > staleMs;
}

export function canReuseResourceUpload(params: {
  status: ResourceProcessingStatus;
  updatedAt?: number;
  now?: number;
}) {
  return params.status === "processed";
}

export function shouldRetryResourceProcessing(params: {
  status: ResourceProcessingStatus;
  updatedAt?: number;
  processingAttempts?: number;
  now?: number;
}) {
  if (params.status !== "uploaded" && params.status !== "processing") return false;
  if (!isResourceProcessingStale(params)) return false;
  return (params.processingAttempts ?? 0) < MAX_RESOURCE_PROCESSING_ATTEMPTS;
}

export function toClientFileStatus(
  status: "uploaded" | "processing" | "processed" | "failed" | "reused" | undefined,
): "pending" | "uploading" | "processing" | "ready" | "error" {
  if (status === "uploaded" || status === "processing") return "processing";
  if (status === "processed" || status === "reused") return "ready";
  if (status === "failed") return "error";
  return "pending";
}
