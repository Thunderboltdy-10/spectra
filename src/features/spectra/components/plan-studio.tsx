"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { currentTimeMs, uniqueToken } from "@/lib/unique-token";
import {
  AlertCircle,
  Bell,
  CalendarClock,
  CalendarRange,
  Check,
  Download,
  FileSpreadsheet,
  Import,
  Link2,
  ListTodo,
  Plus,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { SelectField } from "@/components/ui/select";
import { ArtifactWorkbar } from "./artifact-workbar";
import { capabilityForLocalId, projectBindingsFromIr } from "../capabilities";
import {
  commandContextFromContract,
  dispatchStudioCommand,
} from "../commands/dispatch";
import { useStudioContract } from "./artifact-studio-shell";
import { calendarItemFromWire, type CalendarItem } from "../calendar/domain/model";
import {
  PLAN_PRIORITIES,
  normalizePlanContent,
  planContentSchema,
  validatePlanDependencies,
  type PlanContent,
  type PlanPriority,
  type PlanRecurrenceFrequency,
  type PlanStatus,
  type PlanTask,
} from "../plan/model";
import {
  PLAN_DUE_REFUSAL,
  PLAN_REMINDER_DELIVERY_PENDING,
  completePlanTask,
  deletePlanView,
  derivePlanWorkload,
  normalizePlanLabels,
  parsePlanDue,
  renamePlanView,
  savePlanView,
  setPlanParent,
} from "../plan/operations";
import {
  PLAN_STATUS_LABELS,
  PLAN_STATUS_ORDER,
  applyPlanBulkAction,
  planBoardView,
  planBulkAction,
  planFromDelimited,
  planListView,
  planTimelineView,
  planToCsv,
  planToIcs,
  reschedulePlanTask,
  type PlanBulkAction,
  type PlanBulkPlan,
  type PlanFilter,
  type PlanViewKind,
} from "../plan/projections";

/**
 * Plan (§11H).
 *
 * List, Board and Timeline are three readings of one set of tasks — every one
 * of them is derived by `plan/projections`, so a task cannot be present in one
 * view and missing from another. This component draws those projections and
 * edits the single underlying model; it never keeps a per-view copy.
 */

const STATUS_TONE: Record<PlanStatus, string> = {
  backlog: "var(--text-tertiary)",
  todo: "var(--text-secondary)",
  doing: "#7560e8",
  blocked: "#d88922",
  done: "var(--success)",
};

const PRIORITY_LABELS: Record<PlanPriority, string> = {
  none: "No priority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function uniqueId(prefix: string) {
  return `${prefix}-${uniqueToken().slice(0, 8)}`;
}

function dateInput(value: number | undefined, timezone: string) {
  if (value === undefined) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function shortDate(value: number, timezone: string) {
  return new Date(value).toLocaleDateString(undefined, {
    timeZone: timezone,
    day: "numeric",
    month: "short",
  });
}

function localDay(value: number, timezone: string) {
  const [year, month, day] = dateInput(value, timezone).split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!);
}

function dueLabel(task: PlanTask, now: number, timezone: string) {
  if (task.dueAt === undefined) return "";
  const days = Math.round(
    (localDay(task.dueAt, timezone) - localDay(now, timezone)) / DAY_MS,
  );
  if (task.status === "done") return shortDate(task.dueAt, timezone);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days <= 7) return `${days}d`;
  return shortDate(task.dueAt, timezone);
}

function dueFilterRange(from: string, to: string, timezone: string) {
  const start = from
    ? parsePlanDue(from, { now: 0, timezone })
    : undefined;
  let end: number | undefined;
  if (to) {
    const [year, month, day] = to.split("-").map(Number);
    const after = new Date(Date.UTC(year!, month! - 1, day! + 1))
      .toISOString()
      .slice(0, 10);
    const parsed = parsePlanDue(after, { now: 0, timezone });
    if (parsed.ok) end = parsed.dueAt - 1;
  }
  const fromAt = start?.ok ? start.dueAt : undefined;
  return fromAt === undefined && end === undefined
    ? undefined
    : { ...(fromAt === undefined ? {} : { from: fromAt }), ...(end === undefined ? {} : { to: end }) };
}

