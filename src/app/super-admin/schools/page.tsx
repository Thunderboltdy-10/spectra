"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Plus, Search } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type OrgRow = {
  _id: string;
  name: string;
  slug: string;
  schoolType?: string;
  memberCount: number;
  isActive?: boolean;
  createdAt: number;
};

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        active
          ? "bg-[color-mix(in_oklab,var(--success)_15%,transparent)] text-[var(--success)]"
          : "bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] text-[var(--danger)]"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function TypeBadge({ type }: { type?: string }) {
  if (!type) return <span className="text-[var(--text-secondary)]">—</span>;
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-0.5 text-xs text-[var(--text-secondary)]">
      {type}
    </span>
  );
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function SchoolsListPage() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/super-admin/schools");
        if (!response.ok) throw new Error(await response.text());
        const data = (await response.json()) as { orgs: OrgRow[] };
        setOrgs(data.orgs ?? []);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load schools");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.slug.toLowerCase().includes(q) ||
        (o.schoolType ?? "").toLowerCase().includes(q),
    );
  }, [orgs, search]);

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Link
                href="/super-admin"
                className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
              >
                Super Admin
              </Link>
              <span className="text-xs text-[var(--text-secondary)]">/</span>
              <span className="text-xs text-[var(--text-primary)]">Schools</span>
            </div>
            <h1 className="font-display text-3xl text-[var(--text-primary)]">All Schools</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {loading ? "Loading..." : `${orgs.length} school${orgs.length !== 1 ? "s" : ""} registered`}
            </p>
          </div>
          <Link href="/super-admin/schools/new">
            <Button className="cursor-pointer gap-2">
              <Plus className="h-4 w-4" />
              Create School
            </Button>
          </Link>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-secondary)]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, slug or type..."
            className="pl-10"
          />
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-card)]">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-sm text-[var(--text-secondary)]">
              Loading schools...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20">
              <Building2 className="h-10 w-10 text-[var(--text-secondary)]" />
              <p className="text-sm text-[var(--text-secondary)]">
                {search ? "No schools match your search." : "No schools yet."}
              </p>
              {!search && (
                <Link href="/super-admin/schools/new">
                  <Button className="cursor-pointer gap-2" variant="secondary">
                    <Plus className="h-4 w-4" />
                    Create first school
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-default)] bg-[var(--bg-secondary)]">
                    <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                      Name
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                      Slug
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                      Type
                    </th>
                    <th className="px-5 py-3.5 text-right text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                      Members
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                      Status
                    </th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((org, i) => (
                    <tr
                      key={org._id}
                      className={`cursor-pointer border-b border-[var(--border-default)] transition hover:bg-[var(--bg-hover)] ${
                        i === filtered.length - 1 ? "border-b-0" : ""
                      }`}
                      onClick={() => router.push(`/super-admin/schools/${org._id}`)}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)] text-[var(--accent-cyan)]">
                            <Building2 className="h-4 w-4" />
                          </div>
                          <span className="font-medium text-[var(--text-primary)]">{org.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="font-mono text-xs text-[var(--text-secondary)]">{org.slug}</span>
                      </td>
                      <td className="px-5 py-4">
                        <TypeBadge type={org.schoolType} />
                      </td>
                      <td className="px-5 py-4 text-right font-medium text-[var(--text-primary)]">
                        {org.memberCount.toLocaleString()}
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge active={org.isActive !== false} />
                      </td>
                      <td className="px-5 py-4 text-xs text-[var(--text-secondary)]">
                        {formatDate(org.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
