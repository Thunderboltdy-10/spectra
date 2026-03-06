"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Bot, Brush, Cpu, MailPlus, Search, Sparkles, Users2, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { AdminOnboarding } from "@/components/onboarding/admin-onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSidebar } from "@/context/sidebar-context";
import type { Agent } from "@/types";

type NavSection = "soul" | "members" | "usage" | "branding" | "settings" | "agents";
type OrgSettings = { name?: string; description?: string; schoolType?: string; timezone?: string; maxStudents?: number; monthlyBudgetCentsPerUser?: number; budgetMarginPercent?: number; soulEnabled?: boolean; orchestratorV2Enabled?: boolean; searxngEnabled?: boolean; adaptiveQuizEnabled?: boolean; spacedRepetitionEnabled?: boolean; agentModelBoostEnabled?: boolean };
type Member = { _id: string; name: string; email: string; role: "student" | "teacher" | "admin"; createdAt: number };
type Invitation = { _id: string; email: string; role: "student" | "teacher" | "admin"; status: "pending" | "accepted" | "expired" | "cancelled"; expiresAt: number };
type SchoolDashboard = { memberCount: number; studentCount: number; teacherCount: number; adminCount: number; messagesToday: number; pendingInvitations: number; orgName?: string };
type UsageRow = { day: string; inputTokens: number; outputTokens: number; totalTokens: number };
type SchoolAnalytics = { avgQuizScore?: number; totalQuizAttempts: number };
type LeaderboardEntry = { modelId: string; provider: string; name: string; totalTokens: number; usageCount: number };

const NAV: Array<{ id: NavSection; label: string; icon: React.ReactNode }> = [
  { id: "soul", label: "School SOUL", icon: <Sparkles className="h-4 w-4" /> },
  { id: "members", label: "Members", icon: <Users2 className="h-4 w-4" /> },
  { id: "usage", label: "Usage & Models", icon: <BarChart3 className="h-4 w-4" /> },
  { id: "branding", label: "Branding", icon: <Brush className="h-4 w-4" /> },
  { id: "settings", label: "Settings", icon: <Cpu className="h-4 w-4" /> },
  { id: "agents", label: "Agents", icon: <Bot className="h-4 w-4" /> },
];

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

