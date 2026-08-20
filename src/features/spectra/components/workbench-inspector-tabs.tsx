"use client";

import {
  Bot,
  Check,
  Clock3,
  CornerUpLeft,
  Loader2,
  MapPin,
  MessageSquare,
  RefreshCw,
  Send,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  getSpectraArtifactComments,
  getSpectraArtifactVersions,
  postSpectra,
  type SpectraArtifact,
  type SpectraArtifactComment,
  type SpectraArtifactVersion,
} from "../data/api";
import { spectraBus } from "../events";
import {
  filterInspectorHistory,
  revealCommentTarget,
  type InspectorHistoryEntry,
  type WorkbenchInspectorTab,
} from "../workbench/inspector/inspector-model";
import { formatRelativeTime } from "./spectra-view-model";
import { SpectraRichContent } from "./spectra-rich-content";
import { LocalAutocompleteTextarea } from "../compute/autocomplete";

type HistoryFilter = "all" | "changes" | "ai" | "access";

const tabLabels: Record<WorkbenchInspectorTab, string> = {
  overview: "Overview",
  comments: "Comments",
  history: "History",
};

export function WorkbenchInspectorTabs({
  work,
  overview,
}: {
  work: SpectraArtifact;
  overview: ReactNode;
}) {
  const [tab, setTab] = useState<WorkbenchInspectorTab>("overview");
  const [comments, setComments] = useState<SpectraArtifactComment[]>([]);
  const [versions, setVersions] = useState<SpectraArtifactVersion[]>([]);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [commentBody, setCommentBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadedWorkId, setLoadedWorkId] = useState<string | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);

  useEffect(() => {
    setTab("overview");
    setComments([]);
    setVersions([]);
    setCommentBody("");
    setLoadedWorkId(null);
    setSelectedCommentId(null);
  }, [work._id]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [commentResult, versionResult] = await Promise.all([
        getSpectraArtifactComments(work._id, true),
        getSpectraArtifactVersions(work._id, 60),
      ]);
      setComments(commentResult.comments);
      setVersions(versionResult.versions);
      setLoadedWorkId(work._id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load inspector activity.");
    } finally {
      setLoading(false);
    }
  }, [work._id]);

  useEffect(() => {
    if (tab === "overview" || loadedWorkId === work._id) return;
    void refresh();
  }, [loadedWorkId, refresh, tab, work._id]);

  const visibleComments = useMemo(
    () => comments.filter((comment) =>
      comment.status !== "deleted" && (includeResolved || comment.status !== "resolved")),
    [comments, includeResolved],
  );
  const history = useMemo(
    () => filterInspectorHistory([
      ...versions.map(versionToHistory),
      { id: `created:${work._id}`, category: "change", summary: "Work created", createdAt: work.createdAt },
      ...(work.isShared ? [{ id: `access:${work._id}`, category: "access" as const, summary: `Shared with ${work.sharedWithCount ?? 0} collaborator${work.sharedWithCount === 1 ? "" : "s"}`, createdAt: work.updatedAt }] : []),
      ...(work.createdFrom?.sourceAttachmentNames ?? []).map((name, index) => ({ id: `source:${work._id}:${index}`, category: "source" as const, summary: `Source attached: ${name}`, createdAt: work.createdAt })),
    ], historyFilter),
    [historyFilter, versions, work],
  );

  async function createGeneralComment() {
    const body = commentBody.trim();
    if (!body) return;
    setBusy("create");
    try {
      await postSpectra({
        action: "createArtifactComment",
        artifactId: work._id,
        commentBody: body,
        regionId: "work:root",
        fallbackExcerpt: `Whole ${work.title}`,
        mentionedAccountIds: [],
      });
      setCommentBody("");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add this comment.");
    } finally {
      setBusy(null);
    }
  }

  async function setResolved(comment: SpectraArtifactComment) {
    setBusy(comment._id);
    try {
      await postSpectra({
        action: "setArtifactCommentResolved",
        commentId: comment._id,
        resolved: comment.status !== "resolved",
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  async function revealOrReanchor(comment: SpectraArtifactComment) {
    setSelectedCommentId(comment._id);
    const result = revealCommentTarget({
      id: comment._id,
      body: comment.body,
      status: comment.status === "deleted" ? "resolved" : comment.status,
      anchorLabel: comment.anchor.fallbackExcerpt ?? comment.anchor.regionId,
    });
    if (result.kind === "reanchor_required") {
      setBusy(comment._id);
      try {
        await postSpectra({
          action: "reanchorArtifactComment",
          commentId: comment._id,
          regionId: "work:root",
          fallbackExcerpt: `Whole ${work.title}`,
        });
        await refresh();
      } finally {
        setBusy(null);
      }
      return;
    }
    const semanticAnchor = comment.anchor.semanticAnchor;
    void spectraBus.command("work.revealAnchor", {
      anchor: semanticAnchor ?? {
        workId: work._id,
        workType: work.blueprintKey === "thread_reference" || work.blueprintKey === "resource" ? "document" : work.blueprintKey,
        kind: "comment",
        path: [comment.anchor.regionId],
        fallbackExcerpt: comment.anchor.fallbackExcerpt,
        schemaVersion: 1,
      },
      focus: true,
    });
  }

  return (
    <div className="mt-4">
      <div aria-label="Inspector sections" className="grid grid-cols-3 border-b border-[var(--border-default)]" role="tablist">
        {(Object.keys(tabLabels) as WorkbenchInspectorTab[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`h-9 border-b-2 text-[12px] font-medium transition ${tab === key ? "border-[var(--text-primary)] text-[var(--text-primary)]" : "border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"}`}
          >
            {tabLabels[key]}
          </button>
        ))}
      </div>

      {tab === "overview" ? overview : null}
      {tab === "comments" ? (
        <section className="py-4" role="tabpanel">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--text-secondary)]">
              {comments.filter((comment) => comment.status === "open" || comment.status === "orphaned").length} open
            </span>
            <label className="flex items-center gap-1.5 text-micro text-[var(--text-secondary)]">
              <input type="checkbox" checked={includeResolved} onChange={(event) => setIncludeResolved(event.target.checked)} />
              Resolved
            </label>
          </div>
          <div className="mt-3 space-y-2">
            {loading ? <LoadingState /> : null}
            {!loading && visibleComments.length === 0 ? <EmptyState icon={MessageSquare} text="No comments yet. Add a general comment or select content in the editor to anchor one precisely." /> : null}
            {visibleComments.map((comment) => {
              const orphaned = comment.status === "orphaned";
              return (
                <article key={comment._id} data-selected={selectedCommentId === comment._id} className={`rounded-[8px] border bg-[var(--bg-elevated)] p-3 ${selectedCommentId === comment._id ? "border-[var(--accent-cyan)] shadow-[0_0_0_2px_color-mix(in_oklab,var(--accent-cyan)_12%,transparent)]" : "border-[var(--border-default)]"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-semibold text-[var(--text-primary)]">{comment.author?.name ?? "Former collaborator"}</span>
                    <span className="shrink-0 text-micro text-[var(--text-tertiary)]">{formatRelativeTime(comment.createdAt)}</span>
                  </div>
                  <SpectraRichContent content={comment.body} className="mt-1.5 whitespace-pre-wrap text-[12px] leading-5 text-[var(--text-secondary)]" />
                  <button type="button" onClick={() => void revealOrReanchor(comment)} className={`mt-2 flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-left text-micro ${orphaned ? "bg-[color-mix(in_oklab,#d88922_8%,var(--bg-secondary))] text-[#a96816]" : "bg-[var(--bg-secondary)] text-[var(--text-secondary)]"}`}>
                    {orphaned ? <RefreshCw className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                    <span className="min-w-0 flex-1 truncate">{orphaned ? "Target changed — attach to whole work" : (comment.anchor.fallbackExcerpt ?? comment.anchor.regionId)}</span>
                  </button>
                  <div className="mt-2 flex items-center gap-2">
                    <button type="button" disabled={busy === comment._id} onClick={() => void setResolved(comment)} className="inline-flex items-center gap-1 text-micro font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                      {comment.status === "resolved" ? <CornerUpLeft className="h-3 w-3" /> : <Check className="h-3 w-3" />}
                      {comment.status === "resolved" ? "Reopen" : "Resolve"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="mt-3 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-2">
            <LocalAutocompleteTextarea surface="comment" value={commentBody} onValueChange={setCommentBody} placeholder="Add a general comment…" className="min-h-16 w-full" textareaClassName="min-h-16 w-full resize-y px-1 text-[12px] leading-5 text-[var(--text-primary)] outline-none" />
            <div className="flex justify-end">
              <button type="button" disabled={!commentBody.trim() || busy === "create"} onClick={() => void createGeneralComment()} className="inline-flex h-7 items-center gap-1.5 rounded-[6px] bg-[var(--text-primary)] px-2.5 text-micro font-semibold text-[var(--bg-primary)] disabled:opacity-40">
                {busy === "create" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Add
              </button>
            </div>
          </div>
        </section>
      ) : null}
      {tab === "history" ? (
        <section className="py-4" role="tabpanel">
          <div className="grid grid-cols-4 gap-1 rounded-[7px] bg-[var(--bg-secondary)] p-1">
            {(["all", "changes", "ai", "access"] as HistoryFilter[]).map((filter) => (
              <button key={filter} type="button" onClick={() => setHistoryFilter(filter)} className={`h-7 rounded-[5px] text-micro font-medium capitalize ${historyFilter === filter ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}`}>{filter}</button>
            ))}
          </div>
          <div className="mt-3 space-y-1">
            {loading ? <LoadingState /> : null}
            {!loading && history.length === 0 ? <EmptyState icon={Clock3} text="No matching history yet." /> : null}
            {history.map((entry) => (
              <div key={entry.id} className="flex gap-2.5 border-b border-[var(--border-subtle)] py-2.5 last:border-0">
                {entry.category === "ai" ? <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-cyan)]" /> : <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />}
                <div className="min-w-0"><p className="text-[11px] leading-4 text-[var(--text-primary)]">{entry.summary}</p><p className="mt-0.5 text-micro capitalize text-[var(--text-tertiary)]">{entry.category} · {formatRelativeTime(entry.createdAt)}</p></div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function versionToHistory(version: SpectraArtifactVersion): InspectorHistoryEntry {
  const category: InspectorHistoryEntry["category"] =
    version.source === "ai" ? "ai"
      : version.source === "import" || version.source === "migration" ? "import"
        : version.source === "restore" || version.source === "revert" ? "restore"
          : "change";
  return {
    id: version._id,
    category,
    summary: version.summary ?? version.name ?? (category === "ai" ? "AI updated this work" : "Content changed"),
    createdAt: version.createdAt,
  };
}

function LoadingState() {
  return <div className="flex h-20 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" /></div>;
}

function EmptyState({ icon: Icon, text }: { icon: typeof Clock3; text: string }) {
  return <div className="rounded-[8px] border border-dashed border-[var(--border-default)] px-3 py-6 text-center"><Icon className="mx-auto h-4 w-4 text-[var(--text-tertiary)]" /><p className="mt-2 text-micro leading-4 text-[var(--text-secondary)]">{text}</p></div>;
}
