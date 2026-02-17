"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ChevronLeft,
  Clock,
  MailPlus,
  RefreshCw,
  Search,
  Trash2,
  UserCheck,
  X,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Member = {
  _id: string;
  name: string;
  email: string;
  role: "student" | "teacher" | "admin";
  createdAt: number;
  lastActiveAt?: number;
};

type Invitation = {
  _id: string;
  email: string;
  role: string;
  status: string;
  createdAt: number;
  expiresAt: number;
};

function RoleBadge({ role }: { role: string }) {
  const color: Record<string, string> = {
    admin: "bg-[color-mix(in_oklab,var(--accent-cyan)_14%,transparent)] text-[var(--accent-cyan)]",
    teacher: "bg-[color-mix(in_oklab,var(--success)_14%,transparent)] text-[var(--success)]",
    student: "bg-[color-mix(in_oklab,var(--text-secondary)_10%,transparent)] text-[var(--text-secondary)]",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${color[role] ?? color.student}`}>
      {role}
    </span>
  );
}

function formatDate(ts?: number) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function timeAgo(ts: number) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return "Just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

// ---- Invite Dialog ----
function InviteDialog({ onClose, onInvited }: { onClose: () => void; onInvited: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"student" | "teacher">("student");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || !email.includes("@")) { toast.error("Enter a valid email"); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/school-admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      if (!response.ok) throw new Error(await response.text());
      toast.success(`Invitation sent to ${email}`);
      onInvited();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send invitation");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-overlay)]">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-hover)]">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Invite Member</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-[var(--bg-hover)]"
          >
            <X className="h-4 w-4 text-[var(--text-secondary)]" />
          </button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              Email Address
            </label>
            <Input
              type="email"
              placeholder="student@school.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              Role
            </label>
            <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="student">Student</SelectItem>
                <SelectItem value="teacher">Teacher</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1 cursor-pointer">
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="flex-1 cursor-pointer">
              {saving ? "Sending..." : "Send Invitation"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- Confirm Remove Dialog ----
function ConfirmRemoveDialog({ member, onClose, onRemoved }: { member: Member; onClose: () => void; onRemoved: () => void }) {
  const [removing, setRemoving] = useState(false);

  async function handleRemove() {
    setRemoving(true);
    try {
      const response = await fetch("/api/school-admin/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", userId: member._id }),
      });
      if (!response.ok) throw new Error(await response.text());
      toast.success(`${member.name} removed`);
      onRemoved();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove member");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--bg-overlay)]">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-hover)]">
        <h2 className="mb-2 text-lg font-semibold text-[var(--text-primary)]">Remove Member</h2>
        <p className="mb-5 text-sm text-[var(--text-secondary)]">
          Remove <strong className="text-[var(--text-primary)]">{member.name}</strong> ({member.email}) from your school?
          This action cannot be undone.
        </p>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} className="flex-1 cursor-pointer">
            Cancel
          </Button>
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={removing}
            className="flex-1 cursor-pointer rounded-xl bg-[var(--danger)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {removing ? "Removing..." : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SchoolMembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/school-admin/members${search ? `?search=${encodeURIComponent(search)}` : ""}`);
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as {
        members: { members: Member[] };
        invitations: Invitation[];
      };
      setMembers(data.members.members ?? []);
      setInvitations(Array.isArray(data.invitations) ? data.invitations : []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load members");
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateRole(userId: string, role: string) {
    try {
      const response = await fetch("/api/school-admin/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
      if (!response.ok) throw new Error(await response.text());
      toast.success("Role updated");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update role");
    }
  }

  async function cancelInvite(invitationId: string) {
    try {
      const response = await fetch("/api/school-admin/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancelInvite", invitationId }),
      });
      if (!response.ok) throw new Error(await response.text());
      toast.success("Invitation cancelled");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel invitation");
    }
  }

  async function resendInvite(invitationId: string) {
    try {
      const response = await fetch("/api/school-admin/members", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resendInvite", invitationId }),
      });
      if (!response.ok) throw new Error(await response.text());
      toast.success("Invitation resent");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to resend invitation");
    }
  }

  return (
    <AppShell>
      {showInvite && (
        <InviteDialog
          onClose={() => setShowInvite(false)}
          onInvited={() => void load()}
        />
      )}
      {removeTarget && (
        <ConfirmRemoveDialog
          member={removeTarget}
          onClose={() => setRemoveTarget(null)}
          onRemoved={() => void load()}
        />
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Link href="/admin/school" className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition">
                <ChevronLeft className="h-3 w-3" /> School Admin
              </Link>
              <span className="text-xs text-[var(--text-secondary)]">/</span>
              <span className="text-xs text-[var(--text-primary)]">Members</span>
            </div>
            <h1 className="font-display text-3xl text-[var(--text-primary)]">Members</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {loading ? "Loading..." : `${members.length} member${members.length !== 1 ? "s" : ""}`}
            </p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Admin-role assignment is managed by Super Admin.
            </p>
          </div>
          <Button onClick={() => setShowInvite(true)} className="cursor-pointer gap-2">
            <MailPlus className="h-4 w-4" />
            Invite Member
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--text-secondary)]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="pl-10"
          />
        </div>

        {/* Members Table */}
        <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-card)]">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-[var(--text-secondary)]">
              Loading members...
            </div>
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <UserCheck className="h-10 w-10 text-[var(--text-secondary)]" />
              <p className="text-sm text-[var(--text-secondary)]">No members found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-default)] bg-[var(--bg-secondary)]">
                    {["Name", "Email", "Role", "Last Active", "Joined", ""].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {members.map((member, i) => (
                    <tr
                      key={member._id}
                      className={`border-b border-[var(--border-default)] transition hover:bg-[var(--bg-hover)] ${
                        i === members.length - 1 ? "border-b-0" : ""
                      }`}
                    >
                      <td className="px-5 py-4 font-medium text-[var(--text-primary)]">{member.name}</td>
                      <td className="px-5 py-4 text-[var(--text-secondary)]">{member.email}</td>
                      <td className="px-5 py-4">
                        {member.role === "admin" ? (
                          <RoleBadge role={member.role} />
                        ) : (
                          <Select
                            value={member.role}
                            onValueChange={(v) => void updateRole(member._id, v)}
                          >
                            <SelectTrigger className="h-8 w-[110px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="student">student</SelectItem>
                              <SelectItem value="teacher">teacher</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="px-5 py-4 text-xs text-[var(--text-secondary)]">
                        {member.lastActiveAt ? timeAgo(member.lastActiveAt) : "—"}
                      </td>
                      <td className="px-5 py-4 text-xs text-[var(--text-secondary)]">
                        {formatDate(member.createdAt)}
                      </td>
                      <td className="px-5 py-4">
                        <button
                          type="button"
                          onClick={() => setRemoveTarget(member)}
                          disabled={member.role === "admin"}
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[color-mix(in_oklab,var(--danger)_10%,transparent)] hover:text-[var(--danger)]"
                          aria-label="Remove member"
                          title={member.role === "admin" ? "Only super admin can remove admins" : "Remove member"}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pending Invitations */}
        {invitations.length > 0 && (
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
              <Clock className="h-3.5 w-3.5" />
              Pending Invitations ({invitations.length})
            </h2>
            <div className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[var(--shadow-card)]">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-default)] bg-[var(--bg-secondary)]">
                      {["Email", "Role", "Sent", "Expires", ""].map((h) => (
                        <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invitations.map((inv, i) => (
                      <tr
                        key={inv._id}
                        className={`border-b border-[var(--border-default)] ${i === invitations.length - 1 ? "border-b-0" : ""}`}
                      >
                        <td className="px-5 py-3.5 text-[var(--text-primary)]">{inv.email}</td>
                        <td className="px-5 py-3.5"><RoleBadge role={inv.role} /></td>
                        <td className="px-5 py-3.5 text-xs text-[var(--text-secondary)]">{formatDate(inv.createdAt)}</td>
                        <td className="px-5 py-3.5 text-xs text-[var(--text-secondary)]">{formatDate(inv.expiresAt)}</td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void resendInvite(inv._id)}
                              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)] hover:text-[var(--accent-cyan)]"
                              aria-label="Resend invitation"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void cancelInvite(inv._id)}
                              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[color-mix(in_oklab,var(--danger)_10%,transparent)] hover:text-[var(--danger)]"
                              aria-label="Cancel invitation"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="mt-2 text-xs text-[var(--text-secondary)]">
              Admin invitations and admin-role changes are managed by Super Admin.
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
