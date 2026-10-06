import { storeArtifactContent } from "@/lib/convex-server";
import { throwIfAborted } from "./abort";
import { executeRegisteredCalendarMutation } from "./calendar-command";
import { normalizeCalendarCommand } from "@/features/spectra/calendar/domain/command";
import { normalizeApplicationCommand, parseApplicationCommand } from "./application-commands";
import { executeReferenceInsertion } from "./reference-command";
import { act, mutate, query } from "./io";
import {
  authorityPublicMessage,
  authorityRequiresNotice,
} from "@/features/spectra/ai/authority-execution";
import { evaluateCommandAuthority, recordAuthorityDecision } from "./authority";
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
import { catalogCommandForApplicationCommand } from "@/features/spectra/commands/ai-reach";
import { materializeAiChangedPaths } from "@/features/spectra/components/ai-region-path";
import { assertCreateContentNotHollow } from "@/features/spectra/operations/hollow-content";
import type { ModelOperation } from "@/features/spectra/operations/schema";
import { encodeArtifactContentForStorage } from "../../../../../../shared/sheet-cells";
import { normalizeAiPreferencePatch } from "@/features/spectra/settings/schema/preferences";
import { smartCompletionValue, type UiObservationFence } from "@/features/spectra/actions/protocol/semantic-action";
import { waitForSettingsAction } from "./ui-observation";
import { describeDevicesForAi, type CloudOverview } from "@/features/spectra/devices/devices-model";
import { aiRefreshRequest } from "../../../../../../shared/school-sync";

