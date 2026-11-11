"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "@/features/spectra/data/use-kept-query";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingRows } from "@/components/ui/page-state";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { api } from "../../../../convex/_generated/api";
import { SCHOOL_SYNC_KIND_INFO, type SchoolSyncKind, type SchoolSyncMode } from "../../../../shared/school-sync";
import { fetchMyClassCandidates, type ClassShelfCandidate } from "../components/class-shelf-picker";
import { selectSpectraManageBacClasses } from "../data/api";
import { useAuthedArgs } from "../data/use-authed-args";
import type { ClassIdentity } from "../../../../shared/class-identity";
import { CLASS_KIND_ORDER, MODE_LABEL, hasSchoolTaskSnapshot, sentenceOf, type SchoolClass, type SchoolTask, type SchoolSyncStatus } from "./school-model";
import { DetailHeading } from "./school-task-details";
import { TaskTicket } from "./school-tickets";
import { inkStyle, useClassBook } from "./use-class-book";

/*
 * Classes: the subjects a student takes as tiles in their own inks, the
 * groups that are not subjects (mentoring, registration, drop-ins) smaller
 * beneath, and last year's classes after them. A class chosen opens beside
 * the stage with what is coming up in it and what syncs for it.
 */

const MODE_OPTIONS = (["auto", "manual", "off"] as const).map((value) => ({ value, label: MODE_LABEL[value] }));

/** Tasks still to do, counted per class. */
export function useDueByClass() {
  const tasks = useQuery(api.school.tasks, useAuthedArgs({ view: "current" as const }));
  return useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of tasks?.tasks ?? []) if (!task.past && task.providerClassId) counts.set(task.providerClassId, (counts.get(task.providerClassId) ?? 0) + 1);
    return { tasks: tasks?.tasks, counts };
  }, [tasks]);
}

export function ClassTile({
  cls,
  identity,
  due,
  selected,
  small = false,
  onSelect,
}: {
  cls: SchoolClass;
  identity: ClassIdentity;
  due?: number;
  selected: boolean;
  small?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-school-class={cls.providerClassId}
      data-life-launch
      data-paused={cls.selected ? undefined : true}
      aria-pressed={selected}
      title={identity.code ?? undefined}
      onClick={onSelect}
      style={inkStyle(identity)}
      className={cn("school-tile", small && "school-tile--small")}
    >
      <span className="min-w-0 flex-1">
        <span className="school-tile-name">{identity.name}</span>
        {!small && identity.code ? <span className="school-tile-code">{identity.code}</span> : null}
      </span>
      {small ? (
        due ? <span className="school-tile-due">{due}</span> : null
      ) : (
        <span className="school-tile-foot">
          {due ? <span className="school-tile-due">{due} to do</span> : due === 0 ? <span>Nothing due</span> : null}
          {cls.selected ? null : <span>Not syncing</span>}
        </span>
      )}
    </button>
  );
}

