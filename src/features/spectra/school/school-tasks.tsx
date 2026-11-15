"use client";

import { SearchField } from "@/components/ui/search-field";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-state";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select";
import { api } from "../../../../convex/_generated/api";
import type { SchoolSyncKind } from "../../../../shared/school-sync";
import { restoreSpectraPastTasks } from "../data/api";
import { useAuthedArgs } from "../data/use-authed-args";
import { isKeptRecordId, keepPastTasks, keptTasksMissingFrom, readKeptTasks, type KeptTask } from "./past-task-shelf";
import { groupCurrentTasks, groupPastTasks, hasSchoolTaskSnapshot, taskMatches, type SchoolPreferences, type SchoolSyncStatus } from "./school-model";
import { TaskGroup, TaskTicket, TicketsSkeleton } from "./school-tickets";
import { inkStyle, useClassBook } from "./use-class-book";

/*
 * Tasks: every task as a ticket. Current work is grouped by when it is due;
 * past work by class, each class under its own ink, and by term within it.
 * Past tasks older than the two weeks Spectra keeps come from this device's
 * own shelf, and come back from ManageBac when opened.
 */

const DAY_MS = 24 * 60 * 60_000;
type Restore = "restoring" | "failed";

export type TaskView = "current" | "past" | "all";

export function TasksSection({
  now,
  status,
  view,
  onViewChange,
  selectedId,
  onSelect,
  preferences,
  onSync,
  syncing,
  onOpenSync,
}: {
  now: number;
  status: SchoolSyncStatus | undefined;
  view: TaskView;
  onViewChange: (view: TaskView) => void;
  selectedId: string | null;
  onSelect: (recordId: string) => void;
  preferences: SchoolPreferences | undefined;
  onSync: (kind?: SchoolSyncKind) => void;
  syncing: boolean;
  onOpenSync: () => void;
}) {
  const [query, setQuery] = useState("");
  const pastMode = preferences?.kinds.find((kind) => kind.kind === "past_tasks")?.mode;
  const [classId, setClassId] = useState("all");
  const tasks = useQuery(api.school.tasks, useAuthedArgs({ view, ...(classId !== "all" ? { providerClassId: classId } : {}) }));
  const book = useClassBook();
  const [kept, setKept] = useState<KeptTask[]>([]);
  const [restores, setRestores] = useState<Record<string, Restore>>({});
  useEffect(() => setKept(readKeptTasks()), []);
  useEffect(() => {
    if (!tasks) return;
    const shelf = keepPastTasks(tasks.tasks);
    if (shelf) setKept(shelf);
  }, [tasks]);
  const showsPast = view !== "current" && pastMode !== "off";
  const older = useMemo(
    () => showsPast && tasks
      ? keptTasksMissingFrom(kept, tasks.tasks, { ...(classId !== "all" ? { providerClassId: classId } : {}), matches: (task) => taskMatches(task, query) })
      : [],
    [classId, kept, query, showsPast, tasks],
  );
  const visible = useMemo(() => (tasks?.tasks ?? []).filter((task) => taskMatches(task, query)), [query, tasks]);
  const current = useMemo(() => groupCurrentTasks(visible, now), [now, visible]);
  const past = useMemo(() => groupPastTasks([...visible.filter((task) => task.past), ...older]), [older, visible]);

  async function bringBack(task: (typeof visible)[number]) {
    if (!task.providerClassId || task.dueAt === null || restores[task.recordId] === "restoring") return;
    setRestores((state) => ({ ...state, [task.recordId]: "restoring" }));
    try {
      // The day it was due, either side of midnight in any time zone.
      await restoreSpectraPastTasks({ providerClassId: task.providerClassId, from: task.dueAt - DAY_MS, to: task.dueAt + DAY_MS });
      // It leaves the shelf when the sync brings it back; if ManageBac no longer has it, it can be tried again.
      window.setTimeout(() => setRestores(({ [task.recordId]: _done, ...rest }) => rest), 2 * 60_000);
    } catch {
      setRestores((state) => ({ ...state, [task.recordId]: "failed" }));
    }
  }
  const currentMode = preferences?.kinds.find((kind) => kind.kind === "current_tasks")?.mode;

  const classOptions = [
    { value: "all", label: "All classes" },
    ...book.classes.filter((cls) => !cls.archived).map((cls) => ({ value: cls.providerClassId, label: book.of(cls.providerClassId, cls.title)!.name })),
  ];

  function empty() {
    if (query.trim()) return <EmptyState compact icon="search" title="No tasks match" detail="Try fewer words, or another class." action={<Button size="sm" onClick={() => setQuery("")}>Clear search</Button>} />;
    const mode = view === "past" ? pastMode : currentMode;
    const label = view === "past" ? "Past tasks" : "Current tasks";
    if (mode === "off")
      return (
        <EmptyState
          compact
          icon="task"
          title={`${label} are off`}
          detail="Turn them on in Sync to see them here."
          action={<Button size="sm" onClick={onOpenSync}>Open Sync</Button>}
        />
      );
    if (!hasSchoolTaskSnapshot(status, view)) return null;
    return (
      <EmptyState
        compact
        icon="task"
        title={view === "past" ? "No past tasks yet" : view === "current" ? "Nothing due" : "No tasks yet"}
        detail={view === "past" ? "Your finished tasks from ManageBac show up here." : "New tasks from ManageBac show up here."}
        action={
          <Button size="sm" disabled={syncing} onClick={() => onSync(view === "past" ? "past_tasks" : view === "current" ? "current_tasks" : undefined)}>
            {syncing ? "Syncing" : "Sync now"}
          </Button>
        }
      />
    );
  }

  const ticket = (task: (typeof visible)[number]) => {
    const keptCopy = isKeptRecordId(task.recordId);
    return (
      <TaskTicket
        key={task.recordId}
        task={task}
        identity={book.of(task.providerClassId, task.className)}
        now={now}
        selected={selectedId === task.recordId}
        kept={keptCopy ? restores[task.recordId] ?? "kept" : undefined}
        onSelect={() => (keptCopy ? void bringBack(task) : onSelect(task.recordId))}
      />
    );
  };

  return (
    <section aria-label="Tasks" className="min-w-0">
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
        <Segmented
          label="Which tasks"
          value={view}
          onChange={onViewChange}
          options={[
            { value: "current", label: "Current" },
            { value: "past", label: "Past" },
            { value: "all", label: "All" },
          ]}
        />
        <SelectField ariaLabel="Class" size="sm" value={classId} onChange={setClassId} options={classOptions} triggerClassName="w-52" />
        <SearchField value={query} onChange={setQuery} label="Find a task" className="w-48 flex-1 sm:max-w-72" />
      </div>
      {tasks === undefined ? (
        <TicketsSkeleton count={6} />
      ) : !visible.length && !older.length ? (
        empty()
      ) : (
        <>
          {current.map((group) => (
            <TaskGroup key={group.key} label={group.label} count={group.tasks.length} late={group.key === "late"} open={query.trim() ? true : undefined}>
              <div className="school-tickets">{group.tasks.map(ticket)}</div>
            </TaskGroup>
          ))}
          {past.map((group) => {
            const identity = book.of(group.key === group.className ? null : group.key, group.className);
            return (
              <TaskGroup
                key={group.key}
                label={
                  <>
                    <span aria-hidden className="school-class-dot self-center" />
                    {identity?.name ?? group.className}
                  </>
                }
                name={identity?.name ?? group.className}
                open={query.trim() ? true : undefined}
                style={inkStyle(identity)}
              >
                {group.terms.map((term) => (
                  <div key={term.term} className="mb-3">
                    {group.terms.length > 1 || term.term !== "No term" ? <p className="mb-2 text-caption text-[var(--text-tertiary)]">{term.term}</p> : null}
                    <div className="school-tickets">{term.tasks.map(ticket)}</div>
                  </div>
                ))}
              </TaskGroup>
            );
          })}
        </>
      )}
    </section>
  );
}
