"use client";

import { useLatest, useStudioContextItems } from "./studio-context-menu";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Download, FileSpreadsheet, Import, Plus, Search, SlidersHorizontal, Check } from "lucide-react";
import { AlertCircle, X } from "@/components/icons/glyph-icons";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { currentTimeMs, uniqueToken } from "@/lib/unique-token";
import { projectBindingsFromIr } from "../capabilities";
import { normalizePlanContent, validatePlanDependencies, type PlanContent, type PlanStatus, type PlanTask } from "../plan/model";
import {
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
import { downloadDocumentText } from "./artifact-studio-file-utils";
import { useStudioContract } from "./artifact-studio-shell";
import { ArtifactWorkbar, contentHistoryBindings } from "./artifact-workbar";
import { PlanBoard } from "./planner/plan-board";
import { PlanBulkBar } from "./planner/plan-bulk-bar";
import { filtersActive, NO_FILTERS, PlanFilterBar, PlanSearch, type PlanFilters } from "./planner/plan-find";
import { PlanList } from "./planner/plan-list";
import { PlanTaskSheet } from "./planner/plan-task-sheet";
import { PlanTimeline } from "./planner/plan-timeline";
import { useReminderTime } from "./task/task-reminders";
import { taskInstant, validZone } from "./task/task-time";

/**
 * Plan (§11H, EDITORS.md "Plan").
 *
 * List, Board and Timeline are three readings of one set of tasks, each
 * derived by `plan/projections`, so a task cannot be in one and missing from
 * another. This component holds the plan's one model and the state around it
 * (what is open, found, filtered, selected); the pages themselves live in
 * `planner/`. A task opens on its own page: beside the list on a wide desk,
 * in its place on a narrow one.
 */

const uniqueId = (prefix: string) => `${prefix}-${uniqueToken().slice(0, 8)}`;

export function PlanStudio({
  mode,
  title,
  content,
  onChange,
  readOnly,
}: {
  mode: "split" | "tab";
  title: string;
  content: unknown;
  onChange: (content: unknown) => void;
  readOnly: boolean;
}) {
  const plan = useMemo(() => normalizePlanContent(content), [content]);
  // The content as last rendered, for work that finishes after an await (a
  // file read): it must land on the plan as it is then, not as it was.
  const contentRef = useRef(content);
  useEffect(() => {
    contentRef.current = content;
  }, [content]);
  const studio = useStudioContract();
  const canEdit = studio.can("edit") && !readOnly;
  const timeZone = validZone(typeof plan.source?.timezone === "string" ? plan.source.timezone : undefined) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const reminderTime = useReminderTime();

  const [view, setView] = useState<PlanViewKind>("list");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<PlanFilters>(NO_FILTERS);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<readonly string[]>([]);
  const [openTaskId, setOpenTaskId] = useState<string>();
  const [pendingBulk, setPendingBulk] = useState<{ bulk: PlanBulkPlan; action: PlanBulkAction }>();
  const [notice, setNotice] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [pendingQuickAdd, setPendingQuickAdd] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const boardAddRef = useRef<HTMLInputElement>(null);
  // "Overdue" and "Tomorrow" are relative to a clock, so it ticks slowly
  // rather than going stale on a long-open tab.
  const [now, setNow] = useState(() => currentTimeMs());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(currentTimeMs()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // An empty plan has only its list to write the first task on.
  const shownView: PlanViewKind = plan.tasks.length ? view : "list";
  const narrowing = filtersActive(filters);

  // The bar's Add task puts the caret on whichever line this view has; it
  // waits for the view to mount rather than firing at a node not there yet.
  useEffect(() => {
    if (!pendingQuickAdd) return;
    const target = shownView === "board" ? boardAddRef.current : addRef.current;
    if (!target) return;
    target.focus();
    setPendingQuickAdd(false);
  }, [pendingQuickAdd, shownView]);

  const filter: PlanFilter = useMemo(
    () => ({
      ...(filters.status === "all" ? {} : { statuses: [filters.status] }),
      ...(filters.section === "all" ? {} : { sectionIds: [filters.section] }),
      ...(filters.source === "all" ? {} : { fromOfficialSource: filters.source === "official" }),
      ...(search.trim() ? { search } : {}),
    }),
    [filters, search],
  );
  const listSections = useMemo(() => planListView(plan, filter), [filter, plan]);
  const boardColumns = useMemo(() => planBoardView(plan, filter), [filter, plan]);
  const timeline = useMemo(() => planTimelineView(plan, filter), [filter, plan]);
  const visibleCount = useMemo(() => listSections.reduce((total, section) => total + section.rows.length, 0), [listSections]);
  const openTask = plan.tasks.find((task) => task.id === openTaskId);

  useEffect(() => {
    // A selection that outlives its tasks would act on nothing anyone can see.
    setSelection((current) => current.filter((id) => plan.tasks.some((task) => task.id === id)));
  }, [plan]);

  function commit(next: PlanContent, message?: string) {
    if (readOnly) return;
    try {
      validatePlanDependencies(next);
    } catch (error) {
      setProblem(
        error instanceof Error && error.message === "PLAN_DEPENDENCY_CYCLE"
          ? "Those tasks would end up waiting on each other."
          : "A task waits on something that is no longer in this plan.",
      );
      return;
    }
    setProblem(undefined);
    if (message) setNotice(message);
    const latest = contentRef.current;
    onChange({ ...(latest && typeof latest === "object" ? latest : {}), ...next });
  }

  function patchTask(taskId: string, patch: Partial<PlanTask>) {
    commit({ ...plan, tasks: plan.tasks.map((task) => (task.id === taskId ? { ...task, ...patch } : task)) });
  }

  function addTask(taskTitle: string, options: { sectionId?: string; status?: PlanStatus; dueAt?: number } = {}) {
    const order = plan.tasks.reduce((max, task) => Math.max(max, task.order), -1) + 1;
    commit({
      ...plan,
      tasks: [
        ...plan.tasks,
        {
          id: uniqueId("task"),
          title: taskTitle,
          description: "",
          dependencyIds: [],
          status: options.status ?? "todo",
          assigneeIds: [],
          referenceIds: [],
          sourceRefs: [],
          calendarBlockIds: [],
          reminders: [],
          checklist: [],
          order,
          ...(options.sectionId ? { sectionId: options.sectionId } : {}),
          ...(options.dueAt !== undefined ? { dueAt: options.dueAt } : {}),
        },
      ],
    });
  }

  const planVerbs = useLatest({ addTask, addSection, patchTask, plan });
  useStudioContextItems(({ target }) => {
    if (!canEdit) return null;
    const taskId = target.closest("[data-plan-task]")?.getAttribute("data-plan-task");
    if (taskId) {
      const task = planVerbs.current.plan.tasks.find((entry) => entry.id === taskId);
      if (!task) return null;
      const done = task.status === "done";
      return [[
        { key: "task-open", label: "Open step", onSelect: () => setOpenTaskId(taskId) },
        {
          key: "task-done",
          label: done ? "Mark as not done" : "Mark as done",
          icon: Check,
          onSelect: () => planVerbs.current.patchTask(taskId, { status: done ? "todo" : "done" }),
        },
      ]];
    }
    return [[
      { key: "plan-section", label: "New section", icon: Plus, onSelect: () => planVerbs.current.addSection() },
    ]];
  });
  function addSection() {
    const order = plan.sections.reduce((max, section) => Math.max(max, section.order), -1) + 1;
    commit({ ...plan, sections: [...plan.sections, { id: uniqueId("section"), title: `Section ${order + 1}`, order }] });
  }

  function renameSection(sectionId: string, sectionTitle: string) {
    commit({ ...plan, sections: plan.sections.map((section) => (section.id === sectionId ? { ...section, title: sectionTitle } : section)) });
  }

  function setDue(taskId: string, date: string, time: string | null) {
    const result = reschedulePlanTask(plan, { taskId, ...(date ? { dueAt: taskInstant(date, time, timeZone) } : {}) });
    if (!result.ok) {
      setProblem(result.reason);
      return;
    }
    commit({
      ...result.plan,
      // Reminders count back from the due date, so they leave with it.
      tasks: date ? result.plan.tasks : result.plan.tasks.map((task) => (task.id === taskId ? { ...task, reminders: [] } : task)),
    });
  }

  function runBulk(action: PlanBulkAction, ids: readonly string[]) {
    const bulk = planBulkAction(plan, ids, action);
    if (bulk.requiresConfirmation) {
      setPendingBulk({ bulk, action });
      return;
    }
    commit(
      applyPlanBulkAction(plan, bulk, action),
      bulk.refusals.length ? `${bulk.taskIds.length} updated. ${bulk.refusals.length} left alone: ${bulk.refusals[0]!.reason}` : undefined,
    );
    setSelection([]);
  }

  function confirmBulk() {
    if (!pendingBulk) return;
    commit(applyPlanBulkAction(plan, pendingBulk.bulk, pendingBulk.action));
    if (openTaskId && pendingBulk.bulk.taskIds.includes(openTaskId)) setOpenTaskId(undefined);
    setSelection([]);
    setPendingBulk(undefined);
  }

  function exportPlan(format: "csv" | "ics" | "json") {
    const name = (plan.title || title || "plan")
      .replace(/[^a-z0-9-_]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
    const payload = format === "csv" ? planToCsv(plan) : format === "ics" ? planToIcs(plan, title) : JSON.stringify(plan, null, 2);
    const type = format === "csv" ? "text/csv" : format === "ics" ? "text/calendar" : "application/json";
    downloadDocumentText(`${name || "plan"}.${format}`, type, payload);
    setNotice(
      format === "ics"
        ? "Exported as calendar to-dos. School deadlines are marked, not rewritten."
        : `Exported ${plan.tasks.length} task${plan.tasks.length === 1 ? "" : "s"}.`,
    );
  }

  async function importPlan(file: File) {
    const text = await file.text();
    const result = planFromDelimited(normalizePlanContent(contentRef.current), text, file.name.endsWith(".tsv") ? "\t" : ",");
    if (!result.imported) {
      setProblem(result.warnings[0] ?? "Nothing in that file looked like a task.");
      return;
    }
    commit(
      result.plan,
      [
        `Imported ${result.imported} task${result.imported === 1 ? "" : "s"}.`,
        result.warnings.length ? `${result.warnings.length} row${result.warnings.length === 1 ? "" : "s"} skipped.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  const toggleTask = (taskId: string) => setOpenTaskId((current) => (current === taskId ? undefined : taskId));

  return (
    <div className="spectra-plan-studio plan-studio" data-mode={mode}>
      <ArtifactWorkbar
        label="Plan"
        modes={{ registry: true, value: view, onChange: (modeId) => setView(modeId as PlanViewKind) }}
        context={narrowing || search ? `${visibleCount} shown` : undefined}
        primary={
          canEdit
            ? {
                label: "Add task",
                icon: Plus,
                onSelect: () => {
                  // Timeline has no line to write on, so it hands over to the list.
                  if (view === "timeline") setView("list");
                  setOpenTaskId(undefined);
                  setPendingQuickAdd(true);
                },
                requires: "edit",
              }
            : undefined
        }
        actions={projectBindingsFromIr("planner_task", [
          ...contentHistoryBindings(studio.history),
          { id: "find", label: "Find tasks", icon: Search, active: searchOpen, onSelect: () => setSearchOpen((open) => !open), priority: "essential" },
          {
            id: "filters",
            label: "Filters",
            icon: SlidersHorizontal,
            active: filtersOpen || narrowing,
            onSelect: () => setFiltersOpen((open) => !open),
            priority: "essential",
            ...(narrowing ? { hint: "Some tasks are hidden" } : {}),
          },
          { id: "import", label: "Import tasks", icon: Import, onSelect: () => importRef.current?.click(), priority: "secondary", requires: "edit", hint: "CSV or TSV" },
          { id: "export-csv", label: "Export as a spreadsheet", icon: FileSpreadsheet, onSelect: () => exportPlan("csv"), priority: "advanced" },
          { id: "export-ics", label: "Export as calendar to-dos", icon: CalendarClock, onSelect: () => exportPlan("ics"), priority: "advanced" },
          { id: "export-json", label: "Export the full plan", icon: Download, onSelect: () => exportPlan("json"), priority: "advanced" },
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
        <div className="plan-desk" data-view={shownView} data-open={openTask ? "" : undefined}>
          <div className="plan-desk-main">
            {searchOpen || filtersOpen || problem || notice || (selection.length && canEdit) ? (
              <div className="plan-strip">
                {searchOpen ? <PlanSearch value={search} onChange={setSearch} onClose={() => setSearchOpen(false)} /> : null}
                {filtersOpen ? <PlanFilterBar plan={plan} filters={filters} onChange={setFilters} /> : null}
                {problem ? <PlanNote tone="problem" text={problem} onDismiss={() => setProblem(undefined)} /> : null}
                {notice ? <PlanNote text={notice} onDismiss={() => setNotice(undefined)} /> : null}
                {selection.length && canEdit ? (
                  <PlanBulkBar
                    plan={plan}
                    count={selection.length}
                    onAction={(action) => runBulk(action, selection)}
                    onClear={() => {
                      setSelection([]);
                      setSelecting(false);
                    }}
                  />
                ) : null}
              </div>
            ) : null}
            {shownView === "list" ? (
              <PlanList
                plan={plan}
                sections={listSections}
                visibleCount={visibleCount}
                now={now}
                timeZone={timeZone}
                reminderTime={reminderTime}
                canEdit={canEdit}
                openTaskId={openTask?.id}
                selecting={selecting}
                selection={selection}
                addRef={addRef}
                onSelecting={setSelecting}
                onSelection={setSelection}
                onOpen={toggleTask}
                onStatus={(taskId, status) => patchTask(taskId, { status })}
                onDue={(taskId, date) => setDue(taskId, date, null)}
                onAdd={(taskTitle, sectionId, dueAt) => addTask(taskTitle, { sectionId, dueAt })}
                onAddSection={addSection}
                onRenameSection={renameSection}
              />
            ) : shownView === "board" ? (
              <PlanBoard
                columns={boardColumns}
                now={now}
                timeZone={timeZone}
                reminderTime={reminderTime}
                canEdit={canEdit}
                openTaskId={openTask?.id}
                addRef={boardAddRef}
                onOpen={toggleTask}
                onStatus={(taskId, status) => patchTask(taskId, { status })}
                onAdd={(taskTitle, status, dueAt) => addTask(taskTitle, { status, dueAt })}
              />
            ) : (
              <PlanTimeline timeline={timeline} now={now} openTaskId={openTask?.id} onOpen={toggleTask} />
            )}
          </div>
          {openTask ? (
            <PlanTaskSheet
              key={openTask.id}
              task={openTask}
              plan={plan}
              now={now}
              timeZone={timeZone}
              reminderTime={reminderTime}
              canEdit={canEdit}
              onChange={(patch) => patchTask(openTask.id, patch)}
              onDue={(date, time) => setDue(openTask.id, date, time)}
              onClose={() => setOpenTaskId(undefined)}
              onDelete={() => runBulk({ kind: "delete" }, [openTask.id])}
            />
          ) : null}
        </div>
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

function PlanNote({ text, tone, onDismiss }: { text: string; tone?: "problem"; onDismiss: () => void }) {
  return (
    <div className="plan-note" data-tone={tone} role={tone === "problem" ? "alert" : "status"}>
      {tone === "problem" ? <AlertCircle className="size-3.5" aria-hidden /> : null}
      <p>{text}</p>
      <button type="button" className="sheet-icon-button" aria-label="Dismiss" onClick={onDismiss}>
        <X className="size-3.5" />
      </button>
    </div>
  );
}
