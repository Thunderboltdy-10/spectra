"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Users2, WalletCards } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { AdminOnboarding } from "@/components/onboarding/admin-onboarding";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
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

export default function AdminPage() {
  const router = useRouter();
  const { role: userRole, isSuperAdmin, loading: sidebarLoading } = useSidebar();
  const [adminDataLoaded, setAdminDataLoaded] = useState(false);
  const [adminOnboardingComplete, setAdminOnboardingComplete] = useState(true);
  const [orgName, setOrgName] = useState("AI School");
  const [monthlyBudgetCentsPerUser, setMonthlyBudgetCentsPerUser] = useState<number | null>(null);
  const [budgetMarginPercent, setBudgetMarginPercent] = useState<number | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [verify, setVerify] = useState(false);
  const [roleSearch, setRoleSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "student" | "teacher" | "admin">("all");
  const [orchestratorV2Enabled, setOrchestratorV2Enabled] = useState(false);
  const [soulEnabled, setSoulEnabled] = useState(false);
  const [agentModelBoostEnabled, setAgentModelBoostEnabled] = useState(false);
  const [adaptiveQuizEnabled, setAdaptiveQuizEnabled] = useState(false);
  const [spacedRepetitionEnabled, setSpacedRepetitionEnabled] = useState(false);
  const hasAdminAccess = userRole === "admin" || isSuperAdmin;

  async function loadAll() {
    const bootstrapResponse = await fetch("/api/bootstrap");
    if (!bootstrapResponse.ok) throw new Error(await bootstrapResponse.text());
    const bootstrap = (await bootstrapResponse.json()) as {
      actor: { role: "student" | "teacher" | "admin"; onboardingComplete?: boolean };
      isSuperAdmin?: boolean;
      orgSettings: {
        org: {
          name?: string;
          verifyMarkerPassEnabled: boolean;
          tokenBudgetDaily: number;
          monthlyBudgetCentsPerUser?: number;
          budgetMarginPercent?: number;
          orchestratorV2Enabled?: boolean;
          soulEnabled?: boolean;
          agentModelBoostEnabled?: boolean;
          adaptiveQuizEnabled?: boolean;
          spacedRepetitionEnabled?: boolean;
        };
      };
    };

    setAdminOnboardingComplete(Boolean(bootstrap.actor.onboardingComplete));
    setOrgName(bootstrap.orgSettings.org.name ?? "AI School");
    setMonthlyBudgetCentsPerUser(
      typeof bootstrap.orgSettings.org.monthlyBudgetCentsPerUser === "number"
        ? bootstrap.orgSettings.org.monthlyBudgetCentsPerUser
        : null,
    );
    setBudgetMarginPercent(
      typeof bootstrap.orgSettings.org.budgetMarginPercent === "number"
        ? bootstrap.orgSettings.org.budgetMarginPercent
        : null,
    );
    setVerify(Boolean(bootstrap.orgSettings.org.verifyMarkerPassEnabled));
    setOrchestratorV2Enabled(bootstrap.orgSettings.org.orchestratorV2Enabled ?? true);
    setSoulEnabled(bootstrap.orgSettings.org.soulEnabled ?? true);
    setAgentModelBoostEnabled(bootstrap.orgSettings.org.agentModelBoostEnabled ?? true);
    setAdaptiveQuizEnabled(bootstrap.orgSettings.org.adaptiveQuizEnabled ?? true);
    setSpacedRepetitionEnabled(bootstrap.orgSettings.org.spacedRepetitionEnabled ?? true);

    const actorCanManageAdmin = bootstrap.actor.role === "admin" || Boolean(bootstrap.isSuperAdmin);
    if (!actorCanManageAdmin) {
      return;
    }

    const usersResponse = await fetch("/api/admin/users");
    if (!usersResponse.ok) throw new Error(await usersResponse.text());
    const usersData = (await usersResponse.json()) as { users: UserRow[]; usage: UsageRow[] };
    setUsers(usersData.users);
    setUsage(usersData.usage);
  }

  async function markAdminOnboardingComplete() {
    const response = await fetch("/api/personal-soul", {
      method: "PATCH",
    });
    if (!response.ok) {
      throw new Error(await response.text());
    }

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
  const filteredUsers = useMemo(() => {
    const needle = roleSearch.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== "all" && user.role !== roleFilter) return false;
      if (!needle) return true;
      return (
        user.name.toLowerCase().includes(needle) ||
        user.email.toLowerCase().includes(needle)
      );
    });
  }, [roleFilter, roleSearch, users]);

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
    toast.success("Settings updated");
    await loadAll();
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
    <AppShell>
      <div className="mb-5" data-tour="admin-header">
        <h1 className="text-2xl font-semibold tracking-tight">Admin Console</h1>
        <p className="text-sm text-ink-400">Control roles, quality checks, and spending limits for your school workspace.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/admin/school" className="inline-flex items-center rounded-md border border-app-border bg-app-muted px-3 py-1.5 text-sm">
            School dashboard
          </Link>
          <Link href="/admin/school/soul" className="inline-flex items-center rounded-md border border-app-border bg-app-muted px-3 py-1.5 text-sm">
            Open School Soul
          </Link>
          <Link href="/admin/school/branding" className="inline-flex items-center rounded-md border border-app-border bg-app-muted px-3 py-1.5 text-sm">
            Open Branding
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]" data-tour="admin-controls">
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <Users2 className="h-4 w-4" /> Role Management
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[58vh] space-y-3 overflow-y-auto pr-1">
            <div className="grid gap-2 md:grid-cols-[1fr_180px]">
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

            {filteredUsers.map((user) => (
              <div
                key={user._id}
                className="grid items-center gap-2 rounded-lg border border-app-border bg-app-muted p-2 md:grid-cols-[1fr_180px]"
              >
                <div>
                  <p className="text-sm font-semibold">{user.name}</p>
                  <p className="text-xs text-ink-500">{user.email}</p>
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
              <p className="text-sm text-ink-500">No users match the current filters.</p>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2">
                <WalletCards className="h-4 w-4" /> Usage (14 days)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="rounded-md border border-app-border bg-app-muted p-2 text-sm">
                Total: {usageSum.toLocaleString()} tokens
              </div>
              {usage.map((row) => (
                <div key={row.day} className="rounded-md border border-app-border bg-app-muted p-2 text-sm">
                  <div className="font-mono text-xs text-ink-500">{row.day}</div>
                  <div>{row.totalTokens.toLocaleString()} total</div>
                  <div className="text-xs text-ink-500">
                    in: {row.inputTokens.toLocaleString()} / out: {row.outputTokens.toLocaleString()}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Organization Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-app-border bg-app-muted px-3 py-2">
                <div>
                  <p className="text-sm">Enable marker verification pass</p>
                  <p className="text-xs text-ink-500">Adds an extra check for grading responses.</p>
                </div>
                <Switch checked={verify} onCheckedChange={setVerify} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-app-border bg-app-muted px-3 py-2">
                <div>
                  <p className="text-sm">Multi-agent orchestrator</p>
                  <p className="text-xs text-ink-500">Enable orchestrator v2 collaboration pipeline.</p>
                </div>
                <Switch checked={orchestratorV2Enabled} onCheckedChange={setOrchestratorV2Enabled} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-app-border bg-app-muted px-3 py-2">
                <div>
                  <p className="text-sm">School Soul injection</p>
                  <p className="text-xs text-ink-500">Inject published School Soul guidance at runtime.</p>
                </div>
                <Switch checked={soulEnabled} onCheckedChange={setSoulEnabled} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-app-border bg-app-muted px-3 py-2">
                <div>
                  <p className="text-sm">Agent model boost</p>
                  <p className="text-xs text-ink-500">Use agent historical model performance for routing boosts.</p>
                </div>
                <Switch checked={agentModelBoostEnabled} onCheckedChange={setAgentModelBoostEnabled} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-app-border bg-app-muted px-3 py-2">
                <div>
                  <p className="text-sm">Adaptive quiz difficulty</p>
                  <p className="text-xs text-ink-500">Allow quiz mode to adapt difficulty based on performance.</p>
                </div>
                <Switch checked={adaptiveQuizEnabled} onCheckedChange={setAdaptiveQuizEnabled} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-app-border bg-app-muted px-3 py-2">
                <div>
                  <p className="text-sm">Spaced repetition</p>
                  <p className="text-xs text-ink-500">Enable SM-2 flashcard scheduling features.</p>
                </div>
                <Switch checked={spacedRepetitionEnabled} onCheckedChange={setSpacedRepetitionEnabled} />
              </div>
              <Button onClick={() => void saveSettings()}>Save settings</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
