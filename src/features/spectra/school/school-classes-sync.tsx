"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingRows } from "@/components/ui/page-state";
import { Row } from "@/components/ui/row";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { api } from "../../../../convex/_generated/api";
import { SCHOOL_SYNC_KIND_INFO, type SchoolSyncKind, type SchoolSyncMode } from "../../../../shared/school-sync";
import { fetchMyClassCandidates, type ClassShelfCandidate } from "../components/class-shelf-picker";
import { selectSpectraManageBacClasses } from "../data/api";
import { useAuthedArgs } from "../data/use-authed-args";
import { sendInto } from "../life/use-life";
import { MODE_HINT, MODE_LABEL, CLASS_KIND_ORDER, kindLine, sentenceOf, type SchoolPreferences, type SchoolSyncStatus } from "./school-model";
import { DetailHeading, SectionHeading, pressable } from "./school-tasks";

const MODE_OPTIONS = (["auto", "manual", "off"] as const).map((value) => ({ value, label: MODE_LABEL[value] }));

/* ------------------------------------------------------------ classes */

export function ClassesSection({ selectedId, onSelect, onOpenSync }: { selectedId: string | null; onSelect: (providerClassId: string) => void; onOpenSync: () => void }) {
  const classes = useQuery(api.school.classes, useAuthedArgs({}));
  if (classes === undefined) return <LoadingRows label="Loading classes" count={6} />;
  if (!classes.classes.length)
    return (
      <EmptyState
        icon="school"
        title="No classes yet"
        detail="Your classes arrive with the first sync of Classes and timetable."
        action={<Button size="sm" onClick={onOpenSync}>Open Sync</Button>}
      />
    );
  const current = classes.classes.filter((item) => !item.archived);
  const archived = classes.classes.filter((item) => item.archived);
  const row = (item: (typeof classes.classes)[number]) => {
    const overrides = Object.entries(item.modes).filter(([, mode]) => mode === "off").length;
    return (
      <Row
        key={item.providerClassId}
        glyph="school"
        title={item.title}
        meta={[item.subject !== item.title ? item.subject : null, item.selected ? null : "Not synced", overrides ? `${overrides} kind${overrides === 1 ? "" : "s"} off` : null].filter(Boolean).join(" · ") || undefined}
        selected={selectedId === item.providerClassId}
        aria-pressed={selectedId === item.providerClassId}
        className={item.selected ? undefined : "opacity-70"}
        {...pressable(() => onSelect(item.providerClassId))}
      />
    );
  };
  return (
    <section aria-label="Classes" className="-mx-2.5 min-w-0">
      <SectionHeading count={current.length}>This year</SectionHeading>
      {current.length ? current.map(row) : <p className="px-2.5 text-caption text-[var(--text-secondary)]">No current classes.</p>}
      {archived.length ? (
        <>
          <SectionHeading count={archived.length}>Earlier classes</SectionHeading>
          {archived.map(row)}
        </>
      ) : null}
    </section>
  );
}

export function ClassDetails({ providerClassId, onNotice }: { providerClassId: string; onNotice: (message: string) => void }) {
  const classes = useQuery(api.school.classes, useAuthedArgs({}));
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

  if (classes === undefined || preferences === undefined) return <LoadingRows label="Loading the class" count={4} />;
  const item = classes.classes.find((entry) => entry.providerClassId === providerClassId);
  if (!item) return <EmptyState compact icon="school" title="This class isn't here any more" detail="ManageBac no longer lists it for you." />;
  const candidate = candidates?.classes.find((entry) => entry.recordId === item.recordId);
  const overrides = new Map(
    preferences.classOverrides.filter((entry) => entry.providerClassId === providerClassId).map((entry) => [entry.kind, entry.mode]),
  );

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
      onNotice(next ? `${item!.title} syncs again.` : `${item!.title} no longer syncs. Its work stays in Spectra.`);
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
    <article aria-labelledby="school-class-title">
      <h3 id="school-class-title" data-artifact-title className="font-display text-title font-semibold leading-snug text-[var(--text-primary)]">
        {item.title}
      </h3>
      <p className="mt-1 text-caption text-[var(--text-tertiary)]">
        {[item.subject !== item.title ? item.subject : null, item.archived ? "An earlier class" : "This year", item.academicPeriodKey].filter(Boolean).join(" · ")}
      </p>

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

      <DetailHeading>What syncs for this class</DetailHeading>
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
                label={`${SCHOOL_SYNC_KIND_INFO[kind].label} for ${item.title}`}
                value={own ?? "default"}
                onChange={(value) => void choose(kind, value)}
                options={[{ value: "default", label: base ? `As set (${MODE_LABEL[base.mode]})` : "As set" }, ...MODE_OPTIONS]}
              />
            </li>
          );
        })}
      </ul>
    </article>
  );
}

