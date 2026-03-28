import { action, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";
import { EMBEDDING_DIMENSIONS } from "./constants";

const vWorkstreamMemoryCategory = v.union(
  v.literal("concept"),
  v.literal("progress"),
  v.literal("preference"),
  v.literal("deadline"),
  v.literal("correction"),
  v.literal("resource_link"),
);

const vWorkstreamMemorySourceType = v.union(
  v.literal("chat_extraction"),
  v.literal("artifact_link"),
  v.literal("user_explicit"),
  v.literal("managebac_sync"),
  v.literal("agent_inference"),
);

const TEXT_HASH_LENGTH = 8;

type WorkstreamMemoryCacheRow = Pick<
  Doc<"workstreamMemory">,
  | "_id"
  | "workstreamId"
  | "ownerUserId"
  | "orgId"
  | "key"
  | "text"
  | "textHash"
  | "embedding"
  | "category"
  | "confidence"
  | "freshness"
  | "sourceType"
  | "sourceChatId"
  | "sourceMessageId"
  | "sourceArtifactId"
  | "status"
  | "supersededBy"
  | "archivedAt"
  | "lastDecayedAt"
  | "createdAt"
  | "updatedAt"
>;

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

function normalizeConfidence(value: number | undefined, fallback = 0.62) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function normalizeFreshness(value: number | undefined, fallback = 1) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function normalizeText(value: string | undefined, maxLength = 700) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeTextForComparison(value: string | undefined) {
  return normalizeText(value, 2_000).toLowerCase();
}

function normalizeKey(value: string | undefined) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "general_memory";
}

async function shortTextHash(value: string) {
  const normalized = normalizeTextForComparison(value);
  if (!normalized) return undefined;

  const bytes = new TextEncoder().encode(normalized);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((chunk) => chunk.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, TEXT_HASH_LENGTH);
  }

  let hash = 2166136261;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(TEXT_HASH_LENGTH, "0").slice(0, TEXT_HASH_LENGTH);
}

function levenshteinDistance(left: string, right: string) {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + cost,
      );
    }
    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j]!;
    }
  }

  return previous[right.length] ?? 0;
}

