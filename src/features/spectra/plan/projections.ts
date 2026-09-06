import {
  validatePlanDependencies,
  type PlanContent,
  type PlanStatus,
  type PlanTask,
} from "./model";

/**
 * Plan views (§11H).
 *
 * List, Board and Timeline are three readings of the same tasks, not three
 * stores. Each projection is derived here so a task cannot appear in one view
 * and vanish from another, and so the equivalence is something code can check
 * rather than something the UI is trusted to maintain.
 */

export type PlanViewKind = "list" | "board" | "timeline";

export type PlanFilter = {
  statuses?: readonly PlanStatus[];
  sectionIds?: readonly string[];
  milestoneIds?: readonly string[];
  assigneeIds?: readonly string[];
  /** Only tasks with a due date inside this window. */
  dueBetween?: { from?: number; to?: number };
  /** Only tasks that came from an official source deadline, or only those that did not. */
  fromOfficialSource?: boolean;
  search?: string;
};

export const PLAN_STATUS_ORDER: readonly PlanStatus[] = Object.freeze([
  "backlog",
  "todo",
  "doing",
  "blocked",
  "done",
]);

export const PLAN_STATUS_LABELS: Readonly<Record<PlanStatus, string>> =
  Object.freeze({
    backlog: "Backlog",
    todo: "To do",
    doing: "In progress",
    blocked: "Blocked",
    done: "Done",
  });

