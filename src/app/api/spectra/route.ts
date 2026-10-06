import { NextRequest } from "next/server";
import { createHash, randomBytes } from "crypto";
import { isAuthNoSchool, requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import {
  snapshotArtifactRegions,
  type ArtifactLiveValue,
} from "@/features/spectra/collaboration/artifact-yjs-model";
import {
  ARTIFACT_TYPE_KEYS,
  type ArtifactTypeKey,
} from "@/features/spectra/artifacts/types";
import { encodeArtifactContentForStorage } from "../../../../shared/sheet-cells";
import type { Id } from "../../../../convex/_generated/dataModel";

const BLUEPRINTS = new Set([
  "document",
  "flashcard_deck",
  "quiz",
  "planner_task",
  "agent",
  "timetable",
  "presentation",
  "sheets",
  "code",
  "whiteboard",
]);
const RESOURCE_TYPES = new Set(["workspace", "artifact", "agent"]);

function withJsExtension(functionName: string) {
  const [moduleName, exportName] = functionName.split(":");
  if (!moduleName || !exportName || moduleName.endsWith(".js"))
    return functionName;
  return `${moduleName}.js:${exportName}`;
}

function isFunctionPathNotFound(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("FunctionPathNotFound") ||
    message.includes("Could not find public function")
  );
}

async function spectraQuery<TArgs extends object, TResult>(
  functionName: string,
  args: TArgs,
) {
  try {
    return await convexQuery<TArgs, TResult>(functionName, args);
  } catch (error) {
    if (!isFunctionPathNotFound(error)) throw error;
    return convexQuery<TArgs, TResult>(withJsExtension(functionName), args);
  }
}

async function spectraMutation<TArgs extends object, TResult>(
  functionName: string,
  args: TArgs,
) {
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
    const label =
      name === "workspaceId"
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
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
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
  if (!RESOURCE_TYPES.has(type))
    throw new Error("Choose a shareable Spectra item.");
  return type;
}

function requireFlashcardRating(value: unknown) {
  const candidate = requireString(value, "rating");
  if (!["again", "hard", "good", "easy"].includes(candidate))
    throw new Error("Choose Again, Hard, Good, or Easy.");
  return candidate as "again" | "hard" | "good" | "easy";
}

function requireFlashcardDirection(value: unknown) {
  const candidate =
    value === undefined ? "forward" : requireString(value, "direction");
  if (candidate !== "forward" && candidate !== "reverse")
    throw new Error("Choose the front or reverse study direction.");
  return candidate;
}

