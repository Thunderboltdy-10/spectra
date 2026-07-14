import { defineArtifactSkill } from "../types";
export const timetableSkill = defineArtifactSkill({
  typeKey: "timetable", purpose: "Compose school, class, task, external, and personal time as provenance-aware layers.",
  createWhen: ["Events, deadlines, lessons, or tasks need a calendar or timetable representation."], inspect: ["Inspect the requested date range, timezone, visible layers, and source overlays."],
  regions: ["event", "time range", "recurrence", "layer", "location", "source overlay"], operations: ["Add, move, resize, recur, layer, import, reconcile, and validate events."],
  preservationRules: ["Preserve user overlays; tombstone removed source events rather than deleting related work."], validation: ["Check timezone, local recurrence rules, overlaps, end-after-start, and source constraints."],
  approvals: ["Preview broad schedule reorganizations and ambiguous connector conflicts."], connections: ["Planner tasks and ManageBac records appear as linked source layers."], workingEffects: ["Events form, move, or resize on the live grid while independent ranges update concurrently."],
});
