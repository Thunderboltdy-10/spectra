import { defineArtifactSkill } from "../types";
export const plannerTaskSkill = defineArtifactSkill({
  typeKey: "planner_task", purpose: "Represent actionable work with time, status, subtasks, provenance, and related resources.",
  createWhen: ["A commitment, assignment, deadline, or next action should be tracked and scheduled."], inspect: ["Read task fields and linked source provenance before proposing a change."],
  regions: ["description", "status", "priority", "time field", "subtask", "reminder", "relationship"], operations: ["Update fields, schedule, split into subtasks, link artifacts, and resolve source-overlay conflicts."],
  preservationRules: ["Never overwrite user overlays with connector updates; retain source provenance and completed work."], validation: ["Check time ordering, recurrence, timezone, source constraints, and duplicate tasks."],
  approvals: ["Ask before consequential rescheduling, bulk completion, or detaching a source record."], connections: ["Tasks appear in timetables and can link to class workspaces, threads, and artifacts."], workingEffects: ["The exact property changes in place with a short blue trace and synchronized confirmation."],
});
