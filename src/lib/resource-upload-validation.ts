import {
  BLOCKED_RESOURCE_EXTENSIONS,
  DEFAULT_MAX_RESOURCE_FILE_SIZE_BYTES,
  MAX_RESOURCE_FILE_SIZE_BYTES,
  MIN_RESOURCE_FILE_SIZE_BYTES,
  SUPPORTED_MIME_BY_EXTENSION,
  SUPPORTED_RESOURCE_EXTENSIONS,
  VIDEO_RESOURCE_EXTENSIONS,
  fileExtension,
} from "../../shared/resource-upload-policy";

export function resolveMaxResourceFileSizeBytes(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESOURCE_FILE_SIZE_BYTES;
  }
  return Math.min(
    MAX_RESOURCE_FILE_SIZE_BYTES,
    Math.max(MIN_RESOURCE_FILE_SIZE_BYTES, Math.round(value)),
  );
}

export function formatMegabytes(bytes: number) {
  const mb = Math.round((bytes / (1024 * 1024)) * 10) / 10;
  return `${mb}MB`;
}

export function validateResourceUploadFile(file: Pick<File, "name" | "type">) {
  const ext = fileExtension(file.name);
  const mime = file.type.trim().toLowerCase();

  if (BLOCKED_RESOURCE_EXTENSIONS.has(ext)) {
    return `Blocked file type: .${ext}. Upload documents, code, images, or audio only.`;
  }

  if (VIDEO_RESOURCE_EXTENSIONS.has(ext) || mime.startsWith("video/")) {
    return "Video uploads are not supported. Upload documents, code, images, or audio instead.";
  }

  if (!SUPPORTED_RESOURCE_EXTENSIONS.has(ext)) {
    return `Unsupported file type: .${ext || "unknown"}. Allowed: documents, code, images, and audio only.`;
  }

  if (!mime || mime === "application/octet-stream") {
    return null;
  }

  const allowed = SUPPORTED_MIME_BY_EXTENSION[ext] ?? [];
  if (!allowed.includes(mime)) {
    return `MIME type ${file.type} is not valid for .${ext}`;
  }

  return null;
}

export function normalizedResourceMimeType(file: Pick<File, "name" | "type">) {
  const ext = fileExtension(file.name);
  const mime = file.type.trim().toLowerCase();
  if (!mime || mime === "application/octet-stream") {
    return (SUPPORTED_MIME_BY_EXTENSION[ext] ?? ["application/octet-stream"])[0];
  }
  return mime;
}
