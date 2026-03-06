"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  BellRing,
  Building2,
  Database,
  MessageSquare,
  Plus,
  Send,
  Shield,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

type GlobalStats = {
  totalOrgs: number;
  totalUsers: number;
  totalMessages: number;
  totalAdmins: number;
  usage?: {
    days: number;
    totals: {
      events: number;
      totalTokens: number;
      totalCostCents: number;
      effectiveCostCents?: number;
      estimatedCostCents?: number;
      unpricedEvents?: number;
    };
    byDay: Array<{
      day: string;
      events: number;
      totalTokens: number;
      totalCostCents: number;
      effectiveCostCents?: number;
      uniqueUsers: number;
    }>;
    byWeek: Array<{
      weekStart: string;
      events: number;
      totalTokens: number;
      totalCostCents: number;
      effectiveCostCents?: number;
    }>;
    topModels: Array<{
      modelId: string;
      modelLabel: string;
      events: number;
      totalTokens: number;
      totalCostCents: number;
      effectiveCostCents?: number;
    }>;
    topUsers: Array<{
      userId: string;
      name: string;
      email: string;
      role: string;
      orgName: string;
      events: number;
      totalTokens: number;
      totalCostCents: number;
      effectiveCostCents?: number;
      topModels: Array<{ modelId: string; modelLabel: string; tokens: number }>;
    }>;
    topOrgs: Array<{
      orgId: string;
      orgName: string;
      events: number;
      totalTokens: number;
      totalCostCents: number;
      effectiveCostCents?: number;
    }>;
  };
};

type StorageStats = {
  totalFiles: number;
  resourceFileCount: number;
  generatedImageCount: number;
  totalSizeBytes: number;
  totalSizeMegabytes: number;
  pinnedImageCount: number;
  expiringImageCountIn3Days: number;
  largestFiles: Array<{
    resourceId: string;
    orgName: string;
    filename: string;
    scope: "pack" | "personal" | "agent";
    sizeMegabytes: number;
  }>;
};

type AdminRow = {
  _id: string;
  name: string;
  email: string;
  orgName: string;
};

type OrgOption = {
  _id: string;
  name: string;
  slug: string;
};

type AuditLogRow = {
  _id: string;
  action: string;
  targetType: string;
  targetId: string;
  details?: string;
  createdAt: number;
  actorName?: string;
  actorEmail?: string;
};

const QUICK_ACTIONS = [
  { label: "View All Schools", href: "/super-admin/schools", icon: Building2, variant: "secondary" as const },
  { label: "Feedback Inbox", href: "/super-admin/feedback", icon: MessageSquare, variant: "secondary" as const },
  { label: "Create School", href: "/super-admin/schools/new", icon: Plus, variant: "default" as const },
];

function formatRelativeTime(ts: number) {
  const deltaSeconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (deltaSeconds < 60) return "just now";
  if (deltaSeconds < 3600) return `${Math.floor(deltaSeconds / 60)}m ago`;
  if (deltaSeconds < 86400) return `${Math.floor(deltaSeconds / 3600)}h ago`;
  return `${Math.floor(deltaSeconds / 86400)}d ago`;
}

