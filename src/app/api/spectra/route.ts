import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { snapshotArtifactRegions, type ArtifactLiveValue } from "@/features/spectra/collaboration/artifact-yjs-model";
import { ARTIFACT_TYPE_KEYS, type ArtifactTypeKey } from "@/features/spectra/artifacts/types";
import { parseModelOperation } from "@/features/spectra/operations/schema";

const BLUEPRINTS = new Set(["document", "flashcard_deck", "quiz", "planner_task", "agent", "timetable", "presentation", "sheets", "code", "whiteboard"]);
const RESOURCE_TYPES = new Set(["workspace", "artifact", "agent"]);

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
	    const label = name === "workspaceId"
	      ? "Choose a workspace first."
	      : name === "artifactId"
	        ? "Choose a document or artifact first."
	        : name === "threadId"
	          ? "Choose a thread first."
	          : name === "action"
	            ? "Choose an available Spectra action."
	          : "A required selection is missing.";
    throw new Error(label);
  }
  return value.trim();
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requireBlueprint(value: unknown) {
	  const blueprint = requireString(value, "blueprintKey");
	  if (!BLUEPRINTS.has(blueprint)) {
	    throw new Error("Choose a supported artifact type.");
	  }
  return blueprint;
}

function requireResourceType(value: unknown) {
  const type = requireString(value, "resourceType");
  if (!RESOURCE_TYPES.has(type)) throw new Error("Choose a shareable Spectra item.");
  return type;
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const params = request.nextUrl.searchParams;
    const action = params.get("action") ?? "overview";

    if (action === "workspaces") {
      const workspaces = await spectraQuery("spectraWorkspaces:list", {
        includeArchived: params.get("includeArchived") === "true",
      });
      return ok({ workspaces });
    }

    if (action === "artifacts") {
      const artifacts = await spectraQuery("spectraArtifacts:list", {
        status: params.get("status") ?? undefined,
        blueprintKey: params.get("blueprintKey") ?? undefined,
        placement: params.get("placement") ?? "all",
        search: params.get("search") ?? undefined,
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      });
      return ok({ artifacts });
    }

    if (action === "shareInvitations") {
      const invitations = await spectraQuery("authority:listIncomingInvitations", {});
      return ok({ invitations });
    }

    if (action === "schoolMembers") {
      const members = await spectraQuery("memberships:searchSchoolMembers", {
        search: params.get("search") ?? "",
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      });
      return ok({ members });
    }

    if (action === "shareState") {
      const shares = await spectraQuery("authority:shareState", {
        resourceType: requireResourceType(params.get("resourceType")),
        resourceId: requireString(params.get("resourceId"), "resourceId"),
      });
      return ok({ shares });
    }

    if (action === "regionClaims") {
      const claims = await spectraQuery("regionClaims:listForArtifact", {
        artifactId: requireString(params.get("artifactId"), "artifactId"),
        includeResolved: params.get("includeResolved") === "true",
      });
      return ok({ claims });
    }

    if (action === "artifactComments") {
      const comments = await spectraQuery("artifactComments:list", {
        artifactId: requireString(params.get("artifactId"), "artifactId"),
        includeResolved: params.get("includeResolved") === "true",
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      });
      return ok({ comments });
    }

    if (action === "artifactCommentPreference") {
      const preference = await spectraQuery("artifactComments:notificationPreference", {
        artifactId: requireString(params.get("artifactId"), "artifactId"),
      });
      return ok(preference);
    }

    if (action === "artifactCommentNotifications") {
      const notifications = await spectraQuery("artifactComments:listNotifications", {
        unreadOnly: params.get("unreadOnly") === "true",
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      });
      return ok({ notifications });
    }

    if (action === "artifact") {
      const artifactId = requireString(params.get("artifactId"), "artifactId");
      const artifact = await spectraQuery("spectraArtifacts:get", { artifactId });
      return ok({ artifact });
    }

    if (action === "workspace") {
      const workspaceId = params.get("workspaceId");
      if (!workspaceId) return badRequest("Choose a workspace first.");
      const workspace = await spectraQuery("spectraWorkspaceItems:listForWorkspacePublic", {
        workspaceId,
      });
      if (!workspace) return badRequest("Workspace not found");
      return ok({ workspace });
    }

    if (action === "resultCards") {
      const resultCards = await optionalSpectraQuery("spectraRuns:listResultCards", {
        surface: params.get("surface") ?? undefined,
        workspaceId: params.get("workspaceId") ?? undefined,
        artifactId: params.get("artifactId") ?? undefined,
        includeHidden: params.get("includeHidden") === "true",
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      }, []);
      return ok({ resultCards });
    }

    if (action === "runTabs") {
      const runTabs = await spectraQuery("spectraRuns:listTabs", {
        includeHidden: params.get("includeHidden") === "true",
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      });
      return ok({ runTabs });
    }

    if (action === "runEvents") {
      const runId = requireString(params.get("runId"), "runId");
      const events = await spectraQuery("spectraRuns:listEvents", { runId, after: params.has("after") ? Number(params.get("after")) : undefined });
      return ok({ events });
    }

    if (action === "runDetail") {
      const runId = requireString(params.get("runId"), "runId");
      const detail = await spectraQuery("spectraRuns:get", {
        runId,
      });
      return ok(detail);
    }

    if (action === "operationConflict") {
      const conflict = await spectraQuery("spectraOperations:conflictForOperation", {
        operationId: requireString(params.get("operationId"), "operationId"),
      }) as {
        artifactType: string;
        conflict: { regionId: string; baseSnapshot?: unknown };
        currentSnapshot: ArtifactLiveValue;
      } & Record<string, unknown>;
      const typeKey = (ARTIFACT_TYPE_KEYS as readonly string[]).includes(conflict.artifactType)
        ? conflict.artifactType as ArtifactTypeKey
        : null;
      const capturedRegions = conflict.conflict.baseSnapshot && typeof conflict.conflict.baseSnapshot === "object"
        ? (conflict.conflict.baseSnapshot as { regions?: unknown }).regions
        : null;
      const regionIds = Array.isArray(capturedRegions)
        ? capturedRegions.flatMap((region) => region && typeof region === "object" && typeof (region as { regionId?: unknown }).regionId === "string" ? [(region as { regionId: string }).regionId] : [])
        : [conflict.conflict.regionId];
      return ok({
        conflict: {
          ...conflict,
          currentSnapshot: typeKey
            ? snapshotArtifactRegions(typeKey, conflict.currentSnapshot, regionIds)
            : conflict.currentSnapshot,
        },
      });
    }

    if (action === "artifactVersions") {
      const artifactId = requireString(params.get("artifactId"), "artifactId");
      const versions = await spectraQuery("spectraArtifacts:listVersions", { artifactId, limit: params.has("limit") ? Number(params.get("limit")) : undefined });
      return ok({ versions });
    }

    if (action === "artifactLinks") {
      const artifactId = requireString(params.get("artifactId"), "artifactId");
      const links = await spectraQuery("spectraArtifactLinks:listForArtifact", { artifactId, limit: 24 });
      return ok({ links });
    }

    if (action === "artifactEmbeds") {
      const embeds = await spectraQuery("artifactEmbeds:listForContainer", {
        containerType: params.get("containerType") === "thread" ? "thread" : "artifact",
        containerId: requireString(params.get("containerId"), "containerId"),
      });
      return ok({ embeds });
    }

    if (action === "artifactEmbed") {
      const embed = await spectraQuery("artifactEmbeds:getProjection", {
        embedId: requireString(params.get("embedId"), "embedId"),
      });
      return ok({ embed });
    }

    if (action === "artifactEmbedContext") {
      const context = await spectraQuery("artifactEmbeds:contextContribution", {
        embedId: requireString(params.get("embedId"), "embedId"),
      });
      return ok({ context });
    }

    if (action === "search") {
      const search = requireString(params.get("search"), "search").slice(0, 160);
      const [artifacts, workspaces] = await Promise.all([
        spectraQuery("spectraArtifacts:list", { placement: "all", search, limit: 30 }),
        spectraQuery("spectraWorkspaces:list", { includeArchived: false, limit: 60 }) as Promise<Array<{ title?: string; description?: string }>>,
      ]);
      const needle = search.toLowerCase();
      return ok({
        artifacts,
        workspaces: workspaces.filter((workspace) => `${workspace.title ?? ""} ${workspace.description ?? ""}`.toLowerCase().includes(needle)).slice(0, 12),
      });
    }

    if (action === "threads") {
      const threads = await spectraQuery("spectraThreads:list", {
        includeArchived: params.get("includeArchived") === "true",
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      });
      return ok({ threads });
    }

    if (action === "thread") {
      const threadId = requireString(params.get("threadId"), "threadId");
      const thread = await spectraQuery("spectraThreads:get", { threadId });
      return ok(thread);
    }

    if (action === "overview") {
      const workspaces = await spectraQuery("spectraWorkspaces:list", {
        includeArchived: false,
        limit: 30,
      }) as Array<{ _id: string }>;
      const requestedWorkspaceId = params.get("workspaceId") ?? undefined;
      const workspace = requestedWorkspaceId
        ? await spectraQuery("spectraWorkspaceItems:listForWorkspacePublic", {
          workspaceId: requestedWorkspaceId,
        })
        : null;
      const selectedWorkspaceId = workspace && typeof workspace === "object"
        ? String((workspace as { workspace: { _id: string } }).workspace._id)
        : undefined;
      const [artifacts, runs, resultCards] = await Promise.all([
        spectraQuery("spectraArtifacts:list", {
          placement: "all",
          limit: 60,
        }),
        spectraQuery("spectraRuns:listRecent", {
          limit: 12,
        }),
        optionalSpectraQuery("spectraRuns:listResultCards", {
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

	    return badRequest("That Spectra action is not available.");
  }, request);
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = await request.json() as Record<string, unknown>;
    const action = requireString(body.action, "action");

    if (action === "hideRunTab") {
      const result = await spectraMutation("spectraRuns:hideTab", { runId: requireString(body.runId, "runId") });
      return ok(result);
    }

    if (action === "selectRunTab") {
      const result = await spectraMutation("spectraRuns:selectTab", { runId: optionalString(body.runId) });
      return ok(result);
    }

    if (action === "selectMessageChoice") {
      const result = await spectraMutation("spectraThreads:selectMessageChoice", {
        messageId: requireString(body.messageId, "messageId"),
        choiceKey: requireString(body.choiceKey, "choiceKey"),
        choiceTitle: requireString(body.choiceTitle, "choiceTitle"),
      });
      return ok(result);
    }

    if (action === "createWorkspace") {
      const workspaceId = await spectraMutation("spectraWorkspaces:create", {
        title: requireString(body.title, "title"),
        description: optionalString(body.description),
        icon: optionalString(body.icon),
        color: optionalString(body.color),
      });
      return ok({ workspaceId });
    }

    if (action === "inviteShare") {
      const result = await spectraMutation("authority:invite", {
        resourceType: requireResourceType(body.resourceType),
        resourceId: requireString(body.resourceId, "resourceId"),
        inviteeAccountId: requireString(body.inviteeAccountId, "inviteeAccountId"),
        level: body.level === "modify" ? "modify" : "read",
        message: optionalString(body.message),
        expiresAt: typeof body.expiresAt === "number" ? body.expiresAt : undefined,
      });
      return ok(result);
    }

    if (action === "acceptShareInvitation") {
      const result = await spectraMutation("authority:acceptShareInvitation", {
        invitationId: requireString(body.invitationId, "invitationId"),
      });
      return ok(result);
    }

    if (action === "declineShareInvitation") {
      const result = await spectraMutation("authority:declineShareInvitation", {
        invitationId: requireString(body.invitationId, "invitationId"),
      });
      return ok(result);
    }

    if (action === "changeShareLevel") {
      const result = await spectraMutation("authority:changeAcceptedLevel", {
        invitationId: requireString(body.invitationId, "invitationId"),
        level: body.level === "modify" ? "modify" : "read",
      });
      return ok(result);
    }

    if (action === "revokeShareAccess") {
      const result = await spectraMutation("authority:revoke", {
        resourceType: requireResourceType(body.resourceType),
        resourceId: requireString(body.resourceId, "resourceId"),
        grantId: requireString(body.grantId, "grantId"),
      });
      return ok(result);
    }

    if (action === "revokePendingShareInvitation") {
      const result = await spectraMutation("authority:revokePendingInvitation", {
        invitationId: requireString(body.invitationId, "invitationId"),
      });
      return ok(result);
    }

    if (action === "createArtifactComment") {
      const mentionedAccountIds = Array.isArray(body.mentionedAccountIds)
        ? body.mentionedAccountIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
      const result = await spectraMutation("artifactComments:create", {
        artifactId: requireString(body.artifactId, "artifactId"),
        parentCommentId: optionalString(body.parentCommentId),
        body: requireString(body.commentBody, "commentBody"),
        anchor: {
          regionId: requireString(body.regionId, "regionId"),
          fallbackExcerpt: optionalString(body.fallbackExcerpt),
          geometry: body.geometry && typeof body.geometry === "object" ? body.geometry : undefined,
        },
        mentionedAccountIds,
      });
      return ok(result);
    }

    if (action === "updateArtifactComment") {
      const result = await spectraMutation("artifactComments:updateBody", {
        commentId: requireString(body.commentId, "commentId"),
        body: requireString(body.commentBody, "commentBody"),
      });
      return ok(result);
    }

    if (action === "setArtifactCommentResolved") {
      const result = await spectraMutation("artifactComments:setResolved", {
        commentId: requireString(body.commentId, "commentId"),
        resolved: body.resolved === true,
      });
      return ok(result);
    }

    if (action === "reanchorArtifactComment") {
      const result = await spectraMutation("artifactComments:reanchor", {
        commentId: requireString(body.commentId, "commentId"),
        anchor: {
          regionId: requireString(body.regionId, "regionId"),
          fallbackExcerpt: optionalString(body.fallbackExcerpt),
          geometry: body.geometry && typeof body.geometry === "object" ? body.geometry : undefined,
        },
      });
      return ok(result);
    }

    if (action === "removeArtifactComment") {
      const result = await spectraMutation("artifactComments:remove", {
        commentId: requireString(body.commentId, "commentId"),
      });
      return ok(result);
    }

    if (action === "setArtifactCommentPreference") {
      const mode = requireString(body.mode, "mode");
      if (!["all", "mentions_replies", "off"].includes(mode)) throw new Error("Choose a valid comment notification preference.");
      const result = await spectraMutation("artifactComments:setNotificationPreference", {
        artifactId: requireString(body.artifactId, "artifactId"),
        mode,
      });
      return ok(result);
    }

    if (action === "markArtifactCommentNotificationsRead") {
      const notificationIds = Array.isArray(body.notificationIds)
        ? body.notificationIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [];
      const result = await spectraMutation("artifactComments:markNotificationsRead", { notificationIds });
      return ok(result);
    }

    if (action === "createArtifactEmbed") {
      const result = await spectraMutation("artifactEmbeds:create", {
        containerType: body.containerType === "thread" ? "thread" : "artifact",
        containerId: requireString(body.containerId, "containerId"),
        containerRegionId: requireString(body.containerRegionId, "containerRegionId"),
        sourceArtifactId: requireString(body.sourceArtifactId, "sourceArtifactId"),
        mode: body.mode === "expanded" ? "expanded" : "compact",
        interaction: body.interaction === "edit" ? "edit" : body.interaction === "interact" ? "interact" : "read",
        versionPolicy: body.versionPolicy === "pinned" ? "pinned" : "live",
        pinnedVersionId: optionalString(body.pinnedVersionId),
        displayPreferences: body.displayPreferences && typeof body.displayPreferences === "object" ? body.displayPreferences : undefined,
        contextPolicy: body.contextPolicy === "none" ? "none" : body.contextPolicy === "visible_region" ? "visible_region" : "summary",
      });
      return ok(result);
    }

    if (action === "updateArtifactEmbed") {
      const result = await spectraMutation("artifactEmbeds:update", {
        embedId: requireString(body.embedId, "embedId"),
        mode: body.mode === "compact" || body.mode === "expanded" ? body.mode : undefined,
        interaction: body.interaction === "read" || body.interaction === "interact" || body.interaction === "edit" ? body.interaction : undefined,
        versionPolicy: body.versionPolicy === "live" || body.versionPolicy === "pinned" ? body.versionPolicy : undefined,
        pinnedVersionId: optionalString(body.pinnedVersionId),
        displayPreferences: body.displayPreferences && typeof body.displayPreferences === "object" ? body.displayPreferences : undefined,
        contextPolicy: body.contextPolicy === "none" || body.contextPolicy === "summary" || body.contextPolicy === "visible_region" ? body.contextPolicy : undefined,
      });
      return ok(result);
    }

    if (action === "removeArtifactEmbed") {
      const result = await spectraMutation("artifactEmbeds:remove", {
        embedId: requireString(body.embedId, "embedId"),
      });
      return ok(result);
    }

    if (action === "acquireRegionClaim") {
      const overlapDomains = Array.isArray(body.overlapDomains) ? body.overlapDomains.filter((value): value is string => typeof value === "string") : [];
      const result = await spectraMutation("regionClaims:acquire", {
        artifactId: requireString(body.artifactId, "artifactId"),
        partitionKey: optionalString(body.partitionKey),
        clientId: requireString(body.clientId, "clientId"),
        regionId: requireString(body.regionId, "regionId"),
        overlapDomains,
        baseStateVectorHash: requireString(body.baseStateVectorHash, "baseStateVectorHash"),
        actorKind: "human",
      });
      return ok(result);
    }

    if (action === "renewRegionClaim") {
      const result = await spectraMutation("regionClaims:renew", {
        claimId: requireString(body.claimId, "claimId"),
        clientId: requireString(body.clientId, "clientId"),
        baseStateVectorHash: optionalString(body.baseStateVectorHash),
      });
      return ok(result);
    }

    if (action === "releaseRegionClaim") {
      const result = await spectraMutation("regionClaims:release", {
        claimId: requireString(body.claimId, "claimId"),
        clientId: requireString(body.clientId, "clientId"),
        resolution: ["apply", "keep_current", "merge", "cancel"].includes(String(body.resolution)) ? body.resolution : undefined,
      });
      return ok(result);
    }

    if (action === "resolveRegionConflict") {
      const resolution = requireString(body.resolution, "resolution");
      if (!["apply", "keep_current", "merge", "cancel"].includes(resolution)) throw new Error("Choose a valid conflict resolution.");
      const result = await spectraMutation("regionClaims:resolveConflict", {
        claimId: requireString(body.claimId, "claimId"),
        clientId: requireString(body.clientId, "clientId"),
        resolution,
        newBaseStateVectorHash: optionalString(body.newBaseStateVectorHash),
      });
      return ok(result);
    }

    if (action === "resolveAiArtifactConflict") {
      const operationId = requireString(body.operationId, "operationId");
      const resolution = requireString(body.resolution, "resolution");
      if (!["apply", "keep_current", "merge", "cancel"].includes(resolution)) throw new Error("Choose a valid conflict resolution.");
      const detail = await spectraQuery("spectraOperations:conflictForOperation", { operationId }) as {
        executionId?: string;
        operationType: string;
        input: unknown;
        conflict: { claimId: string; clientId: string };
        currentStateVectorHash: string;
      };
      if (!detail.executionId) throw new Error("REGION_CONFLICT_RUN_STALE");
      let mergedInput: unknown;
      if (resolution === "merge") {
        const merged = parseModelOperation({ type: detail.operationType, input: body.mergedInput });
        if (merged.type !== "artifact.update" || !detail.input || typeof detail.input !== "object" || Array.isArray(detail.input)) {
          throw new Error("Only artifact edits can be merged in this conflict view.");
        }
        const original = detail.input as { artifactId?: unknown; blueprintKey?: unknown };
        if (merged.input.artifactId !== original.artifactId || merged.input.blueprintKey !== original.blueprintKey) {
          throw new Error("A merged edit cannot change its target artifact or artifact type.");
        }
        mergedInput = merged.input;
      }
      const result = await spectraMutation("spectraOperations:resumeAfterRegionConflict", {
        operationId,
        executionId: detail.executionId,
        resolution,
        mergedInput,
        newBaseStateVectorHash: resolution === "apply" || resolution === "merge" ? detail.currentStateVectorHash : undefined,
      });
      return ok(result);
    }

    if (action === "updateWorkspace") {
      const result = await spectraMutation("spectraWorkspaces:update", {
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
        workspaceId: requireString(body.workspaceId, "workspaceId"),
      });
      return ok(result);
    }

    if (action === "deleteWorkspace") {
      const result = await spectraMutation("spectraWorkspaces:permanentlyDelete", {
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

    if (action === "commitArtifactRestore") {
      const result = await spectraMutation("changeGroups:commitRestore", {
        artifactId: requireString(body.artifactId, "artifactId"),
        sourceVersionId: requireString(body.sourceVersionId, "sourceVersionId"),
      });
      return ok(result);
    }

    if (action === "archiveArtifact") {
      const result = await spectraMutation("spectraArtifacts:archive", {
        artifactId: requireString(body.artifactId, "artifactId"),
      });
      return ok(result);
    }

    if (action === "deleteArtifact") {
      const result = await spectraMutation("spectraArtifacts:permanentlyDelete", {
        artifactId: requireString(body.artifactId, "artifactId"),
      });
      return ok(result);
    }

    if (action === "addArtifactToWorkspace") {
      const result = await spectraMutation("spectraWorkspaceItems:addArtifact", {
        workspaceId: requireString(body.workspaceId, "workspaceId"),
        artifactId: requireString(body.artifactId, "artifactId"),
      });
      return ok(result);
    }

    if (action === "moveArtifactToWorkspace") {
      const artifactId = requireString(body.artifactId, "artifactId");
      const workspaceId = requireString(body.workspaceId, "workspaceId");
      const artifact = await spectraQuery("spectraArtifacts:get", { artifactId }) as { placements?: Array<{ workspaceId?: string; workspaceItemId?: string }> };
      const result = await spectraMutation("spectraWorkspaceItems:addArtifact", { workspaceId, artifactId });
      await Promise.all((artifact.placements ?? [])
        .filter((placement) => placement.workspaceId !== workspaceId && typeof placement.workspaceItemId === "string")
        .map((placement) => spectraMutation("spectraWorkspaceItems:hide", { workspaceItemId: placement.workspaceItemId! })));
      return ok(result);
    }

    if (action === "moveArtifactToInbox") {
      const artifactId = requireString(body.artifactId, "artifactId");
      const artifact = await spectraQuery("spectraArtifacts:get", { artifactId }) as { placements?: Array<{ workspaceItemId?: string }> };
      const hidden = await Promise.all((artifact.placements ?? [])
        .filter((placement) => typeof placement.workspaceItemId === "string")
        .map((placement) => spectraMutation("spectraWorkspaceItems:hide", { workspaceItemId: placement.workspaceItemId! })));
      return ok({ artifactId, hidden });
    }

    if (action === "hideWorkspaceItem") {
      const result = await spectraMutation("spectraWorkspaceItems:hide", {
        workspaceItemId: requireString(body.workspaceItemId, "workspaceItemId"),
      });
      return ok(result);
    }

    if (action === "setWorkspaceItemPinned") {
      const result = await spectraMutation("spectraWorkspaceItems:setPinned", {
        workspaceItemId: requireString(body.workspaceItemId, "workspaceItemId"),
        pinned: body.pinned === true,
      });
      return ok(result);
    }

    if (action === "createArtifactLink") {
      const result = await spectraMutation("spectraArtifactLinks:create", {
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
        linkId: requireString(body.linkId, "linkId"),
      });
      return ok(result);
    }

    if (action === "hideResultCard") {
      const result = await spectraMutation("spectraRuns:hideResultCard", {
        resultCardId: requireString(body.resultCardId, "resultCardId"),
      });
      return ok(result);
    }

    if (action === "keepResultCard") {
      const result = await spectraMutation("spectraRuns:keepResultCard", {
        resultCardId: requireString(body.resultCardId, "resultCardId"),
      });
      return ok(result);
    }

    if (action === "createThread") {
      const threadId = await spectraMutation("spectraThreads:create", {
        title: optionalString(body.title),
        origin: optionalString(body.origin) ?? "chat",
        workspaceId: optionalString(body.workspaceId),
        artifactId: optionalString(body.artifactId),
      });
      return ok({ threadId });
    }

    if (action === "updateThread") {
      const result = await spectraMutation("spectraThreads:update", {
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
        runId: requireString(body.runId, "runId"),
        placeInWorkspace: body.placeInWorkspace === true,
        createReference: body.createReference !== false,
        localMessages,
      });
      return ok(result);
    }

    if (action === "addThreadToWorkspace") {
      const kept = await spectraMutation("spectraThreads:createFromRun", {
        runId: requireString(body.runId, "runId"),
        placeInWorkspace: true,
        createReference: true,
      });
      return ok(kept);
    }

	    return badRequest("That Spectra action is not available.");
  }, request);
}
