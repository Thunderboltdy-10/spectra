"use client";

import Link from "next/link";
import {
  Archive,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  FileText,
  GraduationCap,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  School,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { CapabilityState } from "../core/capability-truth";
import {
  CapabilityTruthBadge,
  CapabilityTruthState,
} from "../integrations/status/capability-truth";

type Capability = {
  _id: string;
  category: string;
  name: string;
  recordType: string;
  purpose: string;
  verificationStatus: "verified" | "failed" | "quarantined" | "unverified";
  permissionState: string;
  freshnessSlaMinutes: number;
  lastVerifiedAt?: number;
  lastSuccessAt?: number;
  lastErrorCode?: string;
};

type RecordRow = {
  _id: string;
  recordType: string;
  normalized: Record<string, unknown>;
  fetchedAt: number;
  sourceModifiedAt?: number;
  provenanceUrl?: string;
  tombstone: boolean;
};

type SyncRun = {
  _id: string;
  status: string;
  stage: string;
  counts: {
    fetched: number;
    created: number;
    updated: number;
    projected: number;
    quarantined: number;
    errors: number;
  };
  errorCode?: string;
  errorSummary?: string;
  createdAt: number;
  completedAt?: number;
};

type ClassCandidate = {
  recordId: string;
  title: string;
  program: string;
  grade: string;
  workspaceId: string | null;
};

type SchoolPayload = {
  admin: boolean;
  integration: null | {
    status: string;
    lastSyncAt?: number;
    nextSyncAt?: number;
    freshnessSlaMinutes: number;
  };
  mapping: null | { status: string; updatedAt?: number };
  capabilities: Capability[];
  syncRuns: SyncRun[];
  records: RecordRow[];
  conflicts: unknown[];
  classes: ClassCandidate[];
};

type SectionKey =
  | "overview"
  | "classes"
  | "tasks"
  | "calendar"
  | "resources"
  | "discussions"
  | "feedback"
  | "cas"
  | "sync";

const sections: Array<{
  key: SectionKey;
  label: string;
  icon: typeof School;
  types: string[];
  categories: RegExp;
}> = [
  { key: "overview", label: "Overview", icon: School, types: [], categories: /./ },
  { key: "classes", label: "Classes", icon: Users, types: ["class", "course", "membership"], categories: /class|membership/i },
  { key: "tasks", label: "Tasks & deadlines", icon: ClipboardCheck, types: ["assignment", "deadline", "assessment", "task"], categories: /task|assignment|assessment|deadline/i },
  { key: "calendar", label: "Calendar", icon: CalendarDays, types: ["timetable", "timetable_event", "lesson", "class_event", "calendar_event"], categories: /timetable|calendar|lesson/i },
  { key: "resources", label: "Resources", icon: Archive, types: ["resource", "class_resource", "school_resource", "file"], categories: /resource|file/i },
  { key: "discussions", label: "Discussions & news", icon: MessageSquareText, types: ["discussion", "announcement", "message"], categories: /discussion|announcement|message/i },
  { key: "feedback", label: "Feedback & results", icon: GraduationCap, types: ["feedback", "result", "grade", "assessment_result"], categories: /feedback|result|grade/i },
  { key: "cas", label: "CAS", icon: Sparkles, types: ["cas", "cas_experience", "cas_reflection", "cas_evidence"], categories: /cas/i },
  { key: "sync", label: "Sync status", icon: RefreshCw, types: [], categories: /./ },
];

function text(value: unknown, fallback = "") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function timestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && !Number.isNaN(Date.parse(value)))
    return Date.parse(value);
  return undefined;
}

function formatDate(value?: number) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

