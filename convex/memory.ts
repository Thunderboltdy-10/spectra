import { action, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { getUserByClerkId } from "./helpers";
import { EMBEDDING_DIMENSIONS } from "./constants";

const vMemoryEntry = v.object({
  key: v.string(),
  value: v.string(),
  confidence: v.number(),
  extractedAt: v.number(),
});

const MEMORY_MAX_ENTRIES = 80;
const MEMORY_MAX_RAW_CHARS = 1500;
const MEMORY_TOPIC_SIMILARITY_MIN = 0.52;
const DAY_MS = 24 * 60 * 60 * 1000;

const vMemoryCategory = v.union(
  v.literal("identity"),
  v.literal("academic"),
  v.literal("preference"),
  v.literal("topic"),
  v.literal("artifact"),
  v.literal("correction"),
);
const vMemoryStatus = v.union(v.literal("pending"), v.literal("confirmed"));
const vMemorySourceType = v.union(v.literal("extraction"), v.literal("user_explicit"), v.literal("correction"));

const GLOBAL_MEMORY_CATEGORIES = new Set(["identity", "academic", "preference"]);
const TOPIC_MEMORY_CATEGORIES = new Set(["topic", "artifact", "correction"]);

const RETENTION_WINDOWS_MS: Record<
  "identity" | "academic" | "preference" | "topic" | "artifact" | "correction",
  number | null
> = {
  identity: null,
  academic: 180 * DAY_MS,
  preference: 90 * DAY_MS,
  topic: 45 * DAY_MS,
  artifact: 45 * DAY_MS,
  correction: 180 * DAY_MS,
};

function canonicalKey(rawKey: string) {
  const normalized = rawKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return "general_note";
  if (/(learning|study)_style|preferred_style/.test(normalized)) return "learning_style";
  if (/weakness|struggle|difficulty/.test(normalized)) return "struggles";
  if (/goal|objective|target/.test(normalized)) return "goals";
  if (/subject.*prefer|favorite_subject|subject_interest/.test(normalized)) return "subject_preferences";
  return normalized;
}

function normalizeEntries(
  entries: Array<{ key: string; value: string; confidence: number; extractedAt: number }>,
  now: number,
) {
  const map = new Map<string, { key: string; value: string; confidence: number; extractedAt: number }>();

  for (const raw of entries) {
    const key = canonicalKey(raw.key);
    const value = String(raw.value ?? "").replace(/\s+/g, " ").trim();
    if (!value) continue;
    const confidence = Math.max(0, Math.min(1, Number(raw.confidence ?? 0.6)));
    const extractedAt = Number.isFinite(raw.extractedAt) ? Number(raw.extractedAt) : now;
    const category = inferLegacyMemoryCategory({ key, value });
    if (isMemoryEntryExpired({ category, updatedAt: extractedAt, now })) continue;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, { key, value, confidence, extractedAt });
      continue;
    }

    const newer = extractedAt >= existing.extractedAt;
    map.set(key, {
      key,
      value: newer ? value : existing.value,
      confidence: Math.max(existing.confidence, confidence),
      extractedAt: Math.max(existing.extractedAt, extractedAt),
    });
  }

  return [...map.values()]
    .sort((a, b) => b.confidence - a.confidence || b.extractedAt - a.extractedAt)
    .slice(0, MEMORY_MAX_ENTRIES);
}

function trimRawMemoryText(value: string) {
  if (value.length <= MEMORY_MAX_RAW_CHARS) return value;
  return value.slice(0, MEMORY_MAX_RAW_CHARS).trimEnd();
}

function flatten(entries: Array<{ key: string; value: string }>) {
  const lines: string[] = [];
  let size = 0;
  for (const entry of entries) {
    const line = `- ${entry.key}: ${entry.value}`.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const nextSize = size + line.length + (lines.length > 0 ? 1 : 0);
    if (nextSize > MEMORY_MAX_RAW_CHARS) break;
    lines.push(line);
    size = nextSize;
  }
  return trimRawMemoryText(lines.join("\n"));
}