function matchesFilter(task: PlanTask, filter: PlanFilter | undefined) {
  if (!filter) return true;
  if (filter.statuses?.length && !filter.statuses.includes(task.status))
    return false;
  if (
    filter.sectionIds?.length &&
    !filter.sectionIds.includes(task.sectionId ?? "")
  )
    return false;
  if (
    filter.milestoneIds?.length &&
    !filter.milestoneIds.includes(task.milestoneId ?? "")
  )
    return false;
  if (
    filter.assigneeIds?.length &&
    !task.assigneeIds.some((id) => filter.assigneeIds!.includes(id))
  )
    return false;
  if (filter.fromOfficialSource !== undefined) {
    const official = Boolean(task.officialDeadlineRef);
    if (official !== filter.fromOfficialSource) return false;
  }
  if (filter.dueBetween) {
    if (task.dueAt === undefined) return false;
    const { from, to } = filter.dueBetween;
    if (from !== undefined && task.dueAt < from) return false;
    if (to !== undefined && task.dueAt > to) return false;
  }
  if (filter.search?.trim()) {
    const needle = filter.search.trim().toLocaleLowerCase();
    const haystack = `${task.title} ${task.description}`.toLocaleLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function byOrder(left: PlanTask, right: PlanTask) {
  return left.order - right.order || left.id.localeCompare(right.id);
}

export function filterPlanTasks(
  plan: PlanContent,
  filter?: PlanFilter,
): readonly PlanTask[] {
  return plan.tasks.filter((task) => matchesFilter(task, filter)).sort(byOrder);
}

// ------------------------------------------------------------------- list

export type PlanListRow = {
  task: PlanTask;
  /** Nesting depth, so subtasks read as subtasks without a separate store. */
  depth: number;
  sectionTitle?: string;
  milestoneTitle?: string;
  /** Dependencies that are not finished, which is why this task cannot start. */
  blockedBy: readonly string[];
};

export type PlanListSection = {
  id: string;
  title: string;
  rows: readonly PlanListRow[];
};

/**
 * List keeps sections and parent/child nesting. A task whose parent is filtered
 * out is still shown, at the depth it would have had — hiding it would make the
 * filter look like a deletion.
 */
export function planListView(
  plan: PlanContent,
  filter?: PlanFilter,
): readonly PlanListSection[] {
  const visible = filterPlanTasks(plan, filter);
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const unfinished = new Set(
    plan.tasks.filter((task) => task.status !== "done").map((task) => task.id),
  );
  const sectionTitles = new Map(
    plan.sections.map((section) => [section.id, section.title]),
  );
  const milestoneTitles = new Map(
    plan.milestones.map((milestone) => [milestone.id, milestone.title]),
  );

  const depthOf = (task: PlanTask) => {
    let depth = 0;
    let cursor = task.parentTaskId;
    const seen = new Set<string>([task.id]);
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      depth += 1;
      cursor = byId.get(cursor)?.parentTaskId;
    }
    return depth;
  };

  const rows: PlanListRow[] = visible.map((task) => ({
    task,
    depth: depthOf(task),
    ...(task.sectionId && sectionTitles.has(task.sectionId)
      ? { sectionTitle: sectionTitles.get(task.sectionId) }
      : {}),
    ...(task.milestoneId && milestoneTitles.has(task.milestoneId)
      ? { milestoneTitle: milestoneTitles.get(task.milestoneId) }
      : {}),
    blockedBy: task.dependencyIds.filter((id) => unfinished.has(id)),
  }));

  const ordered = [...plan.sections].sort(
    (left, right) => left.order - right.order,
  );
  const sections: PlanListSection[] = ordered.map((section) => ({
    id: section.id,
    title: section.title,
    rows: rows.filter((row) => row.task.sectionId === section.id),
  }));
  const loose = rows.filter(
    (row) => !row.task.sectionId || !sectionTitles.has(row.task.sectionId),
  );
  // Tasks nobody has filed yet come last, under a name that says what they are
  // rather than "Other".
  if (loose.length)
    sections.push({ id: "__unsectioned", title: "Not in a section", rows: loose });
  return sections.filter((section) => section.rows.length > 0);
}

// ------------------------------------------------------------------ board

export type PlanBoardColumn = {
  status: PlanStatus;
  title: string;
  tasks: readonly PlanTask[];
};

/**
 * Board is the same tasks grouped by status. Every status gets a column even
 * when empty, because an empty column is where a task gets dropped.
 */
export function planBoardView(
  plan: PlanContent,
  filter?: PlanFilter,
): readonly PlanBoardColumn[] {
  const visible = filterPlanTasks(plan, filter);
  return PLAN_STATUS_ORDER.map((status) => ({
    status,
    title: PLAN_STATUS_LABELS[status],
    tasks: visible.filter((task) => task.status === status),
  }));
}

// --------------------------------------------------------------- timeline

export type PlanTimelineBar = {
  task: PlanTask;
  /** Start of the bar. Falls back to the due date when no work is scheduled. */
  startAt: number;
  endAt: number;
  /** True when the dates were inferred rather than set, so the UI can say so. */
  inferred: boolean;
};

export type PlanTimelineMilestone = {
  id: string;
  title: string;
  at: number;
  status: "planned" | "reached" | "missed";
};

export type PlanTimelineView = {
  /** Tasks that can be placed on a time axis. */
  bars: readonly PlanTimelineBar[];
  milestones: readonly PlanTimelineMilestone[];
  /**
   * Tasks with no date at all. They are listed rather than dropped, so the
   * Timeline never silently hides work (§9.4's unscheduled lane, applied here).
   */
  unscheduled: readonly PlanTask[];
  window: { from: number; to: number } | null;
};

/**
 * Timeline needs dates, and most tasks only have a due date. Rather than
 * refusing to draw them, a task with a due date and an estimate is placed as a
 * bar ending at the deadline, and marked as inferred so the interface can
 * distinguish planned work from a guess.
 */
export function planTimelineView(
  plan: PlanContent,
  filter?: PlanFilter,
): PlanTimelineView {
  const visible = filterPlanTasks(plan, filter);
  const bars: PlanTimelineBar[] = [];
  const unscheduled: PlanTask[] = [];
  const DEFAULT_SPAN_MS = 60 * 60 * 1000;

  for (const task of visible) {
    if (task.dueAt === undefined) {
      unscheduled.push(task);
      continue;
    }
    const span = Math.max(
      DEFAULT_SPAN_MS,
      (task.estimateMinutes ?? 60) * 60 * 1000,
    );
    bars.push({
      task,
      startAt: task.dueAt - span,
      endAt: task.dueAt,
      inferred: true,
    });
  }

  const milestones = [...plan.milestones]
    .filter((milestone) => milestone.dueAt !== undefined)
    .sort((left, right) => (left.dueAt ?? 0) - (right.dueAt ?? 0))
    .map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      at: milestone.dueAt!,
      status: milestone.status,
    }));

  const points = [
    ...bars.flatMap((bar) => [bar.startAt, bar.endAt]),
    ...milestones.map((milestone) => milestone.at),
  ];
  return {
    bars,
    milestones,
    unscheduled,
    window: points.length ? paddedWindow(points) : null,
  };
}

