"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { Icon } from "@/components/icons";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import type { BarCommand, CollapseStep } from "@/components/ui/adaptive-bar";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmptyState, LoadingRows, ProblemState } from "@/components/ui/page-state";
import { PanelTabs, SidePanel } from "@/components/ui/side-panel";
import { describeFailure } from "@/components/ui/truthful-state";
import { api } from "../../../../convex/_generated/api";
import type { SchoolSyncKind } from "../../../../shared/school-sync";
import { getAdministration, type AdministrationIdentity } from "../administration/api";
import { ArtifactStatusControl } from "../components/artifact-status-control";
import { resolveSpectraManageBacIdentity, syncSpectraManageBac } from "../data/api";
import { useAuthedArgs } from "../data/use-authed-args";
import { useLifeLanding } from "../life/use-life";
import { CasSection, ExperienceDetails } from "./school-cas";
import { ClassDetails, ClassesSection, KindDetails, SyncSection } from "./school-classes-sync";
import { ago, schoolStatus, sentenceOf, type SchoolSyncStatus } from "./school-model";
import { SectionHeading, TaskDetails, TaskRow, TasksSection, type TaskView } from "./school-tasks";

/*
 * School (docs/product/SCHOOL.md): the student's ManageBac in Spectra, on
 * the per-student API (convex/school.README.md). The stage holds Overview,
 * Tasks, CAS, Classes and Sync; the Details panel beside it shows whatever
 * is chosen, and tucks away while work or a conversation holds the Side.
 */

type Section = "overview" | "tasks" | "cas" | "classes" | "sync";
const SECTIONS: { id: Section; label: string; icon: "home" | "task" | "cas" | "school" | "syncing" }[] = [
  { id: "overview", label: "Overview", icon: "home" },
  { id: "tasks", label: "Tasks", icon: "task" },
  { id: "cas", label: "CAS", icon: "cas" },
  { id: "classes", label: "Classes", icon: "school" },
  { id: "sync", label: "Sync", icon: "syncing" },
];
const isSection = (value: string | null): value is Section => SECTIONS.some((section) => section.id === value);

type Selection =
  | { kind: "task"; id: string }
  | { kind: "experience"; id: string }
  | { kind: "class"; id: string }
  | { kind: "sync"; id: SchoolSyncKind };

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
  const [selection, setSelection] = useState<Selection | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [syncing, setSyncing] = useState<SchoolSyncKind | "all" | null>(null);
  const [notice, setNotice] = useState<string>();
  const [admin, setAdmin] = useState(false);
  const router = useRouter();
  const preferences = useQuery(api.school.preferences, useAuthedArgs({}));
  const status = useQuery(api.school.syncStatus, useAuthedArgs({}));

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get("section");
    if (isSection(query)) setSection(query);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    let live = true;
    void getAdministration<AdministrationIdentity>("identity")
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
    setSyncing(kind ?? "all");
    setNotice(undefined);
    try {
      const result = await syncSpectraManageBac(kind);
      const background = result.queued.length || result.jobs.some((job) => (job as { suspended?: boolean }).suspended);
      setNotice(background ? "Synced what was quick. The rest finishes in the background." : "Synced from ManageBac.");
    } catch (error) {
      setNotice(sentenceOf(error, "The sync didn't finish. Check your connection, then try again."));
    } finally {
      setSyncing(null);
      setNow(Date.now());
    }
  }, []);

  const statusView = schoolStatus(status, now, syncing !== null);
  const commands: BarCommand[] = [
    ...(statusView
      ? [{
          id: "status",
          icon: statusView.glyph,
          label: statusView.name ?? "Status",
          pinned: true,
          render: () => <ArtifactStatusControl status={statusView} busy={syncing !== null} onAction={() => void sync()} />,
        } satisfies BarCommand]
      : []),
    {
      id: "sync",
      icon: "syncing",
      label: syncing ? "Syncing" : "Sync now",
      disabled: syncing !== null || !preferences?.connected,
      onSelect: () => void sync(),
    },
    ...(admin ? [{ id: "connection", icon: "settings", label: "Connection", onSelect: () => router.push("/managebac") } satisfies BarCommand] : []),
  ];

  const select = (next: Selection) => setSelection(next);
  const selectedId = selection?.id ?? null;

  return (
    <main className="spectra-wave-y relative isolate flex h-full min-h-0 flex-1" data-spectra-app-surface="true" data-school-page>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <PageBody>
          <PageHeader title="School" commands={commands} plan={BAR_PLAN} barLabel="School commands" />
          <PanelTabs
            label="School sections"
            tabs={SECTIONS}
            value={section}
            onChange={(id) => go(id as Section)}
          />
          <p role="status" aria-live="polite" className="min-h-6 py-1 text-caption text-[var(--text-secondary)]">
            {notice}
          </p>
          <SectionBoundary key={section} label={SECTIONS.find((entry) => entry.id === section)!.label}>
            {section === "overview" ? (
              <Overview now={now} status={status} onGo={go} onSelectTask={(id) => select({ kind: "task", id })} selectedId={selectedId} onSync={sync} syncing={syncing !== null} onNotice={setNotice} />
            ) : section === "tasks" ? (
              <TasksSection
                now={now}
                view={taskView}
                onViewChange={setTaskView}
                selectedId={selection?.kind === "task" ? selectedId : null}
                onSelect={(id) => select({ kind: "task", id })}
                preferences={preferences}
                onSync={(kind) => void sync(kind)}
                syncing={syncing !== null}
                onOpenSync={() => go("sync")}
              />
            ) : section === "cas" ? (
              <CasSection
                now={now}
                selectedId={selection?.kind === "experience" ? selectedId : null}
                onSelect={(id) => select({ kind: "experience", id })}
                preferences={preferences}
                onSync={() => void sync("cas")}
                syncing={syncing !== null}
                onOpenSync={() => go("sync")}
              />
            ) : section === "classes" ? (
              <ClassesSection selectedId={selection?.kind === "class" ? selectedId : null} onSelect={(id) => select({ kind: "class", id })} onOpenSync={() => go("sync")} />
            ) : (
              <SyncSection
                now={now}
                preferences={preferences}
                status={status}
                syncingKind={syncing}
                onSync={(kind) => void sync(kind)}
                onSelect={(kind) => select({ kind: "sync", id: kind })}
                selectedKind={selection?.kind === "sync" ? selectedId : null}
                onNotice={setNotice}
              />
            )}
          </SectionBoundary>
        </PageBody>
      </div>
      <SidePanel id="school.details" title="Details" icon="info" stageMin={600}>
        <Details selection={selection} section={section} now={now} onNotice={setNotice} onSync={(kind) => void sync(kind)} syncing={syncing !== null} />
      </SidePanel>
    </main>
  );
}

