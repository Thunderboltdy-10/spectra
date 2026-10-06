import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { mutation } from "./functions";
import { getAuthenticatedActor } from "./identityShared";
import { normalizeAiPreferencePatch } from "../src/features/spectra/settings/schema/preferences";
import { patchTouchesAiPermissions } from "../src/features/spectra/settings/schema/ai-permissions";
import { applicationApprovalScope, applicationOperationScope, applicationWriteReceipt } from "./spectraApplicationWriteScope";
import { mapOperationArtifactReferences } from "../src/features/spectra/operations/dependencies";
import type { ModelOperation } from "../src/features/spectra/operations/schema";
import { normalizeCalendarTimeInput } from "../shared/calendar-time";
import { aiRefreshRequest } from "../shared/school-sync";
import { applicationCommandCategory, LOCAL_FILE_COMMANDS } from "../shared/ai-application-approval";
import { vUiObservationFence } from "./spectraUiObservationSchema";
import { assertUiObservationFence } from "./spectraUiObservation";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const strings = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

function semanticInput(input: Row) {
  const args = { ...row(input.args) };
  delete args.localFileCount;
  delete args.localFileCountUnknown;
  if (input.command === "organize_library" && !Array.isArray(args.targetIds)) args.targetIds = [];
  return { command: input.command, args };
}