function emptySchoolRead(action: string) {
  if (action === "bootstrap") return ok({ actor: null, needsSchool: true });
  if (["artifactPage", "workspacePage", "artifactGraphPage", "workspaceGraphPage", "agentGraphPage"].includes(action))
    return ok({ items: [], continueCursor: null, isDone: true, needsSchool: true });
  if (action === "overview") {
    return ok({
      actor: null,
      needsSchool: true,
      workspaces: [],
      selectedWorkspaceId: undefined,
      workspace: null,
      artifacts: [],
      runs: [],
      resultCards: [],
    });
  }
  if (action === "workspaces") return ok({ workspaces: [] });
  if (action === "artifacts") return ok({ artifacts: [] });
  if (action === "threads") return ok({ threads: [] });
  if (action === "shareInvitations") return ok({ invitations: [] });
  if (action === "notificationCenter")
    return ok({
      comments: [],
      planner: [],
      timetable: [],
      invitations: [],
    });
  if (action === "schoolMembers") return ok({ members: [] });
  if (action === "search") return ok({ artifacts: [], workspaces: [] });
  if (action === "resultCards") return ok({ resultCards: [] });
  if (action === "runTabs") return ok({ runTabs: [] });
  if (
    action === "timetableReminderNotifications" ||
    action === "plannerReminderNotifications" ||
    action === "artifactCommentNotifications"
  )
    return ok({ notifications: [] });
  throw new Error(
    "AUTH_NO_SCHOOL: This account does not have an active school membership.",
  );
}

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const params = request.nextUrl.searchParams;
    const action = params.get("action") ?? "overview";
    let actor;
    try {
      actor = await requireActor();
    } catch (error) {
      if (isAuthNoSchool(error)) return emptySchoolRead(action);
      throw error;
    }

    // Shell identity is independent of catalog, workspace contents and runs.
    // An unavailable collection must not prevent navigation or opening a file.
    if (action === "bootstrap") return ok({ actor, needsSchool: false });

    if (action === "workspaceMetadata") {
      return ok(await spectraQuery("catalogGraph:workspaceMetadata", {
        workspaceId: requireString(params.get("workspaceId"), "workspaceId"),
      }));
    }
    if (action === "agentGraphPage") return ok(await spectraQuery("catalogGraph:listAgents", {
      cursor: params.get("cursor") ?? undefined,
    }));
    if (action === "artifactGraphPage" || action === "workspaceGraphPage") {
      const limit = params.has("limit") ? Number(params.get("limit")) : undefined;
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 24))
        return badRequest("Choose a page size between 1 and 24.");
      const common = { cursor: params.get("cursor") ?? undefined, limit, search: params.get("search") ?? undefined };
      return ok(action === "workspaceGraphPage"
        ? await spectraQuery("catalogGraph:listWorkspaces", { ...common, includeArchived: params.get("includeArchived") === "true" })
        : await spectraQuery("catalogGraph:listArtifacts", { ...common, status: params.get("status") ?? undefined,
            blueprintKey: params.get("blueprintKey") ?? undefined, placement: params.get("placement") ?? "all" }));
    }

    if (action === "artifactPage" || action === "workspacePage") {
      const scope = params.get("scope") ?? "school";
      if (action === "artifactPage" && scope !== "school" && scope !== "owned")
        return badRequest("Choose Your work or the school catalog.");
      const limit = params.has("limit") ? Number(params.get("limit")) : undefined;
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
        return badRequest("Choose a positive whole-number page size.");
      const common = { limit, cursor: params.get("cursor") ?? undefined, search: params.get("search") ?? undefined };
      const page = action === "artifactPage"
        ? await spectraQuery("spectraArtifacts:listPage", { ...common,
            scope,
            status: params.get("status") ?? undefined,
            blueprintKey: params.get("blueprintKey") ?? undefined,
            placement: params.get("placement") ?? "all",
          })
        : await spectraQuery("spectraWorkspaces:listPage", { ...common, includeArchived: params.get("includeArchived") === "true" });
      return ok(page);
    }

    if (action === "workspaces") {
      const workspaces = await spectraQuery("spectraWorkspaces:list", {
        includeArchived: params.get("includeArchived") === "true",
      });
      return ok({ workspaces });
    }

    if (action === "exportWorkspaceManifest") {
      const result = await spectraQuery(
        "spectraWorkspaces:exportPortableManifest",
        {
          workspaceId: requireString(params.get("workspaceId"), "workspaceId"),
        },
      );
      return ok(result);
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

    if (action === "flashcardStudy") {
      const result = await spectraQuery("flashcardStudy:list", {
        artifactId: requireString(params.get("artifactId"), "artifactId"),
      });
      return ok(result);
    }

    if (action === "quizPracticeAttempts") {
      const result = await spectraQuery("quizPractice:listMine", {
        artifactId: requireString(params.get("artifactId"), "artifactId"),
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      });
      return ok({ attempts: result });
    }

    if (action === "quizResponseSummary") {
      const result = await spectraQuery("quizPractice:aggregateForOwner", {
        artifactId: requireString(params.get("artifactId"), "artifactId"),
      });
      return ok(result);
    }

    if (action === "artifactUserState") {
      const result = await spectraQuery("artifactUserStates:get", {
        artifactId: requireString(params.get("artifactId"), "artifactId"),
        kind: "timetable",
      });
      return ok(result);
    }

    if (action === "shareInvitations") {
      const invitations = await spectraQuery(
        "authority:listIncomingInvitations",
        {},
      );
      return ok({ invitations });
    }

    if (action === "notificationCenter") {
      const unreadOnly = params.get("unreadOnly") === "true";
      const limit = params.has("limit") ? Number(params.get("limit")) : 30;
      const center = await spectraQuery("notificationCenter:listMine", {
        unreadOnly,
        limit,
      });
      return ok(center);
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

    if (action === "publicLinks") {
      const publicLinks = await spectraQuery("authority:listPublicLinks", {
        resourceType: requireResourceType(params.get("resourceType")),
        resourceId: requireString(params.get("resourceId"), "resourceId"),
      });
      return ok({ publicLinks });
    }

    if (action === "artifactInheritedAudience") {
      const audience = await spectraQuery(
        "authority:artifactInheritedAudience",
        {
          artifactId: requireString(params.get("artifactId"), "artifactId"),
        },
      );
      return ok({ audience });
    }

    if (action === "artifactAccessRequests") {
      const requests = await spectraQuery(
        "artifactAccessRequests:listForSource",
        {
          sourceArtifactId: requireString(
            params.get("artifactId"),
            "artifactId",
          ),
        },
      );
      return ok({ requests });
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
      const preference = await spectraQuery(
        "artifactComments:notificationPreference",
        {
          artifactId: requireString(params.get("artifactId"), "artifactId"),
        },
      );
      return ok(preference);
    }

    if (action === "artifactCommentNotifications") {
      const notifications = await spectraQuery(
        "artifactComments:listNotifications",
        {
          unreadOnly: params.get("unreadOnly") === "true",
          limit: params.has("limit") ? Number(params.get("limit")) : undefined,
        },
      );
      return ok({ notifications });
    }

    if (action === "plannerReminderNotifications") {
      const notifications = await spectraQuery("plannerReminders:listMine", {
        unreadOnly: params.get("unreadOnly") === "true",
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      });
      return ok({ notifications });
    }

    if (action === "timetableReminderNotifications") {
      const notifications = await spectraQuery("timetableReminders:listMine", {
        unreadOnly: params.get("unreadOnly") === "true",
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      });
      return ok({ notifications });
    }

    if (action === "artifact") {
      const artifactId = requireString(params.get("artifactId"), "artifactId");
      const artifact = await spectraQuery("spectraArtifacts:get", {
        artifactId,
      });
      return ok({ artifact });
    }

    if (action === "workspace") {
      const workspaceId = params.get("workspaceId");
      if (!workspaceId) return badRequest("Choose a workspace first.");
      const workspace = await spectraQuery(
        "orgTree:listWorkspaceContentsPublic",
        {
          workspaceId,
          includeDetails: false,
        },
      );
      if (!workspace) return badRequest("Workspace not found");
      return ok({ workspace });
    }

    if (action === "resultCards") {
      const resultCards = await optionalSpectraQuery(
        "spectraRuns:listResultCards",
        {
          surface: params.get("surface") ?? undefined,
          workspaceId: params.get("workspaceId") ?? undefined,
          artifactId: params.get("artifactId") ?? undefined,
          includeHidden: params.get("includeHidden") === "true",
          limit: params.has("limit") ? Number(params.get("limit")) : undefined,
        },
        [],
      );
      return ok({ resultCards });
    }

    if (action === "runTabs") {
      const runTabs = await spectraQuery("spectraRuns:listTabs", {
        includeHidden: params.get("includeHidden") === "true",
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
        threadId: params.get("threadId") ?? undefined,
        workspaceId: params.get("workspaceId") ?? undefined,
        artifactId: params.get("artifactId") ?? undefined,
        surface: params.get("surface") ?? undefined,
      });
      return ok({ runTabs });
    }

    if (action === "runEvents") {
      const runId = requireString(params.get("runId"), "runId");
      const events = await spectraQuery("spectraRuns:listEvents", {
        runId,
        after: params.has("after") ? Number(params.get("after")) : undefined,
      });
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
      const conflict = (await spectraQuery(
        "spectraOperations:conflictForOperation",
        {
          operationId: requireString(params.get("operationId"), "operationId"),
        },
      )) as {
        artifactType: string;
        conflict: { regionId: string; baseSnapshot?: unknown };
        currentSnapshot: ArtifactLiveValue;
      } & Record<string, unknown>;
      const typeKey = (ARTIFACT_TYPE_KEYS as readonly string[]).includes(
        conflict.artifactType,
      )
        ? (conflict.artifactType as ArtifactTypeKey)
        : null;
      const capturedRegions =
        conflict.conflict.baseSnapshot &&
        typeof conflict.conflict.baseSnapshot === "object"
          ? (conflict.conflict.baseSnapshot as { regions?: unknown }).regions
          : null;
      const regionIds = Array.isArray(capturedRegions)
        ? capturedRegions.flatMap((region) =>
            region &&
            typeof region === "object" &&
            typeof (region as { regionId?: unknown }).regionId === "string"
              ? [(region as { regionId: string }).regionId]
              : [],
          )
        : [conflict.conflict.regionId];
      return ok({
        conflict: {
          ...conflict,
          currentSnapshot: typeKey
            ? snapshotArtifactRegions(
                typeKey,
                conflict.currentSnapshot,
                regionIds,
              )
            : conflict.currentSnapshot,
        },
      });
    }

    if (action === "artifactVersions") {
      const artifactId = requireString(params.get("artifactId"), "artifactId");
      const limit = params.has("limit") ? Number(params.get("limit")) : undefined;
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
        return badRequest("Choose a positive whole-number page size.");
      const page = await spectraQuery("spectraArtifacts:listVersions", {
        artifactId,
        limit,
        cursor: params.get("cursor") ?? undefined,
      });
      return ok(page);
    }

    if (action === "artifactVersion") {
      const version = await spectraQuery("spectraArtifacts:getVersion", {
        artifactId: requireString(params.get("artifactId"), "artifactId"),
        versionId: requireString(params.get("versionId"), "versionId"),
      });
      return ok({ version });
    }

    if (action === "agentReleases") {
      const agentId = requireString(params.get("agentId"), "agentId");
      const releases = await spectraQuery(
        "spectraArtifacts:listAgentReleases",
        {
          agentId,
        },
      );
      return ok({ releases });
    }

    if (action === "agentEvalRuns") {
      const agentId = requireString(params.get("agentId"), "agentId");
      const evaluation = await spectraQuery("agents:evalRuns", {
        agentId,
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      });
      return ok(evaluation);
    }

    if (action === "agentBench") {
      const agentId = requireString(params.get("agentId"), "agentId");
      const [cases, runs, release] = await Promise.all([
        spectraQuery("agents:benchCases", { agentId }),
        spectraQuery("agents:benchRuns", { agentId }),
        spectraQuery("spectraArtifacts:agentBenchRelease", { agentId }),
      ]);
      return ok({ cases, runs, release });
    }

    if (action === "agentResourceHealth") {
      const agentId = requireString(params.get("agentId"), "agentId");
      const resources = await spectraQuery(
        "spectraArtifacts:agentResourceHealth",
        { agentId },
      );
      return ok({ resources });
    }

    if (action === "agentAnalytics") {
      const agentId = requireString(params.get("agentId"), "agentId");
      const analytics = await spectraQuery("agents:analytics", { agentId });
      return ok({ analytics });
    }

    if (action === "installedAgents") {
      const agents = await spectraQuery(
        "spectraArtifacts:listInstalledAgents",
        {},
      );
      return ok({ agents });
    }

    if (action === "publicAgents") {
      const agents = await spectraQuery("spectraArtifacts:listPublicAgents", {
        search: params.get("search")?.trim() || undefined,
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      });
      return ok({ agents });
    }

    if (action === "artifactLinks") {
      const artifactId = requireString(params.get("artifactId"), "artifactId");
      const links = await spectraQuery("spectraArtifactLinks:listForArtifact", {
        artifactId,
        limit: 24,
      });
      return ok({ links });
    }

    if (action === "artifactEmbed") {
      const embed = await spectraQuery("artifactEmbeds:getProjection", {
        embedId: requireString(params.get("embedId"), "embedId"),
      });
      return ok({ embed });
    }

    if (action === "search") {
      const search = requireString(params.get("search"), "search").slice(
        0,
        160,
      );
      const [artifacts, workspaces] = await Promise.all([
        spectraQuery("spectraArtifacts:list", {
          placement: "all",
          search,
          limit: 30,
        }),
        spectraQuery("spectraWorkspaces:list", {
          includeArchived: false,
          limit: 60,
        }) as Promise<Array<{ title?: string; description?: string }>>,
      ]);
      const needle = search.toLowerCase();
      return ok({
        artifacts,
        workspaces: workspaces
          .filter((workspace) =>
            `${workspace.title ?? ""} ${workspace.description ?? ""}`
              .toLowerCase()
              .includes(needle),
          )
          .slice(0, 12),
      });
    }

    if (action === "threads") {
      const result = await spectraQuery("spectraThreads:list", {
        includeArchived: params.get("includeArchived") === "true",
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
        cursor: params.get("cursor") || undefined,
      });
      return ok(result);
    }

    if (action === "thread") {
      const threadId = requireString(params.get("threadId"), "threadId");
      const thread = await spectraQuery("spectraThreads:get", { threadId });
      return ok(thread);
    }

    if (action === "threadActiveExecution") {
      const threadId = requireString(params.get("threadId"), "threadId");
      const activeExecution = await spectraQuery("spectraThreads:getActiveExecution", { threadId });
      return ok({ activeExecution });
    }

    if (action === "threadMessages") {
      const threadId = requireString(params.get("threadId"), "threadId");
      const result = await spectraQuery<
        { threadId: string; before?: string | number; limit?: number },
        { messages: unknown[]; hasOlder: boolean; olderBefore?: string; nextCursor?: string | null }
      >("spectraThreads:listMessages", {
        threadId,
        before: params.get("before") || undefined,
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      });
      return ok(result);
    }

    if (action === "threadRunTrace") {
      const threadId = requireString(params.get("threadId"), "threadId");
      const runId = requireString(params.get("runId"), "runId");
      const result = await spectraQuery<
        {
          threadId: string;
          runId: string;
          family?: "operations" | "cards" | "events";
          eventAfter?: string | number;
          operationsBefore?: string;
          cardsBefore?: string;
          eventsCursor?: string;
          skipOperations?: boolean;
          skipCards?: boolean;
          skipEvents?: boolean;
          includeArtifacts?: boolean;
          limit?: number;
        },
        Record<string, unknown>
      >("spectraThreads:getRunTrace", {
        threadId,
        runId,
        family: (params.get("family") as "operations" | "cards" | "events" | null) || undefined,
        eventAfter: params.has("eventAfter")
          ? Number(params.get("eventAfter"))
          : undefined,
        operationsBefore: params.get("operationsBefore") || undefined,
        cardsBefore: params.get("cardsBefore") || undefined,
        eventsCursor: params.get("eventsCursor") || undefined,
        skipOperations: params.get("skipOperations") === "true" || undefined,
        skipCards: params.get("skipCards") === "true" || undefined,
        skipEvents: params.get("skipEvents") === "true" || undefined,
        includeArtifacts: params.get("includeArtifacts") === "true" || undefined,
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      });
      return ok(result);
    }

    if (action === "memory") {
      const result = await spectraQuery("memory:listMine", {
        search: params.get("search")?.trim() || undefined,
        status:
          params.get("status") &&
          ["proposed", "active", "disputed", "superseded", "expired"].includes(
            params.get("status")!,
          )
            ? params.get("status")
            : undefined,
        scope:
          params.get("scope") &&
          [
            "private_global",
            "private_school",
            "workspace",
            "shared_artifact",
            "system",
          ].includes(params.get("scope")!)
            ? params.get("scope")
            : undefined,
        claimType: optionalString(params.get("claimType")),
        limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      });
      return ok(result);
    }

    if (action === "memoryExport") {
      const result = await spectraQuery("memory:exportMine", {});
      return ok(result);
    }

    if (action === "overview") {
      const workspaces = (await spectraQuery("spectraWorkspaces:list", {
        includeArchived: false,
        limit: 30,
      })) as Array<{ _id: string }>;
      const requestedWorkspaceId = params.get("workspaceId") ?? undefined;
      const workspace = requestedWorkspaceId
        ? await spectraQuery("orgTree:listWorkspaceContentsPublic", {
            workspaceId: requestedWorkspaceId,
            includeDetails: false,
          })
        : null;
      const selectedWorkspaceId =
        workspace && typeof workspace === "object"
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
        optionalSpectraQuery(
          "spectraRuns:listResultCards",
          {
            workspaceId: selectedWorkspaceId,
            includeHidden: false,
            limit: 20,
          },
          [],
        ),
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
    const _actor = await requireActor({ fresh: true });
    const body = (await request.json()) as Record<string, unknown>;
    const action = requireString(body.action, "action");

    if (action === "hideRunTab") {
      const result = await spectraMutation("spectraRuns:hideTab", {
        runId: requireString(body.runId, "runId"),
      });
      return ok(result);
    }

    if (action === "updateMemoryPreferences") {
      const categoryControls =
        body.categoryControls &&
        typeof body.categoryControls === "object" &&
        !Array.isArray(body.categoryControls)
          ? body.categoryControls
          : undefined;
      const result = await spectraMutation("memory:updatePreferences", {
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        capturePaused:
          typeof body.capturePaused === "boolean"
            ? body.capturePaused
            : undefined,
        categoryControls,
        capsuleTargetTokens:
          typeof body.capsuleTargetTokens === "number" &&
          Number.isFinite(body.capsuleTargetTokens)
            ? body.capsuleTargetTokens
            : undefined,
      });
      return ok(result);
    }

    if (action === "rememberMemory") {
      const scope = requireString(body.scope, "scope");
      if (
        ![
          "private_global",
          "private_school",
          "workspace",
          "shared_artifact",
          "system",
        ].includes(scope)
      )
        throw new Error("Choose a valid memory scope.");
      const claimType = requireString(body.claimType, "claimType");
      if (
        ![
          "declared_fact",
          "inferred_preference",
          "correction",
          "decision",
          "recurring_workflow",
          "commitment",
          "mistake_avoidance",
          "learning_signal",
          "relationship",
          "workspace_convention",
        ].includes(claimType)
      )
        throw new Error("Choose a valid memory category.");
      const result = await spectraMutation("memory:remember", {
        proposition: requireString(body.proposition, "proposition"),
        scope,
        claimType,
        workspaceId: optionalString(body.workspaceId),
        artifactId: optionalString(body.artifactId),
        sourceType: "user_statement",
        captureReason: optionalString(body.captureReason),
      });
      return ok(result);
    }

    if (action === "correctMemory") {
      const result = await spectraMutation("memory:correct", {
        claimId: requireString(body.claimId, "claimId"),
        proposition: requireString(body.proposition, "proposition"),
      });
      return ok(result);
    }

    if (action === "disputeMemory") {
      const result = await spectraMutation("memory:setDisputed", {
        claimId: requireString(body.claimId, "claimId"),
        disputed: body.disputed !== false,
      });
      return ok(result);
    }

    if (action === "forgetMemory") {
      const result = await spectraMutation("memory:forget", {
        claimId: requireString(body.claimId, "claimId"),
      });
      return ok(result);
    }

    if (action === "clearMemory") {
      const result = await spectraMutation("memory:clearAll", {
        confirmation: requireString(body.confirmation, "confirmation"),
      });
      return ok(result);
    }

    if (action === "selectRunTab") {
      const result = await spectraMutation("spectraRuns:selectTab", {
        runId: optionalString(body.runId),
        threadId: optionalString(body.threadId),
      });
      return ok(result);
    }

    if (action === "selectMessageChoice") {
      const result = await spectraMutation(
        "spectraThreads:selectMessageChoice",
        {
          messageId: requireString(body.messageId, "messageId"),
          ...(optionalString(body.clarificationId) ? { clarificationId: optionalString(body.clarificationId) } : {}),
          ...(optionalString(body.executionId) ? { executionId: optionalString(body.executionId) } : {}),
          choiceKey: requireString(body.choiceKey, "choiceKey"),
          choiceTitle: requireString(body.choiceTitle, "choiceTitle"),
          ...(Array.isArray(body.batchSelections)
            ? {
                batchSelections: body.batchSelections.filter(
                  (value): value is { questionId: string; choiceKey: string; choiceTitle: string } =>
                    Boolean(value) &&
                    typeof value === "object" &&
                    typeof (value as Record<string, unknown>).questionId === "string" &&
                    typeof (value as Record<string, unknown>).choiceKey === "string" &&
                    typeof (value as Record<string, unknown>).choiceTitle === "string",
                ),
              }
            : {}),
        },
      );
      return ok(result);
    }

    if (action === "createWorkspace") {
      const workspaceId = await spectraMutation("spectraWorkspaces:create", {
        title: requireString(body.title, "title"),
        description: optionalString(body.description),
        icon: optionalString(body.icon),
        color: optionalString(body.color),
        parentNodeId: optionalString(body.parentNodeId),
      });
      return ok({ workspaceId });
    }

    if (action === "importWorkspaceManifest") {
      const result = await spectraMutation(
        "spectraWorkspaces:importPortableManifest",
        {
          fileName: requireString(body.fileName, "fileName"),
          sha256: requireString(body.sha256, "sha256"),
          manifest: body.manifest,
        },
      );
      return ok(result);
    }

    if (action === "inviteShare") {
      const result = await spectraMutation("authority:invite", {
        resourceType: requireResourceType(body.resourceType),
        resourceId: requireString(body.resourceId, "resourceId"),
        inviteeAccountId: requireString(
          body.inviteeAccountId,
          "inviteeAccountId",
        ),
        level: body.level === "modify" ? "modify" : "read",
        message: optionalString(body.message),
        expiresAt:
          typeof body.expiresAt === "number" ? body.expiresAt : undefined,
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
      const result = await spectraMutation(
        "authority:revokePendingInvitation",
        {
          invitationId: requireString(body.invitationId, "invitationId"),
        },
      );
      return ok(result);
    }

    if (action === "createPublicLink") {
      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const result = await spectraMutation<
        {
          resourceType: string;
          resourceId: string;
          tokenHash: string;
          expiresAt?: number;
        },
        { linkId: string; policyVersion: number; level: "read" }
      >("authority:createPublicLink", {
        resourceType: requireResourceType(body.resourceType),
        resourceId: requireString(body.resourceId, "resourceId"),
        tokenHash,
        expiresAt:
          typeof body.expiresAt === "number" ? body.expiresAt : undefined,
      });
      return ok({
        ...result,
        url: `/public#${token}`,
      });
    }

    if (action === "revokePublicLink") {
      const result = await spectraMutation("authority:revokePublicLink", {
        linkId: requireString(body.linkId, "linkId"),
      });
      return ok(result);
    }

    if (action === "setArtifactAccessException") {
      const effect =
        body.effect === "deny"
          ? "deny"
          : body.effect === "restrict"
            ? "restrict"
            : null;
      if (!effect)
        return badRequest("Choose a valid artifact access exception.");
      const result = await spectraMutation("authority:setArtifactException", {
        artifactId: requireString(body.artifactId, "artifactId"),
        accountId: requireString(body.accountId, "accountId"),
        effect,
        maxLevel: effect === "restrict" ? "read" : undefined,
      });
      return ok(result);
    }

    if (action === "clearArtifactAccessException") {
      const result = await spectraMutation("authority:clearArtifactException", {
        artifactId: requireString(body.artifactId, "artifactId"),
        accountId: requireString(body.accountId, "accountId"),
      });
      return ok(result);
    }

    if (action === "createArtifactComment") {
      const mentionedAccountIds = Array.isArray(body.mentionedAccountIds)
        ? body.mentionedAccountIds.filter(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0,
          )
        : [];
      const result = await spectraMutation("artifactComments:create", {
        artifactId: requireString(body.artifactId, "artifactId"),
        parentCommentId: optionalString(body.parentCommentId),
        body: requireString(body.commentBody, "commentBody"),
        anchor: {
          regionId: requireString(body.regionId, "regionId"),
          relativePosition:
            typeof body.relativePositionBase64 === "string"
              ? Uint8Array.from(
                  Buffer.from(body.relativePositionBase64, "base64"),
                ).buffer
              : undefined,
          fallbackExcerpt: optionalString(body.fallbackExcerpt),
          geometry:
            body.geometry && typeof body.geometry === "object"
              ? body.geometry
              : undefined,
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
          geometry:
            body.geometry && typeof body.geometry === "object"
              ? body.geometry
              : undefined,
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
      if (!["all", "mentions_replies", "off"].includes(mode))
        throw new Error("Choose a valid comment notification preference.");
      const result = await spectraMutation(
        "artifactComments:setNotificationPreference",
        {
          artifactId: requireString(body.artifactId, "artifactId"),
          mode,
        },
      );
      return ok(result);
    }

    if (action === "markArtifactCommentNotificationsRead") {
      const notificationIds = Array.isArray(body.notificationIds)
        ? body.notificationIds.filter(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0,
          )
        : [];
      const result = await spectraMutation(
        "artifactComments:markNotificationsRead",
        { notificationIds },
      );
      return ok(result);
    }

    if (action === "markPlannerReminderNotificationsRead") {
      const deliveryIds = Array.isArray(body.deliveryIds)
        ? body.deliveryIds.filter(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0,
          )
        : [];
      const result = await spectraMutation("plannerReminders:markRead", {
        deliveryIds,
      });
      return ok(result);
    }

    if (action === "markTimetableReminderNotificationsRead") {
      const deliveryIds = Array.isArray(body.deliveryIds)
        ? body.deliveryIds.filter(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0,
          )
        : [];
      const result = await spectraMutation("timetableReminders:markRead", {
        deliveryIds,
      });
      return ok(result);
    }

    if (action === "saveArtifactUserState") {
      const result = await spectraMutation("artifactUserStates:put", {
        artifactId: requireString(body.artifactId, "artifactId"),
        kind: "timetable",
        state: body.state,
      });
      return ok(result);
    }

    if (action === "requestArtifactAccess") {
      const result = await spectraMutation("artifactAccessRequests:request", {
        embedId: requireString(body.embedId, "embedId"),
        requestedLevel: body.requestedLevel === "modify" ? "modify" : "read",
        message: optionalString(body.message),
      });
      return ok(result);
    }

    if (action === "cancelArtifactAccessRequest") {
      const result = await spectraMutation("artifactAccessRequests:cancel", {
        requestId: requireString(body.requestId, "requestId"),
      });
      return ok(result);
    }

    if (action === "resolveArtifactAccessRequest") {
      const result = await spectraMutation("artifactAccessRequests:resolve", {
        requestId: requireString(body.requestId, "requestId"),
        decision: body.decision === "approve" ? "approve" : "decline",
        level:
          body.decision === "approve"
            ? body.level === "modify"
              ? "modify"
              : "read"
            : undefined,
      });
      return ok(result);
    }

    if (action === "resolveAiArtifactConflict") {
      const operationId = requireString(body.operationId, "operationId");
      const resolution = requireString(body.resolution, "resolution");
      if (!["apply", "keep_current", "cancel"].includes(resolution))
        throw new Error("Choose a valid conflict resolution.");
      const detail = (await spectraQuery(
        "spectraOperations:conflictForOperation",
        { operationId },
      )) as {
        executionId?: string;
        currentStateVectorHash: string;
      };
      if (!detail.executionId) throw new Error("REGION_CONFLICT_RUN_STALE");
      const result = await spectraMutation(
        "spectraOperations:resumeAfterRegionConflict",
        {
          operationId,
          executionId: detail.executionId,
          resolution,
          newBaseStateVectorHash:
            resolution === "apply" ? detail.currentStateVectorHash : undefined,
        },
      );
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
      const result = await spectraMutation(
        "spectraWorkspaces:permanentlyDelete",
        {
          workspaceId: requireString(body.workspaceId, "workspaceId"),
          confirmation: requireString(body.confirmation, "confirmation"),
        },
      );
      return ok(result);
    }

    if (action === "createArtifact") {
      const blueprintKey = requireBlueprint(body.blueprintKey);
      const requestedSource = optionalString(body.source);
      const source =
        requestedSource &&
        ["chat", "workspace", "artifact", "manual", "ai"].includes(
          requestedSource,
        )
          ? requestedSource
          : optionalString(body.workspaceId)
            ? "workspace"
            : "manual";
      const parentNodeId = optionalString(body.parentNodeId);
      const nativeFormat = optionalString(body.nativeFormat);
      const result = await spectraMutation("spectraArtifacts:create", {
        blueprintKey,
        title: requireString(body.title, "title"),
        summary: optionalString(body.summary),
        content: encodeArtifactContentForStorage(blueprintKey, body.content),
        tags: Array.isArray(body.tags)
          ? body.tags.filter((tag): tag is string => typeof tag === "string")
          : undefined,
        workspaceId: optionalString(body.workspaceId),
        ...(parentNodeId === "root"
          ? { parentNodeId: "root" as const }
          : parentNodeId
            ? { parentNodeId }
            : {}),
        ...(nativeFormat ? { nativeFormat } : {}),
        source,
      });
      return ok(result);
    }

    if (action === "publishAgent") {
      const result = await spectraMutation("spectraArtifacts:publishAgent", {
        agentId: requireString(body.agentId, "agentId"),
        releaseNotes: optionalString(body.releaseNotes),
        rollout:
          body.rollout === "internal_test" ||
          body.rollout === "limited" ||
          body.rollout === "published"
            ? body.rollout
            : undefined,
      });
      return ok(result);
    }

    if (action === "manageAgentRelease") {
      const releaseAction =
        body.releaseAction === "promote" ||
        body.releaseAction === "rollback" ||
        body.releaseAction === "suspend" ||
        body.releaseAction === "deprecate"
          ? body.releaseAction
          : null;
      if (!releaseAction) throw new Error("releaseAction is invalid");
      const result = await spectraMutation(
        "spectraArtifacts:manageAgentRelease",
        {
          releaseId: requireString(body.releaseId, "releaseId"),
          action: releaseAction,
        },
      );
      return ok(result);
    }

    if (action === "followAgent") {
      const result = await spectraMutation("agents:follow", {
        agentId: requireString(body.agentId, "agentId"),
        following: body.following === true,
        pinnedReleaseId: optionalString(body.pinnedReleaseId),
      });
      return ok(result);
    }

    if (action === "submitAgentFeedback") {
      const category =
        body.category === "helpful" ||
        body.category === "accuracy" ||
        body.category === "clarity" ||
        body.category === "safety" ||
        body.category === "resource_quality" ||
        body.category === "other"
          ? body.category
          : null;
      if (!category) throw new Error("feedback category is invalid");
      const result = await spectraMutation("agents:submitFeedback", {
        agentId: requireString(body.agentId, "agentId"),
        agentVersionId: requireString(body.agentVersionId, "agentVersionId"),
        runId: optionalString(body.runId),
        rating: Number(body.rating),
        category,
        comment: optionalString(body.comment),
        consentToShareComment: body.consentToShareComment === true,
      });
      return ok(result);
    }

    if (action === "proposeAgentImprovement") {
      const result = await spectraMutation("agents:proposeImprovement", {
        agentId: requireString(body.agentId, "agentId"),
        evidence: requireString(body.evidence, "evidence"),
        proposedPatch: body.proposedPatch,
        expectedImpact: requireString(body.expectedImpact, "expectedImpact"),
        evalRunId: optionalString(body.evalRunId),
      });
      return ok(result);
    }

    if (action === "saveAgentBenchCase") {
      const strings = (value: unknown) =>
        Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === "string")
          : [];
      const result = await spectraMutation("agents:saveBenchCase", {
        agentId: requireString(body.agentId, "agentId"),
        caseId: optionalString(body.caseId),
        prompt: requireString(body.prompt, "prompt"),
        mustInclude: strings(body.mustInclude),
        mustNotInclude: strings(body.mustNotInclude),
        rubric: optionalString(body.rubric),
        required: typeof body.required === "boolean" ? body.required : undefined,
      });
      return ok(result);
    }

    if (action === "removeAgentBenchCase") {
      const result = await spectraMutation("agents:removeBenchCase", {
        agentId: requireString(body.agentId, "agentId"),
        caseId: requireString(body.caseId, "caseId"),
      });
      return ok(result);
    }

    if (action === "decideAgentImprovement") {
      const decision =
        body.decision === "accepted" || body.decision === "rejected"
          ? body.decision
          : null;
      if (!decision) throw new Error("improvement decision is invalid");
      const result = await spectraMutation("agents:decideImprovement", {
        proposalId: requireString(body.proposalId, "proposalId"),
        decision,
        note: optionalString(body.note),
      });
      return ok(result);
    }

    if (action === "addPublicAgent") {
      const result = await spectraMutation("spectraArtifacts:addPublicAgent", {
        agentId: requireString(body.agentId, "agentId"),
      });
      return ok(result);
    }

    if (action === "reviewFlashcard") {
      const result = await spectraMutation("flashcardStudy:review", {
        artifactId: requireString(body.artifactId, "artifactId"),
        cardId: requireString(body.cardId, "cardId"),
        direction: requireFlashcardDirection(body.direction),
        rating: requireFlashcardRating(body.rating),
        clientReviewId: requireString(body.clientReviewId, "clientReviewId"),
        elapsedMs:
          typeof body.elapsedMs === "number" && Number.isFinite(body.elapsedMs)
            ? body.elapsedMs
            : undefined,
      });
      return ok(result);
    }

    if (action === "setFlashcardNote") {
      const result = await spectraMutation("flashcardStudy:setNote", {
        artifactId: requireString(body.artifactId, "artifactId"),
        cardId: requireString(body.cardId, "cardId"),
        direction: requireFlashcardDirection(body.direction),
        note: typeof body.note === "string" ? body.note : "",
      });
      return ok(result);
    }

    if (action === "startQuizPractice") {
      const result = await spectraMutation("quizPractice:start", {
        artifactId: requireString(body.artifactId, "artifactId"),
        clientAttemptId: requireString(body.clientAttemptId, "clientAttemptId"),
      });
      return ok(result);
    }

    if (action === "saveQuizPracticeResponse") {
      const result = await spectraMutation("quizPractice:saveResponse", {
        attemptId: requireString(body.attemptId, "attemptId"),
        questionId: requireString(body.questionId, "questionId"),
        response: body.response,
        clientMutationId: requireString(
          body.clientMutationId,
          "clientMutationId",
        ),
      });
      return ok(result);
    }

    if (action === "submitQuizPractice") {
      const result = await spectraMutation("quizPractice:submit", {
        attemptId: requireString(body.attemptId, "attemptId"),
        clientSubmissionId: requireString(
          body.clientSubmissionId,
          "clientSubmissionId",
        ),
      });
      return ok(result);
    }

    if (action === "commitArtifactRestore") {
      if (body.regionIds !== undefined && (!Array.isArray(body.regionIds) ||
          body.regionIds.some((id: unknown) => typeof id !== "string")))
        return badRequest("Choose valid regions to restore.");
      const { admitArtifactRestore, artifactRestoreFailure } = await import("@/lib/artifact-restore-server");
      const { prepareNativeArtifactRestore } = await import("@/lib/artifact-restore-native");
      try {
        const result = await admitArtifactRestore({
        artifactId: requireString(body.artifactId, "artifactId") as Id<"spectraArtifacts">,
        sourceVersionId: requireString(body.sourceVersionId, "sourceVersionId") as Id<"spectraArtifactVersions">,
        requestId: requireString(body.requestId, "requestId"),
        clientId: requireString(body.clientId, "clientId"),
        ...(body.regionIds !== undefined ? { regionIds: body.regionIds as string[] } : {}),
        }, prepareNativeArtifactRestore);
        return ok(result);
      } catch (error) {
        const failure = artifactRestoreFailure(error);
        if (failure) return badRequest(failure.message, failure.status);
        throw error;
      }
    }

    if (action === "createArtifactCheckpoint") {
      const result = await spectraMutation(
        "changeGroups:createNamedCheckpoint",
        {
          artifactId: requireString(body.artifactId, "artifactId"),
          name: requireString(body.name, "name"),
        },
      );
      return ok(result);
    }

    if (action === "createArtifactImportVersion") {
      const result = await spectraMutation("changeGroups:commitImport", {
        artifactId: requireString(body.artifactId, "artifactId"),
        importJobId: requireString(body.importJobId, "importJobId"),
      });
      return ok(result);
    }

    if (action === "reconcileArtifactImportVersions") {
      const result = await spectraMutation("changeGroups:reconcileImports", {
        artifactId: requireString(body.artifactId, "artifactId"),
      });
      return ok(result);
    }

    if (action === "commitArtifactCurrentSession") {
      const result = await spectraMutation("changeGroups:commitCurrent", {
        artifactId: requireString(body.artifactId, "artifactId"),
        summary: optionalString(body.summary),
        clientId: optionalString(body.clientId),
      });
      return ok({ versions: result });
    }

    if (action === "dismissAiEdit") {
      const result = await spectraMutation("spectraArtifacts:dismissAiEdit", {
        artifactId: requireString(body.artifactId, "artifactId"),
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
      const result = await spectraMutation(
        "spectraArtifacts:permanentlyDelete",
        {
          artifactId: requireString(body.artifactId, "artifactId"),
        },
      );
      return ok(result);
    }

    if (action === "ensurePersonalTimetable") {
      const result = await spectraMutation(
        "spectraArtifacts:ensurePersonalTimetable",
        {},
      );
      return ok(result);
    }

    if (action === "addArtifactToWorkspace") {
      const result = await spectraMutation("orgTree:placeWork", {
        workspaceId: requireString(body.workspaceId, "workspaceId"),
        artifactId: requireString(body.artifactId, "artifactId"),
      });
      return ok(result);
    }

    if (action === "moveArtifactToWorkspace") {
      // One home per work, so a move is a single transaction rather than an
      // add here and a hide everywhere else.
      const result = await spectraMutation("orgTree:placeWork", {
        artifactId: requireString(body.artifactId, "artifactId"),
        workspaceId: requireString(body.workspaceId, "workspaceId"),
      });
      return ok(result);
    }

    if (action === "moveArtifactToGeneral") {
      const result = await spectraMutation("orgTree:placeWork", {
        artifactId: requireString(body.artifactId, "artifactId"),
      });
      return ok(result);
    }

    if (action === "removeFromWorkspace") {
      const result = await spectraMutation("orgTree:removeFromWorkspace", {
        nodeId: requireString(body.nodeId, "nodeId"),
      });
      return ok(result);
    }

    if (action === "setNodePinned") {
      const result = await spectraMutation("orgTree:setPinned", {
        nodeId: requireString(body.nodeId, "nodeId"),
        pinned: body.pinned === true,
      });
      return ok(result);
    }

    if (action === "createArtifactLink") {
      const result = await spectraMutation("spectraArtifactLinks:create", {
        sourceArtifactId: requireString(
          body.sourceArtifactId,
          "sourceArtifactId",
        ),
        targetArtifactId: requireString(
          body.targetArtifactId,
          "targetArtifactId",
        ),
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
      const localMessages = Array.isArray(body.localMessages)
        ? body.localMessages.slice(0, 60).flatMap((message) => {
            if (!message || typeof message !== "object") return [];
            const row = message as Record<string, unknown>;
            if (
              (row.role !== "user" && row.role !== "assistant") ||
              typeof row.id !== "string" ||
              typeof row.content !== "string" ||
              typeof row.createdAt !== "number"
            )
              return [];
            return [
              {
                id: row.id,
                role: row.role,
                content: row.content,
                runId: optionalString(row.runId),
                createdAt: row.createdAt,
              },
            ];
          })
        : undefined;
      void localMessages;
      const result = await spectraMutation("spectraThreads:createFromRun", {
        runId: requireString(body.runId, "runId"),
        placeInWorkspace: body.placeInWorkspace === true,
      });
      return ok(result);
    }

    if (action === "addThreadToWorkspace") {
      const kept = await spectraMutation("spectraThreads:createFromRun", {
        runId: requireString(body.runId, "runId"),
        placeInWorkspace: true,
      });
      return ok(kept);
    }

    return badRequest("That Spectra action is not available.");
  }, request);
}
