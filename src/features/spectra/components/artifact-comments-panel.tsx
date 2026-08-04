"use client";

import {
  Bell,
  Check,
  ChevronDown,
  CornerUpLeft,
  Loader2,
  MapPin,
  MessageSquare,
  Reply,
  Search,
  Send,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  getSpectraArtifactCommentPreference,
  getSpectraArtifactComments,
  postSpectra,
  searchSpectraSchoolMembers,
  type SpectraArtifactComment,
  type SpectraSchoolMember,
} from "../data/api";
import { formatRelativeTime } from "./spectra-view-model";
import { SpectraRichContent } from "./spectra-rich-content";
import { LocalAutocompleteTextarea } from "../compute/autocomplete";

export type ArtifactCommentRegion = {
  regionId: string;
  label: string;
  kind?: string;
};

type NotificationMode = "all" | "mentions_replies" | "off";

function initials(name?: string) {
  return (name || "?").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function regionLabel(regions: readonly ArtifactCommentRegion[], regionId: string) {
  return regions.find((region) => region.regionId === regionId)?.label ?? regionId;
}

export function ArtifactCommentsPanel({
  open,
  artifactId,
  artifactTitle,
  regions,
  preferredRegionId,
  currentAccountId,
  relativePosition,
  onClose,
}: {
  open: boolean;
  artifactId: string;
  artifactTitle: string;
  regions: readonly ArtifactCommentRegion[];
  preferredRegionId?: string;
  currentAccountId?: string;
  relativePosition?: Uint8Array;
  onClose: () => void;
}) {
  const [comments, setComments] = useState<SpectraArtifactComment[]>([]);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [regionId, setRegionId] = useState("");
  const [replyTo, setReplyTo] = useState<SpectraArtifactComment | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [reanchoringId, setReanchoringId] = useState<string | null>(null);
  const [reanchorRegionId, setReanchorRegionId] = useState("");
  const [mentionSearch, setMentionSearch] = useState("");
  const [mentionResults, setMentionResults] = useState<SpectraSchoolMember[]>([]);
  const [mentions, setMentions] = useState<SpectraSchoolMember[]>([]);
  const [searching, setSearching] = useState(false);
  const [notificationMode, setNotificationMode] = useState<NotificationMode>("mentions_replies");
  const searchSequence = useRef(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getSpectraArtifactComments(artifactId, includeResolved);
      setComments(result.comments);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load comments.");
    } finally {
      setLoading(false);
    }
  }, [artifactId, includeResolved]);

  useEffect(() => {
    if (!open) return;
    setBody("");
    setReplyTo(null);
    setEditingId(null);
    setReanchoringId(null);
    setMentions([]);
    setMentionSearch("");
    setRegionId((current) =>
      preferredRegionId &&
      regions.some((region) => region.regionId === preferredRegionId)
        ? preferredRegionId
        : regions.some((region) => region.regionId === current)
          ? current
          : (regions[0]?.regionId ?? "artifact:structure"),
    );
    void Promise.all([
      refresh(),
      getSpectraArtifactCommentPreference(artifactId).then((result) => setNotificationMode(result.mode)),
    ]).catch(() => undefined);
  }, [artifactId, open, preferredRegionId, refresh, regions]);

  useEffect(() => {
    if (!open) return;
    const needle = mentionSearch.trim();
    const sequence = ++searchSequence.current;
    if (needle.length < 2) {
      setMentionResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timeout = window.setTimeout(() => {
      void searchSpectraSchoolMembers(needle, 12).then((result) => {
        if (sequence === searchSequence.current) setMentionResults(result.members);
      }).catch((error) => {
        if (sequence === searchSequence.current) toast.error(error instanceof Error ? error.message : "Could not search collaborators.");
      }).finally(() => {
        if (sequence === searchSequence.current) setSearching(false);
      });
    }, 220);
    return () => window.clearTimeout(timeout);
  }, [mentionSearch, open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  const repliesByParent = useMemo(() => {
    const map = new Map<string, SpectraArtifactComment[]>();
    for (const comment of comments) {
      if (!comment.parentCommentId) continue;
      const replies = map.get(comment.parentCommentId) ?? [];
      replies.push(comment);
      map.set(comment.parentCommentId, replies);
    }
    return map;
  }, [comments]);
  const rootComments = comments.filter((comment) => !comment.parentCommentId);
  const orderedRootComments = [...rootComments].sort((left, right) => {
    const leftOrphaned = left.status === "orphaned" || !regions.some((region) => region.regionId === left.anchor.regionId);
    const rightOrphaned = right.status === "orphaned" || !regions.some((region) => region.regionId === right.anchor.regionId);
    return Number(rightOrphaned) - Number(leftOrphaned) || left.createdAt - right.createdAt;
  });

  async function createComment() {
    const value = body.trim();
    if (!value) return;
    setBusy("create");
    try {
      await postSpectra({
        action: "createArtifactComment",
        artifactId,
        parentCommentId: replyTo?._id,
        commentBody: value,
        regionId: replyTo?.anchor.regionId ?? regionId,
        fallbackExcerpt: regionLabel(regions, replyTo?.anchor.regionId ?? regionId),
        ...(!replyTo && relativePosition
          ? { relativePositionBase64: bytesToBase64(relativePosition) }
          : {}),
        mentionedAccountIds: mentions.map((member) => member.accountId),
      });
      setBody("");
      setReplyTo(null);
      setMentions([]);
      setMentionSearch("");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not post this comment.");
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit(comment: SpectraArtifactComment) {
    if (!editingBody.trim()) return;
    setBusy(`edit:${comment._id}`);
    try {
      await postSpectra({ action: "updateArtifactComment", commentId: comment._id, commentBody: editingBody.trim() });
      setEditingId(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update this comment.");
    } finally {
      setBusy(null);
    }
  }

  async function setResolved(comment: SpectraArtifactComment, resolved: boolean) {
    setBusy(`resolve:${comment._id}`);
    try {
      await postSpectra({ action: "setArtifactCommentResolved", commentId: comment._id, resolved });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update this thread.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(comment: SpectraArtifactComment) {
    setBusy(`remove:${comment._id}`);
    try {
      await postSpectra({ action: "removeArtifactComment", commentId: comment._id });
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove this comment.");
    } finally {
      setBusy(null);
    }
  }

  async function reanchor(comment: SpectraArtifactComment) {
    if (!reanchorRegionId) return;
    setBusy(`anchor:${comment._id}`);
    try {
      await postSpectra({
        action: "reanchorArtifactComment",
        commentId: comment._id,
        regionId: reanchorRegionId,
        fallbackExcerpt: regionLabel(regions, reanchorRegionId),
      });
      setReanchoringId(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not move this comment.");
    } finally {
      setBusy(null);
    }
  }

  async function changeNotifications(mode: NotificationMode) {
    const previous = notificationMode;
    setNotificationMode(mode);
    try {
      await postSpectra({ action: "setArtifactCommentPreference", artifactId, mode });
    } catch (error) {
      setNotificationMode(previous);
      toast.error(error instanceof Error ? error.message : "Could not update notifications.");
    }
  }

  function addMention(member: SpectraSchoolMember) {
    if (!mentions.some((entry) => entry.accountId === member.accountId)) setMentions((current) => [...current, member]);
    setBody((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@${member.name} `);
    setMentionSearch("");
    setMentionResults([]);
  }

  function renderComment(comment: SpectraArtifactComment, nested = false) {
    const own = Boolean(currentAccountId && comment.authorAccountId === currentAccountId);
    const orphaned = comment.status === "orphaned" || !regions.some((region) => region.regionId === comment.anchor.regionId);
    return (
      <article key={comment._id} className={nested ? "ml-10 border-l border-[var(--border-default)] pl-3" : ""}>
        <div className="group rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3.5">
          <div className="flex items-start gap-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-[9px] font-bold text-[var(--text-secondary)]">{initials(comment.author?.name)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{comment.author?.name ?? "Former collaborator"}</span>
                <span className="text-[9px] text-[var(--text-tertiary)]">{formatRelativeTime(comment.createdAt)}</span>
                {comment.updatedAt > comment.createdAt + 1_000 ? <span className="text-[9px] text-[var(--text-tertiary)]">edited</span> : null}
              </div>
              {comment.status === "deleted" ? <p className="mt-1.5 text-[11px] italic text-[var(--text-tertiary)]">Comment removed</p> : editingId === comment._id ? (
                <div className="mt-2">
                  <textarea autoFocus value={editingBody} onChange={(event) => setEditingBody(event.target.value)} className="min-h-20 w-full resize-y rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-[12px] leading-5 text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]" />
                  <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setEditingId(null)} className="rounded-[6px] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">Cancel</button><button type="button" disabled={!editingBody.trim() || busy === `edit:${comment._id}`} onClick={() => void saveEdit(comment)} className="rounded-[6px] bg-[var(--text-primary)] px-2.5 py-1 text-[10px] font-semibold text-[var(--bg-primary)] disabled:opacity-45">Save</button></div>
                </div>
              ) : <SpectraRichContent content={comment.body} className="mt-1.5 whitespace-pre-wrap text-[12px] leading-5 text-[var(--text-primary)]" />}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {comment.status !== "deleted" ? <button type="button" onClick={() => { setReplyTo(comment); setRegionId(comment.anchor.regionId); }} className="inline-flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[9px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><Reply className="h-3 w-3" />Reply</button> : null}
                {comment.status !== "deleted" ? <button type="button" onClick={() => void setResolved(comment, comment.status !== "resolved")} className="inline-flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[9px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><Check className="h-3 w-3" />{comment.status === "resolved" ? "Reopen" : "Resolve"}</button> : null}
                {own && comment.status !== "deleted" ? <button type="button" onClick={() => { setEditingId(comment._id); setEditingBody(comment.body); }} className="h-6 rounded-[5px] px-1.5 text-[9px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">Edit</button> : null}
                {own && comment.status !== "deleted" ? <button type="button" aria-label="Remove comment" onClick={() => void remove(comment)} className="flex h-6 w-6 items-center justify-center rounded-[5px] text-[var(--text-tertiary)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,var(--bg-primary))] hover:text-[var(--danger)]"><Trash2 className="h-3 w-3" /></button> : null}
              </div>
            </div>
          </div>
          {comment.status !== "deleted" ? <div className={`mt-3 rounded-[7px] border px-2.5 py-2 ${orphaned ? "border-[color-mix(in_oklab,#d88922_35%,var(--border-default))] bg-[color-mix(in_oklab,#d88922_6%,var(--bg-elevated))]" : "border-[var(--border-subtle)] bg-[var(--bg-elevated)]"}`}>
            <div className="flex items-center gap-1.5 text-[9px] text-[var(--text-secondary)]"><MapPin className="h-3 w-3" /><span className="min-w-0 flex-1 truncate">{orphaned ? "Original region changed or was removed" : regionLabel(regions, comment.anchor.regionId)}</span>{orphaned ? <button type="button" onClick={() => { setReanchoringId(comment._id); setReanchorRegionId(regions[0]?.regionId ?? ""); }} className="font-semibold text-[var(--text-primary)]">Reattach</button> : null}</div>
            {reanchoringId === comment._id ? <div className="mt-2 flex gap-1.5"><select value={reanchorRegionId} onChange={(event) => setReanchorRegionId(event.target.value)} className="h-8 min-w-0 flex-1 rounded-[6px] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-[10px] text-[var(--text-primary)]">{regions.map((region) => <option key={region.regionId} value={region.regionId}>{region.label}</option>)}</select><button type="button" disabled={!reanchorRegionId || busy === `anchor:${comment._id}`} onClick={() => void reanchor(comment)} className="rounded-[6px] bg-[var(--text-primary)] px-2.5 text-[10px] font-semibold text-[var(--bg-primary)] disabled:opacity-45">Attach</button></div> : null}
          </div> : null}
        </div>
      </article>
    );
  }

  function renderThread(comment: SpectraArtifactComment, depth = 0): React.ReactNode {
    const replies = repliesByParent.get(comment._id) ?? [];
    return <div key={comment._id} className="space-y-2">{renderComment(comment, depth > 0)}{replies.map((reply) => renderThread(reply, depth + 1))}</div>;
  }

  if (!open) return null;
  return (
    <div className="absolute inset-0 z-[70] flex justify-end bg-[color-mix(in_oklab,var(--text-primary)_12%,transparent)] backdrop-blur-[1px]" onPointerDown={onClose}>
      <aside role="dialog" aria-modal="true" aria-labelledby="artifact-comments-title" className="flex h-full w-full max-w-[410px] flex-col border-l border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-[-20px_0_60px_rgba(27,20,12,0.12)]" onPointerDown={(event) => event.stopPropagation()}>
        <header className="flex shrink-0 items-start justify-between border-b border-[var(--border-default)] px-4 py-4">
          <div className="flex min-w-0 items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[color-mix(in_oklab,var(--accent-cyan)_9%,var(--bg-secondary))] text-[var(--accent-cyan)]"><MessageSquare className="h-4 w-4" /></span><div className="min-w-0"><h2 id="artifact-comments-title" className="font-display text-[18px] font-semibold text-[var(--text-primary)]">Comments</h2><p className="mt-0.5 truncate text-[10px] text-[var(--text-tertiary)]">{artifactTitle}</p></div></div>
          <div className="flex items-center gap-1"><label className="relative flex h-8 items-center gap-1.5 rounded-[7px] px-2 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"><Bell className="h-3.5 w-3.5" /><span className="sr-only">Comment notifications</span><select value={notificationMode} onChange={(event) => void changeNotifications(event.target.value as NotificationMode)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Comment notifications"><option value="all">All comments</option><option value="mentions_replies">Mentions and replies</option><option value="off">Off</option></select><ChevronDown className="h-3 w-3" /></label><button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" aria-label="Close comments"><X className="h-4 w-4" /></button></div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2"><span className="text-[10px] text-[var(--text-tertiary)]">{comments.filter((comment) => comment.status !== "resolved").length} open</span><label className="flex cursor-pointer items-center gap-2 text-[10px] text-[var(--text-secondary)]"><input type="checkbox" checked={includeResolved} onChange={(event) => setIncludeResolved(event.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent-cyan)]" />Show resolved</label></div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {loading ? <div className="flex h-32 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" /></div> : orderedRootComments.length === 0 ? <div className="mx-auto flex max-w-[260px] flex-col items-center py-14 text-center"><span className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-[var(--border-strong)] text-[var(--text-tertiary)]"><MessageSquare className="h-4 w-4" /></span><h3 className="mt-3 text-[12px] font-semibold text-[var(--text-primary)]">No comments here yet</h3><p className="mt-1 text-[10px] leading-5 text-[var(--text-secondary)]">Anchor a thought to a block, field, card, cell, object, or other semantic region.</p></div> : <div className="space-y-3">{orderedRootComments.map((comment) => renderThread(comment))}</div>}
          </div>

          <div className="shrink-0 border-t border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
            {replyTo ? <div className="mb-2 flex items-center gap-2 rounded-[7px] bg-[var(--bg-secondary)] px-2.5 py-2 text-[10px] text-[var(--text-secondary)]"><CornerUpLeft className="h-3 w-3" /><span className="min-w-0 flex-1 truncate">Replying to {replyTo.author?.name ?? "comment"}</span><button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><X className="h-3 w-3" /></button></div> : null}
            <div className="rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-elevated)] focus-within:border-[var(--border-strong)]">
              <LocalAutocompleteTextarea surface="comment" value={body} onValueChange={setBody} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void createComment(); }} placeholder={replyTo ? "Write a reply…" : "Add a comment…"} className="min-h-[76px] w-full" textareaClassName="min-h-[76px] w-full resize-none px-3 pt-2.5 text-[12px] leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]" />
              {mentions.length ? <div className="flex flex-wrap gap-1 px-3 pb-2">{mentions.map((member) => <button type="button" key={member.accountId} onClick={() => setMentions((current) => current.filter((entry) => entry.accountId !== member.accountId))} className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-secondary)] px-2 py-1 text-[9px] text-[var(--text-secondary)]">@{member.name}<X className="h-2.5 w-2.5" /></button>)}</div> : null}
              <div className="flex items-center gap-1.5 border-t border-[var(--border-subtle)] px-2 py-2">
                <div className="relative min-w-0 flex-1"><MapPin className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-tertiary)]" /><select value={replyTo?.anchor.regionId ?? regionId} disabled={Boolean(replyTo)} onChange={(event) => setRegionId(event.target.value)} className="h-8 w-full min-w-0 appearance-none truncate rounded-[6px] bg-[var(--bg-secondary)] pl-7 pr-6 text-[9px] text-[var(--text-secondary)] outline-none disabled:opacity-70">{regions.map((region) => <option key={region.regionId} value={region.regionId}>{region.label}</option>)}{regions.length === 0 ? <option value="artifact:structure">Whole artifact</option> : null}</select><ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-tertiary)]" /></div>
                <div className="relative"><button type="button" className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]" aria-label="Mention a collaborator" onClick={() => document.getElementById(`comment-mention-${artifactId}`)?.focus()}><UserPlus className="h-3.5 w-3.5" /></button></div>
                <button type="button" disabled={!body.trim() || busy === "create"} onClick={() => void createComment()} className="flex h-8 w-8 items-center justify-center rounded-[7px] bg-[var(--text-primary)] text-[var(--bg-primary)] disabled:opacity-35" aria-label="Post comment">{busy === "create" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}</button>
              </div>
            </div>
            <div className="relative mt-2"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" /><input id={`comment-mention-${artifactId}`} value={mentionSearch} onChange={(event) => setMentionSearch(event.target.value)} placeholder="Mention a collaborator" className="h-8 w-full rounded-[7px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] pl-8 pr-8 text-[10px] text-[var(--text-primary)] outline-none focus:border-[var(--border-default)]" />{searching ? <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-[var(--text-tertiary)]" /> : null}{mentionSearch.trim().length >= 2 ? <div className="absolute bottom-10 left-0 right-0 z-10 max-h-40 overflow-y-auto rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-[0_14px_34px_rgba(27,20,12,0.18)]">{mentionResults.filter((member) => !mentions.some((entry) => entry.accountId === member.accountId)).map((member) => <button type="button" key={member.accountId} onClick={() => addMention(member)} className="flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left hover:bg-[var(--bg-hover)]"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-[8px] font-bold text-[var(--text-secondary)]">{initials(member.name)}</span><span className="min-w-0 flex-1 truncate text-[10px] font-medium text-[var(--text-primary)]">{member.name}</span></button>)}{!searching && mentionResults.length === 0 ? <p className="px-2 py-3 text-center text-[10px] text-[var(--text-tertiary)]">No school member found.</p> : null}</div> : null}</div>
            <p className="mt-2 text-right text-[8px] text-[var(--text-tertiary)]">Ctrl/⌘ + Enter to post</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function bytesToBase64(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}
