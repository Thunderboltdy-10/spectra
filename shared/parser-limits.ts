import {
  crc32,
  ZipReader,
  ZipWriter,
  ZIP_METHOD_DEFLATE,
  ZIP_METHOD_STORE,
} from "@ariadng/office/zip";
import type { ZipRawEntry } from "@ariadng/office/zip";

/** Conservative limits for generic ZIP/package intake. */
export const MAX_ARCHIVE_ENTRIES = 2_000;
export const MAX_ARCHIVE_EXPANDED_BYTES = 40_000_000;
export const MAX_ARCHIVE_ENTRY_BYTES = 8_000_000;
export const MAX_ARCHIVE_INPUT_BYTES = 100_000_000;
export const MAX_ARCHIVE_WORK_BYTES = 140_000_000;

/** Larger profile for rich Office packages; unknown parts are preserved. */
export const OFFICE_ARCHIVE_LIMITS = {
  maxEntries: 5_000,
  maxExpandedBytes: 240_000_000,
  maxEntryBytes: 64_000_000,
  maxInputBytes: 100_000_000,
  maxWorkBytes: 340_000_000,
  maxCompressionRatio: 1_200,
} as const;

export const DEFAULT_ARCHIVE_LIMITS = {
  maxEntries: MAX_ARCHIVE_ENTRIES,
  maxExpandedBytes: MAX_ARCHIVE_EXPANDED_BYTES,
  maxEntryBytes: MAX_ARCHIVE_ENTRY_BYTES,
  maxInputBytes: MAX_ARCHIVE_INPUT_BYTES,
  maxWorkBytes: MAX_ARCHIVE_WORK_BYTES,
  maxCompressionRatio: 1_200,
} as const;

export const MAX_BASE64_DECODED_BYTES = 25_000_000;
export const MAX_PDF_INPUT_BYTES = 80_000_000;

export type ArchiveLimits = {
  maxEntries: number;
  maxExpandedBytes: number;
  maxEntryBytes: number;
  maxInputBytes: number;
  maxWorkBytes: number;
  maxCompressionRatio: number;
};

export type BoundedArchive = {
  entries: Record<string, Uint8Array>;
  /** Rewritten, validated bytes for downstream Office consumers. */
  bytes: Uint8Array;
  entryCount: number;
  expandedBytes: number;
  workBytes: number;
};

function parserError(code: string, detail?: unknown) {
  const message =
    detail instanceof Error
      ? detail.message
      : typeof detail === "object" && detail !== null && "message" in detail
        ? String((detail as { message: unknown }).message)
        : "";
  const suffix = message ? `: ${message}` : "";
  return new Error(`${code}${suffix}`);
}

/** Reject non-canonical spellings instead of normalizing them into collisions. */
export function canonicalArchivePath(name: string) {
  if (!name || name.includes("\u0000")) throw parserError("ARCHIVE_PATH_INVALID");
  if (name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name))
    throw parserError("ARCHIVE_PATH_INVALID");
  const directory = name.endsWith("/");
  const body = directory ? name.slice(0, -1) : name;
  const parts = body.split("/");
  if (!body || parts.some((part) => !part || part === "." || part === ".."))
    throw parserError("ARCHIVE_PATH_INVALID");
  const normalized = `${parts.join("/")}${directory ? "/" : ""}`;
  if (normalized !== name) throw parserError("ARCHIVE_PATH_INVALID");
  return normalized.normalize("NFC").toLocaleLowerCase("en-US");
}

function addWork(work: number, amount: number, limits: ArchiveLimits) {
  const next = work + amount;
  if (!Number.isSafeInteger(next) || next > limits.maxWorkBytes)
    throw parserError("ARCHIVE_WORK_LIMIT");
  return next;
}

