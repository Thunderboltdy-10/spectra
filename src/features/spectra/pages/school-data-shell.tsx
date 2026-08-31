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
  PenLine,
  RefreshCw,
  School,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useSpectraRun } from "../ai/use-spectra-run";
import {
  AuxiliaryRail,
  AuxiliaryRailTrigger,
} from "../components/auxiliary-rail";
import { ProductPageHeader } from "../components/product-page-header";
import { ProductSectionNav } from "../components/product-section-nav";
import type { CapabilityState } from "../core/capability-truth";
import {
  CapabilityTruthBadge,
  CapabilityTruthState,
} from "../integrations/status/capability-truth";
import { syncSpectraManageBac } from "../data/api";
import { spectraBus } from "../events";

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

type CasStrand = "creativity" | "activity" | "service";

type CasExperience = {
  recordId: string;
  providerRecordId: string;
  title: string;
  description: string;
  status: string;
  startAt?: number;
  endAt?: number;
  strands: Record<CasStrand, boolean>;
  hours: Partial<Record<CasStrand, number>>;
  targetHours?: Partial<Record<CasStrand | "total", number>>;
  linkedReflections: Array<{
    artifactId: string;
    title: string;
    summary?: string;
    status: string;
    updatedAt: number;
  }>;
  fetchedAt: number;
  sourceModifiedAt?: number;
  provenanceUrl?: string;
};

type CasPayload = {
  connected: boolean;
  identityRequired: boolean;
  stale: boolean;
  experiences: CasExperience[];
  lastSyncAt?: number;
  boundary: {
    experiences: { sync: string };
    reflections: { sync: string; providerPath: null };
    evidence: { sync: string; providerPath: null };
  };
};

type CasDraftTarget = { artifactId: string; prompt: string };

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
  cas: CasPayload;
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
  {
    key: "overview",
    label: "Overview",
    icon: School,
    types: [],
    categories: /./,
  },
  {
    key: "classes",
    label: "Classes",
    icon: Users,
    types: ["class", "course", "membership"],
    categories: /class|membership/i,
  },
  {
    key: "tasks",
    label: "Tasks & deadlines",
    icon: ClipboardCheck,
    types: ["assignment", "deadline", "assessment", "task"],
    categories: /task|assignment|assessment|deadline/i,
  },
  {
    key: "calendar",
    label: "Calendar",
    icon: CalendarDays,
    types: [
      "timetable",
      "timetable_event",
      "lesson",
      "class_event",
      "calendar_event",
    ],
    categories: /timetable|calendar|lesson/i,
  },
  {
    key: "resources",
    label: "Resources",
    icon: Archive,
    types: ["resource", "class_resource", "school_resource", "file"],
    categories: /resource|file/i,
  },
  {
    key: "discussions",
    label: "Discussions & news",
    icon: MessageSquareText,
    types: ["discussion", "announcement", "message"],
    categories: /discussion|announcement|message/i,
  },
  {
    key: "feedback",
    label: "Feedback & results",
    icon: GraduationCap,
    types: ["feedback", "result", "grade", "assessment_result"],
    categories: /feedback|result|grade/i,
  },
  {
    key: "cas",
    label: "CAS",
    icon: Sparkles,
    types: ["cas", "cas_experience", "cas_reflection", "cas_evidence"],
    categories: /cas/i,
  },
  {
    key: "sync",
    label: "Sync status",
    icon: RefreshCw,
    types: [],
    categories: /./,
  },
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

function formatDay(value?: number) {
  if (!value) return "Not supplied";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}

