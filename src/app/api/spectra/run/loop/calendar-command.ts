import { throwIfAborted } from "./abort";
import { evaluateCommandAuthority, recordAuthorityDecision } from "./authority";
import { mutate } from "./io";
import {
  authorityPublicMessage,
  authorityRequiresNotice,
} from "@/features/spectra/ai/authority-execution";
import {
  calendarChangedNote,
  calendarConvexMutation,
  calendarMutationPayload,
  calendarScheduleIdempotencyKey,
  calendarSemanticAction,
  calendarUndoInverse,
  interpretCalendarMutationResult,
  normalizeCalendarCommand,
  type CanonicalCalendarTool,
  type CalendarUndoInverse,
} from "@/features/spectra/calendar/domain/command";
import type { CalendarItem } from "@/features/spectra/calendar/domain/model";
import type { CalendarActionPostcondition } from "@/features/spectra/calendar/domain/actions";
import { spectraToolRegistry } from "@/features/spectra/tools/registry";
import { normalizeCalendarTimeInput } from "../../../../../../shared/calendar-time";

export type CalendarMutationResult = {
  ok: true;
  toolId: CanonicalCalendarTool;
  item: CalendarItem;
  undo: CalendarUndoInverse;
  status: "canonical_write";
  postcondition: CalendarActionPostcondition;
};

function asArgs(value: Record<string, unknown>): Record<string, unknown> {
  return normalizeCalendarTimeInput(value);
}

export async function executeRegisteredCalendarMutation(input: {
  actorClerkId: string;
  runId?: string;
  executionId?: string;
  operationId?: string;
  command: string;
  args: Record<string, unknown>;
  mutationScopeId?: string;
  signal?: AbortSignal;
  onUiEvent?: (event: {
    key: string;
    payload?: Record<string, unknown>;
  }) => void;
}): Promise<CalendarMutationResult> {
  throwIfAborted(input.signal);
  const toolId = normalizeCalendarCommand(input.command);
  if (!toolId) throw new Error(`APP_COMMAND_NOT_REGISTERED:${input.command}`);
  const definition = spectraToolRegistry.get(toolId);
  if (!definition) throw new Error(`APP_COMMAND_NOT_REGISTERED:${toolId}`);
  const parsed = definition.inputSchema.parse(asArgs(input.args)) as Record<
    string,
    unknown
  >;
  if (definition.aiAvailability === "prohibited")
    throw new Error(
      `AUTHORITY_PROHIBITED:${definition.prohibitionReason ?? definition.title}`,
    );
  if (definition.authorityTarget) {
    const authority = await evaluateCommandAuthority({
      actorClerkId: input.actorClerkId,
      command: toolId,
      args: parsed,
      authorityTarget: definition.authorityTarget,
    });
    await recordAuthorityDecision({
      actorClerkId: input.actorClerkId,
      runId: input.runId,
      executionId: input.executionId,
      command: toolId,
      decision: authority.decision,
      target: authority.target,
      reason: authority.reason,
      consequence: authority.consequence,
    });
    if (authority.decision === "prohibited")
      throw new Error(`AUTHORITY_PROHIBITED:${authority.reason}`);
    if (authorityRequiresNotice(authority.decision) && authority.notice)
      input.onUiEvent?.({
        key: "authority_notice",
        payload: {
          note: authority.notice,
          command: toolId,
          message: authorityPublicMessage(authority),
        },
      });
  }
  throwIfAborted(input.signal);
  const action = calendarSemanticAction(toolId, parsed);
  const scopeId =
    input.operationId?.trim() ||
    input.runId?.trim() ||
    input.mutationScopeId?.trim() ||
    input.executionId?.trim() ||
    crypto.randomUUID();
  const idempotencyKey = calendarScheduleIdempotencyKey({
    scopeId,
    toolId,
    action,
    requestedKey:
      typeof parsed.idempotencyKey === "string"
        ? parsed.idempotencyKey
        : undefined,
  });
  const itemWire = input.runId && input.executionId && input.operationId
    ? await mutate<Record<string, unknown>, Record<string, unknown>>("spectraApplicationWrites:execute", {
      runId: input.runId, executionId: input.executionId, operationId: input.operationId,
      expectedCommand: toolId, expectedArgs: input.args,
    })
    : await mutate<
    Record<string, unknown>,
    Record<string, unknown>
  >(calendarConvexMutation(toolId), calendarMutationPayload(action, idempotencyKey));
  const { item, postcondition } = interpretCalendarMutationResult(action, itemWire);
  const undo = calendarUndoInverse(toolId, item);
  input.onUiEvent?.({
    key: "calendar_changed",
    payload: {
      targetId: item.id,
      note: calendarChangedNote(toolId),
      undo,
    },
  });
  return { ok: true, status: "canonical_write", toolId, item, undo, postcondition };
}
