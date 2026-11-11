"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CircleHelp, Clock3, Code2, FileClock, LoaderCircle, Play, RotateCcw, Save, Settings2, ShieldCheck, UserCheck, AlertCircle, AlertTriangle, CalendarDays, CheckCircle2, ChevronRight, ExternalLink, FileText, Link2, LockKeyhole, Plus, RefreshCw, School, X, Fingerprint, ListChecks, TriangleAlert } from "@/components/icons/glyph-icons";
import { cn } from "@/lib/utils";
import { readConvexError } from "../../../../shared/convex-error.mjs";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LifeKey } from "@/components/ui/life-moments";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/icons";
import type { BarCommand } from "@/components/ui/adaptive-bar";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { IconButton } from "@/components/ui/icon-button";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { EmptyState as PageEmptyState, LoadingRows } from "@/components/ui/page-state";
import { PanelTabs, SidePanel, type PanelTab } from "@/components/ui/side-panel";
import { ClassShelfEditor } from "../components/class-shelf-editor";
import { fetchMyClassCandidates } from "../components/class-shelf-picker";
import {
  configureSpectraManageBac,
  disconnectSpectraManageBac,
  recheckSpectraManageBac,
  getSpectraManageBacOverview,
  getSpectraManageBacComparison,
  importSpectraManageBacReference,
  replaceSpectraManageBacManifest,
  resolveSpectraManageBacConflict,
  resolveSpectraManageBacIdentity,
  syncSpectraManageBac,
  upsertSpectraCalendarPeriodMap,
  removeSpectraCalendarPeriodMap,
  type SpectraManageBacCapability,
  type SpectraManageBacConflict,
  type SpectraManageBacIntegration,
  type SpectraManageBacOverview,
  type SpectraManageBacRecord,
  type SpectraManageBacSyncRun,
  type SpectraManageBacComparison,
} from "@/features/spectra/data/api";

type Tab =
  | "overview"
  | "classes"
  | "calendar"
  | "periods"
  | "tasks"
  | "history"
  | "conflicts"
  | "provenance";

const tabs = [
  { id: "overview", label: "Overview", icon: "school" },
  { id: "classes", label: "Classes", icon: "library" },
  { id: "calendar", label: "Calendar", icon: "calendar" },
  { id: "periods", label: "Period map", icon: "clock" },
  { id: "tasks", label: "Tasks", icon: "checklist" },
  { id: "history", label: "Sync history", icon: "versions" },
  { id: "conflicts", label: "Conflicts", icon: "problem" },
  { id: "provenance", label: "Provenance", icon: "identity" },
] satisfies Array<PanelTab & { id: Tab }>;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = "") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return fallback;
}

function timeValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && !Number.isNaN(Date.parse(value)))
    return Date.parse(value);
  return undefined;
}

function formatDate(value: number | undefined, withTime = true) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(value);
}

function relative(value: number | undefined) {
  if (!value) return "Not yet";
  const delta = value - Date.now();
  const absolute = Math.abs(delta);
  const suffix = delta >= 0 ? "from now" : "ago";
  if (absolute < 60_000) return delta >= 0 ? "in a moment" : "just now";
  if (absolute < 3_600_000)
    return `${Math.max(1, Math.round(absolute / 60_000))} min ${suffix}`;
  if (absolute < 86_400_000)
    return `${Math.round(absolute / 3_600_000)} hr ${suffix}`;
  return `${Math.round(absolute / 86_400_000)} d ${suffix}`;
}

function recordTitle(record: SpectraManageBacRecord) {
  const value = object(record.normalized);
  return text(
    value.title ?? value.name ?? value.courseName ?? value.subject,
    "Untitled source record",
  );
}

function recordSubtitle(record: SpectraManageBacRecord) {
  const value = object(record.normalized);
  return text(
    value.className ??
      value.courseName ??
      value.grade ??
      record.academicPeriodKey ??
      record.recordType,
    record.recordType,
  );
}

function recordStart(record: SpectraManageBacRecord) {
  const value = object(record.normalized);
  return timeValue(
    value.startAt ??
      value.start ??
      value.beginsAt ??
      value.dueAt ??
      value.deadlineAt,
  );
}

function StatusPill({
  state,
  children,
}: {
  state: "good" | "warning" | "danger" | "neutral" | "blue";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-chip px-2 text-micro font-medium",
        state === "good" && "bg-[color-mix(in_oklab,var(--accent-mint)_10%,var(--bg-primary))] text-[var(--accent-mint)]",
        state === "warning" && "bg-[color-mix(in_oklab,var(--accent-gold)_18%,var(--bg-elevated))] text-[var(--accent-gold)]",
        state === "danger" && "bg-[color-mix(in_oklab,var(--accent-coral)_10%,var(--bg-elevated))] text-[var(--accent-coral)]",
        state === "neutral" &&
          "bg-[var(--bg-secondary)] text-[var(--text-secondary)]",
        state === "blue" && "bg-[color-mix(in_oklab,var(--accent-cyan)_10%,var(--bg-elevated))] text-[var(--accent-cyan)]",
      )}
    >
      {children}
    </span>
  );
}

function EmptyState({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof School;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center">
      <span className="mb-3 text-[var(--text-tertiary)]">
        <Icon size={18} />
      </span>
      <strong className="font-display text-title font-semibold text-[var(--text-primary)]">
        {title}
      </strong>
      <p className="mt-1 max-w-sm text-caption leading-5 text-[var(--text-tertiary)]">
        {detail}
      </p>
    </div>
  );
}

function _SummaryMetric({
  label,
  value,
  detail,
  state,
}: {
  label: string;
  value: string;
  detail: string;
  state?: "good" | "warning";
}) {
  return (
    <div className="min-w-0 border-r border-[var(--border-subtle)] px-4 py-3.5 last:border-r-0">
      <span className="block text-micro text-[var(--text-tertiary)]">
        {label}
      </span>
      <strong className="mt-1 flex items-center gap-1.5 truncate text-caption font-semibold text-[var(--text-primary)]">
        {state ? (
          <span
            className={cn(
              "size-1.5 rounded-full",
              state === "good" ? "bg-[var(--accent-mint)]" : "bg-[var(--accent-gold)]",
            )}
          />
        ) : null}
        {value}
      </strong>
      <span className="mt-1 block truncate text-micro text-[var(--text-tertiary)]">
        {detail}
      </span>
    </div>
  );
}

export function integrationConnectionMessage(
  integration: Pick<SpectraManageBacIntegration, "status" | "lastSyncAt" | "blockedReason">,
) {
  let detail: string;
  switch (integration.status) {
    case "connected":
      detail = "Spectra reads your school's classes, tasks and calendar from ManageBac.";
      break;
    case "validating":
      detail = "Spectra is checking what it can read from ManageBac. Syncing starts once that is done.";
      break;
    case "draft":
      detail = "Add your school's ManageBac API key to start syncing.";
      break;
    case "blocked":
      detail = "ManageBac turned down the saved API key, so syncing is paused. Check the connection again, or save a new key if the old one was changed.";
      break;
    case "revoked":
      detail = "ManageBac is disconnected. Add the API key again to resume syncing.";
      break;
    default:
      detail = "Some data didn't sync last time. The sync history says what happened.";
  }
  return integration.lastSyncAt === undefined
    ? `${detail} No synchronization has completed yet.`
    : detail;
}

function integrationStatusLabel(status: string | undefined) {
  switch (status) {
    case "connected":
      return "Connected";
    case "validating":
      return "Checking";
    case "draft":
      return "Not connected yet";
    case "degraded":
      return "Partly syncing";
    case "blocked":
      return "Paused";
    case "revoked":
      return "Disconnected";
    default:
      return status ? status.replaceAll("_", " ") : "Not connected";
  }
}

function integrationStatusTone(
  status: string | undefined,
): "good" | "warning" | "danger" | "neutral" | "blue" {
  if (status === "connected") return "good";
  if (status === "validating") return "blue";
  if (status === "degraded") return "warning";
  if (status === "blocked" || status === "revoked") return "danger";
  return "neutral";
}

function SyncStatus({ run }: { run: SpectraManageBacSyncRun }) {
  const state =
    run.status === "completed"
      ? "good"
      : run.status === "failed" || run.status === "cancelled"
        ? "danger"
        : run.status === "partial" || run.status === "awaiting_review"
          ? "warning"
          : "blue";
  return (
    <StatusPill state={state}>{syncStatusLabel(run.status)}</StatusPill>
  );
}

function syncStatusLabel(status: SpectraManageBacSyncRun["status"]) {
  switch (status) {
    case "queued":
      return "Waiting to start";
    case "leased":
    case "running":
      return "In progress";
    case "awaiting_review":
      return "Needs review";
    case "completed":
      return "Complete";
    case "partial":
      return "Partially complete";
    case "failed":
      return "Needs attention";
    case "cancelled":
      return "Stopped";
  }
}