async function manageBacPost(body: Record<string, unknown>) {
  const response = await fetch("/api/spectra/managebac", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(payload?.error?.message ?? "School refresh failed.");
  return payload.data ?? payload;
}

function stateFor(
  payload: SchoolPayload,
  section: (typeof sections)[number],
  records: RecordRow[],
): CapabilityState {
  if (!payload.integration) return { kind: "not_connected" };
  if (!payload.mapping || payload.mapping.status !== "verified")
    return { kind: "permission_denied" };
  const capabilities = payload.capabilities.filter(
    (capability) =>
      section.categories.test(capability.category) ||
      section.types.includes(capability.recordType),
  );
  if (!capabilities.length) return { kind: "unsupported" };
  if (capabilities.some((capability) => capability.verificationStatus === "quarantined"))
    return { kind: "schema_incompatible" };
  if (capabilities.every((capability) => capability.verificationStatus === "failed"))
    return {
      kind: "unavailable",
      retryable: true,
      message:
        capabilities.find((capability) => capability.lastErrorCode)?.lastErrorCode ??
        "The provider route failed.",
    };
  const successful = capabilities.filter(
    (capability) =>
      capability.verificationStatus === "verified" &&
      capability.permissionState === "read_only",
  );
  if (!successful.length) return { kind: "unsupported" };
  const lastSuccess = Math.max(
    payload.integration.lastSyncAt ?? 0,
    ...successful.map((capability) => capability.lastSuccessAt ?? 0),
  );
  const freshness = Math.min(
    ...successful.map((capability) => capability.freshnessSlaMinutes),
  );
  if (!lastSuccess)
    return {
      kind: "stale",
      updatedAt: 0,
      reason: "This verified capability has not completed its first sync.",
    };
  if (Date.now() - lastSuccess > freshness * 60_000)
    return {
      kind: "stale",
      updatedAt: lastSuccess,
      reason: "Cached records remain visible while a refresh is due.",
    };
  const partialCoverage = successful.some(
    (capability) => !capability.lastSuccessAt,
  );
  if (partialCoverage && records.length)
    return {
      kind: "partial",
      details: "Some verified routes have data while others have not completed.",
    };
  return { kind: "available", updatedAt: lastSuccess };
}

export function SchoolDataShell() {
  const [active, setActive] = useState<SectionKey>("overview");
  const [payload, setPayload] = useState<SchoolPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [overviewResponse, classesResponse] = await Promise.all([
        fetch("/api/spectra/managebac"),
        fetch("/api/spectra/managebac?action=myClasses"),
      ]);
      const overview = await overviewResponse.json();
      const classes = await classesResponse.json();
      if (!overviewResponse.ok)
        throw new Error(overview?.error?.message ?? "Could not load School.");
      const data = overview.data ?? {};
      setPayload({
        admin: overview.admin === true,
        integration: data.integration ?? null,
        mapping: data.mapping ?? null,
        capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
        syncRuns: Array.isArray(data.syncRuns) ? data.syncRuns : [],
        records: Array.isArray(data.records) ? data.records : [],
        conflicts: Array.isArray(data.conflicts) ? data.conflicts : [],
        classes: Array.isArray(classes?.data?.classes) ? classes.data.classes : [],
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load School.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    try {
      await action();
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "School action failed.");
    } finally {
      setBusy("");
    }
  }

  const liveRecords = useMemo(
    () => (payload?.records ?? []).filter((record) => !record.tombstone),
    [payload?.records],
  );
  const activeSection = sections.find((section) => section.key === active)!;
  const activeRecords = activeSection.types.length
    ? liveRecords.filter((record) => activeSection.types.includes(record.recordType))
    : liveRecords;
  const activeState = payload
    ? stateFor(payload, activeSection, activeRecords)
    : ({ kind: "refreshing" } as CapabilityState);

  return (
    <main className="spectra-wave-y flex h-full min-h-0 bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <aside className="hidden w-[230px] shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 md:block">
        <div className="flex items-center gap-2 px-2 py-2">
          <span className="grid size-9 place-items-center rounded-xl bg-[#173d33] text-[#dff4eb]"><School className="size-4" /></span>
          <div><strong className="block font-display text-[17px]">School</strong><span className="text-[9px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Living source</span></div>
        </div>
        <nav className="mt-5 space-y-1" aria-label="School sections">
          {sections.map((section) => {
            const Icon = section.icon;
            const records = section.types.length ? liveRecords.filter((record) => section.types.includes(record.recordType)) : liveRecords;
            const state = payload ? stateFor(payload, section, records) : { kind: "refreshing" as const };
            return <button key={section.key} type="button" onClick={() => setActive(section.key)} className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-medium", active === section.key ? "bg-[#173d33] text-white" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]")}><Icon className="size-3.5" /><span className="min-w-0 flex-1 truncate">{section.label}</span>{section.key !== "overview" && section.key !== "sync" ? <span className={cn("size-1.5 rounded-full", state.kind === "available" ? "bg-emerald-500" : state.kind === "stale" || state.kind === "partial" ? "bg-amber-500" : "bg-slate-300")} /> : null}</button>;
          })}
        </nav>
        <div className="absolute bottom-5 w-[198px] rounded-xl border border-[var(--border-default)] p-3"><p className="text-[10px] font-semibold">Provider truth</p><p className="mt-1 text-[9px] leading-4 text-[var(--text-tertiary)]">Errors, permissions, partial routes, and stale data remain visible instead of becoming empty lists.</p></div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[color-mix(in_oklab,var(--bg-primary)_92%,transparent)] px-5 py-4 backdrop-blur-xl lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><h1 className="font-display text-[25px] font-semibold tracking-[-0.025em]">{activeSection.label}</h1><CapabilityTruthBadge state={activeState} /></div><p className="mt-1 text-[11px] text-[var(--text-secondary)]">{payload?.integration ? `ManageBac · last success ${formatDate(payload.integration.lastSyncAt)}` : "No school source is connected"}</p></div><div className="flex items-center gap-2">{payload?.admin ? <Link href="/managebac" className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border-default)] px-3 text-[11px] font-semibold hover:bg-[var(--bg-hover)]"><ShieldCheck className="size-3.5" />Admin integration</Link> : null}<button type="button" disabled={Boolean(busy)} onClick={() => void run("sync", () => manageBacPost({ action: "resolveIdentity", bootstrap: true }))} className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#173d33] px-3.5 text-[11px] font-semibold text-white disabled:opacity-45">{busy === "sync" ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}Sync now</button></div></div>
          <div className="mt-3 flex gap-1 overflow-x-auto md:hidden">{sections.map((section) => <button key={section.key} type="button" onClick={() => setActive(section.key)} className={cn("whitespace-nowrap rounded-full px-3 py-1.5 text-[10px] font-semibold", active === section.key ? "bg-[#173d33] text-white" : "bg-[var(--bg-secondary)]")}>{section.label}</button>)}</div>
        </header>

        <div className="mx-auto max-w-[1180px] p-5 lg:p-8">
          {error ? <div role="alert" className="mb-4 rounded-xl border border-rose-600/20 bg-rose-500/8 px-4 py-3 text-[11px] text-rose-800">{error}</div> : null}
          {loading ? <div className="flex min-h-[360px] items-center justify-center gap-2 text-[11px] text-[var(--text-tertiary)]"><LoaderCircle className="size-4 animate-spin" />Loading verified school records…</div> : null}
          {!loading && payload ? <>
            <CapabilityTruthState state={activeState} title={activeSection.label} onRetry={() => void run("sync", () => manageBacPost({ action: "resolveIdentity", bootstrap: true }))} />
            {active === "overview" ? <Overview payload={payload} records={liveRecords} onSelect={setActive} /> : active === "classes" ? <Classes payload={payload} busy={busy} run={run} /> : active === "sync" ? <SyncStatus payload={payload} /> : <RecordSection section={activeSection} records={activeRecords} state={activeState} />}
          </> : null}
        </div>
      </div>
    </main>
  );
}

function Overview({ payload, records, onSelect }: { payload: SchoolPayload; records: RecordRow[]; onSelect: (key: SectionKey) => void }) {
  const upcoming = records
    .map((record) => ({ record, at: timestamp(record.normalized.dueAt ?? record.normalized.deadlineAt ?? record.normalized.startAt ?? record.normalized.start) }))
    .filter((item): item is { record: RecordRow; at: number } => item.at !== undefined && item.at >= Date.now() - 24 * 60 * 60_000)
    .sort((left, right) => left.at - right.at)
    .slice(0, 6);
  const metrics = [
    ["Classes", payload.classes.length, "classes" as const],
    ["Upcoming", upcoming.length, "tasks" as const],
    ["Resources", records.filter((record) => /resource|file/.test(record.recordType)).length, "resources" as const],
    ["Sync issues", payload.syncRuns[0]?.counts.errors ?? 0, "sync" as const],
  ];
  return <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_.9fr]"><section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Next from school</p><h2 className="mt-1 font-display text-[21px] font-semibold">Upcoming, with provenance</h2></div><Clock3 className="size-5 text-[var(--text-tertiary)]" /></div><div className="mt-4 divide-y divide-[var(--border-subtle)]">{upcoming.length ? upcoming.map(({ record, at }) => <RecordLine key={record._id} record={record} date={at} />) : <p className="py-10 text-center text-[11px] text-[var(--text-tertiary)]">No upcoming dated records in the synchronized capabilities.</p>}</div></section><div className="grid grid-cols-2 gap-3">{metrics.map(([label, value, key]) => <button key={String(label)} type="button" onClick={() => onSelect(key as SectionKey)} className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 text-left hover:border-emerald-700/25"><span className="text-[10px] text-[var(--text-tertiary)]">{String(label)}</span><strong className="mt-2 block font-display text-[27px]">{String(value)}</strong><span className="mt-3 flex items-center gap-1 text-[10px] font-semibold">Open <ChevronRight className="size-3" /></span></button>)}</div></div>;
}

