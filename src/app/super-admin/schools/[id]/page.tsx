"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Building2,
  BarChart3,
  BookOpen,
  Settings,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

type Member = {
  _id: string;
  name: string;
  email: string;
  role: string;
  createdAt: number;
  lastActiveAt?: number;
};

type OrgDetail = {
  org: {
    _id: string;
    name: string;
    slug: string;
    description?: string;
    schoolType?: string;
    country?: string;
    timezone?: string;
    maxStudents?: number;
    tokenBudgetDaily: number;
    isActive?: boolean;
    soulEnabled?: boolean;
    adaptiveQuizEnabled?: boolean;
    spacedRepetitionEnabled?: boolean;
    allowPaidModels?: boolean;
    createdAt: number;
    logoUrl?: string;
  };
  members: Member[];
};

type TabId = "overview" | "members" | "usage" | "settings" | "soul";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <Building2 className="h-3.5 w-3.5" /> },
  { id: "members", label: "Members", icon: <Users className="h-3.5 w-3.5" /> },
  { id: "usage", label: "Usage", icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { id: "settings", label: "Settings", icon: <Settings className="h-3.5 w-3.5" /> },
  { id: "soul", label: "SOUL", icon: <BookOpen className="h-3.5 w-3.5" /> },
];

function formatDate(ts?: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    admin: "bg-[color-mix(in_oklab,var(--accent-cyan)_15%,transparent)] text-[var(--accent-cyan)]",
    teacher: "bg-[color-mix(in_oklab,var(--success)_15%,transparent)] text-[var(--success)]",
    student: "bg-[color-mix(in_oklab,var(--text-secondary)_12%,transparent)] text-[var(--text-secondary)]",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[role] ?? colors.student}`}>
      {role}
    </span>
  );
}

// ---- Overview Tab ----
function OverviewTab({ data }: { data: OrgDetail }) {
  const { org, members } = data;
  const students = members.filter((m) => m.role === "student").length;
  const teachers = members.filter((m) => m.role === "teacher").length;
  const admins = members.filter((m) => m.role === "admin").length;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total Members", value: members.length },
          { label: "Students", value: students },
          { label: "Teachers", value: teachers },
          { label: "Admins", value: admins },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">{stat.label}</p>
            <p className="mt-1 font-display text-2xl text-[var(--text-primary)]">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-5">
        <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">School Info</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { label: "Name", value: org.name },
            { label: "Slug", value: org.slug },
            { label: "Type", value: org.schoolType ?? "—" },
            { label: "Country", value: org.country ?? "—" },
            { label: "Timezone", value: org.timezone ?? "—" },
            { label: "Max Students", value: org.maxStudents?.toLocaleString() ?? "Unlimited" },
            { label: "Daily Token Budget", value: org.tokenBudgetDaily.toLocaleString() },
            { label: "Created", value: formatDate(org.createdAt) },
          ].map((row) => (
            <div key={row.label} className="flex items-baseline gap-2">
              <span className="text-xs text-[var(--text-secondary)] min-w-[120px]">{row.label}:</span>
              <span className="text-sm font-medium text-[var(--text-primary)]">{row.value}</span>
            </div>
          ))}
        </div>
        {org.description && (
          <div className="mt-3 border-t border-[var(--border-default)] pt-3">
            <p className="text-xs text-[var(--text-secondary)]">Description</p>
            <p className="mt-1 text-sm text-[var(--text-primary)]">{org.description}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Members Tab ----
function MembersTab({ members }: { members: Member[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border-default)]">
      {members.length === 0 ? (
        <p className="p-6 text-center text-sm text-[var(--text-secondary)]">No members yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--border-default)] bg-[var(--bg-secondary)]">
                {["Name", "Email", "Role", "Joined", "Last Active"].map((h) => (
                  <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <tr
                  key={m._id}
                  className={`border-b border-[var(--border-default)] ${i === members.length - 1 ? "border-b-0" : ""}`}
                >
                  <td className="px-5 py-3.5 font-medium text-[var(--text-primary)]">{m.name}</td>
                  <td className="px-5 py-3.5 text-[var(--text-secondary)]">{m.email}</td>
                  <td className="px-5 py-3.5"><RoleBadge role={m.role} /></td>
                  <td className="px-5 py-3.5 text-xs text-[var(--text-secondary)]">{formatDate(m.createdAt)}</td>
                  <td className="px-5 py-3.5 text-xs text-[var(--text-secondary)]">{formatDate(m.lastActiveAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Usage Tab ----
function UsageTab() {
  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-8 text-center">
      <BarChart3 className="mx-auto mb-3 h-10 w-10 text-[var(--text-secondary)]" />
      <p className="text-sm text-[var(--text-secondary)]">
        Usage analytics charts coming soon.
      </p>
    </div>
  );
}

// ---- Settings Tab ----
function SettingsTab({ data, orgId, onSaved }: { data: OrgDetail; orgId: string; onSaved: () => void }) {
  const { org } = data;
  const [name, setName] = useState(org.name);
  const [description, setDescription] = useState(org.description ?? "");
  const [tokenBudget, setTokenBudget] = useState(String(org.tokenBudgetDaily));
  const [isActive, setIsActive] = useState(org.isActive !== false);
  const [soulEnabled, setSoulEnabled] = useState(org.soulEnabled ?? false);
  const [adaptiveQuiz, setAdaptiveQuiz] = useState(org.adaptiveQuizEnabled ?? false);
  const [spacedRep, setSpacedRep] = useState(org.spacedRepetitionEnabled ?? false);
  const [allowPaid, setAllowPaid] = useState(org.allowPaidModels ?? false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const response = await fetch(`/api/super-admin/schools/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          tokenBudgetDaily: parseInt(tokenBudget, 10),
          isActive,
          soulEnabled,
          adaptiveQuizEnabled: adaptiveQuiz,
          spacedRepetitionEnabled: spacedRep,
          allowPaidModels: allowPaid,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      toast.success("Settings saved");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "h-10 w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] outline-none transition focus:ring-2 focus:ring-[var(--accent-cyan)]";

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-5">
        <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">General</h3>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">School Name</label>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Description</label>
            <textarea
              className="min-h-[80px] w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:ring-2 focus:ring-[var(--accent-cyan)]"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Daily Token Budget</label>
            <input className={inputClass} type="number" min="1000" value={tokenBudget} onChange={(e) => setTokenBudget(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-5">
        <h3 className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Feature Flags</h3>
        <div className="space-y-3">
          {[
            { label: "School active", desc: "Disable to prevent all logins", value: isActive, onChange: setIsActive },
            { label: "School Soul", desc: "Inject Soul guidance at runtime", value: soulEnabled, onChange: setSoulEnabled },
            { label: "Adaptive quiz difficulty", desc: "SM-2 adaptive quiz mode", value: adaptiveQuiz, onChange: setAdaptiveQuiz },
            { label: "Spaced repetition", desc: "Flashcard spaced repetition scheduling", value: spacedRep, onChange: setSpacedRep },
            { label: "Allow paid models", desc: "Let users access premium AI models", value: allowPaid, onChange: setAllowPaid },
          ].map((toggle) => (
            <div key={toggle.label} className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">{toggle.label}</p>
                <p className="text-xs text-[var(--text-secondary)]">{toggle.desc}</p>
              </div>
              <Switch checked={toggle.value} onCheckedChange={toggle.onChange} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => void handleSave()} disabled={saving} className="cursor-pointer">
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

// ---- SOUL Tab ----
function SoulTab({ data }: { data: OrgDetail }) {
  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-8 text-center">
      <BookOpen className="mx-auto mb-3 h-10 w-10 text-[var(--text-secondary)]" />
      <p className="mb-3 text-sm text-[var(--text-secondary)]">
        Manage this school&apos;s Soul docs via the School Admin SOUL page.
      </p>
      <p className="text-xs text-[var(--text-secondary)]">School: {data.org.name}</p>
    </div>
  );
}

// ---- Main Page ----
export default function SchoolDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : (params.id as string[])[0] ?? "";

  const [data, setData] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/super-admin/schools/${id}`);
      if (!response.ok) throw new Error(await response.text());
      const result = (await response.json()) as OrgDetail;
      setData(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load school");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Breadcrumb + Header */}
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Link href="/super-admin" className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition">
              Super Admin
            </Link>
            <span className="text-xs text-[var(--text-secondary)]">/</span>
            <Link href="/super-admin/schools" className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition">
              Schools
            </Link>
            <span className="text-xs text-[var(--text-secondary)]">/</span>
            <span className="text-xs text-[var(--text-primary)]">{loading ? "..." : (data?.org.name ?? id)}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-3xl text-[var(--text-primary)]">
                {loading ? "Loading..." : (data?.org.name ?? "School")}
              </h1>
              {data?.org.slug && (
                <p className="mt-0.5 font-mono text-sm text-[var(--text-secondary)]">/{data.org.slug}</p>
              )}
            </div>
            {data && (
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
                  data.org.isActive !== false
                    ? "bg-[color-mix(in_oklab,var(--success)_15%,transparent)] text-[var(--success)]"
                    : "bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] text-[var(--danger)]"
                }`}
              >
                {data.org.isActive !== false ? "Active" : "Inactive"}
              </span>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1.5 shadow-[var(--shadow-soft)]">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-sm transition ${
                activeTab === tab.id
                  ? "bg-[var(--bg-primary)] font-semibold text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-sm text-[var(--text-secondary)]">
            Loading...
          </div>
        ) : !data ? (
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-8 text-center text-sm text-[var(--text-secondary)]">
            School not found.
          </div>
        ) : (
          <>
            {activeTab === "overview" && <OverviewTab data={data} />}
            {activeTab === "members" && <MembersTab members={data.members} />}
            {activeTab === "usage" && <UsageTab />}
            {activeTab === "settings" && (
              <SettingsTab data={data} orgId={id} onSaved={() => void load()} />
            )}
            {activeTab === "soul" && <SoulTab data={data} />}
          </>
        )}
      </div>
    </AppShell>
  );
}