function syncKindLabel(kind: SpectraManageBacSyncRun["kind"]) {
  switch (kind) {
    case "identity":
      return "Identity check";
    case "bootstrap":
      return "Initial sync";
    case "reconciliation":
      return "Scheduled sync";
    case "scheduled":
      return "Scheduled sync";
    case "manual":
      return "Manual sync";
  }
}

function syncStageLabel(
  run: Pick<SpectraManageBacSyncRun, "status" | "stage">,
) {
  switch (run.stage) {
    case "queued":
      return "Waiting to start";
    case "resolving_identity":
      return "Checking your school account";
    case "no_match":
    case "ambiguous":
      return "School account needs review";
    case "ingesting":
      return "Reading school data";
    case "review_conflicts":
      return "Reviewing source changes";
    case "complete":
      return "School data is current";
    case "failed":
      return "Sync stopped";
    case "selection_changed":
      return "Class choices changed";
    case "lease_expired":
      return "Sync timed out";
    case "suspended":
      return "Paused part-way";
    case "resuming":
      return "Continuing where it stopped";
    case "reconciling":
      return "Checking for removed items";
    case "restarted":
      return "Replaced by a fresh sync";
    default:
      if (run.stage.startsWith("syncing:")) return "Reading school data";
      if (run.stage.startsWith("quarantined:")) return "Data needs review";
      if (run.status === "running") return "Working on school data";
      return run.status === "completed" ? "School data is current" : "Sync status";
  }
}

function syncRecoveryMessage(run: SpectraManageBacSyncRun, includeSyncFallback = true) {
  switch (run.errorCode) {
    case "INTEGRATION_NOT_READY":
      return "Ask a school administrator to review the ManageBac connection and its verified read-only routes before trying again.";
    case "INTEGRATION_IDENTITY_REQUIRED":
    case "INTEGRATION_IDENTITY_FAILED":
    case "INTEGRATION_IDENTITY_INVALID":
      return "Resolve your school identity to continue.";
    case "INTEGRATION_CREDENTIAL_REJECTED":
      return "ManageBac refused the school's API key. A school administrator can enter a new key under Connection.";
    case "INTEGRATION_RATE_LIMITED":
      return "ManageBac asked us to wait. Try again in a little while.";
    case "INTEGRATION_SYNC_BUSY":
      return "Another sync is already running. Wait for it to finish.";
    case "INTEGRATION_RESPONSE_TOO_LARGE":
      return "ManageBac returned more data than this sync can safely read.";
    case "INTEGRATION_ROUTE_FAILED":
    case "INTEGRATION_CAPABILITY_FAILED":
      return "ManageBac could not provide this data. Try again or ask a school administrator to review the connection.";
    case "INTEGRATION_SELECTION_CHANGED":
      return "Class choices changed; this sync was stopped.";
    case "INTEGRATION_SYNC_FENCED":
      return "A newer sync already replaced this one.";
    case "INTEGRATION_WORKER_LEASE_EXPIRED":
      return run.stage === "suspended"
        ? "This sync stopped part-way. The next sync continues from its last saved page."
        : "This sync timed out and was stopped. Retry if you still need school updates.";
    case "INTEGRATION_SYNC_TIME_BUDGET":
      return "This sync paused to stay within its time limit. School data it already read is saved, and the next sync continues from where it stopped.";
    case "INTEGRATION_SYNC_RESTARTED":
      return "The connection, routes or followed classes changed, so a fresh sync replaced this one.";
    case "INTEGRATION_SYNC_STATE_TOO_LARGE":
      return "This school follows more classes than one sync can track. Follow fewer classes, then sync again.";
    default:
      if (!includeSyncFallback) return undefined;
      return run.status === "partial"
        ? "Some school data was saved. Retry to fill the gaps."
        : run.status === "failed"
          ? "The sync did not finish. Retry when the connection is ready."
          : undefined;
  }
}

export function humanizeIntegrationError(value: unknown) {
  const { code, message } = readConvexError(value);
  return syncRecoveryMessage({
    status: "failed",
    stage: "failed",
    errorCode: code,
  } as SpectraManageBacSyncRun, false) ??
    (message || "ManageBac could not complete that action. Try again.");
}

function RecordIcon({ type }: { type: string }) {
  if (type === "class") return <BookOpen size={13} />;
  if (["timetable", "lesson", "calendar_event"].includes(type))
    return <CalendarDays size={13} />;
  if (type === "assessment") return <CircleHelp size={13} />;
  if (["assignment", "deadline"].includes(type))
    return <ListChecks size={13} />;
  return <FileText size={13} />;
}

