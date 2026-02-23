"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Database,
  Building2,
  HardDrive,
  MessageSquare,
  Plus,
  Shield,
  Users,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

type GlobalStats = {
  totalOrgs: number;
  totalUsers: number;
  totalMessages: number;
  totalAdmins: number;
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

type StatCardProps = {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  sub?: string;
};

function StatCard({ label, value, icon, sub }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-card)]">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          {label}
        </span>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)] text-[var(--accent-cyan)]">
          {icon}
        </div>
      </div>
      <p className="font-display text-4xl text-[var(--text-primary)]">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub && (
        <p className="mt-1 text-sm text-[var(--text-secondary)]">{sub}</p>
      )}
    </div>
  );
}

const QUICK_ACTIONS = [
  { label: "View All Schools", href: "/super-admin/schools", icon: Building2, variant: "secondary" as const },
  { label: "Feedback Inbox", href: "/super-admin/feedback", icon: MessageSquare, variant: "secondary" as const },
  { label: "Create School", href: "/super-admin/schools/new", icon: Plus, variant: "default" as const },
];

const MOCK_RECENT_ACTIVITY = [
  { id: 1, event: "New school created", detail: "Greenfield Academy", time: "2 min ago" },
  { id: 2, event: "User role updated", detail: "jane@example.com → admin", time: "14 min ago" },
  { id: 3, event: "School deactivated", detail: "Old Demo Org", time: "1 hour ago" },
  { id: 4, event: "New school created", detail: "Sunrise University", time: "3 hours ago" },
  { id: 5, event: "Token budget updated", detail: "Metro High School — 2M/day", time: "5 hours ago" },
];

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);

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
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load stats");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
            <div className="mb-1 flex items-center gap-2">
              <Shield className="h-5 w-5 text-[var(--accent-cyan)]" />
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                Super Admin
              </span>
            </div>
            <h1 className="font-display text-3xl text-[var(--text-primary)]">
              Platform Overview
            </h1>
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

        {/* Stats Grid */}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total Schools"
            value={loading ? "..." : (stats?.totalOrgs ?? 0)}
            icon={<Building2 className="h-4 w-4" />}
            sub="Registered orgs"
          />
          <StatCard
            label="Total Users"
            value={loading ? "..." : (stats?.totalUsers ?? 0)}
            icon={<Users className="h-4 w-4" />}
            sub="Across all schools"
          />
          <StatCard
            label="Total Messages"
            value={loading ? "..." : (stats?.totalMessages ?? 0)}
            icon={<MessageSquare className="h-4 w-4" />}
            sub="Lifetime messages"
          />
          <StatCard
            label="School Admins"
            value={loading ? "..." : (stats?.totalAdmins ?? 0)}
            icon={<Zap className="h-4 w-4" />}
            sub="Users with admin role"
          />
        </div>

        {storageStats && (
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-soft)]">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                Storage Insights
              </h2>
              <HardDrive className="h-4 w-4 text-[var(--text-secondary)]" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Tracked Storage</p>
                <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">
                  {storageStats.totalSizeMegabytes.toLocaleString()} MB
                </p>
                <p className="text-xs text-[var(--text-secondary)]">From uploaded resources</p>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Resource Files</p>
                <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">
                  {storageStats.resourceFileCount.toLocaleString()}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">Documents in storage</p>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Generated Images</p>
                <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">
                  {storageStats.generatedImageCount.toLocaleString()}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  {storageStats.pinnedImageCount.toLocaleString()} pinned
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
                <p className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Expiring Images</p>
                <p className="mt-1 text-xl font-semibold text-[var(--text-primary)]">
                  {storageStats.expiringImageCountIn3Days.toLocaleString()}
                </p>
                <p className="text-xs text-[var(--text-secondary)]">Within next 3 days</p>
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
              <p className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
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

        {/* Quick Navigation + Activity Feed */}
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          {/* Quick Nav */}
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-soft)]">
            <h2 className="mb-5 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
              Quick Navigation
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: "All Schools", href: "/super-admin/schools", icon: Building2, desc: "Browse and manage orgs" },
                { label: "Create School", href: "/super-admin/schools/new", icon: Plus, desc: "Provision a new org" },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group flex items-start gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 transition hover:border-[var(--accent-cyan)] hover:bg-[var(--bg-hover)]"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--accent-cyan)_10%,transparent)] text-[var(--accent-cyan)] transition group-hover:bg-[color-mix(in_oklab,var(--accent-cyan)_18%,transparent)]">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{item.label}</p>
                      <p className="text-xs text-[var(--text-secondary)]">{item.desc}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Activity Feed */}
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-soft)]">
            <h2 className="mb-5 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
              Recent Activity
            </h2>
            <div className="space-y-3">
              {MOCK_RECENT_ACTIVITY.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3"
                >
                  <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[var(--accent-cyan)]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--text-primary)]">{item.event}</p>
                    <p className="truncate text-xs text-[var(--text-secondary)]">{item.detail}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">{item.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-soft)]">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            School Admin Directory
          </h2>
          {admins.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">No admins found yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {admins.map((admin) => (
                <div
                  key={admin._id}
                  className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3"
                >
                  <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{admin.name}</p>
                  <p className="truncate text-xs text-[var(--text-secondary)]">{admin.email}</p>
                  <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">{admin.orgName}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
