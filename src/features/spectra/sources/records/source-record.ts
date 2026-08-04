import { createHash, randomUUID } from "node:crypto";

export type ProvenanceHandle = { provider: string; externalId?: string; fetchedAt: string; contentHash?: string };
export type SourceRecord = {
  id: string;
  canonicalUrl?: string;
  title: string;
  authors?: string[];
  publishedAt?: string;
  accessedAt: string;
  sourceType: "paper" | "book" | "web" | "dataset" | "school" | "uploaded_file" | "linked_work";
  authority: "primary" | "secondary" | "unknown";
  contentHash?: string;
  snapshotRef?: string;
  provenance: ProvenanceHandle;
  verified: true;
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

export function createVerifiedSource(input: Omit<SourceRecord, "id" | "verified" | "canonicalUrl" | "contentHash" | "provenance"> & { url?: string; content?: string; provider: string; externalId?: string }): SourceRecord {
  const canonicalUrl = input.url ? canonicalizeSourceUrl(input.url) : undefined;
  const hash = input.content ? contentHash(input.content) : undefined;
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
    ...(hash ? { contentHash: hash } : {}),
    provenance: { provider: input.provider, fetchedAt: input.accessedAt, ...(input.externalId ? { externalId: input.externalId } : {}), ...(hash ? { contentHash: hash } : {}) },
    verified: true,
  };
}

export function createEvidenceSpan(source: SourceRecord, excerpt: string, location: { page?: number; startOffset?: number; endOffset?: number } = {}): EvidenceSpan {
  if (!source.verified) throw new Error("EVIDENCE_SOURCE_UNVERIFIED");
  const bounded = excerpt.replace(/\u0000/g, "").trim().slice(0, 8_000);
  if (!bounded) throw new Error("EVIDENCE_EXCERPT_REQUIRED");
  return { id: `evidence:${randomUUID()}`, sourceId: source.id, excerptHash: contentHash(bounded), excerpt: bounded, ...location };
}

export type VerifiedCitation = { sourceId: string; evidenceIds: string[]; label?: string };

export function verifyCitation(citation: VerifiedCitation, sources: readonly SourceRecord[], evidence: readonly EvidenceSpan[]) {
  const source = sources.find((entry) => entry.id === citation.sourceId && entry.verified);
  if (!source) throw new Error("CITATION_SOURCE_UNVERIFIED");
  if (!citation.evidenceIds.length) throw new Error("CITATION_EVIDENCE_REQUIRED");
  for (const id of citation.evidenceIds)
    if (!evidence.some((entry) => entry.id === id && entry.sourceId === source.id)) throw new Error("CITATION_EVIDENCE_MISMATCH");
  return citation;
}
