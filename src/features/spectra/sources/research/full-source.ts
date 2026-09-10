import { request as httpRequest } from "node:http";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import {
  canonicalizeSourceUrl,
  contentHash,
  createEvidenceSpan,
  createEvidenceSpanAt,
  createUnverifiedSource,
  createVerifiedSource,
  type EvidenceSpan,
  type SourceRecord,
} from "../records";
import type { ParallelSearchResult } from "./parallel-search";

export const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_SOURCE_TEXT_CHARS = 200_000;
export const MAX_PDF_PAGES = 24;
export const MAX_REDIRECTS = 5;
export const MAX_ADDRESS_ATTEMPTS = 3;
export const MAX_RESULTS = 12;
export const MAX_EVIDENCE_PER_SOURCE = 12;
export const MAX_TOTAL_EVIDENCE = 96;
export const SOURCE_DEADLINE_MS = 20_000;
export const SOURCE_EXTRACTION_VERSION = "spectra-source-extraction-v2";

const ACCEPT_HEADER = "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8";
const ACCEPT_ENCODING_HEADER = "identity";
const DEFAULT_CACHE_ENTRIES = 32;
const DEFAULT_CACHE_BYTES = 16 * 1024 * 1024;
const DEFAULT_CACHE_FRESHNESS_MS = 5 * 60 * 1000;

export type ResolvedSourceAddress = { address: string; family: 4 | 6 };
export type SourceLookup = (hostname: string, signal: AbortSignal) => Promise<readonly ResolvedSourceAddress[]>;

export type SourceRequest = {
  url: URL;
  /** The address came from the validated result set for this exact request. */
  address: string;
  family: 4 | 6;
  host: string;
  servername?: string;
  headers: Readonly<Record<string, string>>;
  signal: AbortSignal;
};

export type SourceResponse = {
  status: number;
  headers: Headers;
  body?: AsyncIterable<Uint8Array>;
  /** Release the response/socket, including redirect responses that are not read. */
  close?: () => void;
};

export type SourceTransport = { request: (request: SourceRequest) => Promise<SourceResponse> };

export type SourceCachePayload = {
  text: string;
  contentType: string;
  finalUrl: string;
  contentHash: string;
  partial: false;
  ranges: readonly SourceEvidenceRange[];
};

export type SourceEvidenceRange = {
  page?: number;
  startOffset: number;
  endOffset: number;
};

export type SourceCacheEntry = SourceCachePayload & {
  expiresAt: number;
  storedAt: number;
  etag?: string;
  lastModified?: string;
};

export type SourceFetchOptions = {
  transport?: SourceTransport;
  lookup?: SourceLookup;
  cache?: SourceCache | null;
  deadlineMs?: number;
  now?: () => number;
};

export class SourceDeadlineError extends Error {
  readonly code = "SOURCE_DEADLINE_EXCEEDED";

  constructor() {
    super("SOURCE_DEADLINE_EXCEEDED");
    this.name = "SourceDeadlineError";
  }
}

/** A bounded LRU cache of complete public-source representations. */
export class SourceCache {
  private readonly entries = new Map<string, SourceCacheEntry>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  readonly freshnessMs: number;
  private bytes = 0;

  constructor(options: { maxEntries?: number; maxBytes?: number; freshnessMs?: number } = {}) {
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? DEFAULT_CACHE_ENTRIES));
    this.maxBytes = Math.max(1, Math.floor(options.maxBytes ?? DEFAULT_CACHE_BYTES));
    this.freshnessMs = Math.max(0, Math.floor(options.freshnessMs ?? DEFAULT_CACHE_FRESHNESS_MS));
  }

  get(key: string): SourceCacheEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(key: string, payload: SourceCachePayload, metadata: { now: number; freshnessMs?: number; etag?: string; lastModified?: string }) {
    if (payload.partial || payload.contentHash !== contentHash(payload.text)) return false;
    const size = Buffer.byteLength(payload.text, "utf8");
    if (size > this.maxBytes) return false;
    const previous = this.entries.get(key);
    if (previous) this.bytes -= Buffer.byteLength(previous.text, "utf8");
    const entry: SourceCacheEntry = {
      ...payload,
      expiresAt: metadata.now + Math.max(0, metadata.freshnessMs ?? this.freshnessMs),
      storedAt: metadata.now,
      ...(metadata.etag ? { etag: metadata.etag } : {}),
      ...(metadata.lastModified ? { lastModified: metadata.lastModified } : {}),
    };
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.bytes += size;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      const removed = this.entries.get(oldest);
      this.entries.delete(oldest);
      if (removed) this.bytes -= Buffer.byteLength(removed.text, "utf8");
    }
    return true;
  }

  get size() {
    return this.entries.size;
  }
}