function Classes({ payload, busy, run }: { payload: SchoolPayload; busy: string; run: (key: string, action: () => Promise<unknown>) => Promise<void> }) {
  return <section className="mt-4 overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]"><header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4"><div><h2 className="font-display text-[18px] font-semibold">Current classes</h2><p className="mt-1 text-[10px] text-[var(--text-tertiary)]">Creating a workspace is explicit, stable by source course ID, and safe across renames.</p></div><BookOpen className="size-4 text-[var(--text-tertiary)]" /></header>{payload.classes.length ? <ul className="divide-y divide-[var(--border-subtle)]">{payload.classes.map((item) => <li key={item.recordId} className="flex items-center gap-3 px-5 py-3"><span className="grid size-9 place-items-center rounded-xl bg-emerald-500/10 text-emerald-800"><GraduationCap className="size-4" /></span><div className="min-w-0 flex-1"><strong className="block truncate text-[12px]">{item.title}</strong><span className="text-[10px] text-[var(--text-tertiary)]">{[item.program, item.grade].filter(Boolean).join(" · ") || "Class source"}</span></div>{item.workspaceId ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700"><CheckCircle2 className="size-3.5" />Workspace linked</span> : <button type="button" disabled={Boolean(busy)} onClick={() => void run(`class:${item.recordId}`, () => manageBacPost({ action: "materializeClasses", recordIds: [item.recordId] }))} className="rounded-lg border border-[var(--border-default)] px-3 py-1.5 text-[10px] font-semibold hover:bg-[var(--bg-hover)] disabled:opacity-40">{busy === `class:${item.recordId}` ? "Creating…" : "Create workspace"}</button>}</li>)}</ul> : <p className="px-5 py-12 text-center text-[11px] text-[var(--text-tertiary)]">The class route completed with zero current records.</p>}</section>;
}

