"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  BarChart3,
  MessageSquare,
  Palette,
  BookOpen,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { cn } from "@/lib/utils";

type DashboardData = {
  memberCount: number;
  studentCount: number;
  teacherCount: number;
  adminCount: number;
  messagesToday: number;
  pendingInvitations: number;
  orgName?: string;
  orgSlug?: string;
  isActive: boolean;
};

type NavCardProps = {
  href: string;
  icon: React.ReactNode;
  label: string;
  desc: string;
  accent?: string;
};

function NavCard({ href, icon, label, desc, accent = "var(--accent-cyan)" }: NavCardProps) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-card)] transition hover:border-[var(--accent-cyan)] hover:shadow-[var(--shadow-hover)]"
    >
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition"
        style={{
          background: `color-mix(in oklab, ${accent} 12%, transparent)`,
          color: accent,
        }}
      >
        {icon}
      </div>
      <div>
        <p className="font-semibold text-[var(--text-primary)] transition group-hover:text-[var(--accent-cyan)]">
          {label}
        </p>
        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{desc}</p>
      </div>
    </Link>
  );
}

function StatCard({ label, value, icon, sub }: { label: string; value: string | number; icon: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-card)]">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">{label}</span>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--accent-cyan)_10%,transparent)] text-[var(--accent-cyan)]">
          {icon}
        </div>
      </div>
      <p className="font-display text-3xl text-[var(--text-primary)]">{value}</p>
      {sub && <p className="mt-1 text-xs text-[var(--text-secondary)]">{sub}</p>}
    </div>
  );
}

export default function SchoolAdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/school-admin/dashboard");
        if (response.status === 403 || response.status === 401) {
          setAccessDenied(true);
          return;
        }
        if (!response.ok) throw new Error(await response.text());
        const result = (await response.json()) as DashboardData;
        setData(result);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load dashboard");
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
            <ShieldCheck className="mx-auto mb-4 h-12 w-12 text-[var(--accent-coral)]" />
            <h2 className="mb-2 text-xl font-semibold">Admin Access Required</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              You need the admin role to access the School Admin panel.
            </p>
            <Link href="/">
              <button className="mt-5 cursor-pointer rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]">
                Go back home
              </button>
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
        <div>
          <div className="mb-1 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--accent-cyan)]" />
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-secondary)]">
              School Admin
            </span>
          </div>
          <h1 className="font-display text-3xl text-[var(--text-primary)]">
            {loading ? "Loading..." : (data?.orgName ?? "School Dashboard")}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {data?.orgSlug && (
              <span className="font-mono text-[var(--text-secondary)]">/{data.orgSlug}</span>
            )}
            {!loading && data && (
              <span
                className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  data.isActive
                    ? "bg-[color-mix(in_oklab,var(--success)_12%,transparent)] text-[var(--success)]"
                    : "bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] text-[var(--danger)]"
                }`}
              >
                {data.isActive ? "Active" : "Inactive"}
              </span>
            )}
          </p>
          <div className="mt-3 inline-flex items-center rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-1">
            {[
              { href: "/admin", label: "Personal Admin" },
              { href: "/admin/school", label: "School Admin" },
            ].map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs transition",
                  tab.href === "/admin/school"
                    ? "bg-[var(--bg-primary)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                )}
              >
                {tab.label}
              </Link>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Active Students"
            value={loading ? "..." : (data?.studentCount ?? 0)}
            icon={<Users className="h-4 w-4" />}
            sub="Enrolled students"
          />
          <StatCard
            label="Messages Today"
            value={loading ? "..." : (data?.messagesToday ?? 0)}
            icon={<MessageSquare className="h-4 w-4" />}
            sub="Last 24 hours"
          />
          <StatCard
            label="Total Members"
            value={loading ? "..." : (data?.memberCount ?? 0)}
            icon={<Zap className="h-4 w-4" />}
            sub="Students, teachers, admins"
          />
          <StatCard
            label="Pending Invites"
            value={loading ? "..." : (data?.pendingInvitations ?? 0)}
            icon={<Users className="h-4 w-4" />}
            sub="Awaiting acceptance"
          />
        </div>

        {/* Nav Cards */}
        <div>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            Manage
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <NavCard
              href="/admin/school/members"
              icon={<Users className="h-5 w-5" />}
              label="Members"
              desc="Invite, manage roles and remove members"
              accent="var(--accent-cyan)"
            />
            <NavCard
              href="/admin/school/branding"
              icon={<Palette className="h-5 w-5" />}
              label="Branding"
              desc="Logo, colors and welcome message"
              accent="var(--accent-coral)"
            />
            <NavCard
              href="/admin/school/soul"
              icon={<BookOpen className="h-5 w-5" />}
              label="School SOUL"
              desc="Institutional guidance and AI policies"
              accent="var(--accent-mint)"
            />
            <NavCard
              href="/admin/school/analytics"
              icon={<BarChart3 className="h-5 w-5" />}
              label="Analytics"
              desc="Usage, quiz scores and engagement data"
              accent="var(--mode-quiz)"
            />
          </div>
        </div>

        {/* Teacher quick-access */}
        <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-soft)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Existing Admin Panel</h2>
              <p className="text-xs text-[var(--text-secondary)]">
                Access the full admin console with user roles and org settings.
              </p>
            </div>
            <Link
              href="/admin"
              className="cursor-pointer rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-hover)]"
            >
              Open Admin Console
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
