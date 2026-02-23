import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";

const vMemoryEntry = v.object({
  key: v.string(),
  value: v.string(),
  confidence: v.number(),
  extractedAt: v.number(),
});

const MEMORY_MAX_ENTRIES = 20;
const MEMORY_MAX_RAW_CHARS = 1500;
const MEMORY_DECAY_CONFIDENCE = 0.3;
const MEMORY_DECAY_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
    const isStaleLowConfidence = confidence < MEMORY_DECAY_CONFIDENCE && now - extractedAt > MEMORY_DECAY_AGE_MS;
    if (isStaleLowConfidence) continue;

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
      .withIndex("by_user", (q) => q.eq("userId", actor._id))
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
      .withIndex("by_user", (q) => q.eq("userId", actor._id))
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
