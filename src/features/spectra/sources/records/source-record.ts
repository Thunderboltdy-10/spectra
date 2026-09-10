import { createHash, randomUUID } from "node:crypto";

export type ProvenanceHandle = { provider: string; externalId?: string; fetchedAt: string; requestedUrl?: string; finalUrl?: string; contentHash?: string };
export type SourceRecord = {
  id: string;
  canonicalUrl?: string;
  /** The URL requested before redirects, when a fetched source has one. */
  requestedUrl?: string;
  /** The URL which supplied the stored representation after redirects. */
  finalUrl?: string;
  title: string;
  authors?: string[];
  publishedAt?: string;
  accessedAt: string;
  sourceType: "paper" | "book" | "web" | "dataset" | "school" | "uploaded_file" | "linked_work";
  authority: "primary" | "secondary" | "unknown";
  contentHash?: string;
  snapshotRef?: string;
  provenance: ProvenanceHandle;
  verified: boolean;
};
export type EvidenceSpan = {
  id: string;
  sourceId: string;
  page?: number;
  startOffset?: number;
  endOffset?: number;
  excerptHash: string;
  excerpt: string;
};

export function canonicalizeSourceUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("SOURCE_URL_PROTOCOL_UNSUPPORTED");
  if (url.username || url.password) throw new Error("SOURCE_URL_CREDENTIALS_UNSUPPORTED");
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (/^(?:utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  return url.toString();
}

export function contentHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

type SourceRecordInput = Omit<SourceRecord, "id" | "verified" | "canonicalUrl" | "contentHash" | "provenance"> & {
  url?: string;
  content?: string;
  provider: string;
  externalId?: string;
};

export function createVerifiedSource(input: SourceRecordInput): SourceRecord {
  const finalUrlValue = input.finalUrl ?? input.url;
  const canonicalUrl = finalUrlValue ? canonicalizeSourceUrl(finalUrlValue) : undefined;
  const requestedUrl = input.requestedUrl ? canonicalizeSourceUrl(input.requestedUrl) : undefined;
  const finalUrl = input.finalUrl ? canonicalUrl : undefined;
  const hash = input.content !== undefined ? contentHash(input.content) : undefined;
  return {
    id: `source:${randomUUID()}`,
    title: input.title.trim().slice(0, 500),
    accessedAt: input.accessedAt,
    sourceType: input.sourceType,
    authority: input.authority,
    ...(input.authors ? { authors: input.authors } : {}),
    ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
    ...(input.snapshotRef ? { snapshotRef: input.snapshotRef } : {}),
    ...(canonicalUrl ? { canonicalUrl } : {}),
    ...(requestedUrl ? { requestedUrl } : {}),
    ...(finalUrl ? { finalUrl } : {}),
    ...(hash !== undefined ? { contentHash: hash } : {}),
    provenance: {
      provider: input.provider,
      fetchedAt: input.accessedAt,
      ...(input.externalId ? { externalId: input.externalId } : {}),
      ...(requestedUrl ? { requestedUrl } : {}),
      ...(finalUrl ? { finalUrl } : {}),
      ...(hash !== undefined ? { contentHash: hash } : {}),
    },
    verified: true,
  };
}

export function createUnverifiedSource(input: SourceRecordInput): SourceRecord {
  return { ...createVerifiedSource(input), verified: false };
}

export type EvidenceLocation = { page?: number; startOffset?: number; endOffset?: number };

function checkedRange(location: EvidenceLocation, excerptLength: number) {
  const hasStart = location.startOffset !== undefined;
  const hasEnd = location.endOffset !== undefined;
  if (hasStart !== hasEnd) throw new Error("EVIDENCE_RANGE_REQUIRED");
  if (!hasStart) return undefined;
  const startOffset = location.startOffset!;
  const endOffset = location.endOffset!;
  if (!Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset) || startOffset < 0 || endOffset <= startOffset || endOffset - startOffset !== excerptLength) {
    throw new Error("EVIDENCE_RANGE_MISMATCH");
  }
  return { startOffset, endOffset };
}

export function createEvidenceSpan(source: SourceRecord, excerpt: string, location: EvidenceLocation = {}): EvidenceSpan {
  const clean = excerpt.replace(/\u0000/g, "");
  const hasRange = location.startOffset !== undefined || location.endOffset !== undefined;
  const originalRange = hasRange ? checkedRange(location, clean.length) : undefined;
  const bounded = (hasRange ? clean : clean.trim()).slice(0, 8_000);
  if (!bounded) throw new Error("EVIDENCE_EXCERPT_REQUIRED");
  const range = originalRange ? { startOffset: originalRange.startOffset, endOffset: originalRange.startOffset + bounded.length } : undefined;
  return {
    id: `evidence:${randomUUID()}`,
    sourceId: source.id,
    excerptHash: contentHash(bounded),
    excerpt: bounded,
    ...(location.page !== undefined ? { page: location.page } : {}),
    ...(range ?? {}),
  };
}

/** Create a span from the exact normalized content range used by a source. */
export function createEvidenceSpanAt(source: SourceRecord, content: string, startOffset: number, endOffset: number, page?: number) {
  if (!Number.isSafeInteger(startOffset) || !Number.isSafeInteger(endOffset) || startOffset < 0 || endOffset <= startOffset || endOffset > content.length) {
    throw new Error("EVIDENCE_RANGE_MISMATCH");
  }
  const boundedEnd = Math.min(endOffset, startOffset + 8_000);
  return createEvidenceSpan(source, content.slice(startOffset, boundedEnd), {
    ...(page !== undefined ? { page } : {}),
    startOffset,
    endOffset: boundedEnd,
  });
}

export type VerifiedCitation = { sourceId: string; evidenceIds: string[]; label?: string };

export function verifyCitation(citation: VerifiedCitation, sources: readonly SourceRecord[], evidence: readonly EvidenceSpan[]) {
  const source = sources.find((entry) => entry.id === citation.sourceId && entry.verified);
  if (!source) throw new Error("CITATION_SOURCE_UNVERIFIED");
  if (!citation.evidenceIds.length) throw new Error("CITATION_EVIDENCE_REQUIRED");
  for (const id of citation.evidenceIds) {
    const span = evidence.find((entry) => entry.id === id && entry.sourceId === source.id);
    if (!span || contentHash(span.excerpt) !== span.excerptHash || (span.startOffset !== undefined && span.endOffset !== span.startOffset + span.excerpt.length)) throw new Error("CITATION_EVIDENCE_MISMATCH");
  }
  return citation;
}

