import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";
import { MODEL_DEFAULTS } from "./constants";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

type SoulDocRow = {
  _id: Id<"orgSoulDocs">;
  orgId: Id<"orgs">;
  title: string;
  section: string;
  content: string;
  version: number;
  updatedAt?: number;
  publishedAt?: number;
};

function chunkText(value: string, size = 750) {
  const text = value.replace(/\s+/g, " ").trim();
  const out: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const end = Math.min(text.length, cursor + size);
    out.push(text.slice(cursor, end));
    if (end === text.length) break;
    cursor = Math.max(0, end - 120);
  }
  return out;
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .slice(0, 24);
}

function buildLexicalGuidance(query: string, docs: SoulDocRow[], limit = 8) {
  const queryTokens = tokenize(query);
  const scored = docs.flatMap((doc) =>
    chunkText(doc.content, 420)
      .slice(0, 10)
      .map((piece, index) => {
        const haystack = `${doc.title} ${doc.section} ${piece}`.toLowerCase();
        const score = queryTokens.length === 0
          ? 1
          : queryTokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0) / queryTokens.length;
        return {
          score,
          index,
          piece,
          docTitle: doc.title,
        };
      }),
  );

  const selected = scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .filter((row) => row.score > 0)
    .slice(0, Math.min(10, Math.max(4, limit)));

  if (selected.length === 0) {
    return docs
      .flatMap((doc) => chunkText(doc.content, 420).slice(0, 1).map((piece) => ({ docTitle: doc.title, piece })))
      .slice(0, Math.min(10, Math.max(4, limit)))
      .map((row) => `- [${row.docTitle}] ${row.piece.slice(0, 220)}`);
  }

  return selected.map((row) => `- [${row.docTitle}] ${row.piece.slice(0, 220)}`);
}

function compactSoulLine(value: string, max = 220) {
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function buildSoulCapsule(docs: SoulDocRow[]) {
  const published = docs
    .filter((doc) => typeof doc.publishedAt === "number")
    .sort((a, b) => a.section.localeCompare(b.section) || a.title.localeCompare(b.title));
  const ordered = published.length > 0 ? published : docs.slice().sort((a, b) => a.section.localeCompare(b.section) || a.title.localeCompare(b.title));
  const lines = ordered
    .slice(0, 8)
    .map((doc) => `${doc.section}: ${compactSoulLine(doc.content)}`)
    .filter(Boolean);
  const latestVersion = Math.max(0, ...ordered.map((doc) => doc.version ?? 0));
  const latestPublishedAt = Math.max(0, ...ordered.map((doc) => doc.publishedAt ?? 0));
  return {
    version: ordered.length > 0 ? `soul-v${latestVersion}-${latestPublishedAt}-${ordered.length}` : "soul-empty",
    capsule: lines.join("\n"),
  };
}

function toFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

async function embeddingFor(text: string) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");

  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL_DEFAULTS.embedding,
      input: text,
    }),
  });
  if (!response.ok) {
    throw new Error(`Embedding failed: ${await response.text()}`);
  }

  const json = (await response.json()) as {
    model?: string;
    usage?: {
      prompt_tokens?: number | string;
      completion_tokens?: number | string;
      cost?: number | string;
    };
    data?: Array<{ embedding?: number[] }>;
  };
  const vector = json.data?.[0]?.embedding;
  if (!vector) throw new Error("Embedding missing");
  return {
    embedding: vector,
    model: json.model ?? MODEL_DEFAULTS.embedding,
    usage: json.usage
      ? {
          prompt_tokens: toFiniteNumber(json.usage.prompt_tokens),
          completion_tokens: toFiniteNumber(json.usage.completion_tokens),
          cost: toFiniteNumber(json.usage.cost),
        }
      : undefined,
  };
}

export const resolveActor = internalQuery({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.actorClerkId))
      .unique();
    if (!actor) throw new Error("Unauthorized");
    return {
      _id: actor._id,
      orgId: actor.orgId,
      role: actor.role,
    };
  },
});

export const listDocsForOrg = internalQuery({
  args: {
    orgId: v.id("orgs"),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("orgSoulDocs")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
  },
});

export const getChunksByIds = internalQuery({
  args: {
    ids: v.array(v.id("orgSoulChunks")),
  },
  handler: async (ctx, args) => {
    const docs: Array<{ _id: string; text: string }> = [];
    for (const id of args.ids) {
      const row = await ctx.db.get(id);
      if (!row) continue;
      docs.push({ _id: row._id, text: row.text });
    }
    return docs;
  },
});

