"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { SearchField } from "@/components/ui/search-field";
import { useSearchParams } from "next/navigation";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import { useNow } from "@/hooks/use-now";
import { Plus } from "@/components/icons/glyph-icons";
import { toast } from "@/components/ui/toast";
import {
  getAdministration,
  mutateAdministration,
  type PlatformAdministrationOverview,
} from "@/features/spectra/administration/api";
import { metricDefinition } from "@/features/spectra/administration/metric-registry";
import { EmergencyStop } from "@/features/spectra/administration/emergency-stop";
import { FeedbackInbox } from "@/features/spectra/administration/feedback-inbox";
import { LandingInbox } from "@/features/spectra/administration/landing-inbox";
import type { BarCommand, CollapseStep } from "@/components/ui/adaptive-bar";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { LoadingRows } from "@/components/ui/page-state";
import { PanelTabs, type PanelTab } from "@/components/ui/side-panel";
import { describeFailure } from "@/components/ui/truthful-state";
import {
  AdminButton,
  AdminDialog,
  AdminSectionHeader,
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
  TextAreaField,
  TallySheet,
  TextField,
} from "@/features/spectra/administration/shared";
import { auditActionWords } from "@/features/spectra/administration/audit-words";
import { formatMeter, USAGE_METERS, UsageDayChart } from "@/features/spectra/administration/usage-chart";
import { PlatformMessagesSurface, SchoolDetailDialog, type PlatformDraft } from "@/features/spectra/administration/platform-messages";

type Tab =
  | "overview"
  | "schools"
  | "messages"
  | "operations"
  | "usage"
  | "requests"
  | "governance"
  | "security";

const tabs: Array<PanelTab & { id: Tab }> = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "schools", label: "Schools", icon: "school" },
  { id: "messages", label: "Messages", icon: "mail" },
  { id: "operations", label: "Operations", icon: "server" },
  { id: "usage", label: "Usage", icon: "billing" },
  { id: "requests", label: "Feedback & requests", icon: "help" },
  { id: "governance", label: "Rights & privacy", icon: "shield" },
  { id: "security", label: "Audit log", icon: "locked" },
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

/** The words for a platform service, and whether it wants a look. */
function serviceWords(status: string) {
  if (status === "operational") return { label: "Working", needs: false };
  if (status === "degraded") return { label: "Partly working", needs: true };
  if (status === "outage" || status === "down") return { label: "Down", needs: true };
  return { label: "Nothing counted yet", needs: false };
}

const REQUEST_TYPES: Record<string, string> = {
  incident: "Incident",
};