const defaultSourceCache = new SourceCache();

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw abortReason(signal);
}

async function awaitWithSignal<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      onAbort = () => reject(abortReason(signal));
      signal.addEventListener("abort", onAbort, { once: true });
      Promise.resolve(promise).then(resolve, reject);
    });
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function isMappedIpv4(address: string): string | undefined {
  const raw = address.toLowerCase().replace(/^\[|\]$/g, "").split("%", 1)[0]!;
  if (isIP(raw) !== 6) return undefined;
  const halves = raw.split("::");
  if (halves.length > 2) return undefined;
  const parse = (part: string) => {
    if (!part) return [];
    const pieces = part.split(":");
    const output: number[] = [];
    for (const piece of pieces) {
      if (piece.includes(".")) {
        const octets = piece.split(".").map(Number);
        if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return undefined;
        output.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(piece)) return undefined;
        output.push(parseInt(piece, 16));
      }
    }
    return output;
  };
  const left = parse(halves[0]!);
  const right = parse(halves[1] ?? "");
  if (!left || !right) return undefined;
  const groups = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill(0), ...right] : [...left];
  if (groups.length !== 8 || groups.slice(0, 5).some((value) => value !== 0) || groups[5] !== 0xffff) return undefined;
  return [groups[6]! >> 8, groups[6]! & 255, groups[7]! >> 8, groups[7]! & 255].join(".");
}

function isPrivateIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const first = octets[0]!;
  const second = octets[1]!;
  const third = octets[2]!;
  return first === 0 || first === 10 || first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 2 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0) || first >= 224 ||
    (first === 192 && second === 88 && third === 99);
}

function ipv6Bytes(address: string): number[] | undefined {
  const raw = address.toLowerCase().replace(/^\[|\]$/g, "").split("%", 1)[0]!;
  if (isIP(raw) !== 6) return undefined;
  const halves = raw.split("::");
  if (halves.length > 2) return undefined;
  const parse = (part: string) => {
    if (!part) return [];
    const values: number[] = [];
    for (const piece of part.split(":")) {
      if (piece.includes(".")) {
        const octets = piece.split(".").map(Number);
        if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return undefined;
        values.push(octets[0]!, octets[1]!, octets[2]!, octets[3]!);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(piece)) return undefined;
        const value = parseInt(piece, 16);
        values.push(value >> 8, value & 255);
      }
    }
    return values;
  };
  const left = parse(halves[0]!);
  const right = parse(halves[1] ?? "");
  if (!left || !right) return undefined;
  const bytes = halves.length === 2 ? [...left, ...Array(16 - left.length - right.length).fill(0), ...right] : [...left];
  return bytes.length === 16 ? bytes : undefined;
}

