"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  ExternalLink,
  FileClock,
  FileText,
  Fingerprint,
  History,
  KeyRound,
  Link2,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  Network,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  School,
  Settings2,
  ShieldCheck,
  TriangleAlert,
  UserCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ProductSectionNav } from "../components/product-section-nav";
import { AuxiliaryRail, AuxiliaryRailTrigger } from "../components/auxiliary-rail";
import { ProductPageHeader } from "../components/product-page-header";
import { ClassShelfEditor } from "../components/class-shelf-editor";
import {
  configureSpectraManageBac,
  disconnectSpectraManageBac,
  getSpectraManageBacOverview,
  importSpectraManageBacReference,
  replaceSpectraManageBacManifest,
  resolveSpectraManageBacConflict,
  resolveSpectraManageBacIdentity,
  syncSpectraManageBac,
  upsertSpectraCalendarPeriodMap,
  removeSpectraCalendarPeriodMap,
  type SpectraManageBacCapability,
  type SpectraManageBacConflict,
  type SpectraManageBacOverview,
  type SpectraManageBacRecord,
  type SpectraManageBacSyncRun,
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
  { key: "overview", label: "Overview", icon: School },
  { key: "classes", label: "Classes", icon: BookOpen },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "periods", label: "Period map", icon: Clock3 },
  { key: "tasks", label: "Tasks", icon: ListChecks },
  { key: "history", label: "Sync history", icon: History },
  { key: "conflicts", label: "Conflicts", icon: AlertTriangle },
  { key: "provenance", label: "Provenance", icon: Fingerprint },
] satisfies Array<{ key: Tab; label: string; icon: typeof School }>;

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
        state === "good" && "bg-[color-mix(in oklab, var(--accent-mint) 10%, var(--bg-primary))] text-[var(--accent-mint)]",
        state === "warning" && "bg-[color-mix(in oklab, var(--accent-gold) 18%, var(--bg-elevated))] text-[var(--accent-gold)]",
        state === "danger" && "bg-[color-mix(in oklab, var(--accent-coral) 10%, var(--bg-elevated))] text-[var(--accent-coral)]",
        state === "neutral" &&
          "bg-[var(--bg-secondary)] text-[var(--text-secondary)]",
        state === "blue" && "bg-[color-mix(in oklab, var(--accent-cyan) 10%, var(--bg-elevated))] text-[var(--accent-cyan)]",
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

function integrationStatusLabel(status: string | undefined) {
  switch (status) {
    case "connected":
      return "Connected";
    case "validating":
      return "Validating capabilities";
    case "draft":
      return "Draft — not connected yet";
    case "degraded":
      return "Connected with gaps";
    case "blocked":
      return "Blocked";
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
    default:
      if (run.stage.startsWith("syncing:")) return "Reading school data";
      if (run.stage.startsWith("quarantined:")) return "Data needs review";
      if (run.status === "running") return "Working on school data";
      return run.status === "completed" ? "School data is current" : "Sync status";
  }
}

function syncRecoveryMessage(run: SpectraManageBacSyncRun) {
  switch (run.errorCode) {
    case "INTEGRATION_IDENTITY_REQUIRED":
    case "INTEGRATION_IDENTITY_FAILED":
    case "INTEGRATION_IDENTITY_INVALID":
      return "Resolve your school identity to continue.";
    case "INTEGRATION_CREDENTIAL_REJECTED":
      return "Ask a school administrator to reconnect the read-only ManageBac connection.";
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
      return "This sync timed out and was stopped. Retry if you still need school updates.";
    default:
      return run.status === "partial"
        ? "Some school data was saved. Retry to fill the gaps."
        : run.status === "failed"
          ? "The sync did not finish. Retry when the connection is ready."
          : undefined;
  }
}

