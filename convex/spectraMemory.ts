import { v } from "convex/values";
import { mutation, query } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";
import {
  MEMORY_CAPS,
  applyMemoryText,
  memorySlug,
  type MemoryChangeResult,
  type MemoryHead,
  type MemoryTopicEntry,
} from "../shared/memory-files";

/*
 * The files Spectra keeps about a user (see shared/memory-files.ts). The head
 * row holds everything that is always loaded, so starting a run costs one
 * small read however many topics exist. A topic's text is only read on request.
 */

async function requireActor(ctx: QueryCtx | MutationCtx) {
  const actor = await getAuthenticatedActor(ctx);
  if (!actor) throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
  return actor;
}

const headRow = (ctx: QueryCtx | MutationCtx, accountId: Id<"accounts">) =>
  ctx.db.query("spectraMemoryHeads").withIndex("by_account", (q) => q.eq("accountId", accountId)).unique();

const topicRow = (ctx: QueryCtx | MutationCtx, accountId: Id<"accounts">, slug: string) =>
  ctx.db.query("spectraMemoryTopics").withIndex("by_account_slug", (q) => q.eq("accountId", accountId).eq("slug", slug)).unique();

async function memoryEnabled(ctx: QueryCtx | MutationCtx, accountId: Id<"accounts">) {
  const preferences = await ctx.db.query("memoryPreferences").withIndex("by_account", (q) => q.eq("accountId", accountId)).unique();
  return preferences?.enabled !== false;
}

/** What an account saved before these files existed, until its first write brings it across. */
async function earlierClaims(ctx: QueryCtx | MutationCtx, accountId: Id<"accounts">) {
  const claims: Array<Doc<"memoryClaims">> = await ctx.db
    .query("memoryClaims")
    .withIndex("by_account_status_updated", (q) => q.eq("accountId", accountId).eq("status", "active"))
    .order("desc")
    .take(24);
  let about = "";
  for (const claim of claims) {
    const line = claim.proposition.replace(/\s+/g, " ").trim();
    if (line && about.length + line.length + 1 <= MEMORY_CAPS.about) about = about ? `${about}\n${line}` : line;
  }
  return about;
}

export const head = query({
  args: {},
  handler: async (ctx): Promise<MemoryHead> => {
    const actor = await requireActor(ctx);
    const [row, enabled] = await Promise.all([headRow(ctx, actor.accountId), memoryEnabled(ctx, actor.accountId)]);
    if (!enabled) return { enabled: false, about: "", preferences: "", topics: [] };
    if (row) return { enabled, about: row.about, preferences: row.preferences, topics: row.topics };
    return { enabled, about: await earlierClaims(ctx, actor.accountId), preferences: "", topics: [] };
  },
});

export const readTopic = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx);
    const topic = await topicRow(ctx, actor.accountId, memorySlug(args.slug));
    return topic ? { slug: topic.slug, title: topic.title, summary: topic.summary, content: topic.content, updatedAt: topic.updatedAt } : null;
  },
});

