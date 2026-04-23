"use client";

import { Suspense } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Building2,
  Database,
  MessageSquare,
  Plus,
  Search,
  Send,
  Shield,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Breadcrumb } from "@/components/ui/breadcrumb";

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
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.max(0, value) / 100);
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

function monthKeyFromDay(day: string) {
  return day.slice(0, 7);
}

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const value = new Date(Date.UTC(year, (month ?? 1) - 1, 1));
  return value.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function MonthPager({
  monthLabel,
  previousDisabled,
  nextDisabled,
  onPrevious,
  onNext,
}: {
  monthLabel: string;
  previousDisabled: boolean;
  nextDisabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Button type="button" variant="secondary" size="icon" className="h-8 w-8" onClick={onPrevious} disabled={previousDisabled}>
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <div className="min-w-[9rem] rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1 text-center text-[11px] font-medium text-[var(--text-primary)]">
        {monthLabel}
      </div>
      <Button type="button" variant="secondary" size="icon" className="h-8 w-8" onClick={onNext} disabled={nextDisabled}>
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [errorEvents, setErrorEvents] = useState<Array<{
    _id: string;
    level: string;
    message: string;
    source?: string;
    createdAt: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [announcementAudience, setAnnouncementAudience] = useState<"all" | "org" | "email">("all");
  const [announcementOrgId, setAnnouncementOrgId] = useState("");
  const [recipientEmailInput, setRecipientEmailInput] = useState("");
  const [recipientEmails, setRecipientEmails] = useState<string[]>([]);
  const [recipientDropdownOpen, setRecipientDropdownOpen] = useState(false);
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementBody, setAnnouncementBody] = useState("");
  const [announcementActionUrl, setAnnouncementActionUrl] = useState("");
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false);
  const [selectedUsageDay, setSelectedUsageDay] = useState<string | null>(null);
  const [resettingPlatform, setResettingPlatform] = useState(false);
  const [selectedOrgMembers, setSelectedOrgMembers] = useState("");
  const [orgMembers, setOrgMembers] = useState<Array<{_id: string; name: string; email: string; role: string; createdAt: number}>>([]);
  const [membersSearch, setMembersSearch] = useState("");
  const [loadingMembers, setLoadingMembers] = useState(false);
  const knownEmails = useMemo(
    () =>
      Array.from(
        new Set(admins.map((admin) => admin.email.trim()).filter((email) => email.includes("@"))),
      ),
    [admins],
  );
  const usageByDay = useMemo(() => stats?.usage?.byDay ?? [], [stats?.usage?.byDay]);
  const usageByWeek = useMemo(() => stats?.usage?.byWeek ?? [], [stats?.usage?.byWeek]);
  const availableUsageMonths = useMemo(
    () => Array.from(new Set(usageByDay.map((row) => monthKeyFromDay(row.day)).filter(Boolean))).sort(),
    [usageByDay],
  );
  const [selectedUsageMonthIndex, setSelectedUsageMonthIndex] = useState(0);
  useEffect(() => {
    setSelectedUsageMonthIndex((prev) => {
      if (availableUsageMonths.length === 0) return 0;
      if (prev >= 0 && prev < availableUsageMonths.length) return prev;
      return availableUsageMonths.length - 1;
    });
  }, [availableUsageMonths]);
  const selectedUsageMonth =
    availableUsageMonths[selectedUsageMonthIndex] ??
    availableUsageMonths[availableUsageMonths.length - 1] ??
    monthKeyFromDay(new Date().toISOString().slice(0, 10));
  const dayWindow = useMemo(
    () => usageByDay.filter((row) => monthKeyFromDay(row.day) === selectedUsageMonth),
    [selectedUsageMonth, usageByDay],
  );
  const weeklyWindow = useMemo(
    () => usageByWeek.filter((row) => monthKeyFromDay(row.weekStart) === selectedUsageMonth),
    [selectedUsageMonth, usageByWeek],
  );
  const firstDayLabel = dayWindow[0] ? compactDayLabel(dayWindow[0].day) : "—";
  const lastDayLabel = dayWindow.length > 0 ? compactDayLabel(dayWindow[dayWindow.length - 1].day) : "—";
  const maxDayTokens = Math.max(1, ...dayWindow.map((row) => row.totalTokens));
  const maxDaySpend = Math.max(1, ...dayWindow.map((row) => row.effectiveCostCents ?? row.totalCostCents));
  const maxWeekSpend = Math.max(1, ...weeklyWindow.map((row) => row.effectiveCostCents ?? row.totalCostCents));
  const selectedDayDetails =
    (selectedUsageDay ? dayWindow.find((row) => row.day === selectedUsageDay) : dayWindow[dayWindow.length - 1])
    ?? null;
  useEffect(() => {
    setSelectedUsageDay(dayWindow[dayWindow.length - 1]?.day ?? null);
  }, [dayWindow]);

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

        const errorsResponse = await fetch("/api/super-admin/errors?limit=20");
        if (errorsResponse.ok) {
          const errorsData = (await errorsResponse.json()) as { errors?: Array<{ _id: string; level: string; message: string; source?: string; createdAt: number }> };
          setErrorEvents(errorsData.errors ?? []);
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

    if (!title || !body) {
      toast.error("Title and message are required.");
      return;
    }
    if (announcementAudience === "org" && !announcementOrgId) {
      toast.error("Choose a school target.");
      return;
    }
    if (announcementAudience === "email" && recipientEmails.length === 0) {
      toast.error("Add at least one recipient email.");
      return;
    }

    setSendingAnnouncement(true);
    try {
      let totalSent = 0;
      if (announcementAudience === "email") {
        // Send one request per email to stay compatible with current backend
        for (const email of recipientEmails) {
          const res = await fetch("/api/super-admin/notifications", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audience: "email", title, body, actionUrl: actionUrl || undefined, userEmail: email }),
          });
          if (!res.ok) throw new Error(await res.text());
          const p = (await res.json()) as { sentCount?: number };
          totalSent += p.sentCount ?? 1;
        }
      } else {
        const response = await fetch("/api/super-admin/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audience: announcementAudience,
            title,
            body,
            actionUrl: actionUrl || undefined,
            orgId: announcementAudience === "org" ? announcementOrgId : undefined,
          }),
        });
        if (!response.ok) throw new Error(await response.text());
        const payload = (await response.json()) as { sentCount?: number };
        totalSent = payload.sentCount ?? 0;
      }

      toast.success(`Announcement sent to ${totalSent} user${totalSent === 1 ? "" : "s"}.`);
      setAnnouncementTitle("");
      setAnnouncementBody("");
      setAnnouncementActionUrl("");
      setRecipientEmails([]);
      setRecipientEmailInput("");
      if (announcementAudience !== "org") {
        setAnnouncementOrgId("");
      }
      if (announcementAudience === "email") {
        setRecipientEmails([]);
        setRecipientEmailInput("");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send announcement");
    } finally {
      setSendingAnnouncement(false);
    }
  }

  async function fetchOrgMembers(orgId: string) {
    setLoadingMembers(true);
    try {
      const res = await fetch(`/api/super-admin/org-members?orgId=${encodeURIComponent(orgId)}`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { members?: Array<{_id: string; name: string; email: string; role: string; createdAt: number}> };
      setOrgMembers(data.members ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load members");
    } finally {
      setLoadingMembers(false);
    }
  }

  async function resetPlatformData() {
    const typed = window.prompt('Type "RESET PLATFORM DATA" to confirm full workspace reset (schools/users/settings stay).');
    if (!typed) return;
    if (typed.trim().toUpperCase() !== "RESET PLATFORM DATA") {
      toast.error("Reset cancelled: confirmation phrase did not match.");
      return;
    }

    setResettingPlatform(true);
    try {
      const response = await fetch("/api/super-admin/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resetPlatformData",
          confirmation: typed.trim(),
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      toast.success("Platform data reset completed.");
      window.location.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reset platform data");
    } finally {
      setResettingPlatform(false);
    }
  }

  async function removeSuperAdminMember(userId: string) {
    if (!window.confirm("Remove this member? This will delete all their data.")) return;
    try {
      const res = await fetch("/api/super-admin/org-members", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success("Member removed");
      setOrgMembers((prev) => prev.filter((m) => m._id !== userId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove member");
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
            <Link href="/chat">
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
    <Suspense fallback={<div className="p-10 text-center text-sm text-[var(--text-secondary)]">Loading...</div>}>
      <AppShell>
      <div className="space-y-8">
         {/* Header */}
         <div className="flex flex-wrap items-start justify-between gap-4">
           <div>
             <Breadcrumb items={[{ label: "Super Admin" }]} />
             <h1 className="font-display text-3xl text-[var(--text-primary)] mt-2">Platform Overview</h1>
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
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-xl">Usage Intelligence</h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  Detailed usage from the last {stats.usage.days} days.
                </p>
              </div>
              <MonthPager
                monthLabel={formatMonthLabel(selectedUsageMonth)}
                previousDisabled={selectedUsageMonthIndex <= 0}
                nextDisabled={selectedUsageMonthIndex >= availableUsageMonths.length - 1}
                onPrevious={() => setSelectedUsageMonthIndex((value) => Math.max(0, value - 1))}
                onNext={() => setSelectedUsageMonthIndex((value) => Math.min(availableUsageMonths.length - 1, value + 1))}
              />
            </div>

            <div className="mb-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-primary)] p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-[var(--text-secondary)]">Daily token and spend trend</p>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">Tokens on the left axis, spend on the right axis.</p>
                </div>
                <p className="text-xs text-[var(--text-secondary)]">{firstDayLabel} to {lastDayLabel}</p>
              </div>
              {dayWindow.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart
                    data={dayWindow.map((row) => ({
                      day: compactDayLabel(row.day),
                      rawDay: row.day,
                      tokens: row.totalTokens,
                      spend: row.effectiveCostCents ?? row.totalCostCents,
                    }))}
                    margin={{ top: 6, right: 8, left: -18, bottom: 0 }}
                  >
                    <CartesianGrid vertical={false} stroke="var(--border-default)" strokeOpacity={0.45} />
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="tokens" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} tickLine={false} axisLine={false} width={44} />
                    <YAxis yAxisId="spend" orientation="right" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} tickLine={false} axisLine={false} width={44} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border-default)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--text-primary)",
                      }}
                      formatter={(value: number, name: string) =>
                        name === "tokens" ? [value.toLocaleString(), "Tokens"] : [formatCurrencyCents(value), "Spend"]
                      }
                    />
                    <Bar
                      yAxisId="tokens"
                      dataKey="tokens"
                      fill="var(--accent-cyan)"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={24}
                      onClick={(payload) => {
                        const day = payload?.rawDay;
                        if (typeof day === "string") setSelectedUsageDay(day);
                      }}
                    />
                    <Line yAxisId="spend" type="monotone" dataKey="spend" stroke="var(--accent-coral)" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-10 text-center text-sm text-[var(--text-secondary)]">No daily usage captured in this month.</p>
              )}
            </div>

            <div className="mb-4 hidden grid gap-4 lg:grid-cols-2">
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
                  {dayWindow.slice(-6).map((day) => (
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
              <p className="mb-2 text-xs text-[var(--text-secondary)]">Weekly spend</p>
              <div className="space-y-2">
                {weeklyWindow.map((week) => (
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
                {weeklyWindow.length === 0 ? (
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
              <span className="text-xs text-[var(--text-secondary)]">Audience</span>
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
                <span className="text-xs text-[var(--text-secondary)]">School</span>
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
              <div className="space-y-1.5" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setRecipientDropdownOpen(false); }}>
                <span className="text-xs text-[var(--text-secondary)]">Recipient emails</span>
                <div className="relative">
                  <input
                    value={recipientEmailInput}
                    onChange={(e) => { setRecipientEmailInput(e.target.value); setRecipientDropdownOpen(true); }}
                    onFocus={() => setRecipientDropdownOpen(true)}
                    placeholder="Search by email…"
                    className="h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent-cyan)_32%,transparent)]"
                  />
                  {recipientDropdownOpen && recipientEmailInput.trim() && (() => {
                    const needle = recipientEmailInput.trim().toLowerCase();
                    const filtered = knownEmails.filter((e) => !recipientEmails.includes(e) && e.toLowerCase().includes(needle)).slice(0, 8);
                    if (filtered.length === 0) return null;
                    return (
                      <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-soft)]">
                        {filtered.map((email) => (
                          <button
                            key={email}
                            type="button"
                            className="flex w-full items-center px-3 py-2.5 text-left text-sm hover:bg-[var(--bg-hover)]"
                            onMouseDown={(e) => { e.preventDefault(); setRecipientEmails((prev) => [...prev, email]); setRecipientEmailInput(""); setRecipientDropdownOpen(false); }}
                          >
                            {email}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>
                {recipientEmails.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {recipientEmails.map((email) => (
                      <span key={email} className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] py-0.5 pl-2.5 pr-1.5 text-xs text-[var(--text-primary)]">
                        {email}
                        <button type="button" onClick={() => setRecipientEmails((prev) => prev.filter((e) => e !== email))} className="rounded-full hover:opacity-70">
                          <X className="h-3 w-3 text-[var(--text-secondary)]" />
                        </button>
                      </span>
                    ))}
                    <button type="button" onClick={() => setRecipientEmails([])} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                      Clear all
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5 text-xs text-[var(--text-secondary)]">
                Everyone on the platform will receive this message.
              </div>
            )}

            <label className="space-y-1.5 lg:col-span-2">
              <span className="text-xs text-[var(--text-secondary)]">Title</span>
              <input
                value={announcementTitle}
                onChange={(event) => setAnnouncementTitle(event.target.value)}
                maxLength={180}
                placeholder="New feature update"
                className="h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent-cyan)_32%,transparent)]"
              />
            </label>

            <label className="space-y-1.5 lg:col-span-2">
              <span className="text-xs text-[var(--text-secondary)]">Message</span>
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
              <span className="text-xs text-[var(--text-secondary)]">Action URL (optional)</span>
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
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-xl">Storage Insights</h2>
              <Button
                type="button"
                variant="secondary"
                className="cursor-pointer text-[var(--danger)] hover:text-[var(--danger)]"
                disabled={resettingPlatform}
                onClick={() => void resetPlatformData()}
              >
                {resettingPlatform ? "Resetting..." : "Reset Workspace Data"}
              </Button>
            </div>
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
              <h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
                <Database className="h-3.5 w-3.5" />
                Largest Uploaded Files
              </h3>
              {storageStats.largestFiles.length === 0 ? (
                <p className="text-sm text-[var(--text-secondary)]">No files uploaded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
                        <th className="pb-2 font-medium">Filename</th>
                        <th className="pb-2 font-medium">Size</th>
                        <th className="pb-2 font-medium">Type</th>
                        <th className="pb-2 font-medium">Owner</th>
                        <th className="pb-2 font-medium w-20">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storageStats.largestFiles.slice(0, 6).map((file) => (
                        <tr key={file.resourceId} className="border-b border-[var(--border-default)]">
                          <td className="py-2.5 pr-3 truncate max-w-[200px] text-[var(--text-primary)]">{file.filename}</td>
                          <td className="py-2.5 pr-3 text-[var(--text-secondary)]">{file.sizeMegabytes.toLocaleString()} MB</td>
                          <td className="py-2.5 pr-3 text-[var(--text-secondary)]">{file.scope ?? 'file'}</td>
                          <td className="py-2.5 pr-3 text-[var(--text-secondary)]">{file.orgName ?? '—'}</td>
                          <td className="py-2.5"><button type="button" className="text-xs text-[var(--danger)] hover:underline">Delete</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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

        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6">
          <div className="mb-4">
            <h2 className="font-display text-xl">Members</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Browse and manage members across all schools.
            </p>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-3">
            <select
              value={selectedOrgMembers}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedOrgMembers(val);
                if (val) void fetchOrgMembers(val);
                else setOrgMembers([]);
              }}
              className="h-9 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] outline-none"
            >
              <option value="">Select a school...</option>
              {orgs.map((org) => (
                <option key={org._id} value={org._id}>{org.name}</option>
              ))}
            </select>
            {selectedOrgMembers && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--text-secondary)]" />
                <input
                  value={membersSearch}
                  onChange={(e) => setMembersSearch(e.target.value)}
                  placeholder="Search members..."
                  className="h-9 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] pl-8 pr-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]"
                />
              </div>
            )}
            {loadingMembers && <span className="text-xs text-[var(--text-secondary)]">Loading...</span>}
          </div>

          {selectedOrgMembers && orgMembers.length === 0 && !loadingMembers ? (
            <p className="text-sm text-[var(--text-secondary)]">No members found.</p>
          ) : orgMembers.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Email</th>
                  <th className="pb-2 font-medium">Role</th>
                  <th className="pb-2 font-medium w-20">Action</th>
                </tr>
              </thead>
              <tbody>
                {orgMembers
                  .filter((m) => {
                    if (!membersSearch.trim()) return true;
                    const q = membersSearch.toLowerCase();
                    return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
                  })
                  .map((member) => (
                    <tr key={member._id} className="border-b border-[var(--border-default)]">
                      <td className="py-2.5 pr-3 font-medium text-[var(--text-primary)]">{member.name || "—"}</td>
                      <td className="py-2.5 pr-3 text-xs text-[var(--text-secondary)]">{member.email}</td>
                      <td className="py-2.5 pr-3">
                        <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                          {member.role}
                        </span>
                      </td>
                      <td className="py-2.5">
                        {member.role !== "admin" && (
                          <button
                            type="button"
                            onClick={() => void removeSuperAdminMember(member._id)}
                            className="text-xs text-[var(--danger)] hover:underline"
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : null}
        </section>

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
      {/* Recent Errors */}
      <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5">
        <h2 className="font-display text-lg text-[var(--text-primary)]">Recent Errors</h2>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">Server-side errors and warnings captured from the pipeline.</p>
        {errorEvents.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--text-secondary)]">No errors recorded yet.</p>
        ) : (
          <div className="mt-4 max-h-[400px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[var(--bg-elevated)]">
                <tr className="border-b border-[var(--border-default)]">
                  <th className="py-2 pr-3 text-left text-xs font-medium text-[var(--text-secondary)]">Time</th>
                  <th className="py-2 pr-3 text-left text-xs font-medium text-[var(--text-secondary)]">Level</th>
                  <th className="py-2 pr-3 text-left text-xs font-medium text-[var(--text-secondary)]">Source</th>
                  <th className="py-2 text-left text-xs font-medium text-[var(--text-secondary)]">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                {errorEvents.map((event) => (
                  <tr key={event._id}>
                    <td className="py-2 pr-3 whitespace-nowrap text-xs text-[var(--text-secondary)]">
                      {new Date(event.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${
                        event.level === "error"
                          ? "bg-[color-mix(in_oklab,var(--danger)_15%,transparent)] text-[var(--danger)]"
                          : "bg-[color-mix(in_oklab,var(--warning)_15%,transparent)] text-[var(--warning)]"
                      }`}>
                        {event.level}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-[var(--text-secondary)] max-w-[120px] truncate">{event.source ?? "—"}</td>
                    <td className="py-2 text-xs text-[var(--text-primary)] max-w-[400px] truncate">{event.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
    </Suspense>
  );
}