export const replaceDocChunks = internalMutation({
  args: {
    docId: v.id("orgSoulDocs"),
    orgId: v.id("orgs"),
    chunks: v.array(v.object({ text: v.string(), embedding: v.array(v.float64()) })),
    publishedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.docId);
    if (!doc || doc.orgId !== args.orgId) {
      throw new Error("Soul document org mismatch");
    }

    const existing = await ctx.db
      .query("orgSoulChunks")
      .withIndex("by_doc", (q) => q.eq("docId", args.docId))
      .collect();
    for (const row of existing) {
      await ctx.db.delete(row._id);
    }

    for (const chunk of args.chunks) {
      await ctx.db.insert("orgSoulChunks", {
        orgId: args.orgId,
        docId: args.docId,
        text: chunk.text,
        embedding: chunk.embedding,
        createdAt: args.publishedAt,
      });
    }

    await ctx.db.patch(args.docId, {
      publishedAt: args.publishedAt,
      updatedAt: args.publishedAt,
    });

    return { ok: true };
  },
});

export const markDocsPublishedWithoutEmbeddings = internalMutation({
  args: {
    orgId: v.id("orgs"),
    docIds: v.array(v.id("orgSoulDocs")),
    publishedAt: v.number(),
  },
  handler: async (ctx, args) => {
    for (const docId of args.docIds) {
      const row = await ctx.db.get(docId);
      if (!row || row.orgId !== args.orgId) continue;
      await ctx.db.patch(docId, {
        publishedAt: args.publishedAt,
        updatedAt: args.publishedAt,
      });
    }
    return { ok: true };
  },
});

export const listSoulDocs = query({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor || (actor.role !== "teacher" && actor.role !== "admin")) {
      throw new Error("Unauthorized");
    }

    return ctx.db
      .query("orgSoulDocs")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();
  },
});

export const getSoulCapsule = query({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const docs = await ctx.db
      .query("orgSoulDocs")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();

    return buildSoulCapsule(docs as SoulDocRow[]);
  },
});

export const upsertSoulDoc = mutation({
  args: {
    actorClerkId: v.string(),
    title: v.string(),
    section: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor || (actor.role !== "teacher" && actor.role !== "admin")) {
      throw new Error("Unauthorized");
    }

    const existing = await ctx.db
      .query("orgSoulDocs")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();

    const match = existing.find(
      (doc) => doc.title.toLowerCase() === args.title.toLowerCase() && doc.section.toLowerCase() === args.section.toLowerCase(),
    );

    const now = Date.now();
    if (match) {
      await ctx.db.patch(match._id, {
        content: args.content,
        updatedAt: now,
      });
      return { docId: match._id, updated: true };
    }

    const version = Math.max(0, ...existing.map((doc) => doc.version ?? 0)) + 1;
    const docId = await ctx.db.insert("orgSoulDocs", {
      orgId: actor.orgId,
      title: args.title,
      section: args.section,
      content: args.content,
      version,
      publishedAt: undefined,
      updatedAt: now,
    });

    return { docId, updated: false };
  },
});

