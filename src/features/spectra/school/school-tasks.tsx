"use client";

import { SearchField } from "@/components/ui/search-field";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-state";
import { Segmented } from "@/components/ui/segmented";
import { SelectField } from "@/components/ui/select";
import { api } from "../../../../convex/_generated/api";
import type { SchoolSyncKind } from "../../../../shared/school-sync";
import { useAuthedArgs } from "../data/use-authed-args";
import { groupCurrentTasks, groupPastTasks, taskMatches, type SchoolPreferences } from "./school-model";
import { TaskGroup, TaskTicket, TicketsSkeleton } from "./school-tickets";
import { inkStyle, useClassBook } from "./use-class-book";

/*
 * Tasks: every task as a ticket. Current work is grouped by when it is due;
 * past work by class, each class under its own ink, and by term within it.
 */

export type TaskView = "current" | "past" | "all";

export function TasksSection({
  now,
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
  const [classId, setClassId] = useState("all");
  const tasks = useQuery(api.school.tasks, useAuthedArgs({ view, ...(classId !== "all" ? { providerClassId: classId } : {}) }));
  const book = useClassBook();
  const visible = useMemo(() => (tasks?.tasks ?? []).filter((task) => taskMatches(task, query)), [query, tasks]);
  const current = useMemo(() => groupCurrentTasks(visible, now), [now, visible]);
  const past = useMemo(() => groupPastTasks(visible.filter((task) => task.past)), [visible]);
  const pastMode = preferences?.kinds.find((kind) => kind.kind === "past_tasks")?.mode;
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
    return (
      <EmptyState
        compact
        icon="task"
        title={view === "past" ? "No past tasks yet" : view === "current" ? "Nothing due" : "No tasks yet"}
        detail={view === "past" ? "Spectra starts from today. Bring in your earlier tasks from ManageBac when you want them for revision." : "New tasks from ManageBac show up here."}
        action={
          <Button size="sm" disabled={syncing} onClick={() => onSync(view === "past" ? "past_tasks" : view === "current" ? "current_tasks" : undefined)}>
            {syncing ? "Syncing" : view === "past" ? "Bring in past tasks" : "Sync now"}
          </Button>
        }
      />
    );
  }

  const ticket = (task: (typeof visible)[number]) => (
    <TaskTicket
      key={task.recordId}
      task={task}
      identity={book.of(task.providerClassId, task.className)}
      now={now}
      selected={selectedId === task.recordId}
      onSelect={() => onSelect(task.recordId)}
    />
  );

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
      ) : !visible.length ? (
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
