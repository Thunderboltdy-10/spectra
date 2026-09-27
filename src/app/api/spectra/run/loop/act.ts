import type { NativeProgressUpdate, Surface } from "./contract";
import { storeArtifactContent } from "@/lib/convex-server";
import { throwIfAborted } from "./abort";
import { executeRegisteredCalendarMutation } from "./calendar-command";
import { normalizeCalendarCommand } from "@/features/spectra/calendar/domain/command";
import { normalizeApplicationCommand } from "@/features/spectra/operations/application-command";
import { executeReferenceInsertion } from "./reference-command";
import { rows } from "./gather";
import { act, mutate, query } from "./io";
import { normalizeCreationSummary, operationLabel } from "./plan";
import {
  authorityPublicMessage,
  authorityRequiresNotice,
} from "@/features/spectra/ai/authority-execution";
import { evaluateCommandAuthority, recordAuthorityDecision } from "./authority";
import { applyResolvedContentPatch } from "@/features/spectra/ai/document-content-patch";
import { resolveLibraryDestinationId } from "@/features/spectra/ai/library-operation-context";
import {
  isNativeContentRegion,
  linkedOfficeKind,
  promoteNativeAiContent,
} from "@/features/spectra/ai/native-ai-promotion";
import {
  applyAiArtifactMutation,
  readLiveArtifactValue,
} from "@/features/spectra/ai/yjs-artifact-operation";
import {
  appCommandById,
  applicationCommandIdForTool,
} from "@/features/spectra/commands/app-registry";
import {
  highlightPathsFromContentPatchChanges,
  materializeAiChangedPaths,
  sheetsCellHighlightPaths,
} from "@/features/spectra/components/ai-region-path";
import { assertCreateContentNotHollow } from "@/features/spectra/operations/hollow-content";
import type { ModelOperation } from "@/features/spectra/operations/schema";
import { mapOperationArtifactReferences } from "@/features/spectra/operations/dependencies";
import { spectraToolRegistry } from "@/features/spectra/tools/registry";
import { encodeArtifactContentForStorage } from "../../../../../../shared/sheet-cells";
import { normalizeAiPreferencePatch } from "@/features/spectra/settings/schema/preferences";
import { applyDocumentAcademicOperations, documentAcademicEffectsLanded } from "@/features/spectra/commands/office/document-academic-operations";
import { verifyAcademicSourceHandles } from "@/features/spectra/commands/office/document-academic-source-verification";

async function executeLegacyCalendarCommand(
  actorClerkId: string,
  runId: string,
  executionId: string,
  command: string,
  args: Record<string, unknown>,
  onUiEvent?: (event: {
    key: string;
    payload?: Record<string, unknown>;
  }) => void,
  signal?: AbortSignal,
  operationId?: string,
) {
  return executeRegisteredCalendarMutation({
    actorClerkId,
    runId,
    executionId,
    command,
    args,
    mutationScopeId: runId,
    signal,
    onUiEvent,
    operationId,
  });
}

