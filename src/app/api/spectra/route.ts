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

async function optionalSpectraQuery<TArgs extends object, TResult>(
  functionName: string,
  args: TArgs,
  fallback: TResult,
) {
  try {
    return await spectraQuery<TArgs, TResult>(functionName, args);
  } catch (error) {
    if (isFunctionPathNotFound(error)) return fallback;
    throw error;
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
      const workspace = await spectraQuery("spectraWorkspaceItems:listForWorkspacePublic", {
        actorClerkId: actor.clerkId,
        workspaceId,
      });
      if (!workspace) return badRequest("Workspace not found");
      return ok({ workspace });
    }

    if (action === "resultCards") {
      const resultCards = await optionalSpectraQuery("spectraRuns:listResultCards", {
        actorClerkId: actor.clerkId,
        surface: params.get("surface") ?? undefined,
        workspaceId: params.get("workspaceId") ?? undefined,
        artifactId: params.get("artifactId") ?? undefined,
        includeHidden: params.get("includeHidden") === "true",
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      }, []);
      return ok({ resultCards });
    }

    if (action === "runDetail") {
      const runId = requireString(params.get("runId"), "runId");
      const detail = await spectraQuery("spectraRuns:get", {
        actorClerkId: actor.clerkId,
        runId,
      });
      return ok(detail);
    }

    if (action === "artifactVersions") {
      const artifactId = requireString(params.get("artifactId"), "artifactId");
      const versions = await spectraQuery("spectraArtifacts:listVersions", { actorClerkId: actor.clerkId, artifactId, limit: params.has("limit") ? Number(params.get("limit")) : undefined });
      return ok({ versions });
    }

    if (action === "artifactLinks") {
      const artifactId = requireString(params.get("artifactId"), "artifactId");
      const links = await spectraQuery("spectraArtifactLinks:listForArtifact", { actorClerkId: actor.clerkId, artifactId, limit: 24 });
      return ok({ links });
    }

    if (action === "search") {
      const search = requireString(params.get("search"), "search").slice(0, 160);
      const [artifacts, workspaces] = await Promise.all([
        spectraQuery("spectraArtifacts:list", { actorClerkId: actor.clerkId, placement: "all", search, limit: 30 }),
        spectraQuery("spectraWorkspaces:list", { actorClerkId: actor.clerkId, includeArchived: false, limit: 60 }) as Promise<Array<{ title?: string; description?: string }>>,
      ]);
      const needle = search.toLowerCase();
      return ok({
        artifacts,
        workspaces: workspaces.filter((workspace) => `${workspace.title ?? ""} ${workspace.description ?? ""}`.toLowerCase().includes(needle)).slice(0, 12),
      });
    }

    if (action === "threads") {
      const threads = await spectraQuery("spectraThreads:list", {
        actorClerkId: actor.clerkId,
        includeArchived: params.get("includeArchived") === "true",
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      });
      return ok({ threads });
    }

    if (action === "thread") {
      const threadId = requireString(params.get("threadId"), "threadId");
      const thread = await spectraQuery("spectraThreads:get", { actorClerkId: actor.clerkId, threadId });
      return ok(thread);
    }

    if (action === "overview") {
      const workspaces = await spectraQuery("spectraWorkspaces:list", {
        actorClerkId: actor.clerkId,
        includeArchived: false,
        limit: 30,
      }) as Array<{ _id: string }>;
      const requestedWorkspaceId = params.get("workspaceId") ?? undefined;
      const workspace = requestedWorkspaceId
        ? await spectraQuery("spectraWorkspaceItems:listForWorkspacePublic", {
          actorClerkId: actor.clerkId,
          workspaceId: requestedWorkspaceId,
        })
        : null;
      const selectedWorkspaceId = workspace && typeof workspace === "object"
        ? String((workspace as { workspace: { _id: string } }).workspace._id)
        : undefined;
      const [artifacts, runs, resultCards] = await Promise.all([
        spectraQuery("spectraArtifacts:list", {
          actorClerkId: actor.clerkId,
          placement: "all",
          limit: 60,
        }),
        spectraQuery("spectraRuns:listRecent", {
          actorClerkId: actor.clerkId,
          limit: 12,
        }),
        optionalSpectraQuery("spectraRuns:listResultCards", {
          actorClerkId: actor.clerkId,
          workspaceId: selectedWorkspaceId,
          includeHidden: false,
          limit: 20,
        }, []),
      ]);
      return ok({
        actor,
        workspaces,
        selectedWorkspaceId: workspace ? selectedWorkspaceId : undefined,
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
      if (process.env.NODE_ENV === "production") {
        return ok({ created: false, skipped: "production" });
      }
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
        icon: optionalString(body.icon),
        color: optionalString(body.color),
      });
      return ok({ workspaceId });
    }

    if (action === "updateWorkspace") {
      const result = await spectraMutation("spectraWorkspaces:update", {
        actorClerkId: actor.clerkId,
        workspaceId: requireString(body.workspaceId, "workspaceId"),
        title: optionalString(body.title),
        description: optionalString(body.description),
        icon: optionalString(body.icon),
        color: optionalString(body.color),
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

    if (action === "deleteWorkspace") {
      const result = await spectraMutation("spectraWorkspaces:permanentlyDelete", {
        actorClerkId: actor.clerkId,
        workspaceId: requireString(body.workspaceId, "workspaceId"),
        confirmation: requireString(body.confirmation, "confirmation"),
      });
      return ok(result);
    }

    if (action === "createArtifact") {
      const requestedSource = optionalString(body.source);
      const source = requestedSource && ["chat", "workspace", "artifact", "manual", "ai"].includes(requestedSource)
        ? requestedSource
        : optionalString(body.workspaceId) ? "workspace" : "manual";
      const result = await spectraMutation("spectraArtifacts:create", {
        actorClerkId: actor.clerkId,
        blueprintKey: requireBlueprint(body.blueprintKey),
        title: requireString(body.title, "title"),
        summary: optionalString(body.summary),
        content: body.content,
        tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
        workspaceId: optionalString(body.workspaceId),
        source,
      });
      return ok(result);
    }

    if (action === "updateArtifact") {
      const requestedEditSource = optionalString(body.source);
      const editSource = requestedEditSource && ["manual", "ai", "revert"].includes(requestedEditSource) ? requestedEditSource : "manual";
      const result = await spectraMutation("spectraArtifacts:update", {
        actorClerkId: actor.clerkId,
        artifactId: requireString(body.artifactId, "artifactId"),
        title: optionalString(body.title),
        summary: optionalString(body.summary),
        content: body.content,
        tags: Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
        source: editSource,
        runId: optionalString(body.runId),
      });
      return ok(result);
    }

    if (action === "revertArtifactVersion") {
      const result = await spectraMutation("spectraArtifacts:revertVersion", {
        actorClerkId: actor.clerkId,
        artifactId: requireString(body.artifactId, "artifactId"),
        versionId: requireString(body.versionId, "versionId"),
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

    if (action === "deleteArtifact") {
      const result = await spectraMutation("spectraArtifacts:permanentlyDelete", {
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

    if (action === "setWorkspaceItemPinned") {
      const result = await spectraMutation("spectraWorkspaceItems:setPinned", {
        actorClerkId: actor.clerkId,
        workspaceItemId: requireString(body.workspaceItemId, "workspaceItemId"),
        pinned: body.pinned === true,
      });
      return ok(result);
    }

    if (action === "createArtifactLink") {
      const result = await spectraMutation("spectraArtifactLinks:create", {
        actorClerkId: actor.clerkId,
        sourceArtifactId: requireString(body.sourceArtifactId, "sourceArtifactId"),
        targetArtifactId: requireString(body.targetArtifactId, "targetArtifactId"),
        relationType: optionalString(body.relationType) ?? "related",
        label: optionalString(body.label),
        explanation: optionalString(body.explanation),
        workspaceId: optionalString(body.workspaceId),
        createdBy: "user",
      });
      return ok(result);
    }

    if (action === "removeArtifactLink") {
      const result = await spectraMutation("spectraArtifactLinks:remove", {
        actorClerkId: actor.clerkId,
        linkId: requireString(body.linkId, "linkId"),
      });
      return ok(result);
    }

    if (action === "hideResultCard") {
      const result = await spectraMutation("spectraRuns:hideResultCard", {
        actorClerkId: actor.clerkId,
        resultCardId: requireString(body.resultCardId, "resultCardId"),
      });
      return ok(result);
    }

    if (action === "keepResultCard") {
      const result = await spectraMutation("spectraRuns:keepResultCard", {
        actorClerkId: actor.clerkId,
        resultCardId: requireString(body.resultCardId, "resultCardId"),
      });
      return ok(result);
    }

    if (action === "createThread") {
      const threadId = await spectraMutation("spectraThreads:create", {
        actorClerkId: actor.clerkId,
        title: optionalString(body.title),
        origin: optionalString(body.origin) ?? "chat",
        workspaceId: optionalString(body.workspaceId),
        artifactId: optionalString(body.artifactId),
      });
      return ok({ threadId });
    }

    if (action === "updateThread") {
      const result = await spectraMutation("spectraThreads:update", {
        actorClerkId: actor.clerkId,
        threadId: requireString(body.threadId, "threadId"),
        title: optionalString(body.title),
        pinned: typeof body.pinned === "boolean" ? body.pinned : undefined,
        workspaceId: optionalString(body.workspaceId),
        status: optionalString(body.status),
      });
      return ok(result);
    }

    if (action === "keepRunAsThread") {
      const localMessages = Array.isArray(body.localMessages) ? body.localMessages.slice(0, 60).flatMap((message) => {
        if (!message || typeof message !== "object") return [];
        const row = message as Record<string, unknown>;
        if ((row.role !== "user" && row.role !== "assistant") || typeof row.id !== "string" || typeof row.content !== "string" || typeof row.createdAt !== "number") return [];
        return [{ id: row.id, role: row.role, content: row.content, runId: optionalString(row.runId), createdAt: row.createdAt }];
      }) : undefined;
      const result = await spectraMutation("spectraThreads:createFromRun", {
        actorClerkId: actor.clerkId,
        runId: requireString(body.runId, "runId"),
        placeInWorkspace: body.placeInWorkspace === true,
        createReference: body.createReference !== false,
        localMessages,
      });
      return ok(result);
    }

    if (action === "addThreadToWorkspace") {
      const kept = await spectraMutation("spectraThreads:createFromRun", {
        actorClerkId: actor.clerkId,
        runId: requireString(body.runId, "runId"),
        placeInWorkspace: true,
        createReference: true,
      });
      return ok(kept);
    }

    return badRequest("Unknown Spectra action");
  }, request);
}