function normalizeTopicLabel(rawValue: string) {
  return String(rawValue ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function normalizeMemoryKey(rawValue: string) {
  const normalized = String(rawValue ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) return "general_note";
  return normalized.slice(0, 80);
}

function normalizeMemoryText(rawValue: string) {
  return String(rawValue ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

function normalizeConfidence(rawValue: number | undefined, fallback = 0.6) {
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) return fallback;
  return Math.max(0, Math.min(1, rawValue));
}

function normalizeEmbedding(rawEmbedding?: number[]) {
  const source = Array.isArray(rawEmbedding) ? rawEmbedding : [];
  if (source.length === EMBEDDING_DIMENSIONS) {
    return source.map((value) => (Number.isFinite(value) ? value : 0));
  }

  const normalized = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const length = Math.min(source.length, EMBEDDING_DIMENSIONS);
  for (let i = 0; i < length; i += 1) {
    const value = source[i];
    normalized[i] = Number.isFinite(value) ? value : 0;
  }
  return normalized;
}

function memoryFingerprint(params: {
  category: string;
  key: string;
  text: string;
}) {
  if (GLOBAL_MEMORY_CATEGORIES.has(params.category)) {
    return `${params.category}:${params.key}`;
  }
  return `${params.category}:${params.key}:${params.text.toLowerCase()}`;
}

function isOneOffTask(text: string) {
  return /\b(today|tomorrow|tonight|this week|next week|submit|deadline|due by|assignment due|homework due)\b/i.test(
    text,
  );
}

function inferMemoryCategory(params: {
  key: string;
  text: string;
  requested?: "identity" | "academic" | "preference" | "topic" | "artifact" | "correction";
}) {
  if (params.requested) return params.requested;
  const key = params.key.toLowerCase();
  const text = params.text.toLowerCase();
  if (/(name|grade|year|school|timezone|country|location|language|role|identity)/.test(key)) {
    return "identity" as const;
  }
  if (/(learning_style|communication|prefer|difficulty|study_habit|preference|tone)/.test(key)) {
    return "preference" as const;
  }
  if (/(subject|strength|weakness|struggle|goal|exam|curriculum|topic|academic)/.test(key)) {
    return "academic" as const;
  }
  if (/(flashcard|deck|quiz|artifact|worksheet|notes?)/.test(key) || /(flashcard|quiz|deck|worksheet)/.test(text)) {
    return "artifact" as const;
  }
  if (/(correction|wrong association|dont associate|incorrect)/.test(text)) {
    return "correction" as const;
  }
  return "topic" as const;
}

function inferLegacyMemoryCategory(params: {
  key: string;
  value: string;
}): "identity" | "academic" | "preference" | "topic" | "artifact" | "correction" {
  return inferMemoryCategory({
    key: params.key,
    text: params.value,
  });
}

function isMemoryEntryExpired(params: {
  category: "identity" | "academic" | "preference" | "topic" | "artifact" | "correction";
  updatedAt: number;
  now: number;
}) {
  const windowMs = RETENTION_WINDOWS_MS[params.category];
  if (windowMs === null) return false;
  return params.now - params.updatedAt > windowMs;
}

function matchesTarget(target: string, entry: { key: string; text: string }) {
  const normalizedTarget = normalizeTopicLabel(target);
  if (!normalizedTarget) return false;

  const normalizedKey = normalizeTopicLabel(entry.key);
  const normalizedText = normalizeTopicLabel(entry.text);
  const searchable = `${normalizedKey} ${normalizedText}`.replace(/\s+/g, " ").trim();
  const compactSearchable = searchable.replace(/\s+/g, "");
  const aliases = new Set<string>([normalizedTarget]);
  if (/\bwwii\b/.test(normalizedTarget)) aliases.add("world war ii");
  if (normalizedTarget.includes("world war ii")) aliases.add("wwii");
  if (/\bwwi\b/.test(normalizedTarget)) aliases.add("world war i");
  if (normalizedTarget.includes("world war i")) aliases.add("wwi");

  for (const alias of aliases) {
    const compactAlias = alias.replace(/\s+/g, "");
    if (
      searchable.includes(alias)
      || compactSearchable.includes(compactAlias)
      || searchable.includes(alias.replace(/\s+/g, "_"))
    ) {
      return true;
    }
  }
  return false;
}

function hasNegativeTopicMatch(message: string, links?: string[]) {
  if (!links?.length) return false;
  const normalizedMessage = normalizeTopicLabel(message);
  if (!normalizedMessage) return false;
  return links.some((raw) => {
    const link = normalizeTopicLabel(raw);
    return link.length >= 2 && normalizedMessage.includes(link);
  });
}

export const getUserMemory = query({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const row = await ctx.db
      .query("userMemory")
      .withIndex("by_user_org", (q) => q.eq("userId", actor._id).eq("orgId", actor.orgId))
      .unique();

    if (!row) {
      return {
        rawMemoryText: "",
        entries: [],
        updatedAt: 0,
      };
    }

    return {
      rawMemoryText: row.rawMemoryText,
      entries: row.entries,
      updatedAt: row.updatedAt,
    };
  },
});

export const resolveActorForMemory = internalQuery({
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

export const getMemoryEntriesByIds = internalQuery({
  args: {
    ids: v.array(v.id("userMemoryEntries")),
  },
  handler: async (ctx, args) => {
    const rows: Array<Record<string, unknown>> = [];
    for (const id of args.ids) {
      const row = await ctx.db.get(id);
      if (row) rows.push(row as Record<string, unknown>);
    }
    return rows;
  },
});

export const upsertUserMemory = mutation({
  args: {
    actorClerkId: v.string(),
    rawMemoryText: v.optional(v.string()),
    entries: v.array(vMemoryEntry),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("userMemory")
      .withIndex("by_user_org", (q) => q.eq("userId", actor._id).eq("orgId", actor.orgId))
      .unique();

    const normalizedEntries = normalizeEntries(args.entries, now);
    const rawMemoryText = trimRawMemoryText(args.rawMemoryText ?? flatten(normalizedEntries));

    if (existing) {
      await ctx.db.patch(existing._id, {
        rawMemoryText,
        entries: normalizedEntries,
        updatedAt: now,
      });
      return { ok: true, updatedAt: now };
    }

    await ctx.db.insert("userMemory", {
      userId: actor._id,
      orgId: actor.orgId,
      rawMemoryText,
      entries: normalizedEntries,
      updatedAt: now,
    });

    return { ok: true, updatedAt: now };
  },
});

export const upsertMemoryEntry = mutation({
  args: {
    actorClerkId: v.string(),
    entry: vMemoryEntry,
    rawSnippet: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("userMemory")
      .withIndex("by_user_org", (q) => q.eq("userId", actor._id).eq("orgId", actor.orgId))
      .unique();

    const normalizedEntries = normalizeEntries([...(existing?.entries ?? []), args.entry], now);
    const rawMemoryText = trimRawMemoryText(
      [existing?.rawMemoryText, args.rawSnippet]
        .filter((value): value is string => Boolean(value && value.trim().length > 0))
        .join("\n") || flatten(normalizedEntries),
    );

    if (existing) {
      await ctx.db.patch(existing._id, {
        rawMemoryText,
        entries: normalizedEntries,
        updatedAt: now,
      });
      return { ok: true, updatedAt: now };
    }

    await ctx.db.insert("userMemory", {
      userId: actor._id,
      orgId: actor.orgId,
      rawMemoryText,
      entries: normalizedEntries,
      updatedAt: now,
    });

    return { ok: true, updatedAt: now };
  },
});

export const routeMemoryWrite = mutation({
  args: {
    actorClerkId: v.string(),
    sourceChatId: v.optional(v.id("chats")),
    entries: v.array(v.object({
      key: v.string(),
      text: v.string(),
      embedding: v.optional(v.array(v.float64())),
      confidence: v.optional(v.number()),
      category: v.optional(vMemoryCategory),
      sourceType: v.optional(vMemorySourceType),
      status: v.optional(vMemoryStatus),
      relatedArtifacts: v.optional(v.array(v.string())),
      negativeTopicLinks: v.optional(v.array(v.string())),
    })),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const now = Date.now();
    const existingRows = await ctx.db
      .query("userMemoryEntries")
      .withIndex("by_user_org", (q) => q.eq("userId", actor._id).eq("orgId", actor.orgId))
      .collect();

    const existingByFingerprint = new Map(
      existingRows.map((row) => [
        memoryFingerprint({
          category: row.category,
          key: normalizeMemoryKey(row.key),
          text: normalizeMemoryText(row.text),
        }),
        row,
      ]),
    );

    let inserted = 0;
    let updated = 0;
    let promoted = 0;
    const writtenIds: Id<"userMemoryEntries">[] = [];

    for (const raw of args.entries) {
      const key = normalizeMemoryKey(raw.key);
      const text = normalizeMemoryText(raw.text);
      if (!text) continue;
      if (isOneOffTask(text)) continue;
      const category = inferMemoryCategory({
        key,
        text,
        requested: raw.category,
      });
      const sourceType = raw.sourceType ?? "extraction";
      const requestedStatus = raw.status;
      const confidence = normalizeConfidence(raw.confidence, 0.6);
      const baseStatus =
        requestedStatus
        ?? (GLOBAL_MEMORY_CATEGORIES.has(category) || sourceType !== "extraction" ? "confirmed" : "pending");
      const finalStatus = baseStatus === "pending" ? "pending" : "confirmed";
      const effectiveConfidence =
        finalStatus === "pending" ? Math.max(0.05, Math.min(1, confidence * 0.5)) : confidence;

      const fingerprint = memoryFingerprint({ category, key, text });
      const existing = existingByFingerprint.get(fingerprint);

      if (!existing) {
        const insertedId = await ctx.db.insert("userMemoryEntries", {
          userId: actor._id,
          orgId: actor.orgId,
          key,
          text,
          embedding: normalizeEmbedding(raw.embedding),
          category,
          confidence: effectiveConfidence,
          status: finalStatus,
          sourceType,
          sourceChatId: args.sourceChatId,
          relatedArtifacts: raw.relatedArtifacts?.slice(0, 12),
          negativeTopicLinks: raw.negativeTopicLinks?.map(normalizeTopicLabel).filter(Boolean).slice(0, 12),
          createdAt: now,
          updatedAt: now,
        });
        inserted += 1;
        writtenIds.push(insertedId);
        continue;
      }

      let nextStatus = existing.status;
      if (finalStatus === "confirmed") {
        nextStatus = "confirmed";
      } else if (
        existing.status === "pending"
        && args.sourceChatId
        && existing.sourceChatId
        && existing.sourceChatId !== args.sourceChatId
      ) {
        nextStatus = "confirmed";
        promoted += 1;
      }

      const nextLinks = new Set<string>(existing.negativeTopicLinks ?? []);
      for (const rawLink of raw.negativeTopicLinks ?? []) {
        const normalized = normalizeTopicLabel(rawLink);
        if (normalized) nextLinks.add(normalized);
      }

      await ctx.db.patch(existing._id, {
        key,
        text,
        embedding: normalizeEmbedding(raw.embedding),
        category,
        confidence: Math.max(existing.confidence, effectiveConfidence),
        status: nextStatus,
        sourceType:
          sourceType === "user_explicit" || sourceType === "correction"
            ? sourceType
            : existing.sourceType,
        sourceChatId: args.sourceChatId ?? existing.sourceChatId,
        relatedArtifacts: raw.relatedArtifacts?.slice(0, 12) ?? existing.relatedArtifacts,
        negativeTopicLinks: nextLinks.size > 0 ? [...nextLinks].slice(0, 12) : existing.negativeTopicLinks,
        updatedAt: now,
      });
      updated += 1;
      writtenIds.push(existing._id);
    }

    return {
      ok: true,
      inserted,
      updated,
      promoted,
      writtenIds,
    };
  },
});

export const listMemoryEntries = query({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const rows = await ctx.db
      .query("userMemoryEntries")
      .withIndex("by_user_org", (q) => q.eq("userId", actor._id).eq("orgId", actor.orgId))
      .collect();

    return rows
      .filter((row) =>
        !isMemoryEntryExpired({
          category: row.category,
          updatedAt: row.updatedAt,
          now: Date.now(),
        }))
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt || b.confidence - a.confidence)
      .map((row) => ({
        _id: row._id,
        key: row.key,
        text: row.text,
        category: row.category,
        confidence: row.confidence,
        status: row.status,
        sourceType: row.sourceType,
        sourceChatId: row.sourceChatId,
        relatedArtifacts: row.relatedArtifacts ?? [],
        negativeTopicLinks: row.negativeTopicLinks ?? [],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
  },
});

export const getGlobalProfileEntries = query({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const rows = await ctx.db
      .query("userMemoryEntries")
      .withIndex("by_user_org", (q) => q.eq("userId", actor._id).eq("orgId", actor.orgId))
      .collect();

    return rows
      .filter((row) => {
        if (row.status !== "confirmed") return false;
        if (!GLOBAL_MEMORY_CATEGORIES.has(row.category)) return false;
        return !isMemoryEntryExpired({
          category: row.category,
          updatedAt: row.updatedAt,
          now: Date.now(),
        });
      })
      .sort((a, b) => b.confidence - a.confidence || b.updatedAt - a.updatedAt)
      .slice(0, 18)
      .map((row) => ({
        _id: row._id,
        key: row.key,
        text: row.text,
        category: row.category,
        confidence: row.confidence,
        updatedAt: row.updatedAt,
      }));
  },
});

export const forgetMemoryEntriesByQuery = mutation({
  args: {
    actorClerkId: v.string(),
    target: v.optional(v.string()),
    sourceChatId: v.optional(v.id("chats")),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const rows = await ctx.db
      .query("userMemoryEntries")
      .withIndex("by_user_org", (q) => q.eq("userId", actor._id).eq("orgId", actor.orgId))
      .collect();

    const target = args.target?.trim();
    const normalizedTarget = normalizeTopicLabel(target ?? "");
    const targetAliases = new Set<string>();
    if (normalizedTarget) {
      targetAliases.add(normalizedTarget);
      targetAliases.add(normalizedTarget.replace(/\s+/g, ""));
      if (/\bwwii\b/.test(normalizedTarget) || normalizedTarget.includes("world war ii")) {
        targetAliases.add("wwii");
        targetAliases.add("world war ii");
        targetAliases.add("worldwarii");
      }
      if (/\bwwi\b/.test(normalizedTarget) || normalizedTarget.includes("world war i")) {
        targetAliases.add("wwi");
        targetAliases.add("world war i");
        targetAliases.add("worldwari");
      }
    }

    let deleted = 0;
    for (const row of rows) {
      let shouldDelete = false;
      if (target && target.length > 0) {
        const searchable = normalizeTopicLabel(`${row.key} ${row.text}`);
        const compactSearchable = searchable.replace(/\s+/g, "");
        for (const alias of targetAliases) {
          if (!alias) continue;
          if (searchable.includes(alias) || compactSearchable.includes(alias.replace(/\s+/g, ""))) {
            shouldDelete = true;
            break;
          }
        }
      } else if (args.sourceChatId) {
        shouldDelete = row.sourceChatId === args.sourceChatId;
      }
      if (!shouldDelete) continue;
      await ctx.db.delete(row._id);
      deleted += 1;
    }

    return { ok: true, deleted };
  },
});

export const forgetAllByTopic = mutation({
  args: {
    actorClerkId: v.string(),
    topic: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const topic = normalizeTopicLabel(args.topic);
    if (!topic) {
      return { ok: true, deleted: 0 };
    }

    const rows = await ctx.db
      .query("userMemoryEntries")
      .withIndex("by_user_org", (q) => q.eq("userId", actor._id).eq("orgId", actor.orgId))
      .collect();

    let deleted = 0;
    for (const row of rows) {
      if (!TOPIC_MEMORY_CATEGORIES.has(row.category)) continue;
      if (matchesTarget(topic, row)) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }
    return { ok: true, deleted };
  },
});

export const setMemoryEntryStatus = mutation({
  args: {
    actorClerkId: v.string(),
    entryId: v.id("userMemoryEntries"),
    status: vMemoryStatus,
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.userId !== actor._id || entry.orgId !== actor.orgId) {
      throw new Error("Not found");
    }
    await ctx.db.patch(entry._id, {
      status: args.status,
      updatedAt: Date.now(),
      confidence: args.status === "confirmed" ? Math.max(entry.confidence, 0.7) : entry.confidence,
    });
    return { ok: true };
  },
});

export const removeMemoryEntry = mutation({
  args: {
    actorClerkId: v.string(),
    entryId: v.id("userMemoryEntries"),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.userId !== actor._id || entry.orgId !== actor.orgId) {
      throw new Error("Not found");
    }
    await ctx.db.delete(entry._id);
    return { ok: true };
  },
});

export const addNegativeTopicLink = mutation({
  args: {
    actorClerkId: v.string(),
    topic: v.string(),
    target: v.optional(v.string()),
    sourceChatId: v.optional(v.id("chats")),
  },
  handler: async (ctx, args) => {
    const actor = await getUserByClerkId(ctx, args.actorClerkId);
    if (!actor) {
      throw new Error("Unauthorized");
    }

    const topic = normalizeTopicLabel(args.topic);
    if (!topic) {
      return { ok: true, updated: 0 };
    }

    const rows = await ctx.db
      .query("userMemoryEntries")
      .withIndex("by_user_org", (q) => q.eq("userId", actor._id).eq("orgId", actor.orgId))
      .collect();

    let updated = 0;
    for (const row of rows) {
      if (!TOPIC_MEMORY_CATEGORIES.has(row.category)) continue;
      const matches = args.target
        ? matchesTarget(args.target, row)
        : args.sourceChatId
          ? row.sourceChatId === args.sourceChatId
          : true;
      if (!matches) continue;

      const next = new Set<string>(row.negativeTopicLinks ?? []);
      next.add(topic);
      await ctx.db.patch(row._id, {
        negativeTopicLinks: [...next].slice(0, 12),
        updatedAt: Date.now(),
      });
      updated += 1;
    }
    return { ok: true, updated };
  },
});

export const retrieveRelevantEntries: ReturnType<typeof action> = action({
  args: {
    actorClerkId: v.string(),
    embedding: v.array(v.float64()),
    message: v.string(),
    topK: v.optional(v.number()),
    minScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await ctx.runQuery(internal.memory.resolveActorForMemory, {
      actorClerkId: args.actorClerkId,
    });

    const topK = Math.max(1, Math.min(args.topK ?? 5, 12));
    const minScore = Math.max(0, Math.min(1, args.minScore ?? MEMORY_TOPIC_SIMILARITY_MIN));

    const hits = await ctx.vectorSearch("userMemoryEntries", "by_embedding", {
      vector: normalizeEmbedding(args.embedding),
      limit: topK * 8,
      filter: (q) => q.eq("userId", actor._id),
    });

    const rows = await ctx.runQuery(internal.memory.getMemoryEntriesByIds, {
      ids: hits.map((hit) => hit._id),
    });
    const rowById = new Map(rows.map((row) => [String(row._id), row]));
    const results: Array<{
      _id: Id<"userMemoryEntries">;
      key: string;
      text: string;
      category: "topic" | "artifact" | "correction";
      confidence: number;
      score: number;
      sourceChatId?: Id<"chats">;
      negativeTopicLinks: string[];
      updatedAt: number;
    }> = [];

    for (let index = 0; index < hits.length; index += 1) {
      const hit = hits[index];
      const row = rowById.get(String(hit._id));
      if (!hit || !row) continue;
      const rowStatus = String(row.status ?? "");
      const rowCategory = String(row.category ?? "");
      if (rowStatus !== "confirmed") continue;
      if (!TOPIC_MEMORY_CATEGORIES.has(rowCategory)) continue;
      if (
        isMemoryEntryExpired({
          category: rowCategory as "topic" | "artifact" | "correction",
          updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : 0,
          now: Date.now(),
        })
      ) {
        continue;
      }
      const score = typeof hit._score === "number" ? hit._score : 0;
      if (score < minScore) continue;
      const negativeTopicLinks = Array.isArray(row.negativeTopicLinks)
        ? row.negativeTopicLinks.map((value) => String(value))
        : [];
      if (hasNegativeTopicMatch(args.message, negativeTopicLinks)) continue;

      results.push({
        _id: hit._id,
        key: String(row.key ?? ""),
        text: String(row.text ?? ""),
        category: rowCategory as "topic" | "artifact" | "correction",
        confidence: normalizeConfidence(
          typeof row.confidence === "number" ? row.confidence : Number(row.confidence ?? 0.6),
          0.6,
        ),
        score,
        sourceChatId: row.sourceChatId as Id<"chats"> | undefined,
        negativeTopicLinks,
        updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : 0,
      });
    }

    const deduped = new Map<string, (typeof results)[number]>();
    for (const row of results) {
      const key = `${row.category}:${row.key}:${row.text.toLowerCase()}`;
      const existing = deduped.get(key);
      if (!existing || row.score > existing.score) {
        deduped.set(key, row);
      }
    }

    return [...deduped.values()]
      .sort((a, b) => b.score - a.score || b.confidence - a.confidence || b.updatedAt - a.updatedAt)
      .slice(0, topK);
  },
});
