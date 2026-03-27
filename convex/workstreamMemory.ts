import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";
import { EMBEDDING_DIMENSIONS } from "./constants";

function normalizeEmbedding(rawEmbedding?: number[]) {
  const source = Array.isArray(rawEmbedding) ? rawEmbedding : [];
  if (source.length === EMBEDDING_DIMENSIONS) {
    return source.map((value) => (Number.isFinite(value) ? value : 0));
  }

  const normalized = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const length = Math.min(source.length, EMBEDDING_DIMENSIONS);
  for (let i = 0; i < length; i += 1) {
    normalized[i] = Number.isFinite(source[i]) ? source[i]! : 0;
  }
  return normalized;
}

function lexicalOverlapScore(message: string, value: string) {
  const queryTokens = message
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
  if (queryTokens.length === 0) return 0;
  const haystack = new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3),
  );
  let overlap = 0;
  for (const token of queryTokens) {
    if (haystack.has(token)) overlap += 1;
  }
  return overlap / queryTokens.length;
}

export const listByWorkstream = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const workstream = await ctx.db.get(args.workstreamId);
    if (!workstream || workstream.ownerUserId !== actor._id || workstream.orgId !== actor.orgId) {
      throw new Error("Workstream not found");
    }

    const limit = Math.max(1, Math.min(args.limit ?? 12, 24));
    const rows = await ctx.db
      .query("workstreamMemory")
      .withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId))
      .collect();

    return rows
      .filter((row) => row.status === "active")
      .sort((a, b) => {
        const freshnessDelta = (b.freshness ?? 0) - (a.freshness ?? 0);
        if (freshnessDelta !== 0) return freshnessDelta;
        const confidenceDelta = (b.confidence ?? 0) - (a.confidence ?? 0);
        if (confidenceDelta !== 0) return confidenceDelta;
        return b.updatedAt - a.updatedAt;
      })
      .slice(0, limit);
  },
});

export const retrieveRelevantForPrompt = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    embedding: v.array(v.float64()),
    message: v.string(),
    topK: v.optional(v.number()),
    minScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) throw new Error("Unauthorized");

    const workstream = await ctx.db.get(args.workstreamId);
    if (!workstream || workstream.ownerUserId !== actor._id || workstream.orgId !== actor.orgId) {
      throw new Error("Workstream not found");
    }

    const minScore = Math.max(0, Math.min(args.minScore ?? 0.58, 1));
    const candidateRows = await ctx.db
      .query("workstreamMemory")
      .withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId))
      .collect();
    const results: Array<{
      _id: Id<"workstreamMemory">;
      key: string;
      text: string;
      category: "concept" | "progress" | "preference" | "deadline" | "correction" | "resource_link";
      confidence: number;
      freshness: number;
      score: number;
      fusedScore: number;
    }> = [];

    const vector = normalizeEmbedding(args.embedding);
    const queryMagnitude = Math.sqrt(vector.reduce((sum, value) => sum + (value * value), 0));
    const topK = Math.max(1, Math.min(args.topK ?? 4, 6));

    for (const row of candidateRows) {
      if (row.status !== "active") continue;
      if (row.ownerUserId !== actor._id || row.orgId !== actor.orgId) continue;
      const rowEmbedding = normalizeEmbedding(Array.isArray(row.embedding) ? row.embedding : []);
      const dot = rowEmbedding.reduce((sum, value, index) => sum + (value * (vector[index] ?? 0)), 0);
      const rowMagnitude = Math.sqrt(rowEmbedding.reduce((sum, value) => sum + (value * value), 0));
      const vectorScore =
        queryMagnitude > 0 && rowMagnitude > 0
          ? Math.max(0, Math.min(1, dot / (queryMagnitude * rowMagnitude)))
          : 0;
      const lexical = lexicalOverlapScore(args.message, `${row.key} ${row.text}`);
      const freshness = Math.max(0, Math.min(1, row.freshness ?? 0));
      const confidence = Math.max(0, Math.min(1, row.confidence ?? 0));
      const fusedScore = (vectorScore * 0.55) + (lexical * 0.2) + (freshness * 0.15) + (confidence * 0.1);
      if (fusedScore < minScore && lexical < 0.34) continue;
      results.push({
        _id: row._id,
        key: row.key,
        text: row.text,
        category: row.category,
        confidence,
        freshness,
        score: vectorScore,
        fusedScore,
      });
    }

    return results
      .sort((a, b) => b.fusedScore - a.fusedScore)
      .slice(0, topK);
  },
});