function humanizeIntegrationError(value: unknown) {
  const message = value instanceof Error ? value.message : "";
  const code = message.match(/^([A-Z][A-Z0-9_]+)\b/)?.[1];
  return syncRecoveryMessage({
    status: "failed",
    stage: "failed",
    errorCode: code,
  } as SpectraManageBacSyncRun) ?? "ManageBac could not complete that action. Try again.";
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
                <span className="grid size-8 shrink-0 place-items-center text-micro font-bold text-[var(--accent-mint)]">{period.periodKey.slice(0, 3).toUpperCase()}</span>
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="truncate text-micro">{period.label}</strong><StatusPill state="good">Verified</StatusPill></div><p className="mt-1 text-micro text-[var(--text-tertiary)]">{timeFromMinutes(period.startMinutes)}–{timeFromMinutes(period.endMinutes)} · {period.timezone} · {period.weekdays.map((day) => weekdays[day]).join(", ")}</p></div>
                <button type="button" disabled={Boolean(busy)} onClick={() => void onRemove(period._id)} className="grid size-7 place-items-center rounded-md text-[var(--text-tertiary)] opacity-0 hover:bg-[color-mix(in oklab, var(--accent-coral) 10%, var(--bg-elevated))] hover:text-[var(--accent-coral)] group-hover:opacity-100 focus:opacity-100 disabled:opacity-45" aria-label={`Remove ${period.label}`}><X size={13} /></button>
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
        <fieldset className="mt-3"><legend className="text-micro font-medium text-[var(--text-secondary)]">Weekdays</legend><div className="mt-1.5 flex flex-wrap gap-1">{weekdays.map((label, value) => <button key={label} type="button" aria-pressed={draft.weekdays.includes(value)} onClick={() => setDraft((current) => ({ ...current, weekdays: current.weekdays.includes(value) ? current.weekdays.filter((day) => day !== value) : [...current.weekdays, value].sort() }))} className={cn("h-7 rounded-md border px-2 text-micro font-semibold", draft.weekdays.includes(value) ? "border-[var(--accent-mint)] bg-[color-mix(in oklab, var(--accent-mint) 8%, var(--bg-primary))] text-[var(--accent-mint)]" : "border-[var(--border-default)] text-[var(--text-tertiary)]")}>{label}</button>)}</div></fieldset>
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
  const [detailsTab, setDetailsTab] = useState<"details" | "activity">(
    "details",
  );
  const [contextOpen, setContextOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manifestOpen, setManifestOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [manifestText, setManifestText] = useState("");
  const [config, setConfig] = useState({
    baseUrl: "",
    token: "",
  });

  const refresh = useCallback(async () => {
    try {
      const value = await getSpectraManageBacOverview();
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
        nextError instanceof Error
          ? nextError.message
          : "ManageBac could not be loaded.",
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
    () => records.filter((record) => record.recordType === "class"),
    [records],
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
        ["queued", "running"].includes(run.status),
      ),
    [data?.syncRuns],
  );
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
          "Paste an OpenAPI tenant reference or a verified Spectra capability manifest.",
        );
      await replaceSpectraManageBacManifest({
        integrationId: integration._id,
        providerVersion: text(parsedObject.providerVersion) || undefined,
        capabilities,
      });
      setManifestOpen(false);
      setManifestText("");
    });

  if (loading)
    return (
      <div className="grid h-full min-h-[70vh] place-items-center bg-[var(--bg-primary)]">
        <div className="flex items-center gap-2 text-caption text-[var(--text-tertiary)]">
          <LoaderCircle className="animate-spin" size={15} />
          Loading school data integration
        </div>
      </div>
    );

  return (
    <div className="spectra-wave-y relative flex h-full min-h-0 overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full w-full flex-col px-4 pb-24 pt-3 sm:px-6 lg:px-8">
          {error ? (
            <div
              className="mb-2 flex items-start gap-2 rounded-lg border border-[color-mix(in oklab, var(--accent-coral) 22%, var(--bg-elevated))] bg-[color-mix(in oklab, var(--accent-coral) 8%, var(--bg-elevated))] px-3 py-2.5 text-micro leading-5 text-[var(--danger)]"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 shrink-0" size={14} />
              <span className="min-w-0 flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError("")}
                className="grid size-5 place-items-center rounded hover:bg-[color-mix(in oklab, var(--accent-coral) 18%, var(--bg-elevated))]"
                aria-label="Dismiss error"
              >
                <X size={12} />
              </button>
            </div>
          ) : null}

          <section className="min-w-0">
            <ProductPageHeader
              className="pb-5 pt-1 sm:pt-2"
              eyebrow={
                overview?.admin
                  ? "ManageBac · Admin setup"
                  : "ManageBac · Personal data"
              }
              title={overview?.admin ? "ManageBac connection" : "Your ManageBac data"}
              description={
                overview?.admin
                  ? "Manage the school connection and synchronization. Choose which classes get their own workspace from this page or from School."
                  : "Review your classes, timetable, and assignments. Choose which classes get their own workspace from this page or from School."
              }
              actions={
                <>
                  <button type="button" onClick={() => void refresh()} className="inline-flex size-8 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" aria-label="Refresh connection data" title="Refresh connection data"><RefreshCw size={13} /></button>
                  {integration ? <button type="button" disabled={Boolean(busy) || syncInProgress || integration.status === "validating" || integration.status === "draft"} onClick={() => void runAction("sync", () => syncSpectraManageBac())} className="inline-flex h-8 items-center gap-2 rounded-control bg-[var(--text-primary)] px-3 text-micro font-medium text-[var(--bg-primary)] transition hover:opacity-90 disabled:opacity-60" title={integration.status === "validating" ? "Sync waits until capability validation finishes." : integration.status === "draft" ? "Connect ManageBac before syncing." : syncInProgress ? "A sync is already running." : "Sync now"}><RefreshCw size={13} className={busy === "sync" || syncInProgress ? "animate-spin" : ""} />{busy === "sync" || syncInProgress ? "Syncing…" : integration.status === "validating" ? "Validating…" : "Sync now"}</button> : null}
                  {overview?.admin ? <button type="button" onClick={() => setSettingsOpen(true)} className="inline-flex size-8 items-center justify-center rounded-control border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" aria-label="ManageBac settings" title="ManageBac settings"><Settings2 size={13} /></button> : null}
                  {!contextOpen ? <AuxiliaryRailTrigger label="ManageBac context" onOpen={() => setContextOpen(true)} /> : null}
                </>
              }
            />

            {integration &&
            overview?.admin &&
            data?.mapping?.status !== "verified" ? (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-card border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3">
                <div className="min-w-0">
                  <strong className="block text-ui font-semibold">
                    Match your verified school account
                  </strong>
                  <p className="mt-1 max-w-xl text-micro leading-5 text-[var(--text-secondary)]">
                    Disconnecting ManageBac clears identity mappings. Spectra
                    matches the email already on your Spectra account to the
                    school connection and never reveals a selectable student ID.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={Boolean(busy) || syncInProgress}
                  onClick={() =>
                    void runAction("identity", () =>
                      resolveSpectraManageBacIdentity(),
                    )
                  }
                  className="inline-flex h-8 items-center gap-2 rounded-control bg-[var(--text-primary)] px-3.5 text-micro font-medium text-[var(--bg-primary)] disabled:opacity-60"
                >
                  {busy === "identity" ? (
                    <LoaderCircle className="animate-spin" size={13} />
                  ) : (
                    <Fingerprint size={13} />
                  )}
                  Resolve my school identity
                </button>
              </div>
            ) : null}

            {!integration && (
              <div className="mb-1 rounded-card border border-dashed border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--bg-secondary)_45%,transparent)] px-5 py-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="grid size-9 place-items-center rounded-lg bg-[var(--bg-elevated)] text-[var(--accent-cyan)]">
                      <KeyRound size={16} />
                    </span>
                    <div>
                      <strong className="text-ui font-semibold">
                        {overview?.admin
                          ? "Connect your school’s read-only API"
                          : "Your school has not connected ManageBac"}
                      </strong>
                      <p className="mt-1 max-w-xl text-micro leading-5 text-[var(--text-tertiary)]">
                        {overview?.admin
                          ? "Use the tenant API Manager reference—Spectra never guesses routes, sends write requests, or exposes the school token."
                          : "A school administrator must configure and verify the tenant capabilities before personal synchronization is available."}
                      </p>
                    </div>
                  </div>
                  {overview?.admin ? (
                    <button
                      type="button"
                      onClick={() => setSettingsOpen(true)}
                      className="inline-flex h-8 items-center gap-2 rounded-control bg-[var(--text-primary)] px-3.5 text-micro font-medium text-white shadow-sm hover:bg-[var(--text-primary)]"
                    >
                      <Link2 size={13} />
                      Connect ManageBac
                    </button>
                  ) : null}
                </div>
              </div>
            )}

            <ProductSectionNav
              label="ManageBac sections"
              items={tabs}
              active={tab}
              onChange={setTab}
              className="mt-4"
            />

            <div className="min-h-[470px] py-4">
              {!integration ? (
                <EmptyState
                  icon={LockKeyhole}
                  title="Verified school data will appear here"
                  detail="Once an administrator connects the token and imports the tenant capability manifest, Spectra will resolve your identity without exposing alternative accounts."
                />
              ) : !overview?.admin &&
                data?.mapping?.status !== "verified" &&
                tab !== "history" &&
                tab !== "provenance" ? (
                <div className="mx-auto flex min-h-[390px] max-w-lg flex-col items-center justify-center text-center">
                  <span className="grid size-12 place-items-center rounded-2xl bg-[color-mix(in oklab, var(--accent-cyan) 8%, var(--bg-elevated))] text-[var(--accent-cyan)]">
                    <UserCheck size={22} />
                  </span>
                  <h2 className="mt-4 font-display text-xl font-semibold">
                    Match your verified school account
                  </h2>
                  <p className="mt-2 text-caption leading-5 text-[var(--text-tertiary)]">
                    Spectra matches the email already on your Spectra account to
                    the school’s ManageBac connection. You do not need to sign
                    in again. Exactly one match is accepted, and Spectra never
                    sends or reveals a student ID.
                  </p>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void runAction("identity", () =>
                        resolveSpectraManageBacIdentity(),
                      )
                    }
                    className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--text-primary)] px-4 text-micro font-medium text-white disabled:opacity-60"
                  >
                    {busy === "identity" || syncInProgress ? (
                      <LoaderCircle className="animate-spin" size={14} />
                    ) : (
                      <Fingerprint size={14} />
                    )}
                    Resolve my school identity
                  </button>
                </div>
              ) : tab === "overview" ? (
                <div className="grid gap-x-12 gap-y-10 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,.8fr)] lg:py-10">
                  <section className="min-w-0">
                    <p className="text-micro font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">Connection</p>
                    <div className="mt-3 flex items-start gap-3">
                      <span className={cn("mt-2 size-2.5 shrink-0 rounded-full ring-4 ring-current/10", integration.status === "connected" ? "text-emerald-600 bg-emerald-600" : integration.status === "validating" ? "text-sky-500 bg-sky-500" : "text-amber-500 bg-amber-500")} />
                      <div>
                        <h2 className="font-display text-title font-semibold tracking-[-0.02em]">{integration.status === "connected" ? "ManageBac is connected" : integration.status === "validating" ? "Validating ManageBac capabilities" : integration.status === "draft" ? "ManageBac is not connected yet" : "The connection needs attention"}</h2>
                        <p className="mt-2 max-w-xl text-caption leading-5 text-[var(--text-secondary)]">{integration.status === "connected" ? "Verified school records are available to Spectra." : integration.status === "validating" ? "Spectra is checking the tenant reference and readable capabilities. Sync stays paused until validation finishes." : integration.status === "draft" ? "Finish connecting with a verified tenant token and capability manifest before syncing." : "The last synchronization completed with partial coverage. Existing verified records remain available."}</p>
                      </div>
                    </div>
                    <p className="ml-5 mt-4 text-micro text-[var(--text-tertiary)]">{data?.school?.name ?? "Your school"} · last synchronized {integration.lastSyncAt ? relative(integration.lastSyncAt) : "never"} · {data?.conflicts.length ?? 0} conflicts</p>
                    <div className="ml-5 mt-5 flex flex-wrap gap-1">
                      <button type="button" onClick={() => setTab("history")} className="h-8 rounded-lg px-3 text-micro font-medium hover:bg-[var(--bg-hover)]">Sync history</button>
                      <button type="button" onClick={() => setTab("conflicts")} className="h-8 rounded-lg px-3 text-micro font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]">Review conflicts</button>
                    </div>
                  </section>

                  <section className="min-w-0 lg:pt-1">
                    <h2 className="text-body font-semibold">Synchronized data</h2>
                    <p className="mt-1 text-micro leading-5 text-[var(--text-tertiary)]">Open a verified source collection.</p>
                    <div className="mt-3 space-y-1">
                      {([
                        ["Classes", classes.length, "classes", BookOpen],
                        ["Calendar", timetable.length, "calendar", CalendarDays],
                        ["Tasks", tasks.length, "tasks", ListChecks],
                      ] as const).map(([label, count, target, Icon]) => (
                        <button key={target} type="button" onClick={() => setTab(target)} className="group flex h-11 w-full items-center gap-3 rounded-xl px-2.5 text-micro text-[var(--text-secondary)] transition hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]">
                          <Icon size={14} className="text-[var(--text-tertiary)] transition-transform group-hover:scale-110 group-hover:text-[var(--text-primary)]" />
                          <span className="flex-1 text-left">{label}</span>
                          <strong className="font-display text-editor font-semibold tabular-nums text-[var(--text-primary)]">{count}</strong>
                          <ChevronRight size={13} className="text-[var(--text-tertiary)] transition-transform group-hover:translate-x-0.5" />
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              ) : tab === "classes" ? (
                <div>
                  <ClassShelfEditor
                    onSaved={() =>
                      runAction("sync", () => syncSpectraManageBac("manual"))
                    }
                  />
                  <div className="mt-8">
                    <RecordsList
                      records={classes}
                      emptyTitle="No classes in the latest sync"
                      emptyDetail="When ManageBac is connected, current class records appear here after a successful sync."
                    />
                  </div>
                </div>
              ) : tab === "calendar" ? (
                <RecordsList
                  records={timetable}
                  emptyTitle="No Calendar source events"
                  emptyDetail="Verified lessons and Calendar routes populate source-locked Calendar layers without creating work items."
                />
              ) : tab === "periods" ? (
                <PeriodMapPanel
                  periodMaps={data?.periodMaps ?? []}
                  busy={busy}
                  onSave={(period) =>
                    runAction(`period:${period.periodKey}`, () =>
                      upsertSpectraCalendarPeriodMap(period),
                    )
                  }
                  onRemove={(periodMapId) =>
                    runAction(`period-remove:${periodMapId}`, () =>
                      removeSpectraCalendarPeriodMap(periodMapId),
                    )
                  }
                />
              ) : tab === "tasks" ? (
                <RecordsList
                  records={tasks}
                  emptyTitle="No assignments or deadlines"
                  emptyDetail="Readable assignments, assessments, and deadlines appear as source-linked planner tasks without replacing personal notes."
                />
              ) : tab === "history" ? (
                  <SyncTable
                    runs={data?.syncRuns ?? []}
                    syncBusy={Boolean(busy) || syncInProgress}
                    onRetry={() =>
                      void runAction("sync", () => syncSpectraManageBac())
                    }
                    onResolveIdentity={() =>
                      void runAction("identity", () =>
                        resolveSpectraManageBacIdentity(),
                      )
                    }
                  />
              ) : tab === "conflicts" ? (
                data?.conflicts.length ? (
                  <ConflictList
                    conflicts={data.conflicts}
                    busy={busy}
                    onResolve={(conflict, resolution) =>
                      runAction(`conflict:${conflict._id}`, () =>
                        resolveSpectraManageBacConflict({
                          conflictId: conflict._id,
                          resolution,
                        }),
                      )
                    }
                  />
                ) : (
                  <EmptyState
                    icon={CheckCircle2}
                    title="No conflicts to review"
                    detail="Safe source updates apply automatically. Ambiguous changes stop here before touching customized work."
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
          </section>
        </div>
      </main>

      {contextOpen ? <AuxiliaryRail label="ManageBac context" onClose={() => setContextOpen(false)} className="hidden xl:block" navigation={
        <div className="grid grid-cols-2 gap-1">
          {(["details", "activity"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setDetailsTab(item)}
              className={cn(
                "h-7 rounded-md text-micro capitalize text-[var(--text-tertiary)] transition",
                detailsTab === item &&
                  "bg-[color-mix(in_oklab,var(--text-primary)_7%,transparent)] font-medium text-[var(--text-primary)]",
              )}
            >
              {item}
            </button>
          ))}
        </div>
      }>
        {detailsTab === "details" ? (
          <div className="space-y-7 px-4 pb-5 pt-3">
            <RightCard title="Integration">
              <div className="flex items-center gap-2.5">
                <span className="grid size-7 place-items-center text-[var(--accent-cyan)]">
                  <Network size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <strong className="block text-caption font-medium">
                    ManageBac
                  </strong>
                  <span className="block truncate text-micro text-[var(--text-tertiary)]">
                    {integration?.providerVersion
                      ? `Reference ${integration.providerVersion}`
                      : "Tenant-verified API"}
                  </span>
                </div>
                <StatusPill state={integrationStatusTone(integration?.status)}>
                  {integrationStatusLabel(integration?.status)}
                </StatusPill>
              </div>
            </RightCard>
            <RightCard title="Connected school">
              <div className="flex items-center gap-2.5">
                <School size={16} className="text-[var(--brand-primary)]" />
                <div className="min-w-0">
                  <strong className="block truncate text-caption font-medium">
                    {data?.school?.name ?? "Your school"}
                  </strong>
                  <span className="text-micro text-[var(--text-tertiary)]">
                    Read-only operational connection
                  </span>
                </div>
              </div>
            </RightCard>
            <RightCard title="Sync settings">
              <DetailRow
                icon={Clock3}
                label="Sync frequency"
                value={
                  integration
                    ? `Every ${integration.syncPolicy.frequencyMinutes} minutes`
                    : "Not configured"
                }
              />
              <DetailRow
                icon={School}
                label="Auto-import new classes"
                value={
                  integration ? "Automatic" : "Unavailable until connected"
                }
                good={Boolean(integration)}
              />
              <DetailRow
                icon={ListChecks}
                label="Auto-import tasks"
                value={
                  integration ? "Automatic" : "Unavailable until connected"
                }
                good={Boolean(integration)}
              />
              <DetailRow
                icon={AlertCircle}
                label="Conflict resolution"
                value={
                  integration
                    ? integration.syncPolicy.conflictMode === "ask_me"
                      ? "Ask me"
                      : "Review"
                    : "Unavailable until connected"
                }
              />
              {overview?.admin ? (
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="mt-2 inline-flex items-center gap-2 text-micro text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <Settings2 size={12} />
                  Edit settings
                </button>
              ) : null}
            </RightCard>
            <RightCard title="Data provenance">
              <p className="text-micro leading-5 text-[var(--text-secondary)]">
                Imported records retain source identity, contract version,
                refresh time, and tombstone state. User overlays remain
                separate.
              </p>
              <button
                type="button"
                onClick={() => setTab("provenance")}
                className="mt-2 text-micro text-[var(--accent-cyan)]"
              >
                Review provenance
              </button>
            </RightCard>
            <RightCard title="Quick actions">
              <QuickAction
                icon={AlertCircle}
                label="Review conflicts"
                onClick={() => setTab("conflicts")}
              />
              <QuickAction
                icon={ShieldCheck}
                label="Review capabilities"
                onClick={() => setTab("provenance")}
              />
              {integration?.referenceUrl ? (
                <a
                  href={integration.referenceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-8 items-center gap-2 rounded-md px-1 text-micro text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                >
                  <ExternalLink size={13} />
                  Open tenant reference
                </a>
              ) : null}
              {overview?.admin && integration ? (
                <QuickAction
                  icon={Link2}
                  label="Disconnect ManageBac"
                  onClick={() => setDisconnectOpen(true)}
                />
              ) : null}
            </RightCard>
            {integration ? (
              <RightCard title="Integration ID">
                <code className="block truncate text-micro text-[var(--text-secondary)]">
                  {integration._id}
                </code>
              </RightCard>
            ) : null}
          </div>
        ) : (
          <div className="px-4 pb-5 pt-3">
            <RightCard title="Recent sync activity">
              {(data?.syncRuns ?? []).slice(0, 8).map((run) => (
                <div
                  key={run._id}
                    className="flex gap-2 rounded-lg py-2.5 transition-colors hover:bg-[var(--bg-hover)]"
                >
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center">
                    <History size={11} />
                  </span>
                  <div className="min-w-0">
                    <strong className="block text-micro font-medium capitalize">
                      {syncKindLabel(run.kind)} · {syncStatusLabel(run.status)}
                    </strong>
                    <span className="block text-micro text-[var(--text-tertiary)]">
                      {run.counts.created} added · {run.counts.updated} updated
                      · {syncStageLabel(run)} · {relative(run.completedAt ?? run.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
              {!data?.syncRuns.length ? (
                <p className="py-4 text-micro text-[var(--text-tertiary)]">
                  No synchronization activity yet.
                </p>
              ) : null}
            </RightCard>
          </div>
        )}
      </AuxiliaryRail> : null}

      {settingsOpen ? (
        <SettingsDialog
          config={config}
          setConfig={setConfig}
          busy={busy === "configure"}
          connected={Boolean(integration)}
          envTokenAvailable={Boolean(data?.envTokenAvailable)}
          onClose={() => setSettingsOpen(false)}
          onSave={saveConfiguration}
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

function ConflictList({
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
  return (
    <div className="space-y-2 px-1">
      {conflicts.map((conflict) => {
        const oldSource = object(conflict.oldSource);
        const nextSource = object(conflict.newSource);
        return (
          <article key={conflict._id} className="rounded-xl px-3 py-3 transition-colors hover:bg-[var(--bg-secondary)]">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[color-mix(in oklab, var(--accent-gold) 18%, var(--bg-elevated))] text-[var(--accent-gold)]">
                <AlertCircle size={12} />
              </span>
              <div className="min-w-0 flex-1">
                <strong className="block text-micro font-medium">
                  {conflict.kind.replaceAll("_", " ")}
                </strong>
                <p className="mt-1 text-micro leading-4 text-[var(--text-secondary)]">
                  {text(oldSource.title ?? oldSource.name, "The source record")}
                  {nextSource.title || nextSource.name
                    ? ` changed to “${text(nextSource.title ?? nextSource.name)}”.`
                    : " was removed or changed while your overlay was based on an older version."}
                </p>
                <span className="mt-1 block text-micro text-[var(--text-tertiary)]">
                  {conflict.projectionType.replaceAll("_", " ")} ·{" "}
                  {formatDate(conflict.createdAt)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {conflict.suggestedActions.includes("detach") ||
                conflict.suggestedActions.includes("archive_projection") ? (
                  <>
                    {conflict.suggestedActions.includes("detach") ? (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => onResolve(conflict, "detach")}
                        className="h-7 rounded-md border border-[var(--border-subtle)] px-2 text-micro hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                      >
                        Keep in Spectra
                      </button>
                    ) : null}
                    {conflict.suggestedActions.includes("archive_projection") ? (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => onResolve(conflict, "archive_projection")}
                        className="h-7 rounded-md bg-[var(--text-primary)] px-2.5 text-micro text-white hover:bg-[var(--text-primary)] disabled:opacity-50"
                      >
                        Archive in Spectra
                      </button>
                    ) : null}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => onResolve(conflict, "keep_overlay")}
                      className="h-7 rounded-md border border-[var(--border-subtle)] px-2 text-micro hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                    >
                      Keep mine
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => onResolve(conflict, "rebase")}
                      className="h-7 rounded-md bg-[var(--text-primary)] px-2.5 text-micro text-white hover:bg-[var(--text-primary)] disabled:opacity-50"
                    >
                      Rebase
                    </button>
                  </>
                )}
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
                <strong className="text-micro uppercase tracking-[.08em] text-[var(--text-tertiary)]">
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
      <h3 className="mb-2.5 text-micro font-semibold uppercase tracking-[.08em] text-[var(--text-tertiary)]">
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

function SettingsDialog({
  config,
  setConfig,
  busy,
  connected,
  envTokenAvailable,
  onClose,
  onSave,
  onManifest,
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
}) {
  const input =
    "h-9 w-full rounded-control border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-micro outline-none focus:border-[#7aa999] focus:ring-2 focus:ring-[#dceee7]";
  const canConnectWithoutTypedToken =
    !connected && envTokenAvailable && config.token.length === 0;
  return (
    <div
      className="fixed inset-0 z-modal grid place-items-center bg-[var(--text-primary)]/25 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="ManageBac settings"
    >
      <div className="max-h-[92vh] w-full max-w-[520px] overflow-y-auto rounded-surface border border-white/70 bg-[var(--bg-primary)] shadow-[var(--shadow-lg)]">
        <header className="sticky top-0 z-chrome flex items-start justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-primary)]/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 className="font-display text-xl font-semibold">
              ManageBac connection
            </h2>
            <p className="mt-1 text-micro text-[var(--text-tertiary)]">
              School administrators connect with the tenant API base URL and a
              school-wide read-only API key. Spectra syncs about every three
              hours and can refresh on demand when AI needs fresher data.
            </p>
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
              placeholder={
                connected
                  ? "Enter a replacement key to rotate the credential"
                  : envTokenAvailable
                    ? "Optional — a temporary server test key is available"
                    : "Stored encrypted; never returned to this browser"
              }
            />
          </label>
          <div className="rounded-control border border-[color-mix(in oklab, var(--accent-mint) 18%, var(--bg-elevated))] bg-[color-mix(in oklab, var(--accent-mint) 6%, var(--bg-primary))] p-3 text-micro leading-4 text-[var(--accent-mint)]">
            Sync cadence, how the school API token is sent, and conflict policy
            are fixed by Spectra. Individual users cannot supply their own
            ManageBac keys.
          </div>
          <section className="rounded-lg border border-[color-mix(in oklab, var(--accent-mint) 18%, var(--bg-elevated))] bg-[color-mix(in oklab, var(--accent-mint) 6%, var(--bg-primary))] p-3">
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
      </div>
    </div>
  );
}

function ManifestDialog({
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
    <div
      className="fixed inset-0 z-modal grid place-items-center bg-[var(--text-primary)]/25 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Import capability manifest"
    >
      <div className="w-full max-w-[760px] overflow-hidden rounded-surface border border-white/70 bg-[var(--bg-primary)] shadow-[var(--shadow-lg)]">
        <header className="flex items-start justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <div>
            <h2 className="font-display text-xl font-semibold">
              Verified capability manifest
            </h2>
            <p className="mt-1 max-w-xl text-micro leading-4 text-[var(--text-tertiary)]">
              Paste the tenant OpenAPI reference to inventory every GET route as
              unverified, or paste a reviewed Spectra capability manifest. A
              discovered route cannot run until its read-only permission,
              audience, normalization, and sampled response contract are
              verified.
            </p>
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
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-[color-mix(in oklab, var(--accent-gold) 10%, var(--bg-elevated))] px-3 py-2.5 text-micro leading-4 text-[var(--accent-gold)]">
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
      </div>
    </div>
  );
}

function DisconnectDialog({
  busy,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-dropdown grid place-items-center bg-[var(--text-primary)]/25 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label="Disconnect ManageBac"
    >
      <div className="w-full max-w-[430px] rounded-surface border border-white/70 bg-[var(--bg-primary)] p-5 shadow-[var(--shadow-lg)]">
        <span className="grid size-10 place-items-center rounded-xl bg-[color-mix(in oklab, var(--accent-coral) 10%, var(--bg-elevated))] text-[var(--accent-coral)]">
          <AlertTriangle size={18} />
        </span>
        <h2 className="mt-4 font-display text-xl font-semibold">
          Disconnect ManageBac?
        </h2>
        <p className="mt-2 text-micro leading-5 text-[var(--text-secondary)]">
          The server-side token will be revoked, scheduled runs will stop, and
          identity mappings will be cleared. Imported work and user
          overlays remain intact with stale or removed-source provenance.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-8 rounded-control px-3 text-micro hover:bg-[var(--bg-secondary)] disabled:opacity-50"
          >
            Keep connected
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex h-8 items-center gap-2 rounded-control bg-[var(--danger)] px-3.5 text-micro font-medium text-white disabled:opacity-50"
          >
            {busy ? (
              <LoaderCircle className="animate-spin" size={12} />
            ) : (
              <Link2 size={12} />
            )}
            Disconnect
          </button>
        </div>
      </div>
    </div>
  );
}
