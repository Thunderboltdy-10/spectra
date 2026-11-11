"use client";

import { Loader2, Bell, Check, MessageSquare, Send, Trash2, X, CornerUpLeft, Reply } from "@/components/icons/glyph-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { buttonVariants } from "@/components/ui/button";
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
import { OverflowMenu } from "@/components/ui/dropdown-menu";
import { SelectField } from "@/components/ui/select";
import { getAiLocation, subscribeFollowAi } from "../collaboration/follow-ai";
import { beginCreation, unformElement, useLifeArrival, type ArrivalKind } from "../life/use-life";

export type ArtifactCommentRegion = {
  regionId: string;
  label: string;
  kind?: string;
};

/** Native Word comments projected from comments.xml — distinct from Spectra threads. */
export type WordImportedComment = {
  id: string;
  author?: string;
  date?: string;
  text: string;
};

type NotificationMode = "all" | "mentions_replies" | "off";

const NOTIFICATION_MODE_ITEMS: ReadonlyArray<{
  key: NotificationMode;
  label: string;
}> = [
  { key: "all", label: "All comments" },
  { key: "mentions_replies", label: "Mentions and replies" },
  { key: "off", label: "Off" },
];

function initials(name?: string) {
  return (name || "?").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

/**
 * One comment's card. A comment that arrives while the panel is open forms
 * where the user posted it, or, when Spectra wrote it, from light that leaves
 * the prism (LIFE.md, "Create by hand" and "Spectra creates"). What the panel
 * opened with is simply content.
 */
function CommentFrame({ id, arrival, children }: { id: string; arrival?: ArrivalKind; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLifeArrival(ref, id, arrival, { bars: "[data-comment-author], [data-comment-body]" });
  return (
    <div ref={ref} data-comment-id={id} className="group">
      {children}
    </div>
  );
}

/** Comments on the work as a whole carry one of these instead of a region. */
const WHOLE_WORK = new Set(["work:root", "artifact:structure"]);

function regionLabel(regions: readonly ArtifactCommentRegion[], regionId: string) {
  return regions.find((region) => region.regionId === regionId)?.label ?? (WHOLE_WORK.has(regionId) ? "Whole work" : regionId);
}

function regionGone(regions: readonly ArtifactCommentRegion[], comment: SpectraArtifactComment) {
  if (comment.status === "orphaned") return true;
  return !WHOLE_WORK.has(comment.anchor.regionId) && !regions.some((region) => region.regionId === comment.anchor.regionId);
}

/** The name being typed after an @ at the end of the text. */
const MENTION_BEING_TYPED = /(?:^|\s)@([^\s@]{0,40})$/;

export function ArtifactCommentsPanel({
  open,
  artifactId,
  regions,
  preferredRegionId,
  currentAccountId,
  relativePosition,
  requestedComment,
  onRequestedCommentResult,
  wordComments = [],
}: {
  open: boolean;
  artifactId: string;
  regions: readonly ArtifactCommentRegion[];
  preferredRegionId?: string;
  currentAccountId?: string;
  relativePosition?: Uint8Array;
  requestedComment?: { id: string; body: string; regionId?: string; submit?: boolean } | null;
  onRequestedCommentResult?: (error?: unknown) => void;
  wordComments?: readonly WordImportedComment[];
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
  const submittedRequestRef = useRef<string | null>(null);
  const createCommentRef = useRef<() => Promise<void>>(() => Promise.resolve());
  /** Comments already on screen, and the ones that arrived while the panel was open, with who made them. */
  const knownIds = useRef(new Set<string>());
  const arrivals = useRef(new Map<string, ArrivalKind>());

  /** `arriving`: what is new since the last load came from something just done here or by Spectra, so it forms. */
  const refresh = useCallback(async (arriving = false) => {
    setLoading(true);
    try {
      const result = await getSpectraArtifactComments(artifactId, includeResolved);
      for (const comment of result.comments) {
        if (arriving && !knownIds.current.has(comment._id)) arrivals.current.set(comment._id, comment.author?.kind === "ai" ? "ai" : "human");
        knownIds.current.add(comment._id);
      }
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

  // Spectra commenting on this work while the panel is open: its comment arrives from the prism.
  useEffect(() => {
    if (!open) return;
    let seen = getAiLocation()?.updatedAt ?? 0;
    return subscribeFollowAi(() => {
      const location = getAiLocation();
      if (!location || location.artifactId !== artifactId || location.updatedAt === seen) return;
      seen = location.updatedAt;
      if (location.path?.startsWith("/comments") || /comment/i.test(location.note ?? "")) void refresh(true);
    });
  }, [artifactId, open, refresh]);

  useEffect(() => {
    if (!open || !requestedComment) return;
    setBody(requestedComment.body);
    if (requestedComment.regionId && regions.some((region) => region.regionId === requestedComment.regionId)) {
      setRegionId(requestedComment.regionId);
    }
  }, [open, regions, requestedComment]);

  useEffect(() => {
    if (!open || !requestedComment?.submit || submittedRequestRef.current === requestedComment.id) return;
    if (body !== requestedComment.body) return;
    submittedRequestRef.current = requestedComment.id;
    void createCommentRef.current();
  }, [body, open, requestedComment]);

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
    const leftOrphaned = regionGone(regions, left);
    const rightOrphaned = regionGone(regions, right);
    return Number(rightOrphaned) - Number(leftOrphaned) || left.createdAt - right.createdAt;
  });

  async function createComment() {
    const value = body.trim();
    if (!value) return;
    setBusy("create");
    // Dots gather at the press; the comment grows out of them.
    const creation = beginCreation({ into: "item" });
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
      creation.land();
      await refresh(true);
      if (requestedComment?.submit) onRequestedCommentResult?.();
    } catch (error) {
      creation.cancel();
      toast.error(error instanceof Error ? error.message : "Could not post this comment.");
      if (requestedComment?.submit) onRequestedCommentResult?.(error);
    } finally {
      setBusy(null);
    }
  }
  createCommentRef.current = createComment;

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
      // Its words part where they were; the card stays to say it was removed.
      const card = Array.from(document.querySelectorAll("[data-comment-id]")).find((element) => element.getAttribute("data-comment-id") === comment._id);
      const words = card?.querySelector("[data-comment-body]");
      if (words) void unformElement(words);
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
    setBody((current) => `${current.replace(/@[^\s@]*$/, "")}@${member.name} `);
    setMentionSearch("");
    setMentionResults([]);
  }

  function renderComment(comment: SpectraArtifactComment, nested = false) {
    const own = Boolean(currentAccountId && comment.authorAccountId === currentAccountId);
    const orphaned = regionGone(regions, comment);
    const live = comment.status !== "deleted";
    const action = "inline-flex h-6 cursor-pointer items-center gap-1 rounded-chip px-1.5 text-micro font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]";
    return (
      <article key={comment._id} className={nested ? "mt-3" : ""}>
        <CommentFrame id={comment._id} arrival={arrivals.current.get(comment._id)}>
          <div className="flex items-start gap-2.5">
            <span className={`flex shrink-0 items-center justify-center rounded-full bg-[var(--bg-secondary)] font-semibold text-[var(--text-secondary)] ${nested ? "size-5 text-micro" : "size-6 text-micro"}`}>{initials(comment.author?.name)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span data-comment-author className="truncate text-caption font-semibold text-[var(--text-primary)]">{comment.author?.name ?? "Former collaborator"}</span>
                <span className="shrink-0 text-micro text-[var(--text-tertiary)]">{formatRelativeTime(comment.createdAt)}{comment.updatedAt > comment.createdAt + 1_000 ? ", edited" : ""}</span>
              </div>
              {!live ? <p className="mt-1 text-micro italic text-[var(--text-tertiary)]">Comment removed</p> : editingId === comment._id ? (
                <div className="mt-2">
                  <textarea autoFocus value={editingBody} onChange={(event) => setEditingBody(event.target.value)} className="min-h-20 w-full resize-y rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-caption leading-5 text-[var(--text-primary)] outline-none focus:border-[var(--border-strong)]" />
                  <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setEditingId(null)} className={action}>Cancel</button><button type="button" disabled={!editingBody.trim() || busy === `edit:${comment._id}`} onClick={() => void saveEdit(comment)} className={buttonVariants({ variant: "primary" })}>Save</button></div>
                </div>
              ) : <div data-comment-body><SpectraRichContent content={comment.body} className="mt-0.5 text-caption leading-5 text-[var(--text-primary)]" /></div>}
              {live && editingId !== comment._id ? (
                <div className="-ml-1.5 mt-1 flex flex-wrap items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                  <button type="button" onClick={() => { setReplyTo(comment); setRegionId(comment.anchor.regionId); }} className={action}><Reply className="size-3" />Reply</button>
                  {nested ? null : <button type="button" data-life-done={comment.status === "resolved" ? undefined : ""} onClick={() => void setResolved(comment, comment.status !== "resolved")} className={action}><Check className="size-3" />{comment.status === "resolved" ? "Reopen" : "Resolve"}</button>}
                  {own ? <button type="button" onClick={() => { setEditingId(comment._id); setEditingBody(comment.body); }} className={action}>Edit</button> : null}
                  {own ? <button type="button" aria-label="Remove comment" onClick={() => void remove(comment)} className="flex size-6 cursor-pointer items-center justify-center rounded-chip text-[var(--text-tertiary)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,var(--bg-primary))] hover:text-[var(--danger)]"><Trash2 className="size-3" /></button> : null}
                </div>
              ) : null}
            </div>
          </div>
          {live && orphaned ? (
            <div className="mt-2 pl-[34px] text-micro text-[var(--text-secondary)]">
              <span>The part this was about has changed.</span>{" "}
              <button type="button" onClick={() => { setReanchoringId(comment._id); setReanchorRegionId(regions[0]?.regionId ?? ""); }} className="cursor-pointer font-semibold text-[var(--text-primary)]">Reattach</button>
              {reanchoringId === comment._id ? <div className="mt-2 flex gap-1.5"><SelectField ariaLabel="Reattach to region" value={reanchorRegionId} onChange={setReanchorRegionId} options={regions.map((region) => ({ value: region.regionId, label: region.label }))} size="sm" className="min-w-0 flex-1" triggerClassName="w-full" /><button type="button" disabled={!reanchorRegionId || busy === `anchor:${comment._id}`} onClick={() => void reanchor(comment)} className={buttonVariants({ variant: "primary" })}>Attach</button></div> : null}
            </div>
          ) : null}
        </CommentFrame>
      </article>
    );
  }

  function renderReplies(parentId: string): React.ReactNode {
    return (repliesByParent.get(parentId) ?? []).map((reply) => (
      <div key={reply._id}>
        {renderComment(reply, true)}
        {renderReplies(reply._id)}
      </div>
    ));
  }

  /** One thread: what it is about, the comment, then its replies. */
  function renderThread(comment: SpectraArtifactComment): React.ReactNode {
    const resolved = comment.status === "resolved";
    const about = regionGone(regions, comment) ? null : regionLabel(regions, comment.anchor.regionId);
    return (
      <section key={comment._id} className={`rounded-card border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3 ${resolved ? "opacity-70" : ""}`}>
        {about || resolved ? (
          <p className="mb-2 truncate text-micro text-[var(--text-tertiary)]">{[about, resolved ? "Resolved" : null].filter(Boolean).join(", ")}</p>
        ) : null}
        {renderComment(comment)}
        {renderReplies(comment._id)}
      </section>
    );
  }

  return (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-4 py-2"><span className="text-micro text-[var(--text-tertiary)]">{comments.filter((comment) => comment.status !== "resolved").length} open</span><span className="flex items-center gap-2"><label className="flex cursor-pointer items-center gap-2 text-micro text-[var(--text-secondary)]"><input type="checkbox" checked={includeResolved} onChange={(event) => setIncludeResolved(event.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent-cyan)]" />Show resolved</label><OverflowMenu label="Comment notifications" icon={Bell} items={NOTIFICATION_MODE_ITEMS} value={notificationMode} onSelect={(next) => void changeNotifications(next)} size={28} /></span></div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {loading ? <div className="flex h-32 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" /></div> : (
              <div className="space-y-3">
                {wordComments.length ? (
                  <div className="rounded-card border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3.5">
                    <h3 className="text-caption font-semibold text-[var(--text-primary)]">From Word</h3>
                    <p className="mt-1 text-micro leading-5 text-[var(--text-secondary)]">
                      Native comments from the imported file. Spectra threads stay separate and are never written into the Word package from here.
                    </p>
                    <div className="mt-3 space-y-2">
                      {wordComments.map((comment) => (
                        <article key={`word-${comment.id}`} className="rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
                          <div className="flex items-center gap-2">
                            <span className="text-caption font-semibold text-[var(--text-primary)]">{comment.author?.trim() || "Word"}</span>
                            {comment.date ? <span className="text-micro text-[var(--text-tertiary)]">{comment.date}</span> : null}
                          </div>
                          <p className="mt-1.5 text-caption leading-5 text-[var(--text-secondary)]">{comment.text || "(empty comment)"}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}
                {orderedRootComments.length === 0 ? (
                  wordComments.length ? null : (
                    <div className="mx-auto flex max-w-[260px] flex-col items-center py-14 text-center"><MessageSquare className="size-4 text-[var(--text-tertiary)]" /><h3 className="mt-3 text-caption font-semibold text-[var(--text-primary)]">No comments yet</h3><p className="mt-1 text-micro leading-5 text-[var(--text-secondary)]">Add one below, or ask Spectra to leave you feedback here.</p></div>
                  )
                ) : orderedRootComments.map((comment) => renderThread(comment))}
              </div>
            )}
          </div>

          <div className="relative shrink-0 border-t border-[var(--border-subtle)] p-3">
            {mentionSearch.trim().length >= 2 ? (
              <div className="absolute inset-x-3 bottom-full z-chrome mb-1 max-h-40 overflow-y-auto rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] p-1 shadow-hover">
                {mentionResults.filter((member) => !mentions.some((entry) => entry.accountId === member.accountId)).map((member) => <button type="button" key={member.accountId} onClick={() => addMention(member)} className="flex w-full cursor-pointer items-center gap-2 rounded-chip px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"><span className="flex size-6 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-micro font-semibold text-[var(--text-secondary)]">{initials(member.name)}</span><span className="min-w-0 flex-1 truncate text-micro font-medium text-[var(--text-primary)]">{member.name}</span></button>)}
                {searching ? <p className="px-2 py-2 text-micro text-[var(--text-tertiary)]">Searching…</p> : mentionResults.length === 0 ? <p className="px-2 py-2 text-micro text-[var(--text-tertiary)]">Nobody at your school by that name.</p> : null}
              </div>
            ) : null}
            {replyTo ? <div className="mb-2 flex items-center gap-2 px-1 text-micro text-[var(--text-secondary)]"><CornerUpLeft className="size-3" /><span className="min-w-0 flex-1 truncate">Replying to {replyTo.author?.name ?? "this comment"}</span><button type="button" className="cursor-pointer" onClick={() => setReplyTo(null)} aria-label="Cancel reply"><X className="size-3" /></button></div> : null}
            <div className="rounded-card border border-[var(--border-default)] bg-[var(--bg-primary)] focus-within:border-[var(--border-strong)]">
              <LocalAutocompleteTextarea surface="comment" value={body} onValueChange={(next) => { setBody(next); setMentionSearch(next.match(MENTION_BEING_TYPED)?.[1] ?? ""); }} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void createComment(); }} placeholder={replyTo ? "Write a reply" : "Add a comment. Type @ to mention someone."} className="min-h-[52px] w-full" textareaClassName="min-h-[52px] w-full resize-none bg-transparent px-3 pt-2.5 text-caption leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]" />
              {mentions.length ? <div className="flex flex-wrap gap-1 px-3 pb-1">{mentions.map((member) => <button type="button" key={member.accountId} onClick={() => setMentions((current) => current.filter((entry) => entry.accountId !== member.accountId))} className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-micro text-[var(--text-secondary)]">@{member.name}<X className="size-2.5" /></button>)}</div> : null}
              <div className="flex items-center gap-1.5 px-1.5 pb-1.5">
                {replyTo ? <span className="min-w-0 flex-1" /> : <SelectField ariaLabel="What this comment is about" value={regionId} onChange={setRegionId} options={regions.length ? regions.map((region) => ({ value: region.regionId, label: region.label })) : [{ value: "artifact:structure", label: "Whole work" }]} size="sm" className="min-w-0 flex-1" triggerClassName="w-fit max-w-full border-0 bg-transparent font-normal text-[var(--text-secondary)]" />}
                <button type="button" disabled={!body.trim() || busy === "create"} onClick={() => void createComment()} className={buttonVariants({ variant: "primary", size: "icon" })} aria-label="Post comment">{busy === "create" ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}</button>
              </div>
            </div>
          </div>
        </div>
  );
}

function bytesToBase64(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}