function RecordSection({ section, records, state }: { section: (typeof sections)[number]; records: RecordRow[]; state: CapabilityState }) {
  if (!records.length && state.kind !== "available") return null;
  return <section className="mt-4 overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]"><header className="border-b border-[var(--border-subtle)] px-5 py-4"><h2 className="font-display text-[18px] font-semibold">{records.length} {section.label.toLowerCase()} record{records.length === 1 ? "" : "s"}</h2><p className="mt-1 text-[10px] text-[var(--text-tertiary)]">Only normalized, permission-scoped provider data appears here.</p></header>{records.length ? <div className="divide-y divide-[var(--border-subtle)]">{records.map((record) => <RecordLine key={record._id} record={record} />)}</div> : <div className="px-5 py-14 text-center"><FileText className="mx-auto size-5 text-[var(--text-tertiary)]" /><p className="mt-2 text-[12px] font-semibold">No records exist in the latest successful sync</p><p className="mt-1 text-[10px] text-[var(--text-tertiary)]">This is a verified empty result, not a swallowed failure.</p></div>}</section>;
}

function RecordLine({ record, date }: { record: RecordRow; date?: number }) {
  const value = record.normalized;
  const title = text(value.title ?? value.name ?? value.subject, "Untitled school record");
  const subtitle = text(value.className ?? value.courseName ?? value.description ?? record.recordType, record.recordType);
  const at = date ?? timestamp(value.dueAt ?? value.deadlineAt ?? value.startAt ?? value.start);
  return <div className="flex items-center gap-3 px-5 py-3"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--bg-secondary)]"><FileText className="size-3.5 text-[var(--text-tertiary)]" /></span><div className="min-w-0 flex-1"><strong className="block truncate text-[11px]">{title}</strong><span className="block truncate text-[9px] text-[var(--text-tertiary)]">{subtitle}</span></div><div className="shrink-0 text-right"><span className="block text-[9px] font-semibold">{at ? formatDate(at) : "No precise time"}</span><span className="text-[8px] text-[var(--text-tertiary)]">fetched {formatDate(record.fetchedAt)}</span></div>{record.provenanceUrl ? <a href={record.provenanceUrl} target="_blank" rel="noreferrer" aria-label="Open provider source" className="grid size-7 place-items-center rounded-lg hover:bg-[var(--bg-hover)]"><ExternalLink className="size-3" /></a> : null}</div>;
}

