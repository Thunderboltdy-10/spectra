import fs from "node:fs";

const content = fs.readFileSync("convex/schema.ts", "utf-8");

const tableDefinition = `
  workspaceItems: defineTable({
    orgId: v.id("orgs"),
    ownerUserId: v.id("users"),
    workstreamId: v.optional(v.id("workstreams")),
    type: v.union(
      v.literal("thread"),
      v.literal("document"),
      v.literal("planner"),
      v.literal("board"),
      v.literal("visualization"),
      v.literal("media"),
      v.literal("reference"),
      v.literal("custom"),
      v.literal("utility")
    ),
    renderMode: v.optional(v.string()),
    sourceChatId: v.optional(v.id("chats")),
    sourceArtifactId: v.optional(v.id("artifacts")),
    sourcePlannerItemId: v.optional(v.id("plannerItems")),
    title: v.string(),
    contentSummary: v.optional(v.string()),
    x: v.number(),
    y: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("archived")),
    pinned: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workstream", ["workstreamId"])
    .index("by_owner", ["ownerUserId"]),
`;

if (!content.includes("workspaceItems: defineTable")) {
  const target = "workstreams: defineTable({";
  const newContent = content.replace(target, `${tableDefinition}\n  ${target}`);
  fs.writeFileSync("convex/schema.ts", newContent);
  console.log("Patched schema.ts with workspaceItems");
} else {
  console.log("workspaceItems already exists in schema.ts");
}