function RecordsList({
  records,
  emptyTitle,
  emptyDetail,
}: {
  records: SpectraManageBacRecord[];
  emptyTitle: string;
  emptyDetail: string;
}) {
  if (!records.length)
    return (
      <EmptyState icon={FileText} title={emptyTitle} detail={emptyDetail} />
    );
  return (
    <div className="space-y-1 px-2 py-2">
      {records.map((record) => (
        <article
          key={record._id}
          className="group flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[var(--bg-secondary)]"
        >
          <span
            className={cn(
              "grid size-6 shrink-0 place-items-center",
              record.tombstone
                ? "text-[var(--accent-coral)]"
                : "text-[var(--text-tertiary)]",
            )}
          >
            <RecordIcon type={record.recordType} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <strong className="truncate text-caption font-medium text-[var(--text-primary)]">
                {recordTitle(record)}
              </strong>
              {record.tombstone ? (
                <StatusPill state="danger">Removed at source</StatusPill>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-micro text-[var(--text-tertiary)]">
              {recordSubtitle(record)} · refreshed {relative(record.fetchedAt)}
            </p>
          </div>
          {recordStart(record) ? (
            <time className="shrink-0 text-micro text-[var(--text-tertiary)]">
              {formatDate(recordStart(record), false)}
            </time>
          ) : null}
          {record.provenanceUrl ? (
            <a
              href={record.provenanceUrl}
              target="_blank"
              rel="noreferrer"
              className="grid size-7 shrink-0 place-items-center rounded-md text-[var(--text-tertiary)] opacity-0 transition hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)] group-hover:opacity-100 focus:opacity-100"
              aria-label={`Open source for ${recordTitle(record)}`}
            >
              <ExternalLink size={13} />
            </a>
          ) : null}
        </article>
      ))}
    </div>
  );
}

type PeriodMap = NonNullable<SpectraManageBacOverview["data"]["periodMaps"]>[number];

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function timeFromMinutes(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function PeriodMapPanel({
  periodMaps,
  busy,
  onSave,
  onRemove,
}: {
  periodMaps: PeriodMap[];
  busy: string;
  onSave: (period: {
    periodKey: string;
    label: string;
    startMinutes: number;
    endMinutes: number;
    timezone: string;
    weekdays: number[];
  }) => Promise<unknown>;
  onRemove: (periodMapId: string) => Promise<unknown>;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState({
    periodKey: "",
    label: "",
    start: "08:30",
    end: "09:20",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    weekdays: [1, 2, 3, 4, 5],
  });
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <div className="grid gap-x-10 gap-y-7 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0">
        <header className="mb-4">
          <div className="flex items-center gap-2"><Clock3 size={14} className="text-[var(--accent-mint)]" /><h2 className="text-body font-semibold">Verified school periods</h2></div>
          <p className="mt-1 max-w-2xl text-micro leading-5 text-[var(--text-tertiary)]">Calendar uses a period only when a source event has no exact time. Exact source times always win.</p>
        </header>
        {periodMaps.length ? (
          <div className="space-y-1">
            {periodMaps.slice().sort((a, b) => a.startMinutes - b.startMinutes).map((period) => (
              <article key={period._id} className="group flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-[var(--bg-secondary)]">
                <LifeKey id={`period:${period._id}`} />
                <span className="grid size-8 shrink-0 place-items-center text-micro font-bold text-[var(--accent-mint)]">{period.periodKey.slice(0, 3).toUpperCase()}</span>
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="truncate text-micro">{period.label}</strong><StatusPill state="good">Verified</StatusPill></div><p className="mt-1 text-micro text-[var(--text-tertiary)]">{timeFromMinutes(period.startMinutes)}–{timeFromMinutes(period.endMinutes)} · {period.timezone} · {period.weekdays.map((day) => weekdays[day]).join(", ")}</p></div>
                <button type="button" disabled={Boolean(busy)} onClick={() => void onRemove(period._id)} className="grid size-7 place-items-center rounded-md text-[var(--text-tertiary)] opacity-0 hover:bg-[color-mix(in_oklab,var(--accent-coral)_10%,var(--bg-elevated))] hover:text-[var(--accent-coral)] group-hover:opacity-100 focus:opacity-100 disabled:opacity-45" aria-label={`Remove ${period.label}`}><X size={13} /></button>
              </article>
            ))}
          </div>
        ) : <EmptyState icon={Clock3} title="No verified period map" detail="Events without exact timestamps remain partial until an administrator verifies their period schedule." />}
      </section>

      <section className="xl:pt-0.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-body font-semibold">Period editor</h2>
            <p className="mt-1 text-micro leading-5 text-[var(--text-tertiary)]">Use the provider’s exact period key.</p>
          </div>
          <button type="button" onClick={() => setEditorOpen((open) => !open)} className="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" aria-expanded={editorOpen} aria-label={editorOpen ? "Close period editor" : "Add period"} title={editorOpen ? "Close period editor" : "Add period"}>
            {editorOpen ? <X size={14} /> : <Plus size={14} />}
          </button>
        </div>
      {editorOpen ? <form
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave({
            periodKey: draft.periodKey,
            label: draft.label,
            startMinutes: minutesFromTime(draft.start),
            endMinutes: minutesFromTime(draft.end),
            timezone: draft.timezone,
            weekdays: draft.weekdays,
          }).then(() => setDraft((current) => ({ ...current, periodKey: "", label: "" })));
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="text-micro font-medium text-[var(--text-secondary)]">Period key<input required value={draft.periodKey} onChange={(event) => setDraft((current) => ({ ...current, periodKey: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-micro outline-none focus:border-[var(--accent-mint)]" placeholder="period-1" /></label>
          <label className="text-micro font-medium text-[var(--text-secondary)]">Label<input required value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-micro outline-none focus:border-[var(--accent-mint)]" placeholder="Period 1" /></label>
          <label className="text-micro font-medium text-[var(--text-secondary)]">Start<input required type="time" value={draft.start} onChange={(event) => setDraft((current) => ({ ...current, start: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-micro" /></label>
          <label className="text-micro font-medium text-[var(--text-secondary)]">End<input required type="time" value={draft.end} onChange={(event) => setDraft((current) => ({ ...current, end: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-micro" /></label>
        </div>
        <label className="mt-3 block text-micro font-medium text-[var(--text-secondary)]">IANA timezone<input required value={draft.timezone} onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))} className="mt-1 h-9 w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-micro" placeholder="Europe/Madrid" /></label>
        <fieldset className="mt-3"><legend className="text-micro font-medium text-[var(--text-secondary)]">Weekdays</legend><div className="mt-1.5 flex flex-wrap gap-1">{weekdays.map((label, value) => <button key={label} type="button" aria-pressed={draft.weekdays.includes(value)} onClick={() => setDraft((current) => ({ ...current, weekdays: current.weekdays.includes(value) ? current.weekdays.filter((day) => day !== value) : [...current.weekdays, value].sort() }))} className={cn("h-7 rounded-md border px-2 text-micro font-semibold", draft.weekdays.includes(value) ? "border-[var(--accent-mint)] bg-[color-mix(in_oklab,var(--accent-mint)_8%,var(--bg-primary))] text-[var(--accent-mint)]" : "border-[var(--border-default)] text-[var(--text-tertiary)]")}>{label}</button>)}</div></fieldset>
        <button type="submit" disabled={Boolean(busy)} className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[var(--accent-mint)] text-micro font-semibold text-white disabled:opacity-45"><Save size={13} />Verify period</button>
      </form> : null}
      </section>
    </div>
  );
}

export function ManageBacIntegrationShell() {
  const [overview, setOverview] = useState<SpectraManageBacOverview | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const busyRef = useRef(false);
  const [tab, setTab] = useState<Tab>("overview");
  // School links straight to what needs a decision (?tab=conflicts).
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("tab");
    if (asked === "conflicts" || asked === "history") setTab(asked);
  }, []);
  const [detailsTab, setDetailsTab] = useState<"details" | "activity">(
    "details",
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manifestOpen, setManifestOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [manifestText, setManifestText] = useState("");
  const [config, setConfig] = useState({
    baseUrl: "",
    token: "",
  });

  const [classCollection, setClassCollection] = useState<
    Awaited<ReturnType<typeof fetchMyClassCandidates>> | null
  >(null);
  const [classLoadError, setClassLoadError] = useState("");

  const refresh = useCallback(async ({ progressOnly = false }: { progressOnly?: boolean } = {}) => {
    try {
      const [overviewResult, classesResult] = await Promise.allSettled([
        getSpectraManageBacOverview(), progressOnly ? Promise.resolve(null) : fetchMyClassCandidates(),
      ]);
      if (overviewResult.status === "rejected") throw overviewResult.reason;
      const value = overviewResult.value;
      if (classesResult.status === "fulfilled" && classesResult.value !== null) {
        setClassCollection(classesResult.value);
        setClassLoadError("");
      } else if (classesResult.status === "rejected") {
        setClassCollection(null);
        setClassLoadError(
          readConvexError(classesResult.reason).message || "Could not load classes.",
        );
      }
      setOverview(value);
      setError("");
      if (value.data.integration) {
        const integration = value.data.integration;
        setConfig((current) => ({
          ...current,
          baseUrl: integration.baseUrl,
        }));
      } else if (
        typeof value.data.envBaseUrlHint === "string" &&
        value.data.envBaseUrlHint
      ) {
        setConfig((current) => ({
          ...current,
          baseUrl: current.baseUrl || value.data.envBaseUrlHint || "",
        }));
      }
    } catch (nextError) {
      setError(
        readConvexError(nextError).message || "ManageBac could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const data = overview?.data;
  const configuredIntegration = data?.integration ?? null;
  const integration =
    configuredIntegration?.status === "revoked" ? null : configuredIntegration;
  const records = useMemo(
    () => data?.records ?? data?.previews ?? [],
    [data?.previews, data?.records],
  );
  const classes = useMemo(
    () => classCollection?.classes ?? [],
    [classCollection],
  );
  const timetable = useMemo(
    () =>
      records
        .filter((record) =>
          ["timetable", "lesson", "calendar_event", "class_event"].includes(
            record.recordType,
          ),
        )
        .sort((a, b) => (recordStart(a) ?? 0) - (recordStart(b) ?? 0)),
    [records],
  );
  const tasks = useMemo(
    () =>
      records
        .filter((record) =>
          ["assignment", "deadline", "assessment"].includes(record.recordType),
        )
        .sort(
          (a, b) => (recordStart(a) ?? Infinity) - (recordStart(b) ?? Infinity),
        ),
    [records],
  );
  const syncInProgress = useMemo(
    () =>
      (data?.syncRuns ?? []).some((run) =>
        ["queued", "leased", "running"].includes(run.status),
      ),
    [data?.syncRuns],
  );
  // The request may finish before scheduled reconciliation or projection work.
  // Keep reading its progress until the backend reports a terminal state.
  useEffect(() => {
    if (!syncInProgress) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh({ progressOnly: true });
      if (!cancelled) timer = setTimeout(() => void poll(), 3_000);
    };
    timer = setTimeout(() => void poll(), 3_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refresh, syncInProgress]);

  const runAction = useCallback(
    async (key: string, action: () => Promise<unknown>) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(key);
      setError("");
      try {
        await action();
        await refresh();
      } catch (nextError) {
        setError(humanizeIntegrationError(nextError));
      } finally {
        busyRef.current = false;
        setBusy("");
      }
    },
    [refresh],
  );

  const saveConfiguration = () =>
    runAction("configure", async () => {
      await configureSpectraManageBac({
        baseUrl: config.baseUrl,
        token: config.token,
      });
      setSettingsOpen(false);
      setConfig((current) => ({ ...current, token: "" }));
    });

  const importManifest = () =>
    runAction("manifest", async () => {
      if (!integration) throw new Error("Connect ManageBac first.");
      const parsed = JSON.parse(manifestText) as unknown;
      const parsedObject = object(parsed);
      if (
        typeof parsedObject.openapi === "string" &&
        parsedObject.paths &&
        typeof parsedObject.paths === "object"
      ) {
        await importSpectraManageBacReference({
          integrationId: integration._id,
          document: parsedObject,
        });
        setManifestOpen(false);
        setManifestText("");
        return;
      }
      const capabilities = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsedObject.capabilities)
          ? parsedObject.capabilities
          : [];
      if (!capabilities.length)
        throw new Error(
          "Paste your school's ManageBac API reference, or a list of routes Spectra has checked.",
        );
      await replaceSpectraManageBacManifest({
        integrationId: integration._id,
        providerVersion: text(parsedObject.providerVersion) || undefined,
        capabilities,
      });
      setManifestOpen(false);
      setManifestText("");
    });

  const syncLabel = busy === "sync" || syncInProgress ? "Syncing…" : integration?.status === "validating" ? "Validating…" : "Sync now";
  const commands: BarCommand[] = [
    ...(integration
      ? [{
          id: "sync",
          icon: "syncing",
          label: syncLabel,
          disabled: Boolean(busy) || syncInProgress || integration.status === "validating" || integration.status === "draft",
          onSelect: () => void runAction("sync", () => syncSpectraManageBac()),
        } satisfies BarCommand]
      : []),
    { id: "refresh", icon: "retry", label: "Refresh connection data", labelPolicy: "never", onSelect: () => void refresh() },
    ...(overview?.admin
      ? [{ id: "settings", icon: "settings", label: "ManageBac settings", labelPolicy: "never", onSelect: () => setSettingsOpen(true) } satisfies BarCommand]
      : []),
  ];

  if (loading)
    return (
      <main className="min-h-0 flex-1 overflow-y-auto" data-spectra-app-surface="true">
        <PageBody>
          <PageHeader title="ManageBac" />
          <LoadingRows label="Loading ManageBac" count={6} />
        </PageBody>
      </main>
    );

  return (
    <div className="spectra-wave-y relative flex h-full min-h-0 overflow-hidden text-[var(--text-primary)]">
      <main className="min-w-0 flex-1 overflow-y-auto" data-spectra-app-surface="true">
        <PageBody>
          <PageHeader
            title={overview?.admin ? "ManageBac connection" : "Your ManageBac data"}
            commands={commands}
            plan={[{ hideLabel: "sync" }]}
            barLabel="ManageBac commands"
            description={
              overview?.admin
                ? "The school's connection to ManageBac and how it syncs. Students see their own tasks and classes in School."
                : "What Spectra reads from ManageBac for you. Your tasks and classes are in School."
            }
          />

          {error ? (
            <div role="alert" className="mt-3 flex items-start gap-2.5 rounded-control px-2.5 py-2 text-caption leading-5 text-[var(--text-primary)]">
              <Icon name="problem" size={16} accent="var(--danger)" className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1">{error}</span>
              <IconButton icon="close" label="Dismiss" size="compact" onClick={() => setError("")} />
            </div>
          ) : null}

          {integration && overview?.admin && data?.mapping?.status !== "verified" ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 px-0.5">
              <div className="min-w-0">
                <strong className="block text-ui font-semibold">Match your verified school account</strong>
                <p className="mt-1 max-w-xl text-caption leading-5 text-[var(--text-secondary)]">
                  Spectra matches the email already on your Spectra account to the school connection. You do not need to sign in again.
                </p>
              </div>
              <Button
                size="sm"
                variant="primary"
                disabled={Boolean(busy) || syncInProgress}
                onClick={() => void runAction("identity", () => resolveSpectraManageBacIdentity())}
              >
                {busy === "identity" ? <Icon name="syncing" size={14} className="animate-spin" /> : <Fingerprint size={14} />}
                Resolve my school identity
              </Button>
            </div>
          ) : null}

          {!integration ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 px-0.5">
              <div className="flex min-w-0 items-start gap-3">
                <Icon name="locked" size={18} accent="var(--accent-cyan)" className="mt-0.5" />
                <div className="min-w-0">
                  <strong className="text-ui font-semibold">
                    {overview?.admin ? "Connect your school’s ManageBac" : "Your school has not connected ManageBac"}
                  </strong>
                  <p className="mt-1 max-w-xl text-caption leading-5 text-[var(--text-secondary)]">
                    {overview?.admin
                      ? "Spectra only reads from ManageBac. It never writes to it, and the school token never leaves the server."
                      : "Once a school administrator connects ManageBac, your classes and tasks come into School."}
                  </p>
                </div>
              </div>
              {overview?.admin ? (
                <Button size="sm" variant="primary" onClick={() => setSettingsOpen(true)}>
                  <Link2 size={14} />
                  Connect ManageBac
                </Button>
              ) : null}
            </div>
          ) : null}

          <PanelTabs label="ManageBac sections" tabs={tabs} value={tab} onChange={(id) => setTab(id as Tab)} primaryCount={5} className="mt-5" />

          <div className="min-h-[470px] py-4">
            {!integration ? (
              <EmptyState
                icon={LockKeyhole}
                title="School data appears here once ManageBac is connected"
                detail="Spectra matches each student by the email on their Spectra account and never shows anyone else's data."
              />
            ) : !overview?.admin && data?.mapping?.status !== "verified" && tab !== "history" && tab !== "provenance" ? (
              <PageEmptyState
                icon="identity"
                title="Match your verified school account"
                detail="Spectra matches the email already on your Spectra account to the school’s ManageBac connection. You do not need to sign in again. Exactly one match is accepted, and Spectra never shows a student ID."
                action={
                  <Button
                    variant="primary"
                    disabled={Boolean(busy)}
                    onClick={() => void runAction("identity", () => resolveSpectraManageBacIdentity())}
                  >
                    {busy === "identity" || syncInProgress ? <Icon name="syncing" size={14} className="animate-spin" /> : <Fingerprint size={14} />}
                    Resolve my school identity
                  </Button>
                }
              />
            ) : tab === "overview" ? (
              <div className="grid gap-x-12 gap-y-10 py-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,.8fr)]">
                <section className="min-w-0">
                  <h2 className="text-caption font-medium text-[var(--text-tertiary)]">Connection</h2>
                  <div className="mt-3 flex items-start gap-3">
                    <Icon
                      name={integration.status === "connected" ? "saved" : integration.status === "validating" ? "syncing" : "problem"}
                      size={18}
                      accent={integration.status === "connected" ? "var(--success)" : integration.status === "validating" ? "var(--accent-cyan)" : "var(--warning)"}
                      className="mt-1 shrink-0"
                    />
                    <div className="min-w-0">
                      <h3 className="font-display text-title font-semibold tracking-[-0.02em]">
                        {integration.status === "connected"
                          ? "ManageBac is connected"
                          : integration.status === "validating"
                            ? "Checking ManageBac"
                            : integration.status === "draft"
                              ? "ManageBac is not connected yet"
                              : integration.status === "blocked"
                                ? "Syncing is paused"
                                : "The connection needs attention"}
                      </h3>
                      <p className="mt-2 max-w-xl text-caption leading-5 text-[var(--text-secondary)]">{integrationConnectionMessage(integration)}</p>
                      <p className="mt-3 text-caption text-[var(--text-tertiary)]">
                        {data?.school?.name ?? "Your school"} · last synced {integration.lastSyncAt ? relative(integration.lastSyncAt) : "never"}
                        {data?.conflicts.length ? ` · ${data.conflicts.length} to review` : ""}
                      </p>
                      <div className="-ml-2 mt-4 flex flex-wrap gap-1">
                        {integration.status === "blocked" ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy === "recheck"}
                            onClick={() =>
                              void runAction("recheck", async () => {
                                const { outcome } = await recheckSpectraManageBac();
                                if (outcome === "reopened") toast.success("ManageBac took the saved key. Syncing again.");
                                else if (outcome === "key_refused") toast.error("ManageBac still turns down the saved key. Save a new one under Settings.");
                                else if (outcome === "key_missing") toast.error("No key is saved. Add your school's ManageBac API key.");
                                else if (outcome === "unreachable") toast.error("ManageBac didn't answer. Try again in a few minutes.");
                              })
                            }
                          >
                            {busy === "recheck" ? "Checking…" : "Check the connection again"}
                          </Button>
                        ) : null}
                        <Button variant="ghost" size="sm" onClick={() => setTab("history")}>Sync history</Button>
                        <Button variant="ghost" size="sm" onClick={() => setTab("conflicts")}>Review conflicts</Button>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="min-w-0">
                  <h2 className="text-caption font-medium text-[var(--text-tertiary)]">Synced data</h2>
                  <div className="-mx-2.5 mt-2">
                    {([
                      ["Classes", classCollection ? classes.length : "—", "classes", "school"],
                      ["Calendar", timetable.length, "calendar", "calendar"],
                      ["Tasks", tasks.length, "tasks", "task"],
                    ] as const).map(([label, count, target, glyph]) => (
                      <button
                        key={target}
                        type="button"
                        data-life-launch
                        onClick={() => setTab(target)}
                        className="group flex h-11 w-full items-center gap-3 rounded-control px-2.5 text-ui text-[var(--text-secondary)] outline-none transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
                      >
                        <Icon name={glyph} size={16} />
                        <span className="flex-1 text-left">{label}</span>
                        <strong className="font-medium tabular-nums text-[var(--text-primary)]">{count}</strong>
                        <Icon name="chevronRight" size={14} />
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            ) : tab === "classes" ? (
              <ClassShelfEditor
                integration={classCollection?.integration}
                identityRequired={classCollection?.identityRequired}
                identityStatus={classCollection?.identityStatus}
                classes={classes}
                selectionRevision={classCollection?.selectionRevision}
                classLoadError={classLoadError}
                onSaved={() => runAction("sync", () => syncSpectraManageBac())}
              />
            ) : tab === "calendar" ? (
              <RecordsList
                records={timetable}
                emptyTitle="No lessons or school events yet"
                emptyDetail="Lessons and school events from ManageBac show up in Calendar as their own layer. They never become tasks."
              />
            ) : tab === "periods" ? (
              <PeriodMapPanel
                periodMaps={data?.periodMaps ?? []}
                busy={busy}
                onSave={(period) => runAction(`period:${period.periodKey}`, () => upsertSpectraCalendarPeriodMap(period))}
                onRemove={(periodMapId) => runAction(`period-remove:${periodMapId}`, () => removeSpectraCalendarPeriodMap(periodMapId))}
              />
            ) : tab === "tasks" ? (
              <RecordsList
                records={tasks}
                emptyTitle="No assignments or deadlines"
                emptyDetail="Assignments, assessments and deadlines from ManageBac show up here and in School. Your own notes stay yours."
              />
            ) : tab === "history" ? (
              <SyncTable
                runs={data?.syncRuns ?? []}
                syncBusy={Boolean(busy) || syncInProgress}
                onRetry={() => void runAction("sync", () => syncSpectraManageBac())}
                onResolveIdentity={() => void runAction("identity", () => resolveSpectraManageBacIdentity())}
              />
            ) : tab === "conflicts" ? (
              data?.conflicts.length ? (
                <ConflictList
                  conflicts={data.conflicts}
                  busy={busy}
                  onResolve={(conflict, resolution) =>
                    runAction(`conflict:${conflict._id}`, () => resolveSpectraManageBacConflict({ conflictId: conflict._id, resolution }))
                  }
                />
              ) : (
                <EmptyState
                  icon={CheckCircle2}
                  title="Nothing to review"
                  detail="Safe updates from ManageBac apply on their own. Changes that would touch your own edits wait here first."
                />
              )
            ) : (
              <ProvenancePanel
                records={records}
                capabilities={data?.capabilities ?? []}
                quarantine={data?.quarantine ?? []}
                identityQueue={data?.identityQueue ?? []}
                onOpenManifest={() => setManifestOpen(true)}
                onRetrySync={() => void runAction("sync", () => syncSpectraManageBac())}
                syncBusy={busy === "sync" || syncInProgress}
                admin={Boolean(overview?.admin)}
              />
            )}
          </div>
        </PageBody>
      </main>

      <SidePanel
        id="managebac.details"
        title="Details"
        icon="info"
        stageMin={640}
        header={
          <PanelTabs
            label="Details sections"
            tabs={[
              { id: "details", label: "Details", icon: "info" },
              { id: "activity", label: "Activity", icon: "activity" },
            ]}
            value={detailsTab}
            onChange={(id) => setDetailsTab(id as "details" | "activity")}
          />
        }
      >
        {detailsTab === "details" ? (
          <div className="space-y-7 pb-5">
            <RightCard title="Integration">
              <div className="flex items-center gap-2.5">
                <Icon name="network" size={16} accent="var(--accent-cyan)" />
                <div className="min-w-0 flex-1">
                  <strong className="block text-caption font-medium">ManageBac</strong>
                  <span className="block truncate text-micro text-[var(--text-tertiary)]">
                    {integration?.providerVersion ? `Reference ${integration.providerVersion}` : "Read only"}
                  </span>
                </div>
                <StatusPill state={integrationStatusTone(integration?.status)}>{integrationStatusLabel(integration?.status)}</StatusPill>
              </div>
            </RightCard>
            <RightCard title="School">
              <div className="flex items-center gap-2.5">
                <Icon name="school" size={16} />
                <div className="min-w-0">
                  <strong className="block truncate text-caption font-medium">{data?.school?.name ?? "Your school"}</strong>
                  <span className="text-micro text-[var(--text-tertiary)]">Spectra reads; it never writes back</span>
                </div>
              </div>
            </RightCard>
            <RightCard title="Sync settings">
              <DetailRow icon={Clock3} label="How often" value={integration ? `Every ${integration.syncPolicy.frequencyMinutes} minutes` : "Not set up"} />
              <DetailRow icon={School} label="New classes" value={integration ? "Come in on their own" : "After connecting"} good={Boolean(integration)} />
              <DetailRow icon={ListChecks} label="Tasks" value={integration ? "Come in on their own" : "After connecting"} good={Boolean(integration)} />
              <DetailRow
                icon={AlertCircle}
                label="Conflicts"
                value={integration ? (integration.syncPolicy.conflictMode === "ask_me" ? "Ask me" : "Review") : "After connecting"}
              />
              {overview?.admin ? (
                <Button variant="ghost" size="sm" className="-ml-2 mt-2" onClick={() => setSettingsOpen(true)}>
                  <Settings2 size={14} />
                  Edit settings
                </Button>
              ) : null}
            </RightCard>
            <RightCard title="Where data comes from">
              <p className="text-caption leading-5 text-[var(--text-secondary)]">
                Everything Spectra brings in remembers where it came from and when. Your own changes stay separate.
              </p>
              <Button variant="ghost" size="sm" className="-ml-2 mt-1" onClick={() => setTab("provenance")}>
                Review provenance
              </Button>
            </RightCard>
            <RightCard title="Quick actions">
              <QuickAction icon={AlertCircle} label="Review conflicts" onClick={() => setTab("conflicts")} />
              <QuickAction icon={ShieldCheck} label="Review capabilities" onClick={() => setTab("provenance")} />
              {integration?.referenceUrl ? (
                <a
                  href={integration.referenceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-9 items-center gap-2 rounded-control px-1.5 text-caption text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  <ExternalLink size={14} />
                  Open the API reference
                </a>
              ) : null}
              {overview?.admin && integration ? (
                <QuickAction icon={Link2} label="Disconnect ManageBac" onClick={() => setDisconnectOpen(true)} />
              ) : null}
            </RightCard>
          </div>
        ) : (
          <div className="pb-5">
            <RightCard title="Recent sync activity">
              {(data?.syncRuns ?? []).slice(0, 8).map((run) => (
                <div key={run._id} className="flex gap-2.5 rounded-control px-1 py-2.5">
                  <LifeKey id={`sync:${run._id}`} />
                  <Icon name="activity" size={14} className="mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <strong className="block text-caption font-medium">
                      {syncKindLabel(run.kind)} · {syncStatusLabel(run.status)}
                    </strong>
                    <span className="block text-micro text-[var(--text-tertiary)]">
                      {run.counts.created ?? 0} added · {run.counts.updated ?? 0} updated · {syncStageLabel(run)} · {relative(run.completedAt ?? run.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
              {!data?.syncRuns.length ? <p className="py-4 text-caption text-[var(--text-tertiary)]">Nothing has synced yet.</p> : null}
            </RightCard>
          </div>
        )}
      </SidePanel>

      {settingsOpen ? (
        <SettingsDialog
          config={config}
          setConfig={setConfig}
          busy={busy === "configure"}
          connected={Boolean(integration)}
          envTokenAvailable={Boolean(data?.envTokenAvailable)}
          onClose={() => {
            setSettingsOpen(false);
            setError("");
          }}
          onSave={saveConfiguration}
          error={error}
          onManifest={() => {
            setSettingsOpen(false);
            setManifestOpen(true);
          }}
        />
      ) : null}
      {manifestOpen ? (
        <ManifestDialog
          value={manifestText}
          setValue={setManifestText}
          busy={busy === "manifest"}
          onClose={() => setManifestOpen(false)}
          onImport={importManifest}
        />
      ) : null}
      {disconnectOpen ? (
        <DisconnectDialog
          busy={busy === "disconnect"}
          onClose={() => setDisconnectOpen(false)}
          onConfirm={() =>
            void runAction("disconnect", async () => {
              await disconnectSpectraManageBac();
              setDisconnectOpen(false);
            })
          }
        />
      ) : null}
    </div>
  );
}

function SyncTable({
  runs,
  syncBusy,
  onRetry,
  onResolveIdentity,
}: {
  runs: SpectraManageBacSyncRun[];
  syncBusy: boolean;
  onRetry: () => void;
  onResolveIdentity: () => void;
}) {
  if (!runs.length)
    return (
      <EmptyState
        icon={FileClock}
        title="No synchronization history"
        detail="Bootstrap and later sync runs will show capability-level progress, counts, conflicts, and retryable failures here."
      />
    );
  return (
    <div className="overflow-x-auto px-1">
      <table className="w-full min-w-[620px] border-separate border-spacing-y-1 text-left">
        <thead>
          <tr className="text-micro font-normal text-[var(--text-tertiary)]">
            <th className="px-4 py-2 font-normal">Date & time</th>
            <th className="px-3 py-2 font-normal">Status</th>
            <th className="px-3 py-2 font-normal">Imported</th>
            <th className="px-3 py-2 font-normal">Updated</th>
            <th className="px-3 py-2 font-normal">Conflicts</th>
            <th className="px-3 py-2 font-normal">Triggered by</th>
            <th className="px-3 py-2 font-normal">Recovery</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr
              key={run._id}
              className="group"
            >
              <td className="rounded-l-lg px-4 py-2.5 text-micro transition-colors group-hover:bg-[var(--bg-secondary)]">
                {formatDate(run.completedAt ?? run.createdAt)}
              </td>
              <td className="px-3 py-2.5 transition-colors group-hover:bg-[var(--bg-secondary)]">
                <div className="flex min-w-32 flex-col items-start gap-1">
                  <SyncStatus run={run} />
                  <span className="text-micro text-[var(--text-tertiary)]">
                    {syncStageLabel(run)}
                  </span>
                  {syncRecoveryMessage(run) ? (
                    <span className="max-w-56 text-micro leading-4 text-[var(--danger)]">
                      {syncRecoveryMessage(run)}
                    </span>
                  ) : null}
                </div>
              </td>
              <td className="px-3 py-2.5 text-micro transition-colors group-hover:bg-[var(--bg-secondary)]">{run.counts.created}</td>
              <td className="px-3 py-2.5 text-micro transition-colors group-hover:bg-[var(--bg-secondary)]">{run.counts.updated}</td>
              <td className="px-3 py-2.5 text-micro transition-colors group-hover:bg-[var(--bg-secondary)]">
                {run.counts.conflicts}
              </td>
              <td className="rounded-r-lg px-3 py-2.5 text-micro capitalize text-[var(--text-secondary)] transition-colors group-hover:bg-[var(--bg-secondary)]">
                {run.kind}
              </td>
              <td className="rounded-r-lg px-3 py-2.5 text-micro transition-colors group-hover:bg-[var(--bg-secondary)]">
                {run.kind === "identity" &&
                run.status === "awaiting_review" ? (
                  <button
                    type="button"
                    disabled={syncBusy}
                    onClick={onResolveIdentity}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 text-micro font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <Fingerprint size={11} />
                    Resolve identity
                  </button>
                ) : run.status === "failed" || run.status === "partial" ? (
                  <button
                    type="button"
                    disabled={syncBusy}
                    onClick={onRetry}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 text-micro font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <RefreshCw size={11} />
                    Retry sync
                  </button>
                ) : run.status === "awaiting_review" ? (
                  <span className="text-[var(--text-tertiary)]">Review conflicts</span>
                ) : (
                  <span className="text-[var(--text-tertiary)]">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What each kind of conflict is, said to the person deciding it. */
const CONFLICT_KIND: Record<string, string> = {
  customization_overlap: "Changed in ManageBac and in Spectra",
  source_changed: "Changed in ManageBac",
  changed_due_date: "Due date moved in ManageBac",
  source_removed: "Removed from ManageBac",
  duplicate_projection: "Shows up twice",
  ambiguous_relation: "Not sure where this belongs",
};

/** What each choice does, so it is made knowing its consequence. */
const RESOLUTION: Record<
  "rebase" | "keep_overlay" | "detach" | "archive_projection",
  { label: string; detail: string }
> = {
  rebase: {
    label: "Use ManageBac's",
    detail: "Takes ManageBac's version of what changed. Your notes and artifacts in Spectra stay.",
  },
  keep_overlay: {
    label: "Keep mine",
    detail: "Keeps your version of these fields. Later ManageBac changes to anything else still arrive.",
  },
  detach: {
    label: "Stop syncing it",
    detail: "Keeps it in Spectra as it is now, and ManageBac stops updating it.",
  },
  archive_projection: {
    label: "Archive in Spectra",
    detail: "Moves it out of the way in Spectra. Nothing is deleted.",
  },
};

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  name: "Name",
  dueAt: "Due date",
  due_date: "Due date",
  deadline: "Due date",
  startAt: "Start",
  endAt: "End",
  description: "Description",
  summary: "Summary",
  body: "Description",
  points: "Points",
  maxPoints: "Points",
  type: "Type",
  status: "Status",
  className: "Class",
};

function fieldValue(value: unknown, truncate = true) {
  if (value === undefined || value === null || value === "") return "nothing";
  if (typeof value === "number" && value > 1e12) return formatDate(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const at = Date.parse(value);
    if (Number.isFinite(at)) return formatDate(at);
  }
  if (typeof value === "string") {
    // ManageBac sends rich text as HTML; the reader compares the words.
    const words = value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    if (!words) return "nothing";
    return truncate && words.length > 80 ? `${words.slice(0, 79)}…` : words;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "a changed value";
}

/** The fields ManageBac changed, as before → after, leaving out bookkeeping. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => key in FIELD_LABELS || !/(^_|id$|Id$|hash|Hash|At$|cursor|etag|version|raw)/.test(key))
    .filter((key) => [before[key], after[key]].every((value) => value === null || typeof value !== "object"))
    // Only what reads differently: the same words rewrapped in HTML are no change.
    .filter((key) => fieldValue(before[key], false) !== fieldValue(after[key], false))
    .slice(0, 6)
    .map((key) => ({
      key,
      label:
        FIELD_LABELS[key] ??
        key
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .replace(/_/g, " ")
          .replace(/^./, (first) => first.toUpperCase()),
      before: fieldValue(before[key]),
      after: fieldValue(after[key]),
    }));
}

/** Full values are requested only when this one comparison is expanded. */
function ConflictComparison({ conflict }: { conflict: SpectraManageBacConflict }) {
  const [open, setOpen] = useState(false);
  const [comparison, setComparison] = useState<SpectraManageBacComparison | null>(null);
  const [failure, setFailure] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setFailure("");
    void getSpectraManageBacComparison(conflict._id)
      .then(result => { if (active) setComparison(result); })
      .catch(() => { if (active) setFailure("Couldn’t read the saved Spectra copy. Try again."); });
    return () => { active = false; };
  }, [open, conflict._id, attempt]);
  const before = object(conflict.oldSource);
  const after = object(conflict.newSource);
  const local = comparison?.fields ?? {};
  const keys = [...new Set([...Object.keys(FIELD_LABELS).filter(key => key in before || key in after || key in local)])];
  return (
    <details className="mt-2 text-micro" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer text-[var(--text-secondary)]">Compare full versions</summary>
      {open ? (
        <div className="mt-3 space-y-3">
          {failure ? <p role="alert">{failure} <button type="button" className="underline" onClick={() => setAttempt(value => value + 1)}>Try again</button></p> : null}
          {!comparison && !failure ? <p role="status">Reading the saved Spectra copy…</p> : null}
          {comparison?.state === "private" ? <p>The local copy belongs to another person and is private. Only the source versions are shown.</p> : null}
          {comparison?.state === "missing" ? <p>No saved Spectra copy is available to compare.</p> : null}
          {comparison?.state === "unmaterialized" ? <p>This source has not been imported as editable artifact in Spectra.</p> : null}
          {comparison?.savedAt ? <p className="text-[var(--text-tertiary)]">Spectra copy saved {formatDate(comparison.savedAt)}. Unsaved editor changes are not included.</p> : null}
          {keys.map(key => (
            <section key={key} aria-label={`${FIELD_LABELS[key]} comparison`}>
              <strong>{FIELD_LABELS[key]}</strong>
              <dl className="mt-1 space-y-2">
                {[["ManageBac before", before[key]], ["ManageBac now", after[key]], ...(comparison?.state === "available" ? [["Saved in Spectra", local[key]]] : [])].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="text-[var(--text-tertiary)]">{String(label)}</dt>
                    <dd className="whitespace-pre-wrap break-words leading-5">{fieldValue(value, false)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      ) : null}
    </details>
  );
}

export function ConflictList({
  conflicts,
  busy,
  onResolve,
}: {
  conflicts: SpectraManageBacConflict[];
  busy: string;
  onResolve: (
    conflict: SpectraManageBacConflict,
    resolution: "rebase" | "keep_overlay" | "detach" | "archive_projection",
  ) => void;
}) {
  const offered = (["rebase", "keep_overlay", "detach", "archive_projection"] as const).filter((action) =>
    conflicts.some((conflict) => conflict.suggestedActions.includes(action)),
  );
  return (
    <div className="space-y-2 px-1">
      {offered.length ? (
        <ul className="space-y-0.5 px-3 pb-2 text-micro leading-4 text-[var(--text-tertiary)]">
          {offered.map((action) => (
            <li key={action}>
              <span className="text-[var(--text-secondary)]">{RESOLUTION[action].label}:</span> {RESOLUTION[action].detail}
            </li>
          ))}
        </ul>
      ) : null}
      {conflicts.map((conflict) => {
        const oldSource = object(conflict.oldSource);
        const nextSource = object(conflict.newSource);
        const overlay = object(conflict.overlay);
        const name = text(nextSource.title ?? nextSource.name ?? oldSource.title ?? oldSource.name, "This item");
        const fields = conflict.kind === "source_removed" ? [] : changedFields(oldSource, nextSource);
        const yours = Object.keys(overlay).filter((key) => FIELD_LABELS[key]);
        // Every choice the conflict offers, ManageBac's first.
        const actions = (["rebase", "keep_overlay", "detach", "archive_projection"] as const).filter((action) =>
          conflict.suggestedActions.includes(action),
        );
        return (
          <article key={conflict._id} className="rounded-xl px-3 py-3 transition-colors hover:bg-[var(--bg-secondary)]">
            <LifeKey id={`conflict:${conflict._id}`} />
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--accent-gold)_18%,var(--bg-elevated))] text-[var(--accent-gold)]">
                <AlertCircle size={12} />
              </span>
              <div className="min-w-0 flex-1">
                <strong className="block text-micro font-medium">{name}</strong>
                <span className="mt-0.5 block text-micro text-[var(--text-tertiary)]">
                  {CONFLICT_KIND[conflict.kind] ?? conflict.kind.replaceAll("_", " ")}, {conflict.projectionType.replaceAll("_", " ")},{" "}
                  {formatDate(conflict.createdAt)}
                </span>
                {fields.length ? (
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-micro leading-4">
                    {fields.map((field) => (
                      <div key={field.key} className="contents">
                        <dt className="text-[var(--text-tertiary)]">{field.label}</dt>
                        <dd className="min-w-0 text-[var(--text-secondary)]">
                          <span className="line-through decoration-[var(--text-tertiary)]">{field.before}</span>
                          {" → "}
                          <span className="text-[var(--text-primary)]">{field.after}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="mt-1 text-micro leading-4 text-[var(--text-secondary)]">
                    {conflict.kind === "source_removed"
                      ? "ManageBac no longer has this. Spectra kept your copy until you decide."
                      : text(overlay.reason, "ManageBac changed this while your version in Spectra was based on an older one.")}
                  </p>
                )}
                {yours.length ? (
                  <p className="mt-1.5 text-micro leading-4 text-[var(--text-secondary)]">
                    You changed in Spectra: {yours.map((key) => FIELD_LABELS[key]!.toLowerCase()).join(", ")}.
                  </p>
                ) : null}
                <ConflictComparison conflict={conflict} />
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {actions.map((action, index) => (
                    <button
                      key={action}
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => onResolve(conflict, action)}
                      className={
                        index === 0
                          ? "h-7 rounded-md bg-[var(--text-primary)] px-2.5 text-micro text-[var(--bg-primary)] disabled:opacity-50"
                          : "h-7 rounded-md border border-[var(--border-subtle)] px-2 text-micro hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                      }
                    >
                      {RESOLUTION[action].label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ProvenancePanel({
  records,
  capabilities,
  quarantine,
  identityQueue,
  onOpenManifest,
  onRetrySync,
  syncBusy,
  admin,
}: {
  records: SpectraManageBacRecord[];
  capabilities: SpectraManageBacCapability[];
  quarantine: NonNullable<SpectraManageBacOverview["data"]["quarantine"]>;
  identityQueue: NonNullable<SpectraManageBacOverview["data"]["identityQueue"]>;
  onOpenManifest: () => void;
  onRetrySync: () => void;
  syncBusy: boolean;
  admin: boolean;
}) {
  const grouped = useMemo(() => {
    const result = new Map<string, SpectraManageBacCapability[]>();
    for (const capability of capabilities) {
      const rows = result.get(capability.category) ?? [];
      rows.push(capability);
      result.set(capability.category, rows);
    }
    return [...result.entries()];
  }, [capabilities]);
  return (
    <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[1.4fr_.8fr]">
      <section className="min-w-0">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-caption font-semibold">
              Verified capability manifest
            </h2>
            <p className="mt-0.5 text-micro text-[var(--text-tertiary)]">
              Only GET routes copied from the tenant API Manager become usable.
            </p>
          </div>
          {admin ? (
            <button
              type="button"
              onClick={onOpenManifest}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-micro text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            >
              <Code2 size={11} />
              Import manifest
            </button>
          ) : null}
        </div>
        {grouped.length ? (
          grouped.map(([category, rows]) => (
            <div
              key={category}
              className="mt-6"
            >
              <div className="mb-2 flex items-center justify-between">
                <strong className="text-micro text-[var(--text-tertiary)]">
                  {category}
                </strong>
                <span className="text-micro text-[var(--text-tertiary)]">
                  {
                    rows.filter(
                      (item) => item.verificationStatus === "verified",
                    ).length
                  }
                  /{rows.length} verified
                </span>
              </div>
              <div className="space-y-1">
                {rows.map((capability) => (
                  <div
                    key={capability._id}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-[var(--bg-secondary)] target:bg-amber-500/10 target:ring-1 target:ring-amber-600/20"
                    id={`capability-${capability._id}`}
                  >
                    <div className="min-w-0">
                      <strong className="block truncate text-micro font-medium">
                        {capability.name}
                      </strong>
                      <span className="block truncate text-micro text-[var(--text-tertiary)]">
                        {capability.purpose}
                      </span>
                    </div>
                    <StatusPill state="neutral">
                      {capability.permissionState.replaceAll("_", " ")}
                    </StatusPill>
                    <StatusPill
                      state={
                        capability.verificationStatus === "verified"
                          ? "good"
                          : capability.verificationStatus === "quarantined"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {capability.verificationStatus}
                    </StatusPill>
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          <EmptyState
            icon={ShieldCheck}
            title="No tenant routes imported"
            detail="A school administrator must copy the read-only route contracts from the tenant-specific API reference."
          />
        )}
      </section>
      <div className="space-y-10">
        <section>
          <h2 className="text-caption font-semibold">Source guarantees</h2>
          <div className="mt-3 space-y-3">
            {[
              [
                LockKeyhole,
                "Token stays server-side",
                "Never enters browser, AI context, logs, or client-visible records.",
              ],
              [
                ShieldCheck,
                "Read-only by construction",
                "Every usable capability is GET + read-only + verified schema.",
              ],
              [
                UserCheck,
                "Identity is exact",
                "Only the email on your Spectra account may match a school identity. This is not a separate login.",
              ],
              [
                RotateCcw,
                "Customization survives",
                "Source snapshots and personal overlays are stored independently.",
              ],
            ].map(([Icon, title, detail]) => {
              const ItemIcon = Icon as typeof ShieldCheck;
              return (
                <div key={String(title)} className="flex gap-2.5">
                  <ItemIcon
                    size={14}
                    className="mt-0.5 shrink-0 text-[var(--accent-mint)]"
                  />
                  <div>
                    <strong className="block text-micro font-medium">
                      {String(title)}
                    </strong>
                    <p className="mt-0.5 text-micro leading-4 text-[var(--text-tertiary)]">
                      {String(detail)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-caption font-semibold">Quarantine</h2>
            <StatusPill state={quarantine.length ? "warning" : "good"}>
              {quarantine.length} open
            </StatusPill>
          </div>
          <p className="mt-2 text-micro leading-4 text-[var(--text-tertiary)]">
            Schema drift is isolated as a sanitized shape—never coerced into
            live records.
          </p>
          {quarantine.length ? <div className="mt-3 flex items-center gap-1">
            {admin ? <button type="button" onClick={onOpenManifest} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-micro font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"><Code2 size={12} />Update manifest</button> : null}
            <button type="button" onClick={onRetrySync} disabled={syncBusy} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-micro font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"><RefreshCw size={12} className={syncBusy ? "animate-spin" : ""} />Retry sync</button>
          </div> : null}
          {quarantine.slice(0, 5).map((item) => (
            <a
              key={item._id}
              href={`#capability-${item.capabilityId}`}
              className="group mt-1 flex items-center gap-2 rounded-lg px-2 py-2 text-micro text-[var(--accent-gold)] transition-colors hover:bg-amber-500/8"
              title="Inspect the quarantined capability"
            >
              <AlertTriangle size={12} className="shrink-0" />
              <span className="min-w-0 flex-1"><strong className="block truncate font-medium">{item.reasonCode}</strong><span className="block text-micro text-[var(--text-tertiary)]">
                Contract {item.contractVersion} · {formatDate(item.createdAt)}
              </span></span>
              <ChevronRight size={12} className="shrink-0 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
            </a>
          ))}
        </section>
        {admin ? (
          <section>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-caption font-semibold">Identity resolution</h2>
              <StatusPill state={identityQueue.length ? "warning" : "good"}>
                {identityQueue.length} needs attention
              </StatusPill>
            </div>
            <p className="mt-2 text-micro leading-4 text-[var(--text-tertiary)]">
              Admins see only the verified Spectra account and exact-match
              count—never alternate ManageBac identities or provider IDs.
            </p>
            {identityQueue.slice(0, 8).map((item) => (
              <div
                key={item.mappingId}
                className="mt-1 flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-[var(--bg-secondary)]"
              >
                <UserCheck
                  size={13}
                  className="shrink-0 text-[var(--text-tertiary)]"
                />
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-micro font-medium">
                    {item.account?.name ?? "Unavailable account"}
                  </strong>
                  <span className="block truncate text-micro text-[var(--text-tertiary)]">
                    {item.account?.email ?? "No verified email available"}
                  </span>
                </div>
                <StatusPill state="warning">
                  {item.status === "ambiguous"
                    ? `${item.matchCount} exact matches`
                    : "No exact match"}
                </StatusPill>
              </div>
            ))}
          </section>
        ) : null}
        <p className="text-micro leading-5 text-[var(--text-tertiary)]">{records.length} accessible normalized records. Raw provider payloads stay server-side.</p>
      </div>
    </div>
  );
}

function RightCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2.5 text-micro font-semibold text-[var(--text-tertiary)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  good,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
  good?: boolean;
}) {
  return (
    <div className="flex min-h-8 items-center gap-2 rounded-lg px-1 transition-colors hover:bg-[var(--bg-hover)]">
      <Icon size={12} className="text-[var(--text-tertiary)]" />
      <span className="min-w-0 flex-1 truncate text-micro text-[var(--text-secondary)]">
        {label}
      </span>
      <span
        className={cn(
          "max-w-[9.5rem] shrink-0 truncate text-right text-micro font-medium tabular-nums text-[var(--text-tertiary)]",
          good && "text-[var(--accent-mint)]",
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof RefreshCw;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-9 w-full items-center gap-2 rounded-lg px-1.5 text-left text-micro text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-45"
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

export function SettingsDialog({
  config,
  setConfig,
  busy,
  connected,
  envTokenAvailable,
  onClose,
  onSave,
  onManifest,
  error,
}: {
  config: {
    baseUrl: string;
    token: string;
  };
  setConfig: React.Dispatch<React.SetStateAction<typeof config>>;
  busy: boolean;
  connected: boolean;
  envTokenAvailable: boolean;
  onClose: () => void;
  onSave: () => void;
  onManifest: () => void;
  /** Why the last save did not go through, shown beside the key it is about. */
  error?: string;
}) {
  const input =
    "h-9 w-full rounded-control border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-micro outline-none focus:border-[#7aa999] focus:ring-2 focus:ring-[#dceee7]";
  const canConnectWithoutTypedToken =
    !connected && envTokenAvailable && config.token.length === 0;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent
        hideCloseButton
        className="block max-h-[92vh] max-w-[520px] gap-0 overflow-y-auto bg-[var(--bg-primary)] p-0"
      >
        <header className="sticky top-0 z-chrome flex items-start justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/95 px-5 py-4 backdrop-blur">
          <div>
            <DialogTitle className="font-display text-xl font-semibold">
              ManageBac connection
            </DialogTitle>
            <DialogDescription className="mt-1 text-micro text-[var(--text-tertiary)]">
              School administrators connect with the tenant API base URL and a
              school-wide read-only API key. Spectra syncs about every three
              hours and can refresh on demand when AI needs fresher data.
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-md hover:bg-[var(--bg-secondary)]"
            aria-label="Close settings"
          >
            <X size={15} />
          </button>
        </header>
        <div className="space-y-4 p-5">
          <label className="block">
            <span className="mb-1.5 block text-micro font-medium">
              Canonical API endpoint
            </span>
            <input
              value={config.baseUrl}
              readOnly
              aria-readonly="true"
              className={input}
              placeholder="https://api.managebac.com"
            />
            <span className="mt-1 block text-micro leading-4 text-[var(--text-tertiary)]">
              Spectra owns this provider endpoint. Tenant route manifests are
              reviewed separately and cannot redirect credentials.
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-micro font-medium">
              School-wide API key
            </span>
            <input
              type="password"
              autoComplete="off"
              name="managebac-school-api-token"
              value={config.token}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  token: event.target.value,
                }))
              }
              className={input}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "managebac-key-error" : undefined}
              placeholder={
                connected
                  ? "Enter a replacement key to rotate the credential"
                  : envTokenAvailable
                    ? "Optional — a temporary server test key is available"
                    : "Stored encrypted; never returned to this browser"
              }
            />
            {error ? (
              <span id="managebac-key-error" role="alert" className="mt-1.5 block text-micro leading-4 text-[var(--danger)]">
                {error}
              </span>
            ) : null}
          </label>
          <div className="rounded-control border border-[color-mix(in_oklab,var(--accent-mint)_18%,var(--bg-elevated))] bg-[color-mix(in_oklab,var(--accent-mint)_6%,var(--bg-primary))] p-3 text-micro leading-4 text-[var(--accent-mint)]">
            Sync cadence, how the school API token is sent, and conflict policy
            are fixed by Spectra. Individual users cannot supply their own
            ManageBac keys.
          </div>
          <section className="rounded-lg border border-[color-mix(in_oklab,var(--accent-mint)_18%,var(--bg-elevated))] bg-[color-mix(in_oklab,var(--accent-mint)_6%,var(--bg-primary))] p-3">
            <div className="flex gap-2">
              <ShieldCheck
                size={15}
                className="mt-0.5 shrink-0 text-[var(--accent-mint)]"
              />
              <p className="text-micro leading-4 text-[var(--accent-mint)]">
                Spectra rejects write routes, private-network hosts, redirects,
                unverified schemas, broad identity enumeration, and any
                client-supplied ManageBac user ID.
              </p>
            </div>
          </section>
        </div>
        <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)]/95 px-5 py-3 backdrop-blur">
          <button
            type="button"
            onClick={onManifest}
            disabled={!connected}
            className="inline-flex h-8 items-center gap-2 rounded-control border border-[var(--border-subtle)] px-3 text-micro hover:bg-[var(--bg-secondary)] disabled:opacity-45"
          >
            <Code2 size={12} />
            Capability manifest
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-control px-3 text-micro hover:bg-[var(--bg-secondary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                busy ||
                !config.baseUrl ||
                (!connected &&
                  !canConnectWithoutTypedToken &&
                  config.token.length < 16) ||
                (config.token.length > 0 && config.token.length < 16)
              }
              onClick={onSave}
              className="inline-flex h-8 items-center gap-2 rounded-control bg-[var(--text-primary)] px-3.5 text-micro font-medium text-white disabled:opacity-45"
            >
              {busy ? (
                <LoaderCircle className="animate-spin" size={12} />
              ) : (
                <Save size={12} />
              )}
              {connected
                ? config.token
                  ? "Rotate and save"
                  : "Save settings"
                : "Connect"}
            </button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

export function ManifestDialog({
  value,
  setValue,
  busy,
  onClose,
  onImport,
}: {
  value: string;
  setValue: (value: string) => void;
  busy: boolean;
  onClose: () => void;
  onImport: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent
        hideCloseButton
        className="block max-h-[92vh] max-w-[760px] gap-0 overflow-y-auto bg-[var(--bg-primary)] p-0"
      >
        <header className="flex items-start justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <div>
            <DialogTitle className="font-display text-xl font-semibold">
              Verified capability manifest
            </DialogTitle>
            <DialogDescription className="mt-1 max-w-xl text-micro leading-4 text-[var(--text-tertiary)]">
              Paste the tenant OpenAPI reference to inventory every GET route as
              unverified, or paste a reviewed Spectra capability manifest. A
              discovered route cannot run until its read-only permission,
              audience, normalization, and sampled response contract are
              verified.
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-md hover:bg-[var(--bg-secondary)]"
            aria-label="Close manifest editor"
          >
            <X size={15} />
          </button>
        </header>
        <div className="p-5">
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            spellCheck={false}
            className="h-[400px] w-full resize-none rounded-card border border-[var(--border-subtle)] bg-[var(--text-primary)] p-4 font-mono text-micro leading-5 [color:color-mix(in_oklab,var(--accent-mint)_14%,var(--bg-elevated))] outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent-mint)_22%,var(--bg-elevated))]"
            placeholder={
              '{\n  "providerVersion": "tenant reference version",\n  "capabilities": [\n    {\n      "category": "Classes",\n      "name": "My classes",\n      "recordType": "class",\n      "path": "/verified/tenant/path",\n      "purpose": "Import the authenticated user’s current classes",\n      "scope": "personal",\n      "minimumRole": "student",\n      "pagination": "page",\n      "changeStrategy": "full_reconciliation",\n      "freshnessSlaMinutes": 120,\n      "contractVersion": "…",\n      "responseSchemaHash": "…",\n      "permissionState": "read_only",\n      "verificationStatus": "verified",\n      "routeSource": "tenant_reference",\n      "normalization": { "recordsPath": "…", "idPath": "…" }\n    }\n  ]\n}'
            }
          />
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-[color-mix(in_oklab,var(--accent-gold)_10%,var(--bg-elevated))] px-3 py-2.5 text-micro leading-4 text-[var(--accent-gold)]">
            <TriangleAlert className="mt-0.5 shrink-0" size={13} />
            Do not paste the API token, raw student responses, or copied payload
            contents. The manifest contains contracts and mappings only.
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-control px-3 text-micro hover:bg-[var(--bg-secondary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !value.trim()}
            onClick={onImport}
            className="inline-flex h-8 items-center gap-2 rounded-control bg-[var(--text-primary)] px-3.5 text-micro font-medium text-white disabled:opacity-45"
          >
            {busy ? (
              <LoaderCircle className="animate-spin" size={12} />
            ) : (
              <Play size={12} />
            )}
            Validate and replace
          </button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

export function DisconnectDialog({
  busy,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  /* The shared confirmation: the modal layer (it sat at `dropdown`, under
     every panel), focus on "Keep connected", and no dismissal while the
     disconnect runs. */
  return (
    <ConfirmDialog
      open
      title="Disconnect ManageBac?"
      detail="Spectra will give up its ManageBac access, stop scheduled syncs and unlink accounts. Imported artifacts and everyone's own notes on it stay in Spectra, marked as no longer syncing."
      confirmLabel="Disconnect"
      cancelLabel="Keep connected"
      destructive
      pending={busy}
      onCancel={onClose}
      onConfirm={onConfirm}
    />
  );
}
