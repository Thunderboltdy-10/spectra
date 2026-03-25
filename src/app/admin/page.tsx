"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, Bot, Cpu, MailPlus, Search, Send, Sparkles, Trash2, Users2, BarChart3, X } from "lucide-react";
import { toast } from "sonner";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@/components/layout/app-shell";
import { AdminOnboarding } from "@/components/onboarding/admin-onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { useSidebar } from "@/context/sidebar-context";

type OrgSettings = { name?: string; description?: string; schoolType?: string; timezone?: string; maxStudents?: number; maxResourceFileSizeBytes?: number; monthlyBudgetCentsPerUser?: number; budgetMarginPercent?: number; soulEnabled?: boolean; orchestratorV2Enabled?: boolean; searxngEnabled?: boolean; adaptiveQuizEnabled?: boolean; spacedRepetitionEnabled?: boolean; agentModelBoostEnabled?: boolean };
type OrgSettingsEnvelope = {
  org: OrgSettings;
  openRouterConfigured?: boolean;
  openRouterWarnings?: string[];
};
type Member = { _id: string; name: string; email: string; role: "student" | "teacher" | "admin"; createdAt: number };
type Invitation = { _id: string; email: string; role: "student" | "teacher" | "admin"; status: "pending" | "accepted" | "expired" | "cancelled"; expiresAt: number };
type AccessRequest = { _id: string; email: string; name: string; message?: string; createdAt: number };
type SchoolDashboard = { memberCount: number; studentCount: number; teacherCount: number; adminCount: number; messagesToday: number; pendingInvitations: number; orgName?: string };
type UsageRow = { day: string; inputTokens: number; outputTokens: number; totalTokens: number };
type SchoolAnalytics = { avgQuizScore?: number; totalQuizAttempts: number };
type LeaderboardEntry = { modelId: string; provider: string; name: string; totalTokens: number; usageCount: number };
type SchoolAgent = { _id: string; name: string; description: string; avatarEmoji: string; visibility: "public" | "private" | "shared"; usageCount: number; createdAt: number };

function shortDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

async function loadJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } | string };
      const msg = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
      throw new Error(msg || text);
    } catch (parseErr) {
      if (parseErr instanceof SyntaxError) throw new Error(text);
      throw parseErr;
    }
  }
  return response.json() as Promise<T>;
}