export function ClassesSection({ status, selectedId, onSelect, onOpenSync }: { status: SchoolSyncStatus | undefined; selectedId: string | null; onSelect: (providerClassId: string) => void; onOpenSync: () => void }) {
  const book = useClassBook();
  const { counts } = useDueByClass();
  if (book.loading)
    return (
      <section role="status" aria-label="Loading classes" className="min-w-0">
        <span data-life-ghost-bar className="mb-3 mt-8 block h-4 w-24 animate-pulse rounded-full bg-[var(--bg-tertiary)]" />
        <div className="school-tiles">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} data-life-ghost className="min-h-[132px] animate-pulse rounded-l-chip rounded-r-surface bg-[var(--bg-secondary)]" />
          ))}
        </div>
      </section>
    );
  if (!book.classes.length)
    return (
      <EmptyState
        icon="school"
        title="No classes yet"
        detail="Your classes arrive with the first sync of Classes and timetable."
        action={<Button size="sm" onClick={onOpenSync}>Open Sync</Button>}
      />
    );
  const placed = book.classes.map((cls) => ({ cls, identity: book.of(cls.providerClassId, cls.title)! }));
  const subjects = placed.filter(({ cls, identity }) => !cls.archived && identity.subject);
  const groups = placed.filter(({ cls, identity }) => !cls.archived && !identity.subject);
  const earlier = placed.filter(({ cls }) => cls.archived);
  const tiles = (list: typeof placed, small: boolean) => (
    <div className={small ? "school-tiles school-tiles--groups" : "school-tiles"}>
      {list.map(({ cls, identity }) => (
        <ClassTile
          key={cls.providerClassId}
          cls={cls}
          identity={identity}
          due={counts.get(cls.providerClassId) || (hasSchoolTaskSnapshot(status) && cls.selected && cls.modes.current_tasks !== "off" ? 0 : undefined)}
          small={small}
          selected={selectedId === cls.providerClassId}
          onSelect={() => onSelect(cls.providerClassId)}
        />
      ))}
    </div>
  );
  return (
    <section aria-label="Classes" className="min-w-0">
      {subjects.length ? (
        <>
          <h3 className="school-heading">
            Subjects <span className="school-heading-count">{subjects.length}</span>
          </h3>
          {tiles(subjects, false)}
        </>
      ) : null}
      {groups.length ? (
        <>
          <h3 className="school-heading">
            {subjects.length ? "Groups and drop-ins" : "This year"} <span className="school-heading-count">{groups.length}</span>
          </h3>
          {tiles(groups, true)}
        </>
      ) : null}
      {earlier.length ? (
        <>
          <h3 className="school-heading">
            Earlier classes <span className="school-heading-count">{earlier.length}</span>
          </h3>
          {tiles(earlier, true)}
        </>
      ) : null}
    </section>
  );
}