async function inflateEntry(
  compressed: Uint8Array,
  entryName: string,
  declaredBytes: number,
  limits: ArchiveLimits,
  work: number,
) {
  const transform = new DecompressionStream("deflate-raw");
  const writer = transform.writable.getWriter();
  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  let outputBytes = 0;
  let currentWork = work;
  const allowed = Math.min(declaredBytes, limits.maxEntryBytes);
  const write = (async () => {
    await writer.write(compressed.slice());
    await writer.close();
  })();
  write.catch(() => undefined);

  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      outputBytes += chunk.byteLength;
      if (outputBytes > allowed)
        throw parserError("ARCHIVE_INFLATION_LIMIT", {
          message: `${entryName} produced ${outputBytes} bytes before its ${allowed}-byte limit`,
        });
      currentWork = addWork(currentWork, chunk.byteLength, limits);
      chunks.push(chunk);
    }
    await write;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await writer.abort(error).catch(() => undefined);
    throw error;
  }

  const output = new Uint8Array(outputBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (output.byteLength !== declaredBytes)
    throw parserError("ARCHIVE_SIZE_MISMATCH", {
      message: `${entryName} declared ${declaredBytes} bytes but produced ${output.byteLength}`,
    });
  return { output, work: currentWork };
}

function inflateOrCopyEntry(raw: ZipRawEntry, limits: ArchiveLimits, work: number) {
  if (raw.info.compressionMethod === ZIP_METHOD_STORE) {
    const output = raw.compressedData.slice();
    if (output.byteLength !== raw.info.uncompressedSize)
      throw parserError("ARCHIVE_SIZE_MISMATCH");
    if (output.byteLength > limits.maxEntryBytes)
      throw parserError("ARCHIVE_ENTRY_TOO_LARGE");
    return Promise.resolve({ output, work: addWork(work, output.byteLength, limits) });
  }
  if (raw.info.compressionMethod !== ZIP_METHOD_DEFLATE)
    throw parserError("ARCHIVE_COMPRESSION_UNSUPPORTED");
  return inflateEntry(raw.compressedData, raw.info.name, raw.info.uncompressedSize, limits, work);
}

/**
 * Read a ZIP/package without calling an unbounded `unzipSync`.
 * Central-directory checks happen before inflation. Each entry then streams
 * through a hard output limit and stops as soon as a limit is crossed.
 */
export async function readBoundedArchive(
  input: Uint8Array,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): Promise<BoundedArchive> {
  if (input.byteLength > limits.maxInputBytes)
    throw parserError("ARCHIVE_INPUT_TOO_LARGE");
  let reader: ZipReader;
  try {
    reader = await ZipReader.open(input, {
      maxCompressionRatio: limits.maxCompressionRatio,
      maxTotalUncompressedSize: limits.maxExpandedBytes,
    });
  } catch (error) {
    if (error instanceof Error && /^ARCHIVE_/.test(error.message)) throw error;
    throw parserError("ARCHIVE_INVALID", error);
  }

  const infos = reader.entries();
  if (infos.length > limits.maxEntries) throw parserError("ARCHIVE_ENTRY_LIMIT");
  const names = new Set<string>();
  let declaredExpanded = 0;
  let compressedBytes = 0;
  for (const info of infos) {
    const collision = canonicalArchivePath(info.name);
    if (names.has(collision)) throw parserError("ARCHIVE_NAME_COLLISION");
    names.add(collision);
    if (info.generalPurposeFlags & 1) throw parserError("ARCHIVE_ENCRYPTED");
    if (![ZIP_METHOD_STORE, ZIP_METHOD_DEFLATE].includes(info.compressionMethod))
      throw parserError("ARCHIVE_COMPRESSION_UNSUPPORTED");
    if (info.uncompressedSize > limits.maxEntryBytes)
      throw parserError("ARCHIVE_ENTRY_TOO_LARGE");
    declaredExpanded += info.uncompressedSize;
    if (!Number.isSafeInteger(declaredExpanded) || declaredExpanded > limits.maxExpandedBytes)
      throw parserError("ARCHIVE_EXPANDED_TOO_LARGE");
    compressedBytes += info.compressedSize;
    if (!Number.isSafeInteger(compressedBytes) || compressedBytes > limits.maxWorkBytes)
      throw parserError("ARCHIVE_WORK_LIMIT");
  }

  const entries: Record<string, Uint8Array> = {};
  const writer = new ZipWriter();
  let expandedBytes = 0;
  let workBytes = compressedBytes;
  for (const info of infos) {
    try {
      const raw = await reader.readRaw(info.name);
      const inflated = await inflateOrCopyEntry(raw, limits, workBytes);
      workBytes = inflated.work;
      expandedBytes += inflated.output.byteLength;
      if (!Number.isSafeInteger(expandedBytes) || expandedBytes > limits.maxExpandedBytes)
        throw parserError("ARCHIVE_EXPANDED_TOO_LARGE");
      if (crc32(inflated.output) !== info.crc32)
        throw parserError("ARCHIVE_CRC_MISMATCH");
      entries[info.name] = inflated.output;
      // Re-emit bounded output instead of copying the original compressed
      // stream. Downstream Office readers must not get a second chance to
      // inflate an attacker-controlled stream without these limits.
      await writer.add(info.name, inflated.output);
    } catch (error) {
      if (error instanceof Error && /^ARCHIVE_/.test(error.message)) throw error;
      throw parserError("ARCHIVE_INVALID", error);
    }
  }

  try {
    return {
      entries,
      bytes: await writer.finish(),
      entryCount: infos.length,
      expandedBytes,
      workBytes,
    };
  } catch (error) {
    throw parserError("ARCHIVE_INVALID", error);
  }
}

