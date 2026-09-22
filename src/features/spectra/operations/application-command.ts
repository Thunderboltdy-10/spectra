import { calendarSemanticAction, normalizeCalendarCommand } from "../calendar/domain/command";
import { spectraToolRegistry } from "../tools/registry";
import { normalizeAiPreferencePatch } from "../settings/schema/preferences";
import { normalizeCalendarTimeInput } from "../../../../shared/calendar-time";

export function normalizeApplicationCommand(command: string) {
  if (["school.sync", "school_data.sync", "managebac.sync"].includes(command))
    return "trigger_managebac_sync";
  return normalizeCalendarCommand(command) ?? command;
}

export function isRegisteredApplicationAction(command: string) {
  const id = normalizeApplicationCommand(command);
  return spectraToolRegistry.get(id)?.capability === "operate_application" || normalizeCalendarCommand(id) !== null;
}

/** Model calls are proposals in the existing operation journal. Only the
 * run executor may apply them, after identity, authority and approval fencing. */
export function prepareApplicationCommand(command: string, args: Record<string, unknown>) {
  command = normalizeApplicationCommand(command);
  const definition = spectraToolRegistry.get(command);
  if (!definition || !isRegisteredApplicationAction(command))
    throw new Error(`APP_COMMAND_NOT_REGISTERED:${command}`);
  if (definition.aiAvailability === "prohibited")
    throw new Error(`AUTHORITY_PROHIBITED:${definition.prohibitionReason ?? definition.title}`);
  const normalized = command === "change_spectra_settings"
    ? { ...args, patch: normalizeAiPreferencePatch(args.patch) }
    : normalizeCalendarCommand(command) ? normalizeCalendarTimeInput(args) : args;
  const parsed = definition.inputSchema.parse(normalized) as Record<string, unknown>;
  const calendarTool = normalizeCalendarCommand(command);
  if (calendarTool) calendarSemanticAction(calendarTool, parsed);
  // Consequence counts are server-computed after staging, never model grants.
  return { type: "app.command" as const, input: { command, args: parsed } };
}