/**
 * A window wide enough to draw on.
 *
 * One task with one deadline gives `from === to`, which printed the same date at
 * both ends of the axis — a timeline that reads as a rendering fault — and made
 * every bar fill the full width because its span was the whole window. The
 * window is padded to at least a fortnight, centred on the work, so a single
 * deadline sits somewhere sensible along a real span.
 */
function paddedWindow(points: readonly number[]): { from: number; to: number } {
  const MINIMUM_SPAN_MS = 14 * 24 * 60 * 60 * 1000;
  const from = Math.min(...points);
  const to = Math.max(...points);
  const shortfall = MINIMUM_SPAN_MS - (to - from);
  if (shortfall <= 0) return { from, to };
  const pad = Math.round(shortfall / 2);
  return { from: from - pad, to: to + pad };
}

/**
 * The three views describe the same work. This returns the task ids each view
 * shows, so their equivalence can be asserted instead of assumed.
 */
export function planViewTaskIds(plan: PlanContent, filter?: PlanFilter) {
  const list = planListView(plan, filter).flatMap((section) =>
    section.rows.map((row) => row.task.id),
  );
  const board = planBoardView(plan, filter).flatMap((column) =>
    column.tasks.map((task) => task.id),
  );
  const timeline = planTimelineView(plan, filter);
  return {
    list: new Set(list),
    board: new Set(board),
    timeline: new Set([
      ...timeline.bars.map((bar) => bar.task.id),
      ...timeline.unscheduled.map((task) => task.id),
    ]),
  };
}

// ------------------------------------------------------- deadlines vs work

export type PlanScheduleEntry =
  | {
      kind: "official_deadline";
      taskId: string;
      at: number;
      /** The school source this deadline came from. It is never moved here. */
      sourceRef: string;
    }
  | {
      kind: "work_block";
      taskId: string;
      calendarBlockId: string;
    }
  | { kind: "personal_due"; taskId: string; at: number };

/**
 * What this plan contributes to Calendar, with the distinction the plan insists
 * on: an official deadline is a fact from the school and is never rescheduled by
 * planning; a work block is the person's own intention and can move freely
 * (§9.2, §11H).
 */
export function planScheduleEntries(
  plan: PlanContent,
): readonly PlanScheduleEntry[] {
  const entries: PlanScheduleEntry[] = [];
  for (const task of plan.tasks) {
    if (task.officialDeadlineRef && task.dueAt !== undefined)
      entries.push({
        kind: "official_deadline",
        taskId: task.id,
        at: task.dueAt,
        sourceRef: task.officialDeadlineRef,
      });
    else if (task.dueAt !== undefined)
      entries.push({ kind: "personal_due", taskId: task.id, at: task.dueAt });
    for (const calendarBlockId of task.calendarBlockIds)
      entries.push({ kind: "work_block", taskId: task.id, calendarBlockId });
  }
  return entries;
}

export type PlanRescheduleResult =
  | { ok: true; plan: PlanContent }
  | { ok: false; reason: string };

