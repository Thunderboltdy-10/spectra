import { mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  buildArtifactTextIndex,
  defaultArtifactContent,
  fallbackArtifactSummary,
  requireSpectraActor,
  type BlueprintKey,
} from "./spectraShared";

const demoWorkspaces: Array<{
  key: string;
  title: string;
  description: string;
  icon: string;
  color: string;
}> = [
  {
    key: "biology",
    title: "Biology",
    description: "IB DP Biology - HL notes, experiments, and exam prep.",
    icon: "leaf",
    color: "green",
  },
  {
    key: "maths-ee",
    title: "Maths EE",
    description: "Extended essay planning, calculus sources, and proof notes.",
    icon: "plus",
    color: "purple",
  },
  {
    key: "spectra",
    title: "Spectra",
    description: "Product research, writing feedback, and study systems.",
    icon: "spark",
    color: "blue",
  },
  {
    key: "economics",
    title: "Economics",
    description: "Micro and macro revision with diagrams and case studies.",
    icon: "bar",
    color: "orange",
  },
  {
    key: "english",
    title: "English",
    description: "Literature analysis, essay drafts, and discussion threads.",
    icon: "book",
    color: "coral",
  },
];

const demoArtifacts: Array<{
  key: string;
  blueprintKey: BlueprintKey | "thread_reference";
  title: string;
  summary: string;
  tags: string[];
  workspaceKey?: string;
  pinned?: boolean;
  cardVariant?: string;
  metrics?: Record<string, string | number>;
  relations?: Array<{ targetKey: string; label: string; relationType: "source" | "supports" | "generated" | "next" }>;
}> = [
  {
    key: "cell-respiration-notes",
    blueprintKey: "document",
    title: "Cell respiration notes",
    summary: "Concise notes on glycolysis, Krebs cycle, and oxidative phosphorylation with key diagrams.",
    tags: ["biology", "respiration"],
    workspaceKey: "biology",
    pinned: true,
    cardVariant: "botanical",
    metrics: { Pages: 18, Linked: 4, Runs: 2 },
  },
  {
    key: "biology-midterm-deck",
    blueprintKey: "flashcard_deck",
    title: "Biology midterm deck",
    summary: "42 review cards across enzymes, membranes, genetics, and respiration.",
    tags: ["biology", "review"],
    workspaceKey: "biology",
    pinned: true,
    metrics: { Cards: 48, Linked: 2, Due: 6 },
  },
  {
    key: "respiration-check",
    blueprintKey: "quiz",
    title: "Respiration check",
    summary: "Quick quiz on cellular respiration and ATP production.",
    tags: ["biology", "quiz"],
    workspaceKey: "biology",
    metrics: { Questions: 20, Score: "85%", Attempts: 2 },
  },
  {
    key: "review-chapter-7",
    blueprintKey: "planner_task",
    title: "Review Chapter 7",
    summary: "Ecosystems and energy flow review task.",
    tags: ["task"],
    workspaceKey: "biology",
    metrics: { Due: "Jun 5", Priority: "Medium" },
  },
  {
    key: "photosynthesis-comparison",
    blueprintKey: "thread_reference",
    title: "Photosynthesis comparison",
    summary: "Side-by-side analysis of C3, C4, and CAM photosynthetic pathways across environmental conditions.",
    tags: ["thread"],
    workspaceKey: "biology",
    pinned: true,
    cardVariant: "flower",
    metrics: { Messages: 14, Linked: 3, Run: 1, Score: "85%" },
    relations: [
      { targetKey: "photosynthesis-overview", label: "uses overview notes", relationType: "source" },
      { targetKey: "calvin-cycle-summary", label: "references cycle summary", relationType: "supports" },
      { targetKey: "respiration-data-analysis", label: "compared in analysis", relationType: "supports" },
      { targetKey: "respiration-check", label: "generated practice quiz", relationType: "generated" },
      { targetKey: "biology-midterm-deck", label: "feeds review deck", relationType: "next" },
    ],
  },
  {
    key: "photosynthesis-overview",
    blueprintKey: "document",
    title: "Photosynthesis overview",
    summary: "Overview of light reactions and Calvin cycle with diagrams.",
    tags: ["biology", "photosynthesis"],
    workspaceKey: "biology",
    metrics: { Pages: 12, Linked: 3, Runs: 1 },
  },
  {
    key: "enzyme-kinetics-discussion",
    blueprintKey: "thread_reference",
    title: "Enzyme kinetics discussion",
    summary: "Analyzing Vmax, Km, and inhibition types with practice problems.",
    tags: ["biology", "enzymes"],
    workspaceKey: "biology",
    metrics: { Messages: 22, Linked: 5, Run: 1 },
  },
  {
    key: "light-dependent-reactions",
    blueprintKey: "document",
    title: "Light-dependent reactions",
    summary: "Short note on photosystems, electron transport, and ATP production.",
    tags: ["biology", "photosynthesis"],
    workspaceKey: "biology",
  },
  {
    key: "calvin-cycle-summary",
    blueprintKey: "document",
    title: "Calvin cycle summary",
    summary: "Compact note on carbon fixation, reduction, and RuBP regeneration.",
    tags: ["biology", "photosynthesis"],
    workspaceKey: "biology",
  },
  {
    key: "glycolysis-summary",
    blueprintKey: "document",
    title: "Glycolysis summary",
    summary: "Ten-step glycolysis note for quick review.",
    tags: ["biology", "respiration"],
    workspaceKey: "biology",
  },
  {
    key: "krebs-cycle-overview",
    blueprintKey: "document",
    title: "Krebs cycle overview",
    summary: "Cycle inputs, outputs, and key enzymes.",
    tags: ["biology", "respiration"],
    workspaceKey: "biology",
  },
  {
    key: "respiration-data-analysis",
    blueprintKey: "thread_reference",
    title: "Respiration data analysis",
    summary: "Generated 18 charts and key comparisons from experiment data.",
    tags: ["biology", "analysis"],
    workspaceKey: "biology",
    metrics: { Charts: 18, Score: "95%", Artifact: 1 },
  },
  {
    key: "enzyme-activity-factors",
    blueprintKey: "document",
    title: "Enzyme activity factors",
    summary: "Next-step note on pH, temperature, and substrate concentration.",
    tags: ["biology", "enzymes"],
    workspaceKey: "biology",
  },
  {
    key: "optimization-draft-v2",
    blueprintKey: "document",
    title: "Optimization draft v2",
    summary: "Maths EE optimization draft with revised method section.",
    tags: ["maths", "ee"],
    workspaceKey: "maths-ee",
  },
  {
    key: "core-theorems-deck",
    blueprintKey: "flashcard_deck",
    title: "Core theorems deck",
    summary: "Flashcards for proof conditions and theorem statements.",
    tags: ["maths"],
    workspaceKey: "maths-ee",
  },
  {
    key: "ia-outline",
    blueprintKey: "planner_task",
    title: "IA outline",
    summary: "Structure and evidence plan for the investigation.",
    tags: ["maths", "task"],
    workspaceKey: "maths-ee",
  },
  {
    key: "calculus-set-practice",
    blueprintKey: "quiz",
    title: "Calculus set practice",
    summary: "Mixed derivative and optimization practice set.",
    tags: ["maths", "quiz"],
    workspaceKey: "maths-ee",
  },
  {
    key: "essay-feedback-summary",
    blueprintKey: "document",
    title: "Essay feedback summary",
    summary: "Summary of essay feedback on topic sentences and thesis clarity.",
    tags: ["inbox", "writing"],
  },
  {
    key: "new-task-inbox",
    blueprintKey: "planner_task",
    title: "New Task",
    summary: "Complete practice problems 12-18 from calculus set.",
    tags: ["inbox", "task"],
  },
  {
    key: "chapter-5-flashcards",
    blueprintKey: "flashcard_deck",
    title: "Chapter 5 flashcards",
    summary: "Key terms and concepts from Chapter 5: Energy.",
    tags: ["inbox", "deck"],
  },
  {
    key: "essay-feedback-thread",
    blueprintKey: "thread_reference",
    title: "Essay feedback summary",
    summary: "Four-message thread with thesis and paragraph feedback.",
    tags: ["spectra", "writing"],
    workspaceKey: "spectra",
  },
  {
    key: "essay-structure-guide",
    blueprintKey: "document",
    title: "Essay structure guide",
    summary: "Reusable structure for introductions, evidence, and conclusions.",
    tags: ["spectra", "writing"],
    workspaceKey: "spectra",
  },
  {
    key: "argument-analysis-quiz",
    blueprintKey: "quiz",
    title: "Argument analysis quiz",
    summary: "18 questions on claims, warrants, and evidence.",
    tags: ["spectra", "quiz"],
    workspaceKey: "spectra",
  },
  {
    key: "study-group-planner",
    blueprintKey: "thread_reference",
    title: "Study group planner",
    summary: "Planning thread for exam week study sessions.",
    tags: ["spectra", "thread"],
    workspaceKey: "spectra",
  },
  {
    key: "research-methods-flashcards",
    blueprintKey: "flashcard_deck",
    title: "Research methods flashcards",
    summary: "32 cards on evidence quality and methodology.",
    tags: ["spectra", "deck"],
    workspaceKey: "spectra",
  },
  {
    key: "macro-notes",
    blueprintKey: "document",
    title: "Macroeconomics notes",
    summary: "Inflation, unemployment, growth, and policy diagrams.",
    tags: ["economics"],
    workspaceKey: "economics",
  },
  {
    key: "market-structures-deck",
    blueprintKey: "flashcard_deck",
    title: "Market structures deck",
    summary: "Revision cards for monopoly, oligopoly, and perfect competition.",
    tags: ["economics", "deck"],
    workspaceKey: "economics",
  },
  {
    key: "elasticity-discussion",
    blueprintKey: "thread_reference",
    title: "Elasticity discussion",
    summary: "Six-message thread on PED, YED, and XED examples.",
    tags: ["economics", "thread"],
    workspaceKey: "economics",
  },
  {
    key: "demand-elasticity-quiz",
    blueprintKey: "quiz",
    title: "Demand elasticity quiz",
    summary: "Completed practice on determinants and calculations.",
    tags: ["economics", "quiz"],
    workspaceKey: "economics",
  },
  {
    key: "case-study-analysis",
    blueprintKey: "planner_task",
    title: "Case study analysis",
    summary: "Prepare diagrams and evaluation for the case study.",
    tags: ["economics", "task"],
    workspaceKey: "economics",
  },
  {
    key: "gatsby-analysis",
    blueprintKey: "document",
    title: "The Great Gatsby analysis",
    summary: "Character, motif, and context notes for essay planning.",
    tags: ["english"],
    workspaceKey: "english",
  },
  {
    key: "symbolism-discussion",
    blueprintKey: "thread_reference",
    title: "Symbolism discussion",
    summary: "Thread about green light, eyes, and American Dream symbolism.",
    tags: ["english", "thread"],
    workspaceKey: "english",
  },
  {
    key: "lit-terms-flashcards",
    blueprintKey: "flashcard_deck",
    title: "Lit terms flashcards",
    summary: "24 cards for rhetoric and literary device definitions.",
    tags: ["english", "deck"],
    workspaceKey: "english",
  },
  {
    key: "essay-draft",
    blueprintKey: "planner_task",
    title: "Essay draft",
    summary: "Draft comparative essay by the end of the week.",
    tags: ["english", "task"],
    workspaceKey: "english",
  },
  {
    key: "poetry-devices-quiz",
    blueprintKey: "quiz",
    title: "Poetry devices quiz",
    summary: "15 questions on imagery, meter, tone, and structure.",
    tags: ["english", "quiz"],
    workspaceKey: "english",
  },
];