export async function executeApplicationCommand(
  actorClerkId: string,
  runId: string,
  executionId: string,
  command: string,
  args: Record<string, unknown>,
  currentLibraryNodeId?: string,
  onUiEvent?: (event: {
    key: string;
    payload?: Record<string, unknown>;
  }) => void,
  signal?: AbortSignal,
  operationId?: string,
) {
  throwIfAborted(signal);
  command = normalizeApplicationCommand(command);
  if (normalizeCalendarCommand(command))
    return executeLegacyCalendarCommand(
      actorClerkId,
      runId,
      executionId,
      command,
      args,
      onUiEvent,
      signal,
      operationId,
    );
  const definition = spectraToolRegistry.get(command);
  if (!definition || definition.capability !== "operate_application")
    throw new Error(`APP_COMMAND_NOT_REGISTERED:${command}`);
  const registeredCommandId = applicationCommandIdForTool(command);
  if (!registeredCommandId || !appCommandById(registeredCommandId))
    throw new Error(`APP_COMMAND_REGISTRY_DRIFT:${command}`);
  // Normalize model-friendly aliases before Zod strips unknown fields. The
  // settings schema intentionally accepts only persisted preference sections,
  // so doing this after parse would silently turn a valid natural-language
  // request into an empty settings write.
  const inputArgs =
    command === "change_spectra_settings"
      ? {
          ...args,
          patch: normalizeAiPreferencePatch(args.patch),
        }
      : args;
  const parsed = definition.inputSchema.parse(inputArgs) as Record<string, unknown>;
  const applyMutation: typeof mutate = async <TArgs extends object, TResult>(_name: string, _args: TArgs) => {
    throwIfAborted(signal);
    if (!operationId) throw new Error("APPLICATION_OPERATION_ID_REQUIRED");
    return mutate<object, TResult>("spectraApplicationWrites:execute", {
      runId, executionId, operationId, expectedCommand: command, expectedArgs: parsed,
    });
  };
  if (definition.aiAvailability === "prohibited")
    throw new Error(
      `AUTHORITY_PROHIBITED:${definition.prohibitionReason ?? definition.title}`,
    );
  if (definition.authorityTarget) {
    const authority = await evaluateCommandAuthority({
      actorClerkId,
      command,
      args: parsed,
      authorityTarget: definition.authorityTarget,
    });
    throwIfAborted(signal);
    await recordAuthorityDecision({
      actorClerkId,
      runId,
      executionId,
      command,
      decision: authority.decision,
      target: authority.target,
      reason: authority.reason,
      consequence: authority.consequence,
      localFileCount:
        typeof parsed.localFileCount === "number"
          ? parsed.localFileCount
          : undefined,
    });
    if (authority.decision === "prohibited")
      throw new Error(`AUTHORITY_PROHIBITED:${authority.reason}`);
    if (authorityRequiresNotice(authority.decision) && authority.notice)
      onUiEvent?.({
        key: "authority_notice",
        payload: {
          note: authority.notice,
          command,
          message: authorityPublicMessage(authority),
        },
      });
  }
  // Application operations are the server-side semantic path shared by AI
  // and the human-facing Convex actions. Keep this dispatch small and typed;
  // adding a command requires adding its schema and one handler here.
  if (command === "change_spectra_settings") {
    const patch = normalizeAiPreferencePatch(parsed.patch);
    const settings = await applyMutation("accountPreferences:writeLayer", {
      actorClerkId,
      scope: "account",
      scopeKey: "account",
      values: patch,
    });
    const changedSection = [
      "ai",
      "writing",
      "appearance",
      "workbar",
      "privacy",
      "integrations",
    ].find((section) => Object.hasOwn(patch, section));
    onUiEvent?.({
      key: "settings_changed",
      payload: {
        targetId: changedSection === "integrations" ? "devices" : changedSection ?? "ai",
        note: "Updated Spectra settings",
      },
    });
    return settings;
  }
  if (command === "setup_bridge") {
    const action = parsed.action;
    const grantId = typeof parsed.grantId === "string" ? parsed.grantId.trim() : "";
    if (action === "retry-folder" && !grantId)
      throw new Error("BRIDGE_GRANT_REQUIRED");
    onUiEvent?.({
      key: "bridge_setup",
      payload: {
        action,
        actionId: executionId,
        ...(grantId ? { grantId } : {}),
        targetId: "devices",
        note: "Open Bridge settings to finish this setup step",
      },
    });
    return {
      ok: true,
      status: "needs-human",
      message: "Bridge settings are ready. The user must complete the setup step and any local consent.",
      command: {
        id: "app.bridge.setup",
        actionId: executionId,
        action,
        ...(grantId ? { grantId } : {}),
      },
    };
  }
  if (command === "organize_library") {
    const action = typeof parsed.action === "string" ? parsed.action : "";
    const targetIds = Array.isArray(parsed.targetIds)
      ? parsed.targetIds.filter((id): id is string => typeof id === "string")
      : [];
    const destinationId = resolveLibraryDestinationId(
      parsed.destinationId,
      currentLibraryNodeId,
    );
    if (action === "create_folder") {
      const name = String(parsed.name ?? "").trim();
      const existingSearch = await query<unknown & object, unknown>(
        "orgTree:search",
        {
          term: name,
          kinds: ["folder"],
          scopeNodeId: destinationId ?? null,
          limit: 20,
        },
      );
      const existing = rows(
        existingSearch &&
          typeof existingSearch === "object" &&
          !Array.isArray(existingSearch)
          ? (existingSearch as Record<string, unknown>).results
          : [],
      ).find(
        (item) =>
          String(item.name ?? "")
            .trim()
            .toLocaleLowerCase() === name.toLocaleLowerCase() &&
          String(item.parentId ?? "") === String(destinationId ?? ""),
      );
      if (existing)
        return {
          observation: {
            kind: "library.create_folder",
            name: String(existing.name ?? name),
            nodeId: String(
              existing.nodeId ?? existing._id ?? existing.id ?? "",
            ),
            parentId: destinationId ?? null,
            reused: true,
          },
        };
      const result = await applyMutation("orgTree:createFolder", {
        actorClerkId,
        name,
        parentId: destinationId,
      });
      onUiEvent?.({
        key: "organize_library",
        payload: {
          action,
          targetId: String((result as Record<string, unknown>).nodeId ?? ""),
          destinationId: destinationId ?? null,
          note: `Created ${String(parsed.name ?? "")}`,
        },
      });
      const created = result as Record<string, unknown>;
      const nodeId = String(created.nodeId ?? created._id ?? "");
      const observed = nodeId
        ? await query<unknown & object, unknown>("orgTree:path", { nodeId })
        : null;
      const observedRecord =
        observed && typeof observed === "object" && !Array.isArray(observed)
          ? (observed as Record<string, unknown>)
          : {};
      const observedNode =
        observedRecord.node &&
        typeof observedRecord.node === "object" &&
        !Array.isArray(observedRecord.node)
          ? (observedRecord.node as Record<string, unknown>)
          : created;
      if (
        String(observedNode.name ?? "") !== name ||
        String(observedNode.parentId ?? "") !== String(destinationId ?? "")
      )
        throw new Error("LIBRARY_CREATE_POSTCONDITION_FAILED");
      return {
        ...(result && typeof result === "object" && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : {}),
        observation: {
          kind: "library.create_folder",
          name,
          nodeId,
          parentId: destinationId ?? null,
          reused: false,
        },
      };
    }
    if (action === "rename") {
      const result = await applyMutation("orgTree:rename", {
        actorClerkId,
        nodeId: targetIds[0],
        name: String(parsed.name ?? ""),
      });
      onUiEvent?.({
        key: "organize_library",
        payload: {
          action,
          targetId: targetIds[0],
          note: `Renamed to ${String(parsed.name ?? "")}`,
        },
      });
      return result;
    }
    if (action === "move") {
      const result = await applyMutation("orgTree:move", {
        actorClerkId,
        nodeIds: targetIds,
        parentId: destinationId,
      });
      onUiEvent?.({
        key: "organize_library",
        payload: {
          action,
          targetId: destinationId,
          note: `Moved ${targetIds.length} item${targetIds.length === 1 ? "" : "s"}`,
        },
      });
      return result;
    }
    if (action === "link") {
      const result = await applyMutation("orgTree:createReference", {
        actorClerkId,
        targetNodeId: targetIds[0],
        parentId: destinationId,
      });
      onUiEvent?.({
        key: "organize_library",
        payload: {
          action,
          targetId: destinationId,
          note: "Created a Library reference",
        },
      });
      return result;
    }
    throw new Error("LIBRARY_COMMAND_INVALID");
  }
  if (command === "delete_library_items") {
    const targetIds = Array.isArray(parsed.targetIds)
      ? parsed.targetIds.filter((id): id is string => typeof id === "string")
      : [];
    return await applyMutation("orgTree:trash", { actorClerkId, nodeIds: targetIds });
  }
  if (command === "change_sync_policy") {
    const targetIds = Array.isArray(parsed.targetIds)
      ? parsed.targetIds.filter((id): id is string => typeof id === "string")
      : [];
    const patch =
      parsed.patch &&
      typeof parsed.patch === "object" &&
      !Array.isArray(parsed.patch)
        ? parsed.patch
        : {};
    if (!targetIds.length) throw new Error("SYNC_TARGETS_REQUIRED");
    const changed = await applyMutation("syncPolicy:patchItems", {
      itemIds: targetIds,
      patch,
      actorKind: "ai",
      idempotencyKey: `ai:${runId}:${JSON.stringify(patch).slice(0, 120)}`,
    });
    onUiEvent?.({
      key: "sync_policy_changed",
      payload: {
        targetId: targetIds[0],
        targetIds,
        note: `Updated sync policy for ${targetIds.length} item${targetIds.length === 1 ? "" : "s"}`,
      },
    });
    return changed;
  }
  if (command === "navigate_spectra") {
    const destination = String(parsed.destination ?? "library");
    const targetId =
      typeof parsed.targetId === "string" ? parsed.targetId : undefined;
    onUiEvent?.({
      key: "navigate_spectra",
      payload: {
        destination,
        ...(targetId ? { targetId } : {}),
        note: `Opening ${destination}`,
      },
    });
    return { ok: true, status: "requested", destination, ...(targetId ? { targetId } : {}), message: "Navigation requested. The destination view reports its own readiness." };
  }
  if (command === "write_memory") {
    const content = String(parsed.content ?? "").trim();
    if (!content) throw new Error("MEMORY_CONTENT_REQUIRED");
    const action = String(parsed.action ?? "create");
    if (action === "create") {
      const memory = await applyMutation("memory:remember", {
        actorClerkId,
        proposition: content,
        scope: "private_global",
        claimType: "inferred_preference",
        sourceType: "user_statement",
        captureReason: "You explicitly asked Spectra to remember this.",
      });
      onUiEvent?.({
        key: "memory_written",
        payload: { targetId: "memory", note: "Saved a private memory" },
      });
      return { ok: true, memory };
    }
    const memoryId = typeof parsed.memoryId === "string" ? parsed.memoryId : "";
    if (!memoryId) throw new Error("MEMORY_ID_REQUIRED");
    const memory = await applyMutation("memory:correct", {
      actorClerkId,
      claimId: memoryId,
      proposition: content,
    });
    onUiEvent?.({
      key: "memory_written",
      payload: { targetId: memoryId, note: "Revised a private memory" },
    });
    return { ok: true, memory };
  }
  if (command === "change_sharing") {
    const resourceType = String(parsed.resourceType ?? "artifact");
    const resourceId = String(parsed.resourceId ?? "");
    const action = String(parsed.action ?? "");
    if (!resourceId) throw new Error("SHARING_RESOURCE_REQUIRED");
    if (action === "invite") {
      const result = await applyMutation("authority:invite", {
        actorClerkId,
        resourceType,
        resourceId,
        inviteeAccountId: String(parsed.subjectId ?? ""),
        level: parsed.level === "modify" ? "modify" : "read",
      });
      onUiEvent?.({
        key: "sharing_changed",
        payload: { targetId: resourceId, note: "Sent a sharing invitation" },
      });
      return result;
    }
    if (action === "change_level") {
      const result = await applyMutation("authority:changeAcceptedLevel", {
        actorClerkId,
        invitationId: String(parsed.invitationId ?? ""),
        level: parsed.level === "modify" ? "modify" : "read",
      });
      onUiEvent?.({
        key: "sharing_changed",
        payload: { targetId: resourceId, note: "Updated sharing access" },
      });
      return result;
    }
    if (action === "revoke") {
      const result = await applyMutation("authority:revoke", {
        actorClerkId,
        resourceType,
        resourceId,
        grantId: String(parsed.grantId ?? ""),
      });
      onUiEvent?.({
        key: "sharing_changed",
        payload: { targetId: resourceId, note: "Revoked sharing access" },
      });
      return result;
    }
    throw new Error("SHARING_ACTION_INVALID");
  }
  if (command === "trigger_managebac_sync") {
    const purpose = String(parsed.purpose ?? "upcoming_deadlines");
    const result = await applyMutation("managebac:requestAiRefresh", {
      reason: `ai_${purpose}`,
      force: parsed.force !== false,
    });
    onUiEvent?.({
      key: "managebac_sync_requested",
      payload: { targetId: "managebac", note: "Requested a ManageBac refresh" },
    });
    return result;
  }
  if (command === "select_managebac_classes") {
    const recordIds = Array.isArray(parsed.recordIds)
      ? parsed.recordIds.filter((id): id is string => typeof id === "string")
      : [];
    const result = await applyMutation("managebac:setSelectedClasses", {
      recordIds,
      ...(typeof parsed.expectedRevision === "number"
        ? { expectedRevision: parsed.expectedRevision }
        : {}),
      ...(parsed.retention === "keep_in_spectra" ||
      parsed.retention === "archive_projection"
        ? { retention: parsed.retention }
        : {}),
    });
    onUiEvent?.({
      key: "managebac_classes_selected",
      payload: {
        targetId: "managebac",
        note: `Updated the ManageBac class selection (${recordIds.length} selected)`,
        selectedCount: recordIds.length,
      },
    });
    return result;
  }
  if (command === "insert_reference") {
    if (!operationId) throw new Error("REFERENCE_OPERATION_ID_REQUIRED");
    const result = await executeReferenceInsertion({
      actorClerkId, runId, executionId, operationId,
      hostWorkId: String(parsed.hostWorkId), targetWorkId: String(parsed.targetWorkId),
      label: typeof parsed.label === "string" ? parsed.label : undefined, signal,
    });
    onUiEvent?.({ key: "reference_insert", payload: {
      ...result, note: "Live reference saved", phase: result.receipt.phase,
    } });
    return result;
  }
  if (command === "add_comment") {
    const artifactId = String(parsed.artifactId);
    const anchor = parsed.anchor as { regionId: string; fallbackExcerpt?: string };
    const result = await applyMutation("artifactComments:create", {
      actorClerkId,
      artifactId,
      body: String(parsed.body),
      anchor,
      mentionedAccountIds: [],
    });
    onUiEvent?.({
      key: "comment_added",
      payload: {
        targetId: artifactId,
        regionId: anchor.regionId,
        note: "Added an AI comment",
      },
    });
    return result;
  }
  throw new Error(`APP_COMMAND_NOT_REGISTERED:${command}`);
}

