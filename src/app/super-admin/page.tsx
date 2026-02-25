"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  BellRing,
  Database,
  Building2,
  HardDrive,
  MessageSquare,
  Plus,
  Send,
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

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [announcementAudience, setAnnouncementAudience] = useState<"all" | "org" | "email">("all");
  const [announcementOrgId, setAnnouncementOrgId] = useState("");
  const [announcementEmail, setAnnouncementEmail] = useState("");
  const [announcementTitle, setAnnouncementTitle] = useState("");
  const [announcementBody, setAnnouncementBody] = useState("");
  const [announcementActionUrl, setAnnouncementActionUrl] = useState("");
  const [sendingAnnouncement, setSendingAnnouncement] = useState(false);
  const knownEmails = useMemo(
    () =>
      Array.from(
        new Set(admins.map((admin) => admin.email.trim()).filter((email) => email.includes("@"))),
      ),
    [admins],
  );

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
    const email = announcementEmail.trim();

    if (!title || !body) {
      toast.error("Title and message are required.");
      return;
    }
    if (announcementAudience === "org" && !announcementOrgId) {
      toast.error("Choose a school target.");
      return;
    }
    if (announcementAudience === "email" && !email) {
      toast.error("Enter a recipient email.");
      return;
    }

    setSendingAnnouncement(true);
    try {
      const response = await fetch("/api/super-admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience: announcementAudience,
          title,
          body,
          actionUrl: actionUrl || undefined,
          orgId: announcementAudience === "org" ? announcementOrgId : undefined,
          userEmail: announcementAudience === "email" ? email : undefined,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = (await response.json()) as { sentCount?: number };
      toast.success(`Announcement sent to ${payload.sentCount ?? 0} user${payload.sentCount === 1 ? "" : "s"}.`);
      setAnnouncementTitle("");
      setAnnouncementBody("");
      setAnnouncementActionUrl("");
      if (announcementAudience !== "org") {
        setAnnouncementOrgId("");
      }
      if (announcementAudience !== "email") {
        setAnnouncementEmail("");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send announcement");
    } finally {
      setSendingAnnouncement(false);
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

        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-soft)]">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
                Broadcast Notification
              </h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Send announcements to all users, one school, or a specific person.
              </p>
            </div>
            <BellRing className="h-4 w-4 text-[var(--text-secondary)]" />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Audience</span>
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
                <span className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">School</span>
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
              <label className="space-y-1.5">
                <span className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Recipient email</span>
                <input
                  type="email"
                  list="super-admin-email-suggestions"
                  value={announcementEmail}
                  onChange={(event) => setAnnouncementEmail(event.target.value)}
                  placeholder="student@school.edu"
                  className="h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent-cyan)_32%,transparent)]"
                />
                <datalist id="super-admin-email-suggestions">
                  {knownEmails.map((email) => (
                    <option key={email} value={email} />
                  ))}
                </datalist>
              </label>
            ) : (
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2.5 text-xs text-[var(--text-secondary)]">
                Everyone on the platform will receive this message.
              </div>
            )}

            <label className="space-y-1.5 lg:col-span-2">
              <span className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Title</span>
              <input
                value={announcementTitle}
                onChange={(event) => setAnnouncementTitle(event.target.value)}
                maxLength={180}
                placeholder="New feature update"
                className="h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--accent-cyan)_32%,transparent)]"
              />
            </label>

            <label className="space-y-1.5 lg:col-span-2">
              <span className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Message</span>
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
              <span className="text-xs uppercase tracking-[0.1em] text-[var(--text-secondary)]">Action URL (optional)</span>
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
              {auditLogs.map((item) => (
                <div
                  key={item._id}
                  className="flex items-start gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3"
                >
                  <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[var(--accent-cyan)]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[var(--text-primary)]">{humanizeAuditAction(item.action)}</p>
                    <p className="truncate text-xs text-[var(--text-secondary)]">
                      {item.details?.trim() || `${item.targetType}: ${item.targetId}`}{" "}
                      <span className="text-[var(--text-muted)]">
                        · {(item.actorName || item.actorEmail || "Unknown actor").trim()}
                      </span>
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">
                    {formatRelativeTime(item.createdAt)}
                  </span>
                </div>
              ))}
              {auditLogs.length === 0 && (
                <p className="text-sm text-[var(--text-secondary)]">No recent platform activity yet.</p>
              )}
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
