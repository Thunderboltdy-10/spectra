import { v } from "convex/values";

/*
 * One thing the morning brief proposes (src/features/spectra/today/daily-brief.ts,
 * BriefSuggestion): what to make, ask, open or add, and whether it was done.
 */
export const briefSuggestionValidator = v.object({
  kind: v.union(v.literal("make"), v.literal("ask"), v.literal("open"), v.literal("task"), v.literal("add")),
  title: v.string(),
  why: v.string(),
  prompt: v.optional(v.string()),
  workType: v.optional(v.string()),
  targetId: v.optional(v.string()),
  task: v.optional(
    v.object({
      title: v.string(),
      notes: v.optional(v.string()),
      dueDay: v.optional(v.string()),
      dueTime: v.optional(v.string()),
      estimateMinutes: v.optional(v.number()),
      steps: v.optional(v.array(v.string())),
    }),
  ),
  done: v.optional(v.boolean()),
  doneId: v.optional(v.string()),
});
