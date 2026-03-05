import { internalAction, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { LIMITS, MODEL_DEFAULTS } from "./constants";

type ParsedPage = { page?: number; text: string };

const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 160;

function extension(filename: string) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
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

  if (ext === "txt" || ext === "md") {
    const text = new TextDecoder().decode(bytes);
    return { text, pages: [{ text }] };
  }

  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const extracted = await mammoth.extractRawText({ arrayBuffer: bytes });
    const text = extracted.value.replace(/\s+\n/g, "\n").trim();
    return { text, pages: text ? [{ text }] : [] };
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

  // Images are currently consumed at runtime via vision-capable models.
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp" || ext === "gif") {
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
