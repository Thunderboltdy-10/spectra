"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Activity,
  BarChart3,
  Building2,
  CircleCheck,
  Cpu,
  ShieldCheck,
  Users2,
  WalletCards,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { AdminOnboarding } from "@/components/onboarding/admin-onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSidebar } from "@/context/sidebar-context";

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
  tokenBudgetDaily: number;
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

function formatMoney(cents?: number | null) {
  if (typeof cents !== "number") return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function shortDay(day: string) {
  const value = new Date(`${day}T00:00:00Z`);
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function AdminPage() {
  const router = useRouter();
  const { role: userRole, isSuperAdmin, loading: sidebarLoading } = useSidebar();

  const [adminDataLoaded, setAdminDataLoaded] = useState(false);
  const [adminOnboardingComplete, setAdminOnboardingComplete] = useState(true);

  const [orgName, setOrgName] = useState("AI School");
  const [orgDescription, setOrgDescription] = useState("");
  const [schoolType, setSchoolType] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [maxStudents, setMaxStudents] = useState("");

  const [tokenBudgetDaily, setTokenBudgetDaily] = useState(500000);
  const [monthlyBudgetCentsPerUser, setMonthlyBudgetCentsPerUser] = useState<number | null>(null);
  const [budgetMarginPercent, setBudgetMarginPercent] = useState<number | null>(null);
  const [allowPaidModels, setAllowPaidModels] = useState(true);
  const [verify, setVerify] = useState(false);

  const [orchestratorV2Enabled, setOrchestratorV2Enabled] = useState(true);
  const [soulEnabled, setSoulEnabled] = useState(true);
  const [agentModelBoostEnabled, setAgentModelBoostEnabled] = useState(true);
  const [adaptiveQuizEnabled, setAdaptiveQuizEnabled] = useState(true);
  const [spacedRepetitionEnabled, setSpacedRepetitionEnabled] = useState(true);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [roleSearch, setRoleSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "student" | "teacher" | "admin">("all");
  const [savingSettings, setSavingSettings] = useState(false);

  const hasAdminAccess = userRole === "admin" || isSuperAdmin;

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
    setOrgDescription(org.description ?? "");
    setSchoolType(org.schoolType ?? "");
    setTimezone(org.timezone ?? "UTC");
    setMaxStudents(typeof org.maxStudents === "number" ? String(org.maxStudents) : "");

    setTokenBudgetDaily(typeof org.tokenBudgetDaily === "number" ? org.tokenBudgetDaily : 500000);
    setMonthlyBudgetCentsPerUser(typeof org.monthlyBudgetCentsPerUser === "number" ? org.monthlyBudgetCentsPerUser : null);
    setBudgetMarginPercent(typeof org.budgetMarginPercent === "number" ? org.budgetMarginPercent : null);
    setAllowPaidModels(org.allowPaidModels ?? true);
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
    if (sidebarLoading || !hasAdminAccess) return;
    setAdminDataLoaded(false);
    void loadAll()
      .catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load admin data"))
      .finally(() => setAdminDataLoaded(true));
  }, [hasAdminAccess, sidebarLoading]);

  const usageSum = useMemo(() => usage.reduce((sum, row) => sum + row.totalTokens, 0), [usage]);
  const usageMax = useMemo(() => Math.max(1, ...usage.map((row) => row.totalTokens)), [usage]);
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
      const parsedMaxStudents = maxStudents.trim() ? Number(maxStudents) : undefined;
      const safeMaxStudents =
        typeof parsedMaxStudents === "number" && Number.isFinite(parsedMaxStudents)
          ? Math.max(1, Math.round(parsedMaxStudents))
          : undefined;
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verifyMarkerPassEnabled: verify,
          tokenBudgetDaily,
          monthlyBudgetCentsPerUser,
          budgetMarginPercent,
          allowPaidModels,
          description: orgDescription.trim() || undefined,
          schoolType: schoolType.trim() || undefined,
          timezone: timezone.trim() || undefined,
          maxStudents: safeMaxStudents,
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
      toast.success("Organization settings updated");
      await loadAll();
    } finally {
      setSavingSettings(false);
    }
  }

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

  return (
    <AppShell fullBleed contentClassName="2xl:px-14">
      <div className="space-y-6">
        <div data-tour="admin-header" className="rounded-3xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 sm:p-6">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
            Admin Console
          </div>
          <h1 className="font-display text-4xl tracking-tight">{orgName}</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Operational control center for roles, budget guardrails, and school-level AI policy.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <Link href="/admin/school" className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">
              School dashboard
            </Link>
            <Link href="/admin/school/soul" className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">
              School SOUL
            </Link>
            <Link href="/admin/school/branding" className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1.5 text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">
              Branding
            </Link>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.95fr)]" data-tour="admin-controls">
          <section className="rounded-3xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Role Management</p>
                <h2 className="mt-1 font-display text-2xl">Team Directory</h2>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                <Users2 className="h-3.5 w-3.5" />
                {users.length} members
              </div>
            </div>

            <div className="mb-4 grid gap-2 md:grid-cols-[1fr_180px]">
              <Input
                value={roleSearch}
                onChange={(event) => setRoleSearch(event.target.value)}
                placeholder="Search by name or email"
                className="focus-visible:border-[var(--border-default)] focus-visible:ring-0"
              />
              <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as "all" | "student" | "teacher" | "admin") }>
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

            <div className="grid gap-2 sm:grid-cols-3">
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

            <div className="mt-4 max-h-[52vh] space-y-2 overflow-y-auto pr-1">
              {filteredUsers.map((user) => (
                <div
                  key={user._id}
                  className="grid items-center gap-2 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2.5 md:grid-cols-[1fr_180px]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{user.name}</p>
                    <p className="truncate text-xs text-[var(--text-secondary)]">{user.email}</p>
                  </div>
                  <Select
                    value={user.role}
                    onValueChange={(value) => void updateUserRole(user._id, value as "student" | "teacher" | "admin")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="student">student</SelectItem>
                      <SelectItem value="teacher">teacher</SelectItem>
                      <SelectItem value="admin">admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {filteredUsers.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[var(--border-default)] p-5 text-center text-sm text-[var(--text-secondary)]">
                  No users match the current filters.
                </p>
              ) : null}
            </div>
          </section>

          <div className="space-y-5">
            <section className="rounded-3xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 sm:p-6">
              <div className="mb-4 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Usage Intelligence</p>
                  <h2 className="mt-1 font-display text-2xl">Last 14 days</h2>
                </div>
                <WalletCards className="h-5 w-5 text-[var(--accent-cyan)]" />
              </div>

              <div className="mb-4 grid gap-2 sm:grid-cols-2">
                <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5">
                  <p className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">Total tokens</p>
                  <p className="font-display text-2xl">{usageSum.toLocaleString()}</p>
                </div>
                <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5">
                  <p className="text-[11px] uppercase tracking-[0.1em] text-[var(--text-secondary)]">Monthly/user budget</p>
                  <p className="font-display text-2xl">{formatMoney(monthlyBudgetCentsPerUser)}</p>
                </div>
              </div>

              <div className="space-y-2">
                {usage.map((row) => {
                  const width = Math.max(2, Math.round((row.totalTokens / usageMax) * 100));
                  return (
                    <div key={row.day} className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2.5">
                      <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                        <span className="text-[var(--text-secondary)]">{shortDay(row.day)}</span>
                        <span className="font-medium">{row.totalTokens.toLocaleString()} total</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
                        <div className="h-full rounded-full bg-[var(--accent-cyan)]" style={{ width: `${width}%` }} />
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                        in: {row.inputTokens.toLocaleString()} / out: {row.outputTokens.toLocaleString()}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-3xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 sm:p-6">
              <div className="mb-4 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Organization Settings</p>
                  <h2 className="mt-1 font-display text-2xl">School Operations</h2>
                </div>
                <Building2 className="h-5 w-5 text-[var(--accent-cyan)]" />
              </div>

              <div className="space-y-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">School profile</span>
                  <textarea
                    value={orgDescription}
                    onChange={(event) => setOrgDescription(event.target.value)}
                    placeholder="Short description shown in school context and admin tools"
                    className="min-h-[74px] w-full resize-none rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2 text-sm outline-none"
                  />
                </label>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label>
                    <span className="mb-1.5 block text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">School type</span>
                    <Input value={schoolType} onChange={(event) => setSchoolType(event.target.value)} placeholder="High school, IB, university..." />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Timezone</span>
                    <Input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="UTC" />
                  </label>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label>
                    <span className="mb-1.5 block text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Max students</span>
                    <Input
                      type="number"
                      min={1}
                      value={maxStudents}
                      onChange={(event) => setMaxStudents(event.target.value)}
                      placeholder="Not set"
                    />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Daily token budget (org)</span>
                    <Input
                      type="number"
                      min={1000}
                      value={tokenBudgetDaily}
                      onChange={(event) => setTokenBudgetDaily(Math.max(1000, Number(event.target.value) || 1000))}
                    />
                  </label>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <label>
                    <span className="mb-1.5 block text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Monthly budget per user (USD cents)</span>
                    <Input
                      type="number"
                      min={100}
                      value={monthlyBudgetCentsPerUser ?? ""}
                      onChange={(event) => {
                        const raw = event.target.value.trim();
                        setMonthlyBudgetCentsPerUser(raw ? Math.max(100, Number(raw) || 100) : null);
                      }}
                      placeholder="Unset"
                    />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Budget margin %</span>
                    <Input
                      type="number"
                      min={5}
                      max={45}
                      value={budgetMarginPercent ?? ""}
                      onChange={(event) => {
                        const raw = event.target.value.trim();
                        setBudgetMarginPercent(raw ? Math.min(45, Math.max(5, Number(raw) || 5)) : null);
                      }}
                      placeholder="Unset"
                    />
                  </label>
                </div>

                <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                  <div className="flex items-center justify-between py-1">
                    <div>
                      <p className="text-sm">Allow paid models</p>
                      <p className="text-xs text-[var(--text-secondary)]">Enable premium model access when budgets permit.</p>
                    </div>
                    <Switch checked={allowPaidModels} onCheckedChange={setAllowPaidModels} />
                  </div>
                  <div className="mt-2 border-t border-[var(--border-default)] pt-2">
                    <div className="flex items-center justify-between py-1">
                      <div>
                        <p className="text-sm">Marker verification pass</p>
                        <p className="text-xs text-[var(--text-secondary)]">Runs a second quality check for grading responses.</p>
                      </div>
                      <Switch checked={verify} onCheckedChange={setVerify} />
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                  <p className="mb-2 text-xs uppercase tracking-[0.12em] text-[var(--text-secondary)]">Core AI systems (always available)</p>
                  <div className="grid gap-1.5 text-xs sm:grid-cols-2">
                    {[
                      { label: "Orchestrator v2", enabled: orchestratorV2Enabled },
                      { label: "School SOUL injection", enabled: soulEnabled },
                      { label: "Agent model boost", enabled: agentModelBoostEnabled },
                      { label: "Adaptive quiz", enabled: adaptiveQuizEnabled },
                      { label: "Spaced repetition", enabled: spacedRepetitionEnabled },
                    ].map((item) => (
                      <div key={item.label} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2.5 py-1">
                        {item.enabled ? <CircleCheck className="h-3.5 w-3.5 text-[var(--success)]" /> : <Activity className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
                        {item.label}
                      </div>
                    ))}
                  </div>
                </div>

                <Button onClick={() => void saveSettings()} disabled={savingSettings} className="w-full gap-2">
                  {savingSettings ? (
                    "Saving..."
                  ) : (
                    <>
                      <Cpu className="h-4 w-4" />
                      Save settings
                    </>
                  )}
                </Button>
              </div>
            </section>
          </div>
        </div>

        <div className="rounded-3xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 text-xs text-[var(--text-secondary)]">
          <div className="inline-flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5 text-[var(--accent-cyan)]" />
            Usage trends and controls are now unified here; no hidden admin paths required.
          </div>
        </div>
      </div>
    </AppShell>
  );
}
