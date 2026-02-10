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
    const docs: Array<Record<string, unknown>> = [];
    for (const id of args.ids) {
      const doc = await ctx.db.get(id);
      if (doc) docs.push(doc as Record<string, unknown>);
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
    if (agent.visibility === "private" && agent.creatorUserId !== actor._id && actor.role !== "admin") {
      throw new Error("Not authorized for this agent");
    }
    return { ok: true };
  },
});

export const retrieve: ReturnType<typeof action> = action({
  args: {
    actorClerkId: v.string(),
    agentId: v.optional(v.id("agents")),
    includePersonal: v.boolean(),
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

    const agentHits = args.agentId
      ? await ctx.vectorSearch("chunks", "by_embedding", {
          vector: args.embedding,
          limit: topK * 4,
          filter: (q) => q.eq("orgId", actor.orgId),
        })
      : [];

    const personalHits = args.includePersonal
      ? await ctx.vectorSearch("chunks", "by_embedding", {
          vector: args.embedding,
          limit: topK * 4,
          filter: (q) => q.eq("orgId", actor.orgId),
        })
      : [];

    const allIds = [...agentHits, ...personalHits].map((hit) => hit._id);
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

    const scored = [...agentHits, ...personalHits]
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
        if (doc.scope === "personal") {
          return args.includePersonal && doc.ownerUserId === actor._id;
        }
        return false;
      })
      .sort((a, b) => (b.hit._score ?? 0) - (a.hit._score ?? 0))
      .slice(0, topK)
      .map((row) => {
        const doc = row.doc as Record<string, unknown>;
        const scope = String(doc.scope ?? "pack");
        return {
          resourceId: String(doc.resourceId ?? ""),
          filename: String(doc.filename ?? "unknown"),
          page: typeof doc.page === "number" ? doc.page : undefined,
          sourceType: scope === "personal" ? "personal" : "pack",
          scope,
          score: row.hit._score,
          text: String(doc.text ?? ""),
        };
      });

    const filtered = scored.filter((item) => (item.score ?? 0) >= 0.35);
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
