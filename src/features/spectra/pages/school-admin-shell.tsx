"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  Archive,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Building2,
  Check,
  ChevronDown,
  CircleGauge,
  Database,
  FileClock,
  Folder,
  HardDrive,
  Inbox,
  KeyRound,
  LayoutGrid,
  LockKeyhole,
  Mail,
  MessageCircle,
  Network,
  Plus,
  RefreshCw,
  Save,
  School,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  getAdministration,
  mutateAdministration,
  type SchoolAdministrationOverview,
} from "@/features/spectra/administration/api";
import { metricDefinition } from "@/features/spectra/administration/metric-registry";
import { AuxiliaryRail, AuxiliaryRailTrigger } from "@/features/spectra/components/auxiliary-rail";
import { ProductPageHeader } from "@/features/spectra/components/product-page-header";
import { ProductSectionNav } from "@/features/spectra/components/product-section-nav";
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
  Sparkline,
  StatusBadge,
  statusToneFor,
  TextAreaField,
  TextField,
} from "@/features/spectra/administration/shared";

const MEMBER_ROLE_OPTIONS = [
  { value: "student", label: "Student" },
  { value: "teacher", label: "Teacher" },
  { value: "school_admin", label: "School admin" },
] as const;

const MEMBER_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  // `invited` is set by sending an invitation, never by an administrator
  // picking it, but it has to be visible or a pending member's row would show
  // no status at all.
  { value: "invited", label: "Invited", disabled: true },
  { value: "suspended", label: "Suspended" },
  { value: "ended", label: "Ended" },
] as const;

type Tab =
  | "overview"
  | "people"
  | "groups"
  | "communication"
  | "usage"
  | "agents"
  | "integrations"
  | "governance"
  | "feedback"
  | "profile"
  | "audit";

const tabs: Array<{ key: Tab; label: string; icon: typeof School }> = [
  { key: "overview", label: "Overview", icon: LayoutGrid },
  { key: "people", label: "People", icon: Users },
  { key: "groups", label: "Groups", icon: UsersRound },
  { key: "communication", label: "Communication", icon: Mail },
  { key: "usage", label: "Usage", icon: BarChart3 },
  { key: "agents", label: "Agents & resources", icon: Bot },
  { key: "integrations", label: "Integrations", icon: Network },
  { key: "governance", label: "Governance", icon: ShieldCheck },
  { key: "feedback", label: "Feedback", icon: MessageCircle },
  { key: "profile", label: "School profile", icon: School },
  { key: "audit", label: "Audit", icon: FileClock },
];

type Person = {
  membershipId: string;
  accountId: string;
  name: string;
  email: string;
  avatarUrl?: string;
  role: "student" | "teacher" | "school_admin";
  status: "active" | "invited" | "suspended" | "ended";
  joinedAt?: number;
  lastSeenAt?: number;
};

type Invitation = {
  invitationId: string;
  email: string;
  role: string;
  status: string;
  expiresAt: number;
  createdAt: number;
};

type SchoolGroup = {
  groupId: string;
  name: string;
  description?: string;
  type: string;
  source: "manual" | "managebac";
  memberCount: number;
  updatedAt: number;
};

type Announcement = {
  announcementId: string;
  title: string;
  targetKind: string;
  targetIds: string[];
  audienceSnapshotCount: number;
  status: string;
  scheduledAt?: number;
  sentAt?: number;
  delivered: number;
  read: number;
  failed: number;
  createdAt: number;
};

type FeedbackItem = {
  feedbackId: string;
  reporter: { name: string; email: string } | null;
  category: string;
  sentiment: string;
  subject: string;
  message: string;
  status: string;
  response?: string;
  createdAt: number;
  updatedAt: number;
};

type AuditEvent = {
  eventId: string;
  actorAccountId?: string;
  operatorSessionId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, string | number | boolean | null>;
  createdAt: number;
};