/** A fixed semantic dispatch. Callers cannot supply a Convex function name. */
function mutationFor(command: string, args: Row, runId: string, executionId: string, operationId: string, scopeNodeId?: string, derived?: { publicLinkTokenHash: string }) {
  const targetIds = strings(args.targetIds);
  const destination = typeof args.destinationId === "string" && args.destinationId.trim() ? args.destinationId.trim() : scopeNodeId;
  switch (command) {
    case "add_comment": return { name: "artifactComments:create", args: {
      artifactId: args.artifactId,
      body: String(args.body ?? ""),
      ...(typeof args.parentCommentId === "string" ? { parentCommentId: args.parentCommentId } : {}),
      anchor: {
        regionId: String(row(args.anchor).regionId ?? "work:root"),
        ...(typeof row(args.anchor).fallbackExcerpt === "string"
          ? { fallbackExcerpt: row(args.anchor).fallbackExcerpt }
          : {}),
      },
      mentionedAccountIds: [],
      aiRunId: runId,
      aiExecutionId: executionId,
      aiOperationId: operationId,
    } };
    case "manage_comment": {
      const commentId = String(args.commentId ?? "");
      switch (args.action) {
        case "resolve": return { name: "artifactComments:setResolved", args: { commentId, resolved: true } };
        case "reopen": return { name: "artifactComments:setResolved", args: { commentId, resolved: false } };
        case "edit": return { name: "artifactComments:updateBody", args: { commentId, body: String(args.body ?? "") } };
        case "delete": return { name: "artifactComments:remove", args: { commentId } };
      }
      break;
    }
    case "manage_embed": {
      const embedId = String(args.embedId ?? "");
      switch (args.action) {
        case "resize": return { name: "artifactEmbeds:update", args: { embedId, mode: args.mode === "expanded" ? "expanded" : "compact" } };
        case "follow_live": return { name: "artifactEmbeds:update", args: { embedId, versionPolicy: "live" } };
        case "pin": return { name: "artifactEmbeds:update", args: { embedId, versionPolicy: "pinned", pinnedVersionId: String(args.versionId ?? "") } };
        case "remove": return { name: "artifactEmbeds:remove", args: { embedId } };
      }
      // recheck is an action; the harness calls it directly.
      break;
    }
    case "change_spectra_settings": return { name: "accountPreferences:writeLayer", args: { scope: "account", scopeKey: "account", values: normalizeAiPreferencePatch(args.patch) } };
    case "organize_library": {
      switch (args.action) {
        case "create_folder": return { name: "orgTree:createFolder", args: { name: String(args.name ?? "").trim(), ...(destination ? { parentId: destination } : {}) } };
        case "create_workspace": return { name: "spectraWorkspaces:create", args: { title: String(args.name ?? "").trim(), ...(destination ? { parentNodeId: destination } : {}) } };
        case "rename": return { name: "orgTree:rename", args: { nodeId: targetIds[0], name: String(args.name ?? "") } };
        case "move": return { name: "orgTree:move", args: { nodeIds: targetIds, ...(destination ? { parentId: destination } : {}) } };
        case "link": return { name: "orgTree:createReference", args: { targetNodeId: targetIds[0], ...(destination ? { parentId: destination } : {}) } };
      }
      break;
    }
    case "delete_library_items": return { name: "orgTree:trash", args: { nodeIds: targetIds } };
    case "restore_library_items": return { name: "orgTree:restore", args: { nodeIds: targetIds } };
    case "pin_library_item": return { name: "orgTree:setPinned", args: { nodeId: String(args.targetId ?? ""), pinned: args.pinned === true } };
    case "manage_conversation": return { name: "spectraThreads:update", args: {
      threadId: String(args.threadId ?? ""),
      ...(typeof args.title === "string" ? { title: args.title } : {}),
      ...(typeof args.pinned === "boolean" ? { pinned: args.pinned } : {}),
      ...(typeof args.archived === "boolean" ? { status: args.archived ? "archived" : "active" } : {}),
    } };
    case "save_version": return { name: "changeGroups:createNamedCheckpoint", args: { artifactId: String(args.artifactId ?? ""), name: String(args.name ?? "") } };
    case "remove_device": return { name: "bridge:revokeDevice", args: { deviceId: String(args.deviceId ?? "") } };
    case "change_sync_policy": return { name: "syncPolicy:patchItems", args: { itemIds: targetIds, patch: row(args.patch), actorKind: "ai", idempotencyKey: `ai:${runId}:${operationId}` } };
    case "write_memory": return args.action === "create"
      ? { name: "memory:remember", args: { proposition: String(args.content ?? "").trim(), scope: "private_global", claimType: "inferred_preference", sourceType: "user_statement", captureReason: "You explicitly asked Spectra to remember this." } }
      : { name: "memory:correct", args: { claimId: args.memoryId, proposition: String(args.content ?? "").trim() } };
    case "change_sharing": {
      const resourceType = String(args.resourceType ?? "artifact");
      const resourceId = String(args.resourceId ?? "");
      const level = args.level === "modify" ? "modify" : "read";
      switch (args.action) {
        case "invite": return { name: "authority:invite", args: { resourceType, resourceId, inviteeAccountId: String(args.subjectId ?? ""), level } };
        case "change_level": return { name: "authority:changeAcceptedLevel", args: { invitationId: String(args.invitationId ?? ""), level } };
        case "revoke": return { name: "authority:revoke", args: { resourceType, resourceId, grantId: String(args.grantId ?? "") } };
        case "withdraw_invitation": return { name: "authority:revokePendingInvitation", args: { invitationId: String(args.invitationId ?? "") } };
        case "set_exception": return { name: "authority:setArtifactException", args: {
          artifactId: resourceId,
          accountId: String(args.accountId ?? ""),
          effect: args.effect === "deny" ? "deny" : "restrict",
          ...(args.effect === "deny" ? {} : { maxLevel: "read" }),
        } };
        case "clear_exception": return { name: "authority:clearArtifactException", args: { artifactId: resourceId, accountId: String(args.accountId ?? "") } };
        case "create_public_link": {
          // Only the hash of a server-derived token arrives here, never the token.
          if (!derived?.publicLinkTokenHash) throw new Error("AI_PUBLIC_LINK_TOKEN_REQUIRED");
          const days = args.expiresInDays === 7 || args.expiresInDays === 30 ? args.expiresInDays : undefined;
          return { name: "authority:createPublicLink", args: {
            resourceType, resourceId, tokenHash: derived.publicLinkTokenHash, requestId: `ai:${operationId}`,
            ...(days ? { expiresAt: Date.now() + days * 24 * 60 * 60 * 1000 } : {}),
          } };
        }
        case "revoke_public_link": return { name: "authority:revokePublicLink", args: { linkId: String(args.linkId ?? "") } };
      }
      break;
    }
    case "trigger_managebac_sync": return { name: "managebac:requestAiRefresh", args: aiRefreshRequest(args.purpose, args.force) };
    case "select_managebac_classes": return { name: "managebac:setSelectedClasses", args: {
      recordIds: strings(args.recordIds),
      ...(typeof args.expectedRevision === "number" ? { expectedRevision: args.expectedRevision } : {}),
      ...(args.retention === "keep_in_spectra" || args.retention === "archive_projection" ? { retention: args.retention } : {}),
    } };
    case "set_school_sync_mode": return typeof args.providerClassId === "string"
      ? { name: "school:setClassOverride", args: { providerClassId: args.providerClassId, kind: args.kind, mode: args.mode ?? null } }
      : { name: "school:setMode", args: { kind: args.kind, mode: args.mode } };
    case "manage_class_workspaces": return args.action === "release"
      ? { name: "managebac:releaseClassWorkspaces", args: {
        recordIds: strings(args.recordIds),
        ...(args.retention === "keep_in_spectra" || args.retention === "archive_projection" ? { retention: args.retention } : {}),
      } }
      : { name: "managebac:materializeClassWorkspaces", args: { recordIds: strings(args.recordIds) } };
    case "schedule_calendar_task": {
      const time = normalizeCalendarTimeInput(args);
      return { name: "calendar:scheduleTask", args: {
        ...(typeof args.taskItemId === "string" ? { taskItemId: args.taskItemId } : {}),
        ...(typeof args.planArtifactId === "string" ? { planArtifactId: args.planArtifactId } : {}),
        ...(typeof args.planTaskId === "string" ? { planTaskId: args.planTaskId } : {}),
        startAt: time.startAt, endAt: time.endAt, timezone: args.timezone, actorKind: "ai", idempotencyKey: `ai:${runId}:${operationId}`,
      } };
    }
    case "create_calendar_personal_event": {
      const time = normalizeCalendarTimeInput(args);
      return { name: "calendar:createPersonalItem", args: {
        kind: "personal_event", title: args.title, ...(typeof args.notes === "string" ? { notes: args.notes } : {}),
        startAt: time.startAt, endAt: time.endAt, allDay: args.allDay === true, timezone: args.timezone, actorKind: "ai", idempotencyKey: `ai:${runId}:${operationId}`,
        ...(Array.isArray(args.linkedArtifactIds) ? { linkedArtifactIds: args.linkedArtifactIds } : {}),
      } };
    }
    case "move_calendar_block": return { name: "calendar:moveWorkBlock", args: { itemId: args.itemId, startAt: args.startAt, endAt: args.endAt, expectedRevision: args.expectedRevision } };
    case "resize_calendar_block": return { name: "calendar:resizeWorkBlock", args: { itemId: args.itemId, endAt: args.endAt, expectedRevision: args.expectedRevision } };
    case "complete_calendar_block": return { name: "calendar:completeWorkBlock", args: { itemId: args.itemId, expectedRevision: args.expectedRevision } };
    case "remove_calendar_event": return { name: "calendar:removePersonalItem", args: { itemId: args.itemId } };
  }
  throw new Error("AI_APPLICATION_WRITE_NOT_REGISTERED");
}

