import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { safeStudyMode, type StudyMode } from "@/types";

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const search = request.nextUrl.searchParams.get("search")?.trim();
    const category = request.nextUrl.searchParams.get("category")?.trim() || undefined;

    if (search) {
      const agents = await convexQuery("agents:searchAgents", {
        actorClerkId: actor.clerkId,
        query: search,
      });
      return ok({ agents });
    }

    const agents = await convexQuery("agents:listAgents", {
      actorClerkId: actor.clerkId,
      category,
    });

    return ok({ agents });
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json()) as {
      name?: string;
      description?: string;
      subjectArea?: string;
      gradeLevel?: string;
      systemPrompt?: string;
      avatarEmoji?: string;
      avatarIcon?: string;
      category?: string;
      preferredModel?: string;
      preferredMode?: StudyMode;
      allowedTools?: string[];
      modelAllowlist?: string[];
      modelDenylist?: string[];
      accessLevel?: "private" | "class" | "school";
      moderationStatus?: "approved" | "pending";
      guidelinesSummary?: string;
      guidelinesTopicMap?: string[];
      guidelinesRubricHints?: string[];
      guidelinesMisconceptions?: string[];
      guidelinesVocabulary?: string[];
      guidelinesExamStructure?: string[];
      resourceIds?: string[];
      visibility?: "public" | "private" | "shared";
    };

    if (!body.name || !body.description || !body.systemPrompt || !body.category) {
      return badRequest("name, description, systemPrompt and category are required");
    }

    const validMode = body.preferredMode ? safeStudyMode(body.preferredMode, "POST /api/agents") : undefined;

    const result = await convexMutation("agents:createAgent", {
      actorClerkId: actor.clerkId,
      name: body.name,
      description: body.description,
      subjectArea: body.subjectArea,
      gradeLevel: body.gradeLevel,
      systemPrompt: body.systemPrompt,
      avatarEmoji: body.avatarEmoji,
      avatarIcon: body.avatarIcon,
      category: body.category,
      preferredModel: body.preferredModel,
      preferredMode: validMode,
      allowedTools: body.allowedTools,
      modelAllowlist: body.modelAllowlist,
      modelDenylist: body.modelDenylist,
      accessLevel: body.accessLevel,
      moderationStatus: body.moderationStatus,
      guidelinesSummary: body.guidelinesSummary,
      guidelinesTopicMap: body.guidelinesTopicMap,
      guidelinesRubricHints: body.guidelinesRubricHints,
      guidelinesMisconceptions: body.guidelinesMisconceptions,
      guidelinesVocabulary: body.guidelinesVocabulary,
      guidelinesExamStructure: body.guidelinesExamStructure,
      visibility: body.visibility ?? "public",
    });

    const resourceIds = Array.isArray(body.resourceIds)
      ? body.resourceIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : [];
    if (resourceIds.length > 0) {
      await convexMutation("resources:assignResourcesToAgent", {
        actorClerkId: actor.clerkId,
        agentId: result.agentId,
        resourceIds,
      });
    }

    return ok(result);
  });
}