/** Reject private, special-use, malformed and IPv4-mapped private destinations. */
export function isPrivateAddress(address: string) {
  const raw = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (raw.includes("%")) return true;
  if (isIP(raw) === 4) return isPrivateIpv4(raw);
  const addressFamily = isIP(raw);
  if (addressFamily === 0) return false;
  const mapped = isMappedIpv4(raw);
  if (mapped) return isPrivateIpv4(mapped);
  const bytes = ipv6Bytes(raw);
  if (!bytes) return true;
  const first = bytes[0]!;
  const second = bytes[1]!;
  const isAllZero = bytes.every((value) => value === 0);
  const isLoopback = bytes.slice(0, 15).every((value) => value === 0) && bytes[15]! === 1;
  return isAllZero || isLoopback || (first & 0xfe) === 0xfc || (first === 0xfe && (second & 0xc0) === 0x80) || first === 0xff ||
    (first === 0x20 && second === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) ||
    (first === 0x20 && second === 0x01 && bytes[2] === 0x00 && (bytes[3] === 0x00 || bytes[3] === 0x02 || bytes[3] === 0x10));
}

export function validatePublicSourceUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("SOURCE_PROTOCOL_UNSUPPORTED");
  if (url.username || url.password) throw new Error("SOURCE_URL_CREDENTIALS_UNSUPPORTED");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || isPrivateAddress(hostname)) throw new Error("SOURCE_PRIVATE_NETWORK_BLOCKED");
  return url;
}

async function defaultLookup(hostname: string, signal: AbortSignal): Promise<readonly ResolvedSourceAddress[]> {
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) return [{ address: hostname, family: literalFamily }];
  const addresses = await awaitWithSignal(dnsLookup(hostname, { all: true, order: "verbatim" }), signal);
  return addresses.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }));
}

