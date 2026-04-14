import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getUserByClerkId } from "./helpers";

type WorkspaceTemplateSuggestion = {
  id: string;
  label: string;
  description: string;
  viewMode: "byType" | "byTopic" | "timeline";
  backgroundMode: "dots" | "blank" | "grid";
  groups: Array<{
    id: string;
    label: string;
    kinds: string[];
  }>;
  starterActions: string[];
};

const TEMPLATE_LIBRARY: Array<{
  id: string;
  keywords: string[];
  subjectCodes: string[];
  template: WorkspaceTemplateSuggestion;
}> = [
  {
    id: "physics-course",
    keywords: ["physics", "waves", "mechanics", "electricity", "ia", "hl", "sl"],
    subjectCodes: ["physics"],
    template: {
      id: "physics-course",
      label: "Physics course",
      description: "Artifacts, threads, and planner scaffolding for a concept-heavy science workspace.",
      viewMode: "byType",
      backgroundMode: "dots",
      groups: [
        { id: "notes", label: "Concept notes", kinds: ["note", "visual", "code"] },
        { id: "practice", label: "Practice + review", kinds: ["quiz", "flashcard_deck", "thread"] },
        { id: "planning", label: "Deadlines + IA", kinds: ["planner", "export"] },
      ],
      starterActions: [
        "Create a note for the current topic",
        "Create a planner item for the next assessment",
        "Generate a quiz from recent notes",
      ],
    },
  },
  {
    id: "essay-project",
    keywords: ["essay", "tok", "english", "history", "paper", "draft"],
    subjectCodes: ["english", "history", "tok"],
    template: {
      id: "essay-project",
      label: "Essay project",
      description: "A writing-focused workspace with research, draft, and submission flow.",
      viewMode: "byType",
      backgroundMode: "blank",
      groups: [
        { id: "research", label: "Research", kinds: ["thread", "note", "visual"] },
        { id: "drafts", label: "Drafts", kinds: ["note", "export"] },
        { id: "submission", label: "Submission plan", kinds: ["planner", "export"] },
      ],
      starterActions: [
        "Create a research note",
        "Create a planner item for the next draft milestone",
        "Open a thread for argument refinement",
      ],
    },
  },
  {
    id: "coding-project",
    keywords: ["code", "coding", "computer", "cs", "programming", "app", "project"],
    subjectCodes: ["computer_science", "cs"],
    template: {
      id: "coding-project",
      label: "Coding project",
      description: "Code-first workspace with implementation, debugging, and output lanes.",
      viewMode: "byType",
      backgroundMode: "grid",
      groups: [
        { id: "implementation", label: "Implementation", kinds: ["code", "note"] },
        { id: "debug", label: "Threads + fixes", kinds: ["thread", "planner"] },
        { id: "output", label: "Output + exports", kinds: ["visual", "export"] },
      ],
      starterActions: [
        "Create a code artifact",
        "Create a debugging thread",
        "Create a planner task for the next milestone",
      ],
    },
  },
];

async function requireActor(ctx: Parameters<typeof getUserByClerkId>[0], actorClerkId: string) {
  const actor = await getUserByClerkId(ctx, actorClerkId);
  if (!actor) throw new Error("Unauthorized");
  return actor;
}

function normalizeTitle(title: string) {
  return title.trim().toLowerCase();
}

function inferTemplate(title: string): WorkspaceTemplateSuggestion | null {
  const normalized = normalizeTitle(title);
  if (!normalized) return null;

  const best = TEMPLATE_LIBRARY
    .map((entry) => ({
      entry,
      score: entry.keywords.reduce((acc, keyword) => acc + (normalized.includes(keyword) ? 2 : 0), 0)
        + entry.subjectCodes.reduce((acc, code) => acc + (normalized.includes(code) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)[0];

  return best && best.score > 0 ? best.entry.template : null;
}

export const listTemplates = query({
  args: { actorClerkId: v.string() },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.actorClerkId);
    return TEMPLATE_LIBRARY.map((entry) => entry.template);
  },
});

export const suggestTemplate = mutation({
  args: { actorClerkId: v.string(), title: v.string() },
  handler: async (ctx, args) => {
    await requireActor(ctx, args.actorClerkId);
    return {
      title: args.title,
      suggestion: inferTemplate(args.title),
    };
  },
});