function SectionFrame({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <div className="space-y-5"><div><h2 className="font-display text-2xl">{title}</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">{subtitle}</p></div>{children}</div>;
}

function AdminPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { role, isSuperAdmin, loading: sidebarLoading } = useSidebar();
  const hasAdminAccess = role === "admin" || isSuperAdmin;
  const [activeSection, setActiveSection] = useState<NavSection>("soul");
  const [loading, setLoading] = useState(true);
  const [onboardingComplete, setOnboardingComplete] = useState(true);
  const [org, setOrg] = useState<OrgSettings | null>(null);
  const [dashboard, setDashboard] = useState<SchoolDashboard | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [analytics, setAnalytics] = useState<SchoolAnalytics | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"student" | "teacher">("student");
  const [savingSettings, setSavingSettings] = useState(false);

  async function refresh() {
    const [bootstrap, schoolDashboard, membersPayload, usagePayload, schoolAnalytics, modelPayload, agentsPayload] = await Promise.all([
      loadJson<{ actor: { onboardingComplete?: boolean }; orgSettings: { org: OrgSettings } }>("/api/bootstrap"),
      loadJson<SchoolDashboard>("/api/school-admin/dashboard"),
      loadJson<{ members: { members: Member[] }; invitations: Invitation[] }>("/api/school-admin/members"),
      loadJson<{ usage: UsageRow[] }>("/api/admin/users"),
      loadJson<SchoolAnalytics>("/api/school-admin/analytics?days=30"),
      loadJson<{ models: LeaderboardEntry[] }>("/api/analytics/model-leaderboard"),
      loadJson<{ agents: Agent[] }>("/api/agents"),
    ]);
    setOnboardingComplete(Boolean(bootstrap.actor.onboardingComplete));
    setOrg(bootstrap.orgSettings.org);
    setDashboard(schoolDashboard);
    setMembers(membersPayload.members.members ?? []);
    setInvitations(membersPayload.invitations ?? []);
    setUsage(usagePayload.usage ?? []);
    setAnalytics(schoolAnalytics);
    setLeaderboard(modelPayload.models ?? []);
    setAgents(agentsPayload.agents ?? []);
  }

  useEffect(() => {
    const section = searchParams.get("section");
    if (section && NAV.some((item) => item.id === section)) setActiveSection(section as NavSection);
  }, [searchParams]);

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
  const usageMax = Math.max(1, ...usage.map((row) => row.totalTokens));

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

  async function updateVisibility(agentId: string, visibility: "public" | "private" | "shared") {
    try {
      await loadJson(`/api/agents/${agentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visibility }) });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update agent");
    }
  }

  if (sidebarLoading || !hasAdminAccess || loading) return <AppShell><div className="flex items-center justify-center p-8"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-default)] border-t-[var(--accent-cyan)]" /></div></AppShell>;
  if (!onboardingComplete) return <AppShell><AdminOnboarding orgName={org?.name ?? "AI School"} monthlyBudgetCentsPerUser={org?.monthlyBudgetCentsPerUser ?? null} budgetMarginPercent={org?.budgetMarginPercent ?? null} onComplete={completeOnboarding} onSkip={completeOnboarding} /></AppShell>;

  const section: Record<NavSection, React.ReactNode> = {
    soul: <SectionFrame title="School SOUL" subtitle="Manage the institutional voice, pedagogy, and policy guidance for every tutoring session."><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]"><div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5"><p className="text-sm font-semibold">SOUL editor</p><p className="mt-1 text-sm text-[var(--text-secondary)]">Mission, teaching philosophy, tone, subject rules, and policy injection stay in the dedicated editor.</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{["Values", "Pedagogy", "Subject guidance", "Tone", "Policy", "Draft preview"].map((item) => <div key={item} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-3 text-sm text-[var(--text-secondary)]">{item}</div>)}</div></div><div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5"><p className="text-sm font-semibold">Current deployment</p><div className="mt-3 space-y-2 text-sm"><div className="flex justify-between border-b border-[var(--border-default)] pb-2"><span className="text-[var(--text-secondary)]">Enabled</span><span>{org?.soulEnabled === false ? "Off" : "On"}</span></div><div className="flex justify-between border-b border-[var(--border-default)] pb-2"><span className="text-[var(--text-secondary)]">Timezone</span><span>{org?.timezone ?? "Not set"}</span></div><div className="flex justify-between"><span className="text-[var(--text-secondary)]">School type</span><span>{org?.schoolType ?? "Not set"}</span></div></div><Button asChild className="mt-4 w-full"><Link href="/admin/school/soul">Open editor</Link></Button></div></div></SectionFrame>,
    members: <SectionFrame title="Members" subtitle="Invite students or teachers, manage roles, and keep seat usage visible."><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]"><div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5"><div className="mb-4 flex items-center gap-2"><MailPlus className="h-4 w-4 text-[var(--text-secondary)]" /><p className="text-sm font-semibold">Invite member</p></div><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]"><Input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="student@school.edu" /><Select value={inviteRole} onValueChange={(value) => setInviteRole(value as "student" | "teacher")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="student">Student</SelectItem><SelectItem value="teacher">Teacher</SelectItem></SelectContent></Select><Button onClick={() => void inviteMember()}>Invite</Button></div><div className="mt-4 space-y-2 border-t border-[var(--border-default)] pt-4">{invitations.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">No pending invitations.</p> : invitations.map((item) => <div key={item._id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.email}</p><p className="text-xs text-[var(--text-secondary)]">{item.role} • expires {new Date(item.expiresAt).toLocaleDateString()}</p></div><Button variant="ghost" size="sm" onClick={() => void cancelInvite(item._id)}>Cancel</Button></div>)}</div></div><div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">{[{ label: "Members", value: dashboard?.memberCount ?? members.length }, { label: "Students", value: dashboard?.studentCount ?? 0 }, { label: "Teachers", value: dashboard?.teacherCount ?? 0 }, { label: "Student seats", value: org?.maxStudents ? `${seatUsed}/${org.maxStudents}` : seatUsed }].map((item) => <div key={item.label} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3"><p className="text-xs text-[var(--text-secondary)]">{item.label}</p><p className="mt-1 text-2xl font-semibold">{item.value}</p></div>)}</div><p className="mt-3 text-xs text-[var(--text-secondary)]">{pendingStudentInvites} pending student invite{pendingStudentInvites === 1 ? "" : "s"}</p></div></div><div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><p className="text-sm font-semibold">School members</p><div className="relative w-full max-w-sm"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-secondary)]" /><Input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="Search members" className="pl-9" /></div></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-[var(--border-default)] text-left text-xs text-[var(--text-secondary)]"><th className="pb-2">Name</th><th className="pb-2">Email</th><th className="pb-2">Role</th></tr></thead><tbody className="divide-y divide-[var(--border-default)]">{filteredMembers.map((member) => <tr key={member._id}><td className="py-3 font-medium">{member.name}</td><td className="py-3 text-[var(--text-secondary)]">{member.email}</td><td className="py-3">{member.role === "admin" ? <span className="text-xs text-[var(--text-secondary)]">admin</span> : <Select value={member.role} onValueChange={(value) => void updateRole(member._id, value as "student" | "teacher")}><SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="student">student</SelectItem><SelectItem value="teacher">teacher</SelectItem></SelectContent></Select>}</td></tr>)}</tbody></table></div></div></SectionFrame>,
    usage: <SectionFrame title="Usage & Models" subtitle="School-wide visibility into token volume, quiz outcomes, and preferred models."><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"><div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5"><div className="mb-3 flex items-center justify-between"><p className="text-sm font-semibold">Recent usage</p><p className="text-xs text-[var(--text-secondary)]">{dashboard?.messagesToday ?? 0} messages today</p></div><div className="space-y-2">{usage.length === 0 ? <p className="text-sm text-[var(--text-secondary)]">No usage data yet.</p> : usage.map((row) => <div key={row.day}><div className="mb-1 flex items-center justify-between text-xs"><span className="text-[var(--text-secondary)]">{shortDay(row.day)}</span><span>{formatTokens(row.totalTokens)} tokens</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-secondary)]"><div className="h-full rounded-full bg-[var(--accent-cyan)]" style={{ width: `${Math.max(4, Math.round((row.totalTokens / usageMax) * 100))}%` }} /></div></div>)}</div></div><div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5"><p className="text-sm font-semibold">Model leaderboard</p><div className="mt-3 space-y-2">{leaderboard.slice(0, 8).map((entry, index) => <div key={entry.modelId} className="grid min-h-[44px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5"><span className="text-xs text-[var(--text-secondary)]">{index + 1}</span><div className="min-w-0"><p className="truncate text-sm font-medium">{entry.name}</p><p className="truncate text-xs text-[var(--text-secondary)]">{entry.provider} • {entry.usageCount} uses</p></div><span className="text-xs text-[var(--text-secondary)]">{formatTokens(entry.totalTokens)}</span></div>)}</div><div className="mt-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--text-secondary)]">Avg quiz score: <span className="font-medium text-[var(--text-primary)]">{analytics?.avgQuizScore ? `${Math.round(analytics.avgQuizScore)}%` : "No quizzes yet"}</span></div></div></div></SectionFrame>,
    branding: <SectionFrame title="Branding" subtitle="Logo, colors, welcome copy, and school description live in the branding editor."><div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5"><p className="text-sm font-semibold">Branding editor</p><p className="mt-1 text-sm text-[var(--text-secondary)]">{org?.description ?? "Set a welcome message and school description so the workspace reads like your institution."}</p><Button asChild className="mt-4"><Link href="/admin/school/branding">Open branding</Link></Button></div></SectionFrame>,
    settings: <SectionFrame title="Settings" subtitle="School-wide retrieval, quiz, flashcard, and orchestration switches."><div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5"><div className="space-y-3">{[{ key: "searxngEnabled", label: "SearXNG web search", text: "Prefer metasearch before model-generated web briefings." }, { key: "adaptiveQuizEnabled", label: "Adaptive quiz", text: "Adjust quiz difficulty from prior performance." }, { key: "spacedRepetitionEnabled", label: "Spaced repetition", text: "Keep flashcard scheduling active." }, { key: "agentModelBoostEnabled", label: "Agent model boost", text: "Allow specialist agents to escalate when needed." }, { key: "orchestratorV2Enabled", label: "Orchestrator v2", text: "Use the advanced routing pipeline across chats." }].map((item) => <div key={item.key} className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3.5"><div className="min-w-0"><p className="text-sm font-medium">{item.label}</p><p className="mt-0.5 text-xs text-[var(--text-secondary)]">{item.text}</p></div><Switch checked={(org as Record<string, boolean | undefined> | null)?.[item.key] ?? true} onCheckedChange={(checked) => setOrg((prev) => prev ? { ...prev, [item.key]: checked } : prev)} /></div>)}</div><Button className="mt-4" onClick={() => void saveSettings()} disabled={savingSettings}>{savingSettings ? "Saving..." : "Save settings"}</Button></div></SectionFrame>,
    agents: <SectionFrame title="Agents" subtitle="Review school agents and switch visibility between public, private, and collaborator-shared."><div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5"><div className="space-y-3">{agents.map((agent) => <div key={agent._id} className="grid gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-4 lg:grid-cols-[minmax(0,1fr)_180px] lg:items-center"><div className="min-w-0"><p className="truncate text-sm font-semibold">{agent.name}</p><p className="mt-1 line-clamp-2 text-sm text-[var(--text-secondary)]">{agent.description}</p><p className="mt-1 text-xs text-[var(--text-secondary)]">{agent.category} • {agent.collaborators?.length ?? 0} collaborators</p></div><Select value={agent.visibility} onValueChange={(value) => void updateVisibility(agent._id, value as "public" | "private" | "shared")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="public">Public</SelectItem><SelectItem value="private">Private</SelectItem><SelectItem value="shared">Shared</SelectItem></SelectContent></Select></div>)}</div></div></SectionFrame>,
  };

  return (
    <AppShell fullBleed contentClassName="2xl:px-14">
      <div className="space-y-5">
        <div><h1 className="font-display text-3xl">{dashboard?.orgName ?? org?.name ?? "School Admin"}</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">School administration</p></div>
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2"><ul className="space-y-1">{NAV.map((item) => { const active = activeSection === item.id; return <li key={item.id}><button type="button" onClick={() => setActiveSection(item.id)} className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition ${active ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"}`}><span className={active ? "text-[var(--accent-cyan)]" : ""}>{item.icon}</span>{item.label}</button></li>; })}</ul></nav>
          <div className="min-w-0 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 sm:p-6">{section[activeSection]}</div>
        </div>
      </div>
    </AppShell>
  );
}

export default function AdminPage() {
  return <Suspense><AdminPageContent /></Suspense>;
}
