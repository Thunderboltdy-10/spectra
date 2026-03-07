"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, Cpu, MailPlus, Search, Send, Sparkles, Users2, BarChart3, X } from "lucide-react";
import { toast } from "sonner";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@/components/layout/app-shell";
import { AdminOnboarding } from "@/components/onboarding/admin-onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSidebar } from "@/context/sidebar-context";

type OrgSettings = { name?: string; description?: string; schoolType?: string; timezone?: string; maxStudents?: number; monthlyBudgetCentsPerUser?: number; budgetMarginPercent?: number; soulEnabled?: boolean; orchestratorV2Enabled?: boolean; searxngEnabled?: boolean; adaptiveQuizEnabled?: boolean; spacedRepetitionEnabled?: boolean; agentModelBoostEnabled?: boolean };
type Member = { _id: string; name: string; email: string; role: "student" | "teacher" | "admin"; createdAt: number };
type Invitation = { _id: string; email: string; role: "student" | "teacher" | "admin"; status: "pending" | "accepted" | "expired" | "cancelled"; expiresAt: number };
type SchoolDashboard = { memberCount: number; studentCount: number; teacherCount: number; adminCount: number; messagesToday: number; pendingInvitations: number; orgName?: string };
type UsageRow = { day: string; inputTokens: number; outputTokens: number; totalTokens: number };
type SchoolAnalytics = { avgQuizScore?: number; totalQuizAttempts: number };
type LeaderboardEntry = { modelId: string; provider: string; name: string; totalTokens: number; usageCount: number };

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
  if (!response.ok) throw new Error(await response.text());
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
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [analytics, setAnalytics] = useState<SchoolAnalytics | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"student" | "teacher">("student");
  const [savingSettings, setSavingSettings] = useState(false);
  const [selectedUsageDay, setSelectedUsageDay] = useState<string | null>(null);
  const [notifTitle, setNotifTitle] = useState("");
  const [notifBody, setNotifBody] = useState("");
  const [notifActionUrl, setNotifActionUrl] = useState("");
  const [notifEmailSearch, setNotifEmailSearch] = useState("");
  const [notifRecipients, setNotifRecipients] = useState<string[]>([]);
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);
  const [sendingNotif, setSendingNotif] = useState(false);

  async function refresh() {
    const [bootstrap, schoolDashboard, membersPayload, usagePayload, schoolAnalytics, modelPayload] = await Promise.all([
      loadJson<{ actor: { onboardingComplete?: boolean }; orgSettings: { org: OrgSettings } }>("/api/bootstrap"),
      loadJson<SchoolDashboard>("/api/school-admin/dashboard"),
      loadJson<{ members: { members: Member[] }; invitations: Invitation[] }>("/api/school-admin/members"),
      loadJson<{ usage: UsageRow[] }>("/api/admin/users"),
      loadJson<SchoolAnalytics>("/api/school-admin/analytics?days=30"),
      loadJson<{ models: LeaderboardEntry[] }>("/api/analytics/model-leaderboard"),
    ]);
    setOnboardingComplete(Boolean(bootstrap.actor.onboardingComplete));
    setOrg(bootstrap.orgSettings.org);
    setDashboard(schoolDashboard);
    setMembers(membersPayload.members.members ?? []);
    setInvitations(membersPayload.invitations ?? []);
    setUsage(usagePayload.usage ?? []);
    setAnalytics(schoolAnalytics);
    setLeaderboard(modelPayload.models ?? []);
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
    return needle ? members.filter((member) => member.name.toLowerCase().includes(needle) || member.email.toLowerCase().includes(needle)) : members;
  }, [memberSearch, members]);
  const seatUsed = members.filter((member) => member.role === "student").length;
  const pendingStudentInvites = invitations.filter((item) => item.role === "student" && item.status === "pending").length;

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

  async function cancelInvite(invitationId: string) {
    try {
      await loadJson("/api/school-admin/members", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invitationId, action: "cancelInvite" }) });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel invitation");
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
  if (!onboardingComplete) return <AppShell><AdminOnboarding orgName={org?.name ?? "AI School"} monthlyBudgetCentsPerUser={org?.monthlyBudgetCentsPerUser ?? null} budgetMarginPercent={org?.budgetMarginPercent ?? null} onComplete={completeOnboarding} onSkip={completeOnboarding} /></AppShell>;

  return (
    <AppShell fullBleed contentClassName="2xl:px-14">
      <div className="mx-auto max-w-4xl">
        {/* Page header */}
        <div className="pb-6">
          <h1 className="font-display text-2xl">Admin Console</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Manage your school settings, members, and usage.</p>
        </div>

        {/* Section 1: Soul & Personality */}
        <div className="border-t border-[var(--border-default)] pt-8">
          <div className="mb-1 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--accent-cyan)]" />
            <h2 className="font-display text-lg">Soul & Personality</h2>
          </div>
          <p className="mb-5 text-sm text-[var(--text-secondary)]">Institutional voice, pedagogy, and policy guidance for every tutoring session.</p>

          <div className="mb-5 flex items-center gap-4 divide-x divide-[var(--border-default)] border-b border-t border-[var(--border-default)] py-3 text-sm">
            <div className="flex items-center gap-2 pr-4">
              <span className="text-[var(--text-secondary)]">Enabled</span>
              <span className="font-medium">{org?.soulEnabled === false ? "Off" : "On"}</span>
            </div>
            <div className="flex items-center gap-2 pl-4 pr-4">
              <span className="text-[var(--text-secondary)]">Timezone</span>
              <span className="font-medium">{org?.timezone ?? "Not set"}</span>
            </div>
            <div className="flex items-center gap-2 pl-4">
              <span className="text-[var(--text-secondary)]">School type</span>
              <span className="font-medium">{org?.schoolType ?? "Not set"}</span>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {["Values", "Pedagogy", "Subject guidance", "Tone", "Policy", "Draft preview"].map((item) => (
              <span key={item} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm text-[var(--text-secondary)]">{item}</span>
            ))}
          </div>

          <Button asChild size="sm">
            <Link href="/admin/school/soul">Open SOUL editor</Link>
          </Button>
        </div>

        {/* Section 2: Members */}
        <div className="mt-8 border-t border-[var(--border-default)] pt-8">
          <div className="mb-1 flex items-center gap-2">
            <Users2 className="h-4 w-4 text-[var(--accent-cyan)]" />
            <h2 className="font-display text-lg">Members</h2>
          </div>
          <p className="mb-5 text-sm text-[var(--text-secondary)]">Invite students or teachers, manage roles, and keep seat usage visible.</p>

          {/* Inline stat strip */}
          <div className="mb-5 flex items-center gap-4 divide-x divide-[var(--border-default)] border-b border-t border-[var(--border-default)] py-3 text-sm">
            <div className="pr-4">
              <span className="text-[var(--text-secondary)]">Members </span>
              <span className="font-medium">{dashboard?.memberCount ?? members.length}</span>
            </div>
            <div className="pl-4 pr-4">
              <span className="text-[var(--text-secondary)]">Students </span>
              <span className="font-medium">{dashboard?.studentCount ?? 0}</span>
            </div>
            <div className="pl-4 pr-4">
              <span className="text-[var(--text-secondary)]">Teachers </span>
              <span className="font-medium">{dashboard?.teacherCount ?? 0}</span>
            </div>
            <div className="pl-4">
              <span className="text-[var(--text-secondary)]">Seats </span>
              <span className="font-medium">{org?.maxStudents ? `${seatUsed}/${org.maxStudents}` : seatUsed}</span>
              {pendingStudentInvites > 0 && (
                <span className="ml-2 text-xs text-[var(--text-tertiary)]">({pendingStudentInvites} pending)</span>
              )}
            </div>
          </div>

          {/* Invite form */}
          <div className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <MailPlus className="h-4 w-4 text-[var(--text-secondary)]" />
              <p className="text-sm font-medium">Invite member</p>
            </div>
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
          </div>

          {/* Members table */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">School members</p>
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-secondary)]" />
              <Input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="Search members" className="pl-9" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
                  <th className="pb-2">Name</th>
                  <th className="pb-2">Email</th>
                  <th className="pb-2">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                {filteredMembers.map((member) => (
                  <tr key={member._id}>
                    <td className="py-3 font-medium">{member.name}</td>
                    <td className="py-3 text-[var(--text-secondary)]">{member.email}</td>
                    <td className="py-3">
                      {member.role === "admin" ? (
                        <span className="text-xs text-[var(--text-secondary)]">admin</span>
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
        </div>

        {/* Section 3: Usage */}
        <div className="mt-8 border-t border-[var(--border-default)] pt-8">
          <div className="mb-1 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[var(--accent-cyan)]" />
            <h2 className="font-display text-lg">Usage & Models</h2>
          </div>
          <p className="mb-5 text-sm text-[var(--text-secondary)]">Token volume, quiz outcomes, and preferred models.</p>

          <div className="mb-5 flex items-center gap-4 divide-x divide-[var(--border-default)] border-b border-t border-[var(--border-default)] py-3 text-sm">
            <div className="pr-4">
              <span className="text-[var(--text-secondary)]">Messages today </span>
              <span className="font-medium">{dashboard?.messagesToday ?? 0}</span>
            </div>
            <div className="pl-4">
              <span className="text-[var(--text-secondary)]">Avg quiz score </span>
              <span className="font-medium">{analytics?.avgQuizScore ? `${Math.round(analytics.avgQuizScore)}%` : "N/A"}</span>
            </div>
          </div>

          {/* Token usage chart */}
          <div className="mb-6">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-medium">Recent token usage</p>
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
                <ResponsiveContainer width="100%" height={160}>
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
                {selectedUsageDay && (() => {
                  const row = usage.find((r) => r.day === selectedUsageDay);
                  if (!row) return null;
                  return (
                    <div className="mt-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-3">
                      <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">Detail — {shortDay(selectedUsageDay)}</p>
                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div><p className="text-xs text-[var(--text-secondary)]">Input</p><p className="font-medium">{formatTokens(row.inputTokens)}</p></div>
                        <div><p className="text-xs text-[var(--text-secondary)]">Output</p><p className="font-medium">{formatTokens(row.outputTokens)}</p></div>
                        <div><p className="text-xs text-[var(--text-secondary)]">Total</p><p className="font-medium">{formatTokens(row.totalTokens)}</p></div>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>

          {/* Model leaderboard as table */}
          <p className="mb-3 text-sm font-medium">Model leaderboard</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]">
                  <th className="w-8 pb-2">#</th>
                  <th className="pb-2">Model</th>
                  <th className="pb-2">Provider</th>
                  <th className="pb-2 text-right">Uses</th>
                  <th className="pb-2 text-right">Tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-default)]">
                {leaderboard.slice(0, 8).map((entry, index) => (
                  <tr key={entry.modelId}>
                    <td className="py-2.5 text-[var(--text-secondary)]">{index + 1}</td>
                    <td className="py-2.5 font-medium">{entry.name}</td>
                    <td className="py-2.5 text-[var(--text-secondary)]">{entry.provider}</td>
                    <td className="py-2.5 text-right text-[var(--text-secondary)]">{entry.usageCount}</td>
                    <td className="py-2.5 text-right">{formatTokens(entry.totalTokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 4: Settings */}
        <div className="mt-8 border-t border-[var(--border-default)] pb-8 pt-8">
          <div className="mb-1 flex items-center gap-2">
            <Cpu className="h-4 w-4 text-[var(--accent-cyan)]" />
            <h2 className="font-display text-lg">Settings</h2>
          </div>
          <p className="mb-5 text-sm text-[var(--text-secondary)]">School-wide retrieval, quiz, flashcard, and orchestration switches.</p>

          <div className="divide-y divide-[var(--border-default)] border-b border-t border-[var(--border-default)]">
            {[
              { key: "searxngEnabled", label: "SearXNG web search", text: "Prefer metasearch before model-generated web briefings." },
              { key: "adaptiveQuizEnabled", label: "Adaptive quiz", text: "Adjust quiz difficulty from prior performance." },
              { key: "spacedRepetitionEnabled", label: "Spaced repetition", text: "Keep flashcard scheduling active." },
              { key: "agentModelBoostEnabled", label: "Agent model boost", text: "Allow specialist agents to escalate when needed." },
              { key: "orchestratorV2Enabled", label: "Orchestrator v2", text: "Use the advanced routing pipeline across chats." },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-4 py-3.5">
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
        </div>

        {/* Section 5: Notifications */}
        <div className="mt-8 border-t border-[var(--border-default)] pb-8 pt-8">
          <div className="mb-1 flex items-center gap-2">
            <BellRing className="h-4 w-4 text-[var(--accent-cyan)]" />
            <h2 className="font-display text-lg">Notifications</h2>
          </div>
          <p className="mb-5 text-sm text-[var(--text-secondary)]">Send announcements to your school members.</p>

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
        </div>
      </div>
    </AppShell>
  );
}

export default function AdminPage() {
  return <Suspense><AdminPageContent /></Suspense>;
}