function humanizeAuditAction(action: string) {
  return action
    .replace(/^super_admin\./, "")
    .split(/[._]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatCurrencyCents(value: number) {
  return `€${(Math.max(0, value) / 100).toFixed(2)}`;
}

function compactDayLabel(day: string) {
  const value = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(value.getTime())
    ? day
    : value.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function compactWeekLabel(day: string) {
  const value = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(value.getTime())
    ? day
    : value.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [announcementAudience, setAnnouncementAudience] = useState<"all" | "org" | "email">("all");
  const [announcementOrgId, setAnnouncementOrgId] = useState("");
  const [announcementEmail, setAnnouncementEmail] = useState("");
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementBody, setAnnouncementBody] = useState("");
  const [announcementActionUrl, setAnnouncementActionUrl] = useState("");
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false);
  const [selectedUsageDay, setSelectedUsageDay] = useState<string | null>(null);
  const knownEmails = useMemo(
    () =>
      Array.from(
        new Set(admins.map((admin) => admin.email.trim()).filter((email) => email.includes("@"))),
      ),
    [admins],
  );
  const usageByDay = stats?.usage?.byDay ?? [];
  const usageByWeek = stats?.usage?.byWeek ?? [];
  const dayWindow = usageByDay.slice(-14);
  const firstDayLabel = dayWindow[0] ? compactDayLabel(dayWindow[0].day) : "—";
  const lastDayLabel = dayWindow.length > 0 ? compactDayLabel(dayWindow[dayWindow.length - 1].day) : "—";
  const maxDayTokens = Math.max(1, ...usageByDay.map((row) => row.totalTokens));
  const maxDaySpend = Math.max(1, ...usageByDay.map((row) => row.effectiveCostCents ?? row.totalCostCents));
  const maxWeekSpend = Math.max(1, ...usageByWeek.map((row) => row.effectiveCostCents ?? row.totalCostCents));
  const selectedDayDetails =
    (selectedUsageDay ? usageByDay.find((row) => row.day === selectedUsageDay) : dayWindow[dayWindow.length - 1])
    ?? null;

  useEffect(() => {
    void (async () => {
      try {
        const [response, storageResponse] = await Promise.all([
          fetch("/api/super-admin/stats"),
          fetch("/api/super-admin/storage"),
        ]);

        if (response.status === 403 || response.status === 401) {
          setAccessDenied(true);
          return;
        }
        if (!response.ok) throw new Error(await response.text());
        const data = (await response.json()) as GlobalStats;
        setStats(data);

        if (storageResponse.ok) {
          const storageData = (await storageResponse.json()) as StorageStats;
          setStorageStats(storageData);
        }

        const adminsResponse = await fetch("/api/super-admin/admins");
        if (adminsResponse.ok) {
          const adminsData = (await adminsResponse.json()) as { admins?: AdminRow[] };
          setAdmins((adminsData.admins ?? []).slice(0, 6));
        }

        const orgsResponse = await fetch("/api/super-admin/schools");
        if (orgsResponse.ok) {
          const orgsData = (await orgsResponse.json()) as { orgs?: OrgOption[] };
          setOrgs(
            [...(orgsData.orgs ?? [])]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((org) => ({ _id: org._id, name: org.name, slug: org.slug })),
          );
        }

        const auditResponse = await fetch("/api/super-admin/audit-logs?limit=12");
        if (auditResponse.ok) {
          const auditData = (await auditResponse.json()) as { logs?: AuditLogRow[] };
          setAuditLogs(auditData.logs ?? []);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load stats");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function sendAnnouncement() {
    const title = announcementTitle.trim();
    const body = announcementBody.trim();
    const actionUrl = announcementActionUrl.trim();
    const email = announcementEmail.trim();

    if (!title || !body) {
      toast.error("Title and message are required.");
      return;
    }
    if (announcementAudience === "org" && !announcementOrgId) {
      toast.error("Choose a school target.");
      return;
    }
    if (announcementAudience === "email" && !email) {
      toast.error("Enter a recipient email.");
      return;
    }

    setSendingAnnouncement(true);
    try {
      const response = await fetch("/api/super-admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience: announcementAudience,
          title,
          body,
          actionUrl: actionUrl || undefined,
          orgId: announcementAudience === "org" ? announcementOrgId : undefined,
          userEmail: announcementAudience === "email" ? email : undefined,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = (await response.json()) as { sentCount?: number };
      toast.success(`Announcement sent to ${payload.sentCount ?? 0} user${payload.sentCount === 1 ? "" : "s"}.`);
      setAnnouncementTitle("");
      setAnnouncementBody("");
      setAnnouncementActionUrl("");
      if (announcementAudience !== "org") {
        setAnnouncementOrgId("");
      }
      if (announcementAudience !== "email") {
        setAnnouncementEmail("");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send announcement");
    } finally {
      setSendingAnnouncement(false);
    }
  }

  if (accessDenied) {
    return (
      <AppShell>
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="max-w-sm rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 text-center shadow-[var(--shadow-card)]">
            <Shield className="mx-auto mb-4 h-12 w-12 text-[var(--accent-coral)]" />
            <h2 className="mb-2 text-xl font-semibold">Super Admin Only</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              This area is restricted to super administrators.
            </p>
            <Link href="/">
              <Button className="mt-5 cursor-pointer" variant="secondary">
                Go back home
              </Button>
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl text-[var(--text-primary)]">Platform Overview</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Global management for all schools and users on the platform.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <Link key={action.href} href={action.href}>
                  <Button variant={action.variant} className="cursor-pointer gap-2">
                    <Icon className="h-4 w-4" />
                    {action.label}
                  </Button>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Stat strip */}
        <div className="flex flex-wrap divide-x divide-[var(--border-default)] border-t border-b border-[var(--border-default)]">
          <div className="px-4 py-3 first:pl-0">
            <p className="text-xs text-[var(--text-secondary)]">Schools</p>
            <p className="mt-0.5 text-2xl font-semibold">{loading ? "..." : (stats?.totalOrgs ?? 0).toLocaleString()}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-[var(--text-secondary)]">Users</p>
            <p className="mt-0.5 text-2xl font-semibold">{loading ? "..." : (stats?.totalUsers ?? 0).toLocaleString()}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-[var(--text-secondary)]">Messages</p>
            <p className="mt-0.5 text-2xl font-semibold">{loading ? "..." : (stats?.totalMessages ?? 0).toLocaleString()}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-[var(--text-secondary)]">Admins</p>
            <p className="mt-0.5 text-2xl font-semibold">{loading ? "..." : (stats?.totalAdmins ?? 0).toLocaleString()}</p>
          </div>
          {stats?.usage ? (
            <>
              <div className="px-4 py-3">
                <p className="text-xs text-[var(--text-secondary)]">60d tokens</p>
                <p className="mt-0.5 text-2xl font-semibold">{stats.usage.totals.totalTokens.toLocaleString()}</p>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs text-[var(--text-secondary)]">60d spend</p>
                <p className="mt-0.5 text-2xl font-semibold">{formatCurrencyCents(stats.usage.totals.effectiveCostCents ?? stats.usage.totals.totalCostCents)}</p>
              </div>
            </>
          ) : null}
        </div>

        {stats?.usage ? (
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6">
            <div className="mb-4">
              <h2 className="font-display text-xl">Usage Intelligence</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Detailed usage from the last {stats.usage.days} days.
              </p>
            </div>

            <div className="mb-4 grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs text-[var(--text-secondary)]">Daily token trend</p>
                <div className="mt-3 flex h-28 items-end gap-1.5">
                  {dayWindow.map((row) => (
                    <button
                      key={row.day}
                      type="button"
                      onClick={() => setSelectedUsageDay(row.day)}
                      className="group relative flex h-full flex-1 cursor-pointer items-end"
                      title={`${compactDayLabel(row.day)} · ${row.totalTokens.toLocaleString()} tokens`}
                    >
                      <span
                        className="w-full rounded-t-md bg-[color-mix(in_oklab,var(--accent-cyan)_70%,transparent)] transition group-hover:bg-[var(--accent-cyan)]"
                        style={{ height: `${Math.max(8, (row.totalTokens / maxDayTokens) * 100)}%` }}
                      />
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
                  <span>{firstDayLabel}</span>
                  <span>{lastDayLabel}</span>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs text-[var(--text-secondary)]">Daily spend trend</p>
                <div className="mt-3 flex h-28 items-end gap-1.5">
                  {dayWindow.map((row) => (
                    <button
                      key={`${row.day}-cost`}
                      type="button"
                      onClick={() => setSelectedUsageDay(row.day)}
                      className="group relative flex h-full flex-1 cursor-pointer items-end"
                      title={`${compactDayLabel(row.day)} · ${formatCurrencyCents(row.effectiveCostCents ?? row.totalCostCents)}`}
                    >
                      <span
                        className="w-full rounded-t-md bg-[color-mix(in_oklab,var(--accent-coral)_70%,transparent)] transition group-hover:bg-[var(--accent-coral)]"
                        style={{ height: `${Math.max(8, ((row.effectiveCostCents ?? row.totalCostCents) / maxDaySpend) * 100)}%` }}
                      />
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--text-secondary)]">
                  <span>{firstDayLabel}</span>
                  <span>{lastDayLabel}</span>
                </div>
              </div>
            </div>

            {selectedDayDetails ? (
              <div className="mb-4 border-l-2 border-[var(--accent-cyan)] pl-3 text-xs">
                <p className="text-[var(--text-secondary)]">{compactDayLabel(selectedDayDetails.day)}</p>
                <p className="mt-0.5 text-sm font-medium text-[var(--text-primary)]">
                  {selectedDayDetails.totalTokens.toLocaleString()} tokens · {formatCurrencyCents(selectedDayDetails.effectiveCostCents ?? selectedDayDetails.totalCostCents)} · {selectedDayDetails.uniqueUsers} users
                </p>
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-3">
              <div>
                <p className="mb-2 text-xs text-[var(--text-secondary)]">Top Models</p>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-[var(--border-default)] border-t border-[var(--border-default)]">
                  {stats.usage.topModels.slice(0, 6).map((model) => (
                    <tr key={model.modelId}>
                      <td className="py-1.5 pr-2 font-medium text-[var(--text-primary)]">{model.modelLabel}</td>
                      <td className="py-1.5 text-right text-[var(--text-secondary)]">
                        {model.totalTokens.toLocaleString()} tokens
                      </td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>

              <div>
                <p className="mb-2 text-xs text-[var(--text-secondary)]">Top Users</p>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-[var(--border-default)] border-t border-[var(--border-default)]">
                  {stats.usage.topUsers.slice(0, 6).map((user) => (
                    <tr key={user.userId}>
                      <td className="py-1.5 pr-2">
                        <p className="font-medium text-[var(--text-primary)]">{user.name || user.email}</p>
                        <p className="truncate text-[var(--text-secondary)]">{user.orgName}</p>
                      </td>
                      <td className="py-1.5 text-right text-[var(--text-secondary)]">
                        {user.totalTokens.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>

              <div>
                <p className="mb-2 text-xs text-[var(--text-secondary)]">Recent Daily Usage</p>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-[var(--border-default)] border-t border-[var(--border-default)]">
                  {stats.usage.byDay.slice(-6).map((day) => (
                    <tr key={day.day}>
                      <td className="py-1.5 pr-2 text-[var(--text-secondary)]">{compactDayLabel(day.day)}</td>
                      <td className="py-1.5 text-right font-medium text-[var(--text-primary)]">
                        {day.totalTokens.toLocaleString()} tok
                      </td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-xs text-[var(--text-secondary)]">Weekly spend (last 8)</p>
              <div className="space-y-2">
                {usageByWeek.slice(-8).map((week) => (
                  <div key={week.weekStart}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">Week of {compactWeekLabel(week.weekStart)}</span>
                      <span className="font-medium text-[var(--text-primary)]">{formatCurrencyCents(week.effectiveCostCents ?? week.totalCostCents)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                      <div
                        className="h-full rounded-full bg-[var(--gradient-brand)]"
                        style={{ width: `${Math.max(6, ((week.effectiveCostCents ?? week.totalCostCents) / maxWeekSpend) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
                {usageByWeek.length === 0 ? (
                  <p className="text-sm text-[var(--text-secondary)]">No weekly usage captured yet.</p>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6">
          <div className="mb-4">
            <h2 className="font-display text-xl">Broadcast Notification</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Send announcements to all users, one school, or a specific person.
            </p>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Audience</span>
              <select
                value={announcementAudience}
                onChange={(event) => setAnnouncementAudience(event.target.value as "all" | "org" | "email")}
                className="h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent-cyan)_32%,transparent)]"
              >
                <option value="all">All users</option>
                <option value="org">One school</option>
                <option value="email">Single user (email)</option>
              </select>
            </label>

            {announcementAudience === "org" ? (
              <label className="space-y-1.5">
                <span className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">School</span>
                <select
                  value={announcementOrgId}
                  onChange={(event) => setAnnouncementOrgId(event.target.value)}
                  className="h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent-cyan)_32%,transparent)]"
                >
                  <option value="">Select school</option>
                  {orgs.map((org) => (
                    <option key={org._id} value={org._id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : announcementAudience === "email" ? (
              <label className="space-y-1.5">
                <span className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Recipient email</span>
                <input
                  type="email"
                  list="super-admin-email-suggestions"
                  value={announcementEmail}
                  onChange={(event) => setAnnouncementEmail(event.target.value)}
                  placeholder="student@school.edu"
                  className="h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent-cyan)_32%,transparent)]"
                />
                <datalist id="super-admin-email-suggestions">
                  {knownEmails.map((email) => (
                    <option key={email} value={email} />
                  ))}
                </datalist>
              </label>
            ) : (
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5 text-xs text-[var(--text-secondary)]">
                Everyone on the platform will receive this message.
              </div>
            )}

            <label className="space-y-1.5 lg:col-span-2">
              <span className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Title</span>
              <input
                value={announcementTitle}
                onChange={(event) => setAnnouncementTitle(event.target.value)}
                maxLength={180}
                placeholder="New feature update"
                className="h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent-cyan)_32%,transparent)]"
              />
            </label>

            <label className="space-y-1.5 lg:col-span-2">
              <span className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Message</span>
              <textarea
                value={announcementBody}
                onChange={(event) => setAnnouncementBody(event.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="Share rollout notes, reminders, or action items."
                className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent-cyan)_32%,transparent)]"
              />
            </label>

            <label className="space-y-1.5 lg:col-span-2">
              <span className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Action URL (optional)</span>
              <input
                value={announcementActionUrl}
                onChange={(event) => setAnnouncementActionUrl(event.target.value)}
                placeholder="/achievements or https://..."
                className="h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent-cyan)_32%,transparent)]"
              />
            </label>
          </div>

          <div className="mt-4 flex items-center justify-end">
            <Button
              type="button"
              className="cursor-pointer gap-2"
              onClick={() => void sendAnnouncement()}
              disabled={sendingAnnouncement}
            >
              <Send className="h-4 w-4" />
              {sendingAnnouncement ? "Sending..." : "Send notification"}
            </Button>
          </div>
        </section>

        {storageStats && (
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6">
            <h2 className="mb-4 font-display text-xl">Storage Insights</h2>
            <div className="flex flex-wrap divide-x divide-[var(--border-default)] border-t border-b border-[var(--border-default)] mb-5">
              <div className="px-4 py-3 first:pl-0">
                <p className="text-xs text-[var(--text-secondary)]">Storage</p>
                <p className="mt-0.5 text-xl font-semibold">{storageStats.totalSizeMegabytes.toLocaleString()} MB</p>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs text-[var(--text-secondary)]">Files</p>
                <p className="mt-0.5 text-xl font-semibold">{storageStats.resourceFileCount.toLocaleString()}</p>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs text-[var(--text-secondary)]">Images</p>
                <p className="mt-0.5 text-xl font-semibold">{storageStats.generatedImageCount.toLocaleString()}</p>
                <p className="text-xs text-[var(--text-secondary)]">{storageStats.pinnedImageCount} pinned</p>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs text-[var(--text-secondary)]">Expiring soon</p>
                <p className="mt-0.5 text-xl font-semibold">{storageStats.expiringImageCountIn3Days.toLocaleString()}</p>
              </div>
            </div>

            <div>
              <p className="mb-3 text-xs text-[var(--text-secondary)]">
                <Database className="h-3.5 w-3.5" />
                Largest Uploaded Files
              </p>
              <div className="space-y-2">
                {storageStats.largestFiles.slice(0, 6).map((file) => (
                  <div
                    key={file.resourceId}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">{file.filename}</p>
                      <p className="truncate text-xs text-[var(--text-secondary)]">
                        {file.orgName} · {file.scope}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-[var(--text-primary)]">
                      {file.sizeMegabytes.toLocaleString()} MB
                    </span>
                  </div>
                ))}
                {storageStats.largestFiles.length === 0 && (
                  <p className="text-sm text-[var(--text-secondary)]">No files uploaded yet.</p>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6">
          <h2 className="mb-4 font-display text-xl">Recent Activity</h2>
          <div className="divide-y divide-[var(--border-default)]">
            {auditLogs.map((item) => (
              <div key={item._id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{humanizeAuditAction(item.action)}</p>
                  <p className="truncate text-xs text-[var(--text-secondary)]">
                    {item.details?.trim() || `${item.targetType}: ${item.targetId}`}
                    {" · "}{(item.actorName || item.actorEmail || "Unknown actor").trim()}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">
                  {formatRelativeTime(item.createdAt)}
                </span>
              </div>
            ))}
            {auditLogs.length === 0 && (
              <p className="py-4 text-sm text-[var(--text-secondary)]">No recent platform activity yet.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6">
          <h2 className="mb-4 font-display text-xl">School Admin Directory</h2>
          {admins.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">No admins found yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-[var(--border-default)]">
              {admins.map((admin) => (
                <tr key={admin._id}>
                  <td className="py-2 pr-3 font-medium text-[var(--text-primary)]">{admin.name}</td>
                  <td className="py-2 pr-3 text-xs text-[var(--text-secondary)]">{admin.email}</td>
                  <td className="py-2 text-xs text-[var(--text-secondary)]">{admin.orgName}</td>
                </tr>
              ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppShell>
  );
}