function normalizedTextSimilarity(left: string, right: string) {
  const a = normalizeTextForComparison(left);
  const b = normalizeTextForComparison(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1;
  const distance = levenshteinDistance(a, b);
  return Math.max(0, 1 - distance / maxLength);
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

function cosineSimilarity(left: number[], right: number[]) {
  const a = normalizeEmbedding(left);
  const b = normalizeEmbedding(right);
  const dot = a.reduce((sum, value, index) => sum + (value * (b[index] ?? 0)), 0);
  const leftMagnitude = Math.sqrt(a.reduce((sum, value) => sum + (value * value), 0));
  const rightMagnitude = Math.sqrt(b.reduce((sum, value) => sum + (value * value), 0));
  if (leftMagnitude <= 0 || rightMagnitude <= 0) return 0;
  return Math.max(0, Math.min(1, dot / (leftMagnitude * rightMagnitude)));
}

function contradictionScore(left: string, right: string) {
  const a = normalizeText(left).toLowerCase();
  const b = normalizeText(right).toLowerCase();
  if (!a || !b || a === b) return 0;

  const negativeA = /\b(not|no|never|isn'?t|aren'?t|wasn'?t|weren'?t|pending|unfinished|incomplete|wrong|incorrect|hasn'?t)\b/.test(a);
  const negativeB = /\b(not|no|never|isn'?t|aren'?t|wasn'?t|weren'?t|pending|unfinished|incomplete|wrong|incorrect|hasn'?t)\b/.test(b);
  const positiveA = /\b(done|completed|finished|correct|understood|mastered|ready|submitted)\b/.test(a);
  const positiveB = /\b(done|completed|finished|correct|understood|mastered|ready|submitted)\b/.test(b);

  let score = 0;
  if ((negativeA && positiveB) || (negativeB && positiveA)) score += 0.55;

  const dateA = a.match(/\b20\d{2}-\d{2}-\d{2}\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  const dateB = b.match(/\b20\d{2}-\d{2}-\d{2}\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (dateA?.[0] && dateB?.[0] && dateA[0] !== dateB[0]) score += 0.35;

  if (lexicalOverlapScore(a, b) < 0.35) score += 0.2;
  return Math.max(0, Math.min(1, score));
}

async function requireActor(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

async function assertWorkstreamOwnership(
  ctx: Parameters<typeof getUserByClerkId>[0],
  actor: Awaited<ReturnType<typeof requireActor>>,
  workstreamId: Id<"workstreams">,
) {
  const workstream = await ctx.db.get(workstreamId);
  if (!workstream || workstream.ownerUserId !== actor._id || workstream.orgId !== actor.orgId) {
    throw new Error("Workstream not found");
  }
  return workstream;
}

export const resolveActorForWorkstreamMemory = internalQuery({
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
    };
  },
});

export const assertWorkstreamForActor = internalQuery({
  args: {
    workstreamId: v.id("workstreams"),
    ownerUserId: v.id("users"),
    orgId: v.id("orgs"),
  },
  handler: async (ctx, args) => {
    const workstream = await ctx.db.get(args.workstreamId);
    if (!workstream || workstream.ownerUserId !== args.ownerUserId || workstream.orgId !== args.orgId) {
      throw new Error("Workstream not found");
    }
    return {
      _id: workstream._id,
    };
  },
});

export const getEntriesByIds = internalQuery({
  args: {
    ids: v.array(v.id("workstreamMemory")),
  },
  handler: async (ctx, args) => {
    const rows: Array<Doc<"workstreamMemory">> = [];
    for (const id of args.ids) {
      const row = await ctx.db.get(id);
      if (row) rows.push(row);
    }
    return rows;
  },
});

export const listByWorkstream = query({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await assertWorkstreamOwnership(ctx, actor, args.workstreamId);

    const limit = Math.max(1, Math.min(args.limit ?? 12, 24));
    const rows = await ctx.db
      .query("workstreamMemory")
      .withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId))
      .collect();

    return rows
      .filter((row) => row.status === "active" && !row.archivedAt)
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

export const upsertEntries = mutation({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    sourceChatId: v.optional(v.id("chats")),
    sourceMessageId: v.optional(v.id("messages")),
    sourceArtifactId: v.optional(v.id("artifacts")),
    entries: v.array(v.object({
      key: v.string(),
      text: v.string(),
      embedding: v.optional(v.array(v.float64())),
      category: vWorkstreamMemoryCategory,
      confidence: v.optional(v.number()),
      freshness: v.optional(v.number()),
      sourceType: v.optional(vWorkstreamMemorySourceType),
    })),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    await assertWorkstreamOwnership(ctx, actor, args.workstreamId);

    const now = Date.now();
    const existingRows = await ctx.db
      .query("workstreamMemory")
      .withIndex("by_workstream", (q) => q.eq("workstreamId", args.workstreamId))
      .collect();
    const cachedRows: WorkstreamMemoryCacheRow[] = existingRows.map((row) => ({
      _id: row._id,
      workstreamId: row.workstreamId,
      ownerUserId: row.ownerUserId,
      orgId: row.orgId,
      key: row.key,
      text: row.text,
      textHash: row.textHash,
      embedding: row.embedding,
      category: row.category,
      confidence: row.confidence,
      freshness: row.freshness,
      sourceType: row.sourceType,
      sourceChatId: row.sourceChatId,
      sourceMessageId: row.sourceMessageId,
      sourceArtifactId: row.sourceArtifactId,
      status: row.status,
      supersededBy: row.supersededBy,
      archivedAt: row.archivedAt,
      lastDecayedAt: row.lastDecayedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

    let inserted = 0;
    let updated = 0;
    let superseded = 0;

    for (const raw of args.entries.slice(0, 8)) {
      const key = normalizeKey(raw.key);
      const text = normalizeText(raw.text);
      if (!text) continue;
      const textHash = await shortTextHash(text);
      const embedding = normalizeEmbedding(raw.embedding);
      const confidence = normalizeConfidence(raw.confidence, 0.7);
      const freshness = normalizeFreshness(raw.freshness, 1);
      const sourceType = raw.sourceType ?? "chat_extraction";

      const activeRows = cachedRows.filter((row) => row.status === "active" && !row.archivedAt);
      const sameKeyRows = activeRows.filter((row) => row.key === key);
      const sameCategoryRows = sameKeyRows.filter((row) => row.category === raw.category);
      const bestExactKeyMatch = sameCategoryRows
        .map((row) => ({
          row,
          similarity:
            textHash && row.textHash && textHash === row.textHash
              ? 1
              : normalizedTextSimilarity(row.text, text),
        }))
        .sort((a, b) => b.similarity - a.similarity)[0];

      if (bestExactKeyMatch && bestExactKeyMatch.similarity >= 0.85) {
        await ctx.db.patch(bestExactKeyMatch.row._id, {
          text,
          textHash,
          embedding,
          confidence: Math.max(bestExactKeyMatch.row.confidence, confidence),
          freshness: Math.max(normalizeFreshness(bestExactKeyMatch.row.freshness, 0), freshness),
          sourceType,
          sourceChatId: args.sourceChatId ?? bestExactKeyMatch.row.sourceChatId,
          sourceMessageId: args.sourceMessageId ?? bestExactKeyMatch.row.sourceMessageId,
          sourceArtifactId: args.sourceArtifactId ?? bestExactKeyMatch.row.sourceArtifactId,
          archivedAt: undefined,
          updatedAt: now,
        });
        const cacheIndex = cachedRows.findIndex((row) => row._id === bestExactKeyMatch.row._id);
        if (cacheIndex >= 0) {
          cachedRows[cacheIndex] = {
            ...cachedRows[cacheIndex]!,
            text,
            textHash,
            embedding,
            confidence: Math.max(bestExactKeyMatch.row.confidence, confidence),
            freshness: Math.max(normalizeFreshness(bestExactKeyMatch.row.freshness, 0), freshness),
            sourceType,
            sourceChatId: args.sourceChatId ?? bestExactKeyMatch.row.sourceChatId,
            sourceMessageId: args.sourceMessageId ?? bestExactKeyMatch.row.sourceMessageId,
            sourceArtifactId: args.sourceArtifactId ?? bestExactKeyMatch.row.sourceArtifactId,
            archivedAt: undefined,
            updatedAt: now,
          };
        }
        updated += 1;
        continue;
      }

      const sameCategoryActiveRows = activeRows.filter((row) => row.category === raw.category);
      const bestSemanticMatch = sameCategoryRows.length > 0
        ? undefined
        : sameCategoryActiveRows
            .map((row) => ({
              row,
              similarity: cosineSimilarity(embedding, Array.isArray(row.embedding) ? row.embedding : []),
            }))
            .sort((a, b) => b.similarity - a.similarity)[0];

      if (bestSemanticMatch && bestSemanticMatch.similarity >= 0.82) {
        await ctx.db.patch(bestSemanticMatch.row._id, {
          text,
          textHash,
          embedding,
          confidence: Math.max(bestSemanticMatch.row.confidence, confidence),
          freshness: Math.max(normalizeFreshness(bestSemanticMatch.row.freshness, 0), freshness),
          sourceType,
          sourceChatId: args.sourceChatId ?? bestSemanticMatch.row.sourceChatId,
          sourceMessageId: args.sourceMessageId ?? bestSemanticMatch.row.sourceMessageId,
          sourceArtifactId: args.sourceArtifactId ?? bestSemanticMatch.row.sourceArtifactId,
          archivedAt: undefined,
          updatedAt: now,
        });
        const cacheIndex = cachedRows.findIndex((row) => row._id === bestSemanticMatch.row._id);
        if (cacheIndex >= 0) {
          cachedRows[cacheIndex] = {
            ...cachedRows[cacheIndex]!,
            text,
            textHash,
            embedding,
            confidence: Math.max(bestSemanticMatch.row.confidence, confidence),
            freshness: Math.max(normalizeFreshness(bestSemanticMatch.row.freshness, 0), freshness),
            sourceType,
            sourceChatId: args.sourceChatId ?? bestSemanticMatch.row.sourceChatId,
            sourceMessageId: args.sourceMessageId ?? bestSemanticMatch.row.sourceMessageId,
            sourceArtifactId: args.sourceArtifactId ?? bestSemanticMatch.row.sourceArtifactId,
            archivedAt: undefined,
            updatedAt: now,
          };
        }
        updated += 1;
        continue;
      }

      const contradictoryRows = sameCategoryRows.filter((row) => {
        if (row.text === text) return false;
        if (raw.category === "correction") return true;
        return contradictionScore(row.text, text) >= 0.55;
      });

      const insertedId = await ctx.db.insert("workstreamMemory", {
        workstreamId: args.workstreamId,
        ownerUserId: actor._id,
        orgId: actor.orgId,
        key,
        text,
        textHash,
        embedding,
        category: raw.category,
        confidence,
        freshness,
        sourceType,
        sourceChatId: args.sourceChatId,
        sourceMessageId: args.sourceMessageId,
        sourceArtifactId: args.sourceArtifactId,
        status: "active",
        archivedAt: undefined,
        lastDecayedAt: undefined,
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;

      for (const row of contradictoryRows) {
        await ctx.db.patch(row._id, {
          status: "superseded",
          supersededBy: insertedId,
          updatedAt: now,
        });
        superseded += 1;
      }

      cachedRows.push({
        _id: insertedId,
        workstreamId: args.workstreamId,
        ownerUserId: actor._id,
        orgId: actor.orgId,
        key,
        text,
        textHash,
        embedding,
        category: raw.category,
        confidence,
        freshness,
        sourceType,
        sourceChatId: args.sourceChatId,
        sourceMessageId: args.sourceMessageId,
        sourceArtifactId: args.sourceArtifactId,
        status: "active",
        supersededBy: undefined,
        archivedAt: undefined,
        lastDecayedAt: undefined,
        createdAt: now,
        updatedAt: now,
      });
    }

    return {
      ok: true,
      inserted,
      updated,
      superseded,
    };
  },
});

export const dismissEntry = mutation({
  args: {
    actorClerkId: v.string(),
    entryId: v.id("workstreamMemory"),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.ownerUserId !== actor._id || entry.orgId !== actor.orgId) {
      throw new Error("Not found");
    }

    await ctx.db.patch(entry._id, {
      status: "dismissed",
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const updateEntry = mutation({
  args: {
    actorClerkId: v.string(),
    entryId: v.id("workstreamMemory"),
    key: v.optional(v.string()),
    text: v.optional(v.string()),
    embedding: v.optional(v.array(v.float64())),
    category: v.optional(vWorkstreamMemoryCategory),
    confidence: v.optional(v.number()),
    freshness: v.optional(v.number()),
    sourceType: v.optional(vWorkstreamMemorySourceType),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.ownerUserId !== actor._id || entry.orgId !== actor.orgId) {
      throw new Error("Not found");
    }

    const updates: Partial<Doc<"workstreamMemory">> & { updatedAt: number } = {
      updatedAt: Date.now(),
    };

    if (args.key !== undefined) updates.key = normalizeKey(args.key);
    if (args.text !== undefined) {
      const text = normalizeText(args.text);
      updates.text = text;
      updates.textHash = await shortTextHash(text);
    }
    if (args.embedding !== undefined) updates.embedding = normalizeEmbedding(args.embedding);
    if (args.category !== undefined) updates.category = args.category;
    if (args.confidence !== undefined) updates.confidence = normalizeConfidence(args.confidence, entry.confidence);
    if (args.freshness !== undefined) updates.freshness = normalizeFreshness(args.freshness, entry.freshness);
    if (args.sourceType !== undefined) updates.sourceType = args.sourceType;

    await ctx.db.patch(entry._id, updates);
    return { ok: true };
  },
});

export const retrieveRelevantForPrompt = action({
  args: {
    actorClerkId: v.string(),
    workstreamId: v.id("workstreams"),
    embedding: v.array(v.float64()),
    message: v.string(),
    topK: v.optional(v.number()),
    minScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.runQuery(internal.workstreamMemory.resolveActorForWorkstreamMemory, {
      actorClerkId: args.actorClerkId,
    });
    await ctx.runQuery(internal.workstreamMemory.assertWorkstreamForActor, {
      workstreamId: args.workstreamId,
      ownerUserId: actor._id,
      orgId: actor.orgId,
    });

    const topK = Math.max(1, Math.min(args.topK ?? 6, 8));
    const minScore = Math.max(0, Math.min(args.minScore ?? 0.34, 1));
    const vector = normalizeEmbedding(args.embedding);
    const reciprocalRankK = 60;
    const results: Array<{
      _id: Id<"workstreamMemory">;
      key: string;
      text: string;
      category: "concept" | "progress" | "preference" | "deadline" | "correction" | "resource_link";
      confidence: number;
      freshness: number;
      score: number;
      lexicalScore: number;
      sourceChatId?: Id<"chats">;
      sourceMessageId?: Id<"messages">;
      sourceArtifactId?: Id<"artifacts">;
      vectorRank: number;
    }> = [];

    const hits = await ctx.vectorSearch("workstreamMemory", "by_embedding", {
      vector,
      limit: Math.max(topK * 4, 20),
      filter: (q) => q.eq("workstreamId", args.workstreamId),
    });

    if (hits.length === 0) return [];

    const rows = (await ctx.runQuery(internal.workstreamMemory.getEntriesByIds, {
      ids: hits.map((hit) => hit._id),
    })) as Doc<"workstreamMemory">[];
    const rowById = new Map(rows.map((row) => [String(row._id), row]));

    for (let index = 0; index < hits.length; index += 1) {
      const hit = hits[index];
      if (!hit) continue;
      const row = rowById.get(String(hit._id));
      if (!row || row.archivedAt) continue;
      if (row.ownerUserId !== actor._id || row.orgId !== actor.orgId) continue;
      if (row.status !== "active") continue;
      const lexicalScore = lexicalOverlapScore(args.message, `${String(row.key ?? "")} ${String(row.text ?? "")}`);
      const freshness = normalizeFreshness(typeof row.freshness === "number" ? row.freshness : 1, 1);
      const confidence = normalizeConfidence(typeof row.confidence === "number" ? row.confidence : 0.6, 0.6);
      const vectorScore = typeof hit._score === "number" ? Math.max(0, Math.min(1, hit._score)) : 0;
      const fusedScore = (vectorScore * 0.58) + (lexicalScore * 0.17) + (freshness * 0.15) + (confidence * 0.1);
      if (fusedScore < minScore && lexicalScore < 0.28) continue;

      results.push({
        _id: hit._id,
        key: String(row.key ?? ""),
        text: String(row.text ?? ""),
        category: row.category as "concept" | "progress" | "preference" | "deadline" | "correction" | "resource_link",
        confidence,
        freshness,
        score: fusedScore,
        lexicalScore,
        sourceChatId: row.sourceChatId as Id<"chats"> | undefined,
        sourceMessageId: row.sourceMessageId as Id<"messages"> | undefined,
        sourceArtifactId: row.sourceArtifactId as Id<"artifacts"> | undefined,
        vectorRank: index + 1,
      });
    }

    const lexicalRanks = new Map<string, number>();
    results
      .slice()
      .sort((a, b) => b.lexicalScore - a.lexicalScore || a.vectorRank - b.vectorRank)
      .forEach((row, index) => {
        lexicalRanks.set(String(row._id), index + 1);
      });

    return results
      .map((row) => ({
        ...row,
        fusedScore:
          (1 / (reciprocalRankK + Math.max(1, row.vectorRank)))
          + (1 / (reciprocalRankK + Math.max(1, lexicalRanks.get(String(row._id)) ?? results.length + 1))),
      }))
      .sort((a, b) => b.fusedScore - a.fusedScore || b.score - a.score || b.confidence - a.confidence)
      .slice(0, topK);
  },
});