const demoRuns: Array<{
  workspaceKey: string;
  artifactKey?: string;
  status: "completed" | "running";
  userPrompt: string;
  finalSummary?: string;
}> = [
  {
    workspaceKey: "biology",
    artifactKey: "respiration-check",
    status: "completed",
    userPrompt: "Created quiz: Respiration check",
    finalSummary: "Generated 10 active recall questions focused on aerobic respiration pathways.",
  },
  {
    workspaceKey: "biology",
    artifactKey: "cell-respiration-notes",
    status: "completed",
    userPrompt: "Edited document: Cell respiration notes",
    finalSummary: "Updated key mechanisms and added fermentation section.",
  },
  {
    workspaceKey: "biology",
    artifactKey: "photosynthesis-comparison",
    status: "completed",
    userPrompt: "Pinned thread: Photosynthesis comparison",
    finalSummary: "Key differences across C3, C4, and CAM pathways.",
  },
  {
    workspaceKey: "biology",
    artifactKey: "biology-midterm-deck",
    status: "completed",
    userPrompt: "Created deck: Biology midterm deck",
    finalSummary: "Created 42 review cards and linked weak areas.",
  },
  {
    workspaceKey: "biology",
    artifactKey: "review-chapter-7",
    status: "running",
    userPrompt: "Study guide: Cellular respiration",
    finalSummary: "Generating review guide from selected notes.",
  },
];