export const execute = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string(), operationId: v.id("spectraOperations"), expectedCommand: v.string(), expectedArgs: v.any(), uiObservation: v.optional(vUiObservationFence), derived: v.optional(v.object({ publicLinkTokenHash: v.string() })) },
  handler: async (ctx, args): Promise<unknown> => {
    const actor = await getAuthenticatedActor(ctx);
    const run = await ctx.db.get(args.runId);
    const operation = await ctx.db.get(args.operationId);
    if (!actor || !run || run.ownerAccountId !== actor._id || run.schoolId !== actor.schoolId || operation?.runId !== run._id || operation.actorType !== "ai")
      throw new Error("AI_APPLICATION_OPERATION_NOT_OWNED");
    if (run.executionId !== args.executionId || operation.executionId !== args.executionId)
      throw new Error("AI_APPLICATION_ATTEMPT_SUPERSEDED");
    const scope = applicationOperationScope(operation);
    if (operation.type !== "app.command") throw new Error("AI_APPLICATION_OPERATION_SCOPE_MISMATCH");
    const dependencies = new Set<number>();
    const modelOperation = { type: operation.type, input: operation.input } as ModelOperation;
    mapOperationArtifactReferences(modelOperation, (id) => { const match = /^@created:(\d+)$/.exec(id); if (match) dependencies.add(Number(match[1])); return id; });
    let resolved = modelOperation;
    if (dependencies.size) {
      const journal = (await ctx.db.query("spectraOperations").withIndex("by_run", (q) => q.eq("runId", run._id)).collect()).filter((entry) => entry.executionId === args.executionId);
      const consumerIndex = journal.findIndex((entry) => entry._id === operation._id);
      resolved = mapOperationArtifactReferences(modelOperation, (id) => {
        const match = /^@created:(\d+)$/.exec(id);
        if (!match) return id;
        const index = Number(match[1]);
        const producer = journal[index];
        const artifactId = row(producer?.output).artifactId;
        if (index >= consumerIndex || producer?.type !== "artifact.create" || producer.status !== "executed" || typeof artifactId !== "string")
          throw new Error("AI_APPLICATION_DEPENDENCY_NOT_EXECUTED");
        return artifactId;
      });
    }
    const input = semanticInput(row(resolved.input));
    const expected = { type: "app.command", input: semanticInput({ command: args.expectedCommand, args: args.expectedArgs }) };
    if (applicationOperationScope({ type: operation.type, input }) !== applicationOperationScope(expected))
      throw new Error("AI_APPLICATION_OPERATION_SCOPE_MISMATCH");
    const prior = applicationWriteReceipt(operation.output);
    if (prior) {
      if (prior.scope !== scope) throw new Error("AI_APPLICATION_RECEIPT_SCOPE_MISMATCH");
      return prior.result; // An uncertain reply replays the receipt, never the write.
    }
    if (run.status !== "running" || operation.status !== "executing")
      throw new Error("AI_APPLICATION_OPERATION_NOT_ACTIVE");
    // The AI never changes its own permissions, whatever the approval says.
    if (input.command === "change_spectra_settings" && patchTouchesAiPermissions(row(input.args).patch))
      throw new Error("AI_PERMISSION_SELF_GRANT: Spectra cannot change its own permissions. Only you can, in Settings.");
    let needsConfirmation = operation.requiresConfirmation || applicationCommandCategory(String(input.command), row(input.args)) !== null;
    const targetIds = strings(row(input.args).targetIds);
    // Moving items to the Trash is undoable, so like organising the library it
    // asks only when desktop files are affected, counted here.
    if (LOCAL_FILE_COMMANDS.has(String(input.command)) && targetIds.length) {
      const isPolicy = input.command === "change_sync_policy";
      const effect = await ctx.runQuery(makeFunctionReference<"query">(isPolicy ? "replicas:localEffectCount" : "replicas:localEffectCountForNodes"), isPolicy ? { workIds: targetIds } : { nodeIds: targetIds });
      const count = Number(row(effect).count);
      if (!Number.isFinite(count) || count < 0) throw new Error("AI_APPLICATION_LOCAL_EFFECT_UNKNOWN");
      const planned = row(row(operation.input).args);
      if (count > Number(planned.localFileCount ?? 0) && planned.localFileCountUnknown !== true)
        throw new Error("AI_APPLICATION_LOCAL_EFFECT_CHANGED");
      needsConfirmation ||= count > 0 || planned.localFileCountUnknown === true;
    }
    if (needsConfirmation && (run.approval?.status !== "accepted" || run.approval.executionId !== args.executionId ||
        row(operation.output).approvedApplicationScope !== await applicationApprovalScope(ctx, operation, run)))
      throw new Error("AI_APPLICATION_APPROVAL_SCOPE_REQUIRED");
    await assertUiObservationFence(operation, args.uiObservation, Date.now());
    const snapshot = row(run.contextSnapshot);
    const spec = mutationFor(String(input.command), row(input.args), String(run._id), args.executionId, String(operation._id), typeof snapshot.scopeNodeId === "string" ? snapshot.scopeNodeId : undefined, args.derived);
    // MutationCtx.runMutation executes inside this transaction. Its permission
    // checks, the effect, this run/operation read set and receipt commit together.
    // A concurrent Stop/steer conflicts with these reads and retries the guard.
    const result = await ctx.runMutation(makeFunctionReference<"mutation">(spec.name), spec.args);
    await ctx.db.patch(operation._id, { output: { ...row(operation.output), applicationWriteReceipt: { scope, result } } });
    return result;
  },
});