export const update = mutation({
  args: {
    file: v.union(v.literal("about"), v.literal("preferences"), v.literal("topic")),
    slug: v.optional(v.string()),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    add: v.optional(v.string()),
    find: v.optional(v.string()),
    replace: v.optional(v.string()),
    rewrite: v.optional(v.string()),
    remove: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<MemoryChangeResult> => {
    const actor = await requireActor(ctx);
    if (!(await memoryEnabled(ctx, actor.accountId)))
      return { ok: false, message: "Memory is turned off in the user's settings, so nothing was saved." };
    const now = Date.now();
    const row = await headRow(ctx, actor.accountId);
    const current = row
      ? { about: row.about, preferences: row.preferences, topics: row.topics }
      : { about: await earlierClaims(ctx, actor.accountId), preferences: "", topics: [] as MemoryTopicEntry[] };
    const save = async (patch: Partial<typeof current>) => {
      if (row) await ctx.db.patch(row._id, { ...patch, updatedAt: now });
      else await ctx.db.insert("spectraMemoryHeads", { accountId: actor.accountId, schoolId: actor.schoolId, ...current, ...patch, updatedAt: now });
    };

    if (args.file !== "topic") {
      const label = args.file === "about" ? "The about file" : "The preferences file";
      const applied = applyMemoryText(current[args.file], args, MEMORY_CAPS[args.file], label);
      if (!applied.ok) return { ok: false, message: applied.message };
      if (applied.text !== current[args.file] || !row) await save({ [args.file]: applied.text });
      return { ok: true, message: `Saved. ${label} is ${applied.text.length} of ${MEMORY_CAPS[args.file]} characters.` };
    }

    const slug = memorySlug(args.slug ?? args.title ?? "");
    if (!slug) return { ok: false, message: "A topic needs a slug, such as mit-interview." };
    const existing = await topicRow(ctx, actor.accountId, slug);
    if (args.remove) {
      if (existing) await ctx.db.delete(existing._id);
      await save({ topics: current.topics.filter((entry) => entry.slug !== slug) });
      return { ok: true, message: `Erased the topic ${slug}.` };
    }
    if (!existing && current.topics.length >= MEMORY_CAPS.topics)
      return { ok: false, message: `There are already ${MEMORY_CAPS.topics} topics. Merge two or erase one that no longer matters first.` };
    const title = (args.title?.trim() || existing?.title || slug.replace(/-/g, " ")).slice(0, MEMORY_CAPS.topicTitle);
    const summary = (args.summary?.trim() || existing?.summary || "").slice(0, MEMORY_CAPS.topicSummary);
    if (!summary)
      return { ok: false, message: "A new topic needs a one-line summary, so it can be found later without opening it." };
    const hasText = args.add !== undefined || args.find !== undefined || args.rewrite !== undefined;
    const applied = hasText
      ? applyMemoryText(existing?.content ?? "", args, MEMORY_CAPS.topic, `The topic ${slug}`)
      : { ok: true as const, text: existing?.content ?? "" };
    if (!applied.ok) return { ok: false, message: applied.message };
    if (existing) await ctx.db.patch(existing._id, { title, summary, content: applied.text, updatedAt: now });
    else
      await ctx.db.insert("spectraMemoryTopics", { accountId: actor.accountId, slug, title, summary, content: applied.text, updatedAt: now });
    const entry: MemoryTopicEntry = { slug, title, summary, chars: applied.text.length, updatedAt: now };
    await save({ topics: [entry, ...current.topics.filter((candidate) => candidate.slug !== slug)] });
    return { ok: true, message: `Saved. The topic ${slug} is ${applied.text.length} of ${MEMORY_CAPS.topic} characters.` };
  },
});

/** Everything, for the user's own copy. */
export const exportFiles = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    const [row, topics] = await Promise.all([
      headRow(ctx, actor.accountId),
      ctx.db.query("spectraMemoryTopics").withIndex("by_account_slug", (q) => q.eq("accountId", actor.accountId)).take(MEMORY_CAPS.topics * 2),
    ]);
    return {
      about: row?.about ?? "",
      preferences: row?.preferences ?? "",
      topics: topics.map(({ slug, title, summary, content, updatedAt }) => ({ slug, title, summary, content, updatedAt })),
    };
  },
});

export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const actor = await requireActor(ctx);
    const [row, topics] = await Promise.all([
      headRow(ctx, actor.accountId),
      ctx.db.query("spectraMemoryTopics").withIndex("by_account_slug", (q) => q.eq("accountId", actor.accountId)).take(MEMORY_CAPS.topics * 2),
    ]);
    if (row) await ctx.db.delete(row._id);
    await Promise.all(topics.map((topic) => ctx.db.delete(topic._id)));
    return { cleared: topics.length + (row ? 1 : 0) };
  },
});