/**
 * Moves a task's own deadline. A deadline that came from the school is refused
 * with an explanation, because rescheduling it here would misrepresent what the
 * school actually set — the person schedules work blocks around it instead.
 */
export function reschedulePlanTask(
  plan: PlanContent,
  input: { taskId: string; dueAt?: number },
): PlanRescheduleResult {
  const task = plan.tasks.find((candidate) => candidate.id === input.taskId);
  if (!task) return { ok: false, reason: "That task is no longer in this plan." };
  if (task.officialDeadlineRef)
    return {
      ok: false,
      reason:
        "This deadline comes from your school. Schedule work before it instead of moving it.",
    };
  return {
    ok: true,
    plan: {
      ...plan,
      tasks: plan.tasks.map((candidate) =>
        candidate.id === input.taskId
          ? { ...candidate, ...(input.dueAt === undefined ? { dueAt: undefined } : { dueAt: input.dueAt }) }
          : candidate,
      ),
    },
  };
}

// ------------------------------------------------------------ bulk safety

export type PlanBulkAction =
  | { kind: "set_status"; status: PlanStatus }
  | { kind: "assign"; assigneeId: string }
  | { kind: "move_to_section"; sectionId?: string }
  | { kind: "delete" };

export type PlanBulkPlan = {
  taskIds: readonly string[];
  /**
   * Whether the person has to confirm. Reversible edits do not ask; deletions
   * and anything touching an official source deadline do.
   */
  requiresConfirmation: boolean;
  /** What the confirmation says, naming the actual consequence. */
  confirmation?: { title: string; body: string; confirmLabel: string };
  /** Tasks that will not change, and why, stated before the action runs. */
  refusals: readonly { taskId: string; reason: string }[];
};

/**
 * Works out what a bulk action would really do before it does it. Destructive
 * and irreversible operations get a confirmation that names the count and the
 * consequence; a status change on twelve tasks does not need a dialog.
 */
export function planBulkAction(
  plan: PlanContent,
  taskIds: readonly string[],
  action: PlanBulkAction,
): PlanBulkPlan {
  const known = new Set(plan.tasks.map((task) => task.id));
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const selected = [...new Set(taskIds)].filter((id) => known.has(id));
  const refusals: { taskId: string; reason: string }[] = [];

  if (action.kind === "delete") {
    const descendants = new Set(selected);
    let grew = true;
    while (grew) {
      grew = false;
      for (const task of plan.tasks)
        if (
          task.parentTaskId &&
          descendants.has(task.parentTaskId) &&
          !descendants.has(task.id)
        ) {
          descendants.add(task.id);
          grew = true;
        }
    }
    const extra = descendants.size - selected.length;
    const dependents = plan.tasks.filter(
      (task) =>
        !descendants.has(task.id) &&
        task.dependencyIds.some((id) => descendants.has(id)),
    );
    return {
      taskIds: [...descendants],
      requiresConfirmation: true,
      confirmation: {
        title:
          descendants.size === 1
            ? "Delete this task?"
            : `Delete ${descendants.size} tasks?`,
        body: [
          extra > 0
            ? `${extra} subtask${extra === 1 ? "" : "s"} will be deleted too.`
            : "",
          dependents.length
            ? `${dependents.length} task${dependents.length === 1 ? "" : "s"} depend${dependents.length === 1 ? "s" : ""} on this and will lose that link.`
            : "",
          "Deleting cannot be undone from here; use History to restore the plan.",
        ]
          .filter(Boolean)
          .join(" "),
        confirmLabel: descendants.size === 1 ? "Delete task" : "Delete tasks",
      },
      refusals,
    };
  }

  if (action.kind === "set_status") {
    for (const id of selected) {
      const task = byId.get(id);
      if (!task) continue;
      const unfinished = task.dependencyIds.filter(
        (dependency) => byId.get(dependency)?.status !== "done",
      );
      if (action.status === "done" && unfinished.length)
        refusals.push({
          taskId: id,
          reason: `Finish ${unfinished.length} task${unfinished.length === 1 ? "" : "s"} it depends on first.`,
        });
    }
  }

  const refused = new Set(refusals.map((entry) => entry.taskId));
  return {
    taskIds: selected.filter((id) => !refused.has(id)),
    requiresConfirmation: false,
    refusals,
  };
}

