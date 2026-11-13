"use client";

import { useCallback, useEffect, useMemo, useState, type InputHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import { KeyRound, Plus, Save } from "@/components/icons/glyph-icons";
import { toast } from "@/components/ui/toast";
import {
  getAdministration,
  mutateAdministration,
  type SchoolAdministrationOverview,
} from "@/features/spectra/administration/api";
import { metricDefinition } from "@/features/spectra/administration/metric-registry";
import type { BarCommand, CollapseStep } from "@/components/ui/adaptive-bar";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { LoadingRows } from "@/components/ui/page-state";
import { LifeKey } from "@/components/ui/life-moments";
import { FeedbackFilePreview } from "@/components/layout/feedback-file-preview";
import { PanelTabs, type PanelTab } from "@/components/ui/side-panel";
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
  TallySheet,
  TextAreaField,
  TextField,
} from "@/features/spectra/administration/shared";
import { describeFailure } from "@/components/ui/truthful-state";
import { humanizePublicFailure } from "@/features/spectra/bridge/humanize";
import { auditActionWords, auditTargetWords } from "@/features/spectra/administration/audit-words";
import { formatMeter, USAGE_METERS, UsageDayChart } from "@/features/spectra/administration/usage-chart";
import { PeopleSurface } from "@/features/spectra/administration/people/people-surface";
import { MessageDialog } from "@/features/spectra/administration/people/message-dialog";
import type { Person } from "@/features/spectra/administration/people/people-model";

/*
 * School admin (docs/product: administration). The same desk as Home: what
 * needs the administrator first, the school's counts on one sheet, then
 * ledgers. Every section says what it is for in the school's words; how the
 * platform keeps work private is said once, quietly, at the foot. An operator
 * who stepped in to inspect reads everything and changes nothing.
 */

const ADMIN_BAR_PLAN: readonly CollapseStep[] = [{ toMenu: "refresh" }];

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

const tabs: Array<PanelTab & { id: Tab }> = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "people", label: "People", icon: "people" },
  { id: "groups", label: "Groups", icon: "folderTree" },
  { id: "communication", label: "Messages", icon: "mail" },
  { id: "usage", label: "Usage", icon: "analytics" },
  { id: "feedback", label: "Feedback", icon: "conversations" },
  { id: "integrations", label: "ManageBac", icon: "network" },
  { id: "agents", label: "Agents", icon: "agent" },
  { id: "profile", label: "School profile", icon: "school" },
  { id: "governance", label: "Rights & privacy", icon: "shield" },
  { id: "audit", label: "Activity log", icon: "log" },
];

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
  origin?: "school" | "platform";
  recipientNames?: string[];
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

type Mutate = <T>(
  label: string,
  action: string,
  payload: Record<string, unknown>,
  success: string | null,
) => Promise<{ result: T } | null>;

type SurfaceProps = {
  operatorSessionId?: string;
  busy: string;
  mutate: Mutate;
  refreshKey: number;
  /** An operator inspecting the school: everything reads, nothing changes. */
  readOnly: boolean;
};

const INSPECT_ONLY = "You are inspecting this school, so nothing here can be changed.";

