import { defineArtifactSkill } from "../types";

export const plannerTaskSkill = defineArtifactSkill({
  typeKey: "planner_task",
  purpose:
    "Build and maintain one connected Plan: tasks, hierarchy, dependencies, due dates, recurrence, labels, saved views, and calendar-backed workload.",
  createWhen: [
    "Several related commitments, assignments, deadlines, or follow-ups should be tracked together.",
    "Use Calendar for time blocks and official events. Plan may read those calendar items for workload, but never creates a second scheduling store.",
  ],
  inspect: [
    "Read the complete Plan v4 task graph, typed saved views, current filters, recurrence, reminders, labels, milestones, and source authority before proposing changes.",
    "Inspect Calendar only when workload or scheduling matters. Derive scheduled minutes from calendarItems and never trust legacy calendarBlockIds as time truth.",
  ],
  regions: [
    "plan description",
    "task title",
    "task description",
    "task status",
    "priority",
    "labels",
    "due time",
    "estimate",
    "parent task",
    "section",
    "milestone",
    "dependency",
    "checklist item",
    "reminder",
    "recurrence rule",
    "saved view",
    "source reference",
  ],
  operations: [
    "Create, rename, nest, move, prioritize, label, estimate, reschedule, complete, or delete tasks through the planner capability IR.",
    "Add and update checklist items, dependencies, recurrence, reminders, typed filters, saved List/Board/Timeline views, and bulk changes.",
    "Read workload from Calendar items, import personal tasks from CSV or TSV, and prepare CSV, ICS, or JSON copies.",
  ],
  preservationRules: [
    "Preserve stable task, checklist, view, and source IDs; never replace the Plan with a one-task legacy payload.",
    "Never move or recur an official deadline. Suggest personal work blocks around it in Calendar instead.",
    "Completing a recurring task advances the same task ID, resets its checklist, and records the completed occurrence.",
    "Live Todoist sync is unavailable in this unit. Offer a Todoist CSV import without implying synchronization.",
  ],
  validation: [
    "Require useful task titles, unique IDs, valid parent and dependency graphs, bounded labels/reminders, a valid IANA timezone, and typed saved-view filters.",
    "Natural due text must match the bounded grammar. If it is ambiguous, return the shared refusal and write no timestamp.",
    "Daily, weekly, monthly, and yearly recurrence must remain within interval, weekday, exception, and end-date bounds.",
  ],
  approvals: [
    "Preview and obtain approval before task deletion, bulk deletion, broad recurrence changes, or any rewrite of source-owned planning fields.",
    "Ordinary personal capture, safe decomposition, filtering, saved-view creation, and non-destructive field edits may proceed without interruption.",
  ],
  connections: [
    "List, Board, Timeline, saved views, AI, imports, and exports are projections of the same PlanContent.",
    "Workload reads scheduled_work_block calendarItems through the Calendar API. Editing those blocks happens in Calendar.",
    "Reminder timing is stored in Plan v4; P9.I2 owns schedule-at-write delivery.",
  ],
  workingEffects: [
    "Animate only the exact task, checklist, label, date, view, or reminder being changed; independent regions may progress together.",
    "Clear every working effect on completion, rejection, cancellation, permission loss, or failure and leave normal task state intact.",
  ],
});
