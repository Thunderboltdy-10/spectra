"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
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
  RefreshCw,
  RotateCcw,
  Save,
  School,
  Search,
  Settings2,
  ShieldCheck,
  Table2,
  TriangleAlert,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CommandBar } from "../components/command-bar";
import {
  configureSpectraManageBac,
  disconnectSpectraManageBac,
  getSpectraManageBacOverview,
  importSpectraManageBacReference,
  replaceSpectraManageBacManifest,
  resolveSpectraManageBacConflict,
  resolveSpectraManageBacIdentity,
  syncSpectraManageBac,
  type SpectraManageBacCapability,
  type SpectraManageBacConflict,
  type SpectraManageBacOverview,
  type SpectraManageBacRecord,
  type SpectraManageBacSyncRun,
} from "@/features/spectra/data/api";

type Tab =
  | "overview"
  | "classes"
  | "timetable"
  | "tasks"
  | "history"
  | "conflicts"
  | "provenance";

const tabs: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "classes", label: "Classes" },
  { key: "timetable", label: "Timetable" },
  { key: "tasks", label: "Tasks" },
  { key: "history", label: "Sync history" },
  { key: "conflicts", label: "Conflicts" },
  { key: "provenance", label: "Provenance" },
];

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
        "inline-flex h-5 items-center gap-1 rounded-[5px] px-2 text-[10px] font-medium",
        state === "good" && "bg-[#e7f6ef] text-[#287a5e]",
        state === "warning" && "bg-[#fff3df] text-[#a46019]",
        state === "danger" && "bg-[#fff0ed] text-[#b64838]",
        state === "neutral" &&
          "bg-[var(--bg-secondary)] text-[var(--text-secondary)]",
        state === "blue" && "bg-[#eaf3ff] text-[#3574ad]",
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
      <span className="mb-3 grid size-10 place-items-center rounded-xl bg-[var(--bg-secondary)] text-[var(--text-tertiary)]">
        <Icon size={18} />
      </span>
      <strong className="font-[var(--font-serif)] text-[17px] font-medium text-[var(--text-primary)]">
        {title}
      </strong>
      <p className="mt-1 max-w-sm text-[12px] leading-5 text-[var(--text-tertiary)]">
        {detail}
      </p>
    </div>
  );
}

