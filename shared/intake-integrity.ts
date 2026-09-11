const HEX_SHA256 = /^[a-f0-9]{64}$/i;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function decodeBase64(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
  try {
    const binary = typeof atob === "function"
      ? atob(normalized)
      : (globalThis as { Buffer?: { from(value: string, encoding: string): Uint8Array } }).Buffer?.from(normalized, "base64");
    if (!binary) return null;
    const bytes = typeof binary === "string" ? Uint8Array.from(binary, (char) => char.charCodeAt(0)) : new Uint8Array(binary);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

export function normalizeSha256(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (HEX_SHA256.test(trimmed)) return trimmed.toLowerCase();
    const decoded = decodeBase64(trimmed);
    return decoded ? bytesToHex(decoded) : null;
  }
  if (value instanceof Uint8Array) return value.byteLength === 32 ? bytesToHex(value) : null;
  if (value instanceof ArrayBuffer) {
    const bytes = new Uint8Array(value);
    return bytes.byteLength === 32 ? bytesToHex(bytes) : null;
  }
  return null;
}

export function normalizeMediaType(value: string) {
  return value.trim().toLowerCase().split(";", 1)[0] ?? "";
}

export const SAFE_INTAKE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "video/mp4",
  "video/webm",
  "font/woff",
  "font/woff2",
  "font/ttf",
  "font/otf",
  "application/font-woff",
  "application/pdf",
  "application/json",
  "text/plain",
  "text/csv",
  "text/markdown",
  "text/tab-separated-values",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
] as const;

export function isSafeIntakeMediaType(value: string) {
  return (SAFE_INTAKE_MEDIA_TYPES as readonly string[]).includes(normalizeMediaType(value));
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[], offset = 0) {
  return prefix.every((value, index) => bytes[offset + index] === value);
}

function hasAscii(bytes: Uint8Array, value: string, offset = 0) {
  return new TextDecoder("ascii").decode(bytes.subarray(offset, offset + value.length)) === value;
}

function looksLikeZip(bytes: Uint8Array) {
  return hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]) || hasPrefix(bytes, [0x50, 0x4b, 0x05, 0x06]) || hasPrefix(bytes, [0x50, 0x4b, 0x07, 0x08]);
}

function looksLikeIsoBmff(bytes: Uint8Array, brands: readonly string[]) {
  if (!hasAscii(bytes, "ftyp", 4) || bytes.byteLength < 16) return false;
  const ascii = new TextDecoder("ascii").decode(bytes.subarray(8, Math.min(bytes.byteLength, 32)));
  return brands.some((brand) => ascii.includes(brand));
}

function looksLikeMpegAudio(bytes: Uint8Array) {
  if (hasAscii(bytes, "ID3")) return true;
  return bytes.byteLength >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
}

export function verifyContentSignature(mediaType: string, bytes: Uint8Array) {
  const normalized = normalizeMediaType(mediaType);
  const safeText = !bytes.includes(0) && bytes.byteLength > 0;
  const valid =
    (normalized === "image/png" && hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (normalized === "image/jpeg" && hasPrefix(bytes, [0xff, 0xd8, 0xff])) ||
    (normalized === "image/gif" && (hasAscii(bytes, "GIF87a") || hasAscii(bytes, "GIF89a"))) ||
    (normalized === "image/webp" && hasAscii(bytes, "RIFF") && hasAscii(bytes, "WEBP", 8)) ||
    (normalized === "image/avif" && hasAscii(bytes, "ftyp", 4) && ["avif", "avis"].includes(new TextDecoder("ascii").decode(bytes.subarray(8, 12)))) ||
    (normalized === "audio/mpeg" && looksLikeMpegAudio(bytes)) ||
    (normalized === "audio/ogg" && hasAscii(bytes, "OggS")) ||
    (normalized === "audio/wav" && hasAscii(bytes, "RIFF") && hasAscii(bytes, "WAVE", 8)) ||
    (normalized === "video/mp4" && looksLikeIsoBmff(bytes, ["isom", "iso2", "mp41", "mp42", "avc1", "mp4"])) ||
    (normalized === "video/webm" && hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3])) ||
    (["font/woff", "application/font-woff"].includes(normalized) && hasAscii(bytes, "wOFF")) ||
    (normalized === "font/woff2" && hasAscii(bytes, "wOF2")) ||
    (normalized === "font/ttf" && hasPrefix(bytes, [0x00, 0x01, 0x00, 0x00])) ||
    (normalized === "font/otf" && hasAscii(bytes, "OTTO")) ||
    (normalized === "application/pdf" && hasAscii(bytes, "%PDF-")) ||
    (["text/plain", "text/csv", "text/markdown", "text/tab-separated-values"].includes(normalized) && safeText) ||
    (normalized === "application/json" && safeText) ||
    ([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.oasis.opendocument.text",
      "application/vnd.oasis.opendocument.spreadsheet",
      "application/vnd.oasis.opendocument.presentation",
    ].includes(normalized) && looksLikeZip(bytes));
  if (!valid) throw new Error("INTAKE_CONTENT_SIGNATURE_INVALID");
}
