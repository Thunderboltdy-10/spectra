"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useSearchParams } from "next/navigation";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import { useNow } from "@/hooks/use-now";
import { FileClock, KeyRound, MessageCircle, Settings2, ShieldAlert, ShieldCheck, UserPlus, AlertTriangle, BarChart3, CalendarDays, LockKeyhole, Plus, School, Search, Users, Activity, CircleDollarSign, CircleGauge, CloudCog, Database, HardDrive, HeartPulse, LayoutGrid, LifeBuoy, Network, ServerCog, TicketCheck, Workflow } from "@/components/icons/glyph-icons";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  getAdministration,
  mutateAdministration,
  type PlatformAdministrationOverview,
} from "@/features/spectra/administration/api";
import { metricDefinition } from "@/features/spectra/administration/metric-registry";
import type { BarCommand, CollapseStep } from "@/components/ui/adaptive-bar";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { LoadingRows } from "@/components/ui/page-state";
import { SidePanel } from "@/components/ui/side-panel";
import { describeFailure } from "@/components/ui/truthful-state";
import { ProductSectionNav } from "@/features/spectra/components/product-section-nav";
import { OverflowMenu } from "@/components/ui/dropdown-menu";
import {
  AdminButton,
  AdminCard,
  AdminDialog,
  AdminSectionHeader,
  EmptyPanel,
  ErrorPanel,
  formatBytes,
  formatCompact,
  formatRelative,
  InlineLink,
  LoadingPanel,
  MetricCard,
  PrivacyNotice,
  SelectField,
  StatusBadge,
  statusToneFor,
  type StatusTone,
  TextAreaField,
  TextField,
} from "@/features/spectra/administration/shared";

type Tab =
  | "overview"
  | "schools"
  | "operations"
  | "usage"
  | "requests"
  | "governance"
  | "security";

const tabs: Array<{ key: Tab; label: string; icon: typeof School }> = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "schools", label: "Schools", icon: School },
  { key: "operations", label: "Operations", icon: ServerCog },
  { key: "usage", label: "Usage & finance", icon: CircleDollarSign },
  { key: "requests", label: "Requests & support", icon: LifeBuoy },
  { key: "governance", label: "Governance", icon: ShieldCheck },
  { key: "security", label: "Audit & security", icon: LockKeyhole },
];

type SchoolRow = {
  schoolId: string;
  name: string;
  slug: string;
  status: "active" | "suspended" | "archived";
  timezone: string;
  domains: string[];
  members: number;
  integrationStatus: string;
  limitEnforcement: "disabled" | "simulate" | "enforced";
  limitRules: LimitRule[];
  updatedAt: number;
};

type LimitRule = {
  category:
    | "storage_bytes"
    | "bandwidth_bytes"
    | "model_tokens"
    | "render_milliseconds"
    | "collaboration_bytes";
  period: "day" | "month" | "total";
  warningAt?: number;
  maximum: number;
};

type OnboardingSaga = {
  sagaId: string;
  schoolId: string;
  schoolName: string;
  schoolSlug: string;
  initialAdminEmail: string;
  status: "reserved" | "invited" | "ready" | "failed" | "cancelled";
  completedSteps: string[];
  errorSummary?: string;
  createdAt: number;
  updatedAt: number;
};

type PlatformRequest = {
  requestId: string;
  school: { schoolId: string; name: string; slug: string } | null;
  requester: { name: string; email: string } | null;
  type: string;
  subject: string;
  detail: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: string;
  responseDueAt?: number;
  response?: string;
  createdAt: number;
  updatedAt: number;
};

type LifecycleJob = {
  jobId: string;
  schoolId: string;
  type: "activate" | "suspend" | "export" | "offboard" | "purge";
  status: string;
  reason: string;
  impact: {
    activeMembers: number;
    artifacts: number;
    artifactsAtLeast?: boolean;
    workspaces: number;
    integrations: number;
  };
  approvalCount: number;
  reversibleUntil?: number;
  prerequisiteExportJobId?: string;
  purge?: {
    stage: string;
    deletedRows: number;
    deletedStorageObjects: number;
    irreversibleAt?: number;
  } | null;
  errorSummary?: string;
  createdAt: number;
  completedAt?: number;
};

type PlatformSecurityLog = {
  events: Array<{
    eventId: string;
    action: string;
    targetType: string;
    targetId: string;
    actor: { name: string; email: string } | null;
    school: { schoolId: string; name: string } | null;
    decision?: string;
    reason?: string;
    createdAt: number;
  }>;
  sessions: Array<{
    sessionId: string;
    operator: { name: string; email: string } | null;
    school: { schoolId: string; name: string };
    label: string;
    reason: string;
    mode: "inspect" | "manage";
    createdAt: number;
    expiresAt: number;
    revokedAt?: number;
  }>;
};

function dateRange() {
  return {
    fromDay: new Date(Date.now() - 29 * 24 * 60 * 60_000)
      .toISOString()
      .slice(0, 10),
    toDay: new Date().toISOString().slice(0, 10),
  };
}

