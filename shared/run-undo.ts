/**
 * What "Undo this run" can reverse. Each AI write is journaled as an operation
 * with its result, and with the state it replaced when the result alone cannot
 * put it back. Everything named here has a way back; anything else is reported
 * to the user as left as it was, never silently skipped.
 */
const REVERSIBLE_COMMANDS = new Set([
  "add_comment",
  "manage_comment",
  "organize_library",
  "delete_library_items",
  "restore_library_items",
  "pin_library_item",
  "manage_conversation",
  "change_spectra_settings",
  "change_sync_policy",
  "schedule_calendar_task",
  "create_calendar_personal_event",
  "move_calendar_block",
  "resize_calendar_block",
  "complete_calendar_block",
  "remove_calendar_event",
  "change_sharing",
]);

/** Writes that change nothing the user owns, so they neither arm Undo nor need a way back. */
const NOTHING_TO_UNDO = new Set(["show_work", "save_version", "trigger_managebac_sync", "navigate_spectra", "read_devices"]);

export function commandCanBeReversed(command: unknown) {
  return typeof command === "string" && REVERSIBLE_COMMANDS.has(command);
}

export function commandHasNothingToUndo(command: unknown) {
  return typeof command === "string" && NOTHING_TO_UNDO.has(command);
}

export type RunUndoCounts = {
  works: number;
  restored: number;
  events: number;
  comments: number;
  library: number;
  settings: number;
  sharing: number;
  memory: number;
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** One sentence the student can check against what they see. */
export function runUndoSummary(counts: Partial<RunUndoCounts>) {
  const parts = [
    counts.works ? `moved ${plural(counts.works, "new artifact", "new artifacts")} to the Trash` : "",
    counts.restored ? `restored ${plural(counts.restored, "artifact", "artifacts")}` : "",
    counts.events ? `put ${plural(counts.events, "calendar change", "calendar changes")} back` : "",
    counts.comments ? `reversed ${plural(counts.comments, "comment change", "comment changes")}` : "",
    counts.library ? `reversed ${plural(counts.library, "Library change", "Library changes")}` : "",
    counts.settings ? `put ${plural(counts.settings, "setting", "settings")} back` : "",
    counts.sharing ? `took back ${plural(counts.sharing, "sharing change", "sharing changes")}` : "",
    counts.memory ? "put Spectra's memory back" : "",
  ].filter(Boolean);
  if (!parts.length) return "There was nothing left to undo.";
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `Undone: ${list}.`;
}
