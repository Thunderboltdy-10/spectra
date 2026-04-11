import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listTemplates = query({
  args: { actorClerkId: v.string() },
  handler: async () => {
    return [];
  },
});

export const suggestTemplate = mutation({
  args: { actorClerkId: v.string(), title: v.string() },
  handler: async (_ctx, args) => {
    return { title: args.title, suggestion: null };
  },
});