export const publishSoul: ReturnType<typeof action> = action({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.runQuery(internal.soul.resolveActor, {
      actorClerkId: args.actorClerkId,
    });

    if (actor.role !== "teacher" && actor.role !== "admin") {
      throw new Error("Unauthorized");
    }

    const docs = (await ctx.runQuery(internal.soul.listDocsForOrg, {
      orgId: actor.orgId,
    })) as SoulDocRow[];

    const now = Date.now();
    if (!process.env.OPENROUTER_API_KEY) {
      await ctx.runMutation(internal.soul.markDocsPublishedWithoutEmbeddings, {
        orgId: actor.orgId,
        docIds: docs.map((doc) => doc._id),
        publishedAt: now,
      });
      return { ok: true, chunkCount: 0, fallback: "lexical" };
    }

    let chunkCount = 0;
    const usageTotals = {
      promptTokens: 0,
      completionTokens: 0,
      cost: 0,
      hasUsage: false,
    };
    let embeddingModelUsed = MODEL_DEFAULTS.embedding;
    for (const doc of docs) {
      if (doc.orgId !== actor.orgId) {
        throw new Error("Unauthorized org scope");
      }
      const pieces = chunkText(doc.content).slice(0, 24);
      const embedded: Array<{ text: string; embedding: number[] }> = [];
      for (const piece of pieces) {
        try {
          const embeddingResult = await embeddingFor(piece);
          embedded.push({ text: piece, embedding: embeddingResult.embedding });
          embeddingModelUsed = embeddingResult.model ?? embeddingModelUsed;
          const usage = embeddingResult.usage;
          if (usage) {
            usageTotals.promptTokens += usage.prompt_tokens ?? 0;
            usageTotals.completionTokens += usage.completion_tokens ?? 0;
            usageTotals.cost += usage.cost ?? 0;
            usageTotals.hasUsage = true;
          }
        } catch {
          // Skip failed chunk embeddings and keep publishing the rest.
        }
      }

      await ctx.runMutation(internal.soul.replaceDocChunks, {
        docId: doc._id,
        orgId: doc.orgId,
        chunks: embedded,
        publishedAt: now,
      });
      chunkCount += embedded.length;
    }

    if (usageTotals.hasUsage) {
      await ctx.runMutation(internal.usage.recordUsageWithCostInternal, {
        userId: actor._id,
        orgId: actor.orgId,
        model: embeddingModelUsed,
        inputTokens: Math.max(0, Math.round(usageTotals.promptTokens)),
        outputTokens: Math.max(0, Math.round(usageTotals.completionTokens)),
        openRouterCost: Math.max(0, Number(usageTotals.cost.toFixed(8))),
      }).catch(() => {});
    }

    return { ok: true, chunkCount };
  },
});

export const publishSoulLexical = mutation({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor || (actor.role !== "teacher" && actor.role !== "admin")) {
      throw new Error("Unauthorized");
    }

    const docs = await ctx.db
      .query("orgSoulDocs")
      .withIndex("by_org", (q) => q.eq("orgId", actor.orgId))
      .collect();

    const now = Date.now();
    for (const doc of docs) {
      await ctx.db.patch(doc._id, {
        publishedAt: now,
        updatedAt: now,
      });
    }

    return { ok: true, fallback: "lexical" as const, chunkCount: 0, docsPublished: docs.length };
  },
});

export const retrieveSoulGuidance: ReturnType<typeof action> = action({
  args: {
    actorClerkId: v.string(),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.runQuery(internal.soul.resolveActor, {
      actorClerkId: args.actorClerkId,
    });

    const docs = (await ctx.runQuery(internal.soul.listDocsForOrg, {
      orgId: actor.orgId,
    })) as SoulDocRow[];

    if (!process.env.OPENROUTER_API_KEY) {
      return {
        bullets: buildLexicalGuidance(args.query, docs, args.limit ?? 8),
      };
    }

    try {
      const embeddingResult = await embeddingFor(args.query);
      await ctx.runMutation(internal.usage.recordUsageWithCostInternal, {
        userId: actor._id,
        orgId: actor.orgId,
        model: embeddingResult.model ?? MODEL_DEFAULTS.embedding,
        inputTokens: Math.max(0, Math.round(embeddingResult.usage?.prompt_tokens ?? 0)),
        outputTokens: Math.max(0, Math.round(embeddingResult.usage?.completion_tokens ?? 0)),
        openRouterCost:
          typeof embeddingResult.usage?.cost === "number" && Number.isFinite(embeddingResult.usage.cost)
            ? Math.max(0, Number(embeddingResult.usage.cost.toFixed(8)))
            : undefined,
      }).catch(() => {});
      const vector = embeddingResult.embedding;
      const hits = await ctx.vectorSearch("orgSoulChunks", "by_embedding", {
        vector,
        limit: Math.min(16, Math.max(4, args.limit ?? 8)),
        filter: (q) => q.eq("orgId", actor.orgId),
      });

      const ids = hits.map((hit) => hit._id);
      const rows = await ctx.runQuery(internal.soul.getChunksByIds, {
        ids,
      });
      const bullets = rows.slice(0, 10).map((row) => `- ${row.text.slice(0, 220)}`);
      if (bullets.length > 0) {
        return { bullets };
      }
    } catch {
      // Fall through to lexical guidance.
    }

    return {
      bullets: buildLexicalGuidance(args.query, docs, args.limit ?? 8),
    };
  },
});
