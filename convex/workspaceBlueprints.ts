import { mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { getUserByClerkId } from "./helpers";

type DemoArtifactBlueprint = {
  type: string;
  title: string;
  content: string;
  contentPlaintext?: string;
  editorMode?: "standard" | "ai_enhanced" | "simple" | "notion";
  sourceType?: "user_manual" | "ai_generated" | "managebac_sync";
  createdAtOffsetMs?: number;
};

type DemoPlannerBlueprint = {
  title: string;
  description?: string;
  type?: "deadline" | "milestone" | "goal" | "reminder";
  priority?: "low" | "medium" | "high";
  status?: "pending" | "in_progress" | "completed" | "cancelled";
  dueAtOffsetMs?: number;
  createdAtOffsetMs?: number;
};

type DemoThreadBlueprint = {
  title: string;
  createdAtOffsetMs?: number;
};

type DemoWorkspaceBlueprint = {
  title: string;
  emoji: string;
  type: "subject" | "project" | "general";
  description: string;
  artifacts: DemoArtifactBlueprint[];
  plannerItems: DemoPlannerBlueprint[];
  threads: DemoThreadBlueprint[];
};

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

const DEMO_WORKSPACE_BLUEPRINTS: DemoWorkspaceBlueprint[] = [
  {
    title: "Product Launch: Nova",
    emoji: "⚙️",
    type: "project",
    description:
      "Cross-functional launch workspace for Nova, a health wearable preparing for Q3 2026 release.",
    artifacts: [
      {
        type: "note",
        title: "Go-to-Market Strategy Brief",
        content:
          "Comprehensive GTM plan covering market positioning for Nova wearable, targeting health-conscious millennials 25-40. Key differentiators: 7-day battery, medical-grade SpO2, open API for third-party health apps. Launch window: Q3 2026 to align with back-to-school and fitness season.",
        createdAtOffsetMs: 45 * 1000,
      },
      {
        type: "document",
        title: "Competitive Landscape Analysis",
        content:
          "Deep dive into Whoop 4.0, Oura Ring Gen 3, Apple Watch Ultra 2 pricing tiers. SWOT analysis per competitor. Nova positioning: premium health-focused at mid-range price ($249 vs Whoop $336/yr). Market gap: no device under $300 offers continuous blood oxygen + skin temp + HRV with open developer API.",
        createdAtOffsetMs: 3 * MINUTE,
      },
      {
        type: "code_project",
        title: "Pricing Model: Sensitivity Analysis",
        content:
          "Python simulation of demand elasticity across price points $199-$349. Monte Carlo analysis with 10k iterations shows optimal price at $249 with 85% confidence interval for 50k units in first quarter. Includes break-even analysis at varying CAC scenarios.",
        createdAtOffsetMs: 6 * MINUTE,
      },
      {
        type: "visualization",
        title: "Investor Pitch Deck v4",
        content:
          "Series A deck: 18 slides covering traction (12.4k waitlist, 340 beta users, 92% retention at 8 weeks), market sizing ($34B wearable health by 2028), team (ex-Apple, ex-Fitbit), financial projections. Raising $8M for scaling manufacturing and hiring 15 engineers.",
        createdAtOffsetMs: 4 * MINUTE,
      },
      {
        type: "note",
        title: "Beta Feedback Synthesis",
        content:
          "Compiled feedback from 340 beta testers across 8 weeks. Top requests: sleep staging (67%), native Strava integration (54%), smaller form factor for women wrists (41%). Net Promoter Score: 72. Common praise: battery life, SpO2 accuracy, comfortable sleep tracking.",
        createdAtOffsetMs: 90 * 1000,
      },
      {
        type: "note",
        title: "Regulatory Compliance Checklist",
        content:
          "FCC Part 15 Class B certification, FDA 510(k) pre-submission for SpO2 medical claims, CE Marking under MDR for EU launch, California Prop 65 compliance. Legal review of health data privacy (HIPAA adjacency, not covered entity). Estimated timeline: 14 weeks for full certification.",
        createdAtOffsetMs: 2 * HOUR,
      },
    ],
    plannerItems: [
      {
        title: "Launch Campaign Assets Tracker",
        description:
          "Social media creative briefs, influencer partnership contracts, PR outreach list (TechCrunch, The Verge, Wired). Landing page copy drafts A/B tested. Email drip sequence: 5-part pre-launch teaser series targeting waitlist of 12,400 signups.",
        type: "milestone",
        priority: "high",
        status: "in_progress",
        dueAtOffsetMs: 16 * DAY,
      },
    ],
    threads: [{ title: "Beta Feedback Synthesis", createdAtOffsetMs: 90 * 1000 }],
  },
  {
    title: "CS 301: Algorithms",
    emoji: "👨‍💻",
    type: "subject",
    description:
      "Semester workspace for algorithms and data structures with lecture material, study support, and assignments.",
    artifacts: [
      {
        type: "note",
        title: "Lecture Notes: Graph Traversal",
        content:
          "BFS vs DFS tradeoffs for different graph types. Dijkstra with priority queue optimization O((V+E)log V). A* search with admissible heuristics. Problem set 7: implement bidirectional BFS for social network shortest path on a graph with 10M nodes.",
        createdAtOffsetMs: 2 * MINUTE,
      },
      {
        type: "flashcard_deck",
        title: "Dynamic Programming Patterns",
        content:
          "5 core DP patterns: linear (fibonacci, LIS), grid (unique paths, min cost path), interval (matrix chain, burst balloons), tree (diameter, max path sum), and subset (0/1 knapsack, partition equal subset). Each pattern with 3-4 LeetCode-style problems ranked easy to hard.",
        createdAtOffsetMs: 10 * MINUTE,
      },
      {
        type: "code_project",
        title: "Red-Black Tree Implementation",
        content:
          "Complete RBT implementation in C++ with insert, delete, search, and range queries. Includes rotation helpers, fixup procedures, and comprehensive test suite with 200+ edge cases. Benchmarked against std::map on 1M random operations.",
        createdAtOffsetMs: 30 * MINUTE,
      },
      {
        type: "visualization",
        title: "Algorithm Complexity Cheat Sheet",
        content:
          "Visual reference card: sorting algorithms (comparison, non-comparison, hybrid), graph algorithms (spanning tree, shortest path, flow), string algorithms (KMP, Rabin-Karp, suffix array), and data structure operation costs. Space-time tradeoffs for each category.",
        createdAtOffsetMs: HOUR,
      },
      {
        type: "note",
        title: "Problem Set 6: Solutions",
        content:
          "Full worked solutions for PS6: Q1 greedy interval scheduling proof by exchange argument, Q2 Huffman coding with tiebreaking rules, Q3 union-find with both path compression and union by rank proving inverse Ackermann bound, Q4 designing a data structure for dynamic order statistics.",
        createdAtOffsetMs: 2 * HOUR,
      },
    ],
    plannerItems: [
      {
        title: "Assignment Deadlines & Exam Schedule",
        description: "Track PS7, project checkpoint, office hours, and the midterm review session.",
        type: "deadline",
        priority: "high",
        status: "pending",
        dueAtOffsetMs: 9 * DAY,
      },
    ],
    threads: [{ title: "Study Group: Midterm Prep Thread", createdAtOffsetMs: 5 * MINUTE }],
  },
  {
    title: "Personal Finance 2026",
    emoji: "💰",
    type: "general",
    description:
      "Personal operating workspace for budgeting, taxes, investing, and major financial decisions.",
    artifacts: [
      {
        type: "note",
        title: "Monthly Budget Tracker: April",
        content:
          "Income: $6,800 salary + $420 freelance design. Expenses: rent $1,850, groceries $380 (down 12% from March with meal prep), transport $95, subscriptions $47, dining out $210, fitness $65. Savings rate: 38.2%. Emergency fund now at 5.2 months expenses.",
        createdAtOffsetMs: MINUTE,
      },
      {
        type: "note",
        title: "Investment Portfolio Rebalancing",
        content:
          "Current allocation: 72% VTI (US total market), 18% VXUS (international), 10% BND (bonds). Target: 65/25/10. Need to sell $4.2k VTI and buy VXUS. Tax-loss harvesting opportunity: sell VTSAX lot from Nov 2024 at -$680 loss, redirect to VFIAX. Rebalance by April 30.",
        createdAtOffsetMs: 5 * MINUTE,
      },
      {
        type: "document",
        title: "Tax Filing Preparation 2025",
        content:
          "W-2 from employer, 1099-NEC from freelance ($5,040 total), 1099-DIV from brokerage. Deductions: home office (simplified method $5/sqft x 120sqft), student loan interest $2,400, traditional IRA contribution $6,500. Estimated refund: $1,840. Filing deadline: April 15, 2026.",
        createdAtOffsetMs: 20 * MINUTE,
      },
      {
        type: "code_project",
        title: "Savings Goal Simulator",
        content:
          "Interactive Python model projecting savings trajectories. Scenarios: conservative (4% real return), moderate (7%), aggressive (10%). Monte Carlo simulation for retirement age probability. Current trajectory: FIRE at age 47 with 85% confidence at 6% savings rate increase per year.",
        createdAtOffsetMs: 4 * HOUR,
      },
    ],
    plannerItems: [
      {
        title: "Financial Milestones & Goals",
        description: "Emergency fund, tax filing, rebalancing, and home-buying decision checkpoints.",
        type: "goal",
        priority: "medium",
        status: "in_progress",
        dueAtOffsetMs: 30 * DAY,
      },
    ],
    threads: [{ title: "Apartment Lease Renewal Decision", createdAtOffsetMs: 3 * MINUTE }],
  },
  {
    title: "Screenplay: Last Frequency",
    emoji: "🎬",
    type: "project",
    description:
      "Creative development workspace for a science-fiction screenplay spanning treatment, scenes, dialogue, and pitch.",
    artifacts: [
      {
        type: "note",
        title: "Act I: The Signal — Treatment",
        content:
          "Dr. Maren Cole, radio astronomer at Arecibo II, detects a repeating signal at 1.42 GHz with embedded mathematical structure — prime number sequence modulated into carrier wave. Her supervisor dismisses it as pulsar interference. She secretly continues analysis, discovering the signal contains a self-referencing data format: a Rosetta Stone that teaches its own decoding protocol. Setup ends when she realizes the signal is not arriving from space — it is originating from 847 meters beneath the observatory.",
        createdAtOffsetMs: 3 * MINUTE,
      },
      {
        type: "note",
        title: "Character Bible",
        content:
          "MAREN COLE (38): Brilliant but marginalized. Published breakthrough paper at 26, then blacklisted for claiming anomalous signals were structured. Obsessive, dry humor, terrible at personal relationships. Key wound: her mother, also a scientist, died in a lab accident Maren believes was covered up. JONAS OSEI (42): Geologist turned government liaison. Pragmatic, loyal to institutions. The reveal: he has been monitoring the same signal for 11 years.",
        createdAtOffsetMs: 10 * MINUTE,
      },
      {
        type: "note",
        title: "World-Building: Arecibo II",
        content:
          "Technical specifications of the fictional observatory. Located in same karst terrain as original Arecibo. Upgraded with quantum-enhanced receivers, deep borehole sensor array, and a SETI-dedicated compute cluster. The underground anomaly: a natural limestone chamber with crystalline formations that function as a resonant cavity at exactly 1.42 GHz — the hydrogen line frequency. Geological impossibility or engineered?",
        createdAtOffsetMs: 2 * HOUR,
      },
      {
        type: "visualization",
        title: "Pitch Deck: Visual References",
        content:
          "Mood board compiled from: Arrival (Villeneuve) for tone, Contact (Zemeckis) for scientific authenticity, Annihilation (Garland) for the descent metaphor, Underwater (Eubank) for claustrophobic tension. Color palette: deep teal and amber. Key visual: the signal visualized as interference patterns on water — ripples that spell out equations.",
        createdAtOffsetMs: 24 * MINUTE,
      },
    ],
    plannerItems: [
      {
        title: "Scene Breakdown: Full Script",
        description:
          "87 scenes across 3 acts. Act I (scenes 1-28): Discovery and denial. Act II (scenes 29-62): Descent and confrontation. Act III (scenes 63-87): Contact and choice.",
        type: "milestone",
        priority: "high",
        status: "in_progress",
        dueAtOffsetMs: 21 * DAY,
      },
    ],
    threads: [{ title: "Dialogue Workshop: Maren & Jonas", createdAtOffsetMs: 90 * 1000 }],
  },
];

type DbCtx = Pick<MutationCtx, "db">;

async function requireActor(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

async function findExistingBlueprintWorkstream(
  ctx: DbCtx,
  actor: { _id: Id<"users">; orgId: Id<"orgs"> },
  title: string,
) {
  const existing = await ctx.db
    .query("workstreams")
    .withIndex("by_owner_updated", (q) => q.eq("ownerUserId", actor._id))
    .collect();
  return existing.find((row) => row.orgId === actor.orgId && row.title === title) ?? null;
}

async function createArtifact(
  ctx: DbCtx,
  params: {
    ownerUserId: Id<"users">;
    orgId: Id<"orgs">;
    workstreamId: Id<"workstreams">;
    blueprint: DemoArtifactBlueprint;
    now: number;
  },
) {
  const createdAt = params.now - (params.blueprint.createdAtOffsetMs ?? 0);
  await ctx.db.insert("artifacts", {
    ownerUserId: params.ownerUserId,
    orgId: params.orgId,
    workstreamId: params.workstreamId,
    type: params.blueprint.type,
    title: params.blueprint.title,
    content: params.blueprint.content,
    contentPlaintext: params.blueprint.contentPlaintext ?? params.blueprint.content,
    editorMode: params.blueprint.editorMode,
    sourceType: params.blueprint.sourceType ?? "user_manual",
    status: "active",
    createdAt,
    updatedAt: createdAt,
  });
}

async function createPlannerItem(
  ctx: DbCtx,
  params: {
    ownerUserId: Id<"users">;
    orgId: Id<"orgs">;
    workstreamId: Id<"workstreams">;
    blueprint: DemoPlannerBlueprint;
    now: number;
  },
) {
  const createdAt = params.now - (params.blueprint.createdAtOffsetMs ?? 0);
  await ctx.db.insert("plannerItems", {
    ownerUserId: params.ownerUserId,
    orgId: params.orgId,
    workstreamId: params.workstreamId,
    title: params.blueprint.title,
    description: params.blueprint.description,
    type: params.blueprint.type ?? "deadline",
    priority: params.blueprint.priority ?? "medium",
    status: params.blueprint.status ?? "pending",
    dueAt:
      typeof params.blueprint.dueAtOffsetMs === "number"
        ? params.now + params.blueprint.dueAtOffsetMs
        : undefined,
    completedAt: params.blueprint.status === "completed" ? params.now : undefined,
    sourceType: "user_manual",
    createdAt,
    updatedAt: createdAt,
  });
}

async function createThread(
  ctx: DbCtx,
  params: {
    ownerUserId: Id<"users">;
    orgId: Id<"orgs">;
    workstreamId: Id<"workstreams">;
    blueprint: DemoThreadBlueprint;
    now: number;
  },
) {
  const createdAt = params.now - (params.blueprint.createdAtOffsetMs ?? 0);
  await ctx.db.insert("chats", {
    orgId: params.orgId,
    workstreamId: params.workstreamId,
    ownerUserId: params.ownerUserId,
    title: params.blueprint.title,
    threadType: "conversation",
    mode: "general",
    thinkingLevel: "low",
    routerMode: "auto",
    usePersonalResources: true,
    messageCount: 0,
    createdAt,
    updatedAt: createdAt,
  });
}

export const seedRichDemoWorkspaces = mutation({
  args: {
    actorClerkId: v.string(),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActor(ctx, args.actorClerkId);
    const now = Date.now();
    const createdWorkstreamIds: Id<"workstreams">[] = [];
    const skippedTitles: string[] = [];

    for (const blueprint of DEMO_WORKSPACE_BLUEPRINTS) {
      const existing = await findExistingBlueprintWorkstream(ctx, actor, blueprint.title);
      if (existing && !args.force) {
        skippedTitles.push(blueprint.title);
        continue;
      }

      const workstreamId =
        existing?._id ??
        (await ctx.db.insert("workstreams", {
          ownerUserId: actor._id,
          orgId: actor.orgId,
          type: blueprint.type,
          title: blueprint.title,
          description: blueprint.description,
          emoji: blueprint.emoji,
          status: "active",
          artifactCount: blueprint.artifacts.length,
          threadCount: blueprint.threads.length,
          lastActivityAt: now,
          workspaceRevision: now,
          workspaceRevisionKey: `seed:${blueprint.title}:${now}`,
          createdAt: now,
          updatedAt: now,
        }));

      if (existing && args.force) {
        skippedTitles.push(blueprint.title);
        continue;
      }

      for (const artifact of blueprint.artifacts) {
        await createArtifact(ctx, {
          ownerUserId: actor._id,
          orgId: actor.orgId,
          workstreamId,
          blueprint: artifact,
          now,
        });
      }

      for (const plannerItem of blueprint.plannerItems) {
        await createPlannerItem(ctx, {
          ownerUserId: actor._id,
          orgId: actor.orgId,
          workstreamId,
          blueprint: plannerItem,
          now,
        });
      }

      for (const thread of blueprint.threads) {
        await createThread(ctx, {
          ownerUserId: actor._id,
          orgId: actor.orgId,
          workstreamId,
          blueprint: thread,
          now,
        });
      }

      createdWorkstreamIds.push(workstreamId);
    }

    return {
      createdCount: createdWorkstreamIds.length,
      createdWorkstreamIds,
      skippedTitles,
      templates: DEMO_WORKSPACE_BLUEPRINTS.map((workspace) => ({
        title: workspace.title,
        emoji: workspace.emoji,
        artifacts: workspace.artifacts.length,
        plannerItems: workspace.plannerItems.length,
        threads: workspace.threads.length,
      })),
    };
  },
});