function artifactContent(
  blueprintKey: BlueprintKey,
  params: {
    key: string;
    metrics?: Record<string, string | number>;
    relations?: Array<{ targetKey: string; label: string; relationType: "source" | "supports" | "generated" | "next" }>;
  },
) {
  return {
    ...(defaultArtifactContent(blueprintKey) as Record<string, unknown>),
    spectraDemo: {
      key: params.key,
      metrics: params.metrics ?? {},
      relations: params.relations ?? [],
    },
  };
}

export const ensureDemoData = mutation({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx, args.actorClerkId);
    const now = Date.now();
    const existingWorkspaces = await ctx.db
      .query("spectraWorkspaces")
      .withIndex("by_owner_status", (q) => q.eq("ownerUserId", actor._id).eq("status", "active"))
      .collect();
    const workspaceIds = new Map<string, Id<"spectraWorkspaces">>();

    for (const [workspaceIndex, demo] of demoWorkspaces.entries()) {
      const existing = existingWorkspaces.find((workspace) => workspace.title === demo.title && workspace.orgId === actor.orgId);
      if (existing) {
        workspaceIds.set(demo.key, existing._id);
        const needsRepair = existing.pinned !== undefined || !existing.description || !existing.icon || !existing.color;
        if (needsRepair) await ctx.db.patch(existing._id, {
          pinned: undefined,
          description: existing.description ?? demo.description,
          icon: existing.icon ?? demo.icon,
          color: existing.color ?? demo.color,
        });
        continue;
      }
      const workspaceTime = now - (demoWorkspaces.length - workspaceIndex) * 26 * 60 * 60 * 1000;
      const workspaceId = await ctx.db.insert("spectraWorkspaces", {
        ownerUserId: actor._id,
        orgId: actor.orgId,
        title: demo.title,
        description: demo.description,
        icon: demo.icon,
        color: demo.color,
        status: "active",
        defaultView: demo.key === "biology" ? "cards" : "library",
        createdAt: workspaceTime,
        updatedAt: workspaceTime,
        lastActivityAt: workspaceTime,
      });
      workspaceIds.set(demo.key, workspaceId);
    }

    const existingArtifacts = await ctx.db
      .query("spectraArtifacts")
      .withIndex("by_owner_status", (q) => q.eq("ownerUserId", actor._id).eq("status", "active"))
      .collect();
    const artifactIds = new Map<string, Id<"spectraArtifacts">>();

    let placedCount = 0;
    for (const [artifactIndex, demo] of demoArtifacts.entries()) {
      // Historical demo conversations are no longer materialized as artifacts.
      // Real threads are seeded/provided by the canonical thread system.
      if (demo.blueprintKey === "thread_reference") continue;
      const workspaceId = demo.workspaceKey ? workspaceIds.get(demo.workspaceKey) : undefined;
      const existing = existingArtifacts.find((artifact) => artifact.title === demo.title && artifact.blueprintKey === demo.blueprintKey && artifact.orgId === actor.orgId);
      const artifactTime = now - (artifactIndex + 2) * 43 * 60 * 1000;
      const content = artifactContent(demo.blueprintKey, {
        key: demo.key,
        metrics: demo.metrics,
        relations: demo.relations,
      });
      const artifactId = existing?._id ?? await ctx.db.insert("spectraArtifacts", {
        ownerUserId: actor._id,
        orgId: actor.orgId,
        blueprintKey: demo.blueprintKey,
        title: demo.title,
        summary: demo.summary || fallbackArtifactSummary(demo.blueprintKey),
        content,
        textIndex: buildArtifactTextIndex({
          title: demo.title,
          summary: demo.summary,
          tags: demo.tags,
        }),
        tags: demo.tags,
        status: "active",
        createdFrom: {
          source: workspaceId ? "workspace" : "chat",
          workspaceId,
        },
        createdAt: artifactTime,
        updatedAt: artifactTime,
      });
      artifactIds.set(demo.key, artifactId);

      if (existing?.pinned !== undefined) {
        await ctx.db.patch(existing._id, { pinned: undefined });
      }

      if (workspaceId) {
        const existingItem = await ctx.db
          .query("spectraWorkspaceItems")
          .withIndex("by_workspace_source", (q) => q.eq("workspaceId", workspaceId).eq("sourceType", "artifact").eq("sourceId", artifactId))
          .first();
        if (existingItem) {
          const desiredPinned = demo.pinned ?? existingItem.viewData.pinned;
          const desiredVariant = demo.cardVariant ?? existingItem.viewData.cardVariant;
          if (existingItem.viewData.hidden === true || existingItem.viewData.pinned !== desiredPinned || existingItem.viewData.cardVariant !== desiredVariant) {
            await ctx.db.patch(existingItem._id, {
              viewData: {
                ...existingItem.viewData,
                compactSummary: existingItem.viewData.compactSummary ?? demo.summary,
                pinned: desiredPinned,
                cardVariant: desiredVariant,
                hidden: false,
              },
            });
          }
          continue;
        }
        placedCount += 1;
        await ctx.db.insert("spectraWorkspaceItems", {
          workspaceId,
          sourceType: "artifact",
          sourceId: artifactId,
          viewData: {
            compactSummary: demo.summary,
            hidden: false,
          },
          layout: {
            view: "cards",
            position: {
              x: 0,
              y: placedCount * 24,
            },
          },
          createdAt: artifactTime,
          updatedAt: artifactTime,
        });
      }
    }

    let runCount = 0;
    const biologyWorkspaceId = workspaceIds.get("biology");
    for (const demo of demoRuns) {
      const workspaceId = workspaceIds.get(demo.workspaceKey);
      if (!workspaceId) continue;
      const existingRun = await ctx.db
        .query("spectraAiRuns")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect()
        .then((runs) => runs.find((run) => run.userPrompt === demo.userPrompt));
      if (existingRun) continue;
      const artifactId = demo.artifactKey ? artifactIds.get(demo.artifactKey) : undefined;
      const runCreatedAt = now - (runCount + 1) * 52 * 60 * 1000;
      const runId = await ctx.db.insert("spectraAiRuns", {
        ownerUserId: actor._id,
        orgId: actor.orgId,
        sourceSurface: "workspace",
        workspaceId,
        artifactId,
        status: demo.status,
        userPrompt: demo.userPrompt,
        finalSummary: demo.finalSummary,
        modelUsed: "spectra-demo",
        createdAt: runCreatedAt,
        updatedAt: runCreatedAt,
        completedAt: demo.status === "completed" ? runCreatedAt + 180000 : undefined,
      });
      await ctx.db.insert("spectraResultCards", {
        runId,
        surface: "workspace",
        workspaceId,
        artifactId,
        status: demo.status,
        variant: artifactId ? "artifact" : "status",
        title: demo.status === "completed" ? demo.userPrompt : "Reviewing workspace context",
        summary: demo.finalSummary,
        actions: [],
        createdAt: runCreatedAt,
        updatedAt: runCreatedAt,
      });
      runCount += 1;
    }

    return {
      created: true,
      workspaceId: biologyWorkspaceId,
      workspaceCount: workspaceIds.size,
      artifactCount: artifactIds.size,
      workspaceItemCount: placedCount,
      runCount,
    };
  },
});
