import { v } from "convex/values";
import { internalMutation, query } from "./functions";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";
import {
  GUIDE_SECTION_LIMIT,
  GUIDE_TOTAL_LIMIT,
  findGuideSections,
  guideOutlineText,
  renderGuideSection,
  sectionAt,
  sectionQueries,
} from "../shared/syllabus/guides";

/*
 * The official IB guides read_syllabus serves (shared/syllabus/guides.ts).
 * scripts/import-syllabus-guides.ts writes them; everyone signed in reads them.
 */

const vLevel = v.optional(v.union(v.literal("SL"), v.literal("HL")));

const outlineEntry = v.object({
  start: v.number(),
  end: v.number(),
  code: v.optional(v.string()),
  title: v.string(),
  depth: v.number(),
  area: v.union(v.literal("syllabus"), v.literal("assessment"), v.literal("reference")),
});

const SEARCH_SECTION_LIMIT = 6_000;
/** A section found by words is given whole up to this size; past it, only the part that matched. */
const SEARCH_WHOLE_SECTION = 9_000;

function segmentsOf(ctx: QueryCtx, guideId: string, entry: { start: number; end: number }) {
  return ctx.db
    .query("syllabusGuideSegments")
    .withIndex("by_guide_start", (q) => q.eq("guideId", guideId).gte("start", entry.start).lt("start", entry.end))
    .take(400);
}

async function searchGuide(ctx: QueryCtx, guide: Doc<"syllabusGuides">, words: string) {
  const hits = await ctx.db
    .query("syllabusGuideSegments")
    .withSearchIndex("search_text", (q) => q.search("text", words.slice(0, 200)).eq("guideId", guide.guideId))
    .take(8);
  const parts: string[] = [];
  const seen = new Set<number>();
  for (const hit of hits) {
    const index = sectionAt(guide.outline, hit.start);
    if (index === -1 || seen.has(index)) continue;
    seen.add(index);
    const entry = guide.outline[index]!;
    const segments = entry.end - entry.start <= SEARCH_WHOLE_SECTION ? await segmentsOf(ctx, guide.guideId, entry) : [hit];
    parts.push(renderGuideSection(guide.outline, index, segments, SEARCH_SECTION_LIMIT));
    if (parts.length === 3) break;
  }
  return parts;
}

/** The guide for a course: its outline, or the sections asked for (codes, headings or words). Null when no guide is stored. */
export const read = query({
  args: { courseId: v.string(), level: vLevel, section: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!(await getAuthenticatedActor(ctx))) throw new Error("AUTH_NO_SCHOOL: An active school membership is required.");
    const course = await ctx.db
      .query("syllabusGuideCourses")
      .withIndex("by_course", (q) => q.eq("courseId", args.courseId))
      .first();
    if (!course) return null;
    const guide = await ctx.db
      .query("syllabusGuides")
      .withIndex("by_guide", (q) => q.eq("guideId", course.guideId))
      .first();
    if (!guide) return null;
    const section = args.section?.trim();
    if (!section) return { title: guide.title, found: "outline" as const, text: guideOutlineText(guide.outline) };

    const parts: string[] = [];
    const missing: string[] = [];
    let total = 0;
    for (const wanted of sectionQueries(section)) {
      const found = findGuideSections(guide.outline, wanted, args.level);
      if (!found.length) missing.push(wanted);
      for (const index of found) {
        if (total >= GUIDE_TOTAL_LIMIT) break;
        const entry = guide.outline[index]!;
        const text = renderGuideSection(guide.outline, index, await segmentsOf(ctx, guide.guideId, entry), Math.min(GUIDE_SECTION_LIMIT, GUIDE_TOTAL_LIMIT - total));
        parts.push(text);
        total += text.length;
      }
    }
    if (parts.length) {
      return { title: guide.title, found: "section" as const, text: [...parts, missing.length ? `No section matches: ${missing.join(", ")}.` : ""].filter(Boolean).join("\n\n") };
    }
    const searched = await searchGuide(ctx, guide, section);
    if (searched.length) {
      return { title: guide.title, found: "search" as const, text: `No section is called "${section}". The parts of the guide that mention it:\n\n${searched.join("\n\n")}` };
    }
    return { title: guide.title, found: "none" as const, text: `Nothing in the guide matches "${section}". Its sections:\n${guideOutlineText(guide.outline)}` };
  },
});

/* Import (scripts/import-syllabus-guides.ts, with an admin or deploy key). */

/** Removes a guide before it is written again; call until done. */
export const clearGuide = internalMutation({
  args: { guideId: v.string() },
  handler: async (ctx, args) => {
    const guide = await ctx.db
      .query("syllabusGuides")
      .withIndex("by_guide", (q) => q.eq("guideId", args.guideId))
      .first();
    if (guide) await ctx.db.delete(guide._id);
    const segments = await ctx.db
      .query("syllabusGuideSegments")
      .withIndex("by_guide_start", (q) => q.eq("guideId", args.guideId))
      .take(500);
    for (const segment of segments) await ctx.db.delete(segment._id);
    return { done: segments.length < 500 };
  },
});

export const addSegments = internalMutation({
  args: { guideId: v.string(), segments: v.array(v.object({ start: v.number(), text: v.string() })) },
  handler: async (ctx, args) => {
    for (const segment of args.segments) await ctx.db.insert("syllabusGuideSegments", { guideId: args.guideId, ...segment });
  },
});

/** Written last, so a guide is only read once all its text is in. */
export const saveGuide = internalMutation({
  args: { guideId: v.string(), title: v.string(), outline: v.array(outlineEntry), sourceSha: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("syllabusGuides", { ...args, importedAt: Date.now() });
  },
});

export const setCourses = internalMutation({
  args: { courses: v.array(v.object({ courseId: v.string(), guideId: v.string() })) },
  handler: async (ctx, args) => {
    for (const row of await ctx.db.query("syllabusGuideCourses").take(500)) await ctx.db.delete(row._id);
    for (const row of args.courses) await ctx.db.insert("syllabusGuideCourses", row);
  },
});
