import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

const BLUEPRINTS = new Set(["document", "thread_reference", "flashcard_deck", "quiz", "planner_task"]);

function requireString(value: unknown, name: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requireBlueprint(value: unknown) {
  const blueprint = requireString(value, "blueprintKey");
  if (!BLUEPRINTS.has(blueprint)) {
    throw new Error("Invalid blueprintKey");
  }
  return blueprint;
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const params = request.nextUrl.searchParams;
    const action = params.get("action") ?? "overview";

    if (action === "workspaces") {
      const workspaces = await convexQuery("spectraWorkspaces:list", {
        actorClerkId: actor.clerkId,
        includeArchived: params.get("includeArchived") === "true",
      });
      return ok({ workspaces });
    }

    if (action === "artifacts") {
      const artifacts = await convexQuery("spectraArtifacts:list", {
        actorClerkId: actor.clerkId,
        status: params.get("status") ?? undefined,
        blueprintKey: params.get("blueprintKey") ?? undefined,
        placement: params.get("placement") ?? "all",
        search: params.get("search") ?? undefined,
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      });
      return ok({ artifacts });
    }

    if (action === "workspace") {
      const workspaceId = params.get("workspaceId");
      if (!workspaceId) return badRequest("workspaceId is required");
      const workspace = await convexQuery("spectraWorkspaceItems:listForWorkspace", {
        actorClerkId: actor.clerkId,
        workspaceId,
      });
      return ok({ workspace });
    }

    if (action === "overview") {
      const workspaces = await convexQuery("spectraWorkspaces:list", {
        actorClerkId: actor.clerkId,
        includeArchived: false,
        limit: 30,
      }) as Array<{ _id: string }>;
      const requestedWorkspaceId = params.get("workspaceId") ?? undefined;
      const selectedWorkspaceId = requestedWorkspaceId ?? workspaces[0]?._id;
      const [workspace, artifacts, runs] = await Promise.all([
        selectedWorkspaceId
          ? convexQuery("spectraWorkspaceItems:listForWorkspace", {
            actorClerkId: actor.clerkId,
            workspaceId: selectedWorkspaceId,
          })
          : Promise.resolve(null),
        convexQuery("spectraArtifacts:list", {
          actorClerkId: actor.clerkId,
          placement: "all",
          limit: 100,
        }),
        convexQuery("spectraRuns:listRecent", {
          actorClerkId: actor.clerkId,
          limit: 12,
        }),
      ]);
      return ok({
        actor,
        workspaces,
        selectedWorkspaceId,
        workspace,
        artifacts,
        runs,
      });
    }

    return badRequest("Unknown Spectra action");
  }, request);
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = await request.json() as Record<string, unknown>;
    const action = requireString(body.action, "action");

    if (action === "seed") {
      const result = await convexMutation("spectraSeed:ensureDemoData", {
        actorClerkId: actor.clerkId,
      });
      return ok(result);
    }

    if (action === "createWorkspace") {
      const workspaceId = await convexMutation("spectraWorkspaces:create", {
        actorClerkId: actor.clerkId,
        title: requireString(body.title, "title"),
        description: optionalString(body.description),
      });
      return ok({ workspaceId });
    }

    if (action === "updateWorkspace") {
      const result = await convexMutation("spectraWorkspaces:update", {
        actorClerkId: actor.clerkId,
        workspaceId: requireString(body.workspaceId, "workspaceId"),
        title: optionalString(body.title),
        description: optionalString(body.description),
        defaultView: optionalString(body.defaultView),
      });
      return ok(result);
    }

    if (action === "archiveWorkspace") {
      const result = await convexMutation("spectraWorkspaces:archive", {
        actorClerkId: actor.clerkId,
        workspaceId: requireString(body.workspaceId, "workspaceId"),
      });
      return ok(result);
    }

    if (action === "createArtifact") {
      const result = await convexMutation("spectraArtifacts:create", {
        actorClerkId: actor.clerkId,
        blueprintKey: requireBlueprint(body.blueprintKey),
        title: requireString(body.title, "title"),
        summary: optionalString(body.summary),
        workspaceId: optionalString(body.workspaceId),
        source: optionalString(body.workspaceId) ? "workspace" : "manual",
      });
      return ok(result);
    }

    if (action === "updateArtifact") {
      const result = await convexMutation("spectraArtifacts:update", {
        actorClerkId: actor.clerkId,
        artifactId: requireString(body.artifactId, "artifactId"),
        title: optionalString(body.title),
        summary: optionalString(body.summary),
        tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
      });
      return ok(result);
    }

    if (action === "archiveArtifact") {
      const result = await convexMutation("spectraArtifacts:archive", {
        actorClerkId: actor.clerkId,
        artifactId: requireString(body.artifactId, "artifactId"),
      });
      return ok(result);
    }

    if (action === "addArtifactToWorkspace") {
      const result = await convexMutation("spectraWorkspaceItems:addArtifact", {
        actorClerkId: actor.clerkId,
        workspaceId: requireString(body.workspaceId, "workspaceId"),
        artifactId: requireString(body.artifactId, "artifactId"),
      });
      return ok(result);
    }

    if (action === "hideWorkspaceItem") {
      const result = await convexMutation("spectraWorkspaceItems:hide", {
        actorClerkId: actor.clerkId,
        workspaceItemId: requireString(body.workspaceItemId, "workspaceItemId"),
      });
      return ok(result);
    }

    return badRequest("Unknown Spectra action");
  }, request);
}

