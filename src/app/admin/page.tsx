"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, Users2, WalletCards } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

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
  const [role, setRole] = useState<"student" | "teacher" | "admin">("student");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [verify, setVerify] = useState(false);
  const [budget, setBudget] = useState("1500000");

  async function loadAll() {
    const bootstrapResponse = await fetch("/api/bootstrap");
    if (!bootstrapResponse.ok) throw new Error(await bootstrapResponse.text());
    const bootstrap = (await bootstrapResponse.json()) as {
      actor: { role: "student" | "teacher" | "admin" };
      orgSettings: { org: { verifyMarkerPassEnabled: boolean; tokenBudgetDaily: number } };
    };

    setRole(bootstrap.actor.role);
    setVerify(Boolean(bootstrap.orgSettings.org.verifyMarkerPassEnabled));
    setBudget(String(bootstrap.orgSettings.org.tokenBudgetDaily));

    if (bootstrap.actor.role !== "admin") {
      return;
    }

    const usersResponse = await fetch("/api/admin/users");
    if (!usersResponse.ok) throw new Error(await usersResponse.text());
    const usersData = (await usersResponse.json()) as { users: UserRow[]; usage: UsageRow[] };
    setUsers(usersData.users);
    setUsage(usersData.usage);
  }

  useEffect(() => {
    void loadAll().catch((error) => toast.error(error instanceof Error ? error.message : "Failed to load admin data"));
  }, []);

  const usageSum = useMemo(() => usage.reduce((sum, row) => sum + row.totalTokens, 0), [usage]);

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
        tokenBudgetDaily: Number(budget),
      }),
    });
    if (!response.ok) {
      toast.error(await response.text());
      return;
    }
    toast.success("Settings updated");
    await loadAll();
  }

  if (role !== "admin") {
    return (
      <AppShell>
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Admin access required
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-ink-300">You need the admin role to manage users and organization settings.</p>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Admin Console</h1>
        <p className="text-sm text-ink-400">Control roles, quality checks, and spending limits for your school workspace.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <Users2 className="h-4 w-4" /> Role Management
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {users.map((user) => (
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
          </CardContent>
        </Card>

        <div className="space-y-4">
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
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-ink-500">Daily token budget</label>
                <Input value={budget} onChange={(event) => setBudget(event.target.value)} />
              </div>
              <Button onClick={() => void saveSettings()}>Save settings</Button>
            </CardContent>
          </Card>

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
        </div>
      </div>
    </AppShell>
  );
}
