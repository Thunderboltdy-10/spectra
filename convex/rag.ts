import { action, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { LIMITS } from "./constants";
import { internal } from "./_generated/api";

export const resolveActor = internalQuery({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.actorClerkId))
      .unique();
    if (!actor) {
      throw new Error("Unauthorized");
    }

    return {
      _id: actor._id,
      orgId: actor.orgId,
    };
  },
});

export const getChunksByIds = internalQuery({
  args: {
    ids: v.array(v.id("chunks")),
  },
  handler: async (ctx, args) => {
    const docs: Array<{
      _id: string;
      scope?: unknown;
      ownerUserId?: unknown;
      packId?: unknown;
      agentId?: unknown;
      resourceId?: unknown;
      filename?: unknown;
      page?: unknown;
      text?: unknown;
    }> = [];
    for (const id of args.ids) {
      const doc = await ctx.db.get(id);
      if (!doc) continue;
      docs.push({
        _id: String(doc._id),
        scope: doc.scope,
        ownerUserId: doc.ownerUserId,
        packId: doc.packId,
        agentId: doc.agentId,
        resourceId: doc.resourceId,
        filename: doc.filename,
        page: doc.page,
        text: doc.text,
      });
    }
    return docs;
  },
});

export const validateAgentForActor = internalQuery({
  args: {
    actorClerkId: v.string(),
    agentId: v.id("agents"),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.actorClerkId))
      .unique();
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const agent = await ctx.db.get(args.agentId);
    if (!agent || agent.orgId !== actor.orgId) {
      throw new Error("Agent not found");
    }
    const canAccess =
      actor.role === "admin" ||
      agent.visibility === "public" ||
      agent.creatorUserId === actor._id ||
      (agent.collaborators ?? []).includes(actor._id);
    if (!canAccess) {
      throw new Error("Not authorized for this agent");
    }
    return { ok: true };
  },
});

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return normalize(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function topicRelevance(text: string, filename: string, topicMap: string[]) {
  if (!topicMap.length) return 0;
  const haystack = normalize(`${filename} ${text}`);
  const tokens = new Set(tokenize(haystack));
  let score = 0;
  for (const topic of topicMap) {
    const clean = normalize(topic);
    if (!clean) continue;
    if (haystack.includes(clean)) {
      score += 1;
      continue;
    }
    const topicTokens = tokenize(clean);
    if (topicTokens.length === 0) continue;
    const hits = topicTokens.filter((token) => tokens.has(token)).length;
    const coverage = hits / topicTokens.length;
    if (coverage >= 0.66) score += 0.8;
    else if (coverage >= 0.4) score += 0.45;
  }
  return Math.min(1, score / Math.max(1, Math.min(5, topicMap.length)));
}

export const retrieve: ReturnType<typeof action> = action({
  args: {
    actorClerkId: v.string(),
    packId: v.optional(v.id("packs")),
    agentId: v.optional(v.id("agents")),
    topicMap: v.optional(v.array(v.string())),
    includePersonal: v.boolean(),
    includePack: v.optional(v.boolean()),
    embedding: v.array(v.float64()),
    topK: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.runQuery(internal.rag.resolveActor, {
      actorClerkId: args.actorClerkId,
    });

    if (args.agentId) {
      await ctx.runQuery(internal.rag.validateAgentForActor, {
        actorClerkId: args.actorClerkId,
        agentId: args.agentId,
      });
    }

    const topK = Math.max(1, Math.min(args.topK ?? LIMITS.retrievalTopK, 16));

    const allHits =
      args.agentId || args.includePersonal || (args.includePack && args.packId)
        ? await ctx.vectorSearch("chunks", "by_embedding", {
            vector: args.embedding,
            limit: topK * 8,
            filter: (q) => q.eq("orgId", actor.orgId),
          })
        : [];

    const allIds = allHits.map((hit) => hit._id);
    const uniqueIds = Array.from(new Set(allIds));

    if (uniqueIds.length === 0) {
      return {
        citations: [],
        sourceBlock: "No retrieved course sources.",
      };
    }

    const chunkDocs = await ctx.runQuery(internal.rag.getChunksByIds, {
      ids: uniqueIds,
    });

    const chunkMap = new Map<string, Record<string, unknown>>();
    for (const doc of chunkDocs) {
      chunkMap.set(String(doc._id), doc);
    }

    const topicMap = Array.from(
      new Set(
        (args.topicMap ?? [])
          .map((topic) => topic.trim())
          .filter((topic) => topic.length > 0),
      ),
    ).slice(0, 24);
    const scored = allHits
      .map((hit) => {
        const doc = chunkMap.get(String(hit._id));
        return {
          hit,
          doc,
        };
      })
      .filter((row) => Boolean(row.doc))
      .filter((row) => {
        const doc = row.doc as Record<string, unknown>;
        if (doc.scope === "agent") {
          return args.agentId ? doc.agentId === args.agentId : false;
        }
        if (doc.scope === "pack") {
          return args.includePack && args.packId ? doc.packId === args.packId : false;
        }
        if (doc.scope === "personal") {
          return args.includePersonal && doc.ownerUserId === actor._id;
        }
        return false;
      })
      .sort((a, b) => (b.hit._score ?? 0) - (a.hit._score ?? 0))
      .map((row) => {
        const doc = row.doc as Record<string, unknown>;
        const scope = String(doc.scope ?? "pack");
        const sourceType = (
          scope === "personal"
            ? "personal"
            : scope === "agent"
              ? "agent"
              : "pack"
        ) as "personal" | "pack" | "agent";
        const baseScore = typeof row.hit._score === "number" ? row.hit._score : 0;
        const filename = String(doc.filename ?? "unknown");
        const text = String(doc.text ?? "");
        const topicScore = scope === "agent" ? topicRelevance(text, filename, topicMap) : 0;
        const score = baseScore + (scope === "agent" ? topicScore * 0.16 : 0);
        return {
          resourceId: String(doc.resourceId ?? ""),
          filename,
          page: typeof doc.page === "number" ? doc.page : undefined,
          sourceType,
          scope,
          score,
          topicScore,
          text,
        };
      });

    const prioritized = args.agentId
      ? [
          ...scored.filter((item) => item.scope === "agent"),
          ...scored.filter((item) => item.scope !== "agent"),
        ]
      : scored;

    const dedupedByResource = new Map<
      string,
      {
        resourceId: string;
        filename: string;
        page?: number;
        sourceType: "pack" | "personal" | "agent";
        scope: string;
        score?: number;
        topicScore?: number;
        text: string;
      }
    >();

    for (const item of prioritized) {
      const minimumScore = item.scope === "agent" ? 0.42 : 0.52;
      if ((item.score ?? 0) < minimumScore) {
        continue;
      }
      if (item.scope === "agent" && topicMap.length > 0 && (item.topicScore ?? 0) < 0.18) {
        continue;
      }
      const key = item.resourceId || item.filename;
      const existing = dedupedByResource.get(key);
      if (!existing) {
        dedupedByResource.set(key, { ...item });
        continue;
      }

      if ((item.score ?? 0) > (existing.score ?? 0)) {
        existing.score = item.score;
        existing.topicScore = item.topicScore;
      }

      if (typeof existing.page !== "number" && typeof item.page === "number") {
        existing.page = item.page;
      }

      if (item.text && !existing.text.includes(item.text.slice(0, 120)) && existing.text.length < 1800) {
        existing.text = `${existing.text}\n\n${item.text.slice(0, 700)}`.slice(0, 2200);
      }
    }

    const filtered = [...dedupedByResource.values()].slice(0, topK);

    if (filtered.length === 0) {
      return {
        citations: [],
        sourceBlock: "No high-confidence retrieved sources.",
      };
    }

    return {
      citations: filtered,
      sourceBlock: filtered
        .map(
          (c, index) =>
            `[${index + 1}] ${c.filename}${c.page ? ` p.${c.page}` : ""} (${c.scope}, score ${(
              c.score ?? 0
            ).toFixed(3)})\n${c.text}`,
        )
        .join("\n\n"),
    };
  },
});
