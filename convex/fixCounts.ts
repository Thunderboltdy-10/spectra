import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";

export const fixCounts = mutation({
  handler: async (ctx) => {
    const workstreams = await ctx.db.query("workstreams").collect();
    for (const ws of workstreams) {
      const threads = await ctx.db.query("chats").withIndex("by_workstream", q => q.eq("workstreamId", ws._id)).collect();
      const artifacts = await ctx.db.query("artifacts").withIndex("by_workstream", q => q.eq("workstreamId", ws._id)).collect();
      
      const threadCount = threads.filter(t => !t.deletedAt).length;
      const artifactCount = artifacts.filter(a => a.status !== "archived").length;
      
      if (ws.threadCount !== threadCount || ws.artifactCount !== artifactCount) {
        await ctx.db.patch(ws._id, { threadCount, artifactCount });
      }
    }
  }
});