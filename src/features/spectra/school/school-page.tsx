"use client";

import { Component, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import type { BarCommand, CollapseStep } from "@/components/ui/adaptive-bar";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { ProblemState } from "@/components/ui/page-state";
import { PanelTabs, SidePanel } from "@/components/ui/side-panel";
import { describeFailure } from "@/components/ui/truthful-state";
import { api } from "../../../../convex/_generated/api";
import type { SchoolSyncKind } from "../../../../shared/school-sync";
import { readIdentity } from "../administration/identity";
import { ArtifactStatusControl } from "../components/artifact-status-control";
import { syncSpectraManageBac } from "../data/api";
import { useAuthedArgs } from "../data/use-authed-args";
import { useLifeLanding } from "../life/use-life";
import { openWorkInSide } from "../components/side-open";
import { ClassDetails, ClassesSection } from "./school-classes";
import { useOpenSchoolTask } from "./open-school-task";
import { ago, groupCurrentTasks, hasSchoolTaskSnapshot, schoolStatus, sentenceOf, type SchoolSyncStatus } from "./school-model";
import { Overview } from "./school-overview";
import { SyncSection } from "./school-sync";
import { TasksSection, type TaskView } from "./school-tasks";

/*
 * School (docs/product/SCHOOL.md): the student's ManageBac in Spectra, on
 * the per-student API (convex/school.README.md). The stage holds Overview,
 * Tasks, Classes and Sync. A task opens as its task work in the Side, the
 * same as from Home or the Calendar; a class chosen opens beside the stage,
 * and the panel goes when it is let go: nothing waits there empty.
 */

type Section = "overview" | "tasks" | "classes" | "sync";

// The sync asked for here outlives the page: leaving School while it runs and
// coming back still shows it running. What runs in the background shows from
// the server's own status (syncStatus.running), after a reload too.
let syncInFlight: SchoolSyncKind | "all" | null = null;
const syncListeners = new Set<() => void>();
function setSyncInFlight(next: SchoolSyncKind | "all" | null) {
  syncInFlight = next;
  for (const listener of syncListeners) listener();
}
function useSyncInFlight() {
  return useSyncExternalStore(
    (listener) => {
      syncListeners.add(listener);
      return () => syncListeners.delete(listener);
    },
    () => syncInFlight,
    () => null,
  );
}
const SECTIONS: { id: Section; label: string; icon: "home" | "task" | "school" | "syncing" }[] = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "tasks", label: "Tasks", icon: "task" },
  { id: "classes", label: "Classes", icon: "school" },
  { id: "sync", label: "Sync", icon: "syncing" },
];
const isSection = (value: string | null): value is Section => SECTIONS.some((section) => section.id === value);

type Selection = { kind: "task" | "class"; id: string };
type ClassSelection = { kind: "class"; id: string };

const BAR_PLAN: readonly CollapseStep[] = [{ hideLabel: "connection" }, { toMenu: "connection" }, { hideLabel: "sync" }];

/** A section that failed to read: the problem in words, and a way to try again. */
class SectionBoundary extends Component<{ children: ReactNode; label: string }, { error: unknown; attempt: number }> {
  state = { error: null as unknown, attempt: 0 };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    if (!this.state.error) return <div key={this.state.attempt}>{this.props.children}</div>;
    const failure = describeFailure(this.state.error, { fallback: "Check your connection, then try again." });
    return (
      <ProblemState
        compact
        title={`${this.props.label} didn't load`}
        detail={failure.message}
        action={<Button size="sm" onClick={() => this.setState((current) => ({ error: null, attempt: current.attempt + 1 }))}>Try again</Button>}
      />
    );
  }
}