function AdminPageContent() {
  const router = useRouter();
  const { role, isSuperAdmin, loading: sidebarLoading } = useSidebar();
  const hasAdminAccess = role === "admin" || isSuperAdmin;
  const [loading, setLoading] = useState(true);
  const [onboardingComplete, setOnboardingComplete] = useState(true);
  const [org, setOrg] = useState<OrgSettings | null>(null);
  const [dashboard, setDashboard] = useState<SchoolDashboard | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [analytics, setAnalytics] = useState<SchoolAnalytics | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [schoolAgents, setSchoolAgents] = useState<SchoolAgent[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"student" | "teacher">("student");
  const [savingSettings, setSavingSettings] = useState(false);
  const [infraWarnings, setInfraWarnings] = useState<string[]>([]);
  const [selectedUsageDay, setSelectedUsageDay] = useState<string | null>(null);
  const [notifTitle, setNotifTitle] = useState("");
  const [notifBody, setNotifBody] = useState("");
  const [notifActionUrl, setNotifActionUrl] = useState("");
  const [notifEmailSearch, setNotifEmailSearch] = useState("");
  const [notifRecipients, setNotifRecipients] = useState<string[]>([]);
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);
  const [sendingNotif, setSendingNotif] = useState(false);

  async function refresh() {
    const [bootstrap, schoolDashboard, membersPayload, usagePayload, schoolAnalytics, modelPayload, agentsPayload] = await Promise.all([
      loadJson<{ actor: { onboardingComplete?: boolean }; orgSettings: OrgSettingsEnvelope }>("/api/bootstrap"),
      loadJson<SchoolDashboard>("/api/school-admin/dashboard"),
      loadJson<{ members: { members: Member[] }; invitations: Invitation[]; accessRequests?: AccessRequest[] }>("/api/school-admin/members"),
      loadJson<{ usage: UsageRow[] }>("/api/admin/users"),
      loadJson<SchoolAnalytics>("/api/school-admin/analytics?days=30"),
      loadJson<{ models: LeaderboardEntry[] }>("/api/analytics/model-leaderboard"),
      loadJson<{ agents: SchoolAgent[] }>("/api/agents").catch(() => ({ agents: [] })),
    ]);
    setOnboardingComplete(Boolean(bootstrap.actor.onboardingComplete));
    setOrg(bootstrap.orgSettings?.org ?? null);
    setInfraWarnings((bootstrap.orgSettings?.openRouterWarnings ?? []).filter((item) => item.trim().length > 0));
    setDashboard(schoolDashboard);
    setMembers(membersPayload.members?.members ?? []);
    setInvitations(membersPayload.invitations ?? []);
    setAccessRequests(membersPayload.accessRequests ?? []);
    setUsage(usagePayload.usage ?? []);
    setAnalytics(schoolAnalytics);
    setLeaderboard(modelPayload.models ?? []);
    setSchoolAgents((agentsPayload.agents ?? []).filter((a) => a.visibility !== "private"));
  }

  useEffect(() => {
    if (!sidebarLoading && !hasAdminAccess) router.replace("/");
  }, [hasAdminAccess, router, sidebarLoading]);

  useEffect(() => {
    if (sidebarLoading || !hasAdminAccess) return;
    setLoading(true);
    void refresh().catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load admin data")).finally(() => setLoading(false));
  }, [hasAdminAccess, sidebarLoading]);

  const filteredMembers = useMemo(() => {
    const needle = memberSearch.trim().toLowerCase();
    return needle ? members.filter((member) => (member.name?.toLowerCase() ?? "").includes(needle) || (member.email?.toLowerCase() ?? "").includes(needle)) : members;
  }, [memberSearch, members]);
  const seatUsed = members.length;
  const pendingInvites = invitations.filter((item) => item.status === "pending").length;

  async function completeOnboarding() {
    const response = await fetch("/api/personal-soul", { method: "PATCH" });
    if (!response.ok) throw new Error(await response.text());
    await refresh();
    setOnboardingComplete(true);
  }

  async function saveSettings() {
    if (!org) return;
    setSavingSettings(true);
    try {
      await loadJson("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(org) });
      toast.success("Settings saved");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  }

  async function inviteMember() {
    if (!inviteEmail.trim()) return toast.error("Enter an email first.");
    try {
      await loadJson("/api/school-admin/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }) });
      setInviteEmail("");
      toast.success("Invitation created");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to invite member");
    }
  }

  async function updateRole(userId: string, nextRole: "student" | "teacher") {
    try {
      await loadJson("/api/school-admin/members", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, role: nextRole, action: "updateRole" }) });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update member");
    }
  }

  async function deleteSchoolAgent(agentId: string) {
    if (!window.confirm("Remove this public agent? This cannot be undone.")) return;
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await response.text());
      toast.success("Agent removed");
      setSchoolAgents((prev) => prev.filter((a) => a._id !== agentId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove agent");
    }
  }

  async function cancelInvite(invitationId: string) {
    try {
      await loadJson("/api/school-admin/members", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invitationId, action: "cancelInvite" }) });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel invitation");
    }
  }

  async function approveAccessRequest(requestId: string, role: "student" | "teacher") {
    try {
      await loadJson("/api/school-admin/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, role, action: "approveAccessRequest" }),
      });
      toast.success("Invite sent");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to approve access request");
    }
  }

  async function rejectAccessRequest(requestId: string) {
    try {
      await loadJson("/api/school-admin/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action: "rejectAccessRequest" }),
      });
      toast.success("Access request rejected");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to reject access request");
    }
  }

  async function sendNotification() {
    const title = notifTitle.trim();
    const body = notifBody.trim();
    const actionUrl = notifActionUrl.trim();
    if (!title || !body) {
      toast.error("Title and message are required.");
      return;
    }
    setSendingNotif(true);
    try {
      const response = await loadJson<{ sentCount?: number }>("/api/school-admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          actionUrl: actionUrl || undefined,
          recipientEmails: notifRecipients.length > 0 ? notifRecipients : undefined,
        }),
      });
      toast.success(`Notification sent to ${response.sentCount ?? (notifRecipients.length > 0 ? notifRecipients.length : members.length)} user${(response.sentCount ?? 2) === 1 ? "" : "s"}.`);
      setNotifTitle("");
      setNotifBody("");
      setNotifActionUrl("");
      setNotifRecipients([]);
      setNotifEmailSearch("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send notification.");
    } finally {
      setSendingNotif(false);
    }
  }

  if (sidebarLoading || !hasAdminAccess || loading) return <AppShell><div className="flex items-center justify-center p-8"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-default)] border-t-[var(--accent-cyan)]" /></div></AppShell>;
  if (!onboardingComplete) return <AppShell><AdminOnboarding orgName={org?.name ?? "Spectra"} onComplete={completeOnboarding} onSkip={completeOnboarding} /></AppShell>;

  return (
    <AppShell fullBleed contentClassName="2xl:px-14">
      <div className="mx-auto max-w-4xl space-y-5 pb-10">
        {infraWarnings.length > 0 ? (
          <section className="rounded-xl border border-[color-mix(in_oklab,var(--warning)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_12%,var(--bg-secondary))] px-4 py-3">
            <p className="text-sm font-medium text-[var(--warning)]">Infrastructure warning</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">{infraWarnings.join(" ")}</p>
          </section>
        ) : null}

        {/* Page header */}
        <div className="pb-2 pt-1">
          <Breadcrumb items={[{ label: "Chat", href: "/" }, { label: "Admin" }]} />
          <h1 className="font-display text-3xl mt-2">Admin Console</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Manage your school settings, members, and usage.</p>
        </div>

        <nav className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          <span className="font-medium text-[var(--text-primary)]">Jump to</span>
          {[
            ["admin-section-soul", "Soul"],
            ["admin-section-members", "Members"],
            ["admin-section-usage", "Usage"],
            ["admin-section-settings", "Settings"],
            ["admin-section-notifications", "Notifications"],
            ["admin-section-agents", "Agents"],
          ].map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-1 transition hover:bg-[var(--bg-hover)]"
            >
              {label}
            </a>
          ))}
        </nav>

        {/* Section 1: Soul & Personality */}
        <section id="admin-section-soul" className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6">
          <div className="mb-1 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--accent-cyan)]" />
            <h2 className="font-display text-xl">Soul & Personality</h2>
          </div>
          <p className="mb-5 mt-1 text-sm text-[var(--text-secondary)]">Institutional voice, pedagogy, and policy guidance for every tutoring session.</p>

          <div className="mb-5 flex flex-wrap items-stretch divide-x divide-[var(--border-default)] rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] text-sm">
            <div className="px-4 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Enabled</p>
              <p className="mt-0.5 font-medium">{org?.soulEnabled === false ? "Off" : "On"}</p>
            </div>
            <div className="px-4 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Timezone</p>
              <p className="mt-0.5 font-medium">{org?.timezone ?? "Not set"}</p>
            </div>
            <div className="px-4 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">School type</p>
              <p className="mt-0.5 font-medium">{org?.schoolType ?? "Not set"}</p>
            </div>
          </div>

          <div className="mb-5 flex flex-wrap gap-2">
            {["Values", "Pedagogy", "Subject guidance", "Tone", "Policy", "Draft preview"].map((item) => (
              <span key={item} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm text-[var(--text-secondary)]">{item}</span>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href="/admin/school/soul">Open SOUL editor</Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link href="/admin/school/branding">Open Branding Settings</Link>
            </Button>
          </div>
        </section>

        {/* Section 2: Members */}
        <section id="admin-section-members" className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6">
          <div className="mb-1 flex items-center gap-2">
            <Users2 className="h-4 w-4 text-[var(--accent-cyan)]" />
            <h2 className="font-display text-xl">Members</h2>
          </div>
          <p className="mb-5 mt-1 text-sm text-[var(--text-secondary)]">Invite students or teachers, manage roles, and keep allocation usage visible.</p>

          {/* Inline stat strip */}
          <div className="mb-6 flex flex-wrap items-stretch divide-x divide-[var(--border-default)] rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] text-sm">
            <div className="px-4 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Members</p>
              <p className="mt-0.5 font-medium">{dashboard?.memberCount ?? members.length}</p>
            </div>
            <div className="px-4 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Students</p>
              <p className="mt-0.5 font-medium">{dashboard?.studentCount ?? 0}</p>
            </div>
            <div className="px-4 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Teachers</p>
              <p className="mt-0.5 font-medium">{dashboard?.teacherCount ?? 0}</p>
            </div>
            <div className="px-4 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Allocation</p>
              <p className="mt-0.5 font-medium">
                {org?.maxStudents ? `${seatUsed}/${org.maxStudents}` : seatUsed}
                {pendingInvites > 0 && <span className="ml-1.5 text-xs font-normal text-[var(--text-tertiary)]">({pendingInvites} pending)</span>}
              </p>
            </div>
          </div>

          {/* Invite form */}
          <div className="mb-6">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <MailPlus className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
              Invite member
            </p>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
              <Input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="student@school.edu" />
              <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as "student" | "teacher")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="student">Student</SelectItem>
                  <SelectItem value="teacher">Teacher</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={() => void inviteMember()}>Invite</Button>
            </div>

            {invitations.length > 0 && (
              <div className="mt-3 space-y-1">
                {invitations.map((item) => (
                  <div key={item._id} className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] py-2">
                    <div className="min-w-0">
                      <span className="text-sm font-medium">{item.email}</span>
                      <span className="ml-2 text-xs text-[var(--text-secondary)]">{item.role} &middot; expires {new Date(item.expiresAt).toLocaleDateString()}</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => void cancelInvite(item._id)}>Cancel</Button>
                  </div>
                ))}
              </div>
            )}
            {accessRequests.length > 0 && (
              <div className="mt-5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                <p className="mb-3 text-sm font-medium">Pending access requests</p>
                <div className="space-y-2">
                  {accessRequests.map((request) => (
                    <div key={request._id} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{request.name}</p>
                          <p className="text-xs text-[var(--text-secondary)]">{request.email}</p>
                          <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                            Requested {new Date(request.createdAt).toLocaleDateString()}
                          </p>
                          {request.message ? (
                            <p className="mt-2 text-xs text-[var(--text-secondary)]">{request.message}</p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="secondary" onClick={() => void approveAccessRequest(request._id, "student")}>
                            Invite student
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => void approveAccessRequest(request._id, "teacher")}>
                            Invite teacher
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void rejectAccessRequest(request._id)}>
                            Dismiss
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Members table */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium text-[var(--text-secondary)]">School members</p>
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-secondary)]" />
              <Input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="Search members" className="pl-9" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)] text-left text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                  <th className="pb-2.5 font-medium">Name</th>
                  <th className="pb-2.5 font-medium">Email</th>
                  <th className="pb-2.5 font-medium">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                {filteredMembers.map((member) => (
                  <tr key={member._id}>
                    <td className="py-3 font-medium">{member.name}</td>
                    <td className="py-3 text-[var(--text-secondary)]">{member.email}</td>
                    <td className="py-3">
                      {member.role === "admin" ? (
                        <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">admin</span>
                      ) : (
                        <Select value={member.role} onValueChange={(value) => void updateRole(member._id, value as "student" | "teacher")}>
                          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="student">student</SelectItem>
                            <SelectItem value="teacher">teacher</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 3: Usage & Models */}
        <section id="admin-section-usage" className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6">
          <div className="mb-1 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[var(--accent-cyan)]" />
            <h2 className="font-display text-xl">Usage & Models</h2>
          </div>
          <p className="mb-5 mt-1 text-sm text-[var(--text-secondary)]">Token volume, quiz outcomes, and preferred models.</p>

          <div className="mb-6 flex flex-wrap items-stretch divide-x divide-[var(--border-default)] rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] text-sm">
            <div className="px-4 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Messages today</p>
              <p className="mt-0.5 font-medium">{dashboard?.messagesToday ?? 0}</p>
            </div>
            <div className="px-4 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Avg quiz score</p>
              <p className="mt-0.5 font-medium">{analytics?.avgQuizScore ? `${Math.round(analytics.avgQuizScore)}%` : "N/A"}</p>
            </div>
          </div>

          {/* Token usage chart */}
          <div className="mb-6">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium">Token usage — last 14 days</p>
              {selectedUsageDay && (
                <button type="button" onClick={() => setSelectedUsageDay(null)} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                  Clear selection
                </button>
              )}
            </div>
            {usage.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary)]">No usage data yet.</p>
            ) : (
              <>
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                  <ResponsiveContainer width="100%" height={140}>
                    <AreaChart
                      data={usage.slice(-14)}
                      onClick={(data) => {
                        if (data?.activePayload?.[0]) {
                          const payload = data.activePayload[0].payload as UsageRow;
                          setSelectedUsageDay((prev) => prev === payload.day ? null : payload.day);
                        }
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <defs>
                        <linearGradient id="adminTokensGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--accent-cyan)" stopOpacity={0.28} />
                          <stop offset="95%" stopColor="var(--accent-cyan)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" vertical={false} />
                      <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 10, fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={formatTokens} tick={{ fontSize: 10, fill: "var(--text-secondary)" }} axisLine={false} tickLine={false} width={40} />
                      <Tooltip
                        contentStyle={{ background: "var(--bg-elevated)", border: "1px solid var(--border-default)", borderRadius: 8, fontSize: 12 }}
                        labelFormatter={shortDay}
                        formatter={(value: number) => [formatTokens(value), "Tokens"]}
                      />
                      <Area type="monotone" dataKey="totalTokens" stroke="var(--accent-cyan)" strokeWidth={2} fill="url(#adminTokensGrad)" dot={false} activeDot={{ r: 4, fill: "var(--accent-cyan)" }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                {selectedUsageDay && (() => {
                  const row = usage.find((r) => r.day === selectedUsageDay);
                  if (!row) return null;
                  return (
                    <div className="mt-3 flex flex-wrap items-stretch divide-x divide-[var(--border-default)] rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]">
                      <div className="px-4 py-2.5">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{shortDay(selectedUsageDay)} — Input</p>
                        <p className="mt-0.5 text-sm font-medium">{formatTokens(row.inputTokens)}</p>
                      </div>
                      <div className="px-4 py-2.5">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Output</p>
                        <p className="mt-0.5 text-sm font-medium">{formatTokens(row.outputTokens)}</p>
                      </div>
                      <div className="px-4 py-2.5">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Total</p>
                        <p className="mt-0.5 text-sm font-medium">{formatTokens(row.totalTokens)}</p>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>

          {/* Model leaderboard */}
          <p className="mb-3 text-sm font-medium">Model leaderboard</p>
          <div className="overflow-x-auto rounded-xl border border-[var(--border-default)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)] bg-[var(--bg-secondary)] text-left text-[10px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                  <th className="w-8 px-3 py-2.5 font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Model</th>
                  <th className="px-3 py-2.5 font-medium">Provider</th>
                  <th className="px-3 py-2.5 text-right font-medium">Uses</th>
                  <th className="px-3 py-2.5 text-right font-medium">Tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                {leaderboard.slice(0, 8).map((entry, index) => (
                  <tr key={entry.modelId} className="hover:bg-[var(--bg-hover)]">
                    <td className="px-3 py-2.5 text-[var(--text-tertiary)]">{index + 1}</td>
                    <td className="px-3 py-2.5 font-medium">{entry.name}</td>
                    <td className="px-3 py-2.5 text-[var(--text-secondary)]">{entry.provider}</td>
                    <td className="px-3 py-2.5 text-right text-[var(--text-secondary)]">{entry.usageCount}</td>
                    <td className="px-3 py-2.5 text-right">{formatTokens(entry.totalTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Section 4: Settings */}
        <section id="admin-section-settings" className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6">
          <div className="mb-1 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-[var(--accent-cyan)]" />
            <h2 className="font-display text-xl">Settings</h2>
          </div>
          <p className="mb-5 mt-1 text-sm text-[var(--text-secondary)]">School-wide retrieval, quiz, flashcard, and orchestration switches.</p>

          <div className="mb-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              Max Resource File Size (MB)
            </label>
            <input
              type="number"
              min={1}
              max={100}
              step={0.5}
              value={Math.round((((org?.maxResourceFileSizeBytes ?? (10 * 1024 * 1024)) / (1024 * 1024)) * 10)) / 10}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (!Number.isFinite(parsed)) return;
                const clamped = Math.min(100, Math.max(1, parsed));
                setOrg((prev) => prev ? { ...prev, maxResourceFileSizeBytes: Math.round(clamped * 1024 * 1024) } : prev);
              }}
              className="h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none transition focus:ring-2 focus:ring-[var(--accent-cyan)]"
            />
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Shared with super-admin policy. Applies to pack and personal resource uploads.
            </p>
          </div>

          <div className="divide-y divide-[var(--border-default)] rounded-xl border border-[var(--border-default)]">
            {[
              { key: "searxngEnabled", label: "SearXNG web search", text: "Prefer metasearch before model-generated web briefings." },
              { key: "adaptiveQuizEnabled", label: "Adaptive quiz", text: "Adjust quiz difficulty from prior performance." },
              { key: "spacedRepetitionEnabled", label: "Spaced repetition", text: "Keep flashcard scheduling active." },
              { key: "agentModelBoostEnabled", label: "Agent model boost", text: "Allow specialist agents to escalate when needed." },
              { key: "orchestratorV2Enabled", label: "Orchestrator v2", text: "Use the advanced routing pipeline across chats." },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-4 px-4 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{item.text}</p>
                </div>
                <Switch
                  checked={(org as Record<string, boolean | undefined> | null)?.[item.key] ?? true}
                  onCheckedChange={(checked) => setOrg((prev) => prev ? { ...prev, [item.key]: checked } : prev)}
                />
              </div>
            ))}
          </div>

          <Button className="mt-4" onClick={() => void saveSettings()} disabled={savingSettings}>
            {savingSettings ? "Saving..." : "Save settings"}
          </Button>
        </section>

        {/* Section 5: Notifications */}
        <section id="admin-section-notifications" className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6">
          <div className="mb-1 flex items-center gap-2">
            <BellRing className="h-4 w-4 text-[var(--accent-cyan)]" />
            <h2 className="font-display text-xl">Notifications</h2>
          </div>
          <p className="mb-5 mt-1 text-sm text-[var(--text-secondary)]">Send announcements to your school members.</p>

          <div className="grid gap-3 sm:grid-cols-2">
            {/* Recipients */}
            <div className="space-y-1.5 sm:col-span-2" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setNotifDropdownOpen(false); }}>
              <span className="text-xs text-[var(--text-secondary)]">Recipients</span>
              <div className="relative">
                <input
                  value={notifEmailSearch}
                  onChange={(e) => { setNotifEmailSearch(e.target.value); setNotifDropdownOpen(true); }}
                  onFocus={() => setNotifDropdownOpen(true)}
                  placeholder="Search members by name or email…"
                  className="h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent-cyan)_32%,transparent)]"
                />
                {notifDropdownOpen && notifEmailSearch.trim() && (() => {
                  const needle = notifEmailSearch.trim().toLowerCase();
                  const filtered = members.filter((m) => !notifRecipients.includes(m.email) && (m.name.toLowerCase().includes(needle) || m.email.toLowerCase().includes(needle))).slice(0, 6);
                  if (filtered.length === 0) return null;
                  return (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-soft)]">
                      {filtered.map((m) => (
                        <button
                          key={m._id}
                          type="button"
                          className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-[var(--bg-hover)]"
                          onMouseDown={(e) => { e.preventDefault(); setNotifRecipients((prev) => [...prev, m.email]); setNotifEmailSearch(""); setNotifDropdownOpen(false); }}
                        >
                          <span className="font-medium text-[var(--text-primary)]">{m.name}</span>
                          <span className="text-xs text-[var(--text-secondary)]">{m.email}</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>
              {notifRecipients.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {notifRecipients.map((email) => (
                    <span key={email} className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] py-0.5 pl-2.5 pr-1.5 text-xs text-[var(--text-primary)]">
                      {email}
                      <button type="button" onClick={() => setNotifRecipients((prev) => prev.filter((e) => e !== email))} className="rounded-full hover:opacity-70">
                        <X className="h-3 w-3 text-[var(--text-secondary)]" />
                      </button>
                    </span>
                  ))}
                  <button type="button" onClick={() => setNotifRecipients([])} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                    Clear all
                  </button>
                </div>
              ) : (
                <p className="text-xs text-[var(--text-tertiary)]">Leave empty to notify all school members.</p>
              )}
            </div>

            <label className="space-y-1.5">
              <span className="text-xs text-[var(--text-secondary)]">Title</span>
              <input
                value={notifTitle}
                onChange={(e) => setNotifTitle(e.target.value)}
                maxLength={180}
                placeholder="Announcement title"
                className="h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent-cyan)_32%,transparent)]"
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs text-[var(--text-secondary)]">Message</span>
              <textarea
                value={notifBody}
                onChange={(e) => setNotifBody(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="School announcement…"
                className="w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent-cyan)_32%,transparent)]"
              />
            </label>

            <label className="space-y-1.5 sm:col-span-2">
              <span className="text-xs text-[var(--text-secondary)]">Action URL (optional)</span>
              <input
                value={notifActionUrl}
                onChange={(e) => setNotifActionUrl(e.target.value)}
                placeholder="/achievements or https://…"
                className="h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent-cyan)_32%,transparent)]"
              />
            </label>
          </div>

          <div className="mt-4 flex items-center justify-end">
            <Button type="button" className="gap-2" onClick={() => void sendNotification()} disabled={sendingNotif}>
              <Send className="h-4 w-4" />
              {sendingNotif ? "Sending…" : "Send notification"}
            </Button>
          </div>
        </section>

        {/* Section 6: Public Agents */}
        {schoolAgents.length > 0 && (
        <section id="admin-section-agents" className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6">
            <div className="mb-1 flex items-center gap-2">
              <Bot className="h-4 w-4 text-[var(--accent-cyan)]" />
              <h2 className="font-display text-xl">School Agents</h2>
            </div>
            <p className="mb-5 mt-1 text-sm text-[var(--text-secondary)]">
              Public and shared agents visible to all school members. Remove agents that are no longer needed.
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
                  <th className="pb-2 font-medium">Agent</th>
                  <th className="pb-2 font-medium">Visibility</th>
                  <th className="pb-2 font-medium">Uses</th>
                  <th className="pb-2 w-20 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {schoolAgents.map((agent) => (
                  <tr key={agent._id} className="border-b border-[var(--border-default)]">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{agent.avatarEmoji}</span>
                        <div>
                          <p className="font-medium text-[var(--text-primary)]">{agent.name}</p>
                          <p className="truncate max-w-[200px] text-xs text-[var(--text-secondary)]">{agent.description}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                        {agent.visibility}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-[var(--text-secondary)]">{agent.usageCount}</td>
                    <td className="py-2.5">
                      <button
                        type="button"
                        onClick={() => void deleteSchoolAgent(agent._id)}
                        className="inline-flex items-center gap-1 text-xs text-[var(--danger)] hover:underline"
                      >
                        <Trash2 className="h-3 w-3" />
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </AppShell>
  );
}

export default function AdminPage() {
  return <Suspense><AdminPageContent /></Suspense>;
}
