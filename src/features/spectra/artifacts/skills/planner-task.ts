import { defineArtifactSkill } from "../types";

export const plannerTaskSkill = defineArtifactSkill({
  typeKey: "planner_task",
  purpose:
    "Represent one useful, actionable commitment with scheduling, progress, subtasks, provenance, and permissioned supporting work.",
  createWhen: [
    "A commitment, assignment, deadline, follow-up, or concrete next action should be tracked.",
    "Use a timetable event for a time block without an actionable outcome, and use a document for substantial notes rather than overloading a task.",
  ],
  inspect: [
    "Read the live task fields, subtasks, schedule, recurrence, private overlay, linked artifacts, and source authority before proposing changes.",
    "Inspect permissioned linked sources only when they are relevant; never infer inaccessible content from titles or analytics.",
  ],
  regions: [
    "task title",
    "description block",
    "status",
    "priority",
    "start",
    "end",
    "due time",
    "estimate",
    "progress note",
    "subtask field",
    "reminder",
    "recurrence rule",
    "assignee",
    "watcher",
    "attachment",
    "linked artifact",
    "source field",
    "private overlay",
  ],
  operations: [
    "Encode every requested date, status, priority, estimate, reminder, and subtask in content, not just the title or summary. A request for N subtasks needs exactly N titled items. Calendar scheduling is a separate typed application action and never changes an official source deadline.",
    "Create a focused task, triage priority, decompose work into ordered subtasks, estimate effort, and schedule against the timetable.",
    "Update status and progress, add reminders, configure recurrence, link permissioned artifacts, and explain source/overlay conflicts.",
    "Reconcile safe ManageBac source changes while preserving user overlays, or propose a detach/rebase when authority is ambiguous.",
  ],
  preservationRules: [
    "Never overwrite personal target dates, notes, completion, reminders, subtasks, placements, or links with connector data.",
    "Preserve stable subtask IDs, completed work, attachments, source provenance, timezone intent, and inaccessible links.",
    "A removed source becomes tombstoned or detached; it does not delete the task or related user work.",
  ],
  validation: [
    "Require a useful title and valid IANA timezone; verify end-after-start, due-after-start, recurrence bounds, reminder timing, and duplicate source identity.",
    "Check that linked artifacts remain accessible, assignees are valid school members, and source-owned fields are not silently rewritten.",
  ],
  approvals: [
    "Preview and obtain approval before consequential rescheduling, recurrence-wide changes, assignment to another person, bulk completion, source detachment, or source-field override.",
    "Ordinary personal capture, safe decomposition, and non-conflicting source refreshes may proceed without interrupting the user.",
  ],
  connections: [
    "The same task projects into Home, workspace Board/Timeline, and Timetable without duplicate records.",
    "ManageBac assignments create provenance-bound tasks; documents, quizzes, decks, sheets, threads, and code artifacts may be linked as supporting work.",
  ],
  workingEffects: [
    "Animate only the exact title, date, status, subtask, reminder, or link being changed; independent regions may progress together.",
    "Clear every blue effect on completion, rejection, cancellation, permission loss, or failure and leave the normal task state intact.",
  ],
});