function Details({
  selection,
  section,
  now,
  onNotice,
  onSync,
  syncing,
}: {
  selection: Selection | null;
  section: Section;
  now: number;
  onNotice: (message: string) => void;
  onSync: (kind: SchoolSyncKind) => void;
  syncing: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // What was chosen grows out of the row it was chosen from.
  useLifeLanding(ref, selection ? `${selection.kind}:${selection.id}` : null);
  if (!selection)
    return (
      <EmptyState
        compact
        icon="info"
        title="Nothing chosen"
        detail={
          section === "cas"
            ? "Choose an experience to see its reflections, outcomes and evidence."
            : section === "classes"
              ? "Choose a class to choose what syncs for it."
              : section === "sync"
                ? "Choose a kind of data to see when it last synced and what runs next."
                : "Choose a task to see its brief, grade and the files you handed in."
        }
      />
    );
  return (
    <div ref={ref} key={`${selection.kind}:${selection.id}`}>
      <SectionBoundary label="Details">
        {selection.kind === "task" ? (
          <TaskDetails recordId={selection.id} now={now} onNotice={onNotice} />
        ) : selection.kind === "experience" ? (
          <ExperienceDetails recordId={selection.id} now={now} onNotice={onNotice} />
        ) : selection.kind === "class" ? (
          <ClassDetails providerClassId={selection.id} onNotice={onNotice} />
        ) : (
          <KindDetails kind={selection.id} now={now} onSync={onSync} syncing={syncing} />
        )}
      </SectionBoundary>
    </div>
  );
}

function Overview({
  now,
  status,
  onGo,
  onSelectTask,
  selectedId,
  onSync,
  syncing,
  onNotice,
}: {
  now: number;
  status: SchoolSyncStatus | undefined;
  onGo: (section: Section) => void;
  onSelectTask: (id: string) => void;
  selectedId: string | null;
  onSync: (kind?: SchoolSyncKind) => Promise<void>;
  syncing: boolean;
  onNotice: (message: string) => void;
}) {
  const tasks = useQuery(api.school.tasks, useAuthedArgs({ view: "current" as const }));
  const cas = useQuery(api.school.cas, useAuthedArgs({}));
  const [matching, setMatching] = useState(false);
  const upcoming = useMemo(() => (tasks?.tasks ?? []).filter((task) => !task.past).slice(0, 6), [tasks]);
  const problems = (status?.kinds ?? []).filter((kind) => kind.problem && kind.available && (kind.state === "failed" || kind.state === "blocked"));

  if (status === undefined) return <LoadingRows label="Loading School" count={6} />;
  const connection = status.connection;

  if (connection.state === "not_connected")
    return (
      <EmptyState
        icon="school"
        title="ManageBac isn't connected"
        detail={connection.problem ? `${connection.problem.message} ${connection.problem.fixHint}` : "Your school connects ManageBac once; then your tasks, classes and CAS come in here."}
      />
    );

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
    <div className="space-y-2">
      {connection.problem ? (
        <ProblemState
          compact
          className="items-start text-left"
          title={connection.problem.message}
          detail={connection.problem.fixHint}
          action={
            connection.problem.fixBy === "student" ? (
              <Button size="sm" variant="primary" disabled={matching} onClick={() => void matchAccount()}>
                {matching ? "Matching" : "Match my account"}
              </Button>
            ) : undefined
          }
        />
      ) : null}

      <div className="-mx-2.5">
        <SectionHeading count={tasks?.tasks.length}>Coming up</SectionHeading>
        {tasks === undefined ? (
          <LoadingRows label="Loading tasks" count={3} />
        ) : upcoming.length ? (
          <>
            {upcoming.map((task) => (
              <TaskRow key={task.recordId} task={task} now={now} selected={selectedId === task.recordId} onSelect={() => onSelectTask(task.recordId)} />
            ))}
            <Button variant="ghost" size="sm" className="ml-1 mt-1" onClick={() => onGo("tasks")}>
              All tasks
            </Button>
          </>
        ) : (
          <p className="px-2.5 text-caption text-[var(--text-secondary)]">Nothing due. Past work is in Tasks.</p>
        )}
      </div>

      <div className="-mx-2.5">
        <SectionHeading>CAS</SectionHeading>
        {cas === undefined ? (
          <LoadingRows label="Loading CAS" count={1} />
        ) : (
          <button
            type="button"
            data-life-launch
            onClick={() => onGo("cas")}
            className="flex w-full min-w-0 items-center gap-2.5 rounded-control px-2.5 py-2 text-left outline-none hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
          >
            <Icon name="cas" size={16} accent="var(--accent-mint)" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-ui font-medium text-[var(--text-primary)]">
                {cas.outcomeCoverage.filter((outcome) => !outcome.missing).length} of {cas.outcomeCoverage.length} learning outcomes met
              </span>
              <span className="block truncate text-caption text-[var(--text-tertiary)]">
                {cas.experiences.length
                  ? `${cas.experiences.length} experience${cas.experiences.length === 1 ? "" : "s"}`
                  : "No experiences yet"}
                {cas.outcomeCoverage.some((outcome) => outcome.missing)
                  ? ` · still to meet: ${cas.outcomeCoverage.filter((outcome) => outcome.missing).map((outcome) => outcome.label.toLowerCase()).join(", ")}`
                  : ""}
              </span>
            </span>
            <Icon name="chevronRight" size={16} />
          </button>
        )}
      </div>

      <div className="-mx-2.5">
        <SectionHeading>Sync</SectionHeading>
        {problems.length ? (
          problems.map((kind) => (
            <div key={kind.kind} className="flex min-w-0 items-start gap-2.5 px-2.5 py-2">
              <Icon name="problem" size={16} accent="var(--danger)" className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block text-ui font-medium text-[var(--text-primary)]">{kind.problem!.message}</span>
                <span className="block text-caption text-[var(--text-secondary)]">{kind.problem!.fixHint}</span>
              </span>
              {kind.problem!.fixBy === "student" || kind.problem!.fixBy === "spectra" ? (
                <Button size="sm" variant="ghost" disabled={syncing} onClick={() => void onSync(kind.kind)}>
                  Try again
                </Button>
              ) : null}
            </div>
          ))
        ) : (
          <p className="flex items-center gap-2.5 px-2.5 py-2 text-caption text-[var(--text-secondary)]">
            <Icon name="saved" size={16} accent="var(--success)" />
            {connection.lastSyncAt ? `Everything is up to date. Last synced ${ago(connection.lastSyncAt, now)}.` : "Connected. Nothing synced yet."}
          </p>
        )}
        <Button variant="ghost" size="sm" className="ml-1" onClick={() => onGo("sync")}>
          Choose what syncs
        </Button>
      </div>
      <p className="pt-4 text-micro text-[var(--text-tertiary)]">
        Spectra reads only your own ManageBac data. <Link className="underline underline-offset-2" href="/settings?section=privacy">Privacy</Link>
      </p>
    </div>
  );
}