function humanize(value: string) {
  if (!value || value === "status_not_supplied") return "Status not supplied";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
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

function CasDraftRunner({
  target,
  onFailure,
}: {
  target: CasDraftTarget;
  onFailure: (message: string) => void;
}) {
  const started = useRef(false);
  const runEngine = useSpectraRun({
    surface: "artifact",
    artifactId: target.artifactId,
    focusMode: "artifact",
    currentView: "school-data",
    observeDurableRuns: false,
    onOpenArtifact: async (workId) => {
      await spectraBus.command("work.open", { workId, surface: "panel" });
    },
  });

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runEngine.run(target.prompt).then((accepted) => {
      if (!accepted)
        onFailure(
          "The reflection document was created, but Spectra could not start the drafting run.",
        );
    });
  }, [onFailure, runEngine, target.prompt]);

  return null;
}

function stateFor(
  payload: SchoolPayload,
  section: (typeof sections)[number],
  records: RecordRow[],
): CapabilityState {
  if (!payload.integration) return { kind: "not_connected" };
  // School administrators read the school-wide verified projection. A
  // personal provider identity mapping is required only for member-scoped
  // views; treating its absence as a blanket denial hid data from the very
  // people responsible for the integration.
  if (
    !payload.admin &&
    (!payload.mapping || payload.mapping.status !== "verified")
  )
    return { kind: "permission_denied" };
  const capabilities = payload.capabilities.filter(
    (capability) =>
      section.categories.test(capability.category) ||
      section.types.includes(capability.recordType),
  );
  if (!capabilities.length) return { kind: "unsupported" };
  const quarantined = capabilities.filter(
    (capability) => capability.verificationStatus === "quarantined",
  );
  const successful = capabilities.filter(
    (capability) =>
      capability.verificationStatus === "verified" &&
      capability.permissionState === "read_only",
  );
  if (!successful.length) {
    if (quarantined.length) return { kind: "schema_incompatible" };
    if (
      capabilities.every(
        (capability) => capability.verificationStatus === "failed",
      )
    )
      return {
        kind: "unavailable",
        retryable: true,
        message:
          capabilities.find((capability) => capability.lastErrorCode)
            ?.lastErrorCode ?? "The provider route failed.",
      };
    return { kind: "unsupported" };
  }
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
  if (quarantined.length)
    return {
      kind: "partial",
      details: `${successful.length} verified route${successful.length === 1 ? " is" : "s are"} available; ${quarantined.length} changed provider route${quarantined.length === 1 ? " is" : "s are"} quarantined.`,
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
      details:
        "Some verified routes have data while others have not completed.",
    };
  return { kind: "available", updatedAt: lastSuccess };
}

