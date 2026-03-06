"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  BarChart3,
  Brush,
  Cpu,
  LayoutDashboard,
  Sparkles,
  Users2,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { AdminOnboarding } from "@/components/onboarding/admin-onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSidebar } from "@/context/sidebar-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UserRow = {
  _id: string;
  name: string;
  email: string;
  role: "student" | "teacher" | "admin";
};

type UsageRow = {
  day: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type OrgBootstrap = {
  name?: string;
  verifyMarkerPassEnabled: boolean;
  monthlyBudgetCentsPerUser?: number;
  budgetMarginPercent?: number;
  allowPaidModels?: boolean;
  orchestratorV2Enabled?: boolean;
  soulEnabled?: boolean;
  agentModelBoostEnabled?: boolean;
  adaptiveQuizEnabled?: boolean;
  spacedRepetitionEnabled?: boolean;
  description?: string;
  schoolType?: string;
  timezone?: string;
  maxStudents?: number;
};

type NavSection =
  | "overview"
  | "users"
  | "usage"
  | "ai-config"
  | "soul"
  | "branding";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortDay(day: string) {
  const value = new Date(`${day}T00:00:00Z`);
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Nav config
// ---------------------------------------------------------------------------

const NAV_ITEMS: { id: NavSection; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: "users", label: "Users & Roles", icon: <Users2 className="h-4 w-4" /> },
  { id: "usage", label: "Usage Analytics", icon: <BarChart3 className="h-4 w-4" /> },
  { id: "ai-config", label: "AI Configuration", icon: <Cpu className="h-4 w-4" /> },
  { id: "soul", label: "Soul & Personality", icon: <Sparkles className="h-4 w-4" /> },
  { id: "branding", label: "Branding", icon: <Brush className="h-4 w-4" /> },
];

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function AdminPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { role: userRole, isSuperAdmin, loading: sidebarLoading } = useSidebar();

  const [activeSection, setActiveSection] = useState<NavSection>("overview");

  const [adminDataLoaded, setAdminDataLoaded] = useState(false);
  const [adminOnboardingComplete, setAdminOnboardingComplete] = useState(true);

  const [orgName, setOrgName] = useState("AI School");

  // Budget/billing state — kept for API compatibility but not surfaced in UI
  const [monthlyBudgetCentsPerUser, setMonthlyBudgetCentsPerUser] = useState<number | null>(null);
  const [budgetMarginPercent, setBudgetMarginPercent] = useState<number | null>(null);

  // AI feature toggles
  const [verify, setVerify] = useState(false);
  const [orchestratorV2Enabled, setOrchestratorV2Enabled] = useState(true);
  const [soulEnabled, setSoulEnabled] = useState(true);
  const [agentModelBoostEnabled, setAgentModelBoostEnabled] = useState(true);
  const [adaptiveQuizEnabled, setAdaptiveQuizEnabled] = useState(true);
  const [spacedRepetitionEnabled, setSpacedRepetitionEnabled] = useState(true);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [selectedUsageDay, setSelectedUsageDay] = useState<string | null>(null);
  const [roleSearch, setRoleSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "student" | "teacher" | "admin">("all");
  const [savingSettings, setSavingSettings] = useState(false);

  const hasAdminAccess = userRole === "admin" || isSuperAdmin;

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  async function loadAll() {
    const bootstrapResponse = await fetch("/api/bootstrap");
    if (!bootstrapResponse.ok) throw new Error(await bootstrapResponse.text());
    const bootstrap = (await bootstrapResponse.json()) as {
      actor: { role: "student" | "teacher" | "admin"; onboardingComplete?: boolean };
      isSuperAdmin?: boolean;
      orgSettings: { org: OrgBootstrap };
    };

    const org = bootstrap.orgSettings.org;
    setAdminOnboardingComplete(Boolean(bootstrap.actor.onboardingComplete));
    setOrgName(org.name ?? "AI School");

    setMonthlyBudgetCentsPerUser(typeof org.monthlyBudgetCentsPerUser === "number" ? org.monthlyBudgetCentsPerUser : null);
    setBudgetMarginPercent(typeof org.budgetMarginPercent === "number" ? org.budgetMarginPercent : null);
    setVerify(Boolean(org.verifyMarkerPassEnabled));

    setOrchestratorV2Enabled(org.orchestratorV2Enabled ?? true);
    setSoulEnabled(org.soulEnabled ?? true);
    setAgentModelBoostEnabled(org.agentModelBoostEnabled ?? true);
    setAdaptiveQuizEnabled(org.adaptiveQuizEnabled ?? true);
    setSpacedRepetitionEnabled(org.spacedRepetitionEnabled ?? true);

    const actorCanManageAdmin = bootstrap.actor.role === "admin" || Boolean(bootstrap.isSuperAdmin);
    if (!actorCanManageAdmin) return;

    const usersResponse = await fetch("/api/admin/users");
    if (!usersResponse.ok) throw new Error(await usersResponse.text());
    const usersData = (await usersResponse.json()) as { users: UserRow[]; usage: UsageRow[] };
    setUsers(usersData.users);
    setUsage(usersData.usage);
  }

  async function markAdminOnboardingComplete() {
    const response = await fetch("/api/personal-soul", { method: "PATCH" });
    if (!response.ok) throw new Error(await response.text());
    setAdminOnboardingComplete(true);
    await loadAll();
  }

  useEffect(() => {
    if (!sidebarLoading && !hasAdminAccess) {
      router.replace("/");
    }
  }, [hasAdminAccess, sidebarLoading, router]);

  useEffect(() => {
    const section = searchParams.get("section");
    if (!section) return;
    if (NAV_ITEMS.some((item) => item.id === section)) {
      setActiveSection(section as NavSection);
    }
  }, [searchParams]);

  useEffect(() => {
    if (sidebarLoading || !hasAdminAccess) return;
    setAdminDataLoaded(false);
    void loadAll()
      .catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load admin data"))
      .finally(() => setAdminDataLoaded(true));
  }, [hasAdminAccess, sidebarLoading]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const usageSum = useMemo(() => usage.reduce((sum, row) => sum + row.totalTokens, 0), [usage]);
  const usageMax = useMemo(() => Math.max(1, ...usage.map((row) => row.totalTokens)), [usage]);
  const selectedUsage = useMemo(
    () => (selectedUsageDay ? usage.find((row) => row.day === selectedUsageDay) : usage[usage.length - 1]) ?? null,
    [selectedUsageDay, usage],
  );

  const filteredUsers = useMemo(() => {
    const needle = roleSearch.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== "all" && user.role !== roleFilter) return false;
      if (!needle) return true;
      return user.name.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle);
    });
  }, [roleFilter, roleSearch, users]);

  const roleBreakdown = useMemo(() => {
    let students = 0;
    let teachers = 0;
    let admins = 0;
    for (const user of users) {
      if (user.role === "student") students += 1;
      if (user.role === "teacher") teachers += 1;
      if (user.role === "admin") admins += 1;
    }
    const total = Math.max(1, users.length);
    return [
      { label: "Students", value: students, pct: Math.round((students / total) * 100), tone: "var(--accent-cyan)" },
      { label: "Teachers", value: teachers, pct: Math.round((teachers / total) * 100), tone: "var(--accent-mint)" },
      { label: "Admins", value: admins, pct: Math.round((admins / total) * 100), tone: "var(--accent-coral)" },
    ];
  }, [users]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function updateUserRole(targetUserId: string, nextRole: "student" | "teacher" | "admin") {
    const response = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId, role: nextRole }),
    });
    if (!response.ok) {
      toast.error(await response.text());
      return;
    }
    await loadAll();
  }

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verifyMarkerPassEnabled: verify,
          orchestratorV2Enabled,
          soulEnabled,
          agentModelBoostEnabled,
          adaptiveQuizEnabled,
          spacedRepetitionEnabled,
        }),
      });
      if (!response.ok) {
        toast.error(await response.text());
        return;
      }
      toast.success("AI configuration saved");
      await loadAll();
    } finally {
      setSavingSettings(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Loading / access guards
  // ---------------------------------------------------------------------------

  if (sidebarLoading || !hasAdminAccess || !adminDataLoaded) {
    return (
      <AppShell>
        <div className="flex items-center justify-center p-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-default)] border-t-[var(--accent-cyan)]" />
        </div>
      </AppShell>
    );
  }

  if (!adminOnboardingComplete) {
    return (
      <AppShell>
        <AdminOnboarding
          orgName={orgName}
          monthlyBudgetCentsPerUser={monthlyBudgetCentsPerUser}
          budgetMarginPercent={budgetMarginPercent}
          onComplete={markAdminOnboardingComplete}
          onSkip={markAdminOnboardingComplete}
        />
      </AppShell>
    );
  }

  // ---------------------------------------------------------------------------
  // Section renderers
  // ---------------------------------------------------------------------------

  function renderOverview() {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="font-display text-2xl">Overview</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            At-a-glance summary of your school members and AI activity.
          </p>
        </div>

        {/* Stat strip */}
        <div className="flex flex-wrap divide-x divide-[var(--border-default)] border-t border-b border-[var(--border-default)]">
          {roleBreakdown.map((row) => (
            <div key={row.label} className="px-4 py-3 first:pl-0">
              <p className="text-xs text-[var(--text-secondary)]">{row.label}</p>
              <p className="mt-0.5 text-2xl font-semibold" style={{ color: row.tone }}>{row.value}</p>
            </div>
          ))}
          <div className="px-4 py-3">
            <p className="text-xs text-[var(--text-secondary)]">Tokens (14 days)</p>
            <p className="mt-0.5 text-2xl font-semibold">{usageSum.toLocaleString()}</p>
          </div>
        </div>

        {/* Active AI features */}
        <div>
          <p className="mb-2 text-xs text-[var(--text-secondary)]">Active AI systems</p>
          <div className="divide-y divide-[var(--border-default)] border-t border-[var(--border-default)]">
            {[
              { label: "Orchestrator v2", enabled: orchestratorV2Enabled },
              { label: "School SOUL", enabled: soulEnabled },
              { label: "Agent boost", enabled: agentModelBoostEnabled },
              { label: "Adaptive quiz", enabled: adaptiveQuizEnabled },
              { label: "Spaced repetition", enabled: spacedRepetitionEnabled },
              { label: "Marker verification", enabled: verify },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between py-2 text-sm">
                <span className="text-[var(--text-secondary)]">{item.label}</span>
                <span className={`text-xs font-medium ${item.enabled ? "text-[var(--success)]" : "text-[var(--text-tertiary)]"}`}>
                  {item.enabled ? "On" : "Off"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick nav shortcuts */}
        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              { id: "users" as NavSection, label: "Manage users", sub: "Assign roles" },
              { id: "ai-config" as NavSection, label: "AI Configuration", sub: "Toggle features" },
              { id: "usage" as NavSection, label: "Usage Analytics", sub: "Token breakdown" },
            ] as { id: NavSection; label: string; sub: string }[]
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSection(item.id)}
              className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3 text-left transition-colors hover:border-[var(--accent-cyan)] hover:bg-[var(--bg-hover)]"
            >
              <p className="text-sm font-semibold">{item.label}</p>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{item.sub}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderUsers() {
    return (
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl">Users & Roles</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Search, filter, and reassign roles for all school members.
            </p>
          </div>
          <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--text-secondary)]">
            <Users2 className="h-3.5 w-3.5" />
            {users.length} members
          </div>
        </div>

        {/* Role breakdown bars */}
        <div className="grid gap-3 sm:grid-cols-3">
          {roleBreakdown.map((row) => (
            <div key={row.label} className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span>{row.label}</span>
                <span className="text-[var(--text-secondary)]">{row.pct}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
                <div className="h-full rounded-full" style={{ width: `${row.pct}%`, background: row.tone }} />
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">{row.value} users</p>
            </div>
          ))}
        </div>

        {/* Search + filter */}
        <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
          <Input
            value={roleSearch}
            onChange={(event) => setRoleSearch(event.target.value)}
            placeholder="Search by name or email"
            className="focus-visible:border-[var(--border-default)] focus-visible:ring-0"
          />
          <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as "all" | "student" | "teacher" | "admin")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="student">Student</SelectItem>
              <SelectItem value="teacher">Teacher</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* User table */}
        <div className="max-h-[58vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-default)]">
                <th className="pb-2 text-left text-xs font-medium text-[var(--text-secondary)]">Name</th>
                <th className="pb-2 text-left text-xs font-medium text-[var(--text-secondary)] hidden sm:table-cell">Email</th>
                <th className="pb-2 text-left text-xs font-medium text-[var(--text-secondary)] w-[160px]">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-default)]">
              {filteredUsers.map((user) => (
                <tr key={user._id}>
                  <td className="py-2.5 pr-2">
                    <p className="truncate font-medium">{user.name}</p>
                    <p className="truncate text-xs text-[var(--text-secondary)] sm:hidden">{user.email}</p>
                  </td>
                  <td className="py-2.5 pr-2 hidden sm:table-cell">
                    <p className="truncate text-xs text-[var(--text-secondary)]">{user.email}</p>
                  </td>
                  <td className="py-2 w-[160px]">
                    <Select
                      value={user.role}
                      onValueChange={(value) => void updateUserRole(user._id, value as "student" | "teacher" | "admin")}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="student">student</SelectItem>
                        <SelectItem value="teacher">teacher</SelectItem>
                        <SelectItem value="admin">admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-sm text-[var(--text-secondary)]">
                    No users match the current filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  function renderUsage() {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl">Usage Analytics</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Token consumption over the last 14 days.</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">Total tokens (14 days)</p>
            <p className="mt-1 font-display text-3xl">{usageSum.toLocaleString()}</p>
          </div>
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">Peak single day</p>
            <p className="mt-1 font-display text-3xl">{usageMax === 1 ? "–" : usageMax.toLocaleString()}</p>
          </div>
        </div>

        <div className="divide-y divide-[var(--border-default)] border-t border-[var(--border-default)]">
          {usage.map((row) => {
            const width = Math.max(2, Math.round((row.totalTokens / usageMax) * 100));
            return (
              <button
                key={row.day}
                type="button"
                onClick={() => setSelectedUsageDay(row.day)}
                className="w-full cursor-pointer py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                  <span className="text-[var(--text-secondary)]">{shortDay(row.day)}</span>
                  <span className="font-medium">{row.totalTokens.toLocaleString()} total</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
                  <div className="h-full rounded-full bg-[var(--accent-cyan)] transition-all" style={{ width: `${width}%` }} />
                </div>
              </button>
            );
          })}

          {usage.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--text-secondary)]">
              No usage data available yet.
            </p>
          ) : null}
        </div>

        {selectedUsage ? (
          <div className="rounded-2xl border border-[var(--accent-cyan)] bg-[color-mix(in_oklab,var(--accent-cyan)_8%,transparent)] px-4 py-3 text-xs">
            <p className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              Selected — {shortDay(selectedUsage.day)}
            </p>
            <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
              {selectedUsage.totalTokens.toLocaleString()} tokens
            </p>
            <p className="text-[var(--text-secondary)]">
              input {selectedUsage.inputTokens.toLocaleString()} · output {selectedUsage.outputTokens.toLocaleString()}
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  function renderAIConfig() {
    const toggleRows: {
      label: string;
      description: string;
      checked: boolean;
      onChange: (v: boolean) => void;
    }[] = [
      {
        label: "Marker verification pass",
        description: "Runs a second quality check for grading responses.",
        checked: verify,
        onChange: setVerify,
      },
      {
        label: "Orchestrator v2",
        description: "Routes messages through the advanced multi-agent pipeline.",
        checked: orchestratorV2Enabled,
        onChange: setOrchestratorV2Enabled,
      },
      {
        label: "School SOUL injection",
        description: "Applies your school's personality and policy to every session.",
        checked: soulEnabled,
        onChange: setSoulEnabled,
      },
      {
        label: "Agent model boost",
        description: "Upgrades specialist agents to higher-capacity models.",
        checked: agentModelBoostEnabled,
        onChange: setAgentModelBoostEnabled,
      },
      {
        label: "Adaptive quiz",
        description: "Dynamically adjusts quiz difficulty based on student performance.",
        checked: adaptiveQuizEnabled,
        onChange: setAdaptiveQuizEnabled,
      },
      {
        label: "Spaced repetition",
        description: "Schedules review sessions based on the forgetting curve.",
        checked: spacedRepetitionEnabled,
        onChange: setSpacedRepetitionEnabled,
      },
    ];

    return (
      <div className="space-y-5">
        <div>
          <h2 className="font-display text-2xl">AI Configuration</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Enable or disable core AI features school-wide.
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] divide-y divide-[var(--border-default)]">
          {toggleRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">{row.label}</p>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{row.description}</p>
              </div>
              <Switch checked={row.checked} onCheckedChange={row.onChange} />
            </div>
          ))}
        </div>

        <Button onClick={() => void saveSettings()} disabled={savingSettings} className="w-full gap-2">
          {savingSettings ? (
            "Saving..."
          ) : (
            <>
              <Cpu className="h-4 w-4" />
              Save AI configuration
            </>
          )}
        </Button>
      </div>
    );
  }

  function renderSoul() {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="font-display text-2xl">Soul & Personality</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Define the institutional voice and pedagogy that shapes every tutoring session.
          </p>
        </div>

        <div className="grid gap-3 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">School SOUL editor</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Manage mission, pedagogy, subject rules, tone, and policy injection in one place.
            </p>
          </div>
          <a
            href="/admin/school/soul"
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-[var(--accent-cyan)] px-4 text-sm font-medium text-[var(--accent-cyan)] transition-colors hover:bg-[color-mix(in_oklab,var(--accent-cyan)_10%,transparent)]"
          >
            <Sparkles className="h-4 w-4" />
            Open SOUL editor
          </a>
        </div>

        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.11em] text-[var(--text-secondary)]">
            <Sparkles className="h-6 w-6 text-[var(--accent-cyan)]" />
            Included sections
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {["Values & Mission", "Teaching Philosophy", "Subject Guidelines", "Tone & Voice", "Academic Policies"].map((label) => (
              <div key={label} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderBranding() {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="font-display text-2xl">Branding</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Customise logos, colors, and themes for your school workspace.
          </p>
        </div>

        <div className="grid gap-3 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Branding editor</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Update school logo, brand colors, and live preview from the dedicated editor.
            </p>
          </div>
          <a
            href="/admin/school/branding"
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-[var(--accent-cyan)] px-4 text-sm font-medium text-[var(--accent-cyan)] transition-colors hover:bg-[color-mix(in_oklab,var(--accent-cyan)_10%,transparent)]"
          >
            <Brush className="h-4 w-4" />
            Open branding editor
          </a>
        </div>

        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
          <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.11em] text-[var(--text-secondary)]">
            <Brush className="h-6 w-6 text-[var(--accent-cyan)]" />
            Editable areas
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {["Logo upload", "Primary color", "Accent color", "Live preview"].map((label) => (
              <div key={label} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderSection() {
    switch (activeSection) {
      case "overview":  return renderOverview();
      case "users":     return renderUsers();
      case "usage":     return renderUsage();
      case "ai-config": return renderAIConfig();
      case "soul":      return renderSoul();
      case "branding":  return renderBranding();
    }
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  return (
    <AppShell fullBleed contentClassName="2xl:px-14">
      <div className="space-y-5">
        {/* Page header */}
        <div data-tour="admin-header">
          <h1 className="font-display text-3xl">{orgName}</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Admin Console</p>
        </div>

        {/* Sidebar + content */}
        <div data-tour="admin-controls" className="flex gap-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] overflow-hidden">
          {/* Left sidebar nav */}
          <nav className="w-[200px] shrink-0 border-r border-[var(--border-default)] p-2">
            <ul className="space-y-0.5">
              {NAV_ITEMS.map((item) => {
                const isActive = activeSection === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setActiveSection(item.id)}
                      className={`flex w-full items-center gap-2.5 border-l-2 px-3 py-2.5 text-left text-sm transition-colors ${
                        isActive
                          ? "border-l-[var(--accent-cyan)] text-[var(--text-primary)]"
                          : "border-l-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                      }`}
                    >
                      <span className={isActive ? "text-[var(--accent-cyan)]" : ""}>
                        {item.icon}
                      </span>
                      {item.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Main content */}
          <div className="min-w-0 flex-1 p-5 sm:p-6">
            {renderSection()}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export default function AdminPage() {
  return (
    <Suspense>
      <AdminPageContent />
    </Suspense>
  );
}
