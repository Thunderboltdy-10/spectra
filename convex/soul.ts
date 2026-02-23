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

  const json = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
  const vector = json.data?.[0]?.embedding;
  if (!vector) throw new Error("Embedding missing");
  return vector;
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
    let chunkCount = 0;
    for (const doc of docs) {
      if (doc.orgId !== actor.orgId) {
        throw new Error("Unauthorized org scope");
      }
      const pieces = chunkText(doc.content).slice(0, 24);
      const embedded: Array<{ text: string; embedding: number[] }> = [];
      for (const piece of pieces) {
        const embedding = await embeddingFor(piece);
        embedded.push({ text: piece, embedding });
      }

      await ctx.runMutation(internal.soul.replaceDocChunks, {
        docId: doc._id,
        orgId: doc.orgId,
        chunks: embedded,
        publishedAt: now,
      });
      chunkCount += embedded.length;
    }

    return { ok: true, chunkCount };
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

    const vector = await embeddingFor(args.query);
    const hits = await ctx.vectorSearch("orgSoulChunks", "by_embedding", {
      vector,
      limit: Math.min(16, Math.max(4, args.limit ?? 8)),
      filter: (q) => q.eq("orgId", actor.orgId),
    });

    const ids = hits.map((hit) => hit._id);
    const rows = await ctx.runQuery(internal.soul.getChunksByIds, {
      ids,
    });

    return {
      bullets: rows.slice(0, 10).map((row) => `- ${row.text.slice(0, 220)}`),
    };
  },
});