export function operationEffectProgress(
  operation: ModelOperation,
  operationIndex: number,
  resolvedTargetTitle?: string,
): NativeProgressUpdate | null {
  if (operation.type === "artifact.create")
    return {
      title: `Building ${operation.input.title}`.slice(0, 88),
      detail: "Forming the requested content in its live artifact",
      activity: "create",
      operationIndex,
      artifactType: operation.input.blueprintKey,
      regionHint: "artifact:structure",
    };
  if (operation.type !== "artifact.update") return null;
  const paths =
    operation.input.contentPatch?.changes.map((change) => change.path) ??
    (operation.input.content !== null ? ["/"] : []);
  const firstPath =
    paths[0] ??
    (operation.input.title !== null
      ? "/title"
      : operation.input.summary !== null
        ? "/summary"
        : "/metadata");
  const segments = firstPath.split("/").filter(Boolean);
  let target = `${operation.input.blueprintKey.replaceAll("_", " ")} content`;
  const numbered = (collection: string, singular: string) => {
    const index = segments[0] === collection ? Number(segments[1]) : Number.NaN;
    return Number.isInteger(index) ? `${singular} ${index + 1}` : null;
  };
  if (operation.input.blueprintKey === "document")
    target =
      numbered("blocks", "document block") ??
      (segments[0] === "title" ? "the document title" : "the document");
  else if (operation.input.blueprintKey === "flashcard_deck")
    target = numbered("cards", "flashcard") ?? "the flashcard deck";
  else if (operation.input.blueprintKey === "quiz") {
    const question = numbered("questions", "question");
    const optionIndex =
      segments[2] === "options" ? Number(segments[3]) : Number.NaN;
    target =
      question && Number.isInteger(optionIndex)
        ? `${question}, answer option ${optionIndex + 1}`
        : (question ?? "the quiz");
  } else if (operation.input.blueprintKey === "planner_task") {
    const step = numbered("subtasks", "task step");
    const labels: Record<string, string> = {
      dueAt: "the task deadline",
      startAt: "the task start time",
      endAt: "the task end time",
      status: "the task status",
      priority: "the task priority",
      description: "the task description",
      taskTitle: "the task title",
    };
    target = step ?? labels[segments[0] ?? ""] ?? "the planner task";
  }
  return {
    title:
      `${firstPath === "/title" ? "Renaming" : "Updating"} ${resolvedTargetTitle ?? target}`.slice(
        0,
        88,
      ),
    detail:
      paths.length > 1
        ? `${paths.length} related fields will change together`
        : "Changing only the requested semantic region",
    activity: "edit",
    operationIndex,
    artifactType: operation.input.blueprintKey,
    regionHint: firstPath,
  };
}