function actionLabel(value: string) {
  return value
    .replaceAll(".", " · ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dateRange() {
  return {
    fromDay: new Date(Date.now() - 29 * 24 * 60 * 60_000)
      .toISOString()
      .slice(0, 10),
    toDay: new Date().toISOString().slice(0, 10),
  };
}

function OverviewSurface({
  data,
  onTab,
}: {
  data: SchoolAdministrationOverview;
  onTab: (tab: Tab) => void;
}) {
  const series = data.usage.series.map(
    (point) =>
      Object.values(point.values).reduce((sum, value) => sum + value, 0) || 0,
  );
  const [contextOpen, setContextOpen] = useState(true);
  return (
    <div className={cn("grid min-w-0 gap-3", contextOpen && "xl:grid-cols-[minmax(0,1fr)_auto]")}>
      <div className="min-w-0 space-y-3">
        {!contextOpen ? <div className="flex justify-end"><AuxiliaryRailTrigger label="School context" onOpen={() => setContextOpen(true)} /></div> : null}
        <div className="grid gap-1 sm:grid-cols-2 2xl:grid-cols-4">
          <MetricCard
            icon={Users}
            label="Members"
            value={formatCompact(data.metrics.members)}
            detail={`${data.metrics.active30d} active in 30 days`}
            tone="green"
            state={data.metricStates.members}
            source={metricDefinition("school.members").source}
            action={
              <AdminButton className="w-full" onClick={() => onTab("people")}>
                Manage members
              </AdminButton>
            }
          />
          <MetricCard
            icon={Mail}
            label="Invitations"
            value={formatCompact(data.metrics.invitations)}
            detail={`${data.metrics.invitations} awaiting response`}
            tone="violet"
            state={data.metricStates.invitations}
            source={metricDefinition("school.invitations").source}
            action={
              <AdminButton className="w-full" onClick={() => onTab("people")}>
                Review invites
              </AdminButton>
            }
          />
          <MetricCard
            icon={ShieldCheck}
            label="Pending approvals"
            value={formatCompact(data.metrics.pendingApprovals)}
            detail="Support and operational requests"
            tone="orange"
            state={data.metricStates.pendingApprovals}
            source={metricDefinition("school.pending_approvals").source}
            action={
              <AdminButton
                className="w-full"
                onClick={() => onTab("governance")}
              >
                Review governance
              </AdminButton>
            }
          />
          <MetricCard
            icon={Folder}
            label="Class workspaces"
            value={formatCompact(data.metrics.classWorkspaces)}
            detail={`${data.metrics.groups} active groups`}
            tone="green"
            state={data.metricStates.classWorkspaces}
            source={metricDefinition("school.class_workspaces").source}
            action={
              <AdminButton className="w-full" onClick={() => onTab("groups")}>
                View all
              </AdminButton>
            }
          />
        </div>

        <section className="mt-7">
          <AdminSectionHeader
            title="Workspace overview"
            detail="Source-linked class workspaces only; ordinary private workspaces are never inspected here."
            action={
              <InlineLink onClick={() => onTab("groups")}>View all</InlineLink>
            }
          />
          {data.groupWorkspaces.length ? (
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full min-w-[620px] text-left text-micro">
                <thead className="text-[var(--text-tertiary)]">
                  <tr>
                    <th className="pb-2 font-normal">Workspace</th>
                    <th className="pb-2 font-normal">Type</th>
                    <th className="pb-2 font-normal">Activity</th>
                    <th className="pb-2 font-normal">Usage trend</th>
                    <th className="pb-2 text-right font-normal">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {data.groupWorkspaces.map((workspace) => (
                    <tr
                      key={workspace.workspaceId}
                      className="rounded-[10px] transition-colors hover:bg-[var(--bg-secondary)]"
                    >
                      <td className="py-2.5">
                        <span className="flex items-center gap-2 font-medium text-[var(--text-primary)]">
                          <School size={13} className="text-[#755ee2]" />
                          {workspace.title}
                        </span>
                      </td>
                      <td className="py-2.5 capitalize text-[var(--text-secondary)]">
                        {workspace.type}
                      </td>
                      <td className="py-2.5 text-[var(--text-secondary)]">
                        {formatRelative(workspace.lastActivityAt)}
                      </td>
                      <td className="py-2.5">
                        <Sparkline values={series} />
                      </td>
                      <td className="py-2.5 text-right">
                        <Link
                          href={`/workspace?workspaceId=${encodeURIComponent(workspace.workspaceId)}`}
                          className="text-[#705df2] hover:underline"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyPanel
              icon={Folder}
              title="No source-linked class workspaces yet"
              detail="A verified ManageBac first sync creates class workspaces without exposing personal workspace content here."
              action={
                <Link href="/managebac">
                  <AdminButton>Open ManageBac</AdminButton>
                </Link>
              }
            />
          )}
        </section>

        <div className="mt-7 grid gap-6 lg:grid-cols-2">
          <section>
            <AdminSectionHeader
              title="Feedback inbox"
              detail={`${data.metrics.feedbackNew} new school reports`}
              action={
                <InlineLink onClick={() => onTab("feedback")}>
                  View all
                </InlineLink>
              }
            />
            {data.feedback.length ? (
              <div className="px-4 pb-4">
                {data.feedback.slice(0, 4).map((item) => (
                  <button
                    type="button"
                    key={item.feedbackId}
                    onClick={() => onTab("feedback")}
                    className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2.5 text-left transition-colors hover:bg-[var(--bg-secondary)]"
                  >
                    <ChevronDown
                      size={12}
                      className="-rotate-90 text-[var(--text-tertiary)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-micro text-[var(--text-primary)]">
                      {item.subject}
                    </span>
                    <StatusBadge
                      tone={item.status === "new" ? "attention" : "neutral"}
                    >
                      {item.category.replaceAll("_", " ")}
                    </StatusBadge>
                    <span className="text-micro text-[var(--text-tertiary)]">
                      {formatRelative(item.createdAt)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyPanel
                icon={MessageCircle}
                title="Inbox is clear"
                detail="New feedback from your school will appear here."
              />
            )}
          </section>
          <section>
            <AdminSectionHeader
              title="Recent activity"
              detail="Privileged and operational events, never private content."
              action={
                <InlineLink onClick={() => onTab("audit")}>
                  View audit log
                </InlineLink>
              }
            />
            <div className="px-4 pb-4">
              {data.recentActivity.slice(0, 5).map((event) => (
                <div
                  key={event.eventId}
                  className="flex items-center gap-3 rounded-[10px] px-2 py-2.5 transition-colors hover:bg-[var(--bg-secondary)]"
                >
                  <Activity size={13} className="text-[#25846a]" />
                  <span className="min-w-0 flex-1 truncate text-micro text-[var(--text-primary)]">
                    {actionLabel(event.action)}
                  </span>
                  {event.operator ? (
                    <StatusBadge tone="neutral">Operator</StatusBadge>
                  ) : null}
                  <span className="text-micro text-[var(--text-tertiary)]">
                    {formatRelative(event.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
        <PrivacyNotice>{data.privacy}</PrivacyNotice>
      </div>

      {contextOpen ? <AuxiliaryRail label="School context" onClose={() => setContextOpen(false)}>
        <div className="space-y-7 p-4">
        <section>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-[var(--font-serif)] text-[15px] font-medium">
                Usage
              </h2>
              <p className="mt-1 text-micro text-[var(--text-tertiary)]">
                Privacy-safe meters for this school.
              </p>
            </div>
            <AdminButton onClick={() => onTab("usage")}>View usage</AdminButton>
          </div>
          <div className="mt-4 space-y-2 text-micro">
            {(
              [
                ["Storage", data.usage.totals.storage_bytes, "bytes"],
                ["Model input", data.usage.totals.model_input_tokens, "count"],
                ["Model output", data.usage.totals.model_output_tokens, "count"],
                [
                  "Collaboration",
                  data.usage.totals.collaboration_bytes,
                  "bytes",
                ],
              ] as const
            )
              .filter(([, value]) => value !== null && value !== undefined)
              .map(([label, value, kind]) => (
                <div key={label} className="flex justify-between gap-4 rounded-[8px] px-2 py-1.5 hover:bg-[var(--bg-hover)]">
                  <span className="text-[var(--text-secondary)]">{label}</span>
                  <strong>
                    {kind === "bytes"
                      ? formatBytes(value as number)
                      : formatCompact(value as number)}
                  </strong>
                </div>
              ))}
            {[
              data.usage.totals.storage_bytes,
              data.usage.totals.model_input_tokens,
              data.usage.totals.model_output_tokens,
              data.usage.totals.collaboration_bytes,
            ].every((value) => value === null || value === undefined) ? (
              <p className="text-micro text-[var(--text-tertiary)]">
                No metered usage has been recorded for this range yet.
              </p>
            ) : null}
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2">
            <Database size={14} className="text-[#735fd5]" />
            <h2 className="text-[12px] font-medium">ManageBac connection</h2>
          </div>
          <div className="mt-3">
            <StatusBadge
              tone={statusToneFor(data.integration?.status)}
            >
              {data.integration?.status ?? "Not configured"}
            </StatusBadge>
          </div>
          <div className="mt-3 flex justify-between text-micro text-[var(--text-tertiary)]">
            <span>Last synced</span>
            <span>{formatRelative(data.integration?.lastSyncAt)}</span>
          </div>
          <Link
            href="/managebac"
            className="mt-3 block text-micro font-medium text-[#16805f] hover:underline"
          >
            Sync settings
          </Link>
        </section>

        <section>
          <h2 className="font-[var(--font-serif)] text-[15px] font-medium">
            School settings
          </h2>
          <div className="mt-3 space-y-1">
            {(
              [
                ["General settings", "profile", Settings2],
                ["Member roles", "people", UserCheck],
                ["Security", "governance", ShieldCheck],
                ["Integrations", "integrations", Network],
                ["Data & privacy", "governance", LockKeyhole],
              ] as Array<[string, Tab, LucideIcon]>
            ).map(([label, tab, Icon]) => (
              <button
                type="button"
                key={String(label)}
                onClick={() => onTab(tab as Tab)}
                className="flex w-full items-center gap-2 rounded-[8px] px-2 py-2 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
        </section>
        </div>
      </AuxiliaryRail> : null}
    </div>
  );
}

export function SchoolAdminShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const operatorSessionId = searchParams.get("operatorSessionId") ?? undefined;
  const requestedTab = searchParams.get("tab") as Tab | null;
  const [tab, setTabState] = useState<Tab>(
    requestedTab && tabs.some((item) => item.key === requestedTab)
      ? requestedTab
      : "overview",
  );
  const [overview, setOverview] = useState<SchoolAdministrationOverview | null>(
    null,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState("");

  const queryArgs = useMemo(
    () => ({ ...dateRange(), operatorSessionId }),
    [operatorSessionId],
  );

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setOverview(
        await getAdministration<SchoolAdministrationOverview>(
          "schoolOverview",
          queryArgs,
        ),
      );
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "School administration could not load.",
      );
    } finally {
      setLoading(false);
    }
  }, [queryArgs]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, refreshKey]);

  useEffect(() => {
    if (!overview?.operatorSession) return;
    const timer = window.setInterval(() => {
      if (overview.operatorSession!.expiresAt <= Date.now()) {
        toast.error("The operator session expired.");
        router.replace("/superadmin?tab=schools");
      }
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [overview?.operatorSession, router]);

  const setTab = useCallback(
    (next: Tab) => {
      setTabState(next);
      const query = new URLSearchParams(searchParams.toString());
      query.set("tab", next);
      router.replace(`/admin?${query.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const mutate = useCallback(
    async <T,>(
      label: string,
      action: string,
      payload: Record<string, unknown>,
      success: string,
    ) => {
      setBusy(label);
      try {
        const result = await mutateAdministration<T>(action, {
          ...payload,
          operatorSessionId,
        });
        toast.success(success);
        setRefreshKey((value) => value + 1);
        return result;
      } catch (nextError) {
        toast.error(
          nextError instanceof Error ? nextError.message : "Action failed.",
        );
        throw nextError;
      } finally {
        setBusy("");
      }
    },
    [operatorSessionId],
  );

  if (loading && !overview)
    return <LoadingPanel label="Opening school administration" />;
  if (error && !overview)
    return <ErrorPanel message={error} retry={() => void loadOverview()} />;
  if (!overview) return null;

  return (
    <div className="spectra-wave-y spectra-admin-stage relative min-h-dvh bg-[var(--bg-primary)] pb-24">
      {overview.operatorSession ? (
        <div className="sticky top-0 z-30 flex min-h-10 items-center justify-between gap-3 border-b border-[#d5e5f0] bg-[#eef7fc] px-5 py-2 text-micro text-[#315e78]">
          <span className="flex items-center gap-2">
            <KeyRound size={13} />
            <strong>{overview.operatorSession.label}</strong>
            <span>
              {overview.operatorSession.mode} access · expires{" "}
              {new Intl.DateTimeFormat(undefined, {
                hour: "numeric",
                minute: "2-digit",
              }).format(overview.operatorSession.expiresAt)}
            </span>
          </span>
          <AdminButton
            className="min-h-7 px-2.5"
            onClick={() =>
              void mutate(
                "end-session",
                "endOperatorSession",
                {},
                "Operator session ended.",
              ).then(() => router.push("/superadmin?tab=schools"))
            }
          >
            End session
          </AdminButton>
        </div>
      ) : null}

      <div className="w-full px-4 py-5 sm:px-6 lg:px-8 xl:px-10">
        <ProductPageHeader
          className="mb-5"
          title="School administration"
          description={`${overview.school.name} · operational tools without private content access`}
          actions={
            <>
            {overview.school.status !== "active" ? (
              <StatusBadge tone="attention">{overview.school.status}</StatusBadge>
            ) : null}
            <AdminButton className="min-h-8" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={12} />Refresh</AdminButton>
            </>
          }
        />

        <ProductSectionNav
          label="School administration"
          items={tabs}
          active={tab}
          onChange={setTab}
        />

        {tab === "overview" ? (
          <OverviewSurface data={overview} onTab={setTab} />
        ) : (
          <SchoolAdminTab
            tab={tab}
            overview={overview}
            operatorSessionId={operatorSessionId}
            busy={busy}
            mutate={mutate}
            refreshKey={refreshKey}
            onRefresh={() => setRefreshKey((value) => value + 1)}
          />
        )}
      </div>

    </div>
  );
}

function SchoolAdminTab({
  tab,
  overview,
  operatorSessionId,
  busy,
  mutate,
  refreshKey,
  onRefresh,
}: {
  tab: Exclude<Tab, "overview">;
  overview: SchoolAdministrationOverview;
  operatorSessionId?: string;
  busy: string;
  mutate: <T>(
    label: string,
    action: string,
    payload: Record<string, unknown>,
    success: string,
  ) => Promise<T>;
  refreshKey: number;
  onRefresh: () => void;
}) {
  if (tab === "people")
    return (
      <PeopleSurface
        operatorSessionId={operatorSessionId}
        busy={busy}
        mutate={mutate}
        refreshKey={refreshKey}
        onRefresh={onRefresh}
      />
    );
  if (tab === "groups")
    return (
      <GroupsSurface
        operatorSessionId={operatorSessionId}
        busy={busy}
        mutate={mutate}
        refreshKey={refreshKey}
        onRefresh={onRefresh}
      />
    );
  if (tab === "communication")
    return (
      <CommunicationSurface
        operatorSessionId={operatorSessionId}
        busy={busy}
        mutate={mutate}
        refreshKey={refreshKey}
        onRefresh={onRefresh}
      />
    );
  if (tab === "usage") return <UsageSurface overview={overview} />;
  if (tab === "agents")
    return (
      <AgentsResourcesSurface
        operatorSessionId={operatorSessionId}
        refreshKey={refreshKey}
      />
    );
  if (tab === "integrations")
    return <IntegrationsSurface overview={overview} />;
  if (tab === "governance") return <GovernanceSurface />;
  if (tab === "feedback")
    return (
      <FeedbackSurface
        operatorSessionId={operatorSessionId}
        busy={busy}
        mutate={mutate}
        refreshKey={refreshKey}
        onRefresh={onRefresh}
      />
    );
  if (tab === "profile")
    return <ProfileSurface overview={overview} busy={busy} mutate={mutate} />;
  return (
    <AuditSurface
      operatorSessionId={operatorSessionId}
      refreshKey={refreshKey}
    />
  );
}

function PeopleSurface({
  operatorSessionId,
  busy,
  mutate,
  refreshKey,
  onRefresh,
}: {
  operatorSessionId?: string;
  busy: string;
  mutate: SchoolAdminTabProps["mutate"];
  refreshKey: number;
  onRefresh: () => void;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("student");
  const [manualInvitationUrl, setManualInvitationUrl] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([
      getAdministration<{ people: Person[] }>("people", {
        operatorSessionId,
        search,
      }),
      getAdministration<{ invitations: Invitation[] }>("invitations", {
        operatorSessionId,
      }),
    ])
      .then(([members, invites]) => {
        if (!active) return;
        setPeople(members.people);
        setInvitations(invites.invitations);
      })
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "People failed."),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [operatorSessionId, refreshKey, search]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    const result = await mutate<{
      delivery: { status: "sent" | "skipped" | "failed"; reason?: string };
      manualInvitationUrl?: string;
    }>("invite", "invite", { email, role }, `Invitation created for ${email}.`);
    setEmail("");
    setInviteOpen(false);
    if (result.manualInvitationUrl) {
      setManualInvitationUrl(result.manualInvitationUrl);
      toast.warning(
        result.delivery.reason ??
          "Email delivery is unavailable. Share the secure invitation manually.",
      );
    } else toast.success("Invitation email accepted by the mail provider.");
    onRefresh();
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          icon={Users}
          label="Active members"
          value={formatCompact(
            people.filter((person) => person.status === "active").length,
          )}
          detail="Across all ordinary product roles"
        />
        <MetricCard
          icon={UserCheck}
          label="Administrators"
          value={formatCompact(
            people.filter((person) => person.role === "school_admin").length,
          )}
          detail="Last active admin is protected"
          tone="violet"
        />
        <MetricCard
          icon={Mail}
          label="Pending invitations"
          value={formatCompact(
            invitations.filter((invite) => invite.status === "pending").length,
          )}
          detail="Expiring, revocable, single-use"
          tone="orange"
        />
      </div>
      <AdminCard className="rounded-none border-0 bg-transparent shadow-none">
        <AdminSectionHeader
          title="People"
          detail="Roles only add management surfaces; students and teachers retain the same ordinary Spectra capabilities."
          action={
            <AdminButton tone="primary" onClick={() => setInviteOpen(true)}>
              <UserPlus size={13} />
              Invite member
            </AdminButton>
          }
        />
        <div className="flex items-center gap-2 px-4 pb-3">
          <label className="relative max-w-sm flex-1">
            <Search
              size={13}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search verified school members"
              className="h-9 w-full rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] pl-9 pr-3 text-[11px] outline-none focus:border-[var(--brand-primary)]"
            />
          </label>
          <AdminButton onClick={onRefresh}>
            <RefreshCw size={12} />
          </AdminButton>
        </div>
        {loading ? (
          <LoadingPanel label="Loading members" />
        ) : (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full min-w-[760px] text-left text-micro">
              <thead className="text-[var(--text-tertiary)]">
                <tr>
                  <th className="pb-2 font-normal">Member</th>
                  <th className="pb-2 font-normal">Role</th>
                  <th className="pb-2 font-normal">Status</th>
                  <th className="pb-2 font-normal">Last active</th>
                  <th className="pb-2 font-normal">Joined</th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => (
                  <tr
                    key={person.membershipId}
                    className="rounded-[10px] transition-colors hover:bg-[var(--bg-secondary)]"
                  >
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="grid size-7 place-items-center rounded-full bg-[#eeeafd] text-micro font-semibold text-[#6f5bd4]">
                          {person.name
                            .split(/\s+/)
                            .slice(0, 2)
                            .map((part) => part[0])
                            .join("")
                            .toUpperCase()}
                        </span>
                        <span>
                          <strong className="block font-medium">
                            {person.name}
                          </strong>
                          <span className="text-micro text-[var(--text-tertiary)]">
                            {person.email}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5">
                      <SelectField
                        ariaLabel={`Role for ${person.name}`}
                        value={person.role}
                        disabled={busy === `member-${person.membershipId}`}
                        onChange={(role) =>
                          void mutate(
                            `member-${person.membershipId}`,
                            "changeMember",
                            { membershipId: person.membershipId, role },
                            "Member role updated.",
                          ).then(onRefresh)
                        }
                        options={MEMBER_ROLE_OPTIONS}
                        size="sm"
                        triggerClassName="w-[132px]"
                      />
                    </td>
                    <td className="py-2.5">
                      <SelectField
                        ariaLabel={`Status for ${person.name}`}
                        value={person.status}
                        disabled={busy === `member-${person.membershipId}`}
                        onChange={(status) =>
                          void mutate(
                            `member-${person.membershipId}`,
                            "changeMember",
                            { membershipId: person.membershipId, status },
                            "Member status updated.",
                          ).then(onRefresh)
                        }
                        options={MEMBER_STATUS_OPTIONS}
                        size="sm"
                        triggerClassName="w-[124px]"
                      />
                    </td>
                    <td className="py-2.5 text-[var(--text-secondary)]">
                      {formatRelative(person.lastSeenAt)}
                    </td>
                    <td className="py-2.5 text-[var(--text-secondary)]">
                      {person.joinedAt
                        ? new Intl.DateTimeFormat(undefined, {
                            dateStyle: "medium",
                          }).format(person.joinedAt)
                        : "Pending"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>
      <AdminCard className="rounded-none border-0 bg-transparent shadow-none">
        <AdminSectionHeader
          title="Invitations"
          detail="Tokens are hashed, expiring, single-use, domain checked, and revocable."
        />
        {invitations.length ? (
          <div className="px-4 pb-4">
            {invitations.slice(0, 100).map((invite) => (
              <div
                key={invite.invitationId}
                className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] py-2.5 last:border-0"
              >
                <Mail size={13} className="text-[var(--text-tertiary)]" />
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-micro">
                    {invite.email}
                  </strong>
                  <span className="text-micro text-[var(--text-tertiary)]">
                    {invite.role.replaceAll("_", " ")} · expires{" "}
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                    }).format(invite.expiresAt)}
                  </span>
                </span>
                <StatusBadge
                  tone={invite.status === "pending" ? "attention" : "neutral"}
                >
                  {invite.status}
                </StatusBadge>
                {invite.status === "pending" ? (
                  <AdminButton
                    tone="danger"
                    disabled={busy === `invite-${invite.invitationId}`}
                    onClick={() =>
                      void mutate(
                        `invite-${invite.invitationId}`,
                        "revokeInvitation",
                        { invitationId: invite.invitationId },
                        "Invitation revoked.",
                      ).then(onRefresh)
                    }
                  >
                    Revoke
                  </AdminButton>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyPanel
            icon={Mail}
            title="No invitations yet"
            detail="Invite a verified school email to add a member."
          />
        )}
      </AdminCard>
      <AdminDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite a school member"
        detail="The invitation is restricted to this school and cannot create a second school membership."
        footer={
          <>
            <AdminButton onClick={() => setInviteOpen(false)}>
              Cancel
            </AdminButton>
            <AdminButton
              tone="primary"
              type="submit"
              disabled={!email || busy === "invite"}
              onClick={() =>
                document
                  .querySelector<HTMLFormElement>("#school-invite-form")
                  ?.requestSubmit()
              }
            >
              Send invitation
            </AdminButton>
          </>
        }
      >
        <form id="school-invite-form" onSubmit={(event) => void invite(event)}>
          <div className="space-y-4">
            <TextField
              label="Verified school email"
              value={email}
              onChange={setEmail}
              type="email"
              required
              placeholder="name@school.example"
            />
            <SelectField
              label="School profile"
              value={role}
              onChange={setRole}
              options={[
                { value: "student", label: "Student" },
                { value: "teacher", label: "Teacher" },
                { value: "school_admin", label: "School admin" },
              ]}
            />
            <PrivacyNotice>
              Student and teacher profiles have identical ordinary creation,
              sharing, artifact, and agent capabilities.
            </PrivacyNotice>
          </div>
        </form>
      </AdminDialog>
      <AdminDialog
        open={Boolean(manualInvitationUrl)}
        onClose={() => setManualInvitationUrl("")}
        title="Deliver this invitation securely"
        detail="SMTP did not accept the message. This single-use link is bound to the invited verified email and expires automatically."
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
        <div className="break-all rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 font-mono text-micro leading-5">
          {manualInvitationUrl}
        </div>
      </AdminDialog>
    </div>
  );
}

type SchoolAdminTabProps = Parameters<typeof SchoolAdminTab>[0];

function GroupsSurface({
  operatorSessionId,
  busy,
  mutate,
  refreshKey,
  onRefresh,
}: Pick<
  SchoolAdminTabProps,
  "operatorSessionId" | "busy" | "mutate" | "refreshKey" | "onRefresh"
>) {
  const [groups, setGroups] = useState<SchoolGroup[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("class");
  const [members, setMembers] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([
      getAdministration<{ groups: SchoolGroup[] }>("groups", {
        operatorSessionId,
      }),
      getAdministration<{ people: Person[] }>("people", {
        operatorSessionId,
        status: "active",
      }),
    ])
      .then(([groupResult, peopleResult]) => {
        if (!active) return;
        setGroups(groupResult.groups);
        setPeople(peopleResult.people);
      })
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Groups failed."),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [operatorSessionId, refreshKey]);

  return (
    <>
      <AdminCard className="rounded-none border-0 bg-transparent shadow-none">
        <AdminSectionHeader
          title="Groups and classes"
          detail="Manual groups and source-linked classes can target announcements and future assigned learning experiences."
          action={
            <AdminButton tone="primary" onClick={() => setOpen(true)}>
              <Plus size={13} />
              Create group
            </AdminButton>
          }
        />
        {loading ? (
          <LoadingPanel label="Loading groups" />
        ) : groups.length ? (
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {groups.map((group) => (
              <div
                key={group.groupId}
                className="rounded-[8px] border border-[var(--border-subtle)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-9 place-items-center rounded-[9px] bg-[#eaf6f0] text-[#16805f]">
                    <UsersRound size={16} />
                  </span>
                  <StatusBadge tone="neutral">
                    {group.source}
                  </StatusBadge>
                </div>
                <h3 className="mt-4 text-[12px] font-semibold">{group.name}</h3>
                <p className="mt-1 min-h-8 text-micro leading-4 text-[var(--text-tertiary)]">
                  {group.description || `${group.type} group`}
                </p>
                <div className="mt-4 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3 text-micro text-[var(--text-secondary)]">
                  <span>{group.memberCount} members</span>
                  {group.source === "manual" ? (
                    <AdminButton
                      tone="danger"
                      className="min-h-7"
                      disabled={busy === `group-${group.groupId}`}
                      onClick={() =>
                        void mutate(
                          `group-${group.groupId}`,
                          "updateGroup",
                          { groupId: group.groupId, archived: true },
                          "Group archived.",
                        ).then(onRefresh)
                      }
                    >
                      <Archive size={11} />
                      Archive
                    </AdminButton>
                  ) : (
                    <span>Managed by source</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyPanel
            icon={UsersRound}
            title="No groups yet"
            detail="Create a group or connect ManageBac to import current classes."
          />
        )}
      </AdminCard>
      <AdminDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Create a group"
        detail="Groups are operational audiences. They do not change ordinary Spectra product capabilities."
        footer={
          <>
            <AdminButton onClick={() => setOpen(false)}>Cancel</AdminButton>
            <AdminButton
              tone="primary"
              disabled={!name || busy === "create-group"}
              onClick={() =>
                void mutate(
                  "create-group",
                  "createGroup",
                  {
                    name,
                    description,
                    type,
                    memberAccountIds: members,
                  },
                  "Group created.",
                ).then(() => {
                  setOpen(false);
                  setName("");
                  setDescription("");
                  setMembers([]);
                  onRefresh();
                })
              }
            >
              Create group
            </AdminButton>
          </>
        }
      >
        <div className="space-y-4">
          <TextField label="Name" value={name} onChange={setName} />
          <TextAreaField
            label="Description"
            value={description}
            onChange={setDescription}
            rows={3}
          />
          <SelectField
            label="Group type"
            value={type}
            onChange={setType}
            options={[
              { value: "class", label: "Class" },
              { value: "department", label: "Department" },
              { value: "programme", label: "Programme" },
              { value: "custom", label: "Custom" },
            ]}
          />
          <fieldset>
            <legend className="mb-2 text-micro font-medium text-[var(--text-secondary)]">
              Initial members
            </legend>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-[7px] border border-[var(--border-default)] p-2">
              {people.map((person) => (
                <label
                  key={person.accountId}
                  className="flex items-center gap-3 rounded-[6px] px-2 py-2 text-micro hover:bg-[var(--bg-secondary)]"
                >
                  <input
                    type="checkbox"
                    checked={members.includes(person.accountId)}
                    onChange={(event) =>
                      setMembers((current) =>
                        event.target.checked
                          ? [...current, person.accountId]
                          : current.filter((id) => id !== person.accountId),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate">{person.name}</strong>
                    <span className="truncate text-micro text-[var(--text-tertiary)]">
                      {person.email}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </AdminDialog>
    </>
  );
}

function CommunicationSurface({
  operatorSessionId,
  busy,
  mutate,
  refreshKey,
  onRefresh,
}: Pick<
  SchoolAdminTabProps,
  "operatorSessionId" | "busy" | "mutate" | "refreshKey" | "onRefresh"
>) {
  const [rows, setRows] = useState<Announcement[]>([]);
  const [groups, setGroups] = useState<SchoolGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [targetKind, setTargetKind] = useState("school");
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [sendNow, setSendNow] = useState(true);
  const [scheduledAt, setScheduledAt] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([
      getAdministration<{ announcements: Announcement[] }>("announcements", {
        operatorSessionId,
      }),
      getAdministration<{ groups: SchoolGroup[] }>("groups", {
        operatorSessionId,
      }),
    ])
      .then(([announcements, groupRows]) => {
        if (!active) return;
        setRows(announcements.announcements);
        setGroups(groupRows.groups);
      })
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : "Communication failed.",
        ),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [operatorSessionId, refreshKey]);

  return (
    <>
      <AdminCard className="rounded-none border-0 bg-transparent shadow-none">
        <AdminSectionHeader
          title="Announcements"
          detail="Audience membership is snapshotted at send time. Delivery, reads, failures, edits, cancellation, and rate limits are audited."
          action={
            <AdminButton tone="primary" onClick={() => setOpen(true)}>
              <Plus size={13} />
              New announcement
            </AdminButton>
          }
        />
        {loading ? (
          <LoadingPanel label="Loading announcements" />
        ) : rows.length ? (
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full min-w-[720px] text-left text-micro">
              <thead className="text-[var(--text-tertiary)]">
                <tr>
                  <th className="pb-2 font-normal">Announcement</th>
                  <th className="pb-2 font-normal">Audience</th>
                  <th className="pb-2 font-normal">Delivery</th>
                  <th className="pb-2 font-normal">Status</th>
                  <th className="pb-2 text-right font-normal">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.announcementId}
                    className="rounded-[10px] transition-colors hover:bg-[var(--bg-secondary)]"
                  >
                    <td className="py-3">
                      <strong className="block font-medium">{row.title}</strong>
                      <span className="text-micro text-[var(--text-tertiary)]">
                        {row.sentAt
                          ? `Sent ${formatRelative(row.sentAt)}`
                          : row.scheduledAt
                            ? `Scheduled ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(row.scheduledAt)}`
                            : formatRelative(row.createdAt)}
                      </span>
                    </td>
                    <td className="py-3">
                      {row.audienceSnapshotCount} · {row.targetKind}
                    </td>
                    <td className="py-3">
                      {row.delivered} delivered · {row.read} read
                      {row.failed ? ` · ${row.failed} failed` : ""}
                    </td>
                    <td className="py-3">
                      <StatusBadge tone={statusToneFor(row.status)}>
                        {row.status}
                      </StatusBadge>
                    </td>
                    <td className="py-3 text-right">
                      {row.status === "scheduled" ? (
                        <AdminButton
                          tone="danger"
                          disabled={busy === `cancel-${row.announcementId}`}
                          onClick={() =>
                            void mutate(
                              `cancel-${row.announcementId}`,
                              "cancelAnnouncement",
                              { announcementId: row.announcementId },
                              "Announcement cancelled.",
                            ).then(onRefresh)
                          }
                        >
                          Cancel
                        </AdminButton>
                      ) : (
                        <span className="text-micro text-[var(--text-tertiary)]">
                          Immutable
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
            icon={Bell}
            title="No announcements"
            detail="Create a clear, targeted school message with real delivery state."
          />
        )}
      </AdminCard>
      <AdminDialog
        open={open}
        onClose={() => setOpen(false)}
        title="New announcement"
        detail="Messages are visible only to the selected audience and never read private threads."
        footer={
          <>
            <AdminButton onClick={() => setOpen(false)}>Cancel</AdminButton>
            <AdminButton
              tone="primary"
              disabled={!title || !body || busy === "announcement"}
              onClick={() =>
                void mutate(
                  "announcement",
                  "createAnnouncement",
                  {
                    title,
                    body,
                    targetKind,
                    targetIds,
                    sendNow,
                    scheduledAt: sendNow
                      ? undefined
                      : new Date(scheduledAt).getTime(),
                  },
                  sendNow ? "Announcement sent." : "Announcement scheduled.",
                ).then(() => {
                  setOpen(false);
                  setTitle("");
                  setBody("");
                  setTargetIds([]);
                  onRefresh();
                })
              }
            >
              <Send size={12} />
              {sendNow ? "Send now" : "Schedule"}
            </AdminButton>
          </>
        }
      >
        <div className="space-y-4">
          <TextField label="Title" value={title} onChange={setTitle} />
          <TextAreaField
            label="Message"
            value={body}
            onChange={setBody}
            rows={6}
          />
          <SelectField
            label="Audience"
            value={targetKind}
            onChange={(value) => {
              setTargetKind(value);
              setTargetIds([]);
            }}
            options={[
              { value: "school", label: "Everyone at school" },
              { value: "roles", label: "School profiles" },
              { value: "groups", label: "Groups and classes" },
            ]}
          />
          {targetKind === "roles" ? (
            <div className="grid gap-2 sm:grid-cols-3">
              {["student", "teacher", "school_admin"].map((role) => (
                <label
                  key={role}
                  className="flex items-center gap-2 rounded-[7px] border border-[var(--border-default)] p-3 text-micro"
                >
                  <input
                    type="checkbox"
                    checked={targetIds.includes(role)}
                    onChange={(event) =>
                      setTargetIds((current) =>
                        event.target.checked
                          ? [...current, role]
                          : current.filter((item) => item !== role),
                      )
                    }
                  />
                  {role.replaceAll("_", " ")}
                </label>
              ))}
            </div>
          ) : null}
          {targetKind === "groups" ? (
            <div className="max-h-44 overflow-y-auto rounded-[7px] border border-[var(--border-default)] p-2">
              {groups.map((group) => (
                <label
                  key={group.groupId}
                  className="flex items-center gap-2 rounded-[6px] px-2 py-2 text-micro hover:bg-[var(--bg-secondary)]"
                >
                  <input
                    type="checkbox"
                    checked={targetIds.includes(group.groupId)}
                    onChange={(event) =>
                      setTargetIds((current) =>
                        event.target.checked
                          ? [...current, group.groupId]
                          : current.filter((item) => item !== group.groupId),
                      )
                    }
                  />
                  <span className="flex-1">{group.name}</span>
                  <span className="text-[var(--text-tertiary)]">
                    {group.memberCount}
                  </span>
                </label>
              ))}
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-micro">
            <input
              type="checkbox"
              checked={sendNow}
              onChange={(event) => setSendNow(event.target.checked)}
            />
            Send immediately
          </label>
          {!sendNow ? (
            <TextField
              label="Scheduled time"
              value={scheduledAt}
              onChange={setScheduledAt}
              type="datetime-local"
            />
          ) : null}
        </div>
      </AdminDialog>
    </>
  );
}

function UsageSurface({
  overview,
}: {
  overview: SchoolAdministrationOverview;
}) {
  const categories = [
    ["Storage", "storage_bytes", HardDrive],
    ["Bandwidth", "bandwidth_bytes", Network],
    ["Model input", "model_input_tokens", Sparkles],
    ["Model output", "model_output_tokens", Sparkles],
    ["Rendering", "render_milliseconds", CircleGauge],
    ["Collaboration", "collaboration_bytes", UsersRound],
  ] as const;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {categories.map(([label, key, Icon]) => (
          <MetricCard
            key={key}
            icon={Icon}
            label={label}
            value={
              key.endsWith("_bytes")
                ? formatBytes(overview.usage.totals[key])
                : formatCompact(overview.usage.totals[key])
            }
            detail={`Complete through ${overview.usage.completeThrough}`}
            tone={
              key === "storage_bytes"
                ? "green"
                : key.startsWith("model")
                  ? "violet"
                  : "blue"
            }
          />
        ))}
      </div>
      <AdminCard className="rounded-none border-0 bg-transparent shadow-none">
        <AdminSectionHeader
          title="Daily usage"
          detail="Privacy-safe metering by category. Missing meters remain unknown rather than being inferred from private records."
        />
        <div className="overflow-x-auto px-4 pb-4">
          <div className="flex h-64 min-w-[720px] items-end gap-1 border-b border-l border-[var(--border-subtle)] px-3 pt-5">
            {overview.usage.series.length ? (
              overview.usage.series.map((point) => {
                const total = Object.values(point.values).reduce(
                  (sum, value) => sum + value,
                  0,
                );
                const maximum = Math.max(
                  1,
                  ...overview.usage.series.map((item) =>
                    Object.values(item.values).reduce(
                      (sum, value) => sum + value,
                      0,
                    ),
                  ),
                );
                return (
                  <div
                    key={point.day}
                    className="group relative flex h-full min-w-3 flex-1 items-end"
                  >
                    <div
                      className="w-full rounded-t-[3px] bg-[#70c7aa] transition-colors group-hover:bg-[#259b74]"
                      style={{
                        height: `${Math.max(2, (total / maximum) * 100)}%`,
                      }}
                    />
                    <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[var(--text-primary)] px-2 py-1 text-micro text-[var(--bg-primary)] group-hover:block">
                      {point.day} · {formatCompact(total)}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="m-auto text-[11px] text-[var(--text-tertiary)]">
                No completed meter window yet
              </div>
            )}
          </div>
        </div>
      </AdminCard>
      <PrivacyNotice>
        Commercial enforcement is <strong>{overview.limits.enforcement}</strong>
        . Superadmin can define and simulate per-school limits without changing
        this product surface.
      </PrivacyNotice>
    </div>
  );
}

type AgentGovernance = {
  totals: {
    sharedAgents: number;
    invocations: number;
    feedback: number;
    passedEvaluations: number;
  };
  agents: Array<{
    agentId: string;
    title: string;
    invocations: number;
    completionRate: number | null;
    averageRating: number | null;
    evaluationPassRate: number | null;
    publishedReleases: number;
    suspendedReleases: number;
    updatedAt: number;
  }>;
  privacy: string;
};

function AgentsResourcesSurface({
  operatorSessionId,
  refreshKey,
}: {
  operatorSessionId?: string;
  refreshKey: number;
}) {
  const [data, setData] = useState<AgentGovernance | null>(null);
  const [error, setError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void getAdministration<AgentGovernance>("agentGovernance", {
      operatorSessionId,
    })
      .then((result) => {
        if (active) setData(result);
      })
      .catch((failure) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "Agent governance could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, [loadAttempt, operatorSessionId, refreshKey]);
  return (
    <div className="grid gap-3">
      <AdminCard>
        <AdminSectionHeader
          title="School agents"
          detail="Review agents that were explicitly shared or published to the school. Private agents remain private."
        />
        <div className="p-4 pt-1">
          {error ? (
            <ErrorPanel
              message={error}
              retry={() => setLoadAttempt((value) => value + 1)}
            />
          ) : null}
          <PrivacyNotice>
            {data?.privacy ??
              "Agent analytics use aggregate invocation and evaluation metadata; private prompts, sessions, memory, and unrelated artifacts are not available here."}
          </PrivacyNotice>
          {data ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                icon={Bot}
                label="School-shared agents"
                value={formatCompact(data.totals.sharedAgents)}
                detail="Private drafts excluded"
              />
              <MetricCard
                icon={Activity}
                label="Invocations"
                value={formatCompact(data.totals.invocations)}
                detail="Aggregate only"
              />
              <MetricCard
                icon={MessageCircle}
                label="Feedback signals"
                value={formatCompact(data.totals.feedback)}
                detail="No private comments"
              />
              <MetricCard
                icon={ShieldCheck}
                label="Passing evaluations"
                value={formatCompact(data.totals.passedEvaluations)}
                detail="Synthetic suites"
              />
            </div>
          ) : !error ? (
            <LoadingPanel label="Loading privacy-safe agent governance…" />
          ) : null}
          <div className="mt-4 flex gap-2">
            <Link href="/agents">
              <AdminButton tone="primary">
                <Bot size={13} />
                Open agent library
              </AdminButton>
            </Link>
            <Link href="/agents?view=shared">
              <AdminButton>School-shared agents</AdminButton>
            </Link>
          </div>
        </div>
      </AdminCard>
      {data?.agents.length ? (
        <AdminCard>
          <AdminSectionHeader
            title="Published and school-shared agents"
            detail="Operational quality only; private invocations and resource contents never appear."
          />
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full min-w-[760px] text-left text-micro">
              <thead className="text-[var(--text-tertiary)]">
                <tr>
                  <th className="py-2">Agent</th>
                  <th>Invocations</th>
                  <th>Completion</th>
                  <th>Rating</th>
                  <th>Eval pass</th>
                  <th>Releases</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.agents.map((agent) => (
                  <tr
                    key={agent.agentId}
                    className="border-t border-[var(--border-subtle)]"
                  >
                    <td className="py-3 font-semibold text-[var(--text-primary)]">
                      {agent.title}
                    </td>
                    <td>{formatCompact(agent.invocations)}</td>
                    <td>
                      {agent.completionRate === null
                        ? "—"
                        : `${Math.round(agent.completionRate * 100)}%`}
                    </td>
                    <td>
                      {agent.averageRating === null
                        ? "—"
                        : agent.averageRating.toFixed(1)}
                    </td>
                    <td>
                      {agent.evaluationPassRate === null
                        ? "—"
                        : `${Math.round(agent.evaluationPassRate * 100)}%`}
                    </td>
                    <td>
                      {agent.publishedReleases} live
                      {agent.suspendedReleases
                        ? ` · ${agent.suspendedReleases} suspended`
                        : ""}
                    </td>
                    <td>{formatRelative(agent.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminCard>
      ) : null}
      <AdminCard>
        <AdminSectionHeader
          title="Resource governance"
          detail="Knowledge resources stay permission-bound to their underlying artifact or workspace."
        />
        <div className="grid gap-3 p-4 pt-1 sm:grid-cols-2">
          <div className="rounded-[7px] border border-[var(--border-subtle)] p-3">
            <BookOpen size={15} className="text-[#16805f]" />
            <strong className="mt-3 block text-[11px]">
              Permission inheritance
            </strong>
            <p className="mt-1 text-micro leading-4 text-[var(--text-tertiary)]">
              Revoking a source artifact immediately removes agent retrieval
              access.
            </p>
          </div>
          <div className="rounded-[7px] border border-[var(--border-subtle)] p-3">
            <ShieldCheck size={15} className="text-[#735fd5]" />
            <strong className="mt-3 block text-[11px]">
              Evaluation health
            </strong>
            <p className="mt-1 text-micro leading-4 text-[var(--text-tertiary)]">
              Published versions can require evaluation evidence without
              exposing user sessions.
            </p>
          </div>
        </div>
      </AdminCard>
    </div>
  );
}

function IntegrationsSurface({
  overview,
}: {
  overview: SchoolAdministrationOverview;
}) {
  const coverage = overview.integration?.coverage;
  const coveragePercent = coverage?.discovered
    ? Math.round((coverage.verifiedReadable / coverage.discovered) * 100)
    : 0;
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
      <AdminCard>
        <AdminSectionHeader
          title="ManageBac"
          detail="Read-only school data with verified tenant capabilities, exact identity matching, provenance, quarantine, and safe later synchronization."
          action={
            <StatusBadge
              tone={statusToneFor(overview.integration?.status)}
            >
              {overview.integration?.status ?? "Not configured"}
            </StatusBadge>
          }
        />
        <div className="p-4 pt-1">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              [
                "Capability coverage",
                `${coveragePercent}%`,
                `${coverage?.verifiedReadable ?? 0} of ${coverage?.discovered ?? 0} routes`,
              ],
              [
                "Last sync",
                formatRelative(overview.integration?.lastSyncAt),
                undefined,
              ],
              [
                "Next sync",
                formatRelative(overview.integration?.nextSyncAt),
                undefined,
              ],
            ].map(([label, value, detail]) => (
              <div
                key={String(label)}
                className="rounded-[7px] border border-[var(--border-subtle)] p-3"
              >
                <span className="text-micro text-[var(--text-tertiary)]">
                  {label}
                </span>
                <strong className="mt-1 block text-[12px]">{value}</strong>
                {detail ? (
                  <span className="mt-0.5 block text-micro text-[var(--text-tertiary)]">
                    {detail}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
          <Link href="/managebac" className="mt-4 inline-block">
            <AdminButton tone="primary">
              <Network size={13} />
              Open integration
            </AdminButton>
          </Link>
        </div>
      </AdminCard>
      <AdminCard>
        <AdminSectionHeader
          title="Connector guarantees"
          detail="Operational contract"
        />
        <div className="space-y-2 p-4 pt-1 text-micro">
          {[
            "Read-only token, server-side only",
            "Verified tenant capability manifest",
            "No client-selected provider identity",
            "Source overlays preserve user work",
            "Removed records are tombstoned",
          ].map((item) => (
            <div key={item} className="flex items-center gap-2">
              <Check size={12} className="text-[#15916c]" />
              {item}
            </div>
          ))}
        </div>
      </AdminCard>
    </div>
  );
}

function GovernanceSurface() {
  const freedoms = [
    {
      icon: Sparkles,
      title: "Full AI access",
      detail:
        "Models and adaptive AI operations are available to every ordinary user.",
    },
    {
      icon: FileClock,
      title: "Personal memory",
      detail:
        "Memory is on by default and controlled only by the person it belongs to.",
    },
    {
      icon: Bot,
      title: "Agents for everyone",
      detail:
        "Any student, teacher, or administrator can create, use, and share agents.",
    },
    {
      icon: BookOpen,
      title: "Every artifact",
      detail:
        "Creation, editing, collaboration, imports, and exports are ordinary capabilities.",
    },
    {
      icon: Network,
      title: "Capable runtimes",
      detail:
        "Code and visualisation tools are secured by isolation, not school allowlists.",
    },
    {
      icon: LockKeyhole,
      title: "Private by default",
      detail:
        "People decide who can read or modify their work; public access is always explicit.",
    },
  ] as const;
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
      <AdminCard>
        <AdminSectionHeader
          title="Freedom and privacy charter"
          detail="School administration adds operational tools. It never removes ordinary Spectra capabilities."
        />
        <div className="grid gap-2 p-4 pt-1 sm:grid-cols-2">
          {freedoms.map(({ icon: Icon, title, detail }) => (
            <div
              key={title}
              className="rounded-[9px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3.5"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[#eef8f4] text-[#16805f]">
                  <Icon size={15} />
                </span>
                <StatusBadge tone="healthy">Always available</StatusBadge>
              </div>
              <strong className="mt-3 block text-[11px]">{title}</strong>
              <p className="mt-1 text-micro leading-4 text-[var(--text-tertiary)]">
                {detail}
              </p>
            </div>
          ))}
        </div>
      </AdminCard>
      <div className="space-y-3">
        <AdminCard className="p-4">
          <h2 className="font-[var(--font-serif)] text-[15px] font-medium">
            What administration can do
          </h2>
          <p className="mt-2 text-micro leading-5 text-[var(--text-secondary)]">
            Manage people, verified integrations, school profile, operational
            communications, privacy-safe usage, audit, legal lifecycle, and
            future commercial limits. Security isolation and permissions remain
            enforced without turning them into educational restrictions.
          </p>
        </AdminCard>
        <PrivacyNotice>
          Private prompts, threads, memory, and unrelated artifacts never appear
          here. Public access is explicit and user-directed; workspace and
          artifact permissions remain fully enforced.
        </PrivacyNotice>
      </div>
    </div>
  );
}

function FeedbackSurface({
  operatorSessionId,
  busy,
  mutate,
  refreshKey,
  onRefresh,
}: Pick<
  SchoolAdminTabProps,
  "operatorSessionId" | "busy" | "mutate" | "refreshKey" | "onRefresh"
>) {
  const [rows, setRows] = useState<FeedbackItem[]>([]);
  const [selected, setSelected] = useState<FeedbackItem | null>(null);
  const [response, setResponse] = useState("");
  const [status, setStatus] = useState("in_progress");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    void getAdministration<{ feedback: FeedbackItem[] }>("feedbackInbox", {
      operatorSessionId,
    })
      .then((result) => setRows(result.feedback))
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : "Feedback failed.",
        ),
      )
      .finally(() => setLoading(false));
  }, [operatorSessionId, refreshKey]);
  return (
    <>
      <AdminCard>
        <AdminSectionHeader
          title="Feedback & support"
          detail="Visible only to the reporter and assigned school/platform responders."
        />
        {loading ? (
          <LoadingPanel label="Loading feedback" />
        ) : rows.length ? (
          <div className="divide-y divide-[var(--border-subtle)] px-4 pb-4">
            {rows.map((item) => (
              <button
                key={item.feedbackId}
                type="button"
                onClick={() => {
                  setSelected(item);
                  setResponse(item.response ?? "");
                  setStatus(
                    item.status === "new" ? "in_progress" : item.status,
                  );
                }}
                className="flex w-full items-start gap-3 py-3 text-left"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-[8px] bg-[var(--bg-secondary)]">
                  <MessageCircle size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[11px]">
                    {item.subject}
                  </strong>
                  <span className="mt-1 block line-clamp-2 text-micro leading-4 text-[var(--text-tertiary)]">
                    {item.message}
                  </span>
                  <span className="mt-1 block text-micro text-[var(--text-tertiary)]">
                    {item.reporter?.name ?? "Unavailable reporter"} ·{" "}
                    {formatRelative(item.createdAt)}
                  </span>
                </span>
                <StatusBadge tone={item.status === "new" ? "attention" : "neutral"}>
                  {item.status.replaceAll("_", " ")}
                </StatusBadge>
              </button>
            ))}
          </div>
        ) : (
          <EmptyPanel
            icon={Inbox}
            title="Feedback inbox is clear"
            detail="New reports from your school will appear here."
          />
        )}
      </AdminCard>
      <AdminDialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.subject ?? "Feedback"}
        detail={
          selected
            ? `${selected.reporter?.name ?? "Reporter"} · ${selected.category.replaceAll("_", " ")}`
            : undefined
        }
        footer={
          <>
            <AdminButton onClick={() => setSelected(null)}>Cancel</AdminButton>
            <AdminButton
              tone="primary"
              disabled={!selected || busy === "feedback-response"}
              onClick={() =>
                selected &&
                void mutate(
                  "feedback-response",
                  "respondFeedback",
                  {
                    feedbackId: selected.feedbackId,
                    status,
                    response,
                  },
                  "Feedback updated.",
                ).then(() => {
                  setSelected(null);
                  onRefresh();
                })
              }
            >
              Save response
            </AdminButton>
          </>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <div className="rounded-[7px] bg-[var(--bg-secondary)] p-3 text-[11px] leading-5">
              {selected.message}
            </div>
            <SelectField
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: "triaged", label: "Triaged" },
                { value: "in_progress", label: "In progress" },
                { value: "resolved", label: "Resolved" },
                { value: "closed", label: "Closed" },
              ]}
            />
            <TextAreaField
              label="Response visible to reporter"
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

function ProfileSurface({
  overview,
  busy,
  mutate,
}: Pick<SchoolAdminTabProps, "overview" | "busy" | "mutate">) {
  const [name, setName] = useState(overview.school.name);
  const [timezone, setTimezone] = useState(overview.school.timezone);
  const [locale, setLocale] = useState(overview.school.locale ?? "en");
  const [domains, setDomains] = useState(
    overview.school.verifiedDomains.join(", "),
  );
  const [accent, setAccent] = useState(
    overview.school.accentColor ?? "#15946d",
  );
  const [logoUrl, setLogoUrl] = useState(overview.school.logoUrl ?? "");
  const [start, setStart] = useState(overview.school.academicYearStart ?? "");
  const [end, setEnd] = useState(overview.school.academicYearEnd ?? "");
  const [reducedMotion, setReducedMotion] = useState(
    overview.school.accessibilityDefaults?.reducedMotion ?? false,
  );
  const [contrast, setContrast] = useState(
    overview.school.accessibilityDefaults?.increasedContrast ?? false,
  );
  const [largerText, setLargerText] = useState(
    overview.school.accessibilityDefaults?.largerText ?? false,
  );
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
      <AdminCard>
        <AdminSectionHeader
          title="School profile"
          detail="Brand, verified domains, locale, timezone, academic calendar, and accessibility defaults."
          action={
            <AdminButton
              tone="primary"
              disabled={busy === "profile"}
              onClick={() =>
                void mutate(
                  "profile",
                  "updateSchoolProfile",
                  {
                    name,
                    timezone,
                    locale,
                    verifiedDomains: domains
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean),
                    accentColor: accent,
                    logoUrl,
                    academicYearStart: start,
                    academicYearEnd: end,
                    accessibilityDefaults: {
                      reducedMotion,
                      increasedContrast: contrast,
                      largerText,
                    },
                  },
                  "School profile updated.",
                )
              }
            >
              <Save size={12} />
              Save changes
            </AdminButton>
          }
        />
        <div className="grid gap-4 p-4 pt-1 sm:grid-cols-2">
          <TextField label="School name" value={name} onChange={setName} />
          <TextField
            label="IANA timezone"
            value={timezone}
            onChange={setTimezone}
            placeholder="Europe/Madrid"
          />
          <TextField label="Locale" value={locale} onChange={setLocale} />
          <TextField
            label="Accent colour"
            value={accent}
            onChange={setAccent}
            placeholder="#15946d"
          />
          <div className="sm:col-span-2">
            <TextField
              label="Verified email domains (comma separated)"
              value={domains}
              onChange={setDomains}
            />
          </div>
          <div className="sm:col-span-2">
            <TextField
              label="HTTPS logo URL"
              value={logoUrl}
              onChange={setLogoUrl}
              type="url"
            />
          </div>
          <TextField
            label="Academic year starts"
            value={start}
            onChange={setStart}
            placeholder="2026-08-20"
          />
          <TextField
            label="Academic year ends"
            value={end}
            onChange={setEnd}
            placeholder="2027-06-24"
          />
        </div>
      </AdminCard>
      <div className="space-y-3">
        <AdminCard className="p-4">
          <h2 className="font-[var(--font-serif)] text-[15px] font-medium">
            Accessibility defaults
          </h2>
          <div className="mt-3 space-y-3">
            {[
              ["Reduced motion", reducedMotion, setReducedMotion],
              ["Increased contrast", contrast, setContrast],
              ["Larger text", largerText, setLargerText],
            ].map(([label, checked, setter]) => (
              <label
                key={String(label)}
                className="flex items-center justify-between gap-3 text-micro"
              >
                {label as string}
                <input
                  type="checkbox"
                  checked={checked as boolean}
                  onChange={(event) =>
                    (setter as (value: boolean) => void)(event.target.checked)
                  }
                />
              </label>
            ))}
          </div>
        </AdminCard>
        <AdminCard className="p-4">
          <div className="flex items-center gap-3">
            <span
              className="grid size-12 place-items-center rounded-[12px] text-white"
              style={{ backgroundColor: accent }}
            >
              <Building2 size={22} />
            </span>
            <div>
              <strong className="text-[12px]">{name}</strong>
              <p className="mt-1 text-micro text-[var(--text-tertiary)]">
                Profile preview
              </p>
            </div>
          </div>
        </AdminCard>
      </div>
    </div>
  );
}

function AuditSurface({
  operatorSessionId,
  refreshKey,
}: {
  operatorSessionId?: string;
  refreshKey: number;
}) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    void getAdministration<{ events: AuditEvent[] }>("audit", {
      operatorSessionId,
      actionPrefix: filter || undefined,
      limit: 250,
    })
      .then((result) => setEvents(result.events))
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "Audit failed."),
      )
      .finally(() => setLoading(false));
  }, [operatorSessionId, filter, refreshKey]);
  return (
    <AdminCard>
      <AdminSectionHeader
        title="Privileged audit"
        detail="Viewing this log is itself audited. Events contain safe metadata, never secrets or content excerpts."
      />
      <div className="px-4 pb-3">
        <TextField
          label="Action prefix"
          value={filter}
          onChange={setFilter}
          placeholder="membership. or integration."
        />
      </div>
      {loading ? (
        <LoadingPanel label="Loading audit events" />
      ) : events.length ? (
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full min-w-[760px] text-left text-micro">
            <thead className="text-[var(--text-tertiary)]">
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="pb-2 font-normal">Event</th>
                <th className="pb-2 font-normal">Target</th>
                <th className="pb-2 font-normal">Actor</th>
                <th className="pb-2 font-normal">Operator session</th>
                <th className="pb-2 font-normal">Time</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr
                  key={event.eventId}
                  className="border-b border-[var(--border-subtle)] last:border-0"
                >
                  <td className="py-2.5 font-medium">
                    {actionLabel(event.action)}
                  </td>
                  <td className="py-2.5 text-[var(--text-secondary)]">
                    {event.targetType}
                  </td>
                  <td className="py-2.5 font-mono text-micro text-[var(--text-tertiary)]">
                    {event.actorAccountId?.slice(-10) ?? "System"}
                  </td>
                  <td className="py-2.5">
                    {event.operatorSessionId ? (
                      <StatusBadge tone="neutral">Scoped operator</StatusBadge>
                    ) : (
                      "Local"
                    )}
                  </td>
                  <td className="py-2.5 text-[var(--text-secondary)]">
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(event.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyPanel
          icon={FileClock}
          title="No matching events"
          detail="Try a broader action prefix."
        />
      )}
    </AdminCard>
  );
}
