"use client";

import {
  Building2,
  Check,
  Copy,
  Globe2,
  Inbox,
  Link2,
  Loader2,
  Search,
  Share2,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getSpectraShareState,
  getSpectraPublicLinks,
  getSpectraInheritedAudience,
  getSpectraArtifactAccessRequests,
  postSpectra,
  searchSpectraSchoolMembers,
  type SpectraSchoolMember,
  type SpectraPublicLinkEntry,
  type SpectraInheritedAccessEntry,
  type SpectraArtifactAccessRequest,
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
  const [publicLinks, setPublicLinks] = useState<SpectraPublicLinkEntry[]>([]);
  const [inheritedAudience, setInheritedAudience] = useState<
    SpectraInheritedAccessEntry[]
  >([]);
  const [accessRequests, setAccessRequests] = useState<
    SpectraArtifactAccessRequest[]
  >([]);
  const [requestLevels, setRequestLevels] = useState<
    Record<string, ShareLevel>
  >({});
  const [publicExpiry, setPublicExpiry] = useState<"never" | "7d" | "30d">(
    "never",
  );
  const [createdPublicUrl, setCreatedPublicUrl] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [level, setLevel] = useState<ShareLevel>("read");
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const searchSequence = useRef(0);

  const refresh = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const [shareResult, linkResult, inheritedResult, requestResult] =
          await Promise.all([
            getSpectraShareState(resourceType, resourceId),
            getSpectraPublicLinks(resourceType, resourceId),
            resourceType === "workspace"
              ? Promise.resolve({ audience: [] })
              : getSpectraInheritedAudience(resourceId),
            resourceType === "workspace"
              ? Promise.resolve({ requests: [] })
              : getSpectraArtifactAccessRequests(resourceId),
          ]);
        setShares(shareResult.shares);
        setPublicLinks(linkResult.publicLinks);
        setInheritedAudience(inheritedResult.audience);
        setAccessRequests(requestResult.requests);
        setRequestLevels(
          Object.fromEntries(
            requestResult.requests.map((request) => [
              request.requestId,
              request.requestedLevel,
            ]),
          ),
        );
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not load sharing access.",
        );
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [resourceId, resourceType],
  );

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setMembers([]);
    setNote("");
    setLevel("read");
    setPublicExpiry("never");
    setCreatedPublicUrl(null);
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    const interval = window.setInterval(refreshVisible, 8_000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
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
      void searchSpectraSchoolMembers(needle)
        .then((result) => {
          if (sequence === searchSequence.current) setMembers(result.members);
        })
        .catch((error) => {
          if (sequence === searchSequence.current)
            toast.error(
              error instanceof Error
                ? error.message
                : "Could not search school members.",
            );
        })
        .finally(() => {
          if (sequence === searchSequence.current) setSearching(false);
        });
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [open, search]);

  const existingAccountIds = useMemo(
    () =>
      new Set(
        shares.flatMap((share) =>
          share.account ? [share.account.accountId] : [],
        ),
      ),
    [shares],
  );
  const availableMembers = members.filter(
    (member) => !existingAccountIds.has(member.accountId),
  );

  async function invite(member: SpectraSchoolMember) {
    setBusyKey(`invite:${member.accountId}`);
    try {
      await postSpectra({
        action: "inviteShare",
        resourceType,
        resourceId,
        inviteeAccountId: member.accountId,
        level,
        message: note.trim() || undefined,
      });
      toast.success(`Invitation sent to ${member.name}.`);
      setSearch("");
      setMembers([]);
      setNote("");
      await refresh();
      await onChanged?.();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not send the invitation.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function changeLevel(share: SpectraShareEntry, nextLevel: ShareLevel) {
    if (share.level === nextLevel || share.status !== "accepted") return;
    setBusyKey(`level:${share.invitationId}`);
    try {
      await postSpectra({
        action: "changeShareLevel",
        invitationId: share.invitationId,
        level: nextLevel,
      });
      await refresh();
      await onChanged?.();
      toast.success("Access updated.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update access.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function removeShare(share: SpectraShareEntry) {
    setBusyKey(`remove:${share.invitationId}`);
    try {
      if (share.status === "pending") {
        await postSpectra({
          action: "revokePendingShareInvitation",
          invitationId: share.invitationId,
        });
      } else if (share.grantId) {
        await postSpectra({
          action: "revokeShareAccess",
          resourceType,
          resourceId,
          grantId: share.grantId,
        });
      }
      await refresh();
      await onChanged?.();
      toast.success(
        share.status === "pending"
          ? "Invitation withdrawn."
          : "Access removed.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove access.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function resolveAccessRequest(
    request: SpectraArtifactAccessRequest,
    decision: "approve" | "decline",
  ) {
    setBusyKey(`request:${request.requestId}`);
    try {
      await postSpectra({
        action: "resolveArtifactAccessRequest",
        requestId: request.requestId,
        decision,
        ...(decision === "approve"
          ? {
              level: requestLevels[request.requestId] ?? request.requestedLevel,
            }
          : {}),
      });
      await refresh();
      await onChanged?.();
      toast.success(
        decision === "approve" ? "Access granted." : "Access request declined.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not resolve this access request.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function createPublicLink() {
    setBusyKey("public:create");
    try {
      const expiresAt =
        publicExpiry === "never"
          ? undefined
          : Date.now() + (publicExpiry === "7d" ? 7 : 30) * 24 * 60 * 60 * 1000;
      const result = await postSpectra<{ url: string }>({
        action: "createPublicLink",
        resourceType,
        resourceId,
        expiresAt,
      });
      setCreatedPublicUrl(
        new URL(result.url, window.location.origin).toString(),
      );
      await refresh();
      await onChanged?.();
      toast.success("Public read-only access is on.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not create public access.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function revokePublicLink(link: SpectraPublicLinkEntry) {
    setBusyKey(`public:${link.linkId}`);
    try {
      await postSpectra({ action: "revokePublicLink", linkId: link.linkId });
      setCreatedPublicUrl(null);
      await refresh();
      await onChanged?.();
      toast.success("Public access removed.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not remove public access.",
      );
    } finally {
      setBusyKey(null);
    }
  }

  async function copyPublicLink() {
    if (!createdPublicUrl) return;
    try {
      await navigator.clipboard.writeText(createdPublicUrl);
      toast.success("Public link copied.");
    } catch {
      toast.error("Could not copy the link. Select it and copy it manually.");
    }
  }

  async function setInheritedAccess(
    entry: SpectraInheritedAccessEntry,
    next: "default" | "read" | "none",
  ) {
    setBusyKey(`inherited:${entry.account.accountId}`);
    try {
      if (next === "default") {
        await postSpectra({
          action: "clearArtifactAccessException",
          artifactId: resourceId,
          accountId: entry.account.accountId,
        });
      } else {
        await postSpectra({
          action: "setArtifactAccessException",
          artifactId: resourceId,
          accountId: entry.account.accountId,
          effect: next === "none" ? "deny" : "restrict",
        });
      }
      await refresh();
      await onChanged?.();
      toast.success(
        next === "none"
          ? "Workspace access removed for this artifact."
          : next === "read"
            ? "Access limited to read-only for this artifact."
            : "Workspace access restored for this artifact.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update inherited access.",
      );
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
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[color-mix(in_oklab,var(--text-primary)_18%,transparent)] p-4 backdrop-blur-[2px]"
      onPointerDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        className="flex max-h-[min(720px,calc(100vh-32px))] w-full max-w-[560px] flex-col overflow-hidden rounded-[13px] border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[0_28px_90px_rgba(27,20,12,0.24)]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-[var(--border-default)] px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[color-mix(in_oklab,var(--brand-primary)_9%,var(--bg-secondary))] text-[var(--brand-primary)]">
              <Share2 className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2
                id="share-dialog-title"
                className="font-display text-[21px] font-semibold text-[var(--text-primary)]"
              >
                Share {title}
              </h2>
              <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                Invite members of your school. They decide whether to accept
                before this appears in Shared.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            aria-label="Close sharing"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto px-5 py-4">
          <label
            className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]"
            htmlFor="share-member-search"
          >
            Invite someone
          </label>
          <div className="mt-2 flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                id="share-member-search"
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search school members by name or email"
                className="h-10 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] pl-9 pr-9 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
              />
              {searching ? (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--text-tertiary)]" />
              ) : null}
            </div>
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value as ShareLevel)}
              className="h-10 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-[12px] font-medium text-[var(--text-primary)] outline-none"
              aria-label="Invitation permission"
            >
              <option value="read">Read-only</option>
              <option value="modify">Can modify</option>
            </select>
          </div>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 500))}
            placeholder="Add a note (optional)"
            className="mt-2 h-9 w-full rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]"
          />

          {search.trim().length >= 2 ? (
            <div className="mt-2 overflow-hidden rounded-[8px] border border-[var(--border-default)]">
              {availableMembers.map((member) => (
                <div
                  key={member.accountId}
                  className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-3 py-2.5 last:border-b-0"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-[11px] font-semibold text-[var(--text-secondary)]">
                    {member.name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((part) => part[0])
                      .join("")
                      .toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                      {member.name}
                    </div>
                    <div className="truncate text-[11px] text-[var(--text-tertiary)]">
                      {member.email}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={busyKey === `invite:${member.accountId}`}
                    onClick={() => void invite(member)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[var(--border-default)] px-2.5 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-45"
                  >
                    {busyKey === `invite:${member.accountId}` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <UserPlus className="h-3.5 w-3.5" />
                    )}
                    Invite
                  </button>
                </div>
              ))}
              {!searching && availableMembers.length === 0 ? (
                <p className="px-3 py-4 text-center text-[12px] text-[var(--text-secondary)]">
                  No available school member matches that search.
                </p>
              ) : null}
            </div>
          ) : null}

          {accessRequests.length > 0 ? (
            <section
              className="mt-6 rounded-[10px] border border-[color-mix(in_oklab,var(--brand-primary)_24%,var(--border-default))] bg-[color-mix(in_oklab,var(--brand-primary)_4%,var(--bg-primary))]"
              aria-labelledby="access-requests-title"
            >
              <div className="flex items-start gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--bg-elevated)] text-[var(--brand-primary)]">
                  <Inbox className="h-4 w-4" />
                </span>
                <div>
                  <h3
                    id="access-requests-title"
                    className="text-[12px] font-semibold text-[var(--text-primary)]"
                  >
                    Access requests
                  </h3>
                  <p className="mt-0.5 text-[10px] leading-4 text-[var(--text-secondary)]">
                    People who encountered this artifact through a permitted
                    embed. Approval gives direct access immediately.
                  </p>
                </div>
              </div>
              <div>
                {accessRequests.map((request) => {
                  const working = busyKey === `request:${request.requestId}`;
                  return (
                    <article
                      key={request.requestId}
                      className="border-b border-[var(--border-subtle)] px-4 py-3 last:border-b-0"
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[10px] font-semibold text-[var(--text-secondary)]">
                          {request.requester?.name
                            .split(/\s+/)
                            .slice(0, 2)
                            .map((part) => part[0])
                            .join("")
                            .toUpperCase() ?? "?"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                            {request.requester?.name ?? "Unavailable member"}
                          </div>
                          <div className="mt-0.5 text-[9px] text-[var(--text-tertiary)]">
                            Requested{" "}
                            {new Date(request.createdAt).toLocaleString()}
                            {request.context
                              ? ` · From an embedded ${request.context.containerType}`
                              : ""}
                          </div>
                          {request.message ? (
                            <p className="mt-2 rounded-[6px] bg-[var(--bg-elevated)] px-2.5 py-2 text-[10px] leading-4 text-[var(--text-secondary)]">
                              {request.message}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                        <select
                          value={
                            requestLevels[request.requestId] ??
                            request.requestedLevel
                          }
                          disabled={working}
                          onChange={(event) =>
                            setRequestLevels((current) => ({
                              ...current,
                              [request.requestId]: event.target
                                .value as ShareLevel,
                            }))
                          }
                          aria-label={`Permission for ${request.requester?.name ?? "requester"}`}
                          className="h-8 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-[10px] text-[var(--text-primary)]"
                        >
                          <option value="read">Read-only</option>
                          <option value="modify">Can modify</option>
                        </select>
                        <button
                          type="button"
                          disabled={working}
                          onClick={() =>
                            void resolveAccessRequest(request, "decline")
                          }
                          className="h-8 rounded-[7px] px-2.5 text-[10px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-45"
                        >
                          Decline
                        </button>
                        <button
                          type="button"
                          disabled={working}
                          onClick={() =>
                            void resolveAccessRequest(request, "approve")
                          }
                          className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-[var(--text-primary)] px-3 text-[10px] font-semibold text-[var(--bg-primary)] disabled:opacity-45"
                        >
                          {working ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          Approve
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          <div className="mt-6 flex items-center justify-between">
            <h3 className="text-[12px] font-semibold text-[var(--text-primary)]">
              People with access
            </h3>
            <span className="text-[11px] text-[var(--text-tertiary)]">
              {shares.length} {shares.length === 1 ? "person" : "people"}
            </span>
          </div>
          <div className="mt-2 overflow-hidden rounded-[8px] border border-[var(--border-default)]">
            {loading ? (
              <div className="flex h-20 items-center justify-center">
                <Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" />
              </div>
            ) : shares.length === 0 ? (
              <p className="px-4 py-5 text-center text-[12px] leading-5 text-[var(--text-secondary)]">
                Only you have access. Search above to invite a collaborator.
              </p>
            ) : (
              shares.map((share) => (
                <div
                  key={share.invitationId}
                  className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-3 py-2.5 last:border-b-0"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-[11px] font-semibold text-[var(--text-secondary)]">
                    {share.account?.name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((part) => part[0])
                      .join("")
                      .toUpperCase() ?? "?"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                      {share.account?.name ?? "Unavailable member"}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-tertiary)]">
                      {share.status === "pending" ? (
                        "Invitation pending"
                      ) : (
                        <>
                          <Check className="h-3 w-3 text-[var(--success)]" />
                          Accepted
                        </>
                      )}
                    </div>
                  </div>
                  {share.status === "accepted" ? (
                    <select
                      value={share.level}
                      disabled={busyKey === `level:${share.invitationId}`}
                      onChange={(event) =>
                        void changeLevel(
                          share,
                          event.target.value as ShareLevel,
                        )
                      }
                      className="h-8 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-[11px] text-[var(--text-primary)]"
                    >
                      <option value="read">Read-only</option>
                      <option value="modify">Can modify</option>
                    </select>
                  ) : (
                    <span className="rounded-[5px] bg-[var(--bg-secondary)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
                      {share.level === "modify" ? "Can modify" : "Read-only"}
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={busyKey === `remove:${share.invitationId}`}
                    onClick={() => void removeShare(share)}
                    className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-tertiary)] hover:bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-elevated))] hover:text-[var(--danger)] disabled:opacity-45"
                    aria-label={
                      share.status === "pending"
                        ? "Withdraw invitation"
                        : "Remove access"
                    }
                  >
                    {busyKey === `remove:${share.invitationId}` ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              ))
            )}
          </div>

          {resourceType !== "workspace" && inheritedAudience.length > 0 ? (
            <section className="mt-6" aria-labelledby="workspace-access-title">
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--bg-secondary)] text-[var(--text-secondary)]">
                  <Building2 className="h-4 w-4" />
                </span>
                <div>
                  <h3
                    id="workspace-access-title"
                    className="text-[12px] font-semibold text-[var(--text-primary)]"
                  >
                    Access through workspaces
                  </h3>
                  <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">
                    These people inherit access from a workspace containing this
                    artifact. You can narrow or remove it here without changing
                    the workspace.
                  </p>
                </div>
              </div>
              <div className="mt-3 overflow-hidden rounded-[8px] border border-[var(--border-default)]">
                {inheritedAudience.map((entry) => {
                  const selected =
                    entry.exception?.effect === "deny"
                      ? "none"
                      : entry.exception?.effect === "restrict"
                        ? "read"
                        : "default";
                  return (
                    <div
                      key={entry.account.accountId}
                      className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-3 py-3 last:border-b-0"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-[10px] font-semibold text-[var(--text-secondary)]">
                        {entry.account.name
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")
                          .toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                          {entry.account.name}
                        </div>
                        <div className="mt-0.5 truncate text-[9px] text-[var(--text-tertiary)]">
                          Through{" "}
                          {entry.sources
                            .map((source) => source.workspaceTitle)
                            .join(", ")}
                          {entry.directLevel
                            ? ` · Direct ${entry.directLevel === "modify" ? "modify" : "read-only"} access also applies`
                            : ""}
                        </div>
                      </div>
                      <select
                        value={selected}
                        disabled={
                          busyKey === `inherited:${entry.account.accountId}`
                        }
                        onChange={(event) =>
                          void setInheritedAccess(
                            entry,
                            event.target.value as "default" | "read" | "none",
                          )
                        }
                        aria-label={`Access to this artifact for ${entry.account.name}`}
                        className="h-8 max-w-[160px] rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-[10px] text-[var(--text-primary)] outline-none"
                      >
                        <option value="default">
                          Workspace default (
                          {entry.inheritedLevel === "modify"
                            ? "Can modify"
                            : "Read-only"}
                          )
                        </option>
                        {entry.inheritedLevel === "modify" ? (
                          <option value="read">Read-only here</option>
                        ) : null}
                        <option value="none">No access here</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section
            className="mt-6 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-primary)] p-4"
            aria-labelledby="public-access-title"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[color-mix(in_oklab,var(--brand-primary)_8%,var(--bg-secondary))] text-[var(--brand-primary)]">
                <Globe2 className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3
                    id="public-access-title"
                    className="text-[12px] font-semibold text-[var(--text-primary)]"
                  >
                    Public access
                  </h3>
                  <span className="rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-[9px] font-medium text-[var(--text-tertiary)]">
                    Explicit
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">
                  Anyone with a public link can view a read-only copy. They
                  cannot edit, comment, collaborate, or see private context.
                </p>
              </div>
            </div>
            {createdPublicUrl ? (
              <div className="mt-4 rounded-[8px] border border-[color-mix(in_oklab,var(--success)_30%,var(--border-default))] bg-[color-mix(in_oklab,var(--success)_5%,var(--bg-elevated))] p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--success)]">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  New link ready
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    readOnly
                    value={createdPublicUrl}
                    onFocus={(event) => event.currentTarget.select()}
                    aria-label="New public link"
                    className="h-9 min-w-0 flex-1 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-[11px] text-[var(--text-secondary)] outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void copyPublicLink()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-[7px] bg-[var(--text-primary)] px-3 text-[10px] font-semibold text-[var(--bg-primary)]"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </button>
                </div>
                <p className="mt-2 text-[9px] leading-4 text-[var(--text-tertiary)]">
                  For security, Spectra shows the complete address only when it
                  is created.
                </p>
              </div>
            ) : null}
            {publicLinks.length > 0 ? (
              <div className="mt-4 space-y-2">
                {publicLinks.map((link) => (
                  <div
                    key={link.linkId}
                    className="flex items-center gap-3 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5"
                  >
                    <Link2 className="h-3.5 w-3.5 text-[var(--brand-primary)]" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium text-[var(--text-primary)]">
                        Public read-only link
                      </div>
                      <div className="text-[9px] text-[var(--text-tertiary)]">
                        {link.expiresAt
                          ? `Expires ${new Date(link.expiresAt).toLocaleDateString()}`
                          : "Does not expire"}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busyKey === `public:${link.linkId}`}
                      onClick={() => void revokePublicLink(link)}
                      className="h-7 rounded-[6px] px-2 text-[10px] font-medium text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_7%,var(--bg-elevated))] disabled:opacity-45"
                    >
                      {busyKey === `public:${link.linkId}` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        "Remove"
                      )}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-[8px] border border-dashed border-[var(--border-default)] px-3 py-3 text-[10px] text-[var(--text-tertiary)]">
                Public access is off. This item remains private unless you
                explicitly create a link.
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <label
                className="text-[10px] text-[var(--text-tertiary)]"
                htmlFor="public-expiry"
              >
                Expiry
              </label>
              <select
                id="public-expiry"
                value={publicExpiry}
                onChange={(event) =>
                  setPublicExpiry(event.target.value as typeof publicExpiry)
                }
                className="h-8 rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-[10px] text-[var(--text-primary)]"
              >
                <option value="never">Never</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
              </select>
              <button
                type="button"
                disabled={busyKey === "public:create"}
                onClick={() => void createPublicLink()}
                className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3 text-[10px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-45"
              >
                {busyKey === "public:create" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                {publicLinks.length > 0
                  ? "Create another"
                  : "Create public link"}
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