export function operationPhases(
  operation: ModelOperation,
  workspaceTitle?: string,
) {
  if (
    operation.type === "artifact.create" &&
    operation.input.blueprintKey === "flashcard_deck"
  ) {
    return [
      `Validating ${operation.input.content.cards.length} cards`,
      `Saving deck${workspaceTitle ? ` to ${workspaceTitle}` : " to Artifacts"}`,
    ];
  }
  if (
    operation.type === "artifact.create" &&
    operation.input.blueprintKey === "quiz"
  ) {
    return [
      `Validating ${operation.input.content.questions.length} questions`,
      `Saving quiz${workspaceTitle ? ` to ${workspaceTitle}` : " to Artifacts"}`,
    ];
  }
  if (
    operation.type === "artifact.create" &&
    operation.input.blueprintKey === "document"
  )
    return [
      `Validating ${operation.input.content.blocks.length} document blocks`,
      `Saving document${workspaceTitle ? ` to ${workspaceTitle}` : " to Artifacts"}`,
    ];
  if (
    operation.type === "artifact.create" &&
    operation.input.blueprintKey === "planner_task"
  )
    return [
      "Validating planner task",
      `Saving task${workspaceTitle ? ` to ${workspaceTitle}` : " to Artifacts"}`,
    ];
  return [operationLabel(operation)];
}

