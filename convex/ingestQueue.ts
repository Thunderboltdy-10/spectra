import { internalAction, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { LIMITS, MODEL_DEFAULTS } from "./constants";
import { TEXT_RESOURCE_EXTENSIONS, fileExtension } from "../shared/resource-upload-policy";

type ParsedPage = { page?: number; text: string };

const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 160;

function extension(filename: string) {
  return fileExtension(filename);
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function normalizeExtractedText(value: string) {
  return decodeXmlEntities(value)
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function stripXml(value: string) {
  return normalizeExtractedText(value.replace(/<[^>]+>/g, " "));
}

async function loadZipEntries(bytes: ArrayBuffer) {
  const JSZip = (await import("jszip")).default;
  return JSZip.loadAsync(bytes);
}

async function extractPptxPages(bytes: ArrayBuffer): Promise<ParsedPage[]> {
  const zip = await loadZipEntries(bytes);
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const pages = await Promise.all(
    slideNames.map(async (name, index) => {
      const xml = await zip.file(name)?.async("string");
      const text = normalizeExtractedText(
        [...(xml?.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g) ?? [])]
          .map((match) => match[1] ?? "")
          .join(" "),
      );
      return text ? { page: index + 1, text } : null;
    }),
  );

  return pages.filter(Boolean) as ParsedPage[];
}

async function extractXlsxPages(bytes: ArrayBuffer): Promise<ParsedPage[]> {
  const zip = await loadZipEntries(bytes);
  const sharedStringsXml = await zip.file("xl/sharedStrings.xml")?.async("string");
  const sharedStrings = [...(sharedStringsXml?.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [])].map((match) =>
    decodeXmlEntities(match[1] ?? ""),
  );

  const sheetNames = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const pages = await Promise.all(
    sheetNames.map(async (name, index) => {
      const xml = await zip.file(name)?.async("string");
      if (!xml) return null;

      const rows = [...xml.matchAll(/<c[^>]*?(?:t="([^"]+)")?[^>]*>([\s\S]*?)<\/c>/g)]
        .map((match) => {
          const type = match[1] ?? "";
          const cellBody = match[2] ?? "";
          const inline = cellBody.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
          if (inline) return decodeXmlEntities(inline);
          const rawValue = cellBody.match(/<v>([\s\S]*?)<\/v>/)?.[1]?.trim();
          if (!rawValue) return "";
          if (type === "s") {
            const idx = Number(rawValue);
            return Number.isFinite(idx) ? sharedStrings[idx] ?? rawValue : rawValue;
          }
          return rawValue;
        })
        .filter(Boolean)
        .join(" ");

      const text = normalizeExtractedText(rows);
      return text ? { page: index + 1, text } : null;
    }),
  );

  return pages.filter(Boolean) as ParsedPage[];
}

async function extractOdtPages(bytes: ArrayBuffer): Promise<ParsedPage[]> {
  const zip = await loadZipEntries(bytes);
  const xml = await zip.file("content.xml")?.async("string");
  const text = xml ? stripXml(xml) : "";
  return text ? [{ text }] : [];
}

function chunkTextWithPages(pages: ParsedPage[]) {
  const chunks: Array<{ text: string; page?: number }> = [];

  for (const page of pages) {
    const text = page.text.replace(/\s+/g, " ").trim();
    if (!text) continue;

    let cursor = 0;
    while (cursor < text.length) {
      const end = Math.min(cursor + CHUNK_SIZE, text.length);
      const chunk = text.slice(cursor, end).trim();
      if (chunk) {
        chunks.push({ text: chunk, page: page.page });
      }
      if (end === text.length) break;
      cursor = Math.max(0, end - CHUNK_OVERLAP);
    }
  }

  return chunks.slice(0, LIMITS.maxChunksPerFile);
}

async function parseFileBytes(filename: string, bytes: ArrayBuffer): Promise<{ text: string; pages: ParsedPage[] }> {
  const ext = extension(filename);

  if (TEXT_RESOURCE_EXTENSIONS.has(ext)) {
    const text = new TextDecoder().decode(bytes);
    const normalized = normalizeExtractedText(text);
    return { text: normalized, pages: normalized ? [{ text: normalized }] : [] };
  }

  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const extracted = await mammoth.extractRawText({ arrayBuffer: bytes });
    const text = normalizeExtractedText(extracted.value);
    return { text, pages: text ? [{ text }] : [] };
  }

  if (ext === "pptx") {
    const pages = await extractPptxPages(bytes);
    return { text: pages.map((page) => page.text).join("\n"), pages };
  }

  if (ext === "xlsx") {
    const pages = await extractXlsxPages(bytes);
    return { text: pages.map((page) => page.text).join("\n"), pages };
  }

  if (ext === "odt") {
    const pages = await extractOdtPages(bytes);
    return { text: pages.map((page) => page.text).join("\n"), pages };
  }

  if (ext === "pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useWorkerFetch: false,
      isEvalSupported: false,
      disableFontFace: true,
    });
    const document = await loadingTask.promise;
    const pages: ParsedPage[] = [];
    for (let pageIndex = 1; pageIndex <= document.numPages; pageIndex += 1) {
      const page = await document.getPage(pageIndex);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) {
        pages.push({ page: pageIndex, text });
      }
    }
    return { text: pages.map((page) => page.text).join("\n"), pages };
  }

  // Images and audio are consumed at runtime by multimodal/transcription-capable models.
  if (
    ext === "png" ||
    ext === "jpg" ||
    ext === "jpeg" ||
    ext === "webp" ||
    ext === "gif" ||
    ext === "svg" ||
    ext === "mp3" ||
    ext === "wav" ||
    ext === "m4a"
  ) {
    return { text: "", pages: [] };
  }

  throw new Error(`Unsupported file type: ${ext || "unknown"}`);
}

