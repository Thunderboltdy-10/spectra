"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { currentTimeMs, uniqueToken } from "@/lib/unique-token";
import {
  AlertCircle,
  CalendarClock,
  Clock3,
  Check,
  Download,
  FileSpreadsheet,
  Import,
  Link2,
  ListTodo,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { SelectField } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArtifactWorkbar } from "./artifact-workbar";
import { projectBindingsFromIr } from "../capabilities";
import { useStudioContract } from "./artifact-studio-shell";
import {
  formatMinutesBefore,
  REMINDER_MINUTE_OPTIONS,
} from "../reminders/minutes-before";
import {
  normalizePlanContent,
  validatePlanDependencies,
  type PlanContent,
  type PlanStatus,
  type PlanTask,
} from "../plan/model";
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
  doing: "var(--brand-primary)",
  blocked: "var(--accent-gold)",
  done: "var(--success)",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function uniqueId(prefix: string) {
  return `${prefix}-${uniqueToken().slice(0, 8)}`;
}

function dateInput(value: number | undefined) {
  if (value === undefined) return "";
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shortDate(value: number) {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

function dueLabel(task: PlanTask, now: number) {
  if (task.dueAt === undefined) return "";
  const days = Math.round((task.dueAt - now) / DAY_MS);
  if (task.status === "done") return shortDate(task.dueAt);
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days <= 7) return `${days}d`;
  return shortDate(task.dueAt);
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
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "official" | "own">(
    "all",
  );
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [openTaskId, setOpenTaskId] = useState<string>();
  const [pendingBulk, setPendingBulk] = useState<{
    bulk: PlanBulkPlan;
    action: PlanBulkAction;
  }>();
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const importRef = useRef<HTMLInputElement>(null);
  const quickAddRef = useRef<HTMLInputElement>(null);
  const boardAddRef = useRef<HTMLInputElement>(null);
  const autoOpenedTaskKeyRef = useRef<string | undefined>(undefined);
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
    statusFilter !== "all" || sectionFilter !== "all" || sourceFilter !== "all";
  // "Overdue" and "Tomorrow" are relative to a clock, so it ticks slowly
  // rather than being read once and left to go stale on a long-open tab.
  const [now, setNow] = useState(() => currentTimeMs());

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

  // A one-task plan is usually the artifact's actual work, so open its
  // existing detail surface once on first read. The key guard preserves the
  // user's collapse choice while content is being saved or rehydrated.
  useEffect(() => {
    const key = plan.tasks.map((task) => task.id).join("|");
    if (autoOpenedTaskKeyRef.current === key) return;
    autoOpenedTaskKeyRef.current = key;
    if (plan.tasks.length === 1) {
      setOpenTaskId(plan.tasks[0]?.id);
    } else if (openTaskId && !plan.tasks.some((task) => task.id === openTaskId)) {
      setOpenTaskId(undefined);
    }
  }, [openTaskId, plan.tasks]);

  const filter: PlanFilter = useMemo(
    () => ({
      ...(statusFilter === "all" ? {} : { statuses: [statusFilter] }),
      ...(sectionFilter === "all" ? {} : { sectionIds: [sectionFilter] }),
      ...(sourceFilter === "all"
        ? {}
        : { fromOfficialSource: sourceFilter === "official" }),
      ...(search.trim() ? { search } : {}),
    }),
    [search, sectionFilter, sourceFilter, statusFilter],
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
      return { at: (step / 3) * 100, label: shortDate(at) };
    });
  }, [timeline.window]);
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

  useEffect(() => {
    // A selection that survives a filter change would act on tasks nobody can
    // see. It is cleared instead of silently kept.
    setSelection((current) =>
      current.filter((id) => plan.tasks.some((task) => task.id === id)),
    );
  }, [plan]);

  function commit(next: PlanContent, message?: string) {
    if (readOnly) return;
    try {
      validatePlanDependencies(next);
    } catch (error) {
      setProblem(
        error instanceof Error && error.message === "PLAN_DEPENDENCY_CYCLE"
          ? "Those dependencies would loop back on themselves."
          : "A task depends on something that is no longer in this plan.",
      );
      return;
    }
    setProblem(undefined);
    if (message) setNotice(message);
    onChange({ ...(content && typeof content === "object" ? content : {}), ...next });
  }

  function patchTask(taskId: string, patch: Partial<PlanTask>) {
    commit({
      ...plan,
      tasks: plan.tasks.map((task) =>
        task.id === taskId ? { ...task, ...patch } : task,
      ),
    });
  }

  function addTask(options?: { sectionId?: string; status?: PlanStatus }) {
    // The board types into its own column, the list into its quick-add row.
    // Both land in the same model; only the draft they read from differs.
    const status = options?.status;
    const title = (status ? (columnDraft[status] ?? "") : draft).trim();
    if (!title) return;
    const order =
      plan.tasks.reduce((max, task) => Math.max(max, task.order), -1) + 1;
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
          assigneeIds: [],
          referenceIds: [],
          sourceRefs: [],
          calendarBlockIds: [],
          reminders: [],
          checklist: [],
          order,
          ...(options?.sectionId ? { sectionId: options.sectionId } : {}),
        },
      ],
    });
    if (status)
      setColumnDraft((current) => ({ ...current, [status]: "" }));
    else setDraft("");
  }

  function addSection() {
    const order =
      plan.sections.reduce((max, section) => Math.max(max, section.order), -1) +
      1;
    commit({
      ...plan,
      sections: [
        ...plan.sections,
        { id: uniqueId("section"), title: `Section ${order + 1}`, order },
      ],
    });
  }

  function runBulk(action: PlanBulkAction) {
    const bulk = planBulkAction(plan, selection, action);
    if (bulk.requiresConfirmation) {
      setPendingBulk({ bulk, action });
      return;
    }
    commit(
      applyPlanBulkAction(plan, bulk, action),
      bulk.refusals.length
        ? `${bulk.taskIds.length} updated. ${bulk.refusals.length} left alone: ${bulk.refusals[0]!.reason}`
        : undefined,
    );
    setSelection([]);
  }

  function confirmBulk() {
    if (!pendingBulk) return;
    commit(applyPlanBulkAction(plan, pendingBulk.bulk, pendingBulk.action));
    setSelection([]);
    setOpenTaskId(undefined);
    setPendingBulk(undefined);
  }

  function setDue(taskId: string, value: string) {
    const task = plan.tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    const result = reschedulePlanTask(plan, {
      taskId,
      ...(value ? { dueAt: new Date(`${value}T12:00`).getTime() } : {}),
    });
    if (!result.ok) {
      setProblem(result.reason);
      return;
    }
    commit(result.plan);
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
          onChange: (modeId) => setView(modeId as PlanViewKind),
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
                  if (view === "timeline") setView("list");
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
      <div className="spectra-editor-body spectra-composer-clearance">
      {readOnly ? null : (
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
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                if (search) setSearch("");
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
              onClick={() => setSearch("")}
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
      {filtersOpen ? (
        <div className="spectra-plan-filters">
          <SelectField
            label="Status"
            size="sm"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as PlanStatus | "all")}
            options={[
              { value: "all", label: "Any status" },
              ...PLAN_STATUS_ORDER.map((status) => ({
                value: status,
                label: PLAN_STATUS_LABELS[status],
              })),
            ]}
          />
          {plan.sections.length ? (
            <SelectField
              label="Section"
              size="sm"
              value={sectionFilter}
              onChange={setSectionFilter}
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
            onChange={(value) =>
              setSourceFilter(value as "all" | "official" | "own")
            }
            options={[
              { value: "all", label: "Anyone" },
              { value: "official", label: "The school" },
              { value: "own", label: "You" },
            ]}
          />
          {filtersActive ? (
            <button
              type="button"
              className="spectra-plan-filters-clear"
              onClick={() => {
                setStatusFilter("all");
                setSectionFilter("all");
                setSourceFilter("all");
              }}
            >
              Show every task
            </button>
          ) : null}
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
          {readOnly ? null : (
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
                      patchTask(row.task.id, {
                        status: row.task.status === "done" ? "todo" : "done",
                      })
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
                      patchTask(row.task.id, {
                        status: event.target.value as PlanStatus,
                      })
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
                  {row.task.calendarBlockIds.length ? (
                    <span className="spectra-plan-blocks">
                      <CalendarClock className="h-3 w-3" />
                      {row.task.calendarBlockIds.length}
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
                        readOnly || Boolean(row.task.officialDeadlineRef)
                      }
                      value={dateInput(row.task.dueAt)}
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
                      {dueLabel(row.task, now) ||
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
          {readOnly ? null : (
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
                if (readOnly) return;
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
                if (taskId && !readOnly)
                  patchTask(taskId, { status: column.status });
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
                  draggable={!readOnly}
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
                        {dueLabel(task, now)}
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
                            ? `${bar.task.title}, due ${shortDate(bar.endAt)}`
                            : `${bar.task.title}, ${shortDate(bar.startAt)} to ${shortDate(bar.endAt)}`
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
                      {shortDate(bar.endAt)}
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
          <Input
            className="spectra-plan-detail-title"
            value={openTask.title}
            disabled={readOnly}
            onChange={(event) =>
              patchTask(openTask.id, { title: event.target.value.slice(0, 500) })
            }
            aria-label="Task title"
          />
          <Textarea
            value={openTask.description}
            disabled={readOnly}
            placeholder="What does done look like?"
            aria-label="Task description"
            onChange={(event) =>
              patchTask(openTask.id, { description: event.target.value })
            }
          />
          <div className="spectra-plan-detail-grid">
            <label>
              <span>Status</span>
              <SelectField
                ariaLabel="Status"
                size="sm"
                value={openTask.status}
                disabled={readOnly}
                onChange={(value) =>
                  patchTask(openTask.id, { status: value as PlanStatus })
                }
                options={PLAN_STATUS_ORDER.map((status) => ({
                  value: status,
                  label: PLAN_STATUS_LABELS[status],
                }))}
              />
            </label>
            <label>
              <span>Due</span>
              <Input
                type="date"
                disabled={readOnly || Boolean(openTask.officialDeadlineRef)}
                value={dateInput(openTask.dueAt)}
                onChange={(event) => setDue(openTask.id, event.target.value)}
              />
            </label>
            <label>
              <span>Estimate</span>
              <Input
                type="number"
                min={0}
                step={15}
                disabled={readOnly}
                value={openTask.estimateMinutes ?? ""}
                placeholder="minutes"
                onChange={(event) =>
                  patchTask(openTask.id, {
                    estimateMinutes: event.target.value
                      ? Math.max(0, Number(event.target.value))
                      : undefined,
                  })
                }
              />
            </label>
            <label>
              <span>Section</span>
              <SelectField
                ariaLabel="Section"
                size="sm"
                value={openTask.sectionId ?? ""}
                disabled={readOnly}
                onChange={(value) =>
                  patchTask(openTask.id, {
                    sectionId: value || undefined,
                  })
                }
                options={[
                  { value: "", label: "No section" },
                  ...plan.sections.map((section) => ({
                    value: section.id,
                    label: section.title,
                  })),
                ]}
              />
            </label>
            <label>
              <span>Milestone</span>
              <SelectField
                ariaLabel="Milestone"
                size="sm"
                value={openTask.milestoneId ?? ""}
                disabled={readOnly}
                onChange={(value) =>
                  patchTask(openTask.id, {
                    milestoneId: value || undefined,
                  })
                }
                options={[
                  { value: "", label: "None" },
                  ...plan.milestones.map((milestone) => ({
                    value: milestone.id,
                    label: milestone.title,
                  })),
                ]}
              />
            </label>
            <label>
              <span>Waiting on</span>
              <SelectField
                ariaLabel="Waiting on"
                size="sm"
                value=""
                disabled={readOnly}
                placeholder="Add a dependency…"
                onChange={(value) => {
                  if (!value) return;
                  patchTask(openTask.id, {
                    dependencyIds: [
                      ...new Set([...openTask.dependencyIds, value]),
                    ],
                  });
                }}
                options={plan.tasks
                  .filter(
                    (task) =>
                      task.id !== openTask.id &&
                      !openTask.dependencyIds.includes(task.id),
                  )
                  .map((task) => ({ value: task.id, label: task.title }))}
              />
            </label>
          </div>
          {openTask.officialDeadlineRef ? (
            <p className="spectra-plan-detail-note">
              This deadline comes from your school. Spectra does not move it —
              schedule work before it instead.
            </p>
          ) : null}
          {openTask.dependencyIds.length ? (
            <ul className="spectra-plan-chips">
              {openTask.dependencyIds.map((id) => {
                const dependency = plan.tasks.find((task) => task.id === id);
                return (
                  <li key={id}>
                    {dependency?.title ?? "Removed task"}
                    {readOnly ? null : (
                      <button
                        type="button"
                        aria-label="Remove dependency"
                        onClick={() =>
                          patchTask(openTask.id, {
                            dependencyIds: openTask.dependencyIds.filter(
                              (candidate) => candidate !== id,
                            ),
                          })
                        }
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div className="spectra-plan-detail-reminders">
            <h3 className="mb-2 text-caption font-semibold text-[var(--text-secondary)]">
              Reminders
            </h3>
            <div className="flex flex-wrap gap-2">
              {openTask.reminders.map((reminder) => (
                <button
                  key={reminder.id}
                  type="button"
                  disabled={readOnly}
                  onClick={() =>
                    patchTask(openTask.id, {
                      reminders: openTask.reminders.filter(
                        (item) => item.id !== reminder.id,
                      ),
                    })
                  }
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-micro text-[var(--text-secondary)]"
                  title="Remove reminder"
                >
                  <Clock3 className="h-3 w-3" />
                  {formatMinutesBefore(reminder.minutesBefore)}
                  <X className="h-3 w-3" />
                </button>
              ))}
              {!readOnly ? (
                <SelectField
                  ariaLabel="Add reminder"
                  size="sm"
                  value=""
                  placeholder="Add reminder…"
                  onChange={(value) => {
                    const minutes = Number(value);
                    if (!Number.isFinite(minutes) || minutes < 0) return;
                    if (
                      openTask.reminders.some(
                        (item) => item.minutesBefore === minutes,
                      )
                    )
                      return;
                    patchTask(openTask.id, {
                      reminders: [
                        ...openTask.reminders,
                        {
                          id: `reminder-${crypto.randomUUID()}`,
                          minutesBefore: minutes,
                        },
                      ],
                    });
                  }}
                  options={REMINDER_MINUTE_OPTIONS.map((option) => ({
                    value: String(option.minutesBefore),
                    label: option.label,
                    disabled: openTask.reminders.some(
                      (item) => item.minutesBefore === option.minutesBefore,
                    ),
                  }))}
                />
              ) : null}
            </div>
          </div>
          <div className="spectra-plan-checklist">
            <strong>Checklist</strong>
            {openTask.checklist.map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={item.done}
                  onChange={() =>
                    patchTask(openTask.id, {
                      checklist: openTask.checklist.map((candidate) =>
                        candidate.id === item.id
                          ? { ...candidate, done: !candidate.done }
                          : candidate,
                      ),
                    })
                  }
                />
                <span data-done={item.done || undefined}>{item.title}</span>
              </label>
            ))}
            {readOnly ? null : (
              <button
                type="button"
                onClick={() =>
                  patchTask(openTask.id, {
                    checklist: [
                      ...openTask.checklist,
                      {
                        id: uniqueId("check"),
                        title: `Step ${openTask.checklist.length + 1}`,
                        done: false,
                      },
                    ],
                  })
                }
              >
                <Plus className="h-3 w-3" /> Add step
              </button>
            )}
          </div>
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
        <ConfirmDialog
          open
          title={pendingBulk.bulk.confirmation.title}
          detail={pendingBulk.bulk.confirmation.body}
          cancelLabel="Keep them"
          confirmLabel={pendingBulk.bulk.confirmation.confirmLabel}
          destructive
          onCancel={() => setPendingBulk(undefined)}
          onConfirm={confirmBulk}
        />
      ) : null}
      </div>
    </div>
  );
}
