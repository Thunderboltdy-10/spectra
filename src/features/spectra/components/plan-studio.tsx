"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { currentTimeMs, uniqueToken } from "@/lib/unique-token";
import {
  AlertCircle,
  CalendarClock,
  Check,
  ChevronRight,
  Download,
  Import,
  Link2,
  ListTodo,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
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

const VIEW_LABELS: Record<PlanViewKind, string> = {
  list: "List",
  board: "Board",
  timeline: "Timeline",
};

const STATUS_TONE: Record<PlanStatus, string> = {
  backlog: "var(--text-tertiary)",
  todo: "var(--text-secondary)",
  doing: "#7560e8",
  blocked: "#d88922",
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

function pillClass(active: boolean) {
  return `h-7 rounded-[6px] px-2.5 text-[11px] font-medium transition ${
    active
      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(40,50,44,.09)]"
      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
  }`;
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
  // "Overdue" and "Tomorrow" are relative to a clock, so it ticks slowly
  // rather than being read once and left to go stale on a long-open tab.
  const [now, setNow] = useState(() => currentTimeMs());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(currentTimeMs()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

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

  function addTask(sectionId?: string) {
    const title = draft.trim();
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
          status: "todo",
          assigneeIds: [],
          referenceIds: [],
          sourceRefs: [],
          calendarBlockIds: [],
          checklist: [],
          order,
          ...(sectionId ? { sectionId } : {}),
        },
      ],
    });
    setDraft("");
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
      <div className="spectra-plan-bar">
        <div className="spectra-plan-views" role="tablist" aria-label="Plan views">
          {(["list", "board", "timeline"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={view === kind}
              className={pillClass(view === kind)}
              onClick={() => setView(kind)}
            >
              {VIEW_LABELS[kind]}
            </button>
          ))}
        </div>
        <label className="spectra-plan-search">
          <Search className="h-3.5 w-3.5" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tasks"
            aria-label="Search tasks"
          />
        </label>
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as PlanStatus | "all")
          }
        >
          <option value="all">Any status</option>
          {PLAN_STATUS_ORDER.map((status) => (
            <option key={status} value={status}>
              {PLAN_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        {plan.sections.length ? (
          <select
            aria-label="Filter by section"
            value={sectionFilter}
            onChange={(event) => setSectionFilter(event.target.value)}
          >
            <option value="all">Any section</option>
            {plan.sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.title}
              </option>
            ))}
          </select>
        ) : null}
        <select
          aria-label="Filter by where the deadline came from"
          value={sourceFilter}
          onChange={(event) =>
            setSourceFilter(event.target.value as "all" | "official" | "own")
          }
        >
          <option value="all">Any deadline</option>
          <option value="official">From school</option>
          <option value="own">Your own</option>
        </select>
        <span className="ml-auto" />
        {readOnly ? null : (
          <>
            <input
              ref={importRef}
              type="file"
              hidden
              accept=".csv,.tsv,text/csv,text/tab-separated-values"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void importPlan(file);
                event.currentTarget.value = "";
              }}
            />
            <button
              type="button"
              className="spectra-plan-action"
              onClick={() => importRef.current?.click()}
            >
              <Import className="h-3.5 w-3.5" /> Import
            </button>
          </>
        )}
        <details className="spectra-plan-menu">
          <summary aria-label="Export this plan">
            <Download className="h-3.5 w-3.5" /> Export
          </summary>
          <div>
            <button type="button" onClick={() => exportPlan("csv")}>
              Spreadsheet (CSV)
            </button>
            <button type="button" onClick={() => exportPlan("ics")}>
              Calendar to-dos (ICS)
            </button>
            <button type="button" onClick={() => exportPlan("json")}>
              Full plan (JSON)
            </button>
          </div>
        </details>
      </div>

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

      {selection.length && !readOnly ? (
        <div className="spectra-plan-bulk">
          <strong>
            {selection.length} selected
          </strong>
          <select
            aria-label="Set status for selected tasks"
            value=""
            onChange={(event) => {
              if (!event.target.value) return;
              runBulk({
                kind: "set_status",
                status: event.target.value as PlanStatus,
              });
              event.target.value = "";
            }}
          >
            <option value="">Set status…</option>
            {PLAN_STATUS_ORDER.map((status) => (
              <option key={status} value={status}>
                {PLAN_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          {plan.sections.length ? (
            <select
              aria-label="Move selected tasks to a section"
              value=""
              onChange={(event) => {
                if (!event.target.value) return;
                runBulk({
                  kind: "move_to_section",
                  ...(event.target.value === "__none"
                    ? {}
                    : { sectionId: event.target.value }),
                });
                event.target.value = "";
              }}
            >
              <option value="">Move to…</option>
              <option value="__none">No section</option>
              {plan.sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.title}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            className="spectra-plan-danger"
            onClick={() => runBulk({ kind: "delete" })}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
          <button type="button" onClick={() => setSelection([])}>
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
          {!readOnly ? (
            <div className="spectra-plan-listhead">
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
              <span>
                {visibleCount} of {plan.tasks.length} tasks
              </span>
              <button type="button" onClick={addSection}>
                <Plus className="h-3.5 w-3.5" /> Section
              </button>
            </div>
          ) : null}
          {listSections.map((section) => (
            <section key={section.id}>
              <header>
                <strong>{section.title}</strong>
                <em>{section.rows.length}</em>
              </header>
              {section.rows.map((row) => (
                <article
                  key={row.task.id}
                  data-status={row.task.status}
                  data-selected={
                    selection.includes(row.task.id) || undefined
                  }
                  style={{ paddingLeft: 10 + row.depth * 18 }}
                >
                  {readOnly ? null : (
                    <button
                      type="button"
                      className="spectra-plan-check"
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
                  )}
                  <select
                    aria-label={`Status of ${row.task.title}`}
                    disabled={readOnly}
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
                  <input
                    type="date"
                    aria-label={`Due date of ${row.task.title}`}
                    disabled={readOnly || Boolean(row.task.officialDeadlineRef)}
                    value={dateInput(row.task.dueAt)}
                    onChange={(event) =>
                      setDue(row.task.id, event.target.value)
                    }
                  />
                  <span className="spectra-plan-due" data-overdue={
                    row.task.dueAt !== undefined &&
                    row.task.dueAt < now &&
                    row.task.status !== "done"
                      ? true
                      : undefined
                  }>
                    {dueLabel(row.task, now)}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 opacity-40" />
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
              onDragOver={(event) => {
                if (!readOnly) event.preventDefault();
              }}
              onDrop={(event) => {
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
              {!column.tasks.length ? (
                <p>Drop a task here to move it.</p>
              ) : null}
            </section>
          ))}
        </div>
      ) : (
        <div className="spectra-plan-timeline">
          {timeline.window ? (
            <>
              <div className="spectra-plan-axis">
                <span>{shortDate(timeline.window.from)}</span>
                <span>{shortDate(timeline.window.to)}</span>
              </div>
              <div className="spectra-plan-bars">
                {timeline.milestones.map((milestone) => {
                  const span =
                    timeline.window!.to - timeline.window!.from || 1;
                  const left =
                    ((milestone.at - timeline.window!.from) / span) * 100;
                  return (
                    <div
                      key={milestone.id}
                      className="spectra-plan-milestone"
                      style={{ left: `${left}%` }}
                      data-status={milestone.status}
                    >
                      <span>{milestone.title}</span>
                    </div>
                  );
                })}
                {timeline.bars.map((bar) => {
                  const span = timeline.window!.to - timeline.window!.from || 1;
                  const left = ((bar.startAt - timeline.window!.from) / span) * 100;
                  const width = Math.max(
                    2,
                    ((bar.endAt - bar.startAt) / span) * 100,
                  );
                  return (
                    <button
                      key={bar.task.id}
                      type="button"
                      className="spectra-plan-bar"
                      data-inferred={bar.inferred || undefined}
                      data-status={bar.task.status}
                      style={{ marginLeft: `${left}%`, width: `${width}%` }}
                      onClick={() =>
                        setOpenTaskId(
                          openTaskId === bar.task.id ? undefined : bar.task.id,
                        )
                      }
                    >
                      <span>{bar.task.title}</span>
                    </button>
                  );
                })}
              </div>
              <p className="spectra-plan-axis-note">
                Bars end at the deadline and are sized from the estimate, so
                they show when work has to finish rather than when it is
                scheduled. Schedule work blocks in Calendar to place them
                exactly.
              </p>
            </>
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
            disabled={readOnly}
            onChange={(event) =>
              patchTask(openTask.id, { title: event.target.value.slice(0, 500) })
            }
            aria-label="Task title"
          />
          <textarea
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
              <select
                disabled={readOnly}
                value={openTask.status}
                onChange={(event) =>
                  patchTask(openTask.id, {
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
            </label>
            <label>
              <span>Due</span>
              <input
                type="date"
                disabled={readOnly || Boolean(openTask.officialDeadlineRef)}
                value={dateInput(openTask.dueAt)}
                onChange={(event) => setDue(openTask.id, event.target.value)}
              />
            </label>
            <label>
              <span>Estimate</span>
              <input
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
              <select
                disabled={readOnly}
                value={openTask.sectionId ?? ""}
                onChange={(event) =>
                  patchTask(openTask.id, {
                    sectionId: event.target.value || undefined,
                  })
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
              <span>Milestone</span>
              <select
                disabled={readOnly}
                value={openTask.milestoneId ?? ""}
                onChange={(event) =>
                  patchTask(openTask.id, {
                    milestoneId: event.target.value || undefined,
                  })
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
                disabled={readOnly}
                value=""
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) return;
                  patchTask(openTask.id, {
                    dependencyIds: [
                      ...new Set([...openTask.dependencyIds, value]),
                    ],
                  });
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
  );
}
