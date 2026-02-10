import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { MODEL_DEFAULTS } from "./constants";

export const seedDemoPack = mutation({
  args: {
    orgId: v.id("orgs"),
    ownerUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("packs")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();

    if (existing) {
      return existing._id;
    }

    const now = Date.now();
    return ctx.db.insert("packs", {
      orgId: args.orgId,
      ownerUserId: args.ownerUserId,
      name: "General Demo Workspace",
      subject: "General",
      academicYear: "2025/26",
      strictness: "medium",
      defaultModel: MODEL_DEFAULTS.tutorFast,
      allowedModels: [
        MODEL_DEFAULTS.tutorFast,
        MODEL_DEFAULTS.tutorHigh,
        MODEL_DEFAULTS.marker,
        MODEL_DEFAULTS.multimodal,
        MODEL_DEFAULTS.openrouterAuto,
        MODEL_DEFAULTS.glmAir,
        MODEL_DEFAULTS.gptOss,
      ],
      guidelinesSummary:
        "General school guidance pack. Upload teacher resources to generate deeper topic map and rubric hints.",
      guidelinesTopicMap: ["Concept building", "Problem solving", "Writing quality", "Exam readiness", "Projects"],
      guidelinesRubricHints: [
        "Define terms before applying them.",
        "Show reasoning steps and cite evidence from materials where possible.",
      ],
      guidelinesMisconceptions: [
        "Jumping to answers without showing method.",
        "Using memorized templates without matching the task prompt.",
      ],
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const migrateLegacyDemoCopy = mutation({
  args: {
    orgId: v.id("orgs"),
  },
  handler: async (ctx, args) => {
    const packs = await ctx.db
      .query("packs")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    for (const pack of packs) {
      const isLegacySeed =
        pack.name === "Physics HL Demo Pack" ||
        pack.subject === "Physics HL" ||
        (pack.guidelinesSummary ?? "").toLowerCase().includes("physics hl guidance pack");

      if (!isLegacySeed) continue;

      await ctx.db.patch(pack._id, {
        name: pack.name === "Physics HL Demo Pack" ? "General Demo Workspace" : pack.name,
        subject: pack.subject === "Physics HL" ? "General" : pack.subject,
        guidelinesSummary:
          "General school guidance pack. Upload teacher resources to generate deeper topic map and rubric hints.",
        guidelinesTopicMap: ["Concept building", "Problem solving", "Writing quality", "Exam readiness", "Projects"],
        guidelinesRubricHints: [
          "Define terms before applying them.",
          "Show reasoning steps and cite evidence from materials where possible.",
        ],
        guidelinesMisconceptions: [
          "Jumping to answers without showing method.",
          "Using memorized templates without matching the task prompt.",
        ],
        updatedAt: Date.now(),
      });
    }

    return { ok: true };
  },
});

export const seedDefaultAgents = mutation({
  args: {
    orgId: v.id("orgs"),
    creatorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agents")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();

    if (existing) {
      return { inserted: 0 };
    }

    const now = Date.now();
    const defaults = [
      {
        name: "Study Buddy",
        description: "Breaks down complex topics into simple, clear explanations with guided checks.",
        systemPrompt:
          "You are Study Buddy. Break difficult concepts into digestible steps. Ask one check-question after each explanation and avoid giving full answers before the student attempts.",
        avatarEmoji: "🧠",
        category: "Study Helper",
        preferredMode: "tutor" as const,
      },
      {
        name: "Essay Coach",
        description: "Improves structure, evidence use, and academic tone in essays.",
        systemPrompt:
          "You are Essay Coach. Improve thesis clarity, paragraph flow, evidence quality, and style. Give concise line-by-line suggestions and a final improved outline.",
        avatarEmoji: "✍️",
        category: "Writing",
        preferredMode: "draft_coach" as const,
      },
      {
        name: "Exam Prep",
        description: "Generates targeted practice questions, model approaches, and review plans.",
        systemPrompt:
          "You are Exam Prep Coach. Generate timed practice sets with mark-aware guidance, then provide strategic feedback on method and revision priorities.",
        avatarEmoji: "📘",
        category: "Exam Prep",
        preferredMode: "exam" as const,
      },
      {
        name: "Homework Helper",
        description: "Guides step-by-step reasoning and hints without revealing final answers immediately.",
        systemPrompt:
          "You are Homework Helper. Give progressive hints and only reveal a full solution after the student shares an attempt and reflection on mistakes.",
        avatarEmoji: "🧩",
        category: "Homework",
        preferredMode: "tutor" as const,
      },
    ];

    for (const item of defaults) {
      await ctx.db.insert("agents", {
        orgId: args.orgId,
        creatorUserId: args.creatorUserId,
        name: item.name,
        description: item.description,
        systemPrompt: item.systemPrompt,
        avatarEmoji: item.avatarEmoji,
        category: item.category,
        preferredMode: item.preferredMode,
        preferredModel: undefined,
        visibility: "public",
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { inserted: defaults.length };
  },
});