async function openRouterEmbedding(input: string) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY missing for ingestion");
  }

  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL_DEFAULTS.embedding,
      input,
    }),
  });

  if (!response.ok) {
    throw new Error(`Embedding request failed: ${await response.text()}`);
  }

  const json = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const vector = json.data?.[0]?.embedding;
  if (!vector) {
    throw new Error("Embedding response missing vector");
  }
  return vector;
}

export const getResourceForIngestion = internalQuery({
  args: {
    resourceId: v.id("resources"),
  },
  handler: async (ctx, args) => {
    const resource = await ctx.db.get(args.resourceId);
    if (!resource) return null;
    return {
      _id: resource._id,
      filename: resource.filename,
      mimeType: resource.mimeType,
      storageId: resource.storageId,
      status: resource.status,
    };
  },
});

export const processResource = internalAction({
  args: {
    resourceId: v.id("resources"),
  },
  handler: async (ctx, args) => {
    const resource = await ctx.runQuery(internal.ingestQueue.getResourceForIngestion, {
      resourceId: args.resourceId,
    });

    if (!resource) {
      return { ok: false, reason: "resource_missing" };
    }
    if (!resource.storageId) {
      await ctx.runMutation(internal.resources.completeResourceIngestionInternal, {
        resourceId: args.resourceId,
        parsedCharCount: 0,
        chunks: [],
        failedReason: "Resource file unavailable in storage",
      });
      return { ok: false, reason: "storage_missing" };
    }

    const blob = await ctx.storage.get(resource.storageId);
    if (!blob) {
      await ctx.runMutation(internal.resources.completeResourceIngestionInternal, {
        resourceId: args.resourceId,
        parsedCharCount: 0,
        chunks: [],
        failedReason: "Uploaded file blob not found",
      });
      return { ok: false, reason: "blob_missing" };
    }

    try {
      const bytes = await blob.arrayBuffer();
      const parsed = await parseFileBytes(resource.filename, bytes);
      const ext = extension(resource.filename);

      if (!parsed.text && (ext === "pdf" || ext === "docx")) {
        await ctx.runMutation(internal.resources.completeResourceIngestionInternal, {
          resourceId: args.resourceId,
          parsedCharCount: 0,
          chunks: [],
        });
        return { ok: true, chunkCount: 0, reason: `empty_text_${ext}` };
      }

      const chunks = chunkTextWithPages(parsed.pages);

      const embedded: Array<{ text: string; page?: number; embedding: number[] }> = [];
      for (const chunk of chunks) {
        const embedding = await openRouterEmbedding(chunk.text);
        embedded.push({
          text: chunk.text,
          page: chunk.page,
          embedding,
        });
      }

      await ctx.runMutation(internal.resources.completeResourceIngestionInternal, {
        resourceId: args.resourceId,
        parsedCharCount: parsed.text.length,
        chunks: embedded,
      });

      return {
        ok: true,
        chunkCount: embedded.length,
      };
    } catch (error) {
      await ctx.runMutation(internal.resources.completeResourceIngestionInternal, {
        resourceId: args.resourceId,
        parsedCharCount: 0,
        chunks: [],
        failedReason: error instanceof Error ? error.message.slice(0, 400) : "Background ingestion failed",
      });

      return {
        ok: false,
        reason: error instanceof Error ? error.message : "Background ingestion failed",
      };
    }
  },
});