export function progressiveArtifactFrames(
  blueprintKey: string,
  rawContent: unknown,
) {
  const content = rawContent as Record<string, unknown>;
  if (blueprintKey === "sheets") {
    // Cell-exact paths only — never advertise "/" which floods the grid.
    const cellPaths = sheetsCellHighlightPaths(content);
    return [
      {
        content,
        progress: 0.78,
        changedPaths: cellPaths,
      },
    ];
  }
  const listKey =
    blueprintKey === "document"
      ? "blocks"
      : blueprintKey === "flashcard_deck"
        ? "cards"
        : blueprintKey === "quiz"
          ? "questions"
          : blueprintKey === "presentation"
            ? "slides"
            : blueprintKey === "code"
              ? "files"
              : blueprintKey === "whiteboard"
                ? "nodes"
                : blueprintKey === "timetable"
                  ? "events"
                  : blueprintKey === "planner_task"
                    ? "subtasks"
                    : null;
  if (
    !listKey ||
    !Array.isArray(content[listKey]) ||
    content[listKey].length === 0
  )
    return [
      {
        content,
        progress: 0.78,
        changedPaths: ["/"] as string[],
      },
    ];
  const rows = content[listKey] as unknown[];
  const frameCount = Math.min(5, rows.length);
  return Array.from({ length: frameCount }, (_, index) => {
    const count = Math.max(
      1,
      Math.ceil(rows.length * ((index + 1) / frameCount)),
    );
    const slice = rows.slice(0, count);
    // Prefer concrete collection paths so studios light formed items; keep "/"
    // as a companion so nested fields (edges, objects, profile) also match.
    const changedPaths = [
      "/",
      ...slice.map((_, itemIndex) => `/${listKey}/${itemIndex}`),
    ];
    return {
      content: { ...content, [listKey]: slice },
      progress: Math.min(0.92, (count / rows.length) * 0.92),
      changedPaths,
    };
  });
}

export function effectChangedPathsForUpdate(
  operation: Extract<ModelOperation, { type: "artifact.update" }>,
  previewContent?: unknown,
): string[] {
  const content =
    previewContent !== undefined
      ? previewContent
      : (operation.input.content ?? undefined);
  if (operation.input.contentPatch?.changes.length) {
    return highlightPathsFromContentPatchChanges(
      operation.input.contentPatch.changes,
      content ?? {},
      operation.input.blueprintKey,
    );
  }
  if (operation.input.content !== null) {
    return materializeAiChangedPaths(
      ["/"],
      content ?? {},
      operation.input.blueprintKey,
    );
  }
  return [];
}

export function applyContentPatch(
  content: unknown,
  patch: { changes: Array<{ path: string; value: unknown }> },
) {
  // Resolves `/blocks/id:<blockId>/…` (and numeric indices) before writing so
  // document patches stay stable when the model targets heading identity.
  return applyResolvedContentPatch(content, patch);
}

