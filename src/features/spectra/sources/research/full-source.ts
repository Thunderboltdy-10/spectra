import { createEvidenceSpan, createVerifiedSource, type EvidenceSpan, type SourceRecord } from "../records";
import type { ParallelSearchResult } from "./parallel-search";

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;

function safePublicUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("SOURCE_PROTOCOL_UNSUPPORTED");
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    /^(?:0\.|10\.|127\.|169\.254\.|192\.168\.)/.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) ||
    /^(?:::1|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(host)
  ) throw new Error("SOURCE_PRIVATE_NETWORK_BLOCKED");
  return url;
}

async function fetchPublic(url: URL, signal?: AbortSignal) {
  let current = url;
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const response = await fetch(current, {
      signal,
      headers: { Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8" },
      redirect: "manual",
    });
    if (response.status < 300 || response.status >= 400) return { response, url: current };
    const location = response.headers.get("location");
    if (!location) throw new Error("SOURCE_REDIRECT_INVALID");
    current = safePublicUrl(new URL(location, current).toString());
  }
  throw new Error("SOURCE_REDIRECT_LIMIT");
}

async function readBoundedBody(response: Response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) throw new Error("SOURCE_TOO_LARGE");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > MAX_SOURCE_BYTES) {
      await reader.cancel("source byte limit reached");
      throw new Error("SOURCE_TOO_LARGE");
    }
    chunks.push(next.value);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

async function extractPdfText(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: bytes }).promise;
  const pages: Array<{ page: number; text: string; startOffset: number; endOffset: number }> = [];
  let text = "";
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages && text.length < 200_000; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.flatMap((item) => "str" in item && typeof item.str === "string" ? [item.str] : []).join(" ").replace(/\s+/g, " ").trim();
      if (!pageText) continue;
      const prefix = text ? "\n\n" : "";
      const startOffset = text.length + prefix.length;
      text = (text + prefix + pageText).slice(0, 200_000);
      pages.push({ page: pageNumber, text: text.slice(startOffset), startOffset, endOffset: text.length });
    }
  } finally {
    await document.destroy();
  }
  return { text, pages };
}

function readableText(value: string) {
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
    .trim();
}

export async function fetchFullSource(result: ParallelSearchResult, signal?: AbortSignal): Promise<{ source: SourceRecord; evidence: EvidenceSpan[]; text: string; partial: boolean }> {
  const requestedUrl = safePublicUrl(result.url);
  const { response, url } = await fetchPublic(requestedUrl, signal);
  if (!response.ok) throw new Error(`SOURCE_FETCH_FAILED: ${response.status}`);
  const type = response.headers.get("content-type") ?? "";
  const bytes = await readBoundedBody(response);
  const decoded = new TextDecoder().decode(bytes);
  const pdf = type.includes("pdf") || url.pathname.toLowerCase().endsWith(".pdf")
    ? await extractPdfText(bytes)
    : null;
  const text = (pdf?.text ?? (type.includes("html") ? readableText(decoded) : decoded)).replace(/\u0000/g, "").slice(0, 200_000);
  const accessedAt = new Date().toISOString();
  const source = createVerifiedSource({ title: result.title, url: url.toString(), accessedAt, sourceType: "web", authority: result.authority, provider: "parallel_openrouter", content: text, ...(result.publishedAt ? { publishedAt: result.publishedAt } : {}) });
  const evidence: EvidenceSpan[] = [];
  if (pdf) {
    for (const page of pdf.pages.slice(0, 24))
      evidence.push(createEvidenceSpan(source, page.text, { page: page.page, startOffset: page.startOffset, endOffset: page.endOffset }));
  } else {
    for (let offset = 0; offset < text.length && evidence.length < 24; offset += 4_000) {
      const excerpt = text.slice(offset, offset + 4_000).trim();
      if (excerpt) evidence.push(createEvidenceSpan(source, excerpt, { startOffset: offset, endOffset: offset + excerpt.length }));
    }
  }
  return { source, evidence, text, partial: decoded.length > text.length || bytes.byteLength === MAX_SOURCE_BYTES };
}

export async function buildResearchEvidence(results: ParallelSearchResult[], signal?: AbortSignal) {
  const bundles = [];
  for (const result of results.slice(0, 12)) {
    try { bundles.push(await fetchFullSource(result, signal)); }
    catch {
      const accessedAt = new Date().toISOString();
      const source = createVerifiedSource({ title: result.title, url: result.url, accessedAt, sourceType: "web", authority: result.authority, provider: "parallel_openrouter", content: result.content, ...(result.publishedAt ? { publishedAt: result.publishedAt } : {}) });
      bundles.push({ source, evidence: result.content ? [createEvidenceSpan(source, result.content)] : [], text: result.content, partial: true });
    }
  }
  return { sources: bundles.map((bundle) => bundle.source), evidence: bundles.flatMap((bundle) => bundle.evidence), partial: bundles.some((bundle) => bundle.partial) };
}