function PlatformUsageChart({
  data,
}: {
  data: PlatformAdministrationOverview;
}) {
  const categories = [
    ["Model input", "model_input_tokens", "var(--brand-primary)"],
    ["Model output", "model_output_tokens", "#ff8a32"],
    ["Collaboration", "collaboration_bytes", "#26a47c"],
    ["Bandwidth", "bandwidth_bytes", "#9b78ff"],
  ] as const;
  return (
    <div className="px-4 pb-4">
      <div className="grid gap-2 sm:grid-cols-2">
        {categories.map(([label, key, color]) => (
          <div
            key={key}
            className="flex items-center gap-3 rounded-control border border-[var(--border-subtle)] px-3 py-2"
          >
            <span
              className="size-2 rounded-chip"
              style={{ backgroundColor: color }}
            />
            <span className="flex-1 text-micro text-[var(--text-secondary)]">
              {label}
            </span>
            <strong className="text-micro">
              {formatCompact(data.usage.totals[key])}
            </strong>
          </div>
        ))}
      </div>
      <div className="relative mt-4 h-48 border-b border-l border-[var(--border-subtle)]">
        {categories.map(([label, key, color], seriesIndex) => {
          const values = data.usage.series.map(
            (point) => point.values[key] ?? 0,
          );
          const maximum = Math.max(1, ...values);
          const points = (values.length ? values : [0, 0])
            .map(
              (value, index, rows) =>
                `${(index / Math.max(1, rows.length - 1)) * 100},${95 - (value / maximum) * (68 - seriesIndex * 4)}`,
            )
            .join(" ");
          return (
            <svg
              key={key}
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 size-full overflow-visible"
              aria-label={label}
            >
              <polyline
                points={points}
                fill="none"
                stroke={color}
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-micro text-[var(--text-tertiary)]">
        <span>{data.usage.series[0]?.day ?? "No completed range"}</span>
        <span>
          {data.usage.series.at(-1)?.day ?? data.usage.completeThrough}
        </span>
      </div>
    </div>
  );
}

const PLATFORM_BAR_PLAN: readonly CollapseStep[] = [{ toMenu: "refresh" }, { toMenu: "range" }];

function PlatformOverviewSurface({
  data,
  onTab,
}: {
  data: PlatformAdministrationOverview;
  onTab: (tab: Tab) => void;
}) {
  const totalTokens =
    (data.usage.totals.model_input_tokens ?? 0) +
    (data.usage.totals.model_output_tokens ?? 0);
  const totalOperational = Object.values(data.usage.totals).reduce(
    (sum, value) => sum + value,
    0,
  );
  return (
    <div className="space-y-6">
      <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          icon={School}
          label="Active schools"
          value={formatCompact(data.metrics.activeSchools)}
          detail="Current operational tenants"
          tone="green"
          state={data.metricStates.activeSchools}
          source={metricDefinition("platform.active_schools").source}
        />
        <MetricCard
          icon={Users}
          label="Total users"
          value={formatCompact(data.metrics.totalUsers)}
          detail={`${formatCompact(data.metrics.activeUsers30d)} active in 30 days`}
          tone="violet"
          state={data.metricStates.totalUsers}
          source={metricDefinition("platform.total_users").source}
        />
        <MetricCard
          icon={Database}
          label="Artifacts created"
          value={formatCompact(data.metrics.artifactsCreated)}
          detail="Unknown until metadata counters are complete"
          tone="orange"
          state={data.metricStates.artifactsCreated}
          source={metricDefinition("platform.work_created").source}
        />
        <MetricCard
          icon={MessageCircle}
          label="Chat messages"
          value={formatCompact(data.metrics.messages)}
          detail="Never inferred by reading private threads"
          tone="blue"
          state={data.metricStates.messages}
          source={metricDefinition("platform.messages").source}
        />
        <MetricCard
          icon={Activity}
          label="30-day activity"
          value={`${data.metrics.retentionPercent}%`}
          detail="Account activity, not private content"
          tone="green"
          state={data.metricStates.retentionPercent}
          source={metricDefinition("platform.retention").source}
        />
      </div>

      <div className="min-w-0">
        <div className="min-w-0 space-y-3">
        <section>
          <AdminSectionHeader
            title="Platform usage"
            detail={`Privacy-safe meters complete through ${data.usage.completeThrough}`}
            action={<StatusBadge tone="neutral">Daily</StatusBadge>}
          />
          <PlatformUsageChart data={data} />
        </section>
        <div className="grid gap-8 md:grid-cols-2">
        <section className="rounded-card px-4 py-3 hover:bg-[var(--bg-secondary)]">
          <h2 className="font-[var(--font-serif)] text-subhead font-medium">
            Storage & compute
          </h2>
          <p className="mt-1 text-micro text-[var(--text-tertiary)]">
            Metered platform consumption for the selected range
          </p>
          <div className="mt-5 space-y-3 text-micro">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[var(--text-secondary)]">Storage</span>
              <strong className="font-sans text-heading font-normal">
                {formatBytes(data.storageBytes)}
              </strong>
            </div>
            <div className="flex justify-between gap-3 text-micro">
              <span className="text-[var(--text-secondary)]">Model tokens</span>
              <strong>{formatCompact(totalTokens)}</strong>
            </div>
            <div className="flex justify-between gap-3 text-micro">
              <span className="text-[var(--text-secondary)]">
                Operational units
              </span>
              <strong>{formatCompact(totalOperational)}</strong>
            </div>
          </div>
          <AdminButton className="mt-5 w-full" onClick={() => onTab("usage")}>
            View usage & finance
          </AdminButton>
        </section>
        <section className="rounded-card px-4 py-3 hover:bg-[var(--bg-secondary)]">
          <h2 className="font-[var(--font-serif)] text-subhead font-medium">
            Seats & access
          </h2>
          <p className="mt-1 text-micro text-[var(--text-tertiary)]">
            No commercial seat enforcement
          </p>
          <strong className="mt-6 block font-sans text-display font-normal">
            {formatCompact(data.metrics.totalUsers)}
          </strong>
          <span className="text-micro text-[var(--text-tertiary)]">
            active accounts across schools
          </span>
          <div className="mt-5 h-1.5 rounded-full bg-[var(--bg-secondary)]">
            <div
              className="h-full rounded-full bg-[var(--brand-primary)]"
              style={{
                width: `${Math.max(2, Math.min(100, data.metrics.retentionPercent))}%`,
              }}
            />
          </div>
          <div className="mt-4 space-y-2 text-micro">
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">
                Active in 30 days
              </span>
              <strong>{formatCompact(data.metrics.activeUsers30d)}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-secondary)]">Available</span>
              <strong>Unlimited</strong>
            </div>
          </div>
          <AdminButton className="mt-5 w-full" onClick={() => onTab("schools")}>
            Manage schools
          </AdminButton>
        </section>
        </div>
        </div>
      </div>

      <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-4">
        <section>
          <AdminSectionHeader
            title="Model & agent usage"
            detail="Aggregate operational meters"
          />
          <div className="space-y-3 px-4 pb-4 text-micro">
            {[
              ["Model input tokens", data.usage.totals.model_input_tokens],
              ["Model output tokens", data.usage.totals.model_output_tokens],
              ["Render time", data.usage.totals.render_milliseconds],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <div className="flex justify-between gap-3">
                  <span>{label}</span>
                  <strong>{formatCompact(value as number | undefined)}</strong>
                </div>
                <div className="mt-1 h-1 rounded-full bg-[var(--bg-secondary)]">
                  <div className="h-full w-2/3 rounded-full bg-[color-mix(in_oklab,var(--accent-coral)_32%,var(--bg-elevated))]" />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section>
          <AdminSectionHeader
            title="Operational queues"
            detail="Items awaiting attention"
          />
          <div className="space-y-2 px-4 pb-4">
            {[
              [
                "Failed AI runs",
                data.queues.failedRuns24h,
                data.queues.failedRuns24h === null ? "unknown" : "failure",
              ],
              ["Connector errors", data.queues.integrationErrors, "attention"],
              ["Open feedback", data.queues.openFeedback, "neutral"],
              ["School requests", data.queues.openRequests, "neutral"],
            ].map(([label, value, tone]) => (
              <button
                key={String(label)}
                type="button"
                onClick={() =>
                  onTab(
                    label === "School requests" || label === "Open feedback"
                      ? "requests"
                      : "operations",
                  )
                }
                className="flex w-full items-center justify-between rounded-control px-3 py-2 text-micro hover:bg-[var(--bg-secondary)]"
              >
                <span>{label}</span>
                <StatusBadge tone={tone as StatusTone}>
                  {formatCompact(value as number | null)}
                </StatusBadge>
              </button>
            ))}
          </div>
        </section>
        <section>
          <AdminSectionHeader
            title="Top schools by usage"
            detail="Metered operational units"
            action={
              <InlineLink onClick={() => onTab("schools")}>View all</InlineLink>
            }
          />
          <div className="space-y-2 px-4 pb-4 text-micro">
            {data.topSchools.slice(0, 6).map((school, index) => (
              <div key={school.schoolId} className="flex items-center gap-2">
                <span className="w-4 text-[var(--text-tertiary)]">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{school.name}</span>
                <strong>{formatCompact(school.usage)}</strong>
              </div>
            ))}
          </div>
        </section>
        <section>
          <AdminSectionHeader
            title="Platform insights"
            detail="Directly derived operational signals"
          />
          <div className="space-y-3 px-4 pb-4 text-micro leading-4">
            <div className="flex gap-2">
              <Activity size={13} className="mt-0.5 text-[var(--brand-primary)]" />
              {formatCompact(totalTokens)} model tokens were metered this
              period.
            </div>
            <div className="flex gap-2">
              <Network size={13} className="mt-0.5 text-[var(--accent-mint)]" />
              {data.integrations.degraded} of {data.integrations.total} school
              integrations are degraded.
            </div>
            <div className="flex gap-2">
              <AlertTriangle size={13} className="mt-0.5 text-[var(--accent-gold)]" />
              {data.incidents.length} unresolved platform incidents require
              monitoring.
            </div>
          </div>
        </section>
      </div>
      <section className="mt-3">
        <AdminSectionHeader
          title="Recent activity"
          detail="Operational events derived from incidents and school requests."
          action={
            <InlineLink onClick={() => onTab("security")}>
              View audit log
            </InlineLink>
          }
        />
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full min-w-[720px] text-left text-micro">
            <thead className="text-[var(--text-tertiary)]">
              <tr>
                <th className="pb-2 font-normal">Event</th>
                <th className="pb-2 font-normal">Type</th>
                <th className="pb-2 font-normal">Status</th>
                <th className="pb-2 text-right font-normal">Time</th>
              </tr>
            </thead>
            <tbody>
              {[
                ...data.incidents.map((incident) => ({
                  id: incident._id,
                  label: incident.title,
                  type: "Incident",
                  status: incident.status,
                  at: incident.updatedAt,
                })),
                ...data.requests.map((request) => ({
                  id: request._id,
                  label: request.subject,
                  type: request.type.replaceAll("_", " "),
                  status: request.status,
                  at: request.createdAt,
                })),
              ]
                .sort((left, right) => right.at - left.at)
                .slice(0, 8)
                .map((row) => (
                  <tr
                    key={row.id}
                    className="rounded-card transition-colors hover:bg-[var(--bg-secondary)]"
                  >
                    <td className="py-2.5 font-medium">{row.label}</td>
                    <td className="py-2.5 capitalize text-[var(--text-secondary)]">
                      {row.type}
                    </td>
                    <td className="py-2.5">
                      <StatusBadge tone={statusToneFor(row.status)}>
                        {row.status.replaceAll("_", " ")}
                      </StatusBadge>
                    </td>
                    <td className="py-2.5 text-right text-[var(--text-tertiary)]">
                      {formatRelative(row.at)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <AdminButton tone="primary" onClick={() => onTab("schools")}>
          <Plus size={12} />
          Add school
        </AdminButton>
        <OverflowMenu
          label="More platform actions"
          size={36}
          items={[
            { key: "schools", label: "Invite users", icon: UserPlus },
            { key: "usage", label: "View reports", icon: BarChart3 },
            { key: "governance", label: "System settings", icon: Settings2 },
          ]}
          onSelect={(key) => onTab(key as Tab)}
        />
      </div>

      <PrivacyNotice>{data.privacy}</PrivacyNotice>
    </div>
  );
}

/** Service health and feedback, beside the Overview. */
function PlatformContext({
  data,
  onTab,
}: {
  data: PlatformAdministrationOverview;
  onTab: (tab: Tab) => void;
}) {
  return (
          <div className="space-y-8 px-1 pb-6 pt-2">
          <section>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-ui font-semibold">Service health</h2>
              <InlineLink onClick={() => onTab("operations")}>
                View status
              </InlineLink>
            </div>
            <div className="mt-3 space-y-2">
              {data.serviceHealth.map((service) => (
                <div
                  key={service.service}
                  className="flex items-center gap-2 text-micro"
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      service.status === "operational"
                        ? "bg-[var(--accent-mint)]"
                        : service.status === "degraded"
                          ? "bg-[var(--accent-gold)]"
                          : "bg-[var(--text-placeholder)]",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {service.service}
                  </span>
                  <StatusBadge tone={statusToneFor(service.status)}>
                    {service.status}
                  </StatusBadge>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h2 className="text-ui font-semibold">Feedback</h2>
            <p className="mt-1 text-micro text-[var(--text-tertiary)]">
              How people felt, across every school.
            </p>
            <div className="mt-3 space-y-2 text-micro">
              {[
                ["Positive", data.feedback.positive, "var(--success)"],
                ["Neutral", data.feedback.neutral, "var(--accent-gold)"],
                ["Negative", data.feedback.negative, "var(--danger)"],
              ].map(([label, value, color]) => (
                <div key={String(label)} className="flex items-center gap-2">
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: String(color) }}
                  />
                  <span className="flex-1">{label}</span>
                  <strong>{formatCompact(value as number)}</strong>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <InlineLink onClick={() => onTab("requests")}>
                Review feedback
              </InlineLink>
            </div>
          </section>
          </div>
  );
}

export function SuperadminShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab") as Tab | null;
  const [tab, setTabState] = useState<Tab>(
    requestedTab && tabs.some((item) => item.key === requestedTab)
      ? requestedTab
      : "overview",
  );
  const [overview, setOverview] =
    useState<PlatformAdministrationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const range = useMemo(() => dateRange(), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setOverview(
        await getAdministration<PlatformAdministrationOverview>(
          "platformOverview",
          range,
        ),
      );
    } catch (nextError) {
      setError(
        describeFailure(nextError, {
          fallback: "Check your connection, then try loading the platform again.",
        }).message,
      );
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const setTab = useCallback(
    (next: Tab) => {
      setTabState(next);
      router.replace(`/superadmin?tab=${next}`, { scroll: false });
    },
    [router],
  );

  if (!overview)
    return (
      <main className="spectra-wave-y relative isolate min-h-0 flex-1 overflow-y-auto" data-spectra-app-surface="true">
        <PageBody>
          <PageHeader title="Platform" />
          {loading ? (
            <LoadingRows label="Opening the platform" count={6} className="mt-6" />
          ) : error ? (
            <div className="mt-6">
              <ErrorPanel message={error} retry={() => void load()} />
            </div>
          ) : null}
        </PageBody>
      </main>
    );

  const rangeLabel = (() => {
    const from = new Date(range.fromDay);
    const to = new Date(range.toDay);
    const fmt = new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return `${fmt.format(from)} – ${fmt.format(to)}`;
  })();

  const commands: BarCommand[] = [
    {
      id: "range",
      icon: "calendar",
      label: rangeLabel,
      render: () => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap px-1 text-micro font-medium text-[var(--text-secondary)]">
          <CalendarDays size={12} />
          {rangeLabel}
        </span>
      ),
    },
    {
      id: "refresh",
      icon: "retry",
      label: loading ? "Refreshing…" : "Refresh",
      labelPolicy: "never",
      disabled: loading,
      onSelect: () => setRefreshKey((value) => value + 1),
    },
  ];

  return (
    <main className="spectra-wave-y relative isolate flex h-full min-h-0 flex-1" data-spectra-app-surface="true">
      <div className="min-w-0 flex-1 overflow-y-auto">
      <PageBody>
        <PageHeader
          title="Platform"
          commands={commands}
          plan={PLATFORM_BAR_PLAN}
          barLabel="Platform commands"
          description="Health, usage and school operations, without opening anyone's work."
        />
        <ProductSectionNav
          label="Platform sections"
          items={tabs}
          active={tab}
          onChange={setTab}
          className="mb-4 mt-4"
        />
        {tab === "overview" ? (
          <PlatformOverviewSurface data={overview} onTab={setTab} />
        ) : (
          <PlatformTab
            tab={tab}
            overview={overview}
            refreshKey={refreshKey}
            onRefresh={() => setRefreshKey((value) => value + 1)}
          />
        )}
      </PageBody>
      </div>
      {tab === "overview" ? (
        <SidePanel id="superadmin.context" title="Platform context" icon="health" stageMin={720} defaultWidth={320}>
          <PlatformContext data={overview} onTab={setTab} />
        </SidePanel>
      ) : null}
    </main>
  );
}

function PlatformTab({
  tab,
  overview,
  refreshKey,
  onRefresh,
}: {
  tab: Exclude<Tab, "overview">;
  overview: PlatformAdministrationOverview;
  refreshKey: number;
  onRefresh: () => void;
}) {
  if (tab === "schools")
    return <SchoolsSurface refreshKey={refreshKey} onRefresh={onRefresh} />;
  if (tab === "operations")
    return (
      <OperationsSurface
        overview={overview}
        refreshKey={refreshKey}
        onRefresh={onRefresh}
      />
    );
  if (tab === "usage") return <PlatformUsageSurface overview={overview} />;
  if (tab === "requests")
    return <RequestsSurface refreshKey={refreshKey} onRefresh={onRefresh} />;
  if (tab === "governance") return <PlatformGovernanceSurface />;
  return <SecuritySurface refreshKey={refreshKey} onRefresh={onRefresh} />;
}

function SchoolsSurface({
  refreshKey,
  onRefresh,
}: {
  refreshKey: number;
  onRefresh: () => void;
}) {
  const router = useRouter();
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [onboarding, setOnboarding] = useState<OnboardingSaga[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [sessionSchool, setSessionSchool] = useState<SchoolRow | null>(null);
  const [limitSchool, setLimitSchool] = useState<SchoolRow | null>(null);
  const [limitRules, setLimitRules] = useState<LimitRule[]>([]);
  const [limitEnforcement, setLimitEnforcement] = useState<
    "disabled" | "simulate" | "enforced"
  >("disabled");
  const [limitReason, setLimitReason] = useState("");
  const [limitConfirmation, setLimitConfirmation] = useState("");
  const [limitSimulation, setLimitSimulation] = useState<{
    evaluations: Array<
      LimitRule & {
        current: number;
        warning: boolean;
        wouldBlock: boolean;
        remaining: number;
      }
    >;
  } | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [timezone, setTimezone] = useState("Europe/Madrid");
  const [domains, setDomains] = useState("");
  const [initialAdminEmail, setInitialAdminEmail] = useState("");
  const [manualInvitationUrl, setManualInvitationUrl] = useState("");
  const [label, setLabel] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState("inspect");
  const [duration, setDuration] = useState("30");
  const [busy, setBusy] = useState("");
  const [cancelOnboarding, setCancelOnboarding] =
    useState<OnboardingSaga | null>(null);
  const [cancelOnboardingReason, setCancelOnboardingReason] = useState("");

  useEffect(() => {
    setLoading(true);
    void Promise.all([
      getAdministration<{ schools: SchoolRow[] }>("schoolDirectory", {
        includeInactive: true,
        search,
      }),
      getAdministration<{ sagas: OnboardingSaga[] }>("onboardingSagas"),
    ])
      .then(([schoolRows, sagaRows]) => {
        setSchools(schoolRows.schools);
        setOnboarding(sagaRows.sagas);
      })
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Schools failed."),
      )
      .finally(() => setLoading(false));
  }, [refreshKey, search]);

  async function createSchool(event: FormEvent) {
    event.preventDefault();
    setBusy("create");
    try {
      const result = await mutateAdministration<{
        delivery: { status: "sent" | "skipped" | "failed"; reason?: string };
        manualInvitationUrl?: string;
      }>("createSchool", {
        name,
        slug,
        timezone,
        initialAdminEmail,
        verifiedDomains: domains
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      toast.success("School onboarding started.");
      if (result.manualInvitationUrl) {
        setManualInvitationUrl(result.manualInvitationUrl);
        toast.warning(
          result.delivery.reason ??
            "Email delivery is unavailable. Deliver the secure invitation manually.",
        );
      }
      setCreateOpen(false);
      setName("");
      setSlug("");
      setDomains("");
      setInitialAdminEmail("");
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Creation failed.");
    } finally {
      setBusy("");
    }
  }

  async function startSession(event: FormEvent) {
    event.preventDefault();
    if (!sessionSchool) return;
    setBusy("session");
    try {
      const result = await mutateAdministration<{
        sessionId: string;
        expiresAt: number;
      }>("startOperatorSession", {
        schoolId: sessionSchool.schoolId,
        label,
        reason,
        mode,
        durationMinutes: Number(duration),
      });
      toast.success(
        `${mode === "manage" ? "Manage" : "Inspect"} session started.`,
      );
      router.push(
        `/admin?operatorSessionId=${encodeURIComponent(result.sessionId)}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Session failed.");
    } finally {
      setBusy("");
    }
  }

  async function simulateLimits() {
    if (!limitSchool) return;
    setBusy("simulate-limits");
    try {
      const result = await mutateAdministration<{
        evaluations: Array<
          LimitRule & {
            current: number;
            warning: boolean;
            wouldBlock: boolean;
            remaining: number;
          }
        >;
      }>("simulateLimits", {
        schoolId: limitSchool.schoolId,
        rules: limitRules,
      });
      setLimitSimulation(result);
      toast.success("Limit policy simulated against current usage.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Simulation failed.",
      );
    } finally {
      setBusy("");
    }
  }

  async function saveLimits() {
    if (!limitSchool) return;
    setBusy("save-limits");
    let sessionId = "";
    try {
      const session = await mutateAdministration<{ sessionId: string }>(
        "startOperatorSession",
        {
          schoolId: limitSchool.schoolId,
          label: `Limit policy · ${limitSchool.name}`,
          reason: limitReason,
          mode: "manage",
          durationMinutes: 10,
        },
      );
      sessionId = session.sessionId;
      await mutateAdministration("setLimitPolicy", {
        schoolId: limitSchool.schoolId,
        operatorSessionId: sessionId,
        rules: limitRules,
        enforcement: limitEnforcement,
      });
      toast.success(
        limitEnforcement === "enforced"
          ? "Limit enforcement enabled deliberately."
          : limitEnforcement === "simulate"
            ? "Simulation enabled; requests remain unblocked."
            : "Limits saved with enforcement disabled.",
      );
      setLimitSchool(null);
      setLimitSimulation(null);
      setLimitReason("");
      setLimitConfirmation("");
      onRefresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Limit update failed.",
      );
    } finally {
      if (sessionId)
        await mutateAdministration("endOperatorSession", {
          operatorSessionId: sessionId,
        }).catch(() => undefined);
      setBusy("");
    }
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          icon={School}
          label="Schools"
          value={formatCompact(schools.length)}
          detail={`${schools.filter((item) => item.status === "active").length} active`}
        />
        <MetricCard
          icon={Users}
          label="School members"
          value={formatCompact(
            schools.reduce((sum, school) => sum + school.members, 0),
          )}
          detail="No commercial seat cap"
          tone="violet"
        />
        <MetricCard
          icon={Network}
          label="Degraded integrations"
          value={formatCompact(
            schools.filter((item) =>
              ["blocked", "degraded"].includes(item.integrationStatus),
            ).length,
          )}
          detail="Requires operational attention"
          tone="orange"
        />
      </div>
      {onboarding.some((saga) =>
        ["reserved", "invited", "failed"].includes(saga.status),
      ) ? (
        <AdminCard className="mt-3">
          <AdminSectionHeader
            title="School onboarding"
            detail="Invitation, activation, and reversible setup state"
          />
          <div className="divide-y divide-[var(--border-subtle)] px-4 pb-3">
            {onboarding
              .filter((saga) =>
                ["reserved", "invited", "failed"].includes(saga.status),
              )
              .map((saga) => (
                <div
                  key={saga.sagaId}
                  className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-micro font-medium">
                        {saga.schoolName}
                      </strong>
                      <StatusBadge tone={statusToneFor(saga.status)}>
                        {saga.status}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-micro text-[var(--text-tertiary)]">
                      {saga.initialAdminEmail} · {saga.completedSteps.length}{" "}
                      setup steps · {formatRelative(saga.updatedAt)}
                    </p>
                    {saga.errorSummary ? (
                      <p className="mt-1 text-micro text-[var(--danger)]">
                        {saga.errorSummary}
                      </p>
                    ) : null}
                  </div>
                  {["reserved", "invited"].includes(saga.status) ? (
                    <AdminButton
                      onClick={() => {
                        setCancelOnboarding(saga);
                        setCancelOnboardingReason("");
                      }}
                    >
                      Cancel onboarding
                    </AdminButton>
                  ) : null}
                </div>
              ))}
          </div>
        </AdminCard>
      ) : null}
      <AdminCard className="mt-3">
        <AdminSectionHeader
          title="Schools"
          detail="Enter the same school-admin product through a labeled, time-boxed operator session."
          action={
            <AdminButton tone="primary" onClick={() => setCreateOpen(true)}>
              <Plus size={13} />
              Add school
            </AdminButton>
          }
        />
        <div className="px-4 pb-3">
          <label className="relative block max-w-md">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search schools, slugs, and domains"
              className="h-9 w-full rounded-control border border-[var(--border-default)] bg-[var(--bg-primary)] pl-9 pr-3 text-micro outline-none"
            />
          </label>
        </div>
        {loading ? (
          <LoadingPanel label="Loading schools" />
        ) : schools.length ? (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full min-w-[900px] text-left text-micro">
              <thead className="text-[var(--text-tertiary)]">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="pb-2 font-normal">School</th>
                  <th className="pb-2 font-normal">Members</th>
                  <th className="pb-2 font-normal">Integration</th>
                  <th className="pb-2 font-normal">Limits</th>
                  <th className="pb-2 font-normal">Status</th>
                  <th className="pb-2 text-right font-normal">Operate</th>
                </tr>
              </thead>
              <tbody>
                {schools.map((school) => (
                  <tr
                    key={school.schoolId}
                    className="border-b border-[var(--border-subtle)] last:border-0"
                  >
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <span className="grid size-8 place-items-center rounded-control bg-[color-mix(in_oklab,var(--accent-mint)_10%,var(--bg-primary))] text-[var(--accent-mint)]">
                          <School size={14} />
                        </span>
                        <span>
                          <strong className="block font-medium">
                            {school.name}
                          </strong>
                          <span className="text-micro text-[var(--text-tertiary)]">
                            {school.slug} · {school.timezone}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="py-3">{formatCompact(school.members)}</td>
                    <td className="py-3">
                      <StatusBadge
                        tone={statusToneFor(school.integrationStatus)}
                      >
                        {school.integrationStatus.replaceAll("_", " ")}
                      </StatusBadge>
                    </td>
                    <td className="py-3">
                      <StatusBadge
                        tone={
                          school.limitEnforcement === "disabled"
                            ? "healthy"
                            : "attention"
                        }
                      >
                        {school.limitEnforcement}
                      </StatusBadge>
                    </td>
                    <td className="py-3">
                      <StatusBadge tone={statusToneFor(school.status)}>
                        {school.status}
                      </StatusBadge>
                    </td>
                    <td className="py-3 text-right">
                      <AdminButton
                        className="mr-2"
                        onClick={() => {
                          setLimitSchool(school);
                          setLimitRules(school.limitRules);
                          setLimitEnforcement(school.limitEnforcement);
                          setLimitReason("");
                          setLimitConfirmation("");
                          setLimitSimulation(null);
                        }}
                      >
                        <CircleGauge size={12} />
                        Limits
                      </AdminButton>
                      <AdminButton
                        onClick={() => {
                          setSessionSchool(school);
                          setLabel(`Support · ${school.name}`);
                        }}
                      >
                        <KeyRound size={12} />
                        Enter school
                      </AdminButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel
            icon={School}
            title="No matching schools"
            detail="Adjust the search or add a new school."
          />
        )}
      </AdminCard>

      <AdminDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add a school"
        detail="Creates a reversible onboarding record with verified domains, policy defaults, disabled limits, and audit."
        footer={
          <>
            <AdminButton onClick={() => setCreateOpen(false)}>
              Cancel
            </AdminButton>
            <AdminButton
              type="submit"
              tone="primary"
              disabled={
                !name || !timezone || !initialAdminEmail || busy === "create"
              }
              onClick={() =>
                document
                  .querySelector<HTMLFormElement>("#create-school-form")
                  ?.requestSubmit()
              }
            >
              Start onboarding
            </AdminButton>
          </>
        }
      >
        <form
          id="create-school-form"
          onSubmit={(event) => void createSchool(event)}
          className="space-y-4"
        >
          <TextField label="School name" value={name} onChange={setName} />
          <TextField
            label="Slug (optional)"
            value={slug}
            onChange={setSlug}
            placeholder="greenfield-international"
          />
          <TextField
            label="IANA timezone"
            value={timezone}
            onChange={setTimezone}
          />
          <TextField
            label="Initial school administrator"
            value={initialAdminEmail}
            onChange={setInitialAdminEmail}
            type="email"
            placeholder="admin@school.example"
          />
          <TextField
            label="Verified domains (comma separated)"
            value={domains}
            onChange={setDomains}
          />
        </form>
      </AdminDialog>

      <AdminDialog
        open={Boolean(manualInvitationUrl)}
        onClose={() => setManualInvitationUrl("")}
        title="Deliver the initial admin invitation"
        detail="SMTP did not accept the onboarding email. This link is single-use, email-bound, and expires automatically."
        footer={
          <>
            <AdminButton onClick={() => setManualInvitationUrl("")}>
              Done
            </AdminButton>
            <AdminButton
              tone="primary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(manualInvitationUrl)
                  .then(() => toast.success("Invitation link copied."))
              }
            >
              Copy secure link
            </AdminButton>
          </>
        }
      >
        <div className="break-all rounded-control border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 font-mono text-micro leading-5">
          {manualInvitationUrl}
        </div>
      </AdminDialog>

      <AdminDialog
        open={Boolean(limitSchool)}
        onClose={() => setLimitSchool(null)}
        title={`Usage policy · ${limitSchool?.name ?? ""}`}
        detail="Inspect and simulate rules now. Enforcement stays disabled unless you deliberately enable it through this audited temporary manage elevation. When enforced, new AI requests stop once a model-token maximum is reached (UTC day, month or all time); storage, bandwidth, render and collaboration rules are reported but never block."
        footer={
          <>
            <AdminButton onClick={() => setLimitSchool(null)}>
              Cancel
            </AdminButton>
            <AdminButton
              disabled={
                busy === "simulate-limits" ||
                limitRules.some(
                  (rule) => !Number.isFinite(rule.maximum) || rule.maximum <= 0,
                )
              }
              onClick={() => void simulateLimits()}
            >
              Preview impact
            </AdminButton>
            <AdminButton
              tone={limitEnforcement === "enforced" ? "danger" : "primary"}
              disabled={
                limitReason.trim().length < 12 ||
                busy === "save-limits" ||
                limitRules.some(
                  (rule) =>
                    !Number.isFinite(rule.maximum) ||
                    rule.maximum <= 0 ||
                    (rule.warningAt !== undefined &&
                      rule.warningAt > rule.maximum),
                ) ||
                (limitEnforcement === "enforced" &&
                  limitConfirmation !== limitSchool?.slug)
              }
              onClick={() => void saveLimits()}
            >
              Save policy
            </AdminButton>
          </>
        }
        danger={limitEnforcement === "enforced"}
      >
        <div className="space-y-4">
          <SelectField
            label="Enforcement mode"
            value={limitEnforcement}
            onChange={(value) =>
              setLimitEnforcement(value as "disabled" | "simulate" | "enforced")
            }
            options={[
              {
                value: "disabled",
                label: "Disabled · meter and inspect only",
              },
              {
                value: "simulate",
                label: "Simulate · show impact without blocking",
              },
              {
                value: "enforced",
                label: "Enforced · stop new AI requests at the model-token maximum",
              },
            ]}
          />
          <div className="space-y-2">
            {limitRules.map((rule, index) => (
              <div
                key={`${rule.category}-${index}`}
                className="grid gap-2 rounded-control border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 sm:grid-cols-[1.3fr_.8fr_1fr_1fr_auto]"
              >
                <SelectField
                  label="Meter"
                  value={rule.category}
                  onChange={(value) =>
                    setLimitRules((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              category: value as LimitRule["category"],
                            }
                          : item,
                      ),
                    )
                  }
                  options={[
                    { value: "storage_bytes", label: "Storage bytes" },
                    { value: "bandwidth_bytes", label: "Bandwidth bytes" },
                    { value: "model_tokens", label: "Model tokens" },
                    {
                      value: "render_milliseconds",
                      label: "Render milliseconds",
                    },
                    {
                      value: "collaboration_bytes",
                      label: "Collaboration bytes",
                    },
                  ]}
                />
                <SelectField
                  label="Period"
                  value={rule.period}
                  onChange={(value) =>
                    setLimitRules((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              period: value as LimitRule["period"],
                            }
                          : item,
                      ),
                    )
                  }
                  options={[
                    { value: "day", label: "Day" },
                    { value: "month", label: "Month" },
                    { value: "total", label: "Total" },
                  ]}
                />
                <TextField
                  label="Warn at"
                  type="number"
                  value={rule.warningAt?.toString() ?? ""}
                  onChange={(value) =>
                    setLimitRules((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              warningAt: value ? Number(value) : undefined,
                            }
                          : item,
                      ),
                    )
                  }
                />
                <TextField
                  label="Maximum"
                  type="number"
                  value={rule.maximum.toString()}
                  onChange={(value) =>
                    setLimitRules((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, maximum: Number(value) }
                          : item,
                      ),
                    )
                  }
                />
                <AdminButton
                  className="self-end"
                  onClick={() =>
                    setLimitRules((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                >
                  Remove
                </AdminButton>
              </div>
            ))}
            <AdminButton
              onClick={() =>
                setLimitRules((current) => [
                  ...current,
                  {
                    category: "storage_bytes",
                    period: "total",
                    maximum: 50 * 1024 * 1024 * 1024,
                  },
                ])
              }
            >
              <Plus size={12} />
              Add rule
            </AdminButton>
          </div>
          {limitSimulation ? (
            <div className="rounded-control border border-[var(--border-default)] p-3">
              <p className="mb-2 text-micro font-semibold">
                Current policy impact
              </p>
              <div className="space-y-2">
                {limitSimulation.evaluations.map((item, index) => (
                  <div
                    key={`${item.category}-${index}`}
                    className="flex items-center justify-between text-micro"
                  >
                    <span>
                      {item.category.replaceAll("_", " ")} · {item.period}
                    </span>
                    <StatusBadge tone={item.wouldBlock ? "failure" : "healthy"}>
                      {formatCompact(item.current)} /{" "}
                      {formatCompact(item.maximum)}
                    </StatusBadge>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <TextAreaField
            label="Operational reason"
            value={limitReason}
            onChange={setLimitReason}
            rows={3}
          />
          {limitEnforcement === "enforced" ? (
            <TextField
              label={`Type ${limitSchool?.slug ?? "the school slug"} to enable blocking`}
              value={limitConfirmation}
              onChange={setLimitConfirmation}
            />
          ) : null}
        </div>
      </AdminDialog>

      <AdminDialog
        open={Boolean(cancelOnboarding)}
        onClose={() => setCancelOnboarding(null)}
        title="Cancel school onboarding"
        detail="The initial invitation will be revoked and the reserved school archived. This is available only before an administrator joins."
        footer={
          <>
            <AdminButton onClick={() => setCancelOnboarding(null)}>
              Keep onboarding
            </AdminButton>
            <AdminButton
              tone="danger"
              disabled={
                cancelOnboardingReason.trim().length < 12 ||
                busy === "cancel-onboarding"
              }
              onClick={() => {
                if (!cancelOnboarding) return;
                setBusy("cancel-onboarding");
                void mutateAdministration("cancelOnboarding", {
                  sagaId: cancelOnboarding.sagaId,
                  reason: cancelOnboardingReason,
                })
                  .then(() => {
                    toast.success("School onboarding cancelled.");
                    setCancelOnboarding(null);
                    setCancelOnboardingReason("");
                    onRefresh();
                  })
                  .catch((error) =>
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Cancellation failed.",
                    ),
                  )
                  .finally(() => setBusy(""));
              }}
            >
              Cancel onboarding
            </AdminButton>
          </>
        }
        danger
      >
        <TextAreaField
          label="Cancellation reason"
          value={cancelOnboardingReason}
          onChange={setCancelOnboardingReason}
          rows={4}
        />
      </AdminDialog>

      <AdminDialog
        open={Boolean(sessionSchool)}
        onClose={() => setSessionSchool(null)}
        title={`Enter ${sessionSchool?.name ?? "school"}`}
        detail="This creates operational access, not another school membership. The banner and audit trail remain visible throughout."
        footer={
          <>
            <AdminButton onClick={() => setSessionSchool(null)}>
              Cancel
            </AdminButton>
            <AdminButton
              type="submit"
              tone="primary"
              disabled={!label || reason.length < 12 || busy === "session"}
              onClick={() =>
                document
                  .querySelector<HTMLFormElement>("#operator-session-form")
                  ?.requestSubmit()
              }
            >
              Start session
            </AdminButton>
          </>
        }
      >
        <form
          id="operator-session-form"
          onSubmit={(event) => void startSession(event)}
          className="space-y-4"
        >
          <TextField label="Session label" value={label} onChange={setLabel} />
          <TextAreaField
            label="Reason or ticket"
            value={reason}
            onChange={setReason}
            rows={4}
            placeholder="Explain the operational need. This enters the audit log."
          />
          <SelectField
            label="Access mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "inspect", label: "Inspect (read-only)" },
              { value: "manage", label: "Manage (writes enabled)" },
            ]}
          />
          <SelectField
            label="Duration"
            value={duration}
            onChange={setDuration}
            options={[
              { value: "15", label: "15 minutes" },
              { value: "30", label: "30 minutes" },
              { value: "45", label: "45 minutes" },
              { value: "60", label: "60 minutes" },
            ]}
          />
          <PrivacyNotice>
            Operator access never permits routine inspection of private prompts,
            threads, memory, or ordinary artifact content.
          </PrivacyNotice>
        </form>
      </AdminDialog>
    </>
  );
}

function OperationsSurface({
  overview,
  refreshKey: _refreshKey,
  onRefresh,
}: {
  overview: PlatformAdministrationOverview;
  refreshKey: number;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [services, setServices] = useState("");
  const [severity, setSeverity] = useState("minor");
  const [busy, setBusy] = useState("");
  async function createIncident() {
    setBusy("create");
    try {
      await mutateAdministration("createIncident", {
        title,
        summary,
        affectedServices: services
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        severity,
      });
      toast.success("Incident opened.");
      setOpen(false);
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Incident failed.");
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-4">
        <MetricCard
          icon={HeartPulse}
          label="Open incidents"
          value={formatCompact(overview.incidents.length)}
          detail="Investigating, identified, or monitoring"
          tone="orange"
        />
        <MetricCard
          icon={Network}
          label="Connector errors"
          value={formatCompact(overview.queues.integrationErrors)}
          detail="Blocked or degraded integrations"
          tone="orange"
        />
        <MetricCard
          icon={Workflow}
          label="Failed AI runs"
          value={formatCompact(overview.queues.failedRuns24h)}
          detail="Unknown until safe counters are complete"
          tone="violet"
        />
        <MetricCard
          icon={TicketCheck}
          label="Open requests"
          value={formatCompact(overview.queues.openRequests)}
          detail="Support queue"
          tone="blue"
        />
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
        <AdminCard>
          <AdminSectionHeader
            title="Incidents"
            detail="Operational status, affected services, and recovery state."
            action={
              <AdminButton tone="primary" onClick={() => setOpen(true)}>
                <Plus size={13} />
                Open incident
              </AdminButton>
            }
          />
          {overview.incidents.length ? (
            <div className="divide-y divide-[var(--border-subtle)] px-4 pb-4">
              {overview.incidents.map((incident) => (
                <div
                  key={incident._id}
                  className="flex flex-wrap items-start gap-3 py-3"
                >
                  <span
                    className={cn(
                      "grid size-8 place-items-center rounded-control",
                      incident.severity === "critical"
                        ? "bg-[color-mix(in_oklab,var(--accent-coral)_10%,var(--bg-elevated))] text-[var(--accent-coral)]"
                        : "bg-[color-mix(in_oklab,var(--accent-gold)_12%,var(--bg-elevated))] text-[var(--accent-gold)]",
                    )}
                  >
                    <AlertTriangle size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block text-micro">
                      {incident.title}
                    </strong>
                    <span className="mt-1 block text-micro leading-4 text-[var(--text-tertiary)]">
                      {incident.summary}
                    </span>
                    <span className="mt-1 block text-micro text-[var(--text-tertiary)]">
                      {incident.affectedServices.join(", ")} ·{" "}
                      {formatRelative(incident.updatedAt)}
                    </span>
                  </span>
                  <StatusBadge tone={statusToneFor(incident.status)}>
                    {incident.status}
                  </StatusBadge>
                  <SelectField
                    label="Status"
                    value={incident.status}
                    onChange={(status) => {
                      setBusy(incident._id);
                      void mutateAdministration("updateIncident", {
                        incidentId: incident._id,
                        status,
                      })
                        .then(() => {
                          toast.success("Incident updated.");
                          onRefresh();
                        })
                        .catch((error) =>
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : "Update failed.",
                          ),
                        )
                        .finally(() => setBusy(""));
                    }}
                    options={[
                      { value: "investigating", label: "Investigating" },
                      { value: "identified", label: "Identified" },
                      { value: "monitoring", label: "Monitoring" },
                      { value: "resolved", label: "Resolved" },
                    ]}
                  />
                </div>
              ))}
            </div>
          ) : (
            <EmptyPanel
              icon={HeartPulse}
              title="No open incidents"
              detail="Platform services are not reporting an active incident."
            />
          )}
        </AdminCard>
        <AdminCard>
          <AdminSectionHeader
            title="Service matrix"
            detail="Unknown is shown honestly when a meter is absent."
          />
          <div className="space-y-2 px-4 pb-4">
            {overview.serviceHealth.map((service) => (
              <div
                key={service.service}
                className="flex items-center justify-between gap-3 rounded-control border border-[var(--border-subtle)] px-3 py-2.5 text-micro"
              >
                <span>{service.service}</span>
                <StatusBadge tone={statusToneFor(service.status)}>
                  {service.status}
                </StatusBadge>
              </div>
            ))}
          </div>
        </AdminCard>
      </div>
      <AdminDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Open a platform incident"
        detail="Use operational facts only. Incident summaries are visible to platform operators."
        footer={
          <>
            <AdminButton onClick={() => setOpen(false)}>Cancel</AdminButton>
            <AdminButton
              tone="primary"
              disabled={!title || !summary || busy === "create"}
              onClick={() => void createIncident()}
            >
              Open incident
            </AdminButton>
          </>
        }
      >
        <div className="space-y-4">
          <TextField label="Title" value={title} onChange={setTitle} />
          <TextAreaField
            label="Operational summary"
            value={summary}
            onChange={setSummary}
            rows={5}
          />
          <TextField
            label="Affected services (comma separated)"
            value={services}
            onChange={setServices}
          />
          <SelectField
            label="Severity"
            value={severity}
            onChange={setSeverity}
            options={[
              { value: "minor", label: "Minor" },
              { value: "major", label: "Major" },
              { value: "critical", label: "Critical" },
            ]}
          />
        </div>
      </AdminDialog>
    </>
  );
}

function PlatformUsageSurface({
  overview,
}: {
  overview: PlatformAdministrationOverview;
}) {
  const rows = Object.entries(overview.usage.totals).sort(
    (left, right) => right[1] - left[1],
  );
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          icon={HardDrive}
          label="Storage"
          value={formatBytes(overview.storageBytes)}
          detail="Metered platform storage"
        />
        <MetricCard
          icon={Activity}
          label="Model tokens"
          value={formatCompact(
            (overview.usage.totals.model_input_tokens ?? 0) +
              (overview.usage.totals.model_output_tokens ?? 0),
          )}
          detail="Input and output tokens"
          tone="violet"
        />
        <MetricCard
          icon={Network}
          label="Bandwidth"
          value={formatBytes(overview.usage.totals.bandwidth_bytes)}
          detail="Metered egress and imports"
          tone="blue"
        />
      </div>
      <AdminCard>
        <AdminSectionHeader
          title="Usage allocation"
          detail="Cost allocation can be layered over these meters without exposing school costs to local admins."
        />
        <div className="grid gap-6 p-4 pt-1 lg:grid-cols-[minmax(0,1fr)_360px]">
          <PlatformUsageChart data={overview} />
          <div className="space-y-2">
            {rows.map(([category, quantity]) => (
              <div
                key={category}
                className="flex items-center justify-between gap-3 rounded-control border border-[var(--border-subtle)] px-3 py-2.5 text-micro"
              >
                <span className="capitalize">
                  {category.replaceAll("_", " ")}
                </span>
                <strong>
                  {category.endsWith("_bytes")
                    ? formatBytes(quantity)
                    : formatCompact(quantity)}
                </strong>
              </div>
            ))}
          </div>
        </div>
      </AdminCard>
      <PrivacyNotice>
        No cost anomaly automatically suspends a school. Limit policies default
        to disabled and may be simulated before deliberate enforcement.
      </PrivacyNotice>
    </div>
  );
}

function RequestsSurface({
  refreshKey,
  onRefresh,
}: {
  refreshKey: number;
  onRefresh: () => void;
}) {
  const [requests, setRequests] = useState<PlatformRequest[]>([]);
  const [selected, setSelected] = useState<PlatformRequest | null>(null);
  const [status, setStatus] = useState("in_progress");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setLoading(true);
    void getAdministration<{ requests: PlatformRequest[] }>("platformRequests")
      .then((result) => setRequests(result.requests))
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : "Requests failed.",
        ),
      )
      .finally(() => setLoading(false));
  }, [refreshKey]);
  return (
    <>
      <AdminCard>
        <AdminSectionHeader
          title="School requests"
          detail="Prioritized by urgency and response SLA; viewing the queue is audited."
        />
        {loading ? (
          <LoadingPanel label="Loading requests" />
        ) : requests.length ? (
          <div className="divide-y divide-[var(--border-subtle)] px-4 pb-4">
            {requests.map((request) => (
              <button
                type="button"
                key={request.requestId}
                onClick={() => {
                  setSelected(request);
                  setStatus(
                    request.status === "open" ? "acknowledged" : request.status,
                  );
                  setResponse(request.response ?? "");
                }}
                className="flex w-full items-start gap-3 py-3 text-left"
              >
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-control",
                    request.priority === "urgent"
                      ? "bg-[color-mix(in_oklab,var(--accent-coral)_10%,var(--bg-elevated))] text-[var(--accent-coral)]"
                      : "bg-[var(--bg-secondary)] text-[var(--text-secondary)]",
                  )}
                >
                  <LifeBuoy size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-micro">
                    {request.subject}
                  </strong>
                  <span className="mt-1 block line-clamp-2 text-micro leading-4 text-[var(--text-tertiary)]">
                    {request.detail}
                  </span>
                  <span className="mt-1 block text-micro text-[var(--text-tertiary)]">
                    {request.school?.name ?? "Platform"} ·{" "}
                    {request.requester?.name ?? "Unavailable requester"} · due{" "}
                    {request.responseDueAt
                      ? formatRelative(request.responseDueAt)
                      : "not set"}
                  </span>
                </span>
                <StatusBadge
                  tone={
                    request.priority === "urgent" || request.priority === "high"
                      ? "attention"
                      : "neutral"
                  }
                >
                  {request.priority}
                </StatusBadge>
                <StatusBadge tone={statusToneFor(request.status)}>
                  {request.status.replaceAll("_", " ")}
                </StatusBadge>
              </button>
            ))}
          </div>
        ) : (
          <EmptyPanel
            icon={LifeBuoy}
            title="Request queue is clear"
            detail="New school support, integration, seat, export, and offboarding requests will appear here."
          />
        )}
      </AdminCard>
      <AdminDialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.subject ?? "Request"}
        detail={
          selected
            ? `${selected.school?.name ?? "Platform"} · ${selected.type.replaceAll("_", " ")} · ${selected.priority}`
            : undefined
        }
        footer={
          <>
            <AdminButton onClick={() => setSelected(null)}>Cancel</AdminButton>
            <AdminButton
              tone="primary"
              disabled={!selected || busy}
              onClick={() => {
                if (!selected) return;
                setBusy(true);
                void mutateAdministration("respondSchoolRequest", {
                  requestRecordId: selected.requestId,
                  status,
                  response,
                })
                  .then(() => {
                    toast.success("Request updated.");
                    setSelected(null);
                    onRefresh();
                  })
                  .catch((error) =>
                    toast.error(
                      error instanceof Error ? error.message : "Update failed.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Save response
            </AdminButton>
          </>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="rounded-control bg-[var(--bg-secondary)] p-3 text-micro leading-5">
              {selected.detail}
            </div>
            <SelectField
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: "acknowledged", label: "Acknowledged" },
                { value: "in_progress", label: "In progress" },
                { value: "resolved", label: "Resolved" },
                { value: "closed", label: "Closed" },
              ]}
            />
            <TextAreaField
              label="Response visible to the requester"
              value={response}
              onChange={setResponse}
              rows={5}
            />
          </div>
        ) : null}
      </AdminDialog>
    </>
  );
}

function PlatformGovernanceSurface() {
  const guarantees = [
    {
      icon: Activity,
      title: "AI without role gates",
      detail:
        "Provider operations optimize quality, reliability, caching, and cost without narrowing user capability.",
    },
    {
      icon: FileClock,
      title: "User-owned memory",
      detail:
        "Memory is default-on, permission-bound, and controlled by its user rather than an institution.",
    },
    {
      icon: Workflow,
      title: "Universal creation",
      detail:
        "Artifacts, agents, imports, exports, and advanced workflows remain available to every ordinary role.",
    },
    {
      icon: CloudCog,
      title: "Secure execution",
      detail:
        "Runtimes use isolation, scoped credentials, approvals, and audit instead of school allowlists.",
    },
  ] as const;
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
      <AdminCard>
        <AdminSectionHeader
          title="Platform capability charter"
          detail="Operations protect the service and its users. They do not decide which legitimate Spectra capabilities people may use."
        />
        <div className="grid gap-2 p-4 pt-1 sm:grid-cols-2">
          {guarantees.map(({ icon: Icon, title, detail }) => (
            <div
              key={title}
              className="rounded-card border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3.5"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-control bg-[color-mix(in_oklab,var(--accent-mint)_8%,var(--bg-primary))] text-[var(--accent-mint)]">
                  <Icon size={15} />
                </span>
                <StatusBadge tone="healthy">Platform guarantee</StatusBadge>
              </div>
              <strong className="mt-3 block text-micro">{title}</strong>
              <p className="mt-1 text-micro leading-4 text-[var(--text-tertiary)]">
                {detail}
              </p>
            </div>
          ))}
        </div>
      </AdminCard>
      <div className="space-y-3">
        <AdminCard className="p-4">
          <h2 className="font-[var(--font-serif)] text-subhead font-medium">
            Operational boundaries
          </h2>
          <p className="mt-2 text-micro leading-5 text-[var(--text-secondary)]">
            Platform operators manage availability, incidents, tenancy,
            credentials, legal lifecycle, metering, provider health, and future
            commercial limits. Permissions, privacy, and sandboxing remain hard
            security boundaries; none becomes an educational feature switch.
          </p>
        </AdminCard>
        <PrivacyNotice>
          Operators cannot inspect private prompts, threads, memory, or
          unrelated artifacts through this surface. School admins inherit this
          same capability charter.
        </PrivacyNotice>
      </div>
    </div>
  );
}

function SecuritySurface({
  refreshKey,
  onRefresh,
}: {
  refreshKey: number;
  onRefresh: () => void;
}) {
  const [jobs, setJobs] = useState<LifecycleJob[]>([]);
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [securityLog, setSecurityLog] = useState<PlatformSecurityLog>({
    events: [],
    sessions: [],
  });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [schoolId, setSchoolId] = useState("");
  const [type, setType] = useState("suspend");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [cancelJob, setCancelJob] = useState<LifecycleJob | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState("");
  const [exportLinks, setExportLinks] = useState<{
    jobId: string;
    url: string;
    parts: { index: number; section: string; url: string }[];
  } | null>(null);
  const now = useNow(30_000);
  useEffect(() => {
    setLoading(true);
    void Promise.all([
      getAdministration<{ jobs: LifecycleJob[] }>("lifecycleJobs"),
      getAdministration<{ schools: SchoolRow[] }>("schoolDirectory", {
        includeInactive: true,
      }),
      getAdministration<PlatformSecurityLog>("platformSecurityLog", {
        limit: 120,
      }),
    ])
      .then(([jobRows, schoolRows, log]) => {
        setJobs(jobRows.jobs);
        setSchools(schoolRows.schools);
        setSecurityLog(log);
      })
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : "Security failed.",
        ),
      )
      .finally(() => setLoading(false));
  }, [refreshKey]);
  const selectedSchool = schools.find((school) => school.schoolId === schoolId);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          icon={KeyRound}
          label="Operator access"
          value="Time-boxed"
          detail="Inspect by default, manage by elevation"
          tone="violet"
        />
        <MetricCard
          icon={ShieldAlert}
          label="Awaiting approval"
          value={formatCompact(
            jobs.filter((job) => job.status === "awaiting_approval").length,
          )}
          detail="Destructive jobs require a second operator"
          tone="orange"
        />
        <MetricCard
          icon={FileClock}
          label="Lifecycle jobs"
          value={formatCompact(jobs.length)}
          detail="Impact, status, recovery, and audit"
          tone="blue"
        />
      </div>
      <AdminCard className="mt-3">
        <AdminSectionHeader
          title="School lifecycle jobs"
          detail="Activation, suspension, export, offboarding, and purge use explicit, recoverable workflows."
          action={
            <AdminButton tone="primary" onClick={() => setOpen(true)}>
              <Plus size={13} />
              Request operation
            </AdminButton>
          }
        />
        {loading ? (
          <LoadingPanel label="Loading lifecycle jobs" />
        ) : jobs.length ? (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full min-w-[900px] text-left text-micro">
              <thead className="text-[var(--text-tertiary)]">
                <tr className="border-b border-[var(--border-subtle)]">
                  <th className="pb-2 font-normal">Operation</th>
                  <th className="pb-2 font-normal">Impact</th>
                  <th className="pb-2 font-normal">Approvals</th>
                  <th className="pb-2 font-normal">Recovery</th>
                  <th className="pb-2 font-normal">Status</th>
                  <th className="pb-2 text-right font-normal">Action</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.jobId}
                    className="border-b border-[var(--border-subtle)] last:border-0"
                  >
                    <td className="py-3">
                      <strong className="block capitalize">{job.type}</strong>
                      <span className="text-micro text-[var(--text-tertiary)]">
                        {formatRelative(job.createdAt)}
                      </span>
                    </td>
                    <td className="py-3 text-[var(--text-secondary)]">
                      {job.impact.activeMembers} members ·{" "}
                      {job.impact.artifacts}
                      {job.impact.artifactsAtLeast ? "+" : ""} artifacts ·{" "}
                      {job.impact.workspaces}{" "}
                      workspaces
                    </td>
                    <td className="py-3">{job.approvalCount}/2</td>
                    <td className="py-3 text-[var(--text-secondary)]">
                      {job.purge
                        ? `${job.purge.stage.replaceAll("_", " ")} · ${formatCompact(job.purge.deletedRows)} rows`
                        : job.reversibleUntil
                          ? `Until ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(job.reversibleUntil)}`
                          : "Operation-specific"}
                    </td>
                    <td className="py-3">
                      <StatusBadge tone={statusToneFor(job.status)}>
                        {job.status.replaceAll("_", " ")}
                      </StatusBadge>
                    </td>
                    <td className="py-3 text-right">
                      {job.status === "awaiting_approval" ? (
                        <div className="flex justify-end gap-2">
                          <AdminButton
                            disabled={busy === job.jobId}
                            onClick={() => {
                              setBusy(job.jobId);
                              void mutateAdministration("approveLifecycle", {
                                jobId: job.jobId,
                              })
                                .then(() => {
                                  toast.success("Lifecycle job approved.");
                                  onRefresh();
                                })
                                .catch((error) =>
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : "Approval failed.",
                                  ),
                                )
                                .finally(() => setBusy(""));
                            }}
                          >
                            Approve
                          </AdminButton>
                          <AdminButton
                            onClick={() => {
                              setCancelJob(job);
                              setCancelReason("");
                            }}
                          >
                            Cancel
                          </AdminButton>
                        </div>
                      ) : job.type === "purge" && job.status === "queued" ? (
                        <AdminButton
                          onClick={() => {
                            setCancelJob(job);
                            setCancelReason("");
                          }}
                        >
                          Cancel before boundary
                        </AdminButton>
                      ) : job.type === "export" &&
                        job.status === "completed" ? (
                        exportLinks?.jobId === job.jobId ? (
                          <ul className="grid gap-1 text-micro">
                            {[
                              { label: "Manifest", url: exportLinks.url },
                              ...exportLinks.parts.map((part) => ({
                                label: `Part ${part.index + 1}: ${part.section}`,
                                url: part.url,
                              })),
                            ].map((link) => (
                              <li key={link.url}>
                                <a
                                  className="text-[var(--accent-cyan)] underline-offset-2 hover:underline"
                                  href={link.url}
                                  rel="noopener noreferrer"
                                  target="_blank"
                                >
                                  {link.label}
                                </a>
                              </li>
                            ))}
                          </ul>
                        ) : (
                        <AdminButton
                          disabled={busy === job.jobId}
                          onClick={() => {
                            setBusy(job.jobId);
                            void getAdministration<{
                              url: string;
                              parts?: { index: number; section: string; url: string }[];
                            }>("lifecycleExport", { jobId: job.jobId })
                              .then(({ url, parts = [] }) => {
                                // A large export is a manifest plus parts, so
                                // list every file instead of opening one.
                                if (parts.length > 0)
                                  setExportLinks({ jobId: job.jobId, url, parts });
                                else
                                  window.open(
                                    url,
                                    "_blank",
                                    "noopener,noreferrer",
                                  );
                              })
                              .catch((error) =>
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : "Export download failed.",
                                ),
                              )
                              .finally(() => setBusy(""));
                          }}
                        >
                          Download export
                        </AdminButton>
                        )
                      ) : (
                        <span className="text-micro text-[var(--text-tertiary)]">
                          {job.errorSummary ?? "No action required"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel
            icon={FileClock}
            title="No lifecycle jobs"
            detail="Requested school operations will appear with impact and approval state."
          />
        )}
      </AdminCard>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <AdminCard>
          <AdminSectionHeader
            title="Operator sessions"
            detail="Time-boxed operational access across schools"
          />
          {securityLog.sessions.length ? (
            <div className="divide-y divide-[var(--border-subtle)] px-4 pb-3">
              {securityLog.sessions.slice(0, 12).map((session) => {
                const active =
                  !session.revokedAt && session.expiresAt > now;
                return (
                  <div
                    key={session.sessionId}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <strong className="block truncate text-micro font-medium">
                        {session.label}
                      </strong>
                      <span className="block truncate text-micro text-[var(--text-tertiary)]">
                        {session.operator?.email ?? "Unavailable operator"} ·{" "}
                        {session.school.name}
                      </span>
                    </div>
                    <StatusBadge tone={active ? "attention" : "neutral"}>
                      {active ? session.mode : "ended"}
                    </StatusBadge>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyPanel
              icon={KeyRound}
              title="No operator sessions"
              detail="Scoped school access will appear here."
            />
          )}
        </AdminCard>
        <AdminCard>
          <AdminSectionHeader
            title="Privileged activity"
            detail="Content-free audit events; viewing this list is audited"
          />
          {securityLog.events.length ? (
            <div className="divide-y divide-[var(--border-subtle)] px-4 pb-3">
              {securityLog.events.slice(0, 12).map((event) => (
                <div
                  key={event.eventId}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <strong className="block truncate text-micro font-medium">
                      {event.action.replaceAll(".", " ")}
                    </strong>
                    <span className="block truncate text-micro text-[var(--text-tertiary)]">
                      {event.actor?.email ?? "System"} ·{" "}
                      {event.school?.name ?? "Platform"} ·{" "}
                      {formatRelative(event.createdAt)}
                    </span>
                  </div>
                  <StatusBadge
                    tone={statusToneFor(event.decision ?? "recorded")}
                  >
                    {event.decision ?? event.targetType}
                  </StatusBadge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyPanel
              icon={ShieldCheck}
              title="No privileged activity"
              detail="Security and operational audit events will appear here."
            />
          )}
        </AdminCard>
      </div>
      <PrivacyNotice>
        Privileged audit access is itself audited. Secrets, prompts, thread
        content, memory, and artifact excerpts are prohibited from audit
        metadata.
      </PrivacyNotice>
      <AdminDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Request a school operation"
        detail="Review the expected impact before submitting. Offboarding and purge require the exact school slug and a second operator."
        danger={type === "offboard" || type === "purge"}
        footer={
          <>
            <AdminButton onClick={() => setOpen(false)}>Cancel</AdminButton>
            <AdminButton
              tone={
                type === "offboard" || type === "purge" ? "danger" : "primary"
              }
              disabled={
                !schoolId ||
                reason.length < 12 ||
                ((type === "offboard" || type === "purge") &&
                  confirmation !== selectedSchool?.slug) ||
                busy === "lifecycle"
              }
              onClick={() => {
                setBusy("lifecycle");
                void mutateAdministration("requestLifecycle", {
                  schoolId,
                  type,
                  reason,
                  typedConfirmation: confirmation || undefined,
                })
                  .then(() => {
                    toast.success("Lifecycle job requested.");
                    setOpen(false);
                    setReason("");
                    setConfirmation("");
                    onRefresh();
                  })
                  .catch((error) =>
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Request failed.",
                    ),
                  )
                  .finally(() => setBusy(""));
              }}
            >
              Request operation
            </AdminButton>
          </>
        }
      >
        <div className="space-y-4">
          <SelectField
            label="School"
            value={schoolId}
            onChange={setSchoolId}
            options={[
              { value: "", label: "Choose a school" },
              ...schools.map((school) => ({
                value: school.schoolId,
                label: `${school.name} (${school.status})`,
              })),
            ]}
          />
          <SelectField
            label="Operation"
            value={type}
            onChange={setType}
            options={[
              { value: "activate", label: "Activate" },
              { value: "suspend", label: "Suspend" },
              { value: "export", label: "Create export" },
              { value: "offboard", label: "Begin offboarding" },
              { value: "purge", label: "Purge after retention boundary" },
            ]}
          />
          <TextAreaField
            label="Operational reason"
            value={reason}
            onChange={setReason}
            rows={4}
          />
          {type === "offboard" || type === "purge" ? (
            <>
              <div className="rounded-control border border-[color-mix(in_oklab,var(--accent-coral)_28%,var(--bg-elevated))] bg-[color-mix(in_oklab,var(--accent-coral)_8%,var(--bg-elevated))] p-3 text-micro leading-4 text-[var(--danger)]">
                This operation affects school access, integrations, and retained
                data. It remains blocked until a different platform operator
                approves it.
              </div>
              <TextField
                label={`Type ${selectedSchool?.slug ?? "the school slug"} exactly`}
                value={confirmation}
                onChange={setConfirmation}
              />
            </>
          ) : null}
        </div>
      </AdminDialog>
      <AdminDialog
        open={Boolean(cancelJob)}
        onClose={() => setCancelJob(null)}
        title="Cancel destructive operation"
        detail="Cancellation restores access while the job is still inside its reversible hold. The action and reason remain in the legal audit trail."
        footer={
          <>
            <AdminButton onClick={() => setCancelJob(null)}>
              Keep operation
            </AdminButton>
            <AdminButton
              tone="danger"
              disabled={cancelReason.trim().length < 12 || busy === "cancel"}
              onClick={() => {
                if (!cancelJob) return;
                setBusy("cancel");
                void mutateAdministration("cancelLifecycle", {
                  jobId: cancelJob.jobId,
                  reason: cancelReason,
                })
                  .then(() => {
                    toast.success("Lifecycle operation cancelled.");
                    setCancelJob(null);
                    setCancelReason("");
                    onRefresh();
                  })
                  .catch((error) =>
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Cancellation failed.",
                    ),
                  )
                  .finally(() => setBusy(""));
              }}
            >
              Cancel operation
            </AdminButton>
          </>
        }
        danger
      >
        <TextAreaField
          label="Cancellation reason"
          value={cancelReason}
          onChange={setCancelReason}
          rows={4}
        />
      </AdminDialog>
    </>
  );
}