export async function executeOperation(
  actorClerkId: string,
  runId: string,
  operationId: string,
  operation: ModelOperation,
  context: {
    executionId: string;
    surface: Surface;
    threadId?: string;
    workspaceId?: string;
    scopeNodeId?: string;
    selectedArtifactIds?: string[];
    attachmentNames?: string[];
    attachmentIds?: string[];
    researchEvidence?: unknown;
    contextSummary?: string;
    prompt?: string;
    pendingArtifactId?: string;
    pendingWorkspaceId?: string;
    preclaimed?: boolean;
    signal?: AbortSignal;
    operationIndex?: number;
    onRegionConflict?: (conflict: {
      regionId: string;
      queuePosition: number;
      actorKind: "human" | "ai";
    }) => void | Promise<void>;
    onRegionConflictResolved?: () => void | Promise<void>;
    onArtifactRegions?: (info: {
      artifactId: string;
      regionIds: string[];
    }) => void;
    onApplicationResult?: (result: {
      command: string;
      args: Record<string, unknown>;
      result: Record<string, unknown>;
    }) => void;
    collaborationClientId?: string;
    onUiEvent?: (event: {
      key: string;
      payload?: Record<string, unknown>;
    }) => void;
  },
) {
  throwIfAborted(context.signal);
  await mutate(
    context.preclaimed
      ? "spectraOperations:assertClaimed"
      : "spectraOperations:claim",
    { actorClerkId, operationId, executionId: context.executionId },
  );
  let output: Record<string, unknown> = {};
  let affected: Array<{ type: string; id: string }> = [];
  if (operation.type === "artifact.create") {
    const input = operation.input;
    // Never write or finalize a default/empty shell as a completed create.
    assertCreateContentNotHollow(input.blueprintKey, input.content, "create");
    const creationSummary = normalizeCreationSummary(
      input.summary,
      input.blueprintKey,
      input.title,
      input.content,
      context.contextSummary ?? "",
    );
    const workspaceId =
      input.placement === "inbox"
        ? undefined
        : (input.workspaceId ??
          (context.surface === "workspace" || context.surface === "artifact"
            ? context.workspaceId
            : undefined));
    let pendingArtifactId = context.pendingArtifactId;
    let pendingNodeId: string | undefined;
    if (!pendingArtifactId) {
      const pending = await mutate<
        unknown & object,
        { artifactId: string; nodeId?: string }
      >("spectraArtifacts:createPending", {
        actorClerkId,
        blueprintKey: input.blueprintKey,
        title: input.title,
        workspaceId,
        runId,
        threadId: context.threadId,
        executionId: context.executionId,
        sourceAttachmentIds: context.attachmentIds,
      });
      pendingArtifactId = pending.artifactId;
      pendingNodeId = pending.nodeId;
    }
    const mutationResult = await applyAiArtifactMutation({
      artifactId: pendingArtifactId,
      runId,
      operationId,
      executionId: context.executionId,
      replacePendingCreate: true,
      signal: context.signal,
      onConflict: context.onRegionConflict,
      onConflictResolved: context.onRegionConflictResolved,
      collaborationClientId: context.collaborationClientId,
      prompt: context.prompt,
      resolveDesired: () => ({
        title: input.title,
        summary: creationSummary,
        content: input.content,
        tags: input.tags,
      }),
    });
    console.info("[spectra.ai.artifact.create-phase]", {
      phase: "yjs-applied",
      artifactId: pendingArtifactId,
      runId,
      operationId,
      changedRegionCount: mutationResult.changedRegionIds?.length ?? 0,
    });
    const changedRegionIds = mutationResult.changedRegionIds ?? [];
    const effectProgress = operationEffectProgress(
      operation,
      context.operationIndex ?? 0,
    );
    if (effectProgress) {
      await mutate("spectraArtifacts:updateAiEffect", {
        actorClerkId,
        artifactId: pendingArtifactId,
        runId,
        executionId: context.executionId,
        title: effectProgress.title,
        detail: effectProgress.detail,
        activity: effectProgress.activity,
        regionHint: effectProgress.regionHint,
        ...(context.operationIndex !== undefined
          ? { operationIndex: context.operationIndex }
          : {}),
        regionIds: changedRegionIds,
        changedPaths: ["/"],
      });
    }
    if (changedRegionIds.length)
      context.onArtifactRegions?.({
        artifactId: pendingArtifactId,
        regionIds: changedRegionIds,
      });
    // Yjs client sync can acknowledge before Convex projection writes
    // currentVersionId / liveStateVectorHash. Poll briefly so a successful
    // apply is not falsely labeled failed in the run strip.
    {
      const finalizeDeadline = Date.now() + 10_000;
      let finalizeError: unknown;
      while (true) {
        try {
          console.info("[spectra.ai.artifact.create-phase]", {
            phase: "finalize-attempt",
            artifactId: pendingArtifactId,
            runId,
            operationId,
          });
          output = (await mutate("spectraArtifacts:finalizePendingLive", {
            actorClerkId,
            artifactId: pendingArtifactId,
            runId,
            executionId: context.executionId,
            summary: creationSummary,
          })) as Record<string, unknown>;
          finalizeError = undefined;
          console.info("[spectra.ai.artifact.create-phase]", {
            phase: "finalized",
            artifactId: pendingArtifactId,
            runId,
            operationId,
          });
          break;
        } catch (error) {
          finalizeError = error;
          const message =
            error instanceof Error ? error.message : String(error);
          const waitingOnProjection =
            /has not finished synchronizing|synchronized AI version is unavailable/i.test(
              message,
            );
          if (!waitingOnProjection || Date.now() >= finalizeDeadline)
            throw error;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      if (finalizeError) throw finalizeError;
    }
    if (context.researchEvidence && typeof output.artifactId === "string")
      await act("spectraArtifacts:attachResearchEvidence", {
        actorClerkId,
        artifactId: output.artifactId,
        runId,
        executionId: context.executionId,
      });
    if (!output.nodeId && pendingNodeId) output.nodeId = pendingNodeId;
    if (typeof output.artifactId === "string")
      affected.push({ type: "artifact", id: output.artifactId });
    if (typeof output.nodeId === "string")
      affected.push({ type: "workspaceItem", id: output.nodeId });
    if (typeof output.nodeId === "string" && input.pinned) {
      await mutate("orgTree:setPinned", {
        actorClerkId,
        nodeId: output.nodeId,
        pinned: true,
        exclusive: input.exclusivePin,
      });
    }
    if (typeof output.artifactId === "string") {
      for (const sourceArtifactId of context.selectedArtifactIds ?? []) {
        await mutate("spectraArtifactLinks:create", {
          actorClerkId,
          sourceArtifactId: output.artifactId,
          targetArtifactId: sourceArtifactId,
          relationType: "generated_from",
          workspaceId,
          createdBy: "ai",
          runId,
          explanation: "Created from explicit selected-object context",
        });
      }
    }
  } else if (operation.type === "artifact.update") {
    const input = operation.input;
    const artifact = await query<
      { actorClerkId: string; artifactId: string },
      { blueprintKey: string; nativeFormat?: string }
    >("spectraArtifacts:get", { actorClerkId, artifactId: input.artifactId });
    if (artifact.blueprintKey !== input.blueprintKey)
      throw new Error(
        "The artifact update blueprint does not match the live artifact.",
      );
    const replicaTruth = await query<
      { workId: string },
      {
        replicas: Array<{
          kind?: string;
          state?: string;
          nativeFormat?: string;
        }>;
      }
    >("replicas:forWork", { workId: input.artifactId }).catch(() => null);
    const localNative = replicaTruth?.replicas.find(
      (replica) =>
        replica.kind === "local" &&
        replica.state !== "unavailable" &&
        replica.nativeFormat,
    );
    const nativeFormat = (
      artifact.nativeFormat ?? localNative?.nativeFormat
    )?.toLowerCase();
    const officeKind = linkedOfficeKind(nativeFormat);
    let academicBefore: unknown;
    let academicDesired: unknown;
    const resolveAcademic = (current: unknown) => {
      verifyAcademicSourceHandles(current, input.documentOperations!);
      academicBefore = current;
      academicDesired = applyDocumentAcademicOperations(current, input.documentOperations!);
      return academicDesired;
    };
    const mutationResult = await applyAiArtifactMutation({
      artifactId: input.artifactId,
      runId,
      operationId,
      executionId: context.executionId,
      prompt: context.prompt,
      signal: context.signal,
      onConflict: context.onRegionConflict,
      onConflictResolved: context.onRegionConflictResolved,
      collaborationClientId: context.collaborationClientId,
      beforeCommit: officeKind
        ? async (commit) => {
            if (!commit.changedRegionIds.some(isNativeContentRegion)) return;
            return promoteNativeAiContent({
              workId: input.artifactId,
              blueprintKey: artifact.blueprintKey,
              nativeFormat: nativeFormat!,
              commit,
              aiOperation: { runId, executionId: context.executionId, operationId },
            });
          }
        : undefined,
      resolveDesired: (current) => ({
        title: input.title ?? current.title,
        ...(input.summary !== null
          ? { summary: input.summary }
          : current.summary
            ? { summary: current.summary }
            : {}),
        tags: input.tags ?? current.tags,
        content: input.documentOperations
          ? resolveAcademic(current.content)
          : input.contentPatch
          ? applyContentPatch(current.content, input.contentPatch)
          : (input.content ?? current.content),
      }),
    });
    output = mutationResult as Record<string, unknown>;
    const changedRegionIds = mutationResult.changedRegionIds ?? [];
    // Durable Convex content can lag the Yjs ack. Commit the live document
    // explicitly so verify (and collaborators) never race a false miss.
    {
      const live = await readLiveArtifactValue({
        artifactId: input.artifactId,
        timeoutMs: 5_000,
      }).catch(() => null);
      if (input.documentOperations && (!live || !documentAcademicEffectsLanded(academicBefore, academicDesired, live.content))) throw new Error("The complete academic edit could not be verified in the saved collaborative document. Reload before retrying.");
      if (live) {
        await mutate("spectraArtifacts:stageAiPatch", {
          actorClerkId,
          artifactId: input.artifactId,
          runId,
          executionId: context.executionId,
          title: live.title,
          ...(live.summary !== undefined ? { summary: live.summary } : {}),
          content: await storeArtifactContent(input.artifactId, encodeArtifactContentForStorage(
            artifact.blueprintKey,
            live.content,
          )),
          tags: live.tags,
          changedPaths: effectChangedPathsForUpdate(operation),
          ...(context.operationIndex !== undefined
            ? { operationIndex: context.operationIndex }
            : {}),
          commit: true,
        }).catch(() => null);
      }
    }
    if (context.researchEvidence)
      await act("spectraArtifacts:attachResearchEvidence", {
        actorClerkId,
        artifactId: input.artifactId,
        runId,
        executionId: context.executionId,
      });
    const effectProgress = operationEffectProgress(
      operation,
      context.operationIndex ?? 0,
    );
    if (effectProgress) {
      await mutate("spectraArtifacts:updateAiEffect", {
        actorClerkId,
        artifactId: input.artifactId,
        runId,
        executionId: context.executionId,
        title: effectProgress.title,
        detail: effectProgress.detail,
        activity: effectProgress.activity,
        regionHint: effectProgress.regionHint,
        ...(context.operationIndex !== undefined
          ? { operationIndex: context.operationIndex }
          : {}),
        regionIds: changedRegionIds,
        changedPaths: effectChangedPathsForUpdate(operation),
      });
    }
    if (changedRegionIds.length)
      context.onArtifactRegions?.({
        artifactId: input.artifactId,
        regionIds: changedRegionIds,
      });
    affected = [{ type: "artifact", id: input.artifactId }];
  } else if (operation.type === "artifact.archive") {
    output = (await mutate("spectraArtifactWrites:archive", {
      actorClerkId,
      runId,
      executionId: context.executionId,
      operationId,
      artifactId: operation.input.artifactId,
    })) as Record<string, unknown>;
    affected = [{ type: "artifact", id: operation.input.artifactId }];
  } else if (operation.type === "workspaceItem.add") {
    output = (await mutate("orgTree:placeWork", {
      actorClerkId,
      ...operation.input,
    })) as Record<string, unknown>;
    affected = [
      { type: "artifact", id: operation.input.artifactId },
      { type: "workspace", id: operation.input.workspaceId },
    ];
  } else if (operation.type === "workspaceItem.hide") {
    output = (await mutate("orgTree:removeFromWorkspace", {
      actorClerkId,
      nodeId: operation.input.nodeId,
    })) as Record<string, unknown>;
    affected = [{ type: "workspaceItem", id: operation.input.nodeId }];
    if (typeof output.workspaceId === "string")
      affected.push({ type: "workspace", id: output.workspaceId });
    if (typeof output.generalWorkspaceId === "string")
      affected.push({ type: "workspace", id: output.generalWorkspaceId });
    if (typeof output.sourceId === "string" && output.kind === "work")
      affected.push({ type: "artifact", id: output.sourceId });
  } else if (operation.type === "workspaceItem.setPinned") {
    output = (await mutate("orgTree:setPinned", {
      actorClerkId,
      ...operation.input,
    })) as Record<string, unknown>;
    affected = [{ type: "workspaceItem", id: operation.input.nodeId }];
  } else if (operation.type === "workspace.create") {
    const workspaceId = context.pendingWorkspaceId
      ? (
          await mutate<unknown & object, { workspaceId: string }>(
            "spectraWorkspaces:finalizePending",
            {
              actorClerkId,
              workspaceId: context.pendingWorkspaceId,
              runId,
              executionId: context.executionId,
              title: operation.input.title,
              description: operation.input.description ?? undefined,
              icon: operation.input.icon ?? undefined,
              color: operation.input.color ?? undefined,
            },
          )
        ).workspaceId
      : ((await mutate("spectraWorkspaces:create", {
          actorClerkId,
          title: operation.input.title,
          description: operation.input.description ?? undefined,
          icon: operation.input.icon ?? undefined,
          color: operation.input.color ?? undefined,
        })) as string);
    output = { workspaceId };
    affected = [{ type: "workspace", id: workspaceId }];
  } else if (operation.type === "workspace.update") {
    output = (await mutate("spectraWorkspaces:update", {
      actorClerkId,
      workspaceId: operation.input.workspaceId,
      title: operation.input.title ?? undefined,
      description: operation.input.description ?? undefined,
      icon: operation.input.icon ?? undefined,
      color: operation.input.color ?? undefined,
      runId,
      executionId: context.executionId,
    })) as Record<string, unknown>;
    affected = [{ type: "workspace", id: operation.input.workspaceId }];
  } else if (operation.type === "artifact.link") {
    output = (await mutate("spectraArtifactLinks:create", {
      actorClerkId,
      sourceArtifactId: operation.input.sourceArtifactId,
      targetArtifactId: operation.input.targetArtifactId,
      relationType: operation.input.relationType,
      label: operation.input.label ?? undefined,
      explanation: operation.input.explanation ?? undefined,
      workspaceId: operation.input.workspaceId ?? undefined,
      createdBy: "ai",
      runId,
    })) as Record<string, unknown>;
    affected = [
      { type: "artifact", id: operation.input.sourceArtifactId },
      { type: "artifact", id: operation.input.targetArtifactId },
    ];
  } else if (operation.type === "app.command") {
    throwIfAborted(context.signal);
    output = (await executeApplicationCommand(
      actorClerkId,
      runId,
      context.executionId,
      operation.input.command,
      operation.input.args,
      context.scopeNodeId,
      context.onUiEvent,
      context.signal,
      operationId,
    )) as Record<string, unknown>;
    context.onApplicationResult?.({
      command: operation.input.command,
      args: operation.input.args,
      result: output,
    });
    affected = operation.input.command === "insert_reference"
      ? [{ type: "artifact", id: String(operation.input.args.hostWorkId) }]
      : operation.input.command === "add_comment"
        ? [{ type: "artifact", id: String(operation.input.args.artifactId) }]
      : [];
  }
  await mutate("spectraOperations:markExecuted", {
    actorClerkId,
    operationId,
    executionId: context.executionId,
    output,
    affected,
  });
  return affected;
}

export function resolveCreatedArtifactDependencies(
  operation: ModelOperation,
  createdArtifactIds: ReadonlyMap<number, string>,
): ModelOperation {
  const resolve = (value: string) => {
    const match = /^@created:(\d+)$/.exec(value);
    if (!match) return value;
    const artifactId = createdArtifactIds.get(Number(match[1]));
    if (!artifactId)
      throw new Error(
        "A dependent artifact operation ran before its source artifact was ready.",
      );
    return artifactId;
  };
  operation = mapOperationArtifactReferences(operation, resolve);
  if (operation.type === "app.command") {
    const args = { ...operation.input.args };
    const isCalendarSchedule =
      normalizeCalendarCommand(operation.input.command) ===
      "schedule_calendar_task";
    // A planner artifact is not a calendarItems row. When a model carries the
    // same @created reference into taskItemId, prefer the canonical planner
    // identity and use the stable root task id exposed by Calendar.
    if (
      isCalendarSchedule &&
      typeof args.planArtifactId === "string" &&
      args.planArtifactId.trim()
    ) {
      delete args.taskItemId;
      if (typeof args.planTaskId !== "string" || !args.planTaskId.trim())
        args.planTaskId = "task-1";
    }
    return {
      ...operation,
      input: { ...operation.input, args },
    };
  }
  return operation;
}
