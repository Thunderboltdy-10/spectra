import { throwIfAborted } from "./abort";
import { mutate } from "./io";
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
import { parseApplicationCommand } from "./application-commands";

export type CalendarMutationResult = {
  ok: true;
  toolId: CanonicalCalendarTool;
  item: CalendarItem;
  undo: CalendarUndoInverse;
  status: "canonical_write";
  postcondition: CalendarActionPostcondition;
};

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
  // Calendar writes carry no authority class: they are undoable gestures.
  const { args: parsed } = parseApplicationCommand(toolId, input.args);
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