export async function prepareBoundedArchiveBytes(
  input: Uint8Array,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
) {
  return (await readBoundedArchive(input, limits)).bytes;
}

export function bytesToArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Decode only after the encoded length proves the decoded byte budget fits. */
export function decodeBase64DataUrl(value: string, name: string, maxBytes = MAX_BASE64_DECODED_BYTES) {
  const match = value.match(/^data:[^;,]+;base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match?.[1]) throw new Error(`Invalid binary attachment: ${name}`);
  const compact = match[1].replace(/\s+/g, "");
  if (compact.length % 4 === 1 || !/^[a-z0-9+/]*={0,2}$/i.test(compact))
    throw new Error(`Invalid binary attachment: ${name}`);
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  const decodedEstimate = Math.max(0, (compact.length / 4) * 3 - padding);
  if (decodedEstimate > maxBytes)
    throw new Error(`Attachment exceeds decoded intake limit: ${name}`);
  const binary = atob(compact);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength > maxBytes)
    throw new Error(`Attachment exceeds decoded intake limit: ${name}`);
  return bytes;
}

export function enforceExpandedArchive(entries: Record<string, Uint8Array>) {
  const names = Object.keys(entries);
  if (names.length > MAX_ARCHIVE_ENTRIES) throw parserError("ARCHIVE_ENTRY_LIMIT");
  const collisions = new Set<string>();
  let total = 0;
  for (const name of names) {
    const collision = canonicalArchivePath(name);
    if (collisions.has(collision)) throw parserError("ARCHIVE_NAME_COLLISION");
    collisions.add(collision);
    const size = entries[name]?.byteLength ?? 0;
    if (size > MAX_ARCHIVE_ENTRY_BYTES) throw parserError("ARCHIVE_ENTRY_TOO_LARGE");
    total += size;
    if (total > MAX_ARCHIVE_EXPANDED_BYTES) throw parserError("ARCHIVE_EXPANDED_TOO_LARGE");
  }
  return { entryCount: names.length, expandedBytes: total };
}

export function enforcePdfInput(bytes: Uint8Array) {
  if (bytes.byteLength > MAX_PDF_INPUT_BYTES) throw new Error("PDF_INPUT_TOO_LARGE");
  return bytes;
}