export function rows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

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
  const { args: parsed, authority: authorityTarget } = parseApplicationCommand(command, args);
  if (!catalogCommandForApplicationCommand(command))
    throw new Error(`APP_COMMAND_REGISTRY_DRIFT:${command}`);
  let uiObservation: UiObservationFence | undefined;
  const applyMutation: typeof mutate = async <TArgs extends object, TResult>(_name: string, _args: TArgs) => {
    throwIfAborted(signal);
    if (!operationId) throw new Error("APPLICATION_OPERATION_ID_REQUIRED");
    return mutate<object, TResult>("spectraApplicationWrites:execute", {
      runId, executionId, operationId, expectedCommand: command, expectedArgs: parsed,
      ...(uiObservation ? { uiObservation } : {}),
    });
  };
  if (authorityTarget) {
    const authority = await evaluateCommandAuthority({
      actorClerkId,
      command,
      args: parsed,
      authorityTarget,
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
    const observed = smartCompletionValue(patch) !== undefined && Boolean(operationId);
    const prepare = () => waitForSettingsAction({ runId, executionId, operationId: operationId! }, signal);
    let pacing = observed ? await prepare() : undefined;
    uiObservation = pacing?.fence;
    let settings: unknown;
    if (pacing?.committed) settings = pacing.committed.result;
    else {
      const apply = () => applyMutation("accountPreferences:writeLayer", {
        actorClerkId, scope: "account", scopeKey: "account", values: patch,
      });
      try {
        settings = await apply();
      } catch (error) {
        // A sealed lease can expire between readiness and the atomic write.
        // Re-read/expire that epoch once; never retry from timeout alone.
        if (!observed || !(error instanceof Error) || !error.message.includes("UI_OBSERVATION_STALE")) throw error;
        pacing = await prepare();
        uiObservation = pacing.fence;
        settings = pacing.committed ? pacing.committed.result : await apply();
      }
    }
    if (observed && uiObservation) await onUiEvent?.({
      key: "settings_toggle_committed",
      payload: { runId, executionId, operationId, ...uiObservation },
    });
    const changedSection = [
      "ai",
      "writing",
      "appearance",
      "workbar",
      "privacy",
      "integrations",
    ].find((section) => Object.hasOwn(patch, section));
    await onUiEvent?.({
      key: "settings_changed",
      payload: {
        targetId: changedSection && changedSection !== "integrations" ? changedSection : "ai",
        note: "Updated Spectra settings",
      },
    });
    return settings;
  }
  if (command === "read_devices") {
    const overview = await query<Record<string, never>, CloudOverview | null>("bridge:overview", {});
    return { devices: describeDevicesForAi(overview, Date.now()) };
  }
  if (command === "control_device" || command === "pair_device") {
    // These run on the user's computer, through the Spectra page open there
    // and its local Bridge; the page reports the result on Devices.
    const action = command === "pair_device" ? "pair" : String(parsed.action);
    const grantId = typeof parsed.grantId === "string" ? parsed.grantId : undefined;
    const deviceId = typeof parsed.deviceId === "string" ? parsed.deviceId : undefined;
    onUiEvent?.({
      key: "devices_action",
      payload: {
        action,
        actionId: `${executionId}:${operationId ?? action}`,
        ...(grantId ? { grantId } : {}),
        ...(deviceId ? { deviceId } : {}),
        note: action === "pair" ? "Connecting this computer" : "Working on your computer",
      },
    });
    return {
      ok: true,
      status: "requested",
      action,
      message:
        action === "pair"
          ? "Spectra is connecting the computer the user has it open on. The user confirms the code on the computer; check with devices status afterwards."
          : "Sent to Spectra on the user's computer, which runs it through Bridge. The Devices page shows the result; check with devices status.",
    };
  }
  if (command === "remove_device") {
    const result = await applyMutation("bridge:revokeDevice", { deviceId: String(parsed.deviceId) });
    onUiEvent?.({ key: "devices_changed", payload: { note: "Removed a device" } });
    return result;
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
    if (action === "create_workspace") {
      const name = String(parsed.name ?? "").trim();
      const result = await applyMutation("spectraWorkspaces:create", {
        title: name,
        ...(destinationId ? { parentNodeId: destinationId } : {}),
      });
      // spectraWorkspaces:create returns the new workspace's id.
      const workspaceId = typeof result === "string" ? result : "";
      onUiEvent?.({
        key: "organize_library",
        payload: {
          action,
          targetId: workspaceId,
          destinationId: destinationId ?? null,
          note: `Created the workspace ${name}`,
        },
      });
      return { workspaceId, name };
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
  if (command === "restore_library_items") {
    const targetIds = (parsed.targetIds as string[]);
    const result = await applyMutation("orgTree:restore", { nodeIds: targetIds });
    onUiEvent?.({
      key: "organize_library",
      payload: {
        action: "restore",
        targetId: targetIds[0],
        note: `Restored ${targetIds.length} item${targetIds.length === 1 ? "" : "s"} from the Trash`,
      },
    });
    return result;
  }
  if (command === "pin_library_item") {
    const targetId = String(parsed.targetId);
    const result = await applyMutation("orgTree:setPinned", { nodeId: targetId, pinned: parsed.pinned === true });
    onUiEvent?.({
      key: "organize_library",
      payload: { action: parsed.pinned ? "pin" : "unpin", targetId, note: parsed.pinned ? "Pinned in the library" : "Unpinned in the library" },
    });
    return result;
  }
  if (command === "manage_conversation") {
    const result = await applyMutation("spectraThreads:update", parsed);
    return result ?? { ok: true, threadId: parsed.threadId };
  }
  if (command === "save_version") {
    const artifactId = String(parsed.artifactId);
    const result = await applyMutation("changeGroups:createNamedCheckpoint", { artifactId, name: parsed.name });
    onUiEvent?.({ key: "version_saved", payload: { targetId: artifactId, note: `Saved the version ${String(parsed.name)}` } });
    return result;
  }
  if (command === "complete_calendar_block" || command === "remove_calendar_event") {
    const itemId = String(parsed.itemId);
    const result = await applyMutation(
      command === "complete_calendar_block" ? "calendar:completeWorkBlock" : "calendar:removePersonalItem",
      parsed,
    );
    onUiEvent?.({
      key: "calendar_changed",
      payload: { targetId: itemId, note: command === "complete_calendar_block" ? "Marked a work block done" : "Removed a Calendar event" },
    });
    return result;
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
    const result = await applyMutation("managebac:requestAiRefresh", aiRefreshRequest(parsed.purpose, parsed.force));
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
  if (command === "set_school_sync_mode") {
    const result = await applyMutation(parsed.providerClassId ? "school:setClassOverride" : "school:setMode", parsed);
    onUiEvent?.({
      key: "managebac_sync_preferences",
      payload: { targetId: "managebac", note: parsed.mode === null ? "This class follows your school sync choice again" : `School sync for ${String(parsed.kind).replace(/_/g, " ")} set to ${String(parsed.mode)}` },
    });
    return result;
  }
  if (command === "manage_class_workspaces") {
    const recordIds = parsed.recordIds as string[];
    const result = await applyMutation(
      parsed.action === "release" ? "managebac:releaseClassWorkspaces" : "managebac:materializeClassWorkspaces",
      parsed,
    );
    onUiEvent?.({
      key: "managebac_class_workspaces",
      payload: {
        targetId: "managebac",
        note: parsed.action === "release"
          ? `Released ${recordIds.length} class workspace${recordIds.length === 1 ? "" : "s"}`
          : `Made workspaces for ${recordIds.length} class${recordIds.length === 1 ? "" : "es"}`,
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
  if (command === "manage_comment") {
    const artifactId = String(parsed.artifactId);
    const commentId = String(parsed.commentId);
    const action = String(parsed.action);
    const result = await applyMutation(COMMENT_MUTATIONS[action] ?? "artifactComments:setResolved", { commentId });
    onUiEvent?.({
      key: "comment_changed",
      payload: { targetId: artifactId, commentId, action, note: COMMENT_NOTES[action] ?? "Changed a comment" },
    });
    return result ?? { ok: true, commentId };
  }
  throw new Error(`APP_COMMAND_NOT_REGISTERED:${command}`);
}

const COMMENT_MUTATIONS: Record<string, string> = {
  resolve: "artifactComments:setResolved",
  reopen: "artifactComments:setResolved",
  edit: "artifactComments:updateBody",
  delete: "artifactComments:remove",
};
const COMMENT_NOTES: Record<string, string> = {
  resolve: "Resolved a comment",
  reopen: "Reopened a comment",
  edit: "Edited a comment",
  delete: "Deleted a comment",
};

type UiEventSink = (event: { key: string; payload?: Record<string, unknown> }) => void;

export type EffectContext = {
  executionId: string;
  threadId?: string;
  /** The Library folder the user is in, for "here". */
  scopeNodeId?: string;
  prompt?: string;
  signal?: AbortSignal;
  /** The trace label of the step, shown on the artifact while it changes. */
  label?: string;
  onUiEvent?: UiEventSink;
};

type Affected = Array<{ type: string; id: string }>;

/** Show the AI's step on the artifact while it changes. Never fails a write. */
async function markArtifactEffect(
  actorClerkId: string,
  runId: string,
  artifactId: string,
  context: EffectContext,
  activity: "create" | "edit",
  regionIds: string[],
  changedPaths: string[],
) {
  await mutate("spectraArtifacts:updateAiEffect", {
    actorClerkId,
    artifactId,
    runId,
    executionId: context.executionId,
    title: (context.label ?? (activity === "create" ? "Writing" : "Editing")).replace(/\*/g, "").slice(0, 88),
    detail: activity === "create" ? "Writing the requested content" : "Changing only what was asked",
    activity,
    regionIds,
    changedPaths,
  }).catch(() => null);
}

/**
 * Apply one recorded operation through the same server paths as the user's
 * own controls: claim it, write it (live through the collaboration room for
 * artifacts), then record the receipt. Returns what it touched.
 */
export async function executeOperation(
  actorClerkId: string,
  runId: string,
  operationId: string,
  operation: ModelOperation,
  context: EffectContext,
): Promise<{ affected: Affected; output: Record<string, unknown> }> {
  throwIfAborted(context.signal);
  await mutate("spectraOperations:claim", { actorClerkId, operationId, executionId: context.executionId });
  let output: Record<string, unknown> = {};
  let affected: Affected = [];
  if (operation.type === "artifact.create") {
    const input = operation.input;
    // Never write or finalize a default/empty shell as a completed create.
    assertCreateContentNotHollow(input.blueprintKey, input.content, "create");
    const summary = (input.summary ?? "").trim() || input.title;
    const pending = await mutate<unknown & object, { artifactId: string; nodeId?: string }>(
      "spectraArtifacts:createPending",
      {
        actorClerkId,
        blueprintKey: input.blueprintKey,
        title: input.title,
        workspaceId: input.workspaceId ?? undefined,
        runId,
        threadId: context.threadId,
        executionId: context.executionId,
      },
    );
    await mutate("spectraOperations:attachPendingArtifact", {
      actorClerkId,
      operationId,
      artifactId: pending.artifactId,
      executionId: context.executionId,
    });
    const preparation = await act<
      { runId: string; executionId: string; operationId: string },
      { approvalReasons: string[] }
    >("spectraArtifactWrites:preparePlan", { runId, executionId: context.executionId, operationId });
    if (preparation.approvalReasons.length)
      throw new Error("The newly allocated artifact needs confirmation before it can be saved.");
    const mutationResult = await applyAiArtifactMutation({
      artifactId: pending.artifactId,
      runId,
      operationId,
      executionId: context.executionId,
      replacePendingCreate: true,
      signal: context.signal,
      prompt: context.prompt,
      resolveDesired: () => ({ title: input.title, summary, content: input.content, tags: input.tags }),
    });
    await markArtifactEffect(actorClerkId, runId, pending.artifactId, context, "create", mutationResult.changedRegionIds ?? [], ["/"]);
    // The Yjs acknowledgement can arrive before the Convex projection is
    // written. Wait briefly so a saved creation is not reported as failed.
    const deadline = Date.now() + 10_000;
    for (;;) {
      try {
        output = (await mutate("spectraArtifacts:finalizePendingLive", {
          actorClerkId,
          artifactId: pending.artifactId,
          runId,
          executionId: context.executionId,
          summary,
        })) as Record<string, unknown>;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const waiting = /has not finished synchronizing|synchronized AI version is unavailable/i.test(message);
        if (!waiting || Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!output.nodeId && pending.nodeId) output.nodeId = pending.nodeId;
    if (typeof output.artifactId === "string") affected.push({ type: "artifact", id: output.artifactId });
    if (typeof output.nodeId === "string") affected.push({ type: "workspaceItem", id: output.nodeId });
  } else if (operation.type === "artifact.update") {
    const input = operation.input;
    const artifact = await query<{ actorClerkId: string; artifactId: string }, { blueprintKey: string; nativeFormat?: string }>(
      "spectraArtifacts:get",
      { actorClerkId, artifactId: input.artifactId },
    );
    if (artifact.blueprintKey !== input.blueprintKey)
      throw new Error("The artifact update blueprint does not match the live artifact.");
    const replicaTruth = await query<
      { workId: string },
      { replicas: Array<{ kind?: string; state?: string; nativeFormat?: string }> }
    >("replicas:forWork", { workId: input.artifactId }).catch(() => null);
    const localNative = replicaTruth?.replicas.find(
      (replica) => replica.kind === "local" && replica.state !== "unavailable" && replica.nativeFormat,
    );
    const nativeFormat = (artifact.nativeFormat ?? localNative?.nativeFormat)?.toLowerCase();
    const officeKind = linkedOfficeKind(nativeFormat);
    const mutationResult = await applyAiArtifactMutation({
      artifactId: input.artifactId,
      runId,
      operationId,
      executionId: context.executionId,
      prompt: context.prompt,
      signal: context.signal,
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
        ...(input.summary !== null ? { summary: input.summary } : current.summary ? { summary: current.summary } : {}),
        tags: input.tags ?? current.tags,
        content: input.content ?? current.content,
      }),
    });
    output = mutationResult as Record<string, unknown>;
    const changedPaths =
      input.content !== null ? materializeAiChangedPaths(["/"], input.content ?? {}, input.blueprintKey) : [];
    // Durable Convex content can lag the Yjs acknowledgement. Commit the live
    // document so reads and collaborators never see an older copy.
    const live = await readLiveArtifactValue({ artifactId: input.artifactId, timeoutMs: 5_000 }).catch(() => null);
    if (live)
      await mutate("spectraArtifacts:stageAiPatch", {
        actorClerkId,
        artifactId: input.artifactId,
        runId,
        executionId: context.executionId,
        title: live.title,
        ...(live.summary !== undefined ? { summary: live.summary } : {}),
        content: await storeArtifactContent(
          input.artifactId,
          encodeArtifactContentForStorage(artifact.blueprintKey, live.content),
        ),
        tags: live.tags,
        changedPaths,
        commit: true,
      }).catch(() => null);
    await markArtifactEffect(actorClerkId, runId, input.artifactId, context, "edit", mutationResult.changedRegionIds ?? [], changedPaths);
    affected = [{ type: "artifact", id: input.artifactId }];
  } else if (operation.type === "app.command") {
    throwIfAborted(context.signal);
    output = ((await executeApplicationCommand(
      actorClerkId,
      runId,
      context.executionId,
      operation.input.command,
      operation.input.args,
      context.scopeNodeId,
      context.onUiEvent,
      context.signal,
      operationId,
    )) ?? {}) as Record<string, unknown>;
    affected =
      operation.input.command === "insert_reference"
        ? [{ type: "artifact", id: String(operation.input.args.hostWorkId) }]
        : operation.input.command === "add_comment"
          ? [{ type: "artifact", id: String(operation.input.args.artifactId) }]
          : [];
  } else {
    throw new Error(`The harness does not apply ${operation.type} operations.`);
  }
  await mutate("spectraOperations:markExecuted", {
    actorClerkId,
    operationId,
    executionId: context.executionId,
    output,
    affected,
  });
  return { affected, output };
}