export function SchoolPage() {
  const [section, setSection] = useState<Section>("overview");
  const [taskView, setTaskView] = useState<TaskView>("current");
  const [selection, setSelection] = useState<ClassSelection | null>(null);
  const [openedTask, setOpenedTask] = useState<string | null>(null);
  const { workOf } = useOpenSchoolTask();
  const [now, setNow] = useState(() => Date.now());
  const asked = useSyncInFlight();
  const [notice, setNotice] = useState<string>();
  const [admin, setAdmin] = useState(false);
  const router = useRouter();
  const preferences = useQuery(api.school.preferences, useAuthedArgs({}));
  const status = useQuery(api.school.syncStatus, useAuthedArgs({}));
  const current = useQuery(api.school.tasks, useAuthedArgs({ view: "current" as const }));
  const busy = asked !== null || status?.running === true;

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const section = query.get("section");
    if (isSection(section)) setSection(section);
    // A link to a task opens its work; a class's page in the Library opens the class.
    const task = query.get("task");
    const cls = query.get("class");
    if (task) openTaskRef.current(task);
    else if (cls) setSelection({ kind: "class", id: cls });
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    let live = true;
    void readIdentity()
      .then((identity) => live && setAdmin(identity?.membership?.role === "school_admin"))
      .catch(() => undefined);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  const go = useCallback((next: Section) => {
    setSection(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("section");
    else url.searchParams.set("section", next);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  const sync = useCallback(async (kind?: SchoolSyncKind) => {
    if (syncInFlight !== null) return;
    setSyncInFlight(kind ?? "all");
    setNotice(undefined);
    try {
      const result = await syncSpectraManageBac(kind);
      const background = result.queued.length || result.jobs.some((job) => (job as { suspended?: boolean }).suspended);
      setNotice(background ? "Synced what was quick. The rest finishes in the background." : "Synced from ManageBac.");
    } catch (error) {
      setNotice(sentenceOf(error, "The sync didn't finish. Check your connection, then try again."));
    } finally {
      setSyncInFlight(null);
      setNow(Date.now());
    }
  }, []);

  const statusView = schoolStatus(status, now, busy);
  const commands: BarCommand[] = [
    ...(statusView
      ? [{
          id: "status",
          icon: statusView.glyph,
          label: statusView.name ?? "Status",
          pinned: true,
          render: () => <ArtifactStatusControl status={statusView} busy={busy} onAction={() => void sync()} />,
        } satisfies BarCommand]
      : []),
    {
      id: "sync",
      icon: "syncing",
      label: busy ? "Syncing" : "Sync now",
      disabled: busy || !preferences?.connected,
      onSelect: () => void sync(),
    },
    ...(admin ? [{ id: "connection", icon: "settings", label: "Connection", onSelect: () => router.push("/managebac") } satisfies BarCommand] : []),
  ];

  const select = (next: Selection) => {
    if (next.kind === "class") {
      setSelection({ kind: "class", id: next.id });
      return;
    }
    // A task is one kind of work wherever it opens: its work, in the Side.
    setSelection(null);
    setOpenedTask(next.id);
    void workOf(next.id).then((workId) => {
      if (workId) openWorkInSide(workId);
      else setNotice("This task can't open in Spectra any more. It may have been removed in ManageBac.");
    });
  };
  const openTaskRef = useRef((id: string) => select({ kind: "task", id }));
  openTaskRef.current = (id: string) => select({ kind: "task", id });
  const selectedId = selection?.id ?? null;
  const chosen: Selection | null = selection ?? (openedTask ? { kind: "task", id: openedTask } : null);

  return (
    <main className="spectra-wave-y relative isolate flex h-full min-h-0 flex-1" data-spectra-app-surface="true" data-school-page>
      <div className="spectra-page-scroll min-w-0 flex-1 overflow-y-auto">
        <PageBody>
          <PageHeader title="School" description={summary(current?.tasks, status, now)} commands={commands} plan={BAR_PLAN} barLabel="School commands" />
          <PanelTabs label="School sections" tabs={SECTIONS} value={section} onChange={(id) => go(id as Section)} />
          <p role="status" aria-live="polite" className="min-h-6 py-1 text-caption text-[var(--text-secondary)]">
            {notice}
          </p>
          <SectionBoundary key={section} label={SECTIONS.find((entry) => entry.id === section)!.label}>
            {section === "overview" ? (
              <Overview
                now={now}
                status={status}
                chosen={chosen}
                onChoose={select}
                onOpenTasks={() => go("tasks")}
                onOpenClasses={() => go("classes")}
                onOpenSync={() => go("sync")}
                onSync={sync}
                syncing={busy}
                onNotice={setNotice}
              />
            ) : section === "tasks" ? (
              <TasksSection
                now={now}
                status={status}
                view={taskView}
                onViewChange={setTaskView}
                selectedId={openedTask}
                onSelect={(id) => select({ kind: "task", id })}
                preferences={preferences}
                onSync={(kind) => void sync(kind)}
                syncing={busy}
                onOpenSync={() => go("sync")}
              />
            ) : section === "classes" ? (
              <ClassesSection status={status} selectedId={selection?.kind === "class" ? selectedId : null} onSelect={(id) => select({ kind: "class", id })} onOpenSync={() => go("sync")} />
            ) : (
              <SyncSection now={now} preferences={preferences} status={status} syncingKind={asked} onSync={(kind) => void sync(kind)} onNotice={setNotice} />
            )}
          </SectionBoundary>
        </PageBody>
      </div>
      {selection ? (
        <SidePanel id="school.chosen" title="Class" icon="school" stageMin={600} onClose={() => setSelection(null)}>
          <Chosen selection={selection} status={status} now={now} onSelect={select} onNotice={setNotice} />
        </SidePanel>
      ) : null}
    </main>
  );
}

/** The header's line: what needs doing, and how fresh it is. */
function summary(tasks: Parameters<typeof groupCurrentTasks>[0] | undefined, status: SchoolSyncStatus | undefined, now: number) {
  if (!tasks || !hasSchoolTaskSnapshot(status))
    return status?.connection.problem?.message ?? status?.kinds.find(kind => kind.kind === "current_tasks")?.problem?.message;
  const groups = groupCurrentTasks(tasks, now);
  const count = (key: string) => groups.find((group) => group.key === key)?.tasks.length ?? 0;
  const late = count("late");
  const soon = count("week");
  const parts = [late ? `${late} late` : null, soon ? `${soon} due this week` : null].filter(Boolean);
  const work = parts.length ? `${parts.join(" and ")}.` : "Nothing due this week.";
  const synced = status?.connection.lastSyncAt ? ` Synced from ManageBac ${ago(status.connection.lastSyncAt, now)}.` : "";
  return work + synced;
}

function Chosen({
  selection,
  status,
  now,
  onSelect,
  onNotice,
}: {
  selection: ClassSelection;
  status: SchoolSyncStatus | undefined;
  now: number;
  onSelect: (next: Selection) => void;
  onNotice: (message: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The class grows out of the tile it was chosen from.
  useLifeLanding(ref, `class:${selection.id}`);
  return (
    <div ref={ref} key={selection.id}>
      <SectionBoundary label="This class">
        <ClassDetails providerClassId={selection.id} status={status} now={now} onSelectTask={(id) => onSelect({ kind: "task", id })} onNotice={onNotice} />
      </SectionBoundary>
    </div>
  );
}