export function ClassDetails({
  providerClassId,
  status,
  now,
  onSelectTask,
  onNotice,
}: {
  providerClassId: string;
  status: SchoolSyncStatus | undefined;
  now: number;
  onSelectTask: (recordId: string) => void;
  onNotice: (message: string) => void;
}) {
  const book = useClassBook();
  const { tasks } = useDueByClass();
  const preferences = useQuery(api.school.preferences, useAuthedArgs({}));
  const setOverride = useMutation(api.school.setClassOverride);
  const [candidates, setCandidates] = useState<{ classes: ClassShelfCandidate[]; revision?: number } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchMyClassCandidates()
      .then((result) => {
        if (!cancelled) setCandidates({ classes: result.classes, revision: result.selectionRevision });
      })
      .catch(() => {
        if (!cancelled) setCandidates({ classes: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (book.loading || preferences === undefined) return <LoadingRows label="Loading the class" count={4} />;
  const item = book.classes.find((entry) => entry.providerClassId === providerClassId);
  if (!item) return <EmptyState compact icon="school" title="This class isn't here any more" detail="ManageBac no longer lists it for you." />;
  const identity = book.of(item.providerClassId, item.title)!;
  const candidate = candidates?.classes.find((entry) => entry.recordId === item.recordId);
  const overrides = new Map(
    preferences.classOverrides.filter((entry) => entry.providerClassId === providerClassId).map((entry) => [entry.kind, entry.mode]),
  );
  const due = (tasks ?? []).filter((task: SchoolTask) => !task.past && task.providerClassId === providerClassId);

  async function toggleSynced(next: boolean) {
    if (!candidates || !candidate || typeof candidates.revision !== "number") return;
    setSaving(true);
    try {
      const selected = candidates.classes.filter((entry) => (entry.recordId === candidate.recordId ? next : entry.selected)).map((entry) => entry.recordId);
      const result = await selectSpectraManageBacClasses({ recordIds: selected, expectedRevision: candidates.revision, retention: "keep_in_spectra" });
      setCandidates({
        revision: result.selectionRevision,
        classes: candidates.classes.map((entry) => ({ ...entry, selected: result.selectedRecordIds.includes(entry.recordId) })),
      });
      onNotice(next ? `${identity.name} syncs again.` : `${identity.name} no longer syncs. Its work stays in Spectra.`);
    } catch (error) {
      onNotice(/SELECTION_CONFLICT/.test(String(error)) ? "Your classes changed elsewhere. Open this class again, then try." : sentenceOf(error, "That didn't save. Try again."));
    } finally {
      setSaving(false);
    }
  }

  async function choose(kind: SchoolSyncKind, mode: SchoolSyncMode | "default") {
    try {
      await setOverride({ providerClassId, kind, mode: mode === "default" ? null : mode });
    } catch (error) {
      onNotice(sentenceOf(error, "That didn't save. Try again."));
    }
  }

  return (
    <article aria-labelledby="school-class-title" style={inkStyle(identity)}>
      <header className="school-detail-head">
        <span aria-hidden className="school-detail-spine" />
        <div className="min-w-0 flex-1">
          <h3 id="school-class-title" data-artifact-title className="font-display text-title font-semibold leading-snug text-[var(--text-primary)]">
            {identity.name}
          </h3>
          <p className="mt-1 text-caption text-[var(--text-secondary)]">
            {[identity.code, item.archived ? "An earlier class" : "This year", due.length ? `${due.length} to do` : null].filter(Boolean).join(", ")}
          </p>
        </div>
      </header>

      <div className="mt-4 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-ui font-medium text-[var(--text-primary)]">Sync this class</p>
          <p className="text-caption text-[var(--text-secondary)]">
            {candidate ? "Off keeps what's already here and stops bringing in more." : candidates ? "This class can't be chosen from here." : "Checking your classes."}
          </p>
        </div>
        <Switch
          aria-label="Sync this class"
          checked={candidate ? Boolean(candidate.selected) : item.selected}
          disabled={!candidate || saving || typeof candidates?.revision !== "number"}
          onCheckedChange={(checked) => void toggleSynced(checked)}
        />
      </div>

      {due.length || (hasSchoolTaskSnapshot(status) && item.selected && item.modes.current_tasks !== "off") ? <section className="school-detail-section">
        <DetailHeading>{due.length ? "To do" : "Nothing due in this class"}</DetailHeading>
        {due.length ? (
          <div className="grid gap-2">
            {due.map((task) => (
              <TaskTicket key={task.recordId} task={task} identity={identity} now={now} compact selected={false} onSelect={() => onSelectTask(task.recordId)} />
            ))}
          </div>
        ) : null}
      </section> : null}

      <details className="school-detail-section group">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-display text-subhead font-medium text-[var(--text-primary)] [&::-webkit-details-marker]:hidden">
          What syncs for this class
          <Icon name="chevronDown" className="size-3.5 text-[var(--text-tertiary)] transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-2">
      <p className="mb-2 text-caption text-[var(--text-secondary)]">Each kind follows your choice in Sync unless you set it here.</p>
      <ul className="space-y-2">
        {CLASS_KIND_ORDER.filter((kind) => SCHOOL_SYNC_KIND_INFO[kind].classScoped).map((kind) => {
          const own = overrides.get(kind);
          const base = preferences.kinds.find((entry) => entry.kind === kind);
          return (
            <li key={kind} className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-caption text-[var(--text-primary)]">{SCHOOL_SYNC_KIND_INFO[kind].label}</span>
              <Segmented
                size="compact"
                label={`${SCHOOL_SYNC_KIND_INFO[kind].label} for ${identity.name}`}
                value={own ?? "default"}
                onChange={(value) => void choose(kind, value)}
                options={[{ value: "default", label: base ? `As set (${MODE_LABEL[base.mode]})` : "As set" }, ...MODE_OPTIONS]}
              />
            </li>
          );
        })}
      </ul>
        </div>
      </details>
    </article>
  );
}