function SyncStatus({ payload }: { payload: SchoolPayload }) {
  return <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_.8fr]"><section className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)]"><header className="border-b border-[var(--border-subtle)] px-5 py-4"><h2 className="font-display text-[18px] font-semibold">Capability ledger</h2></header><div className="divide-y divide-[var(--border-subtle)]">{payload.capabilities.map((capability) => { const state: CapabilityState = capability.verificationStatus === "verified" ? capability.lastSuccessAt ? { kind: "available", updatedAt: capability.lastSuccessAt } : { kind: "stale", updatedAt: 0 } : capability.verificationStatus === "quarantined" ? { kind: "schema_incompatible" } : capability.verificationStatus === "failed" ? { kind: "unavailable", retryable: true, message: capability.lastErrorCode ?? "Route failed" } : { kind: "unsupported" }; return <div key={capability._id} className="flex items-center gap-3 px-5 py-3"><div className="min-w-0 flex-1"><strong className="block truncate text-[11px]">{capability.name}</strong><span className="text-[9px] text-[var(--text-tertiary)]">{capability.recordType} · SLA {capability.freshnessSlaMinutes} min · last success {formatDate(capability.lastSuccessAt)}</span></div><CapabilityTruthBadge state={state} /></div>; })}</div></section><section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5"><h2 className="font-display text-[18px] font-semibold">Recent syncs</h2><div className="mt-3 space-y-2">{payload.syncRuns.slice(0, 8).map((run) => <div key={run._id} className="rounded-xl border border-[var(--border-subtle)] p-3"><div className="flex items-center justify-between"><strong className="text-[10px]">{run.stage}</strong><span className="text-[9px] font-semibold">{run.status}</span></div><p className="mt-1 text-[9px] text-[var(--text-tertiary)]">{run.counts.fetched} received · {run.counts.projected} projected · {run.counts.quarantined} quarantined · {run.counts.errors} errors</p>{run.errorSummary ? <p className="mt-1 text-[9px] text-rose-700">{run.errorSummary}</p> : null}</div>)}</div></section></div>;
}