export function PlanStudio({
  mode,
  title,
  content,
  onChange,
  readOnly,
  onOpenArtifact,
}: {
  mode: "split" | "tab";
  title: string;
  content: unknown;
  onChange: (content: unknown) => void;
  readOnly: boolean;
  onOpenArtifact?: (artifactId: string) => void;
}) {
  const plan = useMemo(() => normalizePlanContent(content), [content]);
  const [view, setView] = useState<PlanViewKind>("list");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<PlanStatus | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<PlanPriority | "all">(
    "all",
  );
  const [labelFilter, setLabelFilter] = useState("all");
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "official" | "own">(
    "all",
  );
  const [dueFromFilter, setDueFromFilter] = useState("");
  const [dueToFilter, setDueToFilter] = useState("");
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [openTaskId, setOpenTaskId] = useState<string>();
  const [pendingBulk, setPendingBulk] = useState<{
    bulk: PlanBulkPlan;
    action: PlanBulkAction;
    capabilityId: string;
    params: unknown;
  }>();
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [savedViewId, setSavedViewId] = useState("list");
  const [savedViewDraft, setSavedViewDraft] = useState("");
  const [duePhrase, setDuePhrase] = useState("");
  const [labelsEditor, setLabelsEditor] = useState<{
    taskId: string;
    value: string;
  }>();
  const [subtaskDraft, setSubtaskDraft] = useState("");
  const [recurrenceExceptionDraft, setRecurrenceExceptionDraft] = useState("");
  const [reminderMinutesDraft, setReminderMinutesDraft] = useState("60");
  const [bulkLabelsDraft, setBulkLabelsDraft] = useState("");
  const [bulkLabelsMode, setBulkLabelsMode] = useState<
    "add" | "remove" | "set"
  >("add");
  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>([]);
  const [workloadState, setWorkloadState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const importRef = useRef<HTMLInputElement>(null);
  const quickAddRef = useRef<HTMLInputElement>(null);
  const boardAddRef = useRef<HTMLInputElement>(null);
  const [columnDraft, setColumnDraft] = useState<
    Partial<Record<PlanStatus, string>>
  >({});
  const [dropStatus, setDropStatus] = useState<PlanStatus>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [pendingQuickAdd, setPendingQuickAdd] = useState(false);
  const studio = useStudioContract();
  const canEdit = studio.can("edit") && !readOnly;
  const filtersActive =
    statusFilter !== "all" ||
    priorityFilter !== "all" ||
    labelFilter !== "all" ||
    sectionFilter !== "all" ||
    sourceFilter !== "all" ||
    Boolean(dueFromFilter || dueToFilter);
  // "Overdue" and "Tomorrow" are relative to a clock, so it ticks slowly
  // rather than being read once and left to go stale on a long-open tab.
  const [now, setNow] = useState(() => currentTimeMs());

  function runPlannerCommand(
    id: string,
    params: unknown,
    execute: () => void | Promise<void>,
  ) {
    const definition = capabilityForLocalId("planner_task", id);
    const parsed = definition?.params.safeParse(params);
    if (!definition || !parsed?.success) {
      setProblem("That planner change did not match its capability contract.");
      return false;
    }
    const bindings = projectBindingsFromIr("planner_task", [
      { id, label: id, onSelect: () => void execute() },
    ]);
    return dispatchStudioCommand({
      type: "planner_task",
      id,
      bindings,
      ctx: commandContextFromContract("planner_task", {
        can: studio.can,
        role: studio.role,
        permissions: { role: studio.role, editable: canEdit },
        compatibilityProfile: studio.compatibilityProfile,
        fidelity: studio.fidelity,
        artifactId: studio.artifactId,
        executeApplicationCommand: studio.executeApplicationCommand,
      }),
      params: parsed.data,
    });
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(currentTimeMs()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // The bar's Add task puts the caret in whichever field this view actually
  // has: the list's quick-add row, or the board's To do column. Timeline has no
  // add slot of its own, so it borrows the list. The focus waits for the view
  // to mount instead of firing at a node that is not there yet.
  useEffect(() => {
    if (!pendingQuickAdd) return;
    if (view === "list") {
      quickAddRef.current?.focus();
      setPendingQuickAdd(false);
    } else if (view === "board") {
      boardAddRef.current?.focus();
      setPendingQuickAdd(false);
    }
  }, [pendingQuickAdd, view]);

  const filter: PlanFilter = useMemo(
    () => ({
      ...(statusFilter === "all" ? {} : { statuses: [statusFilter] }),
      ...(priorityFilter === "all" ? {} : { priorities: [priorityFilter] }),
      ...(labelFilter === "all" ? {} : { labels: [labelFilter] }),
      ...(sectionFilter === "all" ? {} : { sectionIds: [sectionFilter] }),
      ...(sourceFilter === "all"
        ? {}
        : { fromOfficialSource: sourceFilter === "official" }),
      ...(dueFilterRange(dueFromFilter, dueToFilter, plan.timezone)
        ? {
            dueBetween: dueFilterRange(
              dueFromFilter,
              dueToFilter,
              plan.timezone,
            ),
          }
        : {}),
      ...(search.trim() ? { search } : {}),
    }),
    [
      dueFromFilter,
      dueToFilter,
      labelFilter,
      plan.timezone,
      priorityFilter,
      search,
      sectionFilter,
      sourceFilter,
      statusFilter,
    ],
  );

  const labels = useMemo(
    () => [...new Set(plan.tasks.flatMap((task) => task.labels))].sort(),
    [plan.tasks],
  );

  const listSections = useMemo(
    () => planListView(plan, filter),
    [filter, plan],
  );
  const boardColumns = useMemo(
    () => planBoardView(plan, filter),
    [filter, plan],
  );
  const timeline = useMemo(() => planTimelineView(plan, filter), [filter, plan]);
  /**
   * Four dates along the axis instead of two at the ends. Two labels a fortnight
   * apart told the reader the range but not where anything sat inside it.
   */
  const axisTicks = useMemo(() => {
    if (!timeline.window) return [];
    const { from, to } = timeline.window;
    const span = to - from || 1;
    return [0, 1, 2, 3].map((step) => {
      const at = from + (span * step) / 3;
      return {
        at: (step / 3) * 100,
        label: shortDate(at, plan.timezone),
      };
    });
  }, [plan.timezone, timeline.window]);
  /** Where "now" falls on the axis, or nothing when it is off the window. */
  const todayAt = useMemo(() => {
    if (!timeline.window) return undefined;
    const { from, to } = timeline.window;
    if (now < from || now > to) return undefined;
    return ((now - from) / (to - from || 1)) * 100;
  }, [now, timeline.window]);
  const visibleCount = useMemo(
    () => listSections.reduce((total, section) => total + section.rows.length, 0),
    [listSections],
  );
  const openTask = plan.tasks.find((task) => task.id === openTaskId);
  const duePreview = useMemo(
    () =>
      duePhrase.trim()
        ? parsePlanDue(duePhrase, { now, timezone: plan.timezone })
        : undefined,
    [duePhrase, now, plan.timezone],
  );
  const currentSavedView = plan.views.find(
    (candidate) => candidate.id === savedViewId,
  );
  const workload = useMemo(
    () => {
      const visibleTaskIds = new Set(
        listSections.flatMap((section) =>
          section.rows.map((row) => row.task.id),
        ),
      );
      return derivePlanWorkload(plan, calendarItems, {
        artifactId: studio.artifactId,
      }).filter((row) => visibleTaskIds.has(row.task.id));
    },
    [calendarItems, listSections, plan, studio.artifactId],
  );

  async function refreshWorkload() {
    setWorkloadState("loading");
    try {
      const from = now - 7 * DAY_MS;
      const to = now + 35 * DAY_MS;
      const response = await fetch(
        `/api/spectra/calendar?from=${from}&to=${to}`,
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          payload?.error?.message ?? "Calendar workload could not be loaded.",
        );
      const items = Array.isArray(payload?.data?.items)
        ? payload.data.items.map(calendarItemFromWire)
        : [];
      setCalendarItems(items);
      setWorkloadState("ready");
    } catch (error) {
      setWorkloadState("error");
      setProblem(
        error instanceof Error
          ? error.message
          : "Calendar workload could not be loaded.",
      );
    }
  }

  useEffect(() => {
    if (view !== "workload" || workloadState !== "idle") return;
    runPlannerCommand("workload.refresh", null, refreshWorkload);
    // This transition is intentionally keyed to view/state. Command and fetch
    // closures read the current render but must not retrigger the load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, workloadState]);

  useEffect(() => {
    // A selection that survives a filter change would act on tasks nobody can
    // see. It is cleared instead of silently kept.
    const visibleTaskIds = new Set(
      listSections.flatMap((section) =>
        section.rows.map((row) => row.task.id),
      ),
    );
    setSelection((current) => current.filter((id) => visibleTaskIds.has(id)));
  }, [listSections]);

  function commit(next: PlanContent, message?: string) {
    if (!canEdit) return;
    try {
      validatePlanDependencies(next);
    } catch (error) {
      setProblem(
        error instanceof Error &&
          (error.message === "PLAN_DEPENDENCY_CYCLE" ||
            error.message === "PLAN_PARENT_CYCLE")
          ? "That task relationship would loop back on itself."
          : "A task relationship points to work that is no longer in this plan.",
      );
      return;
    }
    const parsed = planContentSchema.safeParse(next);
    if (!parsed.success) {
      setProblem(
        parsed.error.issues[0]?.message ??
          "That change would leave this Plan in an invalid state.",
      );
      return;
    }
    setProblem(undefined);
    if (message) setNotice(message);
    onChange(parsed.data);
  }

  function patchTask(
    taskId: string,
    patch: Partial<PlanTask>,
    capabilityId: string,
    params: unknown,
  ) {
    runPlannerCommand(capabilityId, params, () =>
      commit({
        ...plan,
        tasks: plan.tasks.map((task) =>
          task.id === taskId ? { ...task, ...patch } : task,
        ),
      }),
    );
  }

  function setTaskStatus(taskId: string, status: PlanStatus) {
    const completedAt = currentTimeMs();
    runPlannerCommand(
      "task.status",
      { taskId, status, ...(status === "done" ? { completedAt } : {}) },
      () => {
        if (status !== "done") {
          commit({
            ...plan,
            tasks: plan.tasks.map((task) =>
              task.id === taskId ? { ...task, status } : task,
            ),
          });
          return;
        }
        const result = completePlanTask(plan, taskId, completedAt);
        if (!result.ok) {
          setProblem(result.reason);
          return;
        }
        commit(
          result.plan,
          result.advanced ? "Completed. The next occurrence is ready." : undefined,
        );
      },
    );
  }

  function addTask(options?: { sectionId?: string; status?: PlanStatus }) {
    // The board types into its own column, the list into its quick-add row.
    // Both land in the same model; only the draft they read from differs.
    const status = options?.status;
    const title = (status ? (columnDraft[status] ?? "") : draft).trim();
    if (!title) return;
    const order =
      plan.tasks.reduce((max, task) => Math.max(max, task.order), -1) + 1;
    runPlannerCommand(
      "task.create",
      {
        title: title.slice(0, 500),
        status: status ?? "todo",
        ...(options?.sectionId ? { sectionId: options.sectionId } : {}),
      },
      () =>
        commit({
          ...plan,
          tasks: [
            ...plan.tasks,
            {
              id: uniqueId("task"),
              title: title.slice(0, 500),
              description: "",
              dependencyIds: [],
              status: status ?? "todo",
              priority: "none",
              labels: [],
              assigneeIds: [],
              referenceIds: [],
              sourceRefs: [],
              calendarBlockIds: [],
              checklist: [],
              recurrence: {
                frequency: "none",
                interval: 1,
                weekdays: [],
                exceptions: [],
              },
              reminders: [],
              completedOccurrences: [],
              order,
              ...(options?.sectionId ? { sectionId: options.sectionId } : {}),
            },
          ],
        }),
    );
    if (status)
      setColumnDraft((current) => ({ ...current, [status]: "" }));
    else setDraft("");
  }

  function addSection() {
    const order =
      plan.sections.reduce((max, section) => Math.max(max, section.order), -1) +
      1;
    const sectionTitle = `Section ${order + 1}`;
    runPlannerCommand("section.create", { title: sectionTitle }, () =>
      commit({
        ...plan,
        sections: [
          ...plan.sections,
          { id: uniqueId("section"), title: sectionTitle, order },
        ],
      }),
    );
  }

  function runBulk(action: PlanBulkAction) {
    const bulk = planBulkAction(plan, selection, action);
    const capabilityId =
      action.kind === "set_status"
        ? "bulk.status"
        : action.kind === "move_to_section"
          ? "bulk.section"
          : action.kind === "set_priority"
            ? "bulk.priority"
            : action.kind === "set_labels" ||
                action.kind === "add_labels" ||
                action.kind === "remove_labels"
              ? "bulk.labels"
              : action.kind === "set_due"
                ? "bulk.due"
                : "bulk.delete";
    const params =
      action.kind === "set_status"
        ? { taskIds: selection, status: action.status, completedAt: currentTimeMs() }
        : action.kind === "move_to_section"
          ? { taskIds: selection, sectionId: action.sectionId ?? null }
          : action.kind === "set_priority"
            ? { taskIds: selection, priority: action.priority }
            : action.kind === "set_labels" ||
                action.kind === "add_labels" ||
                action.kind === "remove_labels"
              ? {
                  taskIds: selection,
                  labels: action.labels,
                  mode: action.kind.replace("_labels", "") || "set",
                }
              : action.kind === "set_due"
                ? { taskIds: selection, dueAt: action.dueAt ?? null }
                : { taskIds: selection };
    runPlannerCommand(capabilityId, params, () => {
      if (bulk.requiresConfirmation) {
        setPendingBulk({ bulk, action, capabilityId, params });
        return;
      }
      commit(
        applyPlanBulkAction(plan, bulk, action),
        bulk.refusals.length
          ? `${bulk.taskIds.length} updated. ${bulk.refusals.length} left alone: ${bulk.refusals[0]!.reason}`
          : undefined,
      );
      setSelection([]);
    });
  }

  function confirmBulk() {
    if (!pendingBulk) return;
    runPlannerCommand(pendingBulk.capabilityId, pendingBulk.params, () => {
      commit(applyPlanBulkAction(plan, pendingBulk.bulk, pendingBulk.action));
      setSelection([]);
      setOpenTaskId(undefined);
      setPendingBulk(undefined);
    });
  }

  function setDue(taskId: string, value: string) {
    const task = plan.tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    const parsed = value
      ? parsePlanDue(value, { now: currentTimeMs(), timezone: plan.timezone })
      : undefined;
    if (parsed && !parsed.ok) {
      setProblem(parsed.reason);
      return;
    }
    const dueAt = parsed?.dueAt;
    runPlannerCommand(
      "task.due",
      { taskId, dueAt: dueAt ?? null },
      () => {
        const result = reschedulePlanTask(plan, {
          taskId,
          ...(dueAt !== undefined ? { dueAt } : {}),
        });
        if (!result.ok) {
          setProblem(result.reason);
          return;
        }
        commit(result.plan, parsed?.label);
      },
    );
  }

  function setNaturalDue(taskId: string) {
    const parsed = parsePlanDue(duePhrase, {
      now: currentTimeMs(),
      timezone: plan.timezone,
    });
    if (!parsed.ok) {
      setProblem(PLAN_DUE_REFUSAL);
      return;
    }
    runPlannerCommand(
      "task.due",
      {
        taskId,
        phrase: duePhrase,
        dueAt: parsed.dueAt,
        now: currentTimeMs(),
        timezone: plan.timezone,
      },
      () => {
        const result = reschedulePlanTask(plan, {
          taskId,
          dueAt: parsed.dueAt,
        });
        if (!result.ok) {
          setProblem(result.reason);
          return;
        }
        commit(result.plan, `Due ${parsed.label}.`);
        setDuePhrase("");
      },
    );
  }

  function updateRecurrence(
    task: PlanTask,
    patch: Partial<PlanTask["recurrence"]>,
  ) {
    if (task.officialDeadlineRef) {
      setProblem("Official deadlines cannot be made recurring in Plan.");
      return;
    }
    const recurrence = { ...task.recurrence, ...patch };
    runPlannerCommand(
      "task.recurrence",
      { taskId: task.id, recurrence },
      () =>
        commit({
          ...plan,
          tasks: plan.tasks.map((candidate) =>
            candidate.id === task.id ? { ...candidate, recurrence } : candidate,
          ),
        }),
    );
  }

  function updateReminders(
    task: PlanTask,
    reminders: PlanTask["reminders"],
  ) {
    patchTask(task.id, { reminders }, "task.reminders", {
      taskId: task.id,
      reminders,
    });
  }

  function addSubtask(parent: PlanTask) {
    const title = subtaskDraft.trim();
    if (!title) return;
    const order =
      plan.tasks.reduce((max, task) => Math.max(max, task.order), -1) + 1;
    const taskId = uniqueId("task");
    runPlannerCommand(
      "task.create",
      { title, parentTaskId: parent.id, status: "todo" },
      () => {
        commit({
          ...plan,
          tasks: [
            ...plan.tasks,
            {
              id: taskId,
              title: title.slice(0, 500),
              description: "",
              parentTaskId: parent.id,
              dependencyIds: [],
              status: "todo",
              priority: "none",
              labels: [],
              assigneeIds: [],
              referenceIds: [],
              sourceRefs: [],
              calendarBlockIds: [],
              checklist: [],
              recurrence: {
                frequency: "none",
                interval: 1,
                weekdays: [],
                exceptions: [],
              },
              reminders: [],
              completedOccurrences: [],
              order,
              ...(parent.sectionId ? { sectionId: parent.sectionId } : {}),
            },
          ],
        });
        setSubtaskDraft("");
      },
    );
  }

  function requestTaskDelete(taskId: string) {
    const bulk = planBulkAction(plan, [taskId], { kind: "delete" });
    runPlannerCommand("task.delete", { taskId }, () =>
      setPendingBulk({
        bulk,
        action: { kind: "delete" },
        capabilityId: "task.delete",
        params: { taskId },
      }),
    );
  }

  function applySavedView(viewId: string) {
    const saved = plan.views.find((candidate) => candidate.id === viewId);
    if (!saved) return;
    runPlannerCommand("view.select", { viewId }, () => {
      setSavedViewId(viewId);
      setView(saved.kind);
      setSearch(saved.filters?.search ?? "");
      setStatusFilter(saved.filters?.statuses?.[0] ?? "all");
      setPriorityFilter(saved.filters?.priorities?.[0] ?? "all");
      setLabelFilter(saved.filters?.labels?.[0] ?? "all");
      setSectionFilter(saved.filters?.sectionIds?.[0] ?? "all");
      setSourceFilter(
        saved.filters?.fromOfficialSource === undefined
          ? "all"
          : saved.filters.fromOfficialSource
            ? "official"
            : "own",
      );
      setDueFromFilter(
        dateInput(saved.filters?.dueBetween?.from, plan.timezone),
      );
      setDueToFilter(dateInput(saved.filters?.dueBetween?.to, plan.timezone));
    });
  }

  function saveCurrentView() {
    const name = savedViewDraft.trim();
    if (!name) {
      setProblem("Name this view before saving it.");
      return;
    }
    const viewId = uniqueId("view");
    runPlannerCommand(
      "view.save",
      { viewId, title: name, kind: view, filters: filter },
      () => {
        commit(
          savePlanView(plan, { id: viewId, title: name, kind: view, filters: filter }),
          `Saved “${name}”.`,
        );
        setSavedViewId(viewId);
        setSavedViewDraft("");
      },
    );
  }

  function renameCurrentView() {
    const name = savedViewDraft.trim();
    const saved = plan.views.find((candidate) => candidate.id === savedViewId);
    if (!saved || saved.system || !name) return;
    runPlannerCommand(
      "view.rename",
      { viewId: saved.id, title: name },
      () => {
        commit(renamePlanView(plan, saved.id, name), `Renamed this view to “${name}”.`);
        setSavedViewDraft("");
      },
    );
  }

  function removeCurrentView() {
    const saved = plan.views.find((candidate) => candidate.id === savedViewId);
    if (!saved || saved.system) return;
    runPlannerCommand("view.delete", { viewId: saved.id }, () => {
      const result = deletePlanView(plan, saved.id);
      if (!result.ok) {
        setProblem(result.reason);
        return;
      }
      commit(result.plan, `Deleted “${saved.title}”.`);
      applySavedView("list");
    });
  }

  function exportPlan(format: "csv" | "ics" | "json") {
    const name = (plan.title || title || "plan")
      .replace(/[^a-z0-9-_]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    const payload =
      format === "csv"
        ? planToCsv(plan)
        : format === "ics"
          ? planToIcs(plan, title)
          : JSON.stringify(plan, null, 2);
    const type =
      format === "csv"
        ? "text/csv"
        : format === "ics"
          ? "text/calendar"
          : "application/json";
    const url = URL.createObjectURL(new Blob([payload], { type }));
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${name || "plan"}.${format}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice(
      format === "ics"
        ? "Exported as calendar to-dos. School deadlines are marked, not rewritten."
        : `Exported ${plan.tasks.length} task${plan.tasks.length === 1 ? "" : "s"}.`,
    );
  }

  async function importPlan(file: File) {
    const text = await file.text();
    const result = planFromDelimited(
      plan,
      text,
      file.name.endsWith(".tsv") ? "\t" : ",",
    );
    if (!result.imported) {
      setProblem(result.warnings[0] ?? "Nothing in that file looked like a task.");
      return;
    }
    runPlannerCommand("import", null, () =>
      commit(
        result.plan,
        [
          `Imported ${result.imported} task${result.imported === 1 ? "" : "s"}.`,
          result.warnings.length
            ? `${result.warnings.length} row${result.warnings.length === 1 ? "" : "s"} skipped.`
            : "",
        ]
          .filter(Boolean)
          .join(" "),
      ),
    );
  }

  const allSelected =
    visibleCount > 0 &&
    listSections.every((section) =>
      section.rows.every((row) => selection.includes(row.task.id)),
    );

  return (
    <div className="spectra-plan-studio" data-mode={mode}>
      {/* One shared bar. The planner used to draw its own: a view tablist, a
          search field, three native selects, an Import button and an Export
          `<details>` on a single row that scrolled horizontally under pressure.
          Views now come from `work/registry` through the studio contract, the
          filters are `SelectField`s in a disclosure so they cost one slot
          instead of three, and Export is a portaled `⋯` group. */}
      <ArtifactWorkbar
        label="Plan"
        modes={{
          registry: true,
          value: view,
          onChange: (modeId) =>
            runPlannerCommand("view.select", { viewId: modeId }, () => {
              setView(modeId as PlanViewKind);
              setSavedViewId(modeId);
            }),
        }}
        context={
          filtersActive || search ? `${visibleCount} shown` : undefined
        }
        primary={
          canEdit
            ? {
                label: "Add task",
                icon: Plus,
                onSelect: () => {
                  // Board and list each have their own add field. Timeline has
                  // none, so it hands over to the list rather than pretending.
                  if (view === "timeline" || view === "workload")
                    setView("list");
                  setPendingQuickAdd(true);
                },
                requires: "edit",
              }
            : undefined
        }
        actions={projectBindingsFromIr("planner_task", [
          {
            id: "find",
            label: "Find tasks",
            icon: Search,
            active: searchOpen,
            onSelect: () => setSearchOpen((open) => !open),
            priority: "essential",
          },
          {
            id: "filters",
            label: "Filters",
            icon: SlidersHorizontal,
            active: filtersOpen || filtersActive,
            onSelect: () => setFiltersOpen((open) => !open),
            priority: "essential",
            ...(filtersActive ? { hint: "Some tasks are hidden" } : {}),
          },
          {
            id: "import",
            label: "Import tasks",
            icon: Import,
            onSelect: () => importRef.current?.click(),
            priority: "secondary",
            requires: "edit",
            hint: "CSV or TSV",
          },
          {
            id: "export-csv",
            label: "Export as a spreadsheet",
            icon: FileSpreadsheet,
            onSelect: () => exportPlan("csv"),
            priority: "advanced",
          },
          {
            id: "export-ics",
            label: "Export as calendar to-dos",
            icon: CalendarClock,
            onSelect: () => exportPlan("ics"),
            priority: "advanced",
          },
          {
            id: "export-json",
            label: "Export the full plan",
            icon: Download,
            onSelect: () => exportPlan("json"),
            priority: "advanced",
          },
        ])}
      />
      <div className="spectra-editor-body">
      {!canEdit ? null : (
        <input
          ref={importRef}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          accept=".csv,.tsv,text/csv,text/tab-separated-values"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void importPlan(file);
            event.currentTarget.value = "";
          }}
        />
      )}
      {searchOpen ? (
        <div className="spectra-plan-find">
          <Search className="size-3.5 shrink-0 text-[var(--text-tertiary)]" />
          <input
            autoFocus
            value={search}
            onChange={(event) => {
              const value = event.target.value;
              runPlannerCommand(
                "view.filters",
                { filters: { ...filter, search: value || undefined } },
                () => setSearch(value),
              );
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                if (search)
                  runPlannerCommand("view.filters.clear", null, () => setSearch(""));
                else setSearchOpen(false);
              }
            }}
            placeholder="Find tasks"
            aria-label="Find tasks"
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear the search"
              onClick={() =>
                runPlannerCommand("view.filters.clear", null, () => setSearch(""))
              }
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
      {filtersOpen ? (
        <div className="spectra-plan-filters">
          <SelectField
            label="View"
            size="sm"
            value={savedViewId}
            onChange={applySavedView}
            options={plan.views.map((saved) => ({
              value: saved.id,
              label: saved.title,
            }))}
          />
          <SelectField
            label="Status"
            size="sm"
            value={statusFilter}
            onChange={(value) => {
              const status = value as PlanStatus | "all";
              runPlannerCommand(
                "view.filters",
                {
                  filters: {
                    ...filter,
                    ...(status === "all" ? { statuses: undefined } : { statuses: [status] }),
                  },
                },
                () => setStatusFilter(status),
              );
            }}
            options={[
              { value: "all", label: "Any status" },
              ...PLAN_STATUS_ORDER.map((status) => ({
                value: status,
                label: PLAN_STATUS_LABELS[status],
              })),
            ]}
          />
          <SelectField
            label="Priority"
            size="sm"
            value={priorityFilter}
            onChange={(value) => {
              const priority = value as PlanPriority | "all";
              runPlannerCommand(
                "view.filters",
                {
                  filters: {
                    ...filter,
                    ...(priority === "all"
                      ? { priorities: undefined }
                      : { priorities: [priority] }),
                  },
                },
                () => setPriorityFilter(priority),
              );
            }}
            options={[
              { value: "all", label: "Any priority" },
              ...PLAN_PRIORITIES.map((priority) => ({
                value: priority,
                label: PRIORITY_LABELS[priority],
              })),
            ]}
          />
          {labels.length ? (
            <SelectField
              label="Label"
              size="sm"
              value={labelFilter}
              onChange={(value) =>
                runPlannerCommand(
                  "view.filters",
                  {
                    filters: {
                      ...filter,
                      ...(value === "all" ? { labels: undefined } : { labels: [value] }),
                    },
                  },
                  () => setLabelFilter(value),
                )
              }
              options={[
                { value: "all", label: "Any label" },
                ...labels.map((label) => ({ value: label, label })),
              ]}
            />
          ) : null}
          {plan.sections.length ? (
            <SelectField
              label="Section"
              size="sm"
              value={sectionFilter}
              onChange={(value) =>
                runPlannerCommand(
                  "view.filters",
                  {
                    filters: {
                      ...filter,
                      ...(value === "all"
                        ? { sectionIds: undefined }
                        : { sectionIds: [value] }),
                    },
                  },
                  () => setSectionFilter(value),
                )
              }
              options={[
                { value: "all", label: "Any section" },
                ...plan.sections.map((section) => ({
                  value: section.id,
                  label: section.title,
                })),
              ]}
            />
          ) : null}
          <SelectField
            label="Deadline set by"
            size="sm"
            value={sourceFilter}
            onChange={(value) => {
              const source = value as "all" | "official" | "own";
              runPlannerCommand(
                "view.filters",
                {
                  filters: {
                    ...filter,
                    ...(source === "all"
                      ? { fromOfficialSource: undefined }
                      : { fromOfficialSource: source === "official" }),
                  },
                },
                () => setSourceFilter(source),
              );
            }}
            options={[
              { value: "all", label: "Anyone" },
              { value: "official", label: "The school" },
              { value: "own", label: "You" },
            ]}
          />
          <label className="spectra-plan-filter-date">
            <span>Due from</span>
            <input
              type="date"
              value={dueFromFilter}
              onChange={(event) => {
                const value = event.target.value;
                runPlannerCommand(
                  "view.filters",
                  {
                    filters: {
                      ...filter,
                      dueBetween: dueFilterRange(
                        value,
                        dueToFilter,
                        plan.timezone,
                      ),
                    },
                  },
                  () => setDueFromFilter(value),
                );
              }}
            />
          </label>
          <label className="spectra-plan-filter-date">
            <span>Due through</span>
            <input
              type="date"
              value={dueToFilter}
              onChange={(event) => {
                const value = event.target.value;
                runPlannerCommand(
                  "view.filters",
                  {
                    filters: {
                      ...filter,
                      dueBetween: dueFilterRange(
                        dueFromFilter,
                        value,
                        plan.timezone,
                      ),
                    },
                  },
                  () => setDueToFilter(value),
                );
              }}
            />
          </label>
          {filtersActive ? (
            <button
              type="button"
              className="spectra-plan-filters-clear"
              onClick={() =>
                runPlannerCommand("view.filters.clear", null, () => {
                  setStatusFilter("all");
                  setPriorityFilter("all");
                  setLabelFilter("all");
                  setSectionFilter("all");
                  setSourceFilter("all");
                  setDueFromFilter("");
                  setDueToFilter("");
                  setSearch("");
                })
              }
            >
              Show every task
            </button>
          ) : null}
          <div className="spectra-plan-view-save">
            <input
              value={savedViewDraft}
              onChange={(event) => setSavedViewDraft(event.target.value)}
              placeholder="Name this view"
              aria-label="Saved view name"
            />
            <button type="button" onClick={saveCurrentView} disabled={!canEdit}>
              <Save className="h-3.5 w-3.5" /> Save
            </button>
            {currentSavedView && !currentSavedView.system ? (
              <>
                <button type="button" onClick={renameCurrentView} disabled={!canEdit}>
                  Rename
                </button>
                <button
                  type="button"
                  className="spectra-plan-danger"
                  onClick={removeCurrentView}
                  disabled={!canEdit}
                >
                  Delete view
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {problem ? (
        <div className="spectra-plan-problem" role="alert">
          <AlertCircle className="h-3.5 w-3.5" />
          <p>{problem}</p>
          <button type="button" onClick={() => setProblem(undefined)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="spectra-plan-notice">
          <p>{notice}</p>
          <button type="button" onClick={() => setNotice(undefined)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {selection.length && canEdit ? (
        <div className="spectra-plan-bulk">
          <strong>{selection.length} selected</strong>
          <SelectField
            ariaLabel="Set status for selected tasks"
            size="sm"
            value=""
            placeholder="Set status…"
            onChange={(value) => {
              if (!value) return;
              runBulk({ kind: "set_status", status: value as PlanStatus });
            }}
            options={PLAN_STATUS_ORDER.map((status) => ({
              value: status,
              label: PLAN_STATUS_LABELS[status],
            }))}
          />
          {plan.sections.length ? (
            <SelectField
              ariaLabel="Move selected tasks to a section"
              size="sm"
              value=""
              placeholder="Move to…"
              onChange={(value) => {
                if (!value) return;
                runBulk({
                  kind: "move_to_section",
                  ...(value === "__none" ? {} : { sectionId: value }),
                });
              }}
              options={[
                { value: "__none", label: "No section" },
                ...plan.sections.map((section) => ({
                  value: section.id,
                  label: section.title,
                })),
              ]}
            />
          ) : null}
          <SelectField
            ariaLabel="Set priority for selected tasks"
            size="sm"
            value=""
            placeholder="Priority…"
            onChange={(value) => {
              if (!value) return;
              runBulk({ kind: "set_priority", priority: value as PlanPriority });
            }}
            options={PLAN_PRIORITIES.map((priority) => ({
              value: priority,
              label: PRIORITY_LABELS[priority],
            }))}
          />
          <SelectField
            ariaLabel="How to change labels for selected tasks"
            size="sm"
            value={bulkLabelsMode}
            onChange={(value) =>
              setBulkLabelsMode(value as "add" | "remove" | "set")
            }
            options={[
              { value: "add", label: "Add labels" },
              { value: "remove", label: "Remove labels" },
              { value: "set", label: "Replace labels" },
            ]}
          />
          <input
            className="spectra-plan-bulk-input"
            value={bulkLabelsDraft}
            onChange={(event) => setBulkLabelsDraft(event.target.value)}
            placeholder={`${bulkLabelsMode === "set" ? "Replace" : bulkLabelsMode === "remove" ? "Remove" : "Add"} labels`}
            aria-label="Labels for selected tasks"
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const labels = normalizePlanLabels(
                bulkLabelsDraft.split(/[,;]+/),
              );
              if (!labels.length) return;
              runBulk({
                kind:
                  bulkLabelsMode === "set"
                    ? "set_labels"
                    : bulkLabelsMode === "remove"
                      ? "remove_labels"
                      : "add_labels",
                labels,
              });
              setBulkLabelsDraft("");
            }}
          />
          <input
            className="spectra-plan-bulk-input"
            type="date"
            aria-label="Due date for selected tasks"
            onChange={(event) => {
              const parsed = parsePlanDue(event.target.value, {
                now: currentTimeMs(),
                timezone: plan.timezone,
              });
              if (!parsed.ok) {
                setProblem(parsed.reason);
                return;
              }
              runBulk({ kind: "set_due", dueAt: parsed.dueAt });
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => runBulk({ kind: "set_due" })}
          >
            Clear dates
          </button>
          <button
            type="button"
            className="spectra-plan-danger"
            onClick={() => runBulk({ kind: "delete" })}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
          <button
            type="button"
            onClick={() => {
              setSelection([]);
              setSelectionMode(false);
            }}
          >
            Clear
          </button>
        </div>
      ) : null}

      {!plan.tasks.length ? (
        <div className="spectra-plan-empty">
          <ListTodo className="h-7 w-7" />
          <h3>Start with one thing</h3>
          <p>
            Write the first task and the plan grows around it. Sections,
            milestones and dates come later, when you need them.
          </p>
          {!canEdit ? null : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                addTask();
              }}
            >
              <input
                ref={quickAddRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="First task"
                aria-label="First task"
              />
              <button type="submit">Add task</button>
            </form>
          )}
        </div>
      ) : view === "list" ? (
        <div className="spectra-plan-list">
          {canEdit ? (
            <div className="spectra-plan-listhead">
              {selectionMode ? (
                <button
                  type="button"
                  aria-label={allSelected ? "Clear selection" : "Select all shown"}
                  data-checked={allSelected || undefined}
                  onClick={() =>
                    setSelection(
                      allSelected
                        ? []
                        : listSections.flatMap((section) =>
                            section.rows.map((row) => row.task.id),
                          ),
                    )
                  }
                >
                  {allSelected ? <Check className="h-3 w-3" /> : null}
                </button>
              ) : null}
              <span>
                {/* "1 of 1 tasks" was a count arguing with itself. The total
                    only earns its place when something is being held back. */}
                {visibleCount === plan.tasks.length
                  ? `${plan.tasks.length} ${plan.tasks.length === 1 ? "task" : "tasks"}`
                  : `${visibleCount} of ${plan.tasks.length} tasks`}
              </span>
              <button
                type="button"
                data-active={selectionMode || undefined}
                onClick={() => {
                  setSelectionMode((on) => !on);
                  if (selectionMode) setSelection([]);
                }}
              >
                {selectionMode ? "Done selecting" : "Select"}
              </button>
              <button type="button" onClick={addSection}>
                <Plus className="h-3.5 w-3.5" /> Section
              </button>
            </div>
          ) : null}
          {listSections.map((section) => (
            <section key={section.id}>
              {/* A plan with no sections has nothing to distinguish, so the
                  implicit bucket does not announce itself. Once a real section
                  exists, the loose tasks need a name again. */}
              {section.id === "__unsectioned" && listSections.length === 1 ? null : (
                <header>
                  <strong>{section.title}</strong>
                  <em>{section.rows.length}</em>
                </header>
              )}
              {section.rows.map((row) => (
                <article
                  key={row.task.id}
                  data-status={row.task.status}
                  data-selected={
                    selection.includes(row.task.id) || undefined
                  }
                  style={{ paddingLeft: 10 + row.depth * 18 }}
                >
                  {selectionMode && canEdit ? (
                    <button
                      type="button"
                      className="spectra-plan-select"
                      aria-label={`Select ${row.task.title}`}
                      data-checked={
                        selection.includes(row.task.id) || undefined
                      }
                      onClick={() =>
                        setSelection((current) =>
                          current.includes(row.task.id)
                            ? current.filter((id) => id !== row.task.id)
                            : [...current, row.task.id],
                        )
                      }
                    >
                      {selection.includes(row.task.id) ? (
                        <Check className="h-3 w-3" />
                      ) : null}
                    </button>
                  ) : null}
                  {/* The box at the head of a task row completes the task. It
                      used to add the task to a bulk selection, which is a false
                      affordance on the one control every task list shares — and
                      in a side panel the status control beside it was hidden, so
                      there was no way to finish a task at all. Selecting many
                      tasks is now its own mode, entered from the list header. */}
                  <button
                    type="button"
                    className="spectra-plan-check"
                    disabled={!canEdit}
                    aria-pressed={row.task.status === "done"}
                    aria-label={
                      row.task.status === "done"
                        ? `Mark ${row.task.title} as not done`
                        : `Mark ${row.task.title} done`
                    }
                    onClick={() =>
                      setTaskStatus(
                        row.task.id,
                        row.task.status === "done" ? "todo" : "done",
                      )
                    }
                  >
                    {row.task.status === "done" ? (
                      <Check className="h-3 w-3" />
                    ) : null}
                  </button>
                  {/* A native control, deliberately: this list can hold hundreds
                      of rows, and a portaled popover per row costs far more than
                      it returns. It is a tinted chip rather than an OS dropdown,
                      and it stays in a side panel — statuses beyond done are the
                      point of a plan, not a wide-screen luxury. */}
                  <select
                    className="spectra-plan-status"
                    aria-label={`Status of ${row.task.title}`}
                    disabled={!canEdit}
                    value={row.task.status}
                    style={{ color: STATUS_TONE[row.task.status] }}
                    onChange={(event) =>
                      setTaskStatus(
                        row.task.id,
                        event.target.value as PlanStatus,
                      )
                    }
                  >
                    {PLAN_STATUS_ORDER.map((status) => (
                      <option key={status} value={status}>
                        {PLAN_STATUS_LABELS[status]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="spectra-plan-title"
                    onClick={() =>
                      setOpenTaskId(
                        openTaskId === row.task.id ? undefined : row.task.id,
                      )
                    }
                  >
                    <span>{row.task.title}</span>
                    {row.task.checklist.length ? (
                      <em>
                        {row.task.checklist.filter((item) => item.done).length}/
                        {row.task.checklist.length}
                      </em>
                    ) : null}
                    {row.blockedBy.length ? (
                      <em data-tone="blocked">
                        waiting on {row.blockedBy.length}
                      </em>
                    ) : null}
                    {row.milestoneTitle ? <em>{row.milestoneTitle}</em> : null}
                  </button>
                  {row.task.officialDeadlineRef ? (
                    <span
                      className="spectra-plan-official"
                      title="This deadline comes from your school and is not moved here."
                    >
                      School
                    </span>
                  ) : null}
                  {/* One date, one slot. The row used to print "08/21/2026" and
                      "5d" side by side — the same fact twice, in two registers.
                      The relative reading is what a person scans for, so it
                      holds the slot and the picker rises to meet the pointer. */}
                  <span className="spectra-plan-date">
                    <input
                      type="date"
                      aria-label={`Due date of ${row.task.title}`}
                      disabled={
                        !canEdit || Boolean(row.task.officialDeadlineRef)
                      }
                      value={dateInput(row.task.dueAt, plan.timezone)}
                      onChange={(event) =>
                        setDue(row.task.id, event.target.value)
                      }
                    />
                    <span
                      className="spectra-plan-due"
                      data-overdue={
                        row.task.dueAt !== undefined &&
                        row.task.dueAt < now &&
                        row.task.status !== "done"
                          ? true
                          : undefined
                      }
                    >
                      {dueLabel(row.task, now, plan.timezone) ||
                        (canEdit && !row.task.officialDeadlineRef
                          ? "Add date"
                          : "")}
                    </span>
                  </span>
                </article>
              ))}
            </section>
          ))}
          {!visibleCount ? (
            <p className="spectra-plan-none">
              No task matches these filters. Widen them to see the rest of the
              plan.
            </p>
          ) : null}
          {!canEdit ? null : (
            <form
              className="spectra-plan-add"
              onSubmit={(event) => {
                event.preventDefault();
                addTask();
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              <input
                ref={quickAddRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Add a task"
                aria-label="Add a task"
              />
            </form>
          )}
        </div>
      ) : view === "board" ? (
        <div className="spectra-plan-board">
          {boardColumns.map((column) => (
            <section
              key={column.status}
              // Without this a card could be dragged across five identical
              // columns with no sign of which one would take it.
              data-dropping={dropStatus === column.status || undefined}
              onDragOver={(event) => {
                if (!canEdit) return;
                event.preventDefault();
                setDropStatus(column.status);
              }}
              onDragLeave={() =>
                setDropStatus((current) =>
                  current === column.status ? undefined : current,
                )
              }
              onDrop={(event) => {
                setDropStatus(undefined);
                const taskId = event.dataTransfer.getData("text/plain");
                if (taskId && canEdit) setTaskStatus(taskId, column.status);
              }}
            >
              <header>
                <strong style={{ color: STATUS_TONE[column.status] }}>
                  {column.title}
                </strong>
                <em>{column.tasks.length}</em>
              </header>
              {column.tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  draggable={canEdit}
                  onDragStart={(event) =>
                    event.dataTransfer.setData("text/plain", task.id)
                  }
                  onClick={() =>
                    setOpenTaskId(openTaskId === task.id ? undefined : task.id)
                  }
                >
                  <strong>{task.title}</strong>
                  <span>
                    {task.dueAt !== undefined ? (
                      <em
                        data-overdue={
                          task.dueAt < now && task.status !== "done"
                            ? true
                            : undefined
                        }
                      >
                        {dueLabel(task, now, plan.timezone)}
                      </em>
                    ) : null}
                    {task.officialDeadlineRef ? (
                      <em className="spectra-plan-official">School</em>
                    ) : null}
                    {task.estimateMinutes ? (
                      <em>{task.estimateMinutes}m</em>
                    ) : null}
                  </span>
                </button>
              ))}
              {!column.tasks.length && !canEdit ? (
                <p>Nothing here yet.</p>
              ) : null}
              {/* A board you can only read from is half a board. Adding here
                  writes the column's own status, which is the whole point of
                  putting the task in this column — and it means the plan's
                  primary verb no longer has to throw the person back into the
                  list to add one thing. */}
              {canEdit ? (
                <form
                  className="spectra-plan-column-add"
                  onSubmit={(event) => {
                    event.preventDefault();
                    addTask({ status: column.status });
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <input
                    ref={
                      column.status === "todo" ? boardAddRef : undefined
                    }
                    value={columnDraft[column.status] ?? ""}
                    onChange={(event) =>
                      setColumnDraft((current) => ({
                        ...current,
                        [column.status]: event.target.value,
                      }))
                    }
                    placeholder="Add a task"
                    aria-label={`Add a task to ${column.title}`}
                  />
                </form>
              ) : null}
            </section>
          ))}
        </div>
      ) : view === "workload" ? (
        <div className="spectra-plan-workload">
          <header>
            <div>
              <strong>Workload from Calendar</strong>
              <span>Next five weeks. Scheduled blocks remain editable in Calendar.</span>
            </div>
            <button
              type="button"
              onClick={() =>
                runPlannerCommand("workload.refresh", null, refreshWorkload)
              }
              disabled={workloadState === "loading"}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
            <button
              type="button"
              onClick={() =>
                runPlannerCommand("workload.open-calendar", null, () =>
                  studio.executeApplicationCommand?.("app.calendar.open", {}),
                )
              }
            >
              <CalendarRange className="h-3.5 w-3.5" /> Edit in Calendar
            </button>
          </header>
          {workloadState === "loading" ? (
            <div className="spectra-plan-workload-state" aria-live="polite">
              Reading scheduled work from Calendar…
            </div>
          ) : workloadState === "error" ? (
            <div className="spectra-plan-workload-state">
              Calendar workload is unavailable. Your Plan has not been changed.
            </div>
          ) : workload.length ? (
            <div className="spectra-plan-workload-rows">
              <div className="spectra-plan-workload-head" aria-hidden="true">
                <span>Task</span>
                <span>Scheduled</span>
                <span>Estimate</span>
                <span>Still to place</span>
              </div>
              {workload.map((row) => (
                <button
                  key={row.task.id}
                  type="button"
                  onClick={() => setOpenTaskId(row.task.id)}
                >
                  <span>
                    <strong>{row.task.title}</strong>
                    <em>{row.blockCount} calendar block{row.blockCount === 1 ? "" : "s"}</em>
                  </span>
                  <span>{row.scheduledMinutes}m</span>
                  <span>{row.estimateMinutes === undefined ? "Not estimated" : `${row.estimateMinutes}m`}</span>
                  <span>{row.remainingMinutes === undefined ? "Set an estimate" : `${row.remainingMinutes}m`}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="spectra-plan-workload-state">
              No scheduled work blocks from Calendar match this Plan yet.
            </div>
          )}
        </div>
      ) : (
        <div className="spectra-plan-timeline">
          {timeline.window ? (
            // A lane per task, with the name in a column of its own.
            //
            // Bars used to be laid out inline and sized from the estimate, which
            // on a fortnight axis made every task a 36px square holding one
            // truncated letter ("C…"), stacked with no lane structure and
            // overflowing the right edge. The name now lives outside the axis,
            // so a mark on the axis only has to say *when* — and a deadline with
            // no known start is drawn as a marker rather than as a bar whose
            // length is a guess.
            <div className="spectra-plan-lanes">
              <div className="spectra-plan-axis">
                <span />
                <div>
                  {axisTicks.map((tick) => (
                    <span key={tick.at} style={{ left: `${tick.at}%` }}>
                      {tick.label}
                    </span>
                  ))}
                </div>
              </div>
              {timeline.bars.map((bar) => {
                const span = timeline.window!.to - timeline.window!.from || 1;
                const left =
                  ((bar.startAt - timeline.window!.from) / span) * 100;
                const width = ((bar.endAt - bar.startAt) / span) * 100;
                return (
                  <div className="spectra-plan-lane" key={bar.task.id}>
                    <button
                      type="button"
                      className="spectra-plan-lane-name"
                      onClick={() =>
                        setOpenTaskId(
                          openTaskId === bar.task.id ? undefined : bar.task.id,
                        )
                      }
                    >
                      {bar.task.title}
                    </button>
                    <div className="spectra-plan-lane-track">
                      {todayAt !== undefined ? (
                        <i
                          className="spectra-plan-today"
                          style={{ left: `${todayAt}%` }}
                          aria-hidden="true"
                        />
                      ) : null}
                      <button
                        type="button"
                        className="spectra-plan-bar"
                        data-inferred={bar.inferred || undefined}
                        data-status={bar.task.status}
                        style={
                          bar.inferred
                            ? { left: `${((bar.endAt - timeline.window!.from) / span) * 100}%` }
                            : { left: `${left}%`, width: `${width}%` }
                        }
                        aria-label={
                          bar.inferred
                            ? `${bar.task.title}, due ${shortDate(bar.endAt, plan.timezone)}`
                            : `${bar.task.title}, ${shortDate(bar.startAt, plan.timezone)} to ${shortDate(bar.endAt, plan.timezone)}`
                        }
                        onClick={() =>
                          setOpenTaskId(
                            openTaskId === bar.task.id
                              ? undefined
                              : bar.task.id,
                          )
                        }
                      />
                    </div>
                    {/* The date sits in a column of its own. Overlaid on the
                        right of the track it collided with any mark falling
                        near the end of the window — which is exactly where a
                        deadline tends to be. */}
                    <span className="spectra-plan-lane-date">
                      {shortDate(bar.endAt, plan.timezone)}
                    </span>
                  </div>
                );
              })}
              {timeline.milestones.length ? (
                <div className="spectra-plan-lane">
                  <span className="spectra-plan-lane-label">Milestones</span>
                  <div className="spectra-plan-lane-track">
                    {timeline.milestones.map((milestone) => {
                      const span =
                        timeline.window!.to - timeline.window!.from || 1;
                      return (
                        <span
                          key={milestone.id}
                          className="spectra-plan-milestone"
                          data-status={milestone.status}
                          style={{
                            left: `${((milestone.at - timeline.window!.from) / span) * 100}%`,
                          }}
                        >
                          {milestone.title}
                        </span>
                      );
                    })}
                  </div>
                  <span />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="spectra-plan-none">
              No task in this plan has a date yet. Give one a due date and the
              timeline appears.
            </p>
          )}
          {timeline.unscheduled.length ? (
            <div className="spectra-plan-unscheduled">
              <strong>Not scheduled</strong>
              {timeline.unscheduled.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() =>
                    setOpenTaskId(openTaskId === task.id ? undefined : task.id)
                  }
                >
                  {task.title}
                </button>
              ))}
            </div>
          ) : null}
          {/* A footnote, not a preface. Four lines of explanation above the
              content pushed the timeline itself below the fold. */}
          {timeline.window ? (
            <p className="spectra-plan-axis-note">
              A dot marks a deadline on its own; a bar spans the estimated work
              up to it. Schedule work blocks in Calendar to place them exactly.
            </p>
          ) : null}
        </div>
      )}

      {openTask ? (
        <aside className="spectra-plan-detail">
          <header>
            <strong>Task</strong>
            <button
              type="button"
              onClick={() => setOpenTaskId(undefined)}
              aria-label="Close task"
            >
              <X className="h-4 w-4" />
            </button>
          </header>
          <input
            className="spectra-plan-detail-title"
            value={openTask.title}
            disabled={!canEdit}
            onChange={(event) => {
              const value = event.target.value.slice(0, 500);
              patchTask(openTask.id, { title: value }, "task.title", {
                taskId: openTask.id,
                value,
              });
            }}
            aria-label="Task title"
          />
          <textarea
            value={openTask.description}
            disabled={!canEdit}
            placeholder="What does done look like?"
            aria-label="Task description"
            onChange={(event) =>
              patchTask(
                openTask.id,
                { description: event.target.value },
                "task.description",
                { taskId: openTask.id, value: event.target.value },
              )
            }
          />
          <div className="spectra-plan-detail-grid">
            <label>
              <span>Status</span>
              <select
                disabled={!canEdit}
                value={openTask.status}
                onChange={(event) =>
                  setTaskStatus(openTask.id, event.target.value as PlanStatus)
                }
              >
                {PLAN_STATUS_ORDER.map((status) => (
                  <option key={status} value={status}>
                    {PLAN_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Priority</span>
              <select
                disabled={!canEdit}
                value={openTask.priority}
                onChange={(event) => {
                  const priority = event.target.value as PlanPriority;
                  patchTask(
                    openTask.id,
                    { priority },
                    "task.priority",
                    { taskId: openTask.id, priority },
                  );
                }}
              >
                {PLAN_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Due</span>
              <input
                type="date"
                disabled={!canEdit || Boolean(openTask.officialDeadlineRef)}
                value={dateInput(openTask.dueAt, plan.timezone)}
                onChange={(event) => setDue(openTask.id, event.target.value)}
              />
            </label>
            <label>
              <span>Estimate</span>
              <input
                type="number"
                min={0}
                step={15}
                disabled={!canEdit}
                value={openTask.estimateMinutes ?? ""}
                placeholder="minutes"
                onChange={(event) => {
                  const minutes = event.target.value
                    ? Math.max(1, Number(event.target.value))
                    : undefined;
                  patchTask(
                    openTask.id,
                    { estimateMinutes: minutes },
                    "task.estimate",
                    { taskId: openTask.id, minutes: minutes ?? null },
                  );
                }}
              />
            </label>
            <label>
              <span>Section</span>
              <select
                disabled={!canEdit}
                value={openTask.sectionId ?? ""}
                onChange={(event) =>
                  patchTask(
                    openTask.id,
                    { sectionId: event.target.value || undefined },
                    "task.section",
                    { taskId: openTask.id, value: event.target.value || null },
                  )
                }
              >
                <option value="">No section</option>
                {plan.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Parent task</span>
              <select
                disabled={!canEdit}
                value={openTask.parentTaskId ?? ""}
                onChange={(event) => {
                  const parentTaskId = event.target.value || undefined;
                  runPlannerCommand(
                    "task.parent",
                    { taskId: openTask.id, value: parentTaskId ?? null },
                    () => {
                      try {
                        commit(setPlanParent(plan, openTask.id, parentTaskId));
                      } catch {
                        setProblem("That task relationship would loop back on itself.");
                      }
                    },
                  );
                }}
              >
                <option value="">No parent</option>
                {plan.tasks
                  .filter((task) => task.id !== openTask.id)
                  .map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>Milestone</span>
              <select
                disabled={!canEdit}
                value={openTask.milestoneId ?? ""}
                onChange={(event) =>
                  patchTask(
                    openTask.id,
                    { milestoneId: event.target.value || undefined },
                    "task.milestone",
                    { taskId: openTask.id, value: event.target.value || null },
                  )
                }
              >
                <option value="">None</option>
                {plan.milestones.map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Waiting on</span>
              <select
                disabled={!canEdit}
                value=""
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) return;
                  const dependencyIds = [
                    ...new Set([...openTask.dependencyIds, value]),
                  ];
                  patchTask(
                    openTask.id,
                    { dependencyIds },
                    "task.dependencies",
                    { taskId: openTask.id, dependencyIds },
                  );
                  event.target.value = "";
                }}
              >
                <option value="">Add a dependency…</option>
                {plan.tasks
                  .filter(
                    (task) =>
                      task.id !== openTask.id &&
                      !openTask.dependencyIds.includes(task.id),
                  )
                  .map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {openTask.officialDeadlineRef ? (
            <p className="spectra-plan-detail-note">
              This deadline comes from your school. Spectra does not move it —
              schedule work before it instead.
            </p>
          ) : (
            <section className="spectra-plan-detail-section">
              <header>
                <CalendarClock className="h-3.5 w-3.5" />
                <strong>Natural due date</strong>
              </header>
              <div className="spectra-plan-inline-editor">
                <input
                  value={duePhrase}
                  disabled={!canEdit}
                  onChange={(event) => setDuePhrase(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !duePreview?.ok) return;
                    event.preventDefault();
                    setNaturalDue(openTask.id);
                  }}
                  placeholder="Tomorrow at 4pm"
                  aria-label="Natural due date"
                />
                <button
                  type="button"
                  disabled={!canEdit || !duePreview?.ok}
                  onClick={() => setNaturalDue(openTask.id)}
                >
                  Set
                </button>
              </div>
              {duePreview ? (
                <p data-tone={duePreview.ok ? "preview" : "refusal"}>
                  {duePreview.ok ? `Resolves to ${duePreview.label}.` : duePreview.reason}
                </p>
              ) : (
                <p>Try today, tomorrow, next Friday, or 2026-09-04.</p>
              )}
            </section>
          )}
          <section className="spectra-plan-detail-section">
            <header>
              <Tags className="h-3.5 w-3.5" />
              <strong>Labels</strong>
            </header>
            <input
              value={
                labelsEditor?.taskId === openTask.id
                  ? labelsEditor.value
                  : openTask.labels.join(", ")
              }
              disabled={!canEdit}
              onChange={(event) =>
                setLabelsEditor({ taskId: openTask.id, value: event.target.value })
              }
              onBlur={(event) => {
                const labels = normalizePlanLabels(event.currentTarget.value.split(/[,;]+/));
                patchTask(
                  openTask.id,
                  { labels },
                  "task.labels",
                  { taskId: openTask.id, labels, mode: "set" },
                );
                setLabelsEditor({ taskId: openTask.id, value: labels.join(", ") });
              }}
              placeholder="research, exam"
              aria-label="Task labels"
            />
          </section>
          <section className="spectra-plan-detail-section">
            <header>
              <ListTodo className="h-3.5 w-3.5" />
              <strong>Subtasks</strong>
            </header>
            {plan.tasks.some((task) => task.parentTaskId === openTask.id) ? (
              <ul className="spectra-plan-subtasks">
                {plan.tasks
                  .filter((task) => task.parentTaskId === openTask.id)
                  .sort((left, right) => left.order - right.order)
                  .map((task) => (
                    <li key={task.id}>
                      <button type="button" onClick={() => setOpenTaskId(task.id)}>
                        <span data-done={task.status === "done" || undefined}>{task.title}</span>
                        <em>{PLAN_STATUS_LABELS[task.status]}</em>
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <p>No nested tasks yet.</p>
            )}
            {!canEdit ? null : (
              <form
                className="spectra-plan-inline-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  addSubtask(openTask);
                }}
              >
                <input
                  value={subtaskDraft}
                  onChange={(event) => setSubtaskDraft(event.target.value)}
                  placeholder="Add a subtask"
                  aria-label="Subtask title"
                />
                <button type="submit" disabled={!subtaskDraft.trim()}>
                  Add
                </button>
              </form>
            )}
          </section>
          {openTask.dependencyIds.length ? (
            <ul className="spectra-plan-chips">
              {openTask.dependencyIds.map((id) => {
                const dependency = plan.tasks.find((task) => task.id === id);
                return (
                  <li key={id}>
                    {dependency?.title ?? "Removed task"}
                    {!canEdit ? null : (
                      <button
                        type="button"
                        aria-label="Remove dependency"
                        onClick={() => {
                          const dependencyIds = openTask.dependencyIds.filter(
                            (candidate) => candidate !== id,
                          );
                          patchTask(
                            openTask.id,
                            { dependencyIds },
                            "task.dependencies",
                            { taskId: openTask.id, dependencyIds },
                          );
                        }}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <section className="spectra-plan-detail-section">
            <header>
              <RefreshCw className="h-3.5 w-3.5" />
              <strong>Recurrence</strong>
            </header>
            {openTask.officialDeadlineRef ? (
              <p data-tone="refusal">
                Official deadlines cannot be made recurring in Plan.
              </p>
            ) : (
              <>
                <div className="spectra-plan-recurrence-grid">
                  <label>
                    <span>Repeats</span>
                    <select
                      disabled={!canEdit}
                      value={openTask.recurrence.frequency}
                      onChange={(event) =>
                        updateRecurrence(openTask, {
                          frequency: event.target.value as PlanRecurrenceFrequency,
                        })
                      }
                    >
                      <option value="none">Does not repeat</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </label>
                  <label>
                    <span>Every</span>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      disabled={!canEdit || openTask.recurrence.frequency === "none"}
                      value={openTask.recurrence.interval}
                      onChange={(event) =>
                        updateRecurrence(openTask, {
                          interval: Math.max(1, Math.min(365, Number(event.target.value) || 1)),
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Ends</span>
                    <input
                      type="date"
                      disabled={!canEdit || openTask.recurrence.frequency === "none"}
                      value={dateInput(
                        openTask.recurrence.untilAt,
                        plan.timezone,
                      )}
                      onChange={(event) => {
                        if (!event.target.value) {
                          updateRecurrence(openTask, { untilAt: undefined });
                          return;
                        }
                        const parsed = parsePlanDue(event.target.value, {
                          now: currentTimeMs(),
                          timezone: plan.timezone,
                        });
                        if (!parsed.ok) {
                          setProblem(parsed.reason);
                          return;
                        }
                        updateRecurrence(openTask, { untilAt: parsed.dueAt });
                      }}
                    />
                  </label>
                </div>
                {openTask.recurrence.frequency === "weekly" ? (
                  <div className="spectra-plan-weekdays" aria-label="Repeat on weekdays">
                    {["S", "M", "T", "W", "T", "F", "S"].map((label, day) => {
                      const selected = openTask.recurrence.weekdays.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          disabled={!canEdit}
                          data-selected={selected || undefined}
                          aria-pressed={selected}
                          aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]}
                          onClick={() =>
                            updateRecurrence(openTask, {
                              weekdays: selected
                                ? openTask.recurrence.weekdays.filter((candidate) => candidate !== day)
                                : [...openTask.recurrence.weekdays, day].sort(),
                            })
                          }
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {openTask.recurrence.frequency !== "none" ? (
                  <>
                    <div className="spectra-plan-inline-editor">
                      <input
                        type="date"
                        disabled={!canEdit}
                        value={recurrenceExceptionDraft}
                        onChange={(event) => setRecurrenceExceptionDraft(event.target.value)}
                        aria-label="Skip recurrence date"
                      />
                      <button
                        type="button"
                        disabled={!canEdit || !recurrenceExceptionDraft}
                        onClick={() => {
                          const parsed = parsePlanDue(recurrenceExceptionDraft, {
                            now: currentTimeMs(),
                            timezone: plan.timezone,
                          });
                          if (!parsed.ok) {
                            setProblem(parsed.reason);
                            return;
                          }
                          updateRecurrence(openTask, {
                            exceptions: [
                              ...new Set([...openTask.recurrence.exceptions, parsed.dueAt]),
                            ].sort(),
                          });
                          setRecurrenceExceptionDraft("");
                        }}
                      >
                        Skip date
                      </button>
                    </div>
                    {openTask.recurrence.exceptions.length ? (
                      <ul className="spectra-plan-chips" aria-label="Skipped recurrence dates">
                        {openTask.recurrence.exceptions.map((exception) => (
                          <li key={exception}>
                            {shortDate(exception, plan.timezone)}
                            {!canEdit ? null : (
                              <button
                                type="button"
                                aria-label={`Restore ${shortDate(exception, plan.timezone)}`}
                                onClick={() =>
                                  updateRecurrence(openTask, {
                                    exceptions: openTask.recurrence.exceptions.filter(
                                      (candidate) => candidate !== exception,
                                    ),
                                  })
                                }
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : null}
                <p>
                  Plan supports daily, weekly, monthly, and yearly patterns. More
                  complex recurrence stays unchanged instead of being guessed.
                </p>
              </>
            )}
          </section>
          <section className="spectra-plan-detail-section">
            <header>
              <Bell className="h-3.5 w-3.5" />
              <strong>Reminders</strong>
            </header>
            {openTask.reminders.map((reminder) => (
              <div className="spectra-plan-reminder" key={reminder.id}>
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={reminder.enabled}
                  aria-label={`Enable ${reminder.minutesBefore} minute reminder`}
                  onChange={(event) =>
                    updateReminders(
                      openTask,
                      openTask.reminders.map((candidate) =>
                        candidate.id === reminder.id
                          ? { ...candidate, enabled: event.target.checked }
                          : candidate,
                      ),
                    )
                  }
                />
                <input
                  type="number"
                  min={0}
                  max={525600}
                  disabled={!canEdit}
                  value={reminder.minutesBefore}
                  aria-label="Minutes before due date"
                  onChange={(event) => {
                    const minutesBefore = Math.max(
                      0,
                      Math.min(525_600, Number(event.target.value) || 0),
                    );
                    updateReminders(
                      openTask,
                      openTask.reminders.map((candidate) =>
                        candidate.id === reminder.id
                          ? { ...candidate, minutesBefore }
                          : candidate,
                      ),
                    );
                  }}
                />
                <span>minutes before</span>
                {!canEdit ? null : (
                  <button
                    type="button"
                    aria-label="Remove reminder"
                    onClick={() =>
                      updateReminders(
                        openTask,
                        openTask.reminders.filter((candidate) => candidate.id !== reminder.id),
                      )
                    }
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {!canEdit || openTask.reminders.length >= 24 ? null : (
              <form
                className="spectra-plan-inline-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  const minutesBefore = Math.max(
                    0,
                    Math.min(525_600, Number(reminderMinutesDraft) || 0),
                  );
                  updateReminders(openTask, [
                    ...openTask.reminders,
                    { id: uniqueId("reminder"), minutesBefore, enabled: true },
                  ]);
                }}
              >
                <input
                  type="number"
                  min={0}
                  max={525600}
                  value={reminderMinutesDraft}
                  onChange={(event) => setReminderMinutesDraft(event.target.value)}
                  aria-label="New reminder minutes before due date"
                />
                <button type="submit">Add reminder</button>
              </form>
            )}
            <p>{PLAN_REMINDER_DELIVERY_PENDING}</p>
            <p>Delivery channels are not configurable in Plan.</p>
          </section>
          <div className="spectra-plan-checklist">
            <strong>Checklist</strong>
            {openTask.checklist.map((item) => (
              <div className="spectra-plan-checklist-row" key={item.id}>
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={item.done}
                  onChange={() =>
                    patchTask(
                      openTask.id,
                      {
                        checklist: openTask.checklist.map((candidate) =>
                          candidate.id === item.id
                            ? { ...candidate, done: !candidate.done }
                            : candidate,
                        ),
                      },
                      "checklist.toggle",
                      {
                        taskId: openTask.id,
                        itemId: item.id,
                        done: !item.done,
                      },
                    )
                  }
                />
                <input
                  type="text"
                  defaultValue={item.title}
                  disabled={!canEdit}
                  data-done={item.done || undefined}
                  aria-label="Checklist item title"
                  onBlur={(event) => {
                    const title = event.currentTarget.value.trim();
                    if (!title) {
                      event.currentTarget.value = item.title;
                      setProblem("Checklist items need a name.");
                      return;
                    }
                    if (title === item.title) return;
                    patchTask(
                      openTask.id,
                      {
                        checklist: openTask.checklist.map((candidate) =>
                          candidate.id === item.id ? { ...candidate, title } : candidate,
                        ),
                      },
                      "checklist.update",
                      { taskId: openTask.id, itemId: item.id, title },
                    );
                  }}
                />
                {!canEdit ? null : (
                  <button
                    type="button"
                    aria-label="Remove checklist item"
                    onClick={() =>
                      patchTask(
                        openTask.id,
                        {
                          checklist: openTask.checklist.filter(
                            (candidate) => candidate.id !== item.id,
                          ),
                        },
                        "checklist.remove",
                        { taskId: openTask.id, itemId: item.id },
                      )
                    }
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {!canEdit ? null : (
              <button
                type="button"
                onClick={() => {
                  const item = {
                    id: uniqueId("check"),
                    title: `Step ${openTask.checklist.length + 1}`,
                    done: false,
                  };
                  patchTask(
                    openTask.id,
                    { checklist: [...openTask.checklist, item] },
                    "checklist.add",
                    { taskId: openTask.id, itemId: item.id, title: item.title },
                  );
                }}
              >
                <Plus className="h-3 w-3" /> Add step
              </button>
            )}
          </div>
          {!canEdit ? null : (
            <button
              type="button"
              className="spectra-plan-delete-task spectra-plan-danger"
              onClick={() => requestTaskDelete(openTask.id)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete task
            </button>
          )}
          {openTask.referenceIds.length ? (
            <div className="spectra-plan-references">
              <strong>Linked work</strong>
              {openTask.referenceIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onOpenArtifact?.(id)}
                >
                  <Link2 className="h-3 w-3" /> {id}
                </button>
              ))}
            </div>
          ) : null}
          {openTask.sourceRefs.length ? (
            <div className="spectra-plan-references">
              <strong>Sources</strong>
              {openTask.sourceRefs.map((ref) => (
                <span key={ref}>{ref}</span>
              ))}
            </div>
          ) : null}
        </aside>
      ) : null}

      {pendingBulk?.bulk.confirmation ? (
        <div className="spectra-plan-confirm" role="alertdialog">
          <div>
            <strong>{pendingBulk.bulk.confirmation.title}</strong>
            <p>{pendingBulk.bulk.confirmation.body}</p>
            <footer>
              <button type="button" onClick={() => setPendingBulk(undefined)}>
                Keep them
              </button>
              <button
                type="button"
                className="spectra-plan-danger"
                onClick={confirmBulk}
              >
                {pendingBulk.bulk.confirmation.confirmLabel}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}