function requestTypeWords(type: string) {
  return REQUEST_TYPES[type] ?? type.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

type PlatformNeed = { id: string; title: string; detail: string; tone?: "danger" | "quiet"; action: ReactNode };

function platformNeeds(data: PlatformAdministrationOverview, onTab: (tab: Tab) => void): PlatformNeed[] {
  const needs: PlatformNeed[] = [];
  const open = data.incidents.filter((incident) => incident.status !== "resolved");
  if (open.length)
    needs.push({
      id: "incidents",
      title: open.length === 1 ? open[0].title : `${open.length} incidents are open`,
      detail: open.length === 1 ? open[0].summary : open.map((incident) => incident.title).join(", "),
      tone: open.some((incident) => incident.severity !== "minor") ? "danger" : undefined,
      action: <InlineLink onClick={() => onTab("operations")}>Operations</InlineLink>,
    });
  if (data.queues.failedRuns24h)
    needs.push({
      id: "runs",
      title: `${formatCompact(data.queues.failedRuns24h)} AI ${data.queues.failedRuns24h === 1 ? "turn" : "turns"} failed today`,
      detail: "Across every school, in the last 24 hours.",
      tone: "danger",
      action: <InlineLink onClick={() => onTab("operations")}>Operations</InlineLink>,
    });
  if (data.queues.integrationErrors)
    needs.push({
      id: "integrations",
      title: `ManageBac needs a hand at ${data.queues.integrationErrors} ${data.queues.integrationErrors === 1 ? "school" : "schools"}`,
      detail: "Their classes and people may be out of date until it is fixed.",
      action: <InlineLink onClick={() => onTab("operations")}>Operations</InlineLink>,
    });
  if (data.queues.openRequests)
    needs.push({
      id: "requests",
      title: `${data.queues.openRequests} ${data.queues.openRequests === 1 ? "school is" : "schools are"} waiting for an answer`,
      detail: "Requests schools sent to the platform team.",
      action: <InlineLink onClick={() => onTab("requests")}>Answer</InlineLink>,
    });
  if (data.queues.openFeedback)
    needs.push({
      id: "feedback",
      title: `${data.queues.openFeedback} new feedback ${data.queues.openFeedback === 1 ? "report" : "reports"}`,
      detail: "Sent from inside Spectra and not read yet.",
      tone: "quiet",
      action: <InlineLink onClick={() => onTab("requests")}>Read</InlineLink>,
    });
  return needs;
}

const PLATFORM_BAR_PLAN: readonly CollapseStep[] = [{ toMenu: "refresh" }];

function PlatformOverviewSurface({
  data,
  onTab,
}: {
  data: PlatformAdministrationOverview;
  onTab: (tab: Tab) => void;
}) {
  const needs = platformNeeds(data, onTab);
  const aiTokens = (data.usage.totals.model_input_tokens ?? 0) + (data.usage.totals.model_output_tokens ?? 0);
  const activity = [
    ...data.incidents.map((incident) => ({
      id: incident._id,
      label: incident.title,
      kind: "Incident",
      status: incident.status,
      at: incident.updatedAt,
    })),
    ...data.requests.map((request) => ({
      id: request._id,
      label: request.subject,
      kind: requestTypeWords(request.type),
      status: request.status,
      at: request.createdAt,
    })),
  ]
    .sort((left, right) => right.at - left.at)
    .slice(0, 8);
  const mood = data.feedback.positive + data.feedback.neutral + data.feedback.negative;
  return (
    <div className="admin-page">
      {needs.length ? (
        <section>
          <AdminSectionHeader title="Needs you" count={needs.length} />
          <div className="admin-needs">
            {needs.map((need) => (
              <div key={need.id} className="admin-need" data-tone={need.tone}>
                <div>
                  <strong>{need.title}</strong>
                  <span>{need.detail}</span>
                </div>
                {need.action}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <TallySheet>
        <MetricCard
          label="Schools"
          value={formatCompact(data.metrics.activeSchools)}
          detail="Open and in use"
          state={data.metricStates.activeSchools}
          source={metricDefinition("platform.active_schools").source}
          action={<InlineLink onClick={() => onTab("schools")}>Schools</InlineLink>}
        />
        <MetricCard
          label="People"
          value={formatCompact(data.metrics.totalUsers)}
          detail={`${formatCompact(data.metrics.activeUsers30d)} signed in this month`}
          state={data.metricStates.totalUsers}
          source={metricDefinition("platform.total_users").source}
        />
        <MetricCard
          label="Work made"
          value={formatCompact(data.metrics.artifactsCreated)}
          detail="Documents, decks, quizzes and the rest"
          state={data.metricStates.artifactsCreated}
          source={metricDefinition("platform.work_created").source}
        />
        <MetricCard
          label="Messages to Spectra"
          value={formatCompact(data.metrics.messages)}
          detail="Counted, never read"
          state={data.metricStates.messages}
          source={metricDefinition("platform.messages").source}
        />
        <MetricCard
          label="Came back this month"
          value={`${data.metrics.retentionPercent}%`}
          detail="Of everyone with an account"
          state={data.metricStates.retentionPercent}
          source={metricDefinition("platform.retention").source}
        />
      </TallySheet>

      <EmergencyStop />

      <div className="admin-columns">
        <section>
          <AdminSectionHeader
            title="Schools using the most"
            action={<InlineLink onClick={() => onTab("schools")}>All schools</InlineLink>}
          />
          {data.topSchools.length ? (
            <ul className="admin-ledger">
              {data.topSchools.slice(0, 6).map((school) => (
                <li key={school.schoolId} className="admin-line">
                  <span className="admin-line-main">
                    <strong>{school.name}</strong>
                  </span>
                  <span className="admin-line-meta">{formatCompact(school.usage)} used</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-ledger-empty">No school has used Spectra in this range yet.</p>
          )}
        </section>

        <section>
          <AdminSectionHeader title="Services" action={<InlineLink onClick={() => onTab("operations")}>Operations</InlineLink>} />
          <dl className="admin-facts">
            {data.serviceHealth.map((service) => {
              const words = serviceWords(service.status);
              return (
                <div key={service.service}>
                  <dt>{service.service}</dt>
                  <dd data-tone={words.needs ? "attention" : undefined}>{words.label}</dd>
                </div>
              );
            })}
            <div>
              <dt>Files stored</dt>
              <dd>{formatBytes(data.storageBytes)}</dd>
            </div>
            <div>
              <dt>AI used this month</dt>
              <dd>{formatCompact(aiTokens)} tokens</dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="admin-columns">
        <section>
          <AdminSectionHeader
            title="Recent requests and incidents"
            action={<InlineLink onClick={() => onTab("security")}>Audit log</InlineLink>}
          />
          {activity.length ? (
            <ul className="admin-ledger">
              {activity.map((row) => (
                <li key={row.id} className="admin-line">
                  <span className="admin-line-main">
                    <strong>{row.label}</strong>
                    <span>
                      {row.kind}, {row.status.replaceAll("_", " ")}
                    </span>
                  </span>
                  <span className="admin-line-meta">{formatRelative(row.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-ledger-empty">No school has asked for anything, and nothing has gone wrong.</p>
          )}
        </section>

        <section>
          <AdminSectionHeader
            title="How people feel"
            count={mood || undefined}
            action={<InlineLink onClick={() => onTab("requests")}>Feedback</InlineLink>}
          />
          {mood ? (
            <dl className="admin-facts">
              <div>
                <dt>Happy</dt>
                <dd>{formatCompact(data.feedback.positive)}</dd>
              </div>
              <div>
                <dt>Mixed</dt>
                <dd>{formatCompact(data.feedback.neutral)}</dd>
              </div>
              <div>
                <dt>Unhappy</dt>
                <dd data-tone={data.feedback.negative ? "attention" : undefined}>{formatCompact(data.feedback.negative)}</dd>
              </div>
            </dl>
          ) : (
            <p className="admin-ledger-empty">No feedback in this range.</p>
          )}
        </section>
      </div>

      <section>
        <AdminSectionHeader title="Day by day" detail="Every school together." />
        <UsageDayChart series={data.usage.series} through={data.usage.completeThrough} />
      </section>

      <PrivacyNotice>
        The platform pages count; they never read. Nobody’s work, threads, prompts or memory can be opened from here.
      </PrivacyNotice>
    </div>
  );
}

export function SuperadminShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab") as Tab | null;
  const [tab, setTabState] = useState<Tab>(
    requestedTab && tabs.some((item) => item.id === requestedTab)
      ? requestedTab
      : "overview",
  );
  const [overview, setOverview] =
    useState<PlatformAdministrationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [draft, setDraft] = useState<PlatformDraft | null>(null);
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
      <main className="spectra-wave-y relative isolate h-full min-h-0 flex-1 overflow-y-auto" data-spectra-app-surface="true">
        <PageBody>
          <PageHeader title="Superadmin" />
          {loading ? (
            <LoadingRows label="Opening superadmin" count={6} className="mt-6" />
          ) : error ? (
            <div className="mt-6">
              <ErrorPanel message={error} retry={() => void load()} />
            </div>
          ) : null}
        </PageBody>
      </main>
    );

  const needs = platformNeeds(overview, setTab).length;
  const commands: BarCommand[] = [
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
    <main className="spectra-wave-y relative isolate h-full min-h-0 flex-1 overflow-y-auto" data-spectra-app-surface="true">
      <PageBody>
        <PageHeader
          title="Platform"
          commands={commands}
          plan={PLATFORM_BAR_PLAN}
          barLabel="Platform commands"
          description={`${formatCompact(overview.metrics.activeSchools)} ${overview.metrics.activeSchools === 1 ? "school" : "schools"}, the last 30 days. ${needs ? (needs === 1 ? "One thing needs you." : "A few things need you.") : "Nothing needs you right now."}`}
        />
        <PanelTabs
          label="Platform sections"
          tabs={tabs}
          value={tab}
          onChange={(id) => setTab(id as Tab)}
          primaryCount={6}
          className="mb-8 mt-4"
        />
        {tab === "overview" ? (
          <PlatformOverviewSurface data={overview} onTab={setTab} />
        ) : (
          <PlatformTab
            tab={tab}
            overview={overview}
            refreshKey={refreshKey}
            onRefresh={() => setRefreshKey((value) => value + 1)}
            draft={draft}
            onDraft={(next) => {
              setDraft(next);
              if (next) setTab("messages");
            }}
          />
        )}
      </PageBody>
    </main>
  );
}

function PlatformTab({
  tab,
  overview,
  refreshKey,
  onRefresh,
  draft,
  onDraft,
}: {
  tab: Exclude<Tab, "overview">;
  overview: PlatformAdministrationOverview;
  refreshKey: number;
  onRefresh: () => void;
  /** A message already addressed, as a school's "Message its admins" leaves it. */
  draft: PlatformDraft | null;
  onDraft: (draft: PlatformDraft | null) => void;
}) {
  if (tab === "schools")
    return (
      <SchoolsSurface
        refreshKey={refreshKey}
        onRefresh={onRefresh}
        onMessageAdmins={(school) => onDraft({ audience: "admins", schoolIds: [school.schoolId], schoolName: school.name })}
      />
    );
  if (tab === "messages")
    return <PlatformMessagesSurface refreshKey={refreshKey} draft={draft} onDraftUsed={() => onDraft(null)} />;
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

const REQUEST_STATUS_WORDS: Record<string, string> = {
  open: "New",
  acknowledged: "Seen",
  in_progress: "Being worked on",
  resolved: "Done",
  closed: "Closed",
};

const SEVERITY_WORDS: Record<"minor" | "major" | "critical", string> = {
  minor: "Minor",
  major: "Major",
  critical: "Critical",
};

const ONBOARDING_WORDS: Record<OnboardingSaga["status"], string> = {
  reserved: "Name kept",
  invited: "Invitation sent",
  ready: "Ready",
  failed: "Stuck",
  cancelled: "Cancelled",
};

const INTEGRATION_WORDS: Record<string, string> = {
  connected: "Connected",
  validating: "Checking the key",
  degraded: "Partly working",
  blocked: "Stopped",
  revoked: "Key withdrawn",
  disconnected: "Disconnected",
  none: "Not connected",
};

const LIMIT_WORDS: Record<SchoolRow["limitEnforcement"], string> = {
  disabled: "no limits",
  simulate: "limits being tried out",
  enforced: "limits on",
};

function SchoolsSurface({
  refreshKey,
  onRefresh,
  onMessageAdmins,
}: {
  refreshKey: number;
  onRefresh: () => void;
  onMessageAdmins: (school: { schoolId: string; name: string }) => void;
}) {
  const [detailSchool, setDetailSchool] = useState<SchoolRow | null>(null);
  const router = useRouter();
  const [schools, setSchools] = useState<SchoolRow[]>([]);
  const [onboarding, setOnboarding] = useState<OnboardingSaga[]>([]);
  const [loading, setLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState("");
  const [directoryRetry, setDirectoryRetry] = useState(0);
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
  const [invitationDelivered, setInvitationDelivered] = useState(false);
  const [label, setLabel] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState("inspect");
  const [duration, setDuration] = useState("30");
  const [busy, setBusy] = useState("");
  const [cancelOnboarding, setCancelOnboarding] =
    useState<OnboardingSaga | null>(null);
  const [cancelOnboardingReason, setCancelOnboardingReason] = useState("");

  useEffect(() => {
    let current = true;
    setLoading(true);
    setDirectoryError("");
    void Promise.all([
      getAdministration<{ schools: SchoolRow[] }>("schoolDirectory", {
        includeInactive: true,
        search,
      }),
      getAdministration<{ sagas: OnboardingSaga[] }>("onboardingSagas"),
    ])
      .then(([schoolRows, sagaRows]) => {
        if (!current) return;
        setSchools(schoolRows.schools);
        setOnboarding(sagaRows.sagas);
      })
      .catch((error: unknown) => {
        if (current) setDirectoryError(describeFailure(error, {
          fallback: "Check your connection, then try reading the schools again.",
        }).message);
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [refreshKey, search, directoryRetry]);

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
        setInvitationDelivered(result.delivery.status === "sent");
        if (result.delivery.status !== "sent") {
          toast.warning(
            result.delivery.reason ??
              "Email delivery is unavailable. Deliver the secure invitation manually.",
          );
        }
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
        `Stepped into ${sessionSchool.name}.`,
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
          label: `Limits for ${limitSchool.name}`,
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

  const settingUp = onboarding.filter((saga) => ["reserved", "invited", "failed"].includes(saga.status));
  const members = schools.reduce((sum, school) => sum + school.members, 0);
  return (
    <>
      <div className="admin-page">
        {settingUp.length ? (
          <section>
            <AdminSectionHeader
              title="Being set up"
              count={settingUp.length}
              detail="Schools waiting for their first administrator to accept the invitation."
            />
            <ul className="admin-ledger">
              {settingUp.map((saga) => (
                <li key={saga.sagaId} className="admin-line">
                  <span className="admin-line-main">
                    <strong>{saga.schoolName}</strong>
                    <span>
                      First administrator: {saga.initialAdminEmail}, {formatRelative(saga.updatedAt).toLowerCase()}
                    </span>
                    {saga.errorSummary ? <p className="text-[var(--danger)]">{saga.errorSummary}</p> : null}
                  </span>
                  <span className="admin-line-meta" data-tone={saga.status === "failed" ? "danger" : undefined}>
                    {ONBOARDING_WORDS[saga.status]}
                  </span>
                  {["reserved", "invited"].includes(saga.status) ? (
                    <InlineLink
                      onClick={() => {
                        setCancelOnboarding(saga);
                        setCancelOnboardingReason("");
                      }}
                    >
                      Cancel
                    </InlineLink>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <AdminSectionHeader
            title="Schools"
            count={loading || directoryError ? undefined : schools.length}
            detail={`${loading || directoryError ? "" : `${formatCompact(members)} ${members === 1 ? "person" : "people"} across them. `}Details shows who runs a school and what its admins changed. Step into a school to see its admin pages as its administrators do; every visit has a reason, ends on its own and is recorded.`}
            action={<InlineLink onClick={() => setCreateOpen(true)}>Add school</InlineLink>}
          />
          <SearchField value={search} onChange={setSearch} label="Search schools" placeholder="Find a school by name or web address" className="mb-3 max-w-md" />
          {directoryError ? <ErrorPanel message={directoryError} retry={() => setDirectoryRetry(value => value + 1)} /> : null}
          {loading && !schools.length ? (
            <LoadingPanel label="Reading schools" />
          ) : schools.length ? (
            <ul className="admin-ledger">
              {schools.map((school) => (
                <li key={school.schoolId} className="admin-line">
                  <span className="admin-line-main">
                    <strong>{school.name}</strong>
                    <span>
                      {formatCompact(school.members)} {school.members === 1 ? "member" : "members"}, ManageBac{" "}
                      {(INTEGRATION_WORDS[school.integrationStatus] ?? school.integrationStatus.replaceAll("_", " ")).toLowerCase()},{" "}
                      {LIMIT_WORDS[school.limitEnforcement]}
                    </span>
                  </span>
                  {school.status !== "active" ? (
                    <span className="admin-line-meta" data-tone="attention">
                      {school.status === "suspended" ? "Paused" : "Archived"}
                    </span>
                  ) : null}
                  <InlineLink onClick={() => setDetailSchool(school)}>Details</InlineLink>
                  <InlineLink
                    onClick={() => {
                      setLimitSchool(school);
                      setLimitRules(school.limitRules);
                      setLimitEnforcement(school.limitEnforcement);
                      setLimitReason("");
                      setLimitConfirmation("");
                      setLimitSimulation(null);
                    }}
                  >
                    Limits
                  </InlineLink>
                  <InlineLink
                    onClick={() => {
                      setSessionSchool(school);
                      setLabel(`Support for ${school.name}`);
                    }}
                  >
                    Step in
                  </InlineLink>
                </li>
              ))}
            </ul>
          ) : !loading && !directoryError ? (
            <p className="admin-ledger-empty">{search ? "No school matches that." : "No schools yet. Add the first one."}</p>
          ) : null}
        </section>
      </div>

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
        detail={`${invitationDelivered ? "The invitation email was accepted. You can also share this link with the administrator." : "The invitation email was not sent. Share this link with the administrator to continue."} This link is single-use, email-bound, and expires automatically.`}
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
        title={`Limits for ${limitSchool?.name ?? "the school"}`}
        detail="Limits start off. Try them out first to see what would have been stopped. When they are on, new AI requests stop once the AI limit is reached for the day, month or all time; the other limits only warn. Saving is recorded in the school’s activity log."
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
              Save limits
            </AdminButton>
          </>
        }
        danger={limitEnforcement === "enforced"}
      >
        <div className="space-y-4">
          <SelectField
            label="Limits are"
            value={limitEnforcement}
            onChange={(value) =>
              setLimitEnforcement(value as "disabled" | "simulate" | "enforced")
            }
            options={[
              {
                value: "disabled",
                label: "Off: count usage, stop nothing",
              },
              {
                value: "simulate",
                label: "Tried out: show what would stop, stop nothing",
              },
              {
                value: "enforced",
                label: "On: stop new AI requests at the limit",
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
                  label="What"
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
                    { value: "storage_bytes", label: "Files stored (bytes)" },
                    { value: "bandwidth_bytes", label: "Downloads (bytes)" },
                    { value: "model_tokens", label: "AI (tokens)" },
                    {
                      value: "render_milliseconds",
                      label: "Rendering (ms)",
                    },
                    {
                      value: "collaboration_bytes",
                      label: "Live editing (bytes)",
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
            label="Why"
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
                    toast.success("School setup cancelled.");
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
              Cancel setup
            </AdminButton>
          </>
        }
        danger
      >
        <TextAreaField
          label="Why"
          value={cancelOnboardingReason}
          onChange={setCancelOnboardingReason}
          rows={4}
        />
      </AdminDialog>

      <SchoolDetailDialog
        school={detailSchool}
        onClose={() => setDetailSchool(null)}
        onMessageAdmins={(school) => {
          setDetailSchool(null);
          onMessageAdmins(school);
        }}
        onStepIn={() => {
          if (!detailSchool) return;
          setSessionSchool(detailSchool);
          setLabel(`Support for ${detailSchool.name}`);
          setDetailSchool(null);
        }}
      />

      <AdminDialog
        open={Boolean(sessionSchool)}
        onClose={() => setSessionSchool(null)}
        title={`Step into ${sessionSchool?.name ?? "the school"}`}
        detail="You see the school’s admin pages, not anyone’s work, and you do not become a member. A banner stays on screen while you are in, and the school’s activity log records the visit."
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
              Step in
            </AdminButton>
          </>
        }
      >
        <form
          id="operator-session-form"
          onSubmit={(event) => void startSession(event)}
          className="space-y-4"
        >
          <TextField label="What it’s for" value={label} onChange={setLabel} />
          <TextAreaField
            label="Why you need to step in"
            value={reason}
            onChange={setReason}
            rows={4}
            placeholder="At least a sentence. The school can read it in its activity log."
          />
          <SelectField
            label="What you can do"
            value={mode}
            onChange={setMode}
            options={[
              { value: "inspect", label: "Look only" },
              { value: "manage", label: "Look and change things" },
            ]}
          />
          <SelectField
            label="For how long"
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
  const openIncidents = overview.incidents.filter((incident) => incident.status !== "resolved");
  return (
    <>
      <div className="admin-page">
        <TallySheet>
          <MetricCard
            label="Open incidents"
            value={formatCompact(openIncidents.length)}
            detail="Not marked fixed yet"
            attention={openIncidents.length > 0}
          />
          <MetricCard
            label="ManageBac problems"
            value={formatCompact(overview.queues.integrationErrors)}
            detail="Schools whose connection is stopped or partly working"
            attention={overview.queues.integrationErrors > 0}
          />
          <MetricCard
            label="Failed AI turns"
            value={formatCompact(overview.queues.failedRuns24h)}
            detail="In the last 24 hours"
            state={overview.metricStates.failedRuns24h}
            attention={Boolean(overview.queues.failedRuns24h)}
          />
          <MetricCard
            label="Waiting schools"
            value={formatCompact(overview.queues.openRequests)}
            detail="Requests not answered yet"
            state={overview.metricStates.openRequests}
          />
        </TallySheet>

        <div className="admin-columns">
          <section>
            <AdminSectionHeader
              title="Incidents"
              count={openIncidents.length || undefined}
              detail="Something wrong on the platform, from first noticing it to fixed."
              action={<InlineLink onClick={() => setOpen(true)}>Open an incident</InlineLink>}
            />
            {overview.incidents.length ? (
              <ul className="admin-ledger">
                {overview.incidents.map((incident) => (
                  <li key={incident._id} className="admin-line">
                    <span className="admin-line-main">
                      <strong>{incident.title}</strong>
                      <p>{incident.summary}</p>
                      <span>
                        {SEVERITY_WORDS[incident.severity]}
                        {incident.affectedServices.length ? `, affects ${incident.affectedServices.join(", ")}` : ""},{" "}
                        {formatRelative(incident.updatedAt).toLowerCase()}
                      </span>
                    </span>
                    <SelectField
                      ariaLabel={`Where ${incident.title} stands`}
                      size="sm"
                      value={incident.status}
                      disabled={busy === incident._id}
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
                              describeFailure(error, { fallback: "The incident did not change. Try again." }).message,
                            ),
                          )
                          .finally(() => setBusy(""));
                      }}
                      options={[
                        { value: "investigating", label: "Looking into it" },
                        { value: "identified", label: "Cause found" },
                        { value: "monitoring", label: "Fixed, watching" },
                        { value: "resolved", label: "Fixed" },
                      ]}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-ledger-empty">Nothing is wrong right now.</p>
            )}
          </section>

          <section>
            <AdminSectionHeader title="Services" />
            <dl className="admin-facts">
              {overview.serviceHealth.map((service) => {
                const words = serviceWords(service.status);
                return (
                  <div key={service.service}>
                    <dt>{service.service}</dt>
                    <dd data-tone={words.needs ? "attention" : undefined}>{words.label}</dd>
                  </div>
                );
              })}
            </dl>
            <p className="admin-footnote mt-3">“Nothing counted yet” means the service has not recorded any use in this range, so it cannot say it works.</p>
          </section>
        </div>
      </div>
      <AdminDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Open an incident"
        detail="Say what is wrong and what it affects. Only the platform team sees incidents."
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
            label="What is wrong"
            value={summary}
            onChange={setSummary}
            rows={5}
          />
          <TextField
            label="What it affects (separate with commas)"
            value={services}
            onChange={setServices}
          />
          <SelectField
            label="Severity"
            value={severity}
            onChange={setSeverity}
            options={[
              { value: "minor", label: "Minor: a few people notice" },
              { value: "major", label: "Major: many people are stuck" },
              { value: "critical", label: "Critical: Spectra is down" },
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
  const { totals, series, completeThrough } = overview.usage;
  return (
    <div className="admin-page">
      <section>
        <AdminSectionHeader
          title="The last 30 days"
          detail={`Every school together, counted up to ${completeThrough}. Each school sees only its own numbers.`}
        />
        <TallySheet>
          {USAGE_METERS.map((item) => (
            <MetricCard
              key={item.key}
              label={item.label}
              value={formatMeter(item.key === "storage_bytes" ? overview.storageBytes : totals[item.key], item.unit)}
              detail={item.detail}
            />
          ))}
        </TallySheet>
      </section>
      <section>
        <AdminSectionHeader title="Day by day" />
        <UsageDayChart series={series} through={completeThrough} />
      </section>
      <PrivacyNotice>
        Using a lot never stops a school on its own. Limits are off unless the platform team turns them on for a school, and they can be tried out first without blocking anything.
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
      <div className="admin-page">
        <LandingInbox />
        <FeedbackInbox />
        <section>
          <AdminSectionHeader
            title="School requests"
            count={loading ? undefined : requests.length}
            detail="What schools asked the platform team for, most urgent first. The school reads your answer."
          />
          {loading ? (
            <LoadingPanel label="Reading requests" />
          ) : requests.length ? (
            <ul className="admin-ledger">
              {requests.map((request) => (
                <li key={request.requestId}>
                  <button
                    type="button"
                    className="admin-line"
                    onClick={() => {
                      setSelected(request);
                      setStatus(request.status === "open" ? "acknowledged" : request.status);
                      setResponse(request.response ?? "");
                    }}
                  >
                    <span className="admin-line-main">
                      <strong>{request.subject}</strong>
                      <span>
                        {request.school?.name ?? "No school"}, from {request.requester?.name ?? "someone who has left"}
                        {request.responseDueAt ? `, answer due ${formatRelative(request.responseDueAt).toLowerCase()}` : ""}
                      </span>
                    </span>
                    <span
                      className="admin-line-meta"
                      data-tone={request.priority === "urgent" ? "danger" : request.priority === "high" ? "attention" : undefined}
                    >
                      {REQUEST_STATUS_WORDS[request.status] ?? request.status.replaceAll("_", " ")}
                      {request.priority === "urgent" || request.priority === "high" ? `, ${request.priority}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-ledger-empty">No school is waiting on you.</p>
          )}
        </section>
      </div>
      <AdminDialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.subject ?? "Request"}
        detail={
          selected
            ? `${selected.school?.name ?? "No school"}, ${requestTypeWords(selected.type).toLowerCase()}, ${selected.priority} priority`
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
                    toast.success("Answer sent.");
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
              Send answer
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
              label="Where it stands"
              value={status}
              onChange={setStatus}
              options={[
                { value: "acknowledged", label: REQUEST_STATUS_WORDS.acknowledged },
                { value: "in_progress", label: REQUEST_STATUS_WORDS.in_progress },
                { value: "resolved", label: REQUEST_STATUS_WORDS.resolved },
                { value: "closed", label: REQUEST_STATUS_WORDS.closed },
              ]}
            />
            <TextAreaField
              label="Your answer, which the school reads"
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
  return (
    <div className="admin-page">
      <section>
        <AdminSectionHeader
          title="What the platform team promises"
          detail="Running Spectra means keeping it up and safe. It never means deciding which parts of Spectra people may use."
        />
        <ul className="admin-ledger">
          {PROMISES.map((promise) => (
            <li key={promise.title} className="admin-line">
              <span className="admin-line-main">
                <strong>{promise.title}</strong>
                <p>{promise.detail}</p>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <AdminSectionHeader title="What the platform team looks after" />
        <p className="max-w-[64ch] text-ui leading-6 text-[var(--text-secondary)]">
          Keeping Spectra running, incidents, adding and closing schools, keys, the law around data, counting usage, and
          the AI providers. Permissions, privacy and the sandbox that runs apps are safety walls, never a switch a school
          or the platform team flips to take something away from students or teachers.
        </p>
      </section>
      <PrivacyNotice>
        Nobody on the platform team can open anyone’s prompts, threads, memory or work from these pages. School admins
        work under the same promises.
      </PrivacyNotice>
    </div>
  );
}

const PROMISES = [
  {
    title: "The AI is the same for everyone",
    detail: "The team tunes quality, reliability and cost, never what a student or teacher is allowed to ask for.",
  },
  {
    title: "Memory belongs to the person",
    detail: "Spectra remembers by default, only what its owner may see, and its owner controls it, not their school.",
  },
  {
    title: "Everyone can make anything",
    detail: "Documents, decks, apps, agents, imports and exports are open to every role.",
  },
  {
    title: "Apps run safely",
    detail: "Apps people build run walled off, with their own keys, asking before they act and leaving a record, instead of schools keeping lists of what is allowed.",
  },
] as const;

const JOB_WORDS: Record<LifecycleJob["type"], string> = {
  activate: "Open",
  suspend: "Pause",
  export: "Export",
  offboard: "Close",
  purge: "Delete",
};

const JOB_STATUS_WORDS: Record<string, string> = {
  draft: "Draft",
  awaiting_approval: "Waiting for a second person",
  queued: "About to run",
  running: "Running",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

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
  const schoolName = (id: string) => schools.find((school) => school.schoolId === id)?.name ?? "a school";
  const waiting = jobs.filter((job) => job.status === "awaiting_approval").length;
  // Opening a page is recorded too, but a list of "opened" buries the actions that matter.
  const sensitive = securityLog.events.filter((event) => !event.action.endsWith(".viewed")).slice(0, 12);

  function jobAction(job: LifecycleJob) {
    if (job.status === "awaiting_approval")
      return (
        <>
          <InlineLink
            disabled={busy === job.jobId}
            onClick={() => {
              setBusy(job.jobId);
              void mutateAdministration("approveLifecycle", { jobId: job.jobId })
                .then(() => {
                  toast.success("Approved.");
                  onRefresh();
                })
                .catch((error) =>
                  toast.error(describeFailure(error, { fallback: "It was not approved. Try again." }).message),
                )
                .finally(() => setBusy(""));
            }}
          >
            Approve
          </InlineLink>
          <InlineLink
            onClick={() => {
              setCancelJob(job);
              setCancelReason("");
            }}
          >
            Cancel
          </InlineLink>
        </>
      );
    if (job.type === "purge" && job.status === "queued")
      return (
        <InlineLink
          tone="attention"
          onClick={() => {
            setCancelJob(job);
            setCancelReason("");
          }}
        >
          Stop before it deletes
        </InlineLink>
      );
    if (job.type === "export" && job.status === "completed") {
      if (exportLinks?.jobId === job.jobId)
        return (
          <span className="flex flex-wrap justify-end gap-3">
            {[
              { label: "Contents", url: exportLinks.url },
              ...exportLinks.parts.map((part) => ({ label: `Part ${part.index + 1}: ${part.section}`, url: part.url })),
            ].map((link) => (
              <a key={link.url} className="admin-link" href={link.url} rel="noopener noreferrer" target="_blank">
                {link.label}
              </a>
            ))}
          </span>
        );
      return (
        <InlineLink
          disabled={busy === job.jobId}
          onClick={() => {
            setBusy(job.jobId);
            void getAdministration<{
              url: string;
              parts?: { index: number; section: string; url: string }[];
            }>("lifecycleExport", { jobId: job.jobId })
              .then(({ url, parts = [] }) => {
                // A large export is a manifest plus parts, so list every file
                // instead of opening one.
                if (parts.length > 0) setExportLinks({ jobId: job.jobId, url, parts });
                else window.open(url, "_blank", "noopener,noreferrer");
              })
              .catch((error) =>
                toast.error(describeFailure(error, { fallback: "The export did not download. Try again." }).message),
              )
              .finally(() => setBusy(""));
          }}
        >
          Download
        </InlineLink>
      );
    }
    return null;
  }

  return (
    <>
      <div className="admin-page">
        <section>
          <AdminSectionHeader
            title="School changes"
            count={loading ? undefined : jobs.length}
            detail="Opening, pausing, exporting, closing and deleting a school. Closing and deleting need a second person on the platform team, and can be stopped while they wait."
            action={<InlineLink onClick={() => setOpen(true)}>Change a school</InlineLink>}
          />
          {waiting ? (
            <div className="admin-needs mb-4">
              <div className="admin-need">
                <div>
                  <strong>
                    {waiting} {waiting === 1 ? "change is" : "changes are"} waiting for a second person
                  </strong>
                  <span>Someone else on the platform team asked for it; you can approve or cancel.</span>
                </div>
              </div>
            </div>
          ) : null}
          {loading ? (
            <LoadingPanel label="Reading school changes" />
          ) : jobs.length ? (
            <ul className="admin-ledger">
              {jobs.map((job) => (
                <li key={job.jobId} className="admin-line">
                  <span className="admin-line-main">
                    <strong>
                      {JOB_WORDS[job.type]} {schoolName(job.schoolId)}
                    </strong>
                    <span>
                      {job.impact.activeMembers} {job.impact.activeMembers === 1 ? "member" : "members"}, {job.impact.artifacts}
                      {job.impact.artifactsAtLeast ? "+" : ""} pieces of work, {job.impact.workspaces}{" "}
                      {job.impact.workspaces === 1 ? "class" : "classes"}
                      {job.purge
                        ? `. ${formatCompact(job.purge.deletedRows)} records deleted so far`
                        : job.reversibleUntil
                          ? `. Can be undone until ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(job.reversibleUntil)}`
                          : ""}
                    </span>
                    {job.errorSummary ? <p className="text-[var(--danger)]">{job.errorSummary}</p> : null}
                  </span>
                  <span
                    className="admin-line-meta"
                    data-tone={job.status === "failed" ? "danger" : job.status === "awaiting_approval" ? "attention" : undefined}
                  >
                    {JOB_STATUS_WORDS[job.status] ?? job.status.replaceAll("_", " ")}, {formatRelative(job.createdAt).toLowerCase()}
                  </span>
                  {jobAction(job)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-ledger-empty">No school has been opened, paused, exported or closed from here yet.</p>
          )}
        </section>

        <div className="admin-columns">
          <section>
            <AdminSectionHeader
              title="Visits to schools"
              detail="Every time someone on the platform team stepped into a school."
            />
            {securityLog.sessions.length ? (
              <ul className="admin-ledger">
                {securityLog.sessions.slice(0, 12).map((session) => {
                  const active = !session.revokedAt && session.expiresAt > now;
                  return (
                    <li key={session.sessionId} className="admin-line">
                      <span className="admin-line-main">
                        <strong>{session.school.name}</strong>
                        <span>
                          {session.operator?.name ?? session.operator?.email ?? "Someone who has left"}: {session.reason || session.label}
                        </span>
                      </span>
                      <span className="admin-line-meta" data-tone={active ? "attention" : undefined}>
                        {active ? (session.mode === "manage" ? "In now, can change" : "In now, looking") : formatRelative(session.createdAt)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="admin-ledger-empty">Nobody has stepped into a school yet.</p>
            )}
          </section>
          <section>
            <AdminSectionHeader
              title="Sensitive actions"
              detail="Keys, approvals and other actions that need a record. Who opened which page is kept in the log but left out here."
            />
            {sensitive.length ? (
              <ul className="admin-ledger">
                {sensitive.map((event) => (
                  <li key={event.eventId} className="admin-line">
                    <span className="admin-line-main">
                      <strong>{auditActionWords(event.action)}</strong>
                      <span>
                        {event.actor?.name ?? event.actor?.email ?? "Spectra"}
                        {event.school ? `, ${event.school.name}` : ""}
                      </span>
                    </span>
                    <span className="admin-line-meta">{formatRelative(event.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="admin-ledger-empty">Nothing sensitive has happened yet.</p>
            )}
          </section>
        </div>
        <PrivacyNotice>
          The log keeps who did what and when, never what anyone wrote: no keys, prompts, threads, memory or pieces of work.
        </PrivacyNotice>
      </div>
      <AdminDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Change a school"
        detail="Closing and deleting take effect only after a second person on the platform team approves, and you type the school’s web name to confirm."
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
                    toast.success("Change asked for.");
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
              Ask for the change
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
                label: school.status === "active" ? school.name : `${school.name} (${school.status === "suspended" ? "paused" : "archived"})`,
              })),
            ]}
          />
          <SelectField
            label="What to do"
            value={type}
            onChange={setType}
            options={[
              { value: "activate", label: "Open it again" },
              { value: "suspend", label: "Pause it: nobody can sign in" },
              { value: "export", label: "Export everything" },
              { value: "offboard", label: "Close it" },
              { value: "purge", label: "Delete it for good, once its keeping period ends" },
            ]}
          />
          <TextAreaField
            label="Why"
            value={reason}
            onChange={setReason}
            rows={4}
          />
          {type === "offboard" || type === "purge" ? (
            <>
              <div className="rounded-control border border-[color-mix(in_oklab,var(--accent-coral)_28%,var(--bg-elevated))] bg-[color-mix(in_oklab,var(--accent-coral)_8%,var(--bg-elevated))] p-3 text-micro leading-4 text-[var(--danger)]">
                This changes who can sign in, the ManageBac connection and the school’s kept data. Nothing happens
                until someone else on the platform team approves it.
              </div>
              <TextField
                label={`Type ${selectedSchool?.slug ?? "the school’s web name"} to confirm`}
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
        title="Stop this change"
        detail="Stopping it now puts the school back as it was. The change and your reason stay in the log."
        footer={
          <>
            <AdminButton onClick={() => setCancelJob(null)}>
              Let it go ahead
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
                    toast.success("Change stopped.");
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
              Stop the change
            </AdminButton>
          </>
        }
        danger
      >
        <TextAreaField
          label="Why"
          value={cancelReason}
          onChange={setCancelReason}
          rows={4}
        />
      </AdminDialog>
    </>
  );
}
