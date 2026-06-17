import { mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  buildArtifactTextIndex,
  defaultArtifactContent,
  fallbackArtifactSummary,
  requireSpectraActor,
  type BlueprintKey,
} from "./spectraShared";

const demoArtifacts: Array<{
  blueprintKey: BlueprintKey;
  title: string;
  summary: string;
  tags: string[];
  placed: boolean;
}> = [
  {
    blueprintKey: "document",
    title: "Cell respiration notes",
    summary: "Glycolysis, Krebs cycle, and oxidative phosphorylation outline.",
    tags: ["biology", "respiration"],
    placed: true,
  },
  {
    blueprintKey: "flashcard_deck",
    title: "Biology midterm deck",
    summary: "42 review cards across enzymes, membranes, genetics, and respiration.",
    tags: ["biology", "review"],
    placed: true,
  },
  {
    blueprintKey: "quiz",
    title: "Respiration check",
    summary: "12 mixed questions with short answer and multiple choice.",
    tags: ["biology", "quiz"],
    placed: true,
  },
  {
    blueprintKey: "planner_task",
    title: "Review Chapter 7",
    summary: "Finish notes and convert weak areas into one deck.",
    tags: ["task"],
    placed: true,
  },
  {
    blueprintKey: "thread_reference",
    title: "Photosynthesis comparison",
    summary: "Pinned conversation with linked notes and follow-up questions.",
    tags: ["thread"],
    placed: true,
  },
  {
    blueprintKey: "document",
    title: "Essay feedback summary",
    summary: "Chat-created writing notes waiting to be placed.",
    tags: ["inbox", "writing"],
    placed: false,
  },
];

export const ensureDemoData = mutation({
  args: {
    actorClerkId: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireSpectraActor(ctx, args.actorClerkId);
    const existingWorkspace = await ctx.db
      .query("spectraWorkspaces")
      .withIndex("by_owner_status", (q) => q.eq("ownerUserId", actor._id).eq("status", "active"))
      .first();
    if (existingWorkspace) {
      return { created: false, workspaceId: existingWorkspace._id };
    }

    const now = Date.now();
    const workspaceId = await ctx.db.insert("spectraWorkspaces", {
      ownerUserId: actor._id,
      orgId: actor.orgId,
      title: "Biology",
      description: "Exam preparation, revision artifacts, and thread references.",
      icon: "Microscope",
      color: "cyan",
      status: "active",
      defaultView: "cards",
      createdAt: now,
      updatedAt: now,
      lastActivityAt: now,
    });

    let placedCount = 0;
    for (const demo of demoArtifacts) {
      const artifactId = await ctx.db.insert("spectraArtifacts", {
        ownerUserId: actor._id,
        orgId: actor.orgId,
        blueprintKey: demo.blueprintKey,
        title: demo.title,
        summary: demo.summary || fallbackArtifactSummary(demo.blueprintKey),
        content: defaultArtifactContent(demo.blueprintKey),
        textIndex: buildArtifactTextIndex({
          title: demo.title,
          summary: demo.summary,
          tags: demo.tags,
        }),
        tags: demo.tags,
        status: "active",
        createdFrom: {
          source: demo.placed ? "workspace" : "chat",
          workspaceId: demo.placed ? workspaceId : undefined,
        },
        createdAt: now,
        updatedAt: now,
      });

      if (demo.placed) {
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
          },
          createdAt: now + placedCount,
          updatedAt: now + placedCount,
        });
      }
    }

    return { created: true, workspaceId, artifactCount: demoArtifacts.length, workspaceItemCount: placedCount };
  },
});

