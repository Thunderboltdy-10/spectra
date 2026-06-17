import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

const BLUEPRINTS = new Set(["document", "thread_reference", "flashcard_deck", "quiz", "planner_task"]);

function withJsExtension(functionName: string) {
  const [moduleName, exportName] = functionName.split(":");
  if (!moduleName || !exportName || moduleName.endsWith(".js")) return functionName;
  return `${moduleName}.js:${exportName}`;
}

function isFunctionPathNotFound(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("FunctionPathNotFound") || message.includes("Could not find public function");
}

async function spectraQuery<TArgs extends object, TResult>(functionName: string, args: TArgs) {
  try {
    return await convexQuery<TArgs, TResult>(functionName, args);
  } catch (error) {
    if (!isFunctionPathNotFound(error)) throw error;
    return convexQuery<TArgs, TResult>(withJsExtension(functionName), args);
  }
}

async function spectraMutation<TArgs extends object, TResult>(functionName: string, args: TArgs) {
  try {
    return await convexMutation<TArgs, TResult>(functionName, args);
  } catch (error) {
    if (!isFunctionPathNotFound(error)) throw error;
    return convexMutation<TArgs, TResult>(withJsExtension(functionName), args);
  }
}

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
      const workspaces = await spectraQuery("spectraWorkspaces:list", {
        actorClerkId: actor.clerkId,
        includeArchived: params.get("includeArchived") === "true",
      });
      return ok({ workspaces });
    }

    if (action === "artifacts") {
      const artifacts = await spectraQuery("spectraArtifacts:list", {
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
      const workspace = await spectraQuery("spectraWorkspaceItems:listForWorkspace", {
        actorClerkId: actor.clerkId,
        workspaceId,
      });
      return ok({ workspace });
    }

    if (action === "overview") {
      const workspaces = await spectraQuery("spectraWorkspaces:list", {
        actorClerkId: actor.clerkId,
        includeArchived: false,
        limit: 30,
      }) as Array<{ _id: string }>;
      const requestedWorkspaceId = params.get("workspaceId") ?? undefined;
      const selectedWorkspaceId = requestedWorkspaceId ?? workspaces[0]?._id;
      const [workspace, artifacts, runs, resultCards] = await Promise.all([
        selectedWorkspaceId
          ? spectraQuery("spectraWorkspaceItems:listForWorkspace", {
            actorClerkId: actor.clerkId,
            workspaceId: selectedWorkspaceId,
          })
          : Promise.resolve(null),
        spectraQuery("spectraArtifacts:list", {
          actorClerkId: actor.clerkId,
          placement: "all",
          limit: 100,
        }),
        spectraQuery("spectraRuns:listRecent", {
          actorClerkId: actor.clerkId,
          limit: 12,
        }),
        selectedWorkspaceId
          ? spectraQuery("spectraRuns:listResultCards", {
            actorClerkId: actor.clerkId,
            workspaceId: selectedWorkspaceId,
            limit: 8,
          })
          : Promise.resolve([]),
      ]);
      return ok({
        actor,
        workspaces,
        selectedWorkspaceId,
        workspace,
        artifacts,
        runs,
        resultCards,
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
      const result = await spectraMutation("spectraSeed:ensureDemoData", {
        actorClerkId: actor.clerkId,
      });
      return ok(result);
    }

    if (action === "createWorkspace") {
      const workspaceId = await spectraMutation("spectraWorkspaces:create", {
        actorClerkId: actor.clerkId,
        title: requireString(body.title, "title"),
        description: optionalString(body.description),
      });
      return ok({ workspaceId });
    }

    if (action === "updateWorkspace") {
      const result = await spectraMutation("spectraWorkspaces:update", {
        actorClerkId: actor.clerkId,
        workspaceId: requireString(body.workspaceId, "workspaceId"),
        title: optionalString(body.title),
        description: optionalString(body.description),
        defaultView: optionalString(body.defaultView),
      });
      return ok(result);
    }

    if (action === "archiveWorkspace") {
      const result = await spectraMutation("spectraWorkspaces:archive", {
        actorClerkId: actor.clerkId,
        workspaceId: requireString(body.workspaceId, "workspaceId"),
      });
      return ok(result);
    }

    if (action === "createArtifact") {
      const result = await spectraMutation("spectraArtifacts:create", {
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
      const result = await spectraMutation("spectraArtifacts:update", {
        actorClerkId: actor.clerkId,
        artifactId: requireString(body.artifactId, "artifactId"),
        title: optionalString(body.title),
        summary: optionalString(body.summary),
        tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
      });
      return ok(result);
    }

    if (action === "archiveArtifact") {
      const result = await spectraMutation("spectraArtifacts:archive", {
        actorClerkId: actor.clerkId,
        artifactId: requireString(body.artifactId, "artifactId"),
      });
      return ok(result);
    }

    if (action === "addArtifactToWorkspace") {
      const result = await spectraMutation("spectraWorkspaceItems:addArtifact", {
        actorClerkId: actor.clerkId,
        workspaceId: requireString(body.workspaceId, "workspaceId"),
        artifactId: requireString(body.artifactId, "artifactId"),
      });
      return ok(result);
    }

    if (action === "hideWorkspaceItem") {
      const result = await spectraMutation("spectraWorkspaceItems:hide", {
        actorClerkId: actor.clerkId,
        workspaceItemId: requireString(body.workspaceItemId, "workspaceItemId"),
      });
      return ok(result);
    }

    return badRequest("Unknown Spectra action");
  }, request);
}
