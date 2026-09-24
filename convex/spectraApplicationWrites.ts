import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { mutation } from "./_generated/server";
import { getAuthenticatedActor } from "./identityShared";
import { normalizeAiPreferencePatch } from "../src/features/spectra/settings/schema/preferences";
import { applicationOperationScope, applicationWriteReceipt } from "./spectraApplicationWriteScope";
import { mapOperationArtifactReferences } from "../src/features/spectra/operations/dependencies";
import type { ModelOperation } from "../src/features/spectra/operations/schema";
import { normalizeCalendarTimeInput } from "../shared/calendar-time";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const strings = (value: unknown) => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
const confirmedCommands = new Set(["change_spectra_settings", "delete_library_items", "change_sync_policy", "change_sharing", "trigger_managebac_sync", "select_managebac_classes"]);

function semanticInput(input: Row) {
  const args = { ...row(input.args) };
  delete args.localFileCount;
  delete args.localFileCountUnknown;
  if (input.command === "organize_library" && !Array.isArray(args.targetIds)) args.targetIds = [];
  return { command: input.command, args };
}

/** A fixed semantic dispatch. Callers cannot supply a Convex function name. */
function mutationFor(command: string, args: Row, runId: string, operationId: string, scopeNodeId?: string) {
  const targetIds = strings(args.targetIds);
  const destination = typeof args.destinationId === "string" && args.destinationId.trim() ? args.destinationId.trim() : scopeNodeId;
  switch (command) {
    case "change_spectra_settings": return { name: "accountPreferences:writeLayer", args: { scope: "account", scopeKey: "account", values: normalizeAiPreferencePatch(args.patch) } };
    case "organize_library": {
      switch (args.action) {
        case "create_folder": return { name: "orgTree:createFolder", args: { name: String(args.name ?? "").trim(), ...(destination ? { parentId: destination } : {}) } };
        case "rename": return { name: "orgTree:rename", args: { nodeId: targetIds[0], name: String(args.name ?? "") } };
        case "move": return { name: "orgTree:move", args: { nodeIds: targetIds, ...(destination ? { parentId: destination } : {}) } };
        case "link": return { name: "orgTree:createReference", args: { targetNodeId: targetIds[0], ...(destination ? { parentId: destination } : {}) } };
      }
      break;
    }
    case "delete_library_items": return { name: "orgTree:trash", args: { nodeIds: targetIds } };
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
      }
      break;
    }
    case "trigger_managebac_sync": return { name: "managebac:requestAiRefresh", args: { reason: `ai_${String(args.purpose ?? "upcoming_deadlines")}`, force: args.force !== false } };
    case "select_managebac_classes": return { name: "managebac:setSelectedClasses", args: {
      recordIds: strings(args.recordIds),
      ...(typeof args.expectedRevision === "number" ? { expectedRevision: args.expectedRevision } : {}),
      ...(args.retention === "keep_in_spectra" || args.retention === "archive_projection" ? { retention: args.retention } : {}),
    } };
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
  }
  throw new Error("AI_APPLICATION_WRITE_NOT_REGISTERED");
}

export const execute = mutation({
  args: { runId: v.id("spectraAiRuns"), executionId: v.string(), operationId: v.id("spectraOperations"), expectedCommand: v.string(), expectedArgs: v.any() },
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
    let needsConfirmation = operation.requiresConfirmation || confirmedCommands.has(String(input.command));
    const targetIds = strings(row(input.args).targetIds);
    if (["organize_library", "delete_library_items", "change_sync_policy"].includes(String(input.command)) && targetIds.length) {
      const isPolicy = input.command === "change_sync_policy";
      const effect = await ctx.runQuery(makeFunctionReference<"query">(isPolicy ? "replicas:localEffectCount" : "replicas:localEffectCountForNodes"), isPolicy ? { workIds: targetIds } : { nodeIds: targetIds });
      const count = Number(row(effect).count);
      if (!Number.isFinite(count) || count < 0) throw new Error("AI_APPLICATION_LOCAL_EFFECT_UNKNOWN");
      const planned = row(row(operation.input).args);
      if (count > Number(planned.localFileCount ?? 0) && planned.localFileCountUnknown !== true)
        throw new Error("AI_APPLICATION_LOCAL_EFFECT_CHANGED");
      needsConfirmation ||= count > 0 || planned.localFileCountUnknown === true;
    }
    if (needsConfirmation && (run.approval?.status !== "accepted" || run.approval.executionId !== args.executionId || row(operation.output).approvedApplicationScope !== scope))
      throw new Error("AI_APPLICATION_APPROVAL_SCOPE_REQUIRED");
    const snapshot = row(run.contextSnapshot);
    const spec = mutationFor(String(input.command), row(input.args), String(run._id), String(operation._id), typeof snapshot.scopeNodeId === "string" ? snapshot.scopeNodeId : undefined);
    // MutationCtx.runMutation executes inside this transaction. Its permission
    // checks, the effect, this run/operation read set and receipt commit together.
    // A concurrent Stop/steer conflicts with these reads and retries the guard.
    const result = await ctx.runMutation(makeFunctionReference<"mutation">(spec.name), spec.args);
    await ctx.db.patch(operation._id, { output: { ...row(operation.output), applicationWriteReceipt: { scope, result } } });
    return result;
  },
});
