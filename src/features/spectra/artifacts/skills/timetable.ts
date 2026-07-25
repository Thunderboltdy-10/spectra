import { defineArtifactSkill } from "../types";

export const timetableSkill = defineArtifactSkill({
  typeKey: "timetable",
  purpose:
    "Compose school, class, task, external, and personal time as provenance-aware layers without hiding which source owns each field.",
  createWhen: [
    "Events, deadlines, lessons, study blocks, or availability need a calendar representation or coordinated plan.",
  ],
  inspect: [
    "Inspect only the requested date range, timezone, visible permissioned layers, hard constraints, availability, estimates, and source overlays.",
    "Load linked task or artifact details only when necessary to schedule or explain a tradeoff.",
    "For 'this week' / 'today' / relative ranges, use the Current date and time from the turn plus an IANA timezone (prefer the user's when known). Prefer the calendar week that contains today in that timezone — do not jump to next week unless only weekend remains and the plan clearly needs weekday slots.",
    "AI-created shared study/revision layers must use kind study (or class/tasks) with authority workspace or school — never authority user — so events persist in shared timetable content.",
  ],
  regions: [
    "layer setting",
    "event field",
    "time range",
    "occurrence",
    "series rule",
    "reminder",
    "availability window",
    "source field",
    "personal overlay",
  ],
  operations: [
    "Add, move, resize, recur, layer, import, reconcile, link, and validate events.",
    "Propose study blocks, replan around deadlines, preserve locked commitments, and explain scheduling tradeoffs.",
  ],
  preservationRules: [
    "Preserve personal overlays and local links; tombstone removed source events instead of deleting related work.",
    "Never rewrite source-owned class/deadline fields, expose private layers, or move locked events, sleep, accommodations, or hard constraints.",
  ],
  validation: [
    "Check IANA timezone and DST intent, recurrence/exceptions, end-after-start, overlaps, source authority, inaccessible links, duplicate feeds, and notification timing.",
  ],
  approvals: [
    "Preview shared event creation/movement/deletion, recurrence-wide changes, source-date overrides, and broad schedule reorganizations.",
  ],
  connections: [
    "Planner tasks and verified ManageBac records project into linked source layers; linked artifacts remain permission-bound.",
  ],
  workingEffects: [
    "The real event block forms, moves, or resizes while source badges, links, and reminders update in place; independent ranges may progress together.",
    "Every effect clears after success, failure, rejection, cancellation, permission loss, or navigation.",
  ],
});