function SummaryMetric({
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
      <span className="block text-[10px] text-[var(--text-tertiary)]">
        {label}
      </span>
      <strong className="mt-1 flex items-center gap-1.5 truncate text-[12px] font-semibold text-[var(--text-primary)]">
        {state ? (
          <span
            className={cn(
              "size-1.5 rounded-full",
              state === "good" ? "bg-[#2aaa7b]" : "bg-[#e7a43d]",
            )}
          />
        ) : null}
        {value}
      </strong>
      <span className="mt-1 block truncate text-[9px] text-[var(--text-tertiary)]">
        {detail}
      </span>
    </div>
  );
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
    <StatusPill state={state}>{run.status.replaceAll("_", " ")}</StatusPill>
  );
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
    <div className="divide-y divide-[var(--border-subtle)]">
      {records.map((record) => (
        <article
          key={record._id}
          className="group flex min-w-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--bg-secondary)]/65"
        >
          <span
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg",
              record.tombstone
                ? "bg-[#fff0ed] text-[#b64838]"
                : "bg-[#ebf7f2] text-[#2c8968]",
            )}
          >
            <RecordIcon type={record.recordType} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <strong className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                {recordTitle(record)}
              </strong>
              {record.tombstone ? (
                <StatusPill state="danger">Removed at source</StatusPill>
              ) : null}
            </div>
            <p className="mt-0.5 truncate text-[10px] text-[var(--text-tertiary)]">
              {recordSubtitle(record)} · refreshed {relative(record.fetchedAt)}
            </p>
          </div>
          {recordStart(record) ? (
            <time className="shrink-0 text-[10px] text-[var(--text-tertiary)]">
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

export function ManageBacIntegrationShell() {
  const [overview, setOverview] = useState<SpectraManageBacOverview | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [detailsTab, setDetailsTab] = useState<"details" | "activity">(
    "details",
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manifestOpen, setManifestOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [manifestText, setManifestText] = useState("");
  const [config, setConfig] = useState({
    baseUrl: "",
    referenceUrl: "",
    authHeaderName: "Authorization",
    authScheme: "bearer" as "raw" | "bearer",
    token: "",
    frequencyMinutes: 60,
    autoApplySafeUpdates: true,
    conflictMode: "review" as "review" | "ask_me",
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
          referenceUrl: integration.referenceUrl ?? "",
          authHeaderName: integration.authHeaderName,
          authScheme: integration.authScheme,
          frequencyMinutes: integration.syncPolicy.frequencyMinutes,
          autoApplySafeUpdates: integration.syncPolicy.autoApplySafeUpdates,
          conflictMode: integration.syncPolicy.conflictMode,
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
  const records = data?.records ?? data?.previews ?? [];
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
  const coverage = integration?.capabilityCoverage;
  const latestRun = data?.syncRuns[0];
  const coveragePercent = coverage?.discovered
    ? Math.round((coverage.verifiedReadable / coverage.discovered) * 100)
    : 0;

  const runAction = useCallback(
    async (key: string, action: () => Promise<unknown>) => {
      setBusy(key);
      setError("");
      try {
        await action();
        await refresh();
      } catch (nextError) {
        setError(
          nextError instanceof Error
            ? nextError.message
            : "The integration action failed.",
        );
      } finally {
        setBusy("");
      }
    },
    [refresh],
  );

  const saveConfiguration = () =>
    runAction("configure", async () => {
      await configureSpectraManageBac(config);
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
        <div className="flex items-center gap-2 text-[12px] text-[var(--text-tertiary)]">
          <LoaderCircle className="animate-spin" size={15} />
          Loading school data integration
        </div>
      </div>
    );

  return (
    <div className="spectra-wave-y relative flex h-full min-h-0 overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full w-full flex-col px-4 pb-24 pt-3 sm:px-6 lg:px-8">
          <div className="mb-3 flex h-11 items-center justify-end gap-3">
            <span className="hidden items-center gap-1.5 text-[10px] text-[var(--text-secondary)] sm:flex">
              {integration ? (
                <>
                  <CheckCircle2 size={13} className="text-[#46866d]" />
                  {busy ? "Working…" : "Connected"}
                </>
              ) : (
                <>
                  <AlertCircle size={13} />
                  {busy ? "Working…" : "Not connected"}
                </>
              )}
            </span>
            <button
              type="button"
              onClick={() => void refresh()}
              className="grid size-8 place-items-center rounded-md border border-[var(--border-subtle)] bg-white text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
              aria-label="Refresh integration"
            >
              <RefreshCw size={14} />
            </button>
          </div>

          {error ? (
            <div
              className="mb-2 flex items-start gap-2 rounded-lg border border-[#edc7bf] bg-[#fff7f4] px-3 py-2.5 text-[11px] leading-5 text-[#9a4336]"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 shrink-0" size={14} />
              <span className="min-w-0 flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError("")}
                className="grid size-5 place-items-center rounded hover:bg-[#f5ded8]"
                aria-label="Dismiss error"
              >
                <X size={12} />
              </button>
            </div>
          ) : null}

          <section className="min-w-0">
            <header className="flex flex-wrap items-start justify-between gap-4 pb-4 pt-1 sm:pt-2">
              <div className="flex min-w-0 items-start gap-3.5">
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[9px] bg-[linear-gradient(145deg,#eef8fd,#e5ecff)] text-[#367ea8] shadow-inner">
                  <Network size={18} />
                </span>
                <div className="min-w-0">
                  <span className="block text-[9px] font-semibold uppercase tracking-[.12em] text-[var(--text-tertiary)]">
                    ManageBac
                  </span>
                  <h1 className="mt-1 font-[var(--font-serif)] text-[26px] font-medium tracking-[-.025em]">
                    ManageBac Integration
                  </h1>
                  <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                    Import classes, timetables and tasks from verified read-only
                    routes while preserving your work.
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {integration ? (
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void runAction("sync", () => syncSpectraManageBac())
                    }
                    className="inline-flex h-8 items-center gap-2 rounded-[7px] border border-[var(--border-subtle)] bg-white px-3 text-[11px] font-medium shadow-sm transition hover:bg-[var(--bg-secondary)] disabled:opacity-60"
                  >
                    <RefreshCw
                      size={13}
                      className={busy === "sync" ? "animate-spin" : ""}
                    />
                    Sync now
                  </button>
                ) : null}
                {overview?.admin ? (
                  <button
                    type="button"
                    onClick={() => setSettingsOpen(true)}
                    className="inline-flex h-8 items-center gap-2 rounded-[7px] border border-[var(--border-subtle)] bg-white px-3 text-[11px] font-medium shadow-sm transition hover:bg-[var(--bg-secondary)]"
                  >
                    <Settings2 size={13} />
                    Settings
                    <ChevronDown size={11} />
                  </button>
                ) : null}
              </div>
            </header>

            {integration ? (
              <div className="grid overflow-hidden rounded-[8px] border border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-elevated)_72%,transparent)] sm:grid-cols-3 lg:grid-cols-6">
                <SummaryMetric
                  label="Connection status"
                  value={integration.status.replaceAll("_", " ")}
                  detail={
                    integration.lastValidatedAt
                      ? `Validated ${relative(integration.lastValidatedAt)}`
                      : "Awaiting validation"
                  }
                  state={
                    integration.status === "connected" ? "good" : "warning"
                  }
                />
                <SummaryMetric
                  label="Connected school"
                  value={data?.school?.name ?? "Your school"}
                  detail="ManageBac"
                />
                <SummaryMetric
                  label="Last sync"
                  value={
                    integration.lastSyncAt
                      ? relative(integration.lastSyncAt)
                      : "Not yet"
                  }
                  detail={formatDate(integration.lastSyncAt)}
                />
                <SummaryMetric
                  label="Next sync"
                  value={relative(integration.nextSyncAt)}
                  detail={`Every ${integration.syncPolicy.frequencyMinutes} minutes`}
                />
                <SummaryMetric
                  label="Sync coverage"
                  value={`${coveragePercent}%`}
                  detail={`${coverage?.verifiedReadable ?? 0} of ${coverage?.discovered ?? 0} routes`}
                />
                <SummaryMetric
                  label="Conflicts"
                  value={String(data?.conflicts.length ?? 0)}
                  detail={
                    data?.conflicts.length
                      ? "Require review"
                      : "Nothing pending"
                  }
                  state={data?.conflicts.length ? "warning" : "good"}
                />
              </div>
            ) : (
              <div className="mb-1 rounded-[9px] border border-dashed border-[var(--border-strong)] bg-[color-mix(in_oklab,var(--bg-secondary)_45%,transparent)] px-5 py-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <span className="grid size-9 place-items-center rounded-lg bg-white text-[#39799e] shadow-sm">
                      <KeyRound size={16} />
                    </span>
                    <div>
                      <strong className="text-[13px] font-semibold">
                        {overview?.admin
                          ? "Connect your school’s read-only API"
                          : "Your school has not connected ManageBac"}
                      </strong>
                      <p className="mt-1 max-w-xl text-[11px] leading-5 text-[var(--text-tertiary)]">
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
                      className="inline-flex h-8 items-center gap-2 rounded-[7px] bg-[#20211e] px-3.5 text-[11px] font-medium text-white shadow-sm hover:bg-[#31322e]"
                    >
                      <Link2 size={13} />
                      Connect ManageBac
                    </button>
                  ) : null}
                </div>
              </div>
            )}

            <nav
              className="mt-4 flex min-w-0 gap-1 overflow-x-auto border-b border-[var(--border-subtle)]"
              aria-label="ManageBac sections"
            >
              {tabs.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  className={cn(
                    "relative h-10 shrink-0 px-2 text-[11px] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]",
                    tab === item.key &&
                      "font-medium text-[var(--text-primary)] after:absolute after:inset-x-1 after:bottom-0 after:h-[1.5px] after:bg-[var(--text-primary)]",
                  )}
                >
                  {item.label}
                  {item.key === "conflicts" && data?.conflicts.length ? (
                    <span className="ml-1.5 rounded bg-[#eee9ff] px-1.5 py-0.5 text-[9px] text-[#7258c5]">
                      {data.conflicts.length}
                    </span>
                  ) : null}
                </button>
              ))}
            </nav>

            <div className="min-h-[470px] py-4">
              {!integration ? (
                <EmptyState
                  icon={LockKeyhole}
                  title="Verified school data will appear here"
                  detail="Once an administrator connects the token and imports the tenant capability manifest, Spectra will resolve your identity without exposing alternative accounts."
                />
              ) : !overview?.admin && data?.mapping?.status !== "verified" ? (
                <div className="mx-auto flex min-h-[390px] max-w-lg flex-col items-center justify-center text-center">
                  <span className="grid size-12 place-items-center rounded-2xl bg-[#edf5ff] text-[#3b77a8]">
                    <UserCheck size={22} />
                  </span>
                  <h2 className="mt-4 font-[var(--font-serif)] text-xl font-medium">
                    Match your verified school account
                  </h2>
                  <p className="mt-2 text-[12px] leading-5 text-[var(--text-tertiary)]">
                    Spectra searches only for your authenticated school email,
                    accepts exactly one match, and never sends or reveals a
                    selectable student ID.
                  </p>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void runAction("identity", () =>
                        resolveSpectraManageBacIdentity(),
                      )
                    }
                    className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-[#20211e] px-4 text-[11px] font-medium text-white disabled:opacity-60"
                  >
                    {busy === "identity" ? (
                      <LoaderCircle className="animate-spin" size={14} />
                    ) : (
                      <Fingerprint size={14} />
                    )}
                    Resolve my school identity
                  </button>
                </div>
              ) : tab === "overview" ? (
                <div className="grid gap-3 xl:grid-cols-[.92fr_1.35fr_.92fr]">
                  <section className="rounded-[9px] border border-[var(--border-subtle)]">
                    <div className="flex items-center justify-between px-4 py-3">
                      <h2 className="text-[12px] font-semibold">
                        Importable classes
                      </h2>
                      <StatusPill state="blue">{classes.length}</StatusPill>
                    </div>
                    <div className="px-4 pb-3">
                      {classes.slice(0, 5).map((record) => (
                        <div
                          key={record._id}
                          className="flex items-center justify-between gap-2 py-2"
                        >
                          <div className="min-w-0">
                            <strong className="block truncate text-[11px] font-medium">
                              {recordTitle(record)}
                            </strong>
                            <span className="block truncate text-[9px] text-[var(--text-tertiary)]">
                              {recordSubtitle(record)}
                            </span>
                          </div>
                          <StatusPill
                            state={record.tombstone ? "danger" : "good"}
                          >
                            {record.tombstone ? "Removed" : "Ready"}
                          </StatusPill>
                        </div>
                      ))}
                      {!classes.length ? (
                        <p className="py-8 text-center text-[10px] text-[var(--text-tertiary)]">
                          No class records have synchronized yet.
                        </p>
                      ) : null}
                      {classes.length > 5 ? (
                        <button
                          type="button"
                          onClick={() => setTab("classes")}
                          className="mt-2 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                        >
                          + {classes.length - 5} more classes
                        </button>
                      ) : null}
                    </div>
                  </section>

                  <section className="rounded-[9px] border border-[var(--border-subtle)] p-4">
                    <h2 className="text-[12px] font-semibold">
                      Timetable preview
                    </h2>
                    <p className="mt-0.5 text-[9px] text-[var(--text-tertiary)]">
                      Source-owned times remain locked; personal overlays stay
                      private.
                    </p>
                    <div className="mt-4 grid grid-cols-[46px_repeat(5,minmax(58px,1fr))] overflow-hidden rounded-md border border-[var(--border-subtle)] text-[8px]">
                      <div className="bg-[var(--bg-secondary)]" />
                      {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day) => (
                        <div
                          key={day}
                          className="border-l border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-1 py-1.5 text-center font-medium"
                        >
                          {day}
                        </div>
                      ))}
                      {[8, 9, 10, 11].flatMap((hour) => [
                        <div
                          key={`time-${hour}`}
                          className="border-t border-[var(--border-subtle)] px-1 py-3 text-right text-[var(--text-tertiary)]"
                        >
                          {hour}:00
                        </div>,
                        ...[1, 2, 3, 4, 5].map((day) => {
                          const match = timetable.find((record) => {
                            const start = recordStart(record);
                            if (!start) return false;
                            const date = new Date(start);
                            return (
                              date.getDay() === day && date.getHours() === hour
                            );
                          });
                          return (
                            <div
                              key={`${hour}-${day}`}
                              className="min-h-10 border-l border-t border-[var(--border-subtle)] p-1"
                            >
                              {match ? (
                                <div className="h-full rounded bg-[#e6f4ec] px-1 py-1 text-[#326c58]">
                                  <span className="line-clamp-2">
                                    {recordTitle(match)}
                                  </span>
                                </div>
                              ) : null}
                            </div>
                          );
                        }),
                      ])}
                    </div>
                    <button
                      type="button"
                      onClick={() => setTab("timetable")}
                      className="mt-3 text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                    >
                      {timetable.length
                        ? `View all ${timetable.length} source events`
                        : "No source events yet"}
                    </button>
                  </section>

                  <section className="rounded-[9px] border border-[var(--border-subtle)]">
                    <div className="px-4 py-3">
                      <h2 className="text-[12px] font-semibold">
                        Tasks preview
                      </h2>
                      <p className="text-[9px] text-[var(--text-tertiary)]">
                        Upcoming source work
                      </p>
                    </div>
                    <div className="px-4 pb-3">
                      {tasks.slice(0, 5).map((record) => (
                        <div
                          key={record._id}
                          className="flex items-center gap-2 py-2"
                        >
                          <span className="grid size-5 shrink-0 place-items-center rounded bg-[#eef8f4] text-[#328269]">
                            <RecordIcon type={record.recordType} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <strong className="block truncate text-[10px] font-medium">
                              {recordTitle(record)}
                            </strong>
                            <span className="block truncate text-[8px] text-[var(--text-tertiary)]">
                              {recordSubtitle(record)}
                            </span>
                          </div>
                          <time className="text-[8px] text-[var(--text-tertiary)]">
                            {recordStart(record)
                              ? formatDate(recordStart(record), false)
                              : "—"}
                          </time>
                        </div>
                      ))}
                      {!tasks.length ? (
                        <p className="py-8 text-center text-[10px] text-[var(--text-tertiary)]">
                          No task records have synchronized yet.
                        </p>
                      ) : null}
                    </div>
                  </section>

                  <section className="rounded-[9px] border border-[var(--border-subtle)] xl:col-span-2">
                    <div className="px-4 py-3">
                      <h2 className="text-[12px] font-semibold">
                        Sync history
                      </h2>
                    </div>
                    <SyncTable runs={data?.syncRuns.slice(0, 5) ?? []} />
                    <button
                      type="button"
                      onClick={() => setTab("history")}
                      className="m-4 text-[9px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                    >
                      View full history
                    </button>
                  </section>

                  <section className="rounded-[9px] border border-[var(--border-subtle)]">
                    <div className="flex items-center justify-between px-4 py-3">
                      <h2 className="text-[12px] font-semibold">
                        Conflict review
                      </h2>
                      {data?.conflicts.length ? (
                        <StatusPill state="warning">
                          {data.conflicts.length}
                        </StatusPill>
                      ) : null}
                    </div>
                    <ConflictList
                      conflicts={(data?.conflicts ?? []).slice(0, 3)}
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
                    {!data?.conflicts.length ? (
                      <div className="flex items-center gap-2 px-4 pb-4 text-[10px] text-[var(--text-tertiary)]">
                        <CheckCircle2 size={13} className="text-[#2f9872]" />
                        Source and user overlays are aligned.
                      </div>
                    ) : null}
                  </section>
                </div>
              ) : tab === "classes" ? (
                <RecordsList
                  records={classes}
                  emptyTitle="No classes synchronized"
                  emptyDetail="Verified class capabilities will create one idempotent workspace per current class and academic period."
                />
              ) : tab === "timetable" ? (
                <RecordsList
                  records={timetable}
                  emptyTitle="No timetable source events"
                  emptyDetail="Verified lessons and calendar routes will populate locked source layers in your timetable artifact."
                />
              ) : tab === "tasks" ? (
                <RecordsList
                  records={tasks}
                  emptyTitle="No assignments or deadlines"
                  emptyDetail="Readable assignments, assessments, and deadlines appear as source-linked planner tasks without replacing personal notes."
                />
              ) : tab === "history" ? (
                <div className="overflow-hidden rounded-[9px] border border-[var(--border-subtle)]">
                  <SyncTable runs={data?.syncRuns ?? []} />
                </div>
              ) : tab === "conflicts" ? (
                <div className="rounded-[9px] border border-[var(--border-subtle)]">
                  {data?.conflicts.length ? (
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
                  )}
                </div>
              ) : (
                <ProvenancePanel
                  records={records}
                  capabilities={data?.capabilities ?? []}
                  quarantine={data?.quarantine ?? []}
                  identityQueue={data?.identityQueue ?? []}
                  onOpenManifest={() => setManifestOpen(true)}
                  admin={Boolean(overview?.admin)}
                />
              )}
            </div>
          </section>
        </div>
      </main>

      <aside className="hidden w-[286px] shrink-0 overflow-y-auto border-l border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-elevated)_55%,var(--bg-primary))] xl:block">
        <div className="sticky top-0 z-10 grid h-12 grid-cols-2 border-b border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-elevated)_88%,transparent)]">
          {(["details", "activity"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setDetailsTab(item)}
              className={cn(
                "relative text-[11px] capitalize text-[var(--text-tertiary)]",
                detailsTab === item &&
                  "font-medium text-[var(--text-primary)] after:absolute after:inset-x-5 after:bottom-0 after:h-[1.5px] after:bg-[var(--text-primary)]",
              )}
            >
              {item}
            </button>
          ))}
        </div>
        {detailsTab === "details" ? (
          <div className="space-y-2 p-3">
            <RightCard title="Integration">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg bg-[linear-gradient(145deg,#eef8fd,#e9eaff)] text-[#367ea8]">
                  <Network size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <strong className="block text-[11px] font-medium">
                    ManageBac
                  </strong>
                  <span className="block truncate text-[9px] text-[var(--text-tertiary)]">
                    {integration?.providerVersion
                      ? `Reference ${integration.providerVersion}`
                      : "Tenant-verified API"}
                  </span>
                </div>
                <StatusPill
                  state={
                    integration?.status === "connected" ? "good" : "warning"
                  }
                >
                  {integration?.status ?? "Not connected"}
                </StatusPill>
              </div>
            </RightCard>
            <RightCard title="Connected school">
              <div className="flex items-center gap-2.5">
                <School size={16} className="text-[#6e62d8]" />
                <div className="min-w-0">
                  <strong className="block truncate text-[11px] font-medium">
                    {data?.school?.name ?? "Your school"}
                  </strong>
                  <span className="text-[9px] text-[var(--text-tertiary)]">
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
                    ? `Every ${integration.syncPolicy.frequencyMinutes} min`
                    : "Not configured"
                }
              />
              <DetailRow
                icon={School}
                label="Auto-import new classes"
                value="Automatic"
                good
              />
              <DetailRow
                icon={ListChecks}
                label="Auto-import tasks"
                value="Automatic"
                good
              />
              <DetailRow
                icon={AlertCircle}
                label="Conflict resolution"
                value={
                  integration?.syncPolicy.conflictMode === "ask_me"
                    ? "Ask me"
                    : "Review"
                }
              />
              {overview?.admin ? (
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="mt-2 inline-flex items-center gap-2 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <Settings2 size={12} />
                  Edit settings
                </button>
              ) : null}
            </RightCard>
            <RightCard title="Data provenance">
              <p className="text-[10px] leading-4 text-[var(--text-secondary)]">
                Imported records retain source identity, contract version,
                refresh time, and tombstone state. User overlays remain
                separate.
              </p>
              <button
                type="button"
                onClick={() => setTab("provenance")}
                className="mt-2 text-[10px] text-[#3676b0]"
              >
                Review provenance
              </button>
            </RightCard>
            <RightCard title="Quick actions">
              <QuickAction
                icon={RefreshCw}
                label="Sync now"
                onClick={() =>
                  void runAction("sync", () => syncSpectraManageBac())
                }
                disabled={!integration || Boolean(busy)}
              />
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
                  className="flex h-8 items-center gap-2 rounded-md px-1 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
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
                <code className="block truncate text-[9px] text-[var(--text-secondary)]">
                  {integration._id}
                </code>
              </RightCard>
            ) : null}
          </div>
        ) : (
          <div className="p-3">
            <RightCard title="Recent sync activity">
              {(data?.syncRuns ?? []).slice(0, 8).map((run) => (
                <div
                  key={run._id}
                  className="flex gap-2 border-b border-[var(--border-subtle)] py-2.5 last:border-0"
                >
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--bg-secondary)]">
                    <History size={11} />
                  </span>
                  <div className="min-w-0">
                    <strong className="block text-[10px] font-medium capitalize">
                      {run.kind} sync {run.status.replaceAll("_", " ")}
                    </strong>
                    <span className="block text-[9px] text-[var(--text-tertiary)]">
                      {run.counts.created} added · {run.counts.updated} updated
                      · {relative(run.completedAt ?? run.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
              {!data?.syncRuns.length ? (
                <p className="py-4 text-[10px] text-[var(--text-tertiary)]">
                  No synchronization activity yet.
                </p>
              ) : null}
            </RightCard>
          </div>
        )}
      </aside>

      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-4 xl:right-[286px]">
        <div className="pointer-events-auto w-full max-w-[760px]">
          <CommandBar
            className="w-full"
            placeholder="Ask Spectra about permitted school data…"
            onSubmit={() => {
              setError(
                "The ManageBac assistant will use purpose-coded school-data tools through the Spectra composer once an AI run is started.",
              );
              return true;
            }}
            context={
              <span className="flex h-full min-w-[88px] items-center gap-2 px-3 text-[11px] font-semibold text-[var(--text-primary)]">
                <School className="size-3.5 shrink-0 text-[var(--brand-primary)]" />
                ManageBac
              </span>
            }
          />
        </div>
      </div>

      {settingsOpen ? (
        <SettingsDialog
          config={config}
          setConfig={setConfig}
          busy={busy === "configure"}
          connected={Boolean(integration)}
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

function SyncTable({ runs }: { runs: SpectraManageBacSyncRun[] }) {
  if (!runs.length)
    return (
      <EmptyState
        icon={FileClock}
        title="No synchronization history"
        detail="Bootstrap and later sync runs will show capability-level progress, counts, conflicts, and retryable failures here."
      />
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-left">
        <thead>
          <tr className="border-b border-[var(--border-subtle)] text-[9px] font-normal text-[var(--text-tertiary)]">
            <th className="px-4 py-2 font-normal">Date & time</th>
            <th className="px-3 py-2 font-normal">Status</th>
            <th className="px-3 py-2 font-normal">Imported</th>
            <th className="px-3 py-2 font-normal">Updated</th>
            <th className="px-3 py-2 font-normal">Conflicts</th>
            <th className="px-3 py-2 font-normal">Triggered by</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr
              key={run._id}
              className="border-b border-[var(--border-subtle)] last:border-0"
            >
              <td className="px-4 py-2.5 text-[10px]">
                {formatDate(run.completedAt ?? run.createdAt)}
              </td>
              <td className="px-3 py-2.5">
                <SyncStatus run={run} />
              </td>
              <td className="px-3 py-2.5 text-[10px]">{run.counts.created}</td>
              <td className="px-3 py-2.5 text-[10px]">{run.counts.updated}</td>
              <td className="px-3 py-2.5 text-[10px]">
                {run.counts.conflicts}
              </td>
              <td className="px-3 py-2.5 text-[10px] capitalize text-[var(--text-secondary)]">
                {run.kind}
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
    <div className="divide-y divide-[var(--border-subtle)]">
      {conflicts.map((conflict) => {
        const oldSource = object(conflict.oldSource);
        const nextSource = object(conflict.newSource);
        return (
          <article key={conflict._id} className="px-4 py-3">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[#fff3df] text-[#d17a21]">
                <AlertCircle size={12} />
              </span>
              <div className="min-w-0 flex-1">
                <strong className="block text-[11px] font-medium">
                  {conflict.kind.replaceAll("_", " ")}
                </strong>
                <p className="mt-1 text-[9px] leading-4 text-[var(--text-secondary)]">
                  {text(oldSource.title ?? oldSource.name, "The source record")}
                  {nextSource.title || nextSource.name
                    ? ` changed to “${text(nextSource.title ?? nextSource.name)}”.`
                    : " was removed or changed while your overlay was based on an older version."}
                </p>
                <span className="mt-1 block text-[8px] text-[var(--text-tertiary)]">
                  {conflict.projectionType.replaceAll("_", " ")} ·{" "}
                  {formatDate(conflict.createdAt)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => onResolve(conflict, "keep_overlay")}
                  className="h-7 rounded-md border border-[var(--border-subtle)] px-2 text-[9px] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                >
                  Keep mine
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => onResolve(conflict, "rebase")}
                  className="h-7 rounded-md bg-[#20211e] px-2.5 text-[9px] text-white hover:bg-[#30312d] disabled:opacity-50"
                >
                  Rebase
                </button>
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
  admin,
}: {
  records: SpectraManageBacRecord[];
  capabilities: SpectraManageBacCapability[];
  quarantine: NonNullable<SpectraManageBacOverview["data"]["quarantine"]>;
  identityQueue: NonNullable<SpectraManageBacOverview["data"]["identityQueue"]>;
  onOpenManifest: () => void;
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
    <div className="grid gap-3 lg:grid-cols-[1.4fr_.8fr]">
      <section className="overflow-hidden rounded-[9px] border border-[var(--border-subtle)]">
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
          <div>
            <h2 className="text-[12px] font-semibold">
              Verified capability manifest
            </h2>
            <p className="mt-0.5 text-[9px] text-[var(--text-tertiary)]">
              Only GET routes copied from the tenant API Manager become usable.
            </p>
          </div>
          {admin ? (
            <button
              type="button"
              onClick={onOpenManifest}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-2.5 text-[9px] hover:bg-[var(--bg-secondary)]"
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
              className="border-b border-[var(--border-subtle)] px-4 py-3 last:border-0"
            >
              <div className="mb-2 flex items-center justify-between">
                <strong className="text-[10px] uppercase tracking-[.08em] text-[var(--text-tertiary)]">
                  {category}
                </strong>
                <span className="text-[9px] text-[var(--text-tertiary)]">
                  {
                    rows.filter(
                      (item) => item.verificationStatus === "verified",
                    ).length
                  }
                  /{rows.length} verified
                </span>
              </div>
              <div className="space-y-1.5">
                {rows.map((capability) => (
                  <div
                    key={capability._id}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-md bg-[var(--bg-secondary)]/55 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <strong className="block truncate text-[10px] font-medium">
                        {capability.name}
                      </strong>
                      <span className="block truncate text-[8px] text-[var(--text-tertiary)]">
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
      <div className="space-y-3">
        <section className="rounded-[9px] border border-[var(--border-subtle)] p-4">
          <h2 className="text-[12px] font-semibold">Source guarantees</h2>
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
                "Only the authenticated verified school email may resolve an account.",
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
                    className="mt-0.5 shrink-0 text-[#367f67]"
                  />
                  <div>
                    <strong className="block text-[10px] font-medium">
                      {String(title)}
                    </strong>
                    <p className="mt-0.5 text-[9px] leading-4 text-[var(--text-tertiary)]">
                      {String(detail)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        <section className="rounded-[9px] border border-[var(--border-subtle)] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[12px] font-semibold">Quarantine</h2>
            <StatusPill state={quarantine.length ? "warning" : "good"}>
              {quarantine.length} open
            </StatusPill>
          </div>
          <p className="mt-2 text-[9px] leading-4 text-[var(--text-tertiary)]">
            Schema drift is isolated as a sanitized shape—never coerced into
            live records.
          </p>
          {quarantine.slice(0, 5).map((item) => (
            <div
              key={item._id}
              className="mt-2 rounded-md bg-[#fff7ed] px-3 py-2 text-[9px] text-[#995c22]"
            >
              <strong className="block font-medium">{item.reasonCode}</strong>
              <span>
                Contract {item.contractVersion} · {formatDate(item.createdAt)}
              </span>
            </div>
          ))}
        </section>
        {admin ? (
          <section className="rounded-[9px] border border-[var(--border-subtle)] p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[12px] font-semibold">Identity resolution</h2>
              <StatusPill state={identityQueue.length ? "warning" : "good"}>
                {identityQueue.length} needs attention
              </StatusPill>
            </div>
            <p className="mt-2 text-[9px] leading-4 text-[var(--text-tertiary)]">
              Admins see only the verified Spectra account and exact-match
              count—never alternate ManageBac identities or provider IDs.
            </p>
            {identityQueue.slice(0, 8).map((item) => (
              <div
                key={item.mappingId}
                className="mt-2 flex items-center gap-2 rounded-md bg-[var(--bg-secondary)]/60 px-3 py-2"
              >
                <UserCheck
                  size={13}
                  className="shrink-0 text-[var(--text-tertiary)]"
                />
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-[9px] font-medium">
                    {item.account?.name ?? "Unavailable account"}
                  </strong>
                  <span className="block truncate text-[8px] text-[var(--text-tertiary)]">
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
        <section className="rounded-[9px] border border-[var(--border-subtle)] p-4">
          <h2 className="text-[12px] font-semibold">Record provenance</h2>
          <p className="mt-2 text-[9px] leading-4 text-[var(--text-tertiary)]">
            {records.length} accessible normalized records. Raw provider
            payloads are not rendered here.
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--bg-secondary)]">
            <div
              className="h-full rounded-full bg-[#3a9b77]"
              style={{
                width: `${records.length ? Math.max(5, (records.filter((record) => !record.tombstone).length / records.length) * 100) : 0}%`,
              }}
            />
          </div>
        </section>
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
    <section className="rounded-[8px] border border-[var(--border-subtle)] p-3">
      <h3 className="mb-2.5 text-[9px] font-semibold uppercase tracking-[.1em] text-[var(--text-tertiary)]">
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
    <div className="flex h-7 items-center gap-2">
      <Icon size={12} className="text-[var(--text-tertiary)]" />
      <span className="min-w-0 flex-1 truncate text-[9px] text-[var(--text-secondary)]">
        {label}
      </span>
      <span
        className={cn(
          "shrink-0 text-[9px] text-[var(--text-secondary)]",
          good && "text-[#2d8b68]",
        )}
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
      className="flex h-8 w-full items-center gap-2 rounded-md px-1 text-left text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-45"
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  detail,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  detail: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2">
      <span className="min-w-0 flex-1">
        <strong className="block text-[11px] font-medium">{label}</strong>
        <span className="mt-0.5 block text-[9px] leading-4 text-[var(--text-tertiary)]">
          {detail}
        </span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span className="relative mt-0.5 h-5 w-9 rounded-full bg-[var(--border-strong)] transition peer-checked:bg-[#2f9670] after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-4" />
    </label>
  );
}

function SettingsDialog({
  config,
  setConfig,
  busy,
  connected,
  onClose,
  onSave,
  onManifest,
}: {
  config: {
    baseUrl: string;
    referenceUrl: string;
    authHeaderName: string;
    authScheme: "raw" | "bearer";
    token: string;
    frequencyMinutes: number;
    autoApplySafeUpdates: boolean;
    conflictMode: "review" | "ask_me";
  };
  setConfig: React.Dispatch<React.SetStateAction<typeof config>>;
  busy: boolean;
  connected: boolean;
  onClose: () => void;
  onSave: () => void;
  onManifest: () => void;
}) {
  const input =
    "h-9 w-full rounded-[7px] border border-[var(--border-subtle)] bg-white px-3 text-[11px] outline-none focus:border-[#7aa999] focus:ring-2 focus:ring-[#dceee7]";
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#1d211e]/25 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="ManageBac settings"
    >
      <div className="max-h-[92vh] w-full max-w-[620px] overflow-y-auto rounded-[13px] border border-white/70 bg-[#fbfaf8] shadow-[0_24px_80px_rgba(20,24,21,.25)]">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-[var(--border-subtle)] bg-[#fbfaf8]/95 px-5 py-4 backdrop-blur">
          <div>
            <h2 className="font-[var(--font-serif)] text-xl font-medium">
              ManageBac connection
            </h2>
            <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">
              Configure only values documented by your tenant API Manager.
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
        <div className="space-y-5 p-5">
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-[.1em] text-[var(--text-tertiary)]">
              Tenant API
            </h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-[10px] font-medium">
                  API base URL
                </span>
                <input
                  value={config.baseUrl}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      baseUrl: event.target.value,
                    }))
                  }
                  className={input}
                  placeholder="https://your-school.managebac.com/v2p2/"
                />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-[10px] font-medium">
                  Tenant reference URL
                </span>
                <input
                  value={config.referenceUrl}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      referenceUrl: event.target.value,
                    }))
                  }
                  className={input}
                  placeholder="API Manager reference documentation"
                />
              </label>
              <label>
                <span className="mb-1.5 block text-[10px] font-medium">
                  Authentication header
                </span>
                <input
                  value={config.authHeaderName}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      authHeaderName: event.target.value,
                    }))
                  }
                  className={input}
                  placeholder="From tenant reference"
                />
              </label>
              <label>
                <span className="mb-1.5 block text-[10px] font-medium">
                  Header value format
                </span>
                <select
                  value={config.authScheme}
                  onChange={(event) =>
                    setConfig((current) => ({
                      ...current,
                      authScheme:
                        event.target.value === "raw" ? "raw" : "bearer",
                    }))
                  }
                  className={input}
                >
                  <option value="bearer">Bearer token</option>
                  <option value="raw">Raw token</option>
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-[10px] font-medium">
                  Read-only school token
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
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
                      ? "Enter a replacement token to rotate the credential"
                      : "Stored encrypted; never returned to this browser"
                  }
                />
              </label>
            </div>
          </section>
          <section className="border-t border-[var(--border-subtle)] pt-4">
            <h3 className="text-[10px] font-semibold uppercase tracking-[.1em] text-[var(--text-tertiary)]">
              Synchronization policy
            </h3>
            <label className="mt-3 block">
              <span className="mb-1.5 block text-[10px] font-medium">
                Frequency
              </span>
              <select
                value={config.frequencyMinutes}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    frequencyMinutes: Number(event.target.value),
                  }))
                }
                className={input}
              >
                <option value={15}>Every 15 minutes</option>
                <option value={30}>Every 30 minutes</option>
                <option value={60}>Every hour</option>
                <option value={180}>Every 3 hours</option>
                <option value={360}>Every 6 hours</option>
                <option value={1440}>Daily</option>
              </select>
            </label>
            <div className="mt-3 rounded-[8px] border border-[#cfe5da] bg-[#f3f9f6] p-3 text-[10px] leading-4 text-[#426b5c]">
              Current classes and source-linked tasks are always imported for
              the verified user. This is an ordinary Spectra capability, not an
              administrator feature switch. Imported workspaces begin private,
              and later sync preserves personal customization.
            </div>
            <div className="mt-2 divide-y divide-[var(--border-subtle)]">
              <Toggle
                checked={config.autoApplySafeUpdates}
                onChange={(autoApplySafeUpdates) =>
                  setConfig((current) => ({
                    ...current,
                    autoApplySafeUpdates,
                  }))
                }
                label="Apply safe source updates"
                detail="Only source-controlled fields update automatically; customization overlap stops for review."
              />
            </div>
          </section>
          <section className="rounded-lg border border-[#cfe5da] bg-[#f1f8f5] p-3">
            <div className="flex gap-2">
              <ShieldCheck
                size={15}
                className="mt-0.5 shrink-0 text-[#2e8665]"
              />
              <p className="text-[10px] leading-4 text-[#426b5c]">
                Spectra will reject write routes, private-network hosts,
                redirects, unverified schemas, broad identity enumeration, and
                any client-supplied ManageBac user ID.
              </p>
            </div>
          </section>
        </div>
        <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[#fbfaf8]/95 px-5 py-3 backdrop-blur">
          <button
            type="button"
            onClick={onManifest}
            disabled={!connected}
            className="inline-flex h-8 items-center gap-2 rounded-[7px] border border-[var(--border-subtle)] px-3 text-[10px] hover:bg-[var(--bg-secondary)] disabled:opacity-45"
          >
            <Code2 size={12} />
            Capability manifest
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-[7px] px-3 text-[10px] hover:bg-[var(--bg-secondary)]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                busy ||
                !config.baseUrl ||
                !config.authHeaderName ||
                (!connected && config.token.length < 16) ||
                (config.token.length > 0 && config.token.length < 16)
              }
              onClick={onSave}
              className="inline-flex h-8 items-center gap-2 rounded-[7px] bg-[#20211e] px-3.5 text-[10px] font-medium text-white disabled:opacity-45"
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
      className="fixed inset-0 z-50 grid place-items-center bg-[#1d211e]/25 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Import capability manifest"
    >
      <div className="w-full max-w-[760px] overflow-hidden rounded-[13px] border border-white/70 bg-[#fbfaf8] shadow-[0_24px_80px_rgba(20,24,21,.25)]">
        <header className="flex items-start justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <div>
            <h2 className="font-[var(--font-serif)] text-xl font-medium">
              Verified capability manifest
            </h2>
            <p className="mt-1 max-w-xl text-[10px] leading-4 text-[var(--text-tertiary)]">
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
            className="h-[400px] w-full resize-none rounded-[9px] border border-[var(--border-subtle)] bg-[#20231f] p-4 font-mono text-[10px] leading-5 text-[#dce9df] outline-none focus:ring-2 focus:ring-[#bfd9cf]"
            placeholder={
              '{\n  "providerVersion": "tenant reference version",\n  "capabilities": [\n    {\n      "category": "Classes",\n      "name": "My classes",\n      "recordType": "class",\n      "path": "/verified/tenant/path",\n      "purpose": "Import the authenticated user’s current classes",\n      "scope": "personal",\n      "minimumRole": "student",\n      "pagination": "page",\n      "changeStrategy": "full_reconciliation",\n      "freshnessSlaMinutes": 120,\n      "contractVersion": "…",\n      "responseSchemaHash": "…",\n      "permissionState": "read_only",\n      "verificationStatus": "verified",\n      "routeSource": "tenant_reference",\n      "normalization": { "recordsPath": "…", "idPath": "…" }\n    }\n  ]\n}'
            }
          />
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-[#fff7ed] px-3 py-2.5 text-[9px] leading-4 text-[#8b5b2c]">
            <TriangleAlert className="mt-0.5 shrink-0" size={13} />
            Do not paste the API token, raw student responses, or copied payload
            contents. The manifest contains contracts and mappings only.
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-[var(--border-subtle)] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-[7px] px-3 text-[10px] hover:bg-[var(--bg-secondary)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !value.trim()}
            onClick={onImport}
            className="inline-flex h-8 items-center gap-2 rounded-[7px] bg-[#20211e] px-3.5 text-[10px] font-medium text-white disabled:opacity-45"
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
      className="fixed inset-0 z-[60] grid place-items-center bg-[#1d211e]/25 p-4 backdrop-blur-[2px]"
      role="alertdialog"
      aria-modal="true"
      aria-label="Disconnect ManageBac"
    >
      <div className="w-full max-w-[430px] rounded-[13px] border border-white/70 bg-[#fbfaf8] p-5 shadow-[0_24px_80px_rgba(20,24,21,.25)]">
        <span className="grid size-10 place-items-center rounded-xl bg-[#fff0ed] text-[#b54b3d]">
          <AlertTriangle size={18} />
        </span>
        <h2 className="mt-4 font-[var(--font-serif)] text-xl font-medium">
          Disconnect ManageBac?
        </h2>
        <p className="mt-2 text-[11px] leading-5 text-[var(--text-secondary)]">
          The server-side token will be revoked, scheduled runs will stop, and
          identity mappings will be cleared. Imported artifacts and user
          overlays remain intact with stale or removed-source provenance.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-8 rounded-[7px] px-3 text-[10px] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
          >
            Keep connected
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex h-8 items-center gap-2 rounded-[7px] bg-[#a94337] px-3.5 text-[10px] font-medium text-white disabled:opacity-50"
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