function plain(value: string) {
  return value.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

/** The words for a ManageBac connection, and whether it wants a hand. */
function connectionWords(integration: SchoolAdministrationOverview["integration"]) {
  const status = integration?.status;
  if (status === "connected" && integration?.hasOpenConflicts)
    return { label: "Needs review", needs: true };
  if (status === "connected" && integration?.syncFreshness === "stale")
    return { label: "Updates overdue", needs: true };
  if (status === "connected" && integration?.syncFreshness === "never")
    return { label: "Waiting for first sync", needs: true };
  switch (status) {
    case "connected":
      return { label: "Connected", needs: false };
    case "validating":
      return { label: "Checking the key", needs: false };
    case "degraded":
      return { label: "Partly working", needs: true };
    case "blocked":
      return { label: "Stopped", needs: true };
    case "revoked":
      return { label: "Key withdrawn", needs: true };
    case "disconnected":
      return { label: "Disconnected", needs: true };
    default:
      return { label: "Not connected", needs: false };
  }
}

/** Nothing on the overview is waiting on the administrator. */
function schoolNeedsNothing(data: SchoolAdministrationOverview) {
  return (
    data.school.status === "active" &&
    !connectionWords(data.integration).needs &&
    !data.metrics.feedbackNew &&
    !data.metrics.invitations &&
    Boolean(data.integration)
  );
}

function dateRange() {
  return {
    fromDay: new Date(Date.now() - 29 * 24 * 60 * 60_000).toISOString().slice(0, 10),
    toDay: new Date().toISOString().slice(0, 10),
  };
}

const dayAndTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Where ManageBac's settings live, or why an operator cannot open them from here. */
function ManageBacLink({ operator, children }: { operator: boolean; children: ReactNode }) {
  return operator ? (
    <InlineLink disabled title="ManageBac settings open only for this school's own administrators.">
      {children}
    </InlineLink>
  ) : (
    <InlineLink href="/managebac">{children}</InlineLink>
  );
}

function OverviewSurface({
  data,
  operator,
  onTab,
}: {
  data: SchoolAdministrationOverview;
  operator: boolean;
  onTab: (tab: Tab) => void;
}) {
  const [allClasses, setAllClasses] = useState(false);
  const connection = connectionWords(data.integration);
  const totals = data.usage.totals;
  const aiTokens = (totals.model_input_tokens ?? 0) + (totals.model_output_tokens ?? 0);
  const classes = allClasses ? data.groupWorkspaces : data.groupWorkspaces.slice(0, 6);
  // What changed, not who looked: opening a page is logged too, but is no news.
  const changes = data.recentActivity.filter((event) => !event.action.endsWith(".viewed")).slice(0, 5);

  const needs: Array<{ id: string; tone?: "danger" | "quiet"; title: string; detail: string; action: ReactNode }> = [];
  if (data.school.status !== "active")
    needs.push({
      id: "status",
      tone: "danger",
      title: `The school is ${data.school.status}`,
      detail: "People cannot sign in to it until it is active again. The platform team can restore it.",
      action: null,
    });
  if (connection.needs)
    needs.push({
      id: "managebac",
      tone: "danger",
      title: `ManageBac: ${connection.label.toLowerCase()}`,
      detail: data.integration?.status !== "connected"
        ? ["revoked", "disconnected"].includes(data.integration?.status ?? "")
          ? "Reconnect ManageBac with a valid school API key to resume updates."
          : "Check the latest sync and connection so classes, tasks and deadlines stay up to date."
        : data.integration?.hasOpenConflicts
        ? "Source updates overlap with changes in Spectra. Review them before choosing which to keep."
        : data.integration?.syncFreshness === "never"
          ? "The connection is set up, but no complete sync has finished yet. Check its progress."
          : "Check the latest sync and connection so classes, tasks and deadlines stay up to date.",
      action: <ManageBacLink operator={operator}>Review ManageBac</ManageBacLink>,
    });
  if (data.metrics.feedbackNew)
    needs.push({
      id: "feedback",
      title: `${data.metrics.feedbackNew} new ${data.metrics.feedbackNew === 1 ? "report" : "reports"} from the school`,
      detail: "Read them and answer the people who wrote.",
      action: <InlineLink onClick={() => onTab("feedback")}>Read feedback</InlineLink>,
    });
  if (data.metrics.invitations)
    needs.push({
      id: "invitations",
      tone: "quiet",
      title: `${data.metrics.invitations} ${data.metrics.invitations === 1 ? "person has" : "people have"} not joined yet`,
      detail: "Their invitation is still open. Send it again or withdraw it from People.",
      action: <InlineLink onClick={() => onTab("people")}>People</InlineLink>,
    });
  if (!data.integration)
    needs.push({
      id: "connect",
      tone: "quiet",
      title: "Bring in classes from ManageBac",
      detail: "Connect it once and classes, tasks and deadlines arrive by themselves.",
      action: <ManageBacLink operator={operator}>Connect ManageBac</ManageBacLink>,
    });

  return (
    <div className="admin-page">
      {needs.length ? (
        <section>
          <AdminSectionHeader title="Needs you" />
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
          label="Members"
          value={formatCompact(data.metrics.members)}
          detail={`${data.metrics.active30d} signed in this month`}
          state={data.metricStates.members}
          source={metricDefinition("school.members").source}
          action={<InlineLink onClick={() => onTab("people")}>People</InlineLink>}
        />
        <MetricCard
          label="Waiting to join"
          value={formatCompact(data.metrics.invitations)}
          detail="Invitations not accepted yet"
          state={data.metricStates.invitations}
          source={metricDefinition("school.invitations").source}
          action={<InlineLink onClick={() => onTab("people")}>Invitations</InlineLink>}
        />
        <MetricCard
          label="Classes"
          value={formatCompact(data.metrics.classWorkspaces)}
          detail={data.metrics.groups ? `${data.metrics.groups} groups made here` : "From ManageBac"}
          state={data.metricStates.classWorkspaces}
          source={metricDefinition("school.class_workspaces").source}
          action={<InlineLink onClick={() => onTab("groups")}>Groups</InlineLink>}
        />
        <MetricCard
          label="New feedback"
          value={formatCompact(data.metrics.feedbackNew)}
          detail="Reports nobody has read yet"
          attention={data.metrics.feedbackNew > 0}
          action={<InlineLink onClick={() => onTab("feedback")}>Feedback</InlineLink>}
        />
      </TallySheet>

      <div className="admin-columns">
        <section>
          <AdminSectionHeader
            title="Classes"
            count={data.metrics.classWorkspaces}
            action={
              data.groupWorkspaces.length > 6 ? (
                <InlineLink onClick={() => setAllClasses((value) => !value)}>{allClasses ? "Fewer" : "Show all"}</InlineLink>
              ) : null
            }
          />
          {data.groupWorkspaces.length ? (
            <ul className="admin-ledger">
              {classes.map((workspace) => (
                <li key={workspace.workspaceId}>
                  <Link className="admin-line" href={`/workspace?workspaceId=${encodeURIComponent(workspace.workspaceId)}`}>
                    <span className="admin-line-main">
                      <strong>{workspace.title}</strong>
                    </span>
                    <span className="admin-line-meta">
                      {workspace.lastActivityAt ? `Active ${formatRelative(workspace.lastActivityAt).toLowerCase()}` : "No activity yet"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-ledger-empty">Classes appear here once ManageBac brings them in, or when you make a group.</p>
          )}
        </section>

        <section>
          <AdminSectionHeader title="Connections and usage" />
          <dl className="admin-facts">
            <div>
              <dt>ManageBac</dt>
              <dd>
                {connection.label}
                {data.integration?.lastSyncAt ? `, updated ${formatRelative(data.integration.lastSyncAt).toLowerCase()}` : ""}
              </dd>
            </div>
            <div>
              <dt>Files stored</dt>
              <dd>{formatBytes(totals.storage_bytes)}</dd>
            </div>
            <div>
              <dt>AI used this month</dt>
              <dd>{formatCompact(aiTokens)} tokens</dd>
            </div>
          </dl>
          <p className="mt-3 flex gap-4">
            <ManageBacLink operator={operator}>ManageBac settings</ManageBacLink>
            <InlineLink onClick={() => onTab("usage")}>Usage</InlineLink>
          </p>
        </section>
      </div>

      <section>
        <AdminSectionHeader title="Recent activity" action={<InlineLink onClick={() => onTab("audit")}>Activity log</InlineLink>} />
        {changes.length ? (
          <ul className="admin-ledger">
            {changes.map((event) => (
              <li key={event.eventId} className="admin-line">
                <span className="admin-line-main">
                  <strong>{auditActionWords(event.action)}</strong>
                  {event.operator ? <span>By the platform team</span> : null}
                </span>
                <span className="admin-line-meta">{formatRelative(event.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-ledger-empty">Nothing has changed yet.</p>
        )}
      </section>

      <PrivacyNotice>School admin shows who is in the school and how much it uses Spectra. Nobody’s artifact, threads or memory can be opened from here.</PrivacyNotice>
    </div>
  );
}

export function SchoolAdminShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const operatorSessionId = searchParams.get("operatorSessionId") ?? undefined;
  const requestedTab = searchParams.get("tab") as Tab | null;
  const [tab, setTabState] = useState<Tab>(
    requestedTab && tabs.some((item) => item.id === requestedTab) ? requestedTab : "overview",
  );
  const [overview, setOverview] = useState<SchoolAdministrationOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState("");

  const queryArgs = useMemo(() => ({ ...dateRange(), operatorSessionId }), [operatorSessionId]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setOverview(await getAdministration<SchoolAdministrationOverview>("schoolOverview", queryArgs));
    } catch (nextError) {
      setError(
        describeFailure(nextError, {
          fallback: "Check your connection, then try loading school admin again.",
        }).message,
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
        toast.error("Your time in this school ended.");
        router.replace("/superadmin?tab=schools");
      }
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [overview?.operatorSession, router]);

  const setTab = useCallback(
    (next: Tab) => {
      const query = new URLSearchParams(searchParams.toString());
      query.set("tab", next);
      if (!router.replace(`/admin?${query.toString()}`, { scroll: false })) return;
      setTabState(next);
    },
    [router, searchParams],
  );

  const readOnly = overview?.operatorSession?.mode === "inspect";

  /* One answer per action: the success toast (or none, `success: null`, when
     the caller words its own outcome) or the failure toast. It never rejects,
     so a caller's `void mutate(...)` cannot become an unhandled rejection;
     null means the action failed and has already been reported. It refreshes
     every surface itself, so callers do not refresh again. Inspecting, only
     leaving the school is an action. */
  const mutate = useCallback(
    async <T,>(
      label: string,
      action: string,
      payload: Record<string, unknown>,
      success: string | null,
    ): Promise<{ result: T } | null> => {
      if (readOnly && action !== "endOperatorSession") {
        toast.error(INSPECT_ONLY);
        return null;
      }
      setBusy(label);
      try {
        const result = await mutateAdministration<T>(action, { ...payload, operatorSessionId });
        if (success) toast.success(success);
        setRefreshKey((value) => value + 1);
        return { result };
      } catch (nextError) {
        toast.error(humanizePublicFailure(nextError ?? "Action failed."));
        return null;
      } finally {
        setBusy("");
      }
    },
    [operatorSessionId, readOnly],
  );

  if (!overview)
    return (
      <main className="spectra-wave-y relative isolate h-full min-h-0 flex-1 overflow-y-auto" data-spectra-app-surface="true">
        <PageBody>
          <PageHeader title="School admin" />
          {loading ? (
            <LoadingRows label="Opening school admin" count={6} className="mt-6" />
          ) : error ? (
            <div className="mt-6">
              <ErrorPanel message={error} retry={() => void loadOverview()} />
            </div>
          ) : null}
        </PageBody>
      </main>
    );

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
  const session = overview.operatorSession;
  const surface: SurfaceProps = { operatorSessionId, busy, mutate, refreshKey, readOnly };

  return (
    <main className="spectra-wave-y relative isolate h-full min-h-0 flex-1 overflow-y-auto" data-spectra-app-surface="true">
      {session ? (
        <div className="admin-operator" role="status">
          <KeyRound size={14} aria-hidden />
          <span>
            <strong>{session.label}</strong>.{" "}
            {session.mode === "inspect" ? "You are inspecting: you can read, not change." : "You can make changes."} Until{" "}
            {new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(session.expiresAt)}.
          </span>
          <InlineLink
            disabled={busy === "end-session"}
            onClick={() =>
              void mutate("end-session", "endOperatorSession", {}, "You left the school.").then((done) => {
                if (done) router.push("/superadmin?tab=schools");
              })
            }
          >
            Leave the school
          </InlineLink>
        </div>
      ) : null}

      <PageBody>
        <PageHeader
          title="School admin"
          commands={commands}
          plan={ADMIN_BAR_PLAN}
          barLabel="School admin commands"
          description={`${overview.school.name}. ${schoolNeedsNothing(overview) ? "Nothing needs you right now." : "A few things need you."}`}
        />

        <PanelTabs
          label="School admin sections"
          tabs={tabs}
          value={tab}
          onChange={(id) => setTab(id as Tab)}
          primaryCount={6}
          className="mb-6 mt-4"
        />

        {tab === "overview" ? (
          <OverviewSurface data={overview} operator={Boolean(session)} onTab={setTab} />
        ) : tab === "people" ? (
          <PeopleSurface {...surface} onRefresh={() => setRefreshKey((value) => value + 1)} />
        ) : tab === "groups" ? (
          <GroupsSurface {...surface} />
        ) : tab === "communication" ? (
          <CommunicationSurface {...surface} />
        ) : tab === "usage" ? (
          <UsageSurface overview={overview} />
        ) : tab === "agents" ? (
          <AgentsSurface operatorSessionId={operatorSessionId} refreshKey={refreshKey} />
        ) : tab === "integrations" ? (
          <ManageBacSurface overview={overview} operator={Boolean(session)} />
        ) : tab === "governance" ? (
          <RightsSurface />
        ) : tab === "feedback" ? (
          <FeedbackSurface {...surface} />
        ) : tab === "profile" ? (
          <ProfileSurface overview={overview} busy={busy} mutate={mutate} readOnly={readOnly} />
        ) : (
          <AuditSurface operatorSessionId={operatorSessionId} refreshKey={refreshKey} />
        )}
      </PageBody>
    </main>
  );
}

/** A section's records: kept from the last good read; a failed read says so and offers again. */
function useAdminRead<T>(read: () => Promise<T>, deps: readonly unknown[], failure: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    void read()
      .then((result) => active && setData(result))
      .catch((cause) => active && setError(describeFailure(cause, { fallback: failure }).message));
    return () => {
      active = false;
    };
    // The caller names what the read depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  return { data, error, retry: () => setAttempt((value) => value + 1) };
}

function GroupsSurface({ operatorSessionId, busy, mutate, refreshKey, readOnly }: SurfaceProps) {
  const read = useAdminRead(
    () =>
      Promise.all([
        getAdministration<{ groups: SchoolGroup[] }>("groups", { operatorSessionId }),
        getAdministration<{ people: Person[] }>("people", { operatorSessionId, status: "active" }),
      ]),
    [operatorSessionId, refreshKey],
    "Couldn’t read the groups. Check your connection, then try again.",
  );
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("class");
  const [members, setMembers] = useState<string[]>([]);
  const groups = read.data?.[0].groups ?? [];
  const people = read.data?.[1].people ?? [];

  return (
    <div className="admin-page">
      <section>
        <AdminSectionHeader
          title="Groups and classes"
          count={read.data ? groups.length : undefined}
          detail="Write to a class, a department or any group of people at once. Classes from ManageBac keep themselves up to date."
          action={
            <AdminButton tone="primary" disabled={readOnly} onClick={() => setOpen(true)}>
              <Plus size={13} />
              New group
            </AdminButton>
          }
        />
        {read.error ? (
          <ErrorPanel message={read.error} retry={read.retry} />
        ) : !read.data ? (
          <LoadingPanel label="Reading the groups" />
        ) : groups.length ? (
          <ul className="admin-ledger">
            {groups.map((group) => (
              <li key={group.groupId} className="admin-line">
                <LifeKey id={`group:${group.groupId}`} />
                <span className="admin-line-main">
                  <strong>{group.name}</strong>
                  <span>{group.description || plain(group.type)}</span>
                </span>
                <span className="admin-line-meta">
                  {group.memberCount} {group.memberCount === 1 ? "person" : "people"}
                </span>
                <span className="admin-line-meta w-[132px]">
                  {group.source === "manual" ? (
                    <InlineLink
                      disabled={readOnly || busy === `group-${group.groupId}`}
                      onClick={() =>
                        void mutate(`group-${group.groupId}`, "updateGroup", { groupId: group.groupId, archived: true }, `${group.name} archived.`)
                      }
                    >
                      Archive
                    </InlineLink>
                  ) : (
                    "From ManageBac"
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-ledger-empty">No groups yet. Make one, or connect ManageBac to bring in the school’s classes.</p>
        )}
      </section>
      <AdminDialog
        open={open}
        onClose={() => setOpen(false)}
        title="New group"
        detail="A group is who a message can go to. It does not change what anyone can do in Spectra."
        footer={
          <>
            <AdminButton onClick={() => setOpen(false)}>Cancel</AdminButton>
            <AdminButton
              tone="primary"
              disabled={!name.trim() || busy === "create-group"}
              onClick={() =>
                void mutate("create-group", "createGroup", { name, description, type, memberAccountIds: members }, `${name} created.`).then((done) => {
                  if (!done) return;
                  setOpen(false);
                  setName("");
                  setDescription("");
                  setMembers([]);
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
          <TextAreaField label="What it is for" value={description} onChange={setDescription} rows={3} />
          <SelectField
            label="Kind"
            value={type}
            onChange={setType}
            options={[
              { value: "class", label: "Class" },
              { value: "department", label: "Department" },
              { value: "programme", label: "Programme" },
              { value: "custom", label: "Other" },
            ]}
          />
          <fieldset>
            <legend className="mb-2 text-micro font-medium text-[var(--text-secondary)]">People in it</legend>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-control border border-[var(--border-default)] p-2">
              {people.map((person) => (
                <label key={person.accountId} className="flex items-center gap-3 rounded-chip px-2 py-2 text-micro hover:bg-[var(--bg-secondary)]">
                  <input
                    type="checkbox"
                    checked={members.includes(person.accountId)}
                    onChange={(event) =>
                      setMembers((current) =>
                        event.target.checked ? [...current, person.accountId] : current.filter((id) => id !== person.accountId),
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate">{person.name}</strong>
                    <span className="truncate text-micro text-[var(--text-tertiary)]">{person.email}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </AdminDialog>
    </div>
  );
}

const AUDIENCE: Record<string, string> = { school: "everyone at school", roles: "some roles", groups: "some groups", people: "some people" };

/** Who a message went to, in words: the people by name when it went to a few. */
function audienceWords(row: Announcement) {
  if (row.origin === "platform") return row.targetKind === "roles" ? "the school’s admins" : row.targetKind === "people" ? (row.recipientNames?.[0] ?? "one person") : "everyone at school";
  if (row.targetKind === "people" && row.recipientNames?.length) {
    const more = row.audienceSnapshotCount - row.recipientNames.length;
    return `${row.recipientNames.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
  }
  return `${AUDIENCE[row.targetKind] ?? row.targetKind} (${row.audienceSnapshotCount})`;
}

function CommunicationSurface({ operatorSessionId, busy, mutate, refreshKey, readOnly }: SurfaceProps) {
  const read = useAdminRead(
    () => getAdministration<{ announcements: Announcement[] }>("announcements", { operatorSessionId }),
    [operatorSessionId, refreshKey],
    "Couldn’t read the messages. Check your connection, then try again.",
  );
  const [open, setOpen] = useState(false);
  const rows = read.data?.announcements ?? [];

  return (
    <div className="admin-page">
      <section>
        <AdminSectionHeader
          title="Messages"
          count={read.data ? rows.length : undefined}
          detail="Write to the whole school, some roles, some groups or chosen people. It lands in their Spectra notifications, and you can see how many have read it. Messages from Spectra to your school are listed here too."
          action={
            <AdminButton tone="primary" disabled={readOnly} onClick={() => setOpen(true)}>
              <Plus size={13} />
              New message
            </AdminButton>
          }
        />
        {read.error ? (
          <ErrorPanel message={read.error} retry={read.retry} />
        ) : !read.data ? (
          <LoadingPanel label="Reading the messages" />
        ) : rows.length ? (
          <ul className="admin-ledger">
            {rows.map((row) => (
              <li key={row.announcementId} className="admin-line">
                <LifeKey id={`announcement:${row.announcementId}`} />
                <span className="admin-line-main">
                  <strong>{row.title}</strong>
                  <span>
                    {row.origin === "platform" ? "From Spectra, " : ""}
                    {row.sentAt
                      ? `sent ${formatRelative(row.sentAt).toLowerCase()}`
                      : row.scheduledAt
                        ? `goes out ${dayAndTime.format(row.scheduledAt)}`
                        : plain(row.status).toLowerCase()}
                    , to {audienceWords(row)}
                  </span>
                </span>
                <span className="admin-line-meta" data-tone={row.failed ? "danger" : undefined}>
                  {row.status === "scheduled"
                    ? "Scheduled"
                    : row.status === "cancelled"
                      ? "Cancelled"
                      : `${row.read} of ${row.audienceSnapshotCount} read${row.failed ? `, ${row.failed} not delivered` : ""}`}
                </span>
                {row.status === "scheduled" && row.origin !== "platform" ? (
                  <InlineLink
                    disabled={readOnly || busy === `cancel-${row.announcementId}`}
                    onClick={() =>
                      void mutate(`cancel-${row.announcementId}`, "cancelAnnouncement", { announcementId: row.announcementId }, "Message cancelled.")
                    }
                  >
                    Cancel
                  </InlineLink>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-ledger-empty">No messages yet. Write one to reach the whole school, a class or one person.</p>
        )}
      </section>
      <MessageDialog open={open} onClose={() => setOpen(false)} operatorSessionId={operatorSessionId} busy={busy} mutate={mutate} />
    </div>
  );
}

/** The meters a school is measured by, in its own words, and how each is written. */
function UsageSurface({ overview }: { overview: SchoolAdministrationOverview }) {
  const { totals, series, completeThrough, people } = overview.usage;
  const limits = overview.limits;
  return (
    <div className="admin-page">
      <section>
        <AdminSectionHeader title="This month" detail={`The school’s totals over the last 30 days, counted up to ${completeThrough}. Nobody’s artifact is read to count them.`} />
        <TallySheet>
          {USAGE_METERS.map((item) => (
            <MetricCard key={item.key} label={item.label} value={formatMeter(totals[item.key], item.unit)} detail={item.detail} />
          ))}
        </TallySheet>
      </section>

      <section>
        <AdminSectionHeader title="Day by day" />
        <UsageDayChart series={series} through={completeThrough} people={people ?? {}} />
      </section>

      <PrivacyNotice>
        {limits.enforcement === "enforced"
          ? "Usage limits are on for this school: new AI requests stop once a limit is reached. The platform team sets them."
          : limits.enforcement === "simulate"
            ? "Usage limits are being tried out for this school. Nothing is blocked."
            : "This school has no usage limits."}
      </PrivacyNotice>
    </div>
  );
}

type AgentGovernance = {
  totals: { sharedAgents: number; invocations: number; feedback: number; passedEvaluations: number };
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
};

function AgentsSurface({ operatorSessionId, refreshKey }: { operatorSessionId?: string; refreshKey: number }) {
  const read = useAdminRead(
    () => getAdministration<AgentGovernance>("agentGovernance", { operatorSessionId }),
    [operatorSessionId, refreshKey],
    "Couldn’t read the school’s agents. Check your connection, then try again.",
  );
  const data = read.data;
  return (
    <div className="admin-page">
      <section>
        <AdminSectionHeader
          title="Agents shared with the school"
          detail="Agents people chose to share with everyone. Agents someone keeps to themselves never appear here."
          action={<InlineLink href="/agents?view=shared">Open them in Agents</InlineLink>}
        />
        {read.error ? (
          <ErrorPanel message={read.error} retry={read.retry} />
        ) : !data ? (
          <LoadingPanel label="Reading the school’s agents" />
        ) : (
          <TallySheet>
            <MetricCard label="Shared agents" value={formatCompact(data.totals.sharedAgents)} />
            <MetricCard label="Times used" value={formatCompact(data.totals.invocations)} detail="This month" />
            <MetricCard label="Ratings given" value={formatCompact(data.totals.feedback)} />
            <MetricCard label="Checks passed" value={formatCompact(data.totals.passedEvaluations)} detail="Tests their makers wrote" />
          </TallySheet>
        )}
      </section>
      {data?.agents.length ? (
        <section>
          <AdminSectionHeader title="Each agent" count={data.agents.length} />
          {data.agents.length ? (
            <ul className="admin-ledger">
              {data.agents.map((agent) => (
                <li key={agent.agentId} className="admin-line">
                  <span className="admin-line-main">
                    <strong>{agent.title}</strong>
                    <span>
                      Used {formatCompact(agent.invocations)} times
                      {agent.completionRate === null ? "" : `, finishes ${Math.round(agent.completionRate * 100)}% of the time`}
                      {agent.averageRating === null ? "" : `, rated ${agent.averageRating.toFixed(1)} of 5`}
                    </span>
                  </span>
                  <span className="admin-line-meta" data-tone={agent.suspendedReleases ? "danger" : undefined}>
                    {agent.suspendedReleases
                      ? `${agent.suspendedReleases} version paused`
                      : agent.evaluationPassRate === null
                        ? "No checks yet"
                        : `${Math.round(agent.evaluationPassRate * 100)}% of checks pass`}
                  </span>
                  <span className="admin-line-meta w-[96px]">{formatRelative(agent.updatedAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="admin-ledger-empty">Nobody has shared an agent with the school yet.</p>
          )}
        </section>
      ) : null}
      <PrivacyNotice>Only counts are shown. What people ask their agents, and what the agents answer, stays with them.</PrivacyNotice>
    </div>
  );
}

function ManageBacSurface({ overview, operator }: { overview: SchoolAdministrationOverview; operator: boolean }) {
  const integration = overview.integration;
  const connection = connectionWords(integration);
  const coverage = integration?.coverage;
  return (
    <div className="admin-page">
      <section>
        <AdminSectionHeader
          title="ManageBac"
          detail="Spectra reads the school’s classes, tasks and deadlines from ManageBac and keeps them up to date. It never writes anything back."
          action={<ManageBacLink operator={operator}>{integration ? "ManageBac settings" : "Connect ManageBac"}</ManageBacLink>}
        />
        <dl className="admin-facts">
          <div>
            <dt>Connection</dt>
            <dd>
              <StatusBadge tone={connection.needs ? "attention" : integration ? "healthy" : "neutral"}>{connection.label}</StatusBadge>
            </dd>
          </div>
          <div>
            <dt>Last brought up to date</dt>
            <dd>{formatRelative(integration?.lastSyncAt)}</dd>
          </div>
          <div>
            <dt>Next update</dt>
            <dd>{integration?.nextSyncAt ? dayAndTime.format(integration.nextSyncAt) : "Not planned"}</dd>
          </div>
          {coverage?.discovered ? (
            <div>
              <dt>School records it can read</dt>
              <dd>
                {coverage.verifiedReadable} of {coverage.discovered} kinds
                {coverage.failed ? `, ${coverage.failed} failing` : ""}
              </dd>
            </div>
          ) : null}
        </dl>
        {operator ? (
          <p className="admin-footnote mt-3">ManageBac settings open only for this school’s own administrators.</p>
        ) : null}
      </section>
      <section>
        <AdminSectionHeader title="What it does" />
        <ul className="admin-ledger">
          {[
            ["Reads, never writes", "Nothing in Spectra changes the school’s ManageBac."],
            ["Keeps people’s own changes", "When the school updates a task, the notes and plans students added to it stay."],
            ["Archives instead of deleting", "A class that ends in ManageBac is archived here with its artifact, not removed."],
            ["Keeps the key on the server", "The ManageBac key is never sent to anyone’s browser."],
          ].map(([title, detail]) => (
            <li key={title} className="admin-line">
              <span className="admin-line-main">
                <strong>{title}</strong>
                <p>{detail}</p>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function RightsSurface() {
  return (
    <div className="admin-page">
      <section>
        <AdminSectionHeader
          title="What everyone can do"
          detail="School admin adds tools for running the school. It never takes anything away from the people in it."
        />
        <ul className="admin-ledger">
          {[
            ["Use the full AI", "Every student and teacher has the same models and tools."],
            ["Keep a memory", "Spectra remembers what helps each person. Only they can see or clear it."],
            ["Make and share agents", "Anyone can build an agent, use it and share it."],
            ["Make every kind of artifact", "Documents, decks, quizzes, code and the rest, with import and export."],
            ["Decide who sees their artifacts", "An artifact is private until its owner shares it."],
          ].map(([title, detail]) => (
            <li key={title} className="admin-line">
              <span className="admin-line-main">
                <strong>{title}</strong>
                <p>{detail}</p>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <AdminSectionHeader title="What school admin can see" />
        <ul className="admin-ledger">
          {[
            ["Can see", "Who is in the school, groups, announcements, totals of use, feedback sent to the school, and this school’s activity log."],
            ["Cannot see", "Anyone’s artifact, threads, prompts or memory, unless its owner shares it with them."],
          ].map(([title, detail]) => (
            <li key={title} className="admin-line">
              <span className="admin-line-main">
                <strong>{title}</strong>
                <p>{detail}</p>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const FEEDBACK_STATUS: Record<string, string> = {
  new: "New",
  triaged: "Read",
  in_progress: "Being handled",
  resolved: "Resolved",
  closed: "Closed",
};

type FeedbackEvidenceData = {
  feedbackId: string;
  pagePath: string | null;
  screenshotUrl: string | null;
  attachments: Array<{ name: string; mediaType: string; bytes: number; url: string | null }>;
};

function FeedbackEvidence({ feedbackId, operatorSessionId }: { feedbackId: string; operatorSessionId?: string }) {
  const evidence = useAdminRead(
    () => getAdministration<FeedbackEvidenceData>("feedbackEvidence", { feedbackId, operatorSessionId }),
    [feedbackId, operatorSessionId],
    "Couldn’t load the files sent with this report. Try again.",
  );
  if (evidence.error) return <ErrorPanel message={evidence.error} retry={evidence.retry} />;
  if (!evidence.data) return <LoadingPanel label="Reading attached evidence" />;
  return (
    <div className="space-y-3">
      {evidence.data.pagePath ? <p className="admin-footnote">Sent from {evidence.data.pagePath}</p> : null}
      {evidence.data.screenshotUrl ? (
        <a href={evidence.data.screenshotUrl} target="_blank" rel="noreferrer" aria-label="Open the reporter’s screenshot">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={evidence.data.screenshotUrl} alt="The page as the reporter saw it" className="max-h-80 w-full rounded-control object-contain" />
        </a>
      ) : null}
      {evidence.data.attachments.length ? (
        <div className="feedback-inbox-files">
          {evidence.data.attachments.map((file, index) => file.url ? (
            <a key={index} href={file.url} target="_blank" rel="noreferrer" title={file.name}>
              <FeedbackFilePreview name={file.name} mediaType={file.mediaType} url={file.url} />
              <span className="truncate">{file.name}</span>
            </a>
          ) : <p key={index} className="admin-footnote">{file.name}: file no longer available.</p>)}
        </div>
      ) : null}
    </div>
  );
}

function FeedbackSurface({ operatorSessionId, busy, mutate, refreshKey, readOnly }: SurfaceProps) {
  const read = useAdminRead(
    () => getAdministration<{ feedback: FeedbackItem[] }>("feedbackInbox", { operatorSessionId }),
    [operatorSessionId, refreshKey],
    "Couldn’t read the feedback. Check your connection, then try again.",
  );
  const [selected, setSelected] = useState<FeedbackItem | null>(null);
  const [response, setResponse] = useState("");
  const [status, setStatus] = useState("in_progress");
  const rows = read.data?.feedback ?? [];
  return (
    <div className="admin-page">
      <section>
        <AdminSectionHeader
          title="Feedback"
          count={read.data ? rows.length : undefined}
          detail="What people at the school sent about Spectra. Only the person who wrote it and the people answering can read it."
        />
        {read.error ? (
          <ErrorPanel message={read.error} retry={read.retry} />
        ) : !read.data ? (
          <LoadingPanel label="Reading the feedback" />
        ) : rows.length ? (
          <ul className="admin-ledger">
            {rows.map((item) => (
              <li key={item.feedbackId}>
                <button
                  type="button"
                  className="admin-line"
                  onClick={() => {
                    setSelected(item);
                    setResponse(item.response ?? "");
                    setStatus(item.status === "new" ? "in_progress" : item.status);
                  }}
                >
                  <span className="admin-line-main">
                    <strong>{item.subject}</strong>
                    <span>
                      {item.reporter?.name ?? "Someone who has left"}, {formatRelative(item.createdAt).toLowerCase()}: {item.message}
                    </span>
                  </span>
                  <span className="admin-line-meta" data-tone={item.status === "new" ? "attention" : undefined}>
                    {FEEDBACK_STATUS[item.status] ?? plain(item.status)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-ledger-empty">Nothing yet. What people send from the feedback button arrives here.</p>
        )}
      </section>
      <AdminDialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.subject ?? "Feedback"}
        detail={selected ? `${selected.reporter?.name ?? "Someone who has left"}, about ${plain(selected.category).toLowerCase()}` : undefined}
        footer={
          <>
            <AdminButton onClick={() => setSelected(null)}>Close</AdminButton>
            <AdminButton
              tone="primary"
              disabled={!selected || readOnly || busy === "feedback-response"}
              onClick={() =>
                selected &&
                void mutate("feedback-response", "respondFeedback", { feedbackId: selected.feedbackId, status, response }, "Answer saved.").then((done) => {
                  if (done) setSelected(null);
                })
              }
            >
              Save answer
            </AdminButton>
          </>
        }
      >
        {selected ? (
          <div className="space-y-4">
            <p className="whitespace-pre-wrap rounded-control bg-[var(--card-paper)] p-3 text-ui leading-6 ring-1 ring-[var(--card-border-soft)]">{selected.message}</p>
            <FeedbackEvidence key={selected.feedbackId} feedbackId={selected.feedbackId} operatorSessionId={operatorSessionId} />
            <SelectField
              label="Where it stands"
              value={status}
              onChange={setStatus}
              options={[
                { value: "triaged", label: "Read" },
                { value: "in_progress", label: "Being handled" },
                { value: "resolved", label: "Resolved" },
                { value: "closed", label: "Closed" },
              ]}
            />
            <TextAreaField label="Your answer (the person who wrote sees it)" value={response} onChange={setResponse} rows={5} />
          </div>
        ) : null}
      </AdminDialog>
    </div>
  );
}

function ProfileSurface({
  overview,
  busy,
  mutate,
  readOnly,
}: {
  overview: SchoolAdministrationOverview;
  busy: string;
  mutate: Mutate;
  readOnly: boolean;
}) {
  const school = overview.school;
  const [name, setName] = useState(school.name);
  const [timezone, setTimezone] = useState(school.timezone);
  const [locale, setLocale] = useState(school.locale ?? "en");
  const [domains, setDomains] = useState(school.verifiedDomains.join(", "));
  const [accent, setAccent] = useState(school.accentColor ?? "#15946d");
  const [logoUrl, setLogoUrl] = useState(school.logoUrl ?? "");
  const [start, setStart] = useState(school.academicYearStart ?? "");
  const [end, setEnd] = useState(school.academicYearEnd ?? "");
  const [reducedMotion, setReducedMotion] = useState(school.accessibilityDefaults?.reducedMotion ?? false);
  const [contrast, setContrast] = useState(school.accessibilityDefaults?.increasedContrast ?? false);
  const [largerText, setLargerText] = useState(school.accessibilityDefaults?.largerText ?? false);
  const field = (label: string, hint: string | null, input: ReactNode) => (
    <label key={label}>
      <span className="admin-form-label">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      {input}
    </label>
  );
  const text = (value: string, onChange: (value: string) => void, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <input value={value} disabled={readOnly} onChange={(event) => onChange(event.target.value)} {...props} />
  );
  return (
    <div className="admin-page">
      <section>
        <AdminSectionHeader
          title="School profile"
          detail="How the school is named and shown, its calendar, and the comfort settings new members start with."
          action={
            <AdminButton
              tone="primary"
              disabled={readOnly || busy === "profile"}
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
                    accessibilityDefaults: { reducedMotion, increasedContrast: contrast, largerText },
                  },
                  "School profile saved.",
                )
              }
            >
              <Save size={12} />
              Save changes
            </AdminButton>
          }
        />
        <div className="admin-form">
          {field("Name", null, text(name, setName))}
          {field("Time zone", "Deadlines and reminders follow it", text(timezone, setTimezone, { placeholder: "Europe/Madrid" }))}
          {field("Language", "A code such as en or es", text(locale, setLocale))}
          {field("School email domains", "People with these addresses can be invited straight in. Separate with commas.", text(domains, setDomains, { placeholder: "school.org" }))}
          {field(
            "Colour",
            null,
            <span className="flex items-center gap-2">
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : "#15946d"} disabled={readOnly} onChange={(event) => setAccent(event.target.value)} className="!h-9 !w-12 !p-1" aria-label="Pick the colour" />
              {text(accent, setAccent, { "aria-label": "Colour code" })}
            </span>,
          )}
          {field("Logo", "A link to the logo image, starting https://", text(logoUrl, setLogoUrl, { type: "url" }))}
          {field("School year starts", null, text(start, setStart, { type: "date" }))}
          {field("School year ends", null, text(end, setEnd, { type: "date" }))}
        </div>
      </section>
      <section>
        <AdminSectionHeader title="New members start with" detail="Each person can change these for themselves." />
        <div className="admin-form">
          {(
            [
              ["Less motion", reducedMotion, setReducedMotion],
              ["More contrast", contrast, setContrast],
              ["Larger text", largerText, setLargerText],
            ] as const
          ).map(([label, checked, setter]) =>
            field(label, null, <input type="checkbox" checked={checked} disabled={readOnly} onChange={(event) => setter(event.target.checked)} className="size-4 justify-self-start" />),
          )}
        </div>
      </section>
    </div>
  );
}

function AuditSurface({ operatorSessionId, refreshKey }: { operatorSessionId?: string; refreshKey: number }) {
  // "changes" hides the record of people merely opening admin pages, which
  // otherwise buries every real change under a wall of "viewed".
  const [filter, setFilter] = useState("changes");
  const prefix = filter.endsWith(".") ? filter : undefined;
  const read = useAdminRead(
    () => getAdministration<{ events: AuditEvent[] }>("audit", { operatorSessionId, actionPrefix: prefix, limit: 250 }),
    [operatorSessionId, prefix, refreshKey],
    "Couldn’t read the activity log. Check your connection, then try again.",
  );
  const events = (read.data?.events ?? []).filter((event) => filter !== "changes" || !event.action.endsWith("viewed"));
  return (
    <div className="admin-page">
      <section>
        <AdminSectionHeader
          title="Activity log"
          detail="Every change made from school admin, and by the platform team, with when it happened. Opening this log is itself recorded."
          action={
            <SelectField
              ariaLabel="Show"
              value={filter}
              onChange={setFilter}
              size="sm"
              options={[
                { value: "changes", label: "Changes" },
                { value: "all", label: "Changes and views" },
                { value: "membership.", label: "People and invitations" },
                { value: "school.group.", label: "Groups" },
                { value: "announcement.", label: "Announcements" },
                { value: "integration.", label: "ManageBac" },
                { value: "school.profile.", label: "School profile" },
                { value: "operator.", label: "Platform team visits" },
              ]}
            />
          }
        />
        {read.error ? (
          <ErrorPanel message={read.error} retry={read.retry} />
        ) : !read.data ? (
          <LoadingPanel label="Reading the activity log" />
        ) : events.length ? (
          <ul className="admin-ledger">
            {events.map((event) => (
              <li key={event.eventId} className="admin-line">
                <span className="admin-line-main">
                  <strong>{auditActionWords(event.action)}</strong>
                  <span>
                    {auditTargetWords(event.targetType)}
                    {event.operatorSessionId ? ", by the platform team" : ""}
                  </span>
                </span>
                <span className="admin-line-meta">{dayAndTime.format(event.createdAt)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="admin-ledger-empty">Nothing of this kind has happened yet.</p>
        )}
      </section>
    </div>
  );
}
