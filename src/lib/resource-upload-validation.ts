export const DEFAULT_MAX_RESOURCE_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MIN_RESOURCE_FILE_SIZE_BYTES = 1 * 1024 * 1024;
const MAX_RESOURCE_FILE_SIZE_BYTES = 100 * 1024 * 1024;

const SUPPORTED_RESOURCE_EXTENSIONS = new Set(["pdf", "docx", "txt", "md"]);
const SUPPORTED_MIME_BY_EXTENSION: Record<string, string[]> = {
  pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  txt: ["text/plain"],
  md: ["text/markdown", "text/plain"],
};

function fileExtension(filename: string) {
  return filename.split(".").pop()?.trim().toLowerCase() ?? "";
}

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
  if (!SUPPORTED_RESOURCE_EXTENSIONS.has(ext)) {
    return `Unsupported file type: .${ext || "unknown"}. Allowed: .pdf, .docx, .txt, .md`;
  }

  const mime = file.type.trim().toLowerCase();
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