/** Applies a bulk action that has already been planned and confirmed. */
export function applyPlanBulkAction(
  plan: PlanContent,
  bulk: PlanBulkPlan,
  action: PlanBulkAction,
): PlanContent {
  const targets = new Set(bulk.taskIds);
  if (action.kind === "delete") {
    const next: PlanContent = {
      ...plan,
      tasks: plan.tasks
        .filter((task) => !targets.has(task.id))
        .map((task) => ({
          ...task,
          dependencyIds: task.dependencyIds.filter((id) => !targets.has(id)),
        })),
    };
    validatePlanDependencies(next);
    return next;
  }
  return {
    ...plan,
    tasks: plan.tasks.map((task) => {
      if (!targets.has(task.id)) return task;
      switch (action.kind) {
        case "set_status":
          return { ...task, status: action.status };
        case "assign":
          return task.assigneeIds.includes(action.assigneeId)
            ? task
            : { ...task, assigneeIds: [...task.assigneeIds, action.assigneeId] };
        case "move_to_section":
          return action.sectionId
            ? { ...task, sectionId: action.sectionId }
            : { ...task, sectionId: undefined };
      }
    }),
  };
}

// ---------------------------------------------------------- import/export

export type PlanExportFormat = "csv" | "ics" | "json";

function csvCell(value: unknown) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function planToCsv(plan: PlanContent) {
  const header = [
    "id",
    "title",
    "status",
    "section",
    "milestone",
    "dueAt",
    "estimateMinutes",
    "assignees",
    "dependencies",
    "officialDeadline",
  ];
  const sections = new Map(plan.sections.map((s) => [s.id, s.title]));
  const milestones = new Map(plan.milestones.map((m) => [m.id, m.title]));
  const rows = [...plan.tasks].sort(byOrder).map((task) =>
    [
      task.id,
      task.title,
      task.status,
      task.sectionId ? (sections.get(task.sectionId) ?? "") : "",
      task.milestoneId ? (milestones.get(task.milestoneId) ?? "") : "",
      task.dueAt ? new Date(task.dueAt).toISOString() : "",
      task.estimateMinutes ?? "",
      task.assigneeIds.join(" "),
      task.dependencyIds.join(" "),
      task.officialDeadlineRef ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...rows].join("\r\n");
}

function icsDate(timestamp: number) {
  return `${new Date(timestamp).toISOString().replaceAll(/[-:]/g, "").slice(0, 15)}Z`;
}

function icsText(value: string) {
  return value.replaceAll(/([,;\\])/g, "\\$1").replaceAll(/\r?\n/g, "\\n");
}

/**
 * Exports the plan as calendar to-dos. Official deadlines are marked in the
 * description rather than rewritten, so a round trip cannot turn a school
 * deadline into a personal one.
 */
export function planToIcs(plan: PlanContent, name: string) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Spectra//Plan//EN",
    `X-WR-CALNAME:${icsText(plan.title ?? name)}`,
  ];
  for (const task of [...plan.tasks].sort(byOrder)) {
    lines.push(
      "BEGIN:VTODO",
      `UID:${task.id}@spectra`,
      `SUMMARY:${icsText(task.title)}`,
      `STATUS:${task.status === "done" ? "COMPLETED" : task.status === "doing" ? "IN-PROCESS" : "NEEDS-ACTION"}`,
    );
    if (task.dueAt !== undefined) lines.push(`DUE:${icsDate(task.dueAt)}`);
    const description = [
      task.description,
      task.officialDeadlineRef
        ? `Official deadline from ${task.officialDeadlineRef}. Spectra does not move it.`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (description) lines.push(`DESCRIPTION:${icsText(description)}`);
    lines.push("END:VTODO");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export type PlanImportResult = {
  plan: PlanContent;
  imported: number;
  /** Rows that could not be read, kept as warnings rather than dropped silently. */
  warnings: readonly string[];
};

/**
 * Reads tasks out of a delimited export. Imported tasks are always personal:
 * nothing in a CSV can claim to be an official school deadline, because that
 * claim has to come from the school adapter (§9.5).
 */
export function planFromDelimited(
  plan: PlanContent,
  source: string,
  delimiter: "," | "\t" = ",",
): PlanImportResult {
  const rows = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!rows.length) return { plan, imported: 0, warnings: ["The file was empty."] };

  const split = (line: string) => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index]!;
      if (quoted) {
        if (character === '"' && line[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else if (character === '"') quoted = false;
        else cell += character;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === delimiter) {
        cells.push(cell);
        cell = "";
      } else cell += character;
    }
    cells.push(cell);
    return cells;
  };

  const header = split(rows[0]!).map((cell) => cell.trim().toLocaleLowerCase());
  const titleIndex = header.findIndex((cell) =>
    ["title", "task", "name", "summary"].includes(cell),
  );
  if (titleIndex === -1)
    return {
      plan,
      imported: 0,
      warnings: ["No title column found. Name one column Title and try again."],
    };
  const statusIndex = header.indexOf("status");
  const dueIndex = header.findIndex((cell) =>
    ["dueat", "due", "due date", "deadline"].includes(cell),
  );
  const estimateIndex = header.findIndex((cell) =>
    ["estimateminutes", "estimate", "minutes"].includes(cell),
  );

  const warnings: string[] = [];
  const tasks: PlanTask[] = [...plan.tasks];
  let order = tasks.reduce((max, task) => Math.max(max, task.order), -1) + 1;
  let imported = 0;

  for (const [index, line] of rows.slice(1).entries()) {
    const cells = split(line);
    const title = (cells[titleIndex] ?? "").trim();
    if (!title) {
      warnings.push(`Row ${index + 2} has no title and was skipped.`);
      continue;
    }
    const rawStatus = (cells[statusIndex] ?? "").trim().toLocaleLowerCase();
    const status: PlanStatus = (PLAN_STATUS_ORDER as readonly string[]).includes(
      rawStatus,
    )
      ? (rawStatus as PlanStatus)
      : rawStatus === "in progress"
        ? "doing"
        : rawStatus === "to do"
          ? "todo"
          : "todo";
    const rawDue = (cells[dueIndex] ?? "").trim();
    const dueAt = rawDue ? Date.parse(rawDue) : Number.NaN;
    if (rawDue && !Number.isFinite(dueAt))
      warnings.push(`Row ${index + 2} has a date Spectra could not read.`);
    const rawEstimate = Number((cells[estimateIndex] ?? "").trim());

    tasks.push({
      id: `imported-${order + 1}-${title.slice(0, 24).replaceAll(/[^a-z0-9]+/gi, "-").toLocaleLowerCase()}`,
      title: title.slice(0, 500),
      description: "",
      dependencyIds: [],
      status,
      assigneeIds: [],
      referenceIds: [],
      sourceRefs: [],
      calendarBlockIds: [],
      reminders: [],
      checklist: [],
      order,
      ...(Number.isFinite(dueAt) ? { dueAt } : {}),
      ...(Number.isFinite(rawEstimate) && rawEstimate > 0
        ? { estimateMinutes: Math.round(rawEstimate) }
        : {}),
    });
    order += 1;
    imported += 1;
  }

  return { plan: { ...plan, tasks }, imported, warnings };
}