/* ------------------------------------------------------------ sync */

export function SyncSection({
  now,
  preferences,
  status,
  syncingKind,
  onSync,
  onSelect,
  selectedKind,
  onNotice,
}: {
  now: number;
  preferences: SchoolPreferences | undefined;
  status: SchoolSyncStatus | undefined;
  syncingKind: SchoolSyncKind | "all" | null;
  onSync: (kind?: SchoolSyncKind) => void;
  onSelect: (kind: SchoolSyncKind) => void;
  selectedKind: string | null;
  onNotice: (message: string) => void;
}) {
  const setMode = useMutation(api.school.setMode);
  if (preferences === undefined || status === undefined) return <LoadingRows label="Loading sync" count={8} />;

  async function choose(kind: SchoolSyncKind, mode: SchoolSyncMode, row: HTMLElement | null) {
    try {
      await setMode({ kind, mode });
      if (mode === "off") onNotice(`${SCHOOL_SYNC_KIND_INFO[kind].label} is off. What was synced is removed.`);
      else sendInto(row);
    } catch (error) {
      onNotice(sentenceOf(error, "That didn't save. Try again."));
    }
  }

  return (
    <section aria-label="Sync" className="min-w-0">
      <p className="mb-4 max-w-2xl text-caption leading-5 text-[var(--text-secondary)]">
        Choose what comes in from ManageBac. {MODE_LABEL.auto}: {MODE_HINT.auto.toLowerCase()} {MODE_LABEL.manual}: {MODE_HINT.manual.toLowerCase()}{" "}
        {MODE_LABEL.off}: {MODE_HINT.off.toLowerCase()}
      </p>
      <ul className="-mx-2.5 space-y-0.5">
        {preferences.kinds.map((kind) => {
          const state = status.kinds.find((entry) => entry.kind === kind.kind);
          const problem = state?.problem && kind.available && (state.state === "failed" || state.state === "blocked") ? state.problem : null;
          const running = syncingKind === kind.kind || syncingKind === "all" ? true : state?.state === "running" || state?.state === "queued";
          return (
            <li
              key={kind.kind}
              id={`school-sync-${kind.kind}`}
              data-life-receive
              aria-current={selectedKind === kind.kind ? "true" : undefined}
              className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-control px-2.5 py-2 hover:bg-[var(--bg-hover)] aria-[current=true]:bg-[var(--bg-hover)]"
            >
              <span className="grid size-5 shrink-0 place-items-center">
                <Icon
                  name={!kind.available ? "blocked" : problem ? "problem" : running ? "syncing" : kind.mode === "off" ? "pause" : "saved"}
                  size={16}
                  animate={running}
                  accent={!kind.available ? "var(--text-tertiary)" : problem ? "var(--danger)" : running ? "var(--accent-cyan)" : kind.mode === "off" ? undefined : "var(--success)"}
                />
              </span>
              <button
                type="button"
                data-life-launch
                onClick={() => onSelect(kind.kind)}
                className="min-w-0 flex-1 rounded-control text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
              >
                <span className="block truncate text-ui font-medium text-[var(--text-primary)]">{kind.label}</span>
                <span className="block truncate text-caption text-[var(--text-tertiary)]">
                  {problem ? problem.message : state ? kindLine(state, now) : kind.available ? MODE_HINT[kind.mode] : kind.unavailableReason}
                </span>
              </button>
              {kind.available ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <Segmented
                    size="compact"
                    label={`${kind.label} sync`}
                    value={kind.mode}
                    onChange={(mode) => void choose(kind.kind, mode, document.getElementById(`school-sync-${kind.kind}`))}
                    options={MODE_OPTIONS}
                  />
                  <Button size="sm" variant="ghost" disabled={kind.mode === "off" || running || !preferences.connected} onClick={() => onSync(kind.kind)}>
                    Sync now
                  </Button>
                </div>
              ) : (
                <span className="shrink-0 text-micro text-[var(--text-tertiary)]">Not available</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function KindDetails({ kind, now, onSync, syncing }: { kind: SchoolSyncKind; now: number; onSync: (kind: SchoolSyncKind) => void; syncing: boolean }) {
  const status = useQuery(api.school.syncStatus, useAuthedArgs({}));
  const preferences = useQuery(api.school.preferences, useAuthedArgs({}));
  if (status === undefined || preferences === undefined) return <LoadingRows label="Loading" count={3} />;
  const info = SCHOOL_SYNC_KIND_INFO[kind];
  const state = status.kinds.find((entry) => entry.kind === kind);
  const pref = preferences.kinds.find((entry) => entry.kind === kind);
  const facts: { label: string; value: string }[] = [
    { label: "Mode", value: pref ? `${MODE_LABEL[pref.mode]}${pref.chosen ? "" : " (the default)"}` : "Unknown" },
    ...(pref?.mode === "auto" ? [{ label: "Runs", value: info.autoEveryMinutes >= 60 * 24 ? "Once a day" : info.autoEveryMinutes >= 60 ? `Every ${Math.round(info.autoEveryMinutes / 60)} hours`.replace("Every 1 hours", "Every hour") : `Every ${info.autoEveryMinutes} min` }] : []),
    ...(state ? [{ label: "Status", value: kindLine(state, now) }] : []),
  ];
  return (
    <article aria-labelledby="school-kind-title">
      <h3 id="school-kind-title" data-artifact-title className="font-display text-title font-semibold leading-snug text-[var(--text-primary)]">
        {info.label}
      </h3>
      <p className="mt-1 text-caption leading-5 text-[var(--text-secondary)]">{info.description}</p>
      {!pref?.available ? <p className="mt-3 text-caption text-[var(--text-secondary)]">{pref?.unavailableReason ?? info.unavailableReason}</p> : null}
      <dl className="mt-4 space-y-1.5">
        {facts.map((fact) => (
          <div key={fact.label} className="flex gap-3 text-caption">
            <dt className="w-16 shrink-0 text-[var(--text-tertiary)]">{fact.label}</dt>
            <dd className="min-w-0 flex-1 text-[var(--text-primary)]">{fact.value}</dd>
          </div>
        ))}
      </dl>
      {state?.problem ? (
        <div role="alert" className="mt-4">
          <p className="flex items-start gap-2 text-caption font-medium text-[var(--text-primary)]">
            <Icon name="problem" size={16} accent="var(--danger)" className="mt-0.5 shrink-0" />
            {state.problem.message}
          </p>
          <p className="ml-6 mt-0.5 text-caption text-[var(--text-secondary)]">{state.problem.fixHint}</p>
        </div>
      ) : null}
      {pref?.available && pref.mode !== "off" ? (
        <Button size="sm" className="mt-4" disabled={syncing || !preferences.connected} onClick={() => onSync(kind)}>
          <Icon name="syncing" size={16} animate={syncing} />
          {syncing ? "Syncing" : "Sync now"}
        </Button>
      ) : null}
    </article>
  );
}
