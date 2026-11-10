"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState, ProblemState } from "@/components/ui/page-state";
import { SCHOOL_SYNC_KIND_INFO, type SchoolSyncKind } from "../../../../shared/school-sync";
import { resolveSpectraManageBacIdentity } from "../data/api";
import { ClassTile, useDueByClass } from "./school-classes";
import { SearchField } from "@/components/ui/search-field";
import { ago, groupCurrentTasks, hasSchoolTaskSnapshot, sentenceOf, taskMatches, type SchoolSyncStatus } from "./school-model";
import { TaskGroup, TaskTicket, TicketsSkeleton, WeekStrip, WeekStripSkeleton } from "./school-tickets";
import { useClassBook } from "./use-class-book";

/*
 * The Overview is the student's week: the days across the top, then what is
 * due as tickets, latest first, grouped the way a student plans (late, today,
 * tomorrow, this week, later). Beside it, a slip with their subjects and how
 * the sync is doing.
 */

/** How many of the later tasks the Overview shows (one row) before Tasks takes over: the week is the point here. */
const LATER_SHOWN = 3;

export type OverviewChoice = { kind: "task" | "class"; id: string } | null;

export function Overview({
  now,
  status,
  chosen,
  onChoose,
  onOpenTasks,
  onOpenClasses,
  onOpenSync,
  onSync,
  syncing,
  onNotice,
}: {
  now: number;
  status: SchoolSyncStatus | undefined;
  chosen: OverviewChoice;
  onChoose: (choice: NonNullable<OverviewChoice>) => void;
  onOpenTasks: () => void;
  onOpenClasses: () => void;
  onOpenSync: () => void;
  onSync: (kind?: SchoolSyncKind) => Promise<void>;
  syncing: boolean;
  onNotice: (message: string) => void;
}) {
  const book = useClassBook();
  const { tasks, counts } = useDueByClass();
  const [matching, setMatching] = useState(false);
  const [query, setQuery] = useState("");
  const searching = Boolean(query.trim());
  const groups = useMemo(() => groupCurrentTasks((tasks ?? []).filter((task) => taskMatches(task, query)), now), [now, query, tasks]);
  const subjects = book.classes.filter((cls) => !cls.archived && book.of(cls.providerClassId, cls.title)?.subject);

  if (status === undefined)
    return (
      <div className="school-columns">
        <div className="min-w-0">
          <WeekStripSkeleton />
          <TicketsSkeleton label="Loading School" />
        </div>
      </div>
    );
  const connection = status.connection;
  if (connection.state === "not_connected")
    return (
      <EmptyState
        icon="school"
        title="ManageBac isn't connected"
        detail={connection.problem ? `${connection.problem.message} ${connection.problem.fixHint}` : "Your school connects ManageBac once; then your tasks and classes come in here."}
      />
    );
  const failing = status.kinds.filter((kind) => kind.problem && kind.available && (kind.state === "failed" || kind.state === "blocked"));
  // The same problem on several kinds is one problem: said once, naming what it holds up.
  const problems = [...Map.groupBy(failing, (kind) => `${kind.problem!.code}|${kind.problem!.message}`).values()].map((kinds) => ({
    first: kinds[0]!,
    names: kinds.map((kind) => SCHOOL_SYNC_KIND_INFO[kind.kind].label),
  }));

  async function matchAccount() {
    setMatching(true);
    try {
      await resolveSpectraManageBacIdentity();
      onNotice("Matched. Your classes and tasks come in with the next sync.");
    } catch (error) {
      onNotice(sentenceOf(error, "Spectra couldn't match you yet. Try again later, or ask your school."));
    } finally {
      setMatching(false);
    }
  }

  return (
    <div className="school-columns">
      <div className="min-w-0">
        {connection.problem ? (
          <ProblemState
            compact
            className="mb-6 items-start text-left"
            title={connection.problem.message}
            detail={connection.problem.fixHint}
            action={
              connection.problem.code === "INTEGRATION_REVIEW_REQUIRED" ? (
                <Button size="sm" variant="primary" asChild>
                  <Link href="/managebac?tab=conflicts">Review changes</Link>
                </Button>
              ) : connection.problem.fixBy === "student" ? (
                <Button size="sm" variant="primary" disabled={matching} onClick={() => void matchAccount()}>
                  {matching ? "Matching" : "Match my account"}
                </Button>
              ) : undefined
            }
          />
        ) : null}
        <WeekStrip tasks={tasks ?? []} book={book} now={now} known={hasSchoolTaskSnapshot(status)} />
        {tasks?.length ? (
          <div className="school-find">
            <SearchField value={query} onChange={setQuery} label="Find a task" className="w-full sm:max-w-72" />
          </div>
        ) : null}
        {tasks === undefined ? (
          <TicketsSkeleton />
        ) : !groups.length && searching ? (
          <EmptyState compact icon="search" title="No tasks match" detail="Try fewer words, or search every task in Tasks." action={<Button size="sm" onClick={() => setQuery("")}>Clear search</Button>} />
        ) : !groups.length ? (
          hasSchoolTaskSnapshot(status) ? <EmptyState compact icon="task" title="Nothing due" detail="New tasks from ManageBac show up here. Past work is in Tasks." action={<Button size="sm" onClick={onOpenTasks}>Open Tasks</Button>} /> : null
        ) : (
          groups.map((group) => {
            const shown = group.key === "later" && !searching ? group.tasks.slice(0, LATER_SHOWN) : group.tasks;
            return (
              <TaskGroup key={group.key} label={group.label} count={group.tasks.length} late={group.key === "late"} open={searching || undefined}>
                <div className="school-tickets">
                  {shown.map((task) => (
                    <TaskTicket
                      key={task.recordId}
                      task={task}
                      identity={book.of(task.providerClassId, task.className)}
                      now={now}
                      selected={chosen?.kind === "task" && chosen.id === task.recordId}
                      onSelect={() => onChoose({ kind: "task", id: task.recordId })}
                    />
                  ))}
                </div>
                {shown.length < group.tasks.length ? (
                  <button type="button" className="today-link mt-3 inline-block" onClick={onOpenTasks}>
                    {group.tasks.length - shown.length} more in Tasks
                  </button>
                ) : null}
              </TaskGroup>
            );
          })
        )}
      </div>

      <aside aria-label="Your classes and sync" className="min-w-0 xl:sticky xl:top-6">
        {subjects.length ? (
          <section className="school-slip" aria-labelledby="school-subjects-heading">
            <h3 id="school-subjects-heading" className="school-slip-heading">
              Your subjects
              <button type="button" className="today-link" onClick={onOpenClasses}>
                All classes
              </button>
            </h3>
            <div className="school-tiles school-tiles--narrow">
              {subjects.map((cls) => (
                <ClassTile
                  key={cls.providerClassId}
                  cls={cls}
                  identity={book.of(cls.providerClassId, cls.title)!}
                  due={counts.get(cls.providerClassId) ?? 0}
                  small
                  selected={chosen?.kind === "class" && chosen.id === cls.providerClassId}
                  onSelect={() => onChoose({ kind: "class", id: cls.providerClassId })}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="school-slip" aria-labelledby="school-sync-heading">
          <h3 id="school-sync-heading" className="school-slip-heading">
            ManageBac
            <button type="button" className="today-link" onClick={onOpenSync}>
              Choose what syncs
            </button>
          </h3>
          {problems.length ? (
            <ul className="space-y-3">
              {problems.map(({ first: kind, names }) => (
                <li key={kind.kind} className="flex min-w-0 items-start gap-2.5">
                  <Icon name="problem" size={16} accent="var(--danger)" className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-ui font-medium text-[var(--text-primary)]">{kind.problem!.message}</span>
                    <span className="block text-caption text-[var(--text-secondary)]">
                      {names.length > 1 ? `In ${new Intl.ListFormat("en", { type: "conjunction" }).format(names.map((name, index) => (index ? name.toLowerCase() : name)))}. ` : ""}
                      {kind.problem!.fixHint}
                    </span>
                  </span>
                  {kind.problem!.code === "INTEGRATION_REVIEW_REQUIRED" ? (
                    <Button size="sm" variant="ghost" asChild>
                      <Link href="/managebac?tab=conflicts">Review changes</Link>
                    </Button>
                  ) : kind.problem!.fixBy === "student" || kind.problem!.fixBy === "spectra" ? (
                    <Button size="sm" variant="ghost" disabled={syncing} onClick={() => void onSync(kind.kind)}>
                      Try again
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2.5 text-ui text-[var(--text-secondary)]">
              <Icon name="saved" size={16} accent="var(--success)" />
              {connection.lastSyncAt ? `Synced ${ago(connection.lastSyncAt, now)}.` : connection.problem ? "Nothing has synced yet." : "Connected. Nothing synced yet."}
            </p>
          )}
          <p className="mt-4 text-caption text-[var(--text-tertiary)]">
            Spectra reads only your own ManageBac data.{" "}
            <Link className="underline underline-offset-2" href="/settings?section=privacy">
              Privacy
            </Link>
          </p>
        </section>
      </aside>
    </div>
  );
}