async function resolveValidatedAddresses(url: URL, signal: AbortSignal, resolver: SourceLookup) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await awaitWithSignal(Promise.resolve().then(() => resolver(hostname, signal)), signal);
  const validated: ResolvedSourceAddress[] = [];
  const seen = new Set<string>();
  for (const entry of addresses) {
    const family = isIP(entry.address);
    if ((family !== 4 && family !== 6) || family !== entry.family || isPrivateAddress(entry.address)) throw new Error("SOURCE_PRIVATE_NETWORK_BLOCKED");
    const key = `${family}:${entry.address.toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      validated.push({ address: entry.address, family });
    }
  }
  if (!validated.length) throw new Error("SOURCE_PRIVATE_NETWORK_BLOCKED");
  return validated;
}

function responseHeaders(input: Record<string, string | string[] | undefined>) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(input)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

function nodeTransportRequest(input: SourceRequest): Promise<SourceResponse> {
  const hostname = input.url.hostname.replace(/^\[|\]$/g, "");
  const lookup: LookupFunction = (lookupHostname, options, callback) => {
    if (lookupHostname.toLowerCase() !== hostname.toLowerCase()) {
      callback(new Error("SOURCE_LOOKUP_HOST_MISMATCH"), "", 0);
      return;
    }
    if (options.all) callback(null, [{ address: input.address, family: input.family }]);
    else callback(null, input.address, input.family);
  };
  const options = {
    protocol: input.url.protocol,
    hostname,
    port: input.url.port || undefined,
    path: `${input.url.pathname}${input.url.search}`,
    method: "GET",
    headers: input.headers,
    agent: false,
    lookup,
    signal: input.signal,
  };
  return new Promise<SourceResponse>((resolve, reject) => {
    let responseStarted = false;
    const onResponse = (response: import("node:http").IncomingMessage) => {
      responseStarted = true;
      resolve({
        status: response.statusCode ?? 0,
        headers: responseHeaders(response.headers),
        body: response,
        close: () => { if (!response.destroyed) response.destroy(); },
      });
    };
    const onError = (error: Error) => { if (!responseStarted) reject(error); };
    try {
      const request = input.url.protocol === "https:"
        ? httpsRequest({ ...options, servername: isIP(hostname) ? undefined : hostname }, onResponse)
        : httpRequest(options, onResponse);
      request.once("error", onError);
      request.end();
    } catch (error) {
      reject(error);
    }
  });
}

const defaultSourceTransport: SourceTransport = { request: nodeTransportRequest };

function closeResponse(response: SourceResponse) {
  response.close?.();
  const iterator = response.body?.[Symbol.asyncIterator]();
  if (iterator?.return) void iterator.return();
}

async function requestPinned(url: URL, addresses: readonly ResolvedSourceAddress[], signal: AbortSignal, transport: SourceTransport, headers: Readonly<Record<string, string>>) {
  let lastError: unknown;
  const attempts = Math.min(addresses.length, MAX_ADDRESS_ATTEMPTS);
  for (let index = 0; index < attempts; index += 1) {
    throwIfAborted(signal);
    const address = addresses[index]!;
    try {
      return await awaitWithSignal(transport.request({
        url,
        address: address.address,
        family: address.family,
        host: url.host,
        ...(url.protocol === "https:" && !isIP(url.hostname.replace(/^\[|\]$/g, "")) ? { servername: url.hostname.replace(/^\[|\]$/g, "") } : {}),
        headers,
        signal,
      }), signal);
    } catch (error) {
      if (signal.aborted) throw abortReason(signal);
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("SOURCE_CONNECTION_FAILED");
}

async function fetchPublic(url: URL, signal: AbortSignal, resolver: SourceLookup, transport: SourceTransport, validators?: { etag?: string; lastModified?: string }) {
  let current = url;
  let addresses = await resolveValidatedAddresses(current, signal, resolver);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const headers: Record<string, string> = {
      Accept: ACCEPT_HEADER,
      "Accept-Encoding": ACCEPT_ENCODING_HEADER,
      Host: current.host,
      Connection: "close",
    };
    if (redirect === 0) {
      if (validators?.etag) headers["If-None-Match"] = validators.etag;
      if (validators?.lastModified) headers["If-Modified-Since"] = validators.lastModified;
    }
    const response = await requestPinned(current, addresses, signal, transport, headers);
    if (response.status === 304 || response.status < 300 || response.status >= 400) return { response, url: current };
    const location = response.headers.get("location");
    closeResponse(response);
    if (!location) throw new Error("SOURCE_REDIRECT_INVALID");
    if (redirect === MAX_REDIRECTS) throw new Error("SOURCE_REDIRECT_LIMIT");
    current = validatePublicSourceUrl(new URL(location, current).toString());
    addresses = await resolveValidatedAddresses(current, signal, resolver);
  }
  throw new Error("SOURCE_REDIRECT_LIMIT");
}

async function readBoundedBody(response: SourceResponse, signal: AbortSignal) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) {
    response.close?.();
    throw new Error("SOURCE_TOO_LARGE");
  }
  if (!response.body) {
    response.close?.();
    return new Uint8Array();
  }
  const iterator = response.body[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let done = false;
  const close = () => response.close?.();
  const onAbort = () => close();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      const next = await awaitWithSignal(iterator.next(), signal);
      if (next.done) { done = true; break; }
      length += next.value.byteLength;
      if (length > MAX_SOURCE_BYTES) throw new Error("SOURCE_TOO_LARGE");
      chunks.push(next.value);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (!done && iterator.return) {
      const closing = iterator.return();
      if (!signal.aborted) await closing;
    }
    close();
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

async function decompressBounded(bytes: Uint8Array, encoding: string, signal: AbortSignal) {
  const normalized = encoding.trim().toLowerCase();
  if (!normalized || normalized === "identity") return bytes;
  if (normalized.includes(",")) throw new Error("SOURCE_CONTENT_ENCODING_UNSUPPORTED");
  const decompressor = normalized === "gzip" ? createGunzip() : normalized === "deflate" ? createInflate() : normalized === "br" ? createBrotliDecompress() : undefined;
  if (!decompressor) throw new Error("SOURCE_CONTENT_ENCODING_UNSUPPORTED");
  const input = Readable.from([bytes]);
  const output = input.pipe(decompressor);
  const iterator = output[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const onAbort = () => { input.destroy(); decompressor.destroy(); };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      const next = await awaitWithSignal(iterator.next(), signal);
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_SOURCE_BYTES) throw new Error("SOURCE_DECOMPRESSED_TOO_LARGE");
      chunks.push(next.value);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    input.destroy();
    decompressor.destroy();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function normalizeReadableText(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .replace(/\u0000/g, "")
    .trim();
}

function normalizePlainText(value: string) {
  return value.replace(/\s+/g, " ").replace(/\u0000/g, "").trim();
}

async function extractPdfText(bytes: Uint8Array, signal: AbortSignal) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const document = await awaitWithSignal(loadingTask.promise, signal);
  const ranges: SourceEvidenceRange[] = [];
  let text = "";
  let partial = document.numPages > MAX_PDF_PAGES;
  try {
    const pageLimit = Math.min(document.numPages, MAX_PDF_PAGES);
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      throwIfAborted(signal);
      const page = await awaitWithSignal(document.getPage(pageNumber), signal);
      const content = await awaitWithSignal(page.getTextContent(), signal);
      const pageText = normalizePlainText(content.items.flatMap((item) => "str" in item && typeof item.str === "string" ? [item.str] : []).join(" "));
      if (!pageText) continue;
      const prefix = text ? " " : "";
      const pageStart = text.length + prefix.length;
      const remaining = MAX_SOURCE_TEXT_CHARS - text.length;
      const addition = `${prefix}${pageText}`.slice(0, Math.max(0, remaining));
      text += addition;
      const pageEnd = text.length;
      if (pageEnd > pageStart) ranges.push({ page: pageNumber, startOffset: pageStart, endOffset: pageEnd });
      if (addition.length < prefix.length + pageText.length) {
        partial = true;
        break;
      }
    }
  } finally {
    const destroying = document.destroy();
    if (!signal.aborted) await awaitWithSignal(destroying, signal);
    else void destroying.catch(() => undefined);
  }
  return { text, ranges, partial };
}

function makeHtmlOrTextPayload(bytes: Uint8Array, contentType: string) {
  const decoded = new TextDecoder().decode(bytes);
  const normalized = contentType.includes("html") ? normalizeReadableText(decoded) : normalizePlainText(decoded);
  const partial = normalized.length > MAX_SOURCE_TEXT_CHARS;
  const text = normalized.slice(0, MAX_SOURCE_TEXT_CHARS);
  const ranges: SourceEvidenceRange[] = [];
  for (let offset = 0; offset < text.length && ranges.length < MAX_EVIDENCE_PER_SOURCE; offset += 4_000) {
    ranges.push({ startOffset: offset, endOffset: Math.min(text.length, offset + 4_000) });
  }
  return { text, ranges, partial };
}

function cacheKey(url: URL) {
  const canonical = canonicalizeSourceUrl(url.toString());
  return `${canonical}\u0000${SOURCE_EXTRACTION_VERSION}\u0000accept=${ACCEPT_HEADER}\u0000accept-encoding=${ACCEPT_ENCODING_HEADER}`;
}

function cacheFreshness(headers: Headers, fallbackMs: number) {
  const policy = headers.get("cache-control")?.toLowerCase() ?? "";
  if (/(?:^|,)\s*(?:no-store|private)\s*(?:,|$)/.test(policy)) return undefined;
  if (/(?:^|,)\s*no-cache\s*(?:,|$)/.test(policy)) return 0;
  const maxAge = policy.match(/(?:^|,)\s*max-age\s*=\s*(\d+)/)?.[1];
  if (maxAge !== undefined) return Number(maxAge) * 1_000;
  return fallbackMs;
}

function sourceFromPayload(result: ParallelSearchResult, requestedUrl: URL, finalUrl: string, payload: { text: string; ranges: readonly SourceEvidenceRange[]; partial: boolean }, accessedAt: string) {
  const input = {
    title: result.title,
    requestedUrl: requestedUrl.toString(),
    finalUrl,
    accessedAt,
    sourceType: "web" as const,
    authority: result.authority,
    provider: "parallel_openrouter",
    content: payload.text,
    ...(result.publishedAt ? { publishedAt: result.publishedAt } : {}),
  };
  return payload.partial ? createUnverifiedSource(input) : createVerifiedSource(input);
}

function evidenceForPayload(source: SourceRecord, payload: { text: string; ranges: readonly SourceEvidenceRange[] }) {
  return payload.ranges.slice(0, MAX_EVIDENCE_PER_SOURCE).flatMap((range) => {
    if (range.endOffset <= range.startOffset || range.endOffset > payload.text.length) return [];
    return [createEvidenceSpanAt(source, payload.text, range.startOffset, range.endOffset, range.page)];
  });
}

function fallbackBundle(result: ParallelSearchResult, now: number) {
  const accessedAt = new Date(now).toISOString();
  let source: SourceRecord;
  try {
    source = createUnverifiedSource({
      title: result.title,
      url: result.url,
      requestedUrl: result.url,
      accessedAt,
      sourceType: "web",
      authority: result.authority,
      provider: "parallel_openrouter",
      content: result.content,
      ...(result.publishedAt ? { publishedAt: result.publishedAt } : {}),
    });
  } catch {
    source = createUnverifiedSource({
      title: result.title,
      requestedUrl: result.url,
      accessedAt,
      sourceType: "web",
      authority: result.authority,
      provider: "parallel_openrouter",
      content: result.content,
      ...(result.publishedAt ? { publishedAt: result.publishedAt } : {}),
    });
  }
  return { source, evidence: result.content ? [createEvidenceSpan(source, result.content)] : [], text: result.content, partial: true as const };
}

function makeDeadlineContext(external: AbortSignal | undefined, deadlineMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new SourceDeadlineError());
  }, Math.max(1, deadlineMs));
  const onExternalAbort = () => controller.abort(abortReason(external!));
  if (external) {
    if (external.aborted) onExternalAbort();
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      if (external) external.removeEventListener("abort", onExternalAbort);
    },
  };
}

export async function fetchFullSource(result: ParallelSearchResult, signal?: AbortSignal, options: SourceFetchOptions = {}): Promise<{ source: SourceRecord; evidence: EvidenceSpan[]; text: string; partial: boolean }> {
  const context = makeDeadlineContext(signal, options.deadlineMs ?? SOURCE_DEADLINE_MS);
  const now = options.now ?? Date.now;
  const cache = options.cache === undefined ? defaultSourceCache : options.cache;
  try {
    throwIfAborted(context.signal);
    validatePublicSourceUrl(result.url);
    const requestedUrl = validatePublicSourceUrl(canonicalizeSourceUrl(result.url));
    const key = cacheKey(requestedUrl);
    const cached = cache?.get(key);
    const currentTime = now();
    if (cached && cached.expiresAt > currentTime) {
      const source = sourceFromPayload(result, requestedUrl, cached.finalUrl, cached, new Date(currentTime).toISOString());
      return { source, evidence: evidenceForPayload(source, cached), text: cached.text, partial: false };
    }
    const resolver = options.lookup ?? defaultLookup;
    const transport = options.transport ?? defaultSourceTransport;
    const fetched = await fetchPublic(requestedUrl, context.signal, resolver, transport, cached ? { etag: cached.etag, lastModified: cached.lastModified } : undefined);
    let payload: { text: string; ranges: readonly SourceEvidenceRange[]; partial: boolean; contentType: string; finalUrl: string };
    if (fetched.response.status === 304 && cached) {
      closeResponse(fetched.response);
      payload = { ...cached, contentType: cached.contentType, finalUrl: cached.finalUrl };
      const freshness = cacheFreshness(fetched.response.headers, cache?.freshnessMs ?? DEFAULT_CACHE_FRESHNESS_MS);
      if (cache && freshness !== undefined) cache.set(key, { ...payload, contentHash: cached.contentHash, partial: false }, { now: now(), freshnessMs: freshness, etag: fetched.response.headers.get("etag") ?? cached.etag, lastModified: fetched.response.headers.get("last-modified") ?? cached.lastModified });
    } else {
      if (fetched.response.status < 200 || fetched.response.status >= 300) {
        closeResponse(fetched.response);
        throw new Error(`SOURCE_FETCH_FAILED: ${fetched.response.status}`);
      }
      const rawBytes = await readBoundedBody(fetched.response, context.signal);
      const contentType = fetched.response.headers.get("content-type")?.toLowerCase() ?? "";
      const bytes = await decompressBounded(rawBytes, fetched.response.headers.get("content-encoding") ?? "", context.signal);
      const extracted = contentType.includes("pdf") || fetched.url.pathname.toLowerCase().endsWith(".pdf")
        ? await extractPdfText(bytes, context.signal)
        : makeHtmlOrTextPayload(bytes, contentType);
      payload = { ...extracted, contentType, finalUrl: fetched.url.toString() };
      const freshness = cacheFreshness(fetched.response.headers, cache?.freshnessMs ?? DEFAULT_CACHE_FRESHNESS_MS);
      if (cache && freshness !== undefined && !payload.partial) {
        throwIfAborted(context.signal);
        cache.set(key, { ...payload, contentHash: contentHash(payload.text), partial: false }, {
          now: now(),
          freshnessMs: freshness,
          ...(fetched.response.headers.get("etag") ? { etag: fetched.response.headers.get("etag")! } : {}),
          ...(fetched.response.headers.get("last-modified") ? { lastModified: fetched.response.headers.get("last-modified")! } : {}),
        });
      }
    }
    throwIfAborted(context.signal);
    const source = sourceFromPayload(result, requestedUrl, payload.finalUrl, payload, new Date(now()).toISOString());
    return { source, evidence: evidenceForPayload(source, payload), text: payload.text, partial: payload.partial };
  } catch (error) {
    if (signal?.aborted) throw abortReason(signal);
    if (context.didTimeout()) throw new SourceDeadlineError();
    throw error;
  } finally {
    context.dispose();
  }
}

function allocateEvidence(bundles: readonly Awaited<ReturnType<typeof fetchFullSource>>[]) {
  const output: EvidenceSpan[] = [];
  const indexes = bundles.map(() => 0);
  while (output.length < MAX_TOTAL_EVIDENCE) {
    let added = false;
    for (let index = 0; index < bundles.length && output.length < MAX_TOTAL_EVIDENCE; index += 1) {
      const bundle = bundles[index]!;
      if (indexes[index]! >= Math.min(bundle.evidence.length, MAX_EVIDENCE_PER_SOURCE)) continue;
      output.push(bundle.evidence[indexes[index]!]!);
      indexes[index]! += 1;
      added = true;
    }
    if (!added) break;
  }
  return output;
}

export async function buildResearchEvidence(results: ParallelSearchResult[], signal?: AbortSignal, options: SourceFetchOptions = {}) {
  const selected = results.slice(0, MAX_RESULTS);
  const bundles: Array<Awaited<ReturnType<typeof fetchFullSource>>> = [];
  const operation = makeDeadlineContext(signal, options.deadlineMs ?? SOURCE_DEADLINE_MS);
  let next = 0;
  const now = options.now ?? Date.now;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= selected.length) return;
      const result = selected[index]!;
      if (operation.signal.aborted) {
        if (signal?.aborted) throw abortReason(signal);
        bundles[index] = fallbackBundle(result, now());
        continue;
      }
      try {
        bundles[index] = await fetchFullSource(result, operation.signal, options);
      } catch (error) {
        if (signal?.aborted) throw abortReason(signal);
        if (operation.signal.aborted || error instanceof SourceDeadlineError || (error instanceof DOMException && error.name === "AbortError")) {
          bundles[index] = fallbackBundle(result, now());
          continue;
        }
        bundles[index] = fallbackBundle(result, now());
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(3, selected.length) }, () => worker()));
    if (signal?.aborted) throw abortReason(signal);
    for (let index = 0; index < selected.length; index += 1) if (!bundles[index]) bundles[index] = fallbackBundle(selected[index]!, now());
    return {
      sources: bundles.map((bundle) => bundle.source),
      evidence: allocateEvidence(bundles),
      partial: bundles.some((bundle) => bundle.partial),
    };
  } finally {
    operation.dispose();
  }
}