export function SchoolDataShell() {
  const [active, setActive] = useState<SectionKey>("overview");
  const [payload, setPayload] = useState<SchoolPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [casDraftTarget, setCasDraftTarget] = useState<CasDraftTarget | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [overviewResponse, classesResponse, casResponse] =
        await Promise.all([
          fetch("/api/spectra/managebac"),
          fetch("/api/spectra/managebac?action=myClasses"),
          fetch("/api/spectra/managebac?action=cas"),
        ]);
      const overview = await overviewResponse.json();
      const classes = await classesResponse.json();
      const cas = await casResponse.json();
      if (!overviewResponse.ok)
        throw new Error(overview?.error?.message ?? "Could not load School.");
      if (!casResponse.ok)
        throw new Error(
          cas?.error?.message ?? "Could not load CAS experiences.",
        );
      const data = overview.data ?? {};
      setPayload({
        admin: overview.admin === true,
        integration: data.integration ?? null,
        mapping: data.mapping ?? null,
        capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
        syncRuns: Array.isArray(data.syncRuns) ? data.syncRuns : [],
        records: Array.isArray(data.records) ? data.records : [],
        conflicts: Array.isArray(data.conflicts) ? data.conflicts : [],
        classes: Array.isArray(classes?.data?.classes)
          ? classes.data.classes
          : [],
        cas: {
          connected: cas?.data?.connected === true,
          identityRequired: cas?.data?.identityRequired === true,
          stale: cas?.data?.stale !== false,
          experiences: Array.isArray(cas?.data?.experiences)
            ? cas.data.experiences
            : [],
          lastSyncAt: cas?.data?.lastSyncAt,
          boundary: cas?.data?.boundary ?? {
            experiences: { sync: "verified" },
            reflections: {
              sync: "spectra_native_only",
              providerPath: null,
            },
            evidence: { sync: "not_available", providerPath: null },
          },
        },
      });
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Could not load School.",
      );
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
      setError(
        nextError instanceof Error
          ? nextError.message
          : "School action failed.",
      );
    } finally {
      setBusy("");
    }
  }

  async function createCasReflection(recordId: string, draftWithAi: boolean) {
    const key = `cas:${recordId}:${draftWithAi ? "ai" : "manual"}`;
    setBusy(key);
    setError("");
    try {
      const result = (await manageBacPost({
        action: "createCasReflection",
        recordId,
      })) as { artifactId?: string; prompt?: string };
      if (!result.artifactId)
        throw new Error("The reflection document could not be created.");
      await spectraBus.command("work.open", {
        workId: result.artifactId,
        surface: "panel",
      });
      if (draftWithAi) {
        if (!result.prompt)
          throw new Error(
            "The reflection was created, but its drafting context is unavailable.",
          );
        setCasDraftTarget({
          artifactId: result.artifactId,
          prompt: result.prompt,
        });
      }
      await load();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "The CAS reflection could not be created.",
      );
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
    ? liveRecords.filter((record) =>
        activeSection.types.includes(record.recordType),
      )
    : liveRecords;
  const activeState = payload
    ? stateFor(payload, activeSection, activeRecords)
    : ({ kind: "refreshing" } as CapabilityState);

  return (
    <main className="spectra-wave-y h-full min-h-0 overflow-y-auto bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {casDraftTarget ? (
        <CasDraftRunner
          key={casDraftTarget.artifactId}
          target={casDraftTarget}
          onFailure={setError}
        />
      ) : null}
      <div className="w-full px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
        <ProductPageHeader
          title="School"
          description="Classes, deadlines, resources, and synchronization state from your school."
        />
        <div className="mt-5 min-w-0">
          <ProductSectionNav
            label="School sections"
            items={sections.map(({ key, label, icon }) => ({
              key,
              label,
              icon,
            }))}
            active={active}
            onChange={setActive}
          />
          <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate font-display text-[20px] font-semibold tracking-[-0.02em]">
                  {activeSection.label}
                </h2>
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                {payload?.integration
                  ? `ManageBac · last success ${formatDate(payload.integration.lastSyncAt)}`
                  : "No school source is connected"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {payload?.admin ? (
                <Link
                  href="/managebac"
                  className="inline-flex size-9 items-center justify-center rounded-lg border border-[var(--border-default)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  aria-label="Open ManageBac integration"
                  title="ManageBac integration"
                >
                  <ShieldCheck className="size-3.5" />
                </Link>
              ) : null}
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void run("sync", () => syncSpectraManageBac())}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--text-primary)] px-3.5 text-[11px] font-semibold text-[var(--bg-primary)] disabled:opacity-45"
              >
                {busy === "sync" ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Sync now
              </button>
            </div>
          </header>

          <div>
            {error ? (
              <div
                role="alert"
                className="mb-4 rounded-xl border border-rose-600/20 bg-rose-500/8 px-4 py-3 text-[11px] text-rose-800"
              >
                {error}
              </div>
            ) : null}
            {loading ? (
              <div className="flex min-h-[360px] items-center justify-center gap-2 text-[11px] text-[var(--text-tertiary)]">
                <LoaderCircle className="size-4 animate-spin" />
                Loading verified school records…
              </div>
            ) : null}
            {!loading && payload ? (
              <>
                {activeState.kind === "partial" ? (
                  <div className="flex items-center gap-2 rounded-[8px] px-1 py-2 text-[11px] text-[var(--text-secondary)]">
                    <Clock3 className="size-3.5 shrink-0 text-amber-700" />
                    <span className="min-w-0 flex-1">
                      {activeState.details}
                    </span>
                    {payload.admin ? (
                      <Link
                        href="/managebac?section=provenance"
                        className="font-medium text-[var(--text-primary)] hover:underline"
                      >
                        Review sync
                      </Link>
                    ) : null}
                  </div>
                ) : (
                  <CapabilityTruthState
                    state={activeState}
                    title={activeSection.label}
                    onRetry={() =>
                      void run("sync", () => syncSpectraManageBac())
                    }
                  />
                )}
                {active === "overview" ? (
                  <Overview
                    payload={payload}
                    records={liveRecords}
                    onSelect={setActive}
                  />
                ) : active === "classes" ? (
                  <Classes payload={payload} busy={busy} run={run} />
                ) : active === "sync" ? (
                  <SyncStatus payload={payload} />
                ) : active === "cas" ? (
                  <CasSection
                    overview={payload.cas}
                    state={activeState}
                    busy={busy}
                    onCreate={createCasReflection}
                  />
                ) : (
                  <RecordSection
                    section={activeSection}
                    records={activeRecords}
                    state={activeState}
                  />
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

function Overview({
  payload,
  records,
  onSelect,
}: {
  payload: SchoolPayload;
  records: RecordRow[];
  onSelect: (key: SectionKey) => void;
}) {
  const [contextOpen, setContextOpen] = useState(true);
  const upcoming = records
    .map((record) => ({
      record,
      at: timestamp(
        record.normalized.dueAt ??
          record.normalized.deadlineAt ??
          record.normalized.startAt ??
          record.normalized.start,
      ),
    }))
    .filter(
      (item): item is { record: RecordRow; at: number } =>
        item.at !== undefined && item.at >= Date.now() - 24 * 60 * 60_000,
    )
    .sort((left, right) => left.at - right.at)
    .slice(0, 6);
  const recent = [...records]
    .sort((left, right) => right.fetchedAt - left.fetchedAt)
    .slice(0, 5);
  const metrics = [
    ["Classes", payload.classes.length, "classes" as const],
    ["Upcoming", upcoming.length, "tasks" as const],
    [
      "Resources",
      records.filter((record) => /resource|file/.test(record.recordType))
        .length,
      "resources" as const,
    ],
    ["Sync issues", payload.syncRuns[0]?.counts.errors ?? 0, "sync" as const],
  ];
  return (
    <div
      className={cn(
        "mt-5 grid min-h-[360px] gap-6",
        contextOpen && "lg:grid-cols-[minmax(0,1fr)_auto]",
      )}
    >
      <section className="min-w-0 py-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-micro font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              Next from school
            </p>
            <h2 className="mt-1 font-display text-[21px] font-semibold">
              {upcoming.length ? "Upcoming" : "Recently synchronized"}
            </h2>
          </div>
          {!contextOpen ? (
            <AuxiliaryRailTrigger
              label="School summary"
              onOpen={() => setContextOpen(true)}
            />
          ) : null}
        </div>
        {upcoming.length ? (
          <div className="mt-4 space-y-1">
            {upcoming.map(({ record, at }) => (
              <RecordLine key={record._id} record={record} date={at} />
            ))}
          </div>
        ) : recent.length ? (
          <>
            <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
              Nothing is currently due. These are the latest verified records
              received from school.
            </p>
            <div className="mt-4 space-y-1">
              {recent.map((record) => (
                <RecordLine key={record._id} record={record} />
              ))}
            </div>
          </>
        ) : payload.classes.length ? (
          // Records did arrive; none of them carry a date. That is a school
          // with nothing scheduled, not a school with no data, and saying
          // otherwise contradicts the Classes section directly.
          <div className="mt-6 rounded-[10px] bg-[var(--bg-secondary)] px-5 py-7">
            <p className="text-[13px] font-medium">Nothing is scheduled</p>
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
              {payload.classes.length} verified{" "}
              {payload.classes.length === 1 ? "class" : "classes"} arrived from
              school. None of them currently have a deadline or an upcoming item
              attached.
            </p>
            <button
              type="button"
              onClick={() => onSelect("classes")}
              className="mt-4 text-[11px] font-medium text-[var(--text-primary)] hover:underline"
            >
              View classes
            </button>
          </div>
        ) : (
          <div className="mt-6 rounded-[10px] bg-[var(--bg-secondary)] px-5 py-7">
            <p className="text-[13px] font-medium">
              No school records have arrived yet
            </p>
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
              Run a sync or review provider coverage to bring verified classes
              and deadlines into Spectra.
            </p>
            <button
              type="button"
              onClick={() => onSelect("sync")}
              className="mt-4 text-[11px] font-medium text-[var(--text-primary)] hover:underline"
            >
              Review sync status
            </button>
          </div>
        )}
      </section>
      {contextOpen ? (
        <AuxiliaryRail
          label="At a glance"
          onClose={() => setContextOpen(false)}
        >
          <div className="space-y-1 p-3">
            {metrics.map(([label, value, key]) => (
              <button
                key={String(label)}
                type="button"
                onClick={() => onSelect(key as SectionKey)}
                className="flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left hover:bg-[var(--bg-hover)]"
              >
                <span className="min-w-0 flex-1 text-[12px] text-[var(--text-secondary)]">
                  {String(label)}
                </span>
                <strong className="font-display text-[20px] font-semibold">
                  {String(value)}
                </strong>
                <ChevronRight className="size-3 text-[var(--text-tertiary)]" />
              </button>
            ))}
          </div>
        </AuxiliaryRail>
      ) : null}
    </div>
  );
}

function Classes({
  payload,
  busy,
  run,
}: {
  payload: SchoolPayload;
  busy: string;
  run: (key: string, action: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <section className="mt-5">
      <header className="flex items-center justify-between px-1 py-3">
        <div>
          <h2 className="font-display text-[18px] font-semibold">
            Current classes
          </h2>
          <p className="mt-1 text-micro text-[var(--text-tertiary)]">
            Creating a workspace is explicit, stable by source course ID, and
            safe across renames.
          </p>
        </div>
        <BookOpen className="size-4 text-[var(--text-tertiary)]" />
      </header>
      {payload.classes.length ? (
        <ul className="space-y-1">
          {payload.classes.map((item) => (
            <li
              key={item.recordId}
              className="flex items-center gap-3 rounded-[10px] px-3 py-3 transition-colors hover:bg-[var(--bg-secondary)]"
            >
              <GraduationCap className="size-4 shrink-0 text-emerald-800" />
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-[12px]">
                  {item.title}
                </strong>
                <span className="text-micro text-[var(--text-tertiary)]">
                  {[item.program, item.grade].filter(Boolean).join(" · ") ||
                    "Class source"}
                </span>
              </div>
              {item.workspaceId ? (
                <span className="inline-flex items-center gap-1 text-micro font-semibold text-emerald-700">
                  <CheckCircle2 className="size-3.5" />
                  Workspace linked
                </span>
              ) : (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run(`class:${item.recordId}`, () =>
                      manageBacPost({
                        action: "materializeClasses",
                        recordIds: [item.recordId],
                      }),
                    )
                  }
                  className="rounded-[8px] border border-[var(--border-default)] px-3 py-1.5 text-micro font-semibold hover:bg-[var(--bg-hover)] disabled:opacity-40"
                >
                  {busy === `class:${item.recordId}`
                    ? "Creating…"
                    : "Create workspace"}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-12 text-center text-[11px] text-[var(--text-tertiary)]">
          The class route completed with zero current records.
        </p>
      )}
    </section>
  );
}

function CasSection({
  overview,
  state,
  busy,
  onCreate,
}: {
  overview: CasPayload;
  state: CapabilityState;
  busy: string;
  onCreate: (recordId: string, draftWithAi: boolean) => Promise<void>;
}) {
  const [strand, setStrand] = useState<"all" | CasStrand>("all");
  const experiences = useMemo(
    () =>
      strand === "all"
        ? overview.experiences
        : overview.experiences.filter(
            (experience) => experience.strands[strand],
          ),
    [overview.experiences, strand],
  );
  const filters: Array<{ key: "all" | CasStrand; label: string }> = [
    { key: "all", label: "All experiences" },
    { key: "creativity", label: "Creativity" },
    { key: "activity", label: "Activity" },
    { key: "service", label: "Service" },
  ];

  return (
    <section className="mt-5">
      <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--text-secondary)]" />
          <div>
            <strong className="block text-[11px]">Where CAS data lives</strong>
            <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[var(--text-secondary)]">
              ManageBac supplies the experiences shown here. Its reflection and
              evidence routes are not verified, so reflections created here stay
              in Spectra and attachments are not synced back.
            </p>
          </div>
        </div>
      </div>

      {overview.identityRequired ? (
        <div className="mt-4 rounded-[10px] bg-[var(--bg-secondary)] px-5 py-7">
          <p className="text-[13px] font-medium">
            Connect your student identity
          </p>
          <p className="mt-1 max-w-xl text-[11px] text-[var(--text-secondary)]">
            CAS experiences are personal school records. Verify your ManageBac
            identity before viewing or linking reflections.
          </p>
        </div>
      ) : null}

      {!overview.identityRequired &&
      overview.experiences.length === 0 &&
      state.kind === "available" ? (
        <div className="mt-4 rounded-[10px] bg-[var(--bg-secondary)] px-5 py-7">
          <p className="text-[13px] font-medium">
            No CAS experiences in the latest sync
          </p>
          <p className="mt-1 max-w-xl text-[11px] text-[var(--text-secondary)]">
            The verified experience route completed and returned no current
            experiences for this student.
          </p>
        </div>
      ) : null}

      {overview.experiences.length ? (
        <>
          <div
            className="mt-5 flex flex-wrap gap-2"
            role="group"
            aria-label="Filter CAS experiences by strand"
          >
            {filters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                aria-pressed={strand === filter.key}
                onClick={() => setStrand(filter.key)}
                className={cn(
                  "h-8 rounded-lg border px-3 text-[11px] font-medium transition-colors active:translate-y-px",
                  strand === filter.key
                    ? "border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-primary)]"
                    : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <p className="mt-4 px-1 text-[11px] text-[var(--text-secondary)]">
            {experiences.length} experience{experiences.length === 1 ? "" : "s"}
            {strand === "all" ? "" : ` in ${humanize(strand)}`}
          </p>

          {experiences.length ? (
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
              {experiences.map((experience) => {
                const manualKey = `cas:${experience.recordId}:manual`;
                const aiKey = `cas:${experience.recordId}:ai`;
                const strands: Array<{ key: CasStrand; label: string }> = [
                  { key: "creativity", label: "Creativity" },
                  { key: "activity", label: "Activity" },
                  { key: "service", label: "Service" },
                ];
                return (
                  <article
                    key={experience.recordId}
                    className="flex min-w-0 flex-col rounded-[10px] bg-[var(--bg-secondary)] p-4"
                  >
                    <header className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="font-display text-[15px] font-semibold tracking-[-0.01em]">
                          {experience.title}
                        </h3>
                        <p className="mt-1 text-micro font-medium text-[var(--text-tertiary)]">
                          {humanize(experience.status)}
                        </p>
                      </div>
                      {experience.provenanceUrl ? (
                        <a
                          href={experience.provenanceUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open the ManageBac source for ${experience.title}`}
                          className="grid size-8 shrink-0 place-items-center rounded-[8px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      ) : null}
                    </header>

                    {experience.description ? (
                      <p className="mt-3 line-clamp-3 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                        {experience.description}
                      </p>
                    ) : null}

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      {strands.map((item) => {
                        const hours = experience.hours[item.key];
                        const target = experience.targetHours?.[item.key];
                        return (
                          <div
                            key={item.key}
                            className={cn(
                              "min-w-0 rounded-[8px] border px-2.5 py-2",
                              experience.strands[item.key]
                                ? "border-[var(--border-default)]"
                                : "border-transparent opacity-55",
                            )}
                          >
                            <span className="block truncate text-micro text-[var(--text-tertiary)]">
                              {item.label}
                            </span>
                            <strong className="mt-0.5 block text-[12px]">
                              {hours === undefined
                                ? "Not supplied"
                                : `${hours}h`}
                            </strong>
                            {target !== undefined ? (
                              <span className="block text-micro text-[var(--text-tertiary)]">
                                Target {target}h
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-3 text-[11px]">
                      <div>
                        <dt className="text-micro text-[var(--text-tertiary)]">
                          Started
                        </dt>
                        <dd className="mt-0.5 font-medium">
                          {formatDay(experience.startAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-micro text-[var(--text-tertiary)]">
                          Target date
                        </dt>
                        <dd className="mt-0.5 font-medium">
                          {formatDay(experience.endAt)}
                        </dd>
                      </div>
                    </dl>

                    {experience.linkedReflections.length ? (
                      <div className="mt-4 border-t border-[var(--border-default)] pt-3">
                        <p className="text-micro font-semibold text-[var(--text-tertiary)]">
                          Reflections in Spectra
                        </p>
                        <div className="mt-2 space-y-1">
                          {experience.linkedReflections.map((reflection) => (
                            <button
                              key={reflection.artifactId}
                              type="button"
                              onClick={() =>
                                void spectraBus.command("work.open", {
                                  workId: reflection.artifactId,
                                  surface: "panel",
                                })
                              }
                              className="flex w-full items-center gap-2 rounded-[8px] px-2 py-2 text-left hover:bg-[var(--bg-hover)]"
                            >
                              <FileText className="size-3.5 shrink-0 text-[var(--text-tertiary)]" />
                              <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                                {reflection.title}
                              </span>
                              <ChevronRight className="size-3.5 shrink-0 text-[var(--text-tertiary)]" />
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-auto flex flex-wrap gap-2 pt-4">
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void onCreate(experience.recordId, false)
                        }
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border-default)] px-3 text-[11px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)] active:translate-y-px disabled:opacity-45"
                      >
                        {busy === manualKey ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <PenLine className="size-3.5" />
                        )}
                        Create reflection
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void onCreate(experience.recordId, true)}
                        className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--text-primary)] px-3 text-[11px] font-semibold text-[var(--bg-primary)] active:translate-y-px disabled:opacity-45"
                      >
                        {busy === aiKey ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="size-3.5" />
                        )}
                        Draft with Spectra
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-[10px] bg-[var(--bg-secondary)] px-5 py-7">
              <p className="text-[13px] font-medium">
                No experiences match this strand
              </p>
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Choose another strand to see the rest of your CAS experiences.
              </p>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

function RecordSection({
  section,
  records,
  state,
}: {
  section: (typeof sections)[number];
  records: RecordRow[];
  state: CapabilityState;
}) {
  if (!records.length && state.kind !== "available") return null;
  return (
    <section className="mt-5">
      {records.length ? (
        <>
          <p className="px-1 text-[11px] text-[var(--text-secondary)]">
            {records.length} verified record{records.length === 1 ? "" : "s"}
          </p>
          <div className="mt-3 space-y-1">
            {records.map((record) => (
              <RecordLine key={record._id} record={record} />
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-[10px] bg-[var(--bg-secondary)] px-5 py-7">
          <p className="text-[13px] font-medium">
            No {section.label.toLowerCase()} in the latest sync
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
            The provider route completed successfully and returned no current
            records.
          </p>
        </div>
      )}
    </section>
  );
}

function RecordLine({ record, date }: { record: RecordRow; date?: number }) {
  const value = record.normalized;
  const title = text(
    value.title ?? value.name ?? value.subject,
    "Untitled school record",
  );
  const subtitle = text(
    value.className ??
      value.courseName ??
      value.description ??
      record.recordType,
    record.recordType,
  );
  const at =
    date ??
    timestamp(value.dueAt ?? value.deadlineAt ?? value.startAt ?? value.start);
  return (
    <div className="flex items-center gap-3 rounded-[10px] px-3 py-3 transition-colors hover:bg-[var(--bg-secondary)]">
      <FileText className="size-3.5 shrink-0 text-[var(--text-tertiary)]" />
      <div className="min-w-0 flex-1">
        <strong className="block truncate text-[11px]">{title}</strong>
        <span className="block truncate text-micro text-[var(--text-tertiary)]">
          {subtitle}
        </span>
      </div>
      <div className="shrink-0 text-right">
        <span className="block text-micro font-semibold">
          {at ? formatDate(at) : "No precise time"}
        </span>
        <span className="text-micro text-[var(--text-tertiary)]">
          fetched {formatDate(record.fetchedAt)}
        </span>
      </div>
      {record.provenanceUrl ? (
        <a
          href={record.provenanceUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Open provider source"
          className="grid size-7 place-items-center rounded-[8px] hover:bg-[var(--bg-hover)]"
        >
          <ExternalLink className="size-3" />
        </a>
      ) : null}
    </div>
  );
}

function SyncStatus({ payload }: { payload: SchoolPayload }) {
  return (
    <div className="mt-5 grid gap-8 lg:grid-cols-[1.2fr_.8fr]">
      <section>
        <header className="px-1 py-3">
          <h2 className="font-display text-[18px] font-semibold">
            Capability ledger
          </h2>
        </header>
        <div className="space-y-1">
          {payload.capabilities.map((capability) => {
            const lastSuccess =
              capability.lastSuccessAt ?? payload.integration?.lastSyncAt;
            const state: CapabilityState =
              capability.verificationStatus === "verified"
                ? lastSuccess
                  ? { kind: "available", updatedAt: lastSuccess }
                  : { kind: "stale", updatedAt: 0 }
                : capability.verificationStatus === "quarantined"
                  ? { kind: "schema_incompatible" }
                  : capability.verificationStatus === "failed"
                    ? {
                        kind: "unavailable",
                        retryable: true,
                        message: capability.lastErrorCode ?? "Route failed",
                      }
                    : { kind: "unsupported" };
            return (
              <div
                key={capability._id}
                className="flex items-center gap-3 rounded-[10px] px-3 py-3 transition-colors hover:bg-[var(--bg-secondary)]"
              >
                <div className="min-w-0 flex-1">
                  <strong className="block truncate text-[11px]">
                    {capability.name}
                  </strong>
                  <span className="text-micro text-[var(--text-tertiary)]">
                    {capability.recordType} · SLA{" "}
                    {capability.freshnessSlaMinutes} min · last success{" "}
                    {formatDate(lastSuccess)}
                  </span>
                </div>
                <CapabilityTruthBadge state={state} />
              </div>
            );
          })}
        </div>
      </section>
      <section className="px-1 py-3">
        <h2 className="font-display text-[18px] font-semibold">Recent syncs</h2>
        <div className="mt-3 space-y-2">
          {payload.syncRuns.slice(0, 8).map((run) => (
            <div
              key={run._id}
              className="rounded-[10px] p-3 transition-colors hover:bg-[var(--bg-secondary)]"
            >
              <div className="flex items-center justify-between">
                <strong className="text-micro">{run.stage}</strong>
                <span className="text-micro font-semibold">{run.status}</span>
              </div>
              <p className="mt-1 text-micro text-[var(--text-tertiary)]">
                {run.counts.fetched} received · {run.counts.projected} projected
                · {run.counts.quarantined} quarantined · {run.counts.errors}{" "}
                errors
              </p>
              {run.errorSummary ? (
                <p className="mt-1 text-micro text-rose-700">
                  {run.errorSummary}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
