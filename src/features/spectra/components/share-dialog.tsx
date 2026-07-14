"use client";

import { Check, Loader2, Search, Share2, UserPlus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getSpectraShareState,
  postSpectra,
  searchSpectraSchoolMembers,
  type SpectraSchoolMember,
  type SpectraShareEntry,
} from "../data/api";

type ShareableResourceType = "workspace" | "artifact" | "agent";
type ShareLevel = "read" | "modify";

export function ShareDialog({
  open,
  resourceType,
  resourceId,
  title,
  onClose,
  onChanged,
}: {
  open: boolean;
  resourceType: ShareableResourceType;
  resourceId: string;
  title: string;
  onClose: () => void;
  onChanged?: () => void | Promise<void>;
}) {
  const [shares, setShares] = useState<SpectraShareEntry[]>([]);
  const [members, setMembers] = useState<SpectraSchoolMember[]>([]);
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [level, setLevel] = useState<ShareLevel>("read");
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const searchSequence = useRef(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getSpectraShareState(resourceType, resourceId);
      setShares(result.shares);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load sharing access.");
    } finally {
      setLoading(false);
    }
  }, [resourceId, resourceType]);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setMembers([]);
    setNote("");
    setLevel("read");
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const needle = search.trim();
    const sequence = ++searchSequence.current;
    if (needle.length < 2) {
      setMembers([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timeout = window.setTimeout(() => {
      void searchSpectraSchoolMembers(needle).then((result) => {
        if (sequence === searchSequence.current) setMembers(result.members);
      }).catch((error) => {
        if (sequence === searchSequence.current) toast.error(error instanceof Error ? error.message : "Could not search school members.");
      }).finally(() => {
        if (sequence === searchSequence.current) setSearching(false);
      });
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [open, search]);

  const existingAccountIds = useMemo(() => new Set(shares.flatMap((share) => share.account ? [share.account.accountId] : [])), [shares]);
  const availableMembers = members.filter((member) => !existingAccountIds.has(member.accountId));

  async function invite(member: SpectraSchoolMember) {
    setBusyKey(`invite:${member.accountId}`);
    try {
      await postSpectra({ action: "inviteShare", resourceType, resourceId, inviteeAccountId: member.accountId, level, message: note.trim() || undefined });
      toast.success(`Invitation sent to ${member.name}.`);
      setSearch("");
      setMembers([]);
      setNote("");
      await refresh();
      await onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send the invitation.");
    } finally {
      setBusyKey(null);
    }
  }

  async function changeLevel(share: SpectraShareEntry, nextLevel: ShareLevel) {
    if (share.level === nextLevel || share.status !== "accepted") return;
    setBusyKey(`level:${share.invitationId}`);
    try {
      await postSpectra({ action: "changeShareLevel", invitationId: share.invitationId, level: nextLevel });
      await refresh();
      await onChanged?.();
      toast.success("Access updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update access.");
    } finally {
      setBusyKey(null);
    }
  }

  async function removeShare(share: SpectraShareEntry) {
    setBusyKey(`remove:${share.invitationId}`);
    try {
      if (share.status === "pending") {
        await postSpectra({ action: "revokePendingShareInvitation", invitationId: share.invitationId });
      } else if (share.grantId) {
        await postSpectra({ action: "revokeShareAccess", resourceType, resourceId, grantId: share.grantId });
      }
      await refresh();
      await onChanged?.();
      toast.success(share.status === "pending" ? "Invitation withdrawn." : "Access removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove access.");
    } finally {
      setBusyKey(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[color-mix(in_oklab,var(--text-primary)_18%,transparent)] p-4 backdrop-blur-[2px]" onPointerDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="share-dialog-title" className="flex max-h-[min(720px,calc(100vh-32px))] w-full max-w-[560px] flex-col overflow-hidden rounded-[13px] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[0_28px_90px_rgba(27,20,12,0.24)]" onPointerDown={(event) => event.stopPropagation()}>
        <header className="flex items-start justify-between border-b border-[var(--border-default)] px-5 py-4"><div className="flex min-w-0 items-start gap-3"><span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[color-mix(in_oklab,var(--accent-cyan)_9%,var(--bg-secondary))] text-[var(--accent-cyan)]"><Share2 className="h-4 w-4" /></span><div className="min-w-0"><h2 id="share-dialog-title" className="font-display text-[21px] font-semibold text-[var(--text-primary)]">Share {title}</h2><p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">Invite members of your school. They decide whether to accept before this appears in Shared.</p></div></div><button type="button" onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" aria-label="Close sharing"><X className="h-4 w-4" /></button></header>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <label className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]" htmlFor="share-member-search">Invite someone</label>
          <div className="mt-2 flex gap-2"><div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" /><input id="share-member-search" autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search school members by name or email" className="h-10 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] pl-9 pr-9 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]" />{searching ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--text-tertiary)]" /> : null}</div><select value={level} onChange={(event) => setLevel(event.target.value as ShareLevel)} className="h-10 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-[12px] font-medium text-[var(--text-primary)] outline-none" aria-label="Invitation permission"><option value="read">Read-only</option><option value="modify">Can modify</option></select></div>
          <input value={note} onChange={(event) => setNote(event.target.value.slice(0, 500))} placeholder="Add a note (optional)" className="mt-2 h-9 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]" />

          {search.trim().length >= 2 ? <div className="mt-2 overflow-hidden rounded-[8px] border border-[var(--border-default)]">{availableMembers.map((member) => <div key={member.accountId} className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-3 py-2.5 last:border-b-0"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-[11px] font-semibold text-[var(--text-secondary)]">{member.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span><div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium text-[var(--text-primary)]">{member.name}</div><div className="truncate text-[11px] text-[var(--text-tertiary)]">{member.email}</div></div><button type="button" disabled={busyKey === `invite:${member.accountId}`} onClick={() => void invite(member)} className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[var(--border-default)] px-2.5 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-45">{busyKey === `invite:${member.accountId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}Invite</button></div>)}{!searching && availableMembers.length === 0 ? <p className="px-3 py-4 text-center text-[12px] text-[var(--text-secondary)]">No available school member matches that search.</p> : null}</div> : null}

          <div className="mt-6 flex items-center justify-between"><h3 className="text-[12px] font-semibold text-[var(--text-primary)]">People with access</h3><span className="text-[11px] text-[var(--text-tertiary)]">{shares.length} {shares.length === 1 ? "person" : "people"}</span></div>
          <div className="mt-2 overflow-hidden rounded-[8px] border border-[var(--border-default)]">{loading ? <div className="flex h-20 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" /></div> : shares.length === 0 ? <p className="px-4 py-5 text-center text-[12px] leading-5 text-[var(--text-secondary)]">Only you have access. Search above to invite a collaborator.</p> : shares.map((share) => <div key={share.invitationId} className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-3 py-2.5 last:border-b-0"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-[11px] font-semibold text-[var(--text-secondary)]">{share.account?.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() ?? "?"}</span><div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium text-[var(--text-primary)]">{share.account?.name ?? "Unavailable member"}</div><div className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">{share.status === "pending" ? "Invitation pending" : <><Check className="h-3 w-3 text-[var(--success)]" />Accepted</>}</div></div>{share.status === "accepted" ? <select value={share.level} disabled={busyKey === `level:${share.invitationId}`} onChange={(event) => void changeLevel(share, event.target.value as ShareLevel)} className="h-8 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-[11px] text-[var(--text-primary)]"><option value="read">Read-only</option><option value="modify">Can modify</option></select> : <span className="rounded-[5px] bg-[var(--bg-secondary)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">{share.level === "modify" ? "Can modify" : "Read-only"}</span>}<button type="button" disabled={busyKey === `remove:${share.invitationId}`} onClick={() => void removeShare(share)} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-elevated))] hover:text-[var(--danger)] disabled:opacity-45" aria-label={share.status === "pending" ? "Withdraw invitation" : "Remove access"}>{busyKey === `remove:${share.invitationId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}</button></div>)}</div>
        </div>
      </section>
    </div>
  );
}
