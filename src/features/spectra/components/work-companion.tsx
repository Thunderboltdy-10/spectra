"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Archive, X } from "@/components/icons/glyph-icons";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingRows, ProblemState } from "@/components/ui/page-state";
import { workTypeMeta } from "../artifacts/presentation";
import { previewExtent, workPreview } from "../artifacts/work-preview";
import { getSpectraThreads, type SpectraArtifact, type SpectraThread } from "../data/api";
import { formatRelativeTime, formatShortDate } from "./spectra-view-model";
import { useWorkPlaces, WorkPlaceLink } from "./work-origin";

/*
 * What the pane says about a work (see studio-pane): its colophon and the
 * conversations about it.
 */

/** One line of the work's colophon: what it records on the left, the record on the right. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 border-t border-[var(--border-subtle)] py-2.5">
      <dt className="text-caption leading-5 text-[var(--text-tertiary)]">{label}</dt>
      <dd className="min-w-0 text-ui leading-5 text-[var(--text-primary)]">{children}</dd>
    </div>
  );
}

/*
 * The work's colophon, as on the last page of a book: what it is and how much
 * it holds, then where it is kept, how it was made, who may read it, and how it
 * is tagged. Its title and description stay on the work itself.
 */
export function WorkDetails({
  work,
  tags,
  onTagsChange,
  onArchive,
  children,
}: {
  work: SpectraArtifact;
  tags?: readonly string[];
  /** Left out when the reader cannot change them. */
  onTagsChange?: (tags: string[]) => void;
  onArchive?: () => void;
  children?: ReactNode;
}) {
  const meta = workTypeMeta[work.blueprintKey];
  const preview = workPreview(work.blueprintKey, work.content);
  const extent = preview ? previewExtent(preview) : null;
  const places = useWorkPlaces(work);
  const source = work.createdFrom?.source;
  const files = work.createdFrom?.sourceAttachmentNames?.length ?? 0;
  const shared = work.sharedWithCount ?? 0;
  const shownTags = tags ?? work.tags ?? [];
  const [tagDraft, setTagDraft] = useState("");
  function addTag() {
    const tag = tagDraft.trim();
    if (!tag || !onTagsChange) return;
    onTagsChange([...new Set([...shownTags, tag])]);
    setTagDraft("");
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3">
      <p className="flex items-center gap-2 text-caption text-[var(--text-secondary)]">
        <Icon name={meta.glyph} size={16} accent={meta.color} />
        <span className="font-medium">{meta.label}</span>
        {extent ? <span className="text-[var(--text-tertiary)]">{extent}</span> : null}
      </p>
      <dl className="mt-4 border-b border-[var(--border-subtle)]">
        <Fact label="Kept in">
          {places.length ? (
            <ul className="space-y-1">
              {places.map((place) => (
                <li key={place.key}>
                  <WorkPlaceLink place={place} className="work-origin" />
                </li>
              ))}
            </ul>
          ) : work.ownership === "shared" ? (
            "Shared with you"
          ) : (
            "Your library"
          )}
        </Fact>
        <Fact label="Made">
          {formatShortDate(work.createdAt)}
          {source ? (
            <span className="block text-caption text-[var(--text-tertiary)]">
              {MADE_FROM[source] ?? "In Spectra"}
              {files ? `, from ${files} file${files === 1 ? "" : "s"}` : ""}
            </span>
          ) : null}
        </Fact>
        <Fact label="Changed">{formatRelativeTime(work.updatedAt)}</Fact>
        <Fact label="Owner">{work.owner?.name ?? "You"}</Fact>
        <Fact label="Access">{work.accessLevel === "read" ? "You can read it" : "You can edit it"}</Fact>
        <Fact label="Shared">{work.isShared ? `With ${shared} ${shared === 1 ? "person" : "people"}` : "Only you"}</Fact>
        {shownTags.length || onTagsChange ? (
          <Fact label="Tags">
            <div className="flex flex-wrap items-center gap-1">
              {shownTags.map((tag) => (
                <span key={tag} data-artifact-tag={tag} className="work-tag">
                  {tag}
                  {onTagsChange ? (
                    <button type="button" aria-label={`Remove ${tag}`} onClick={() => onTagsChange(shownTags.filter((item) => item !== tag))}>
                      <X className="size-3" />
                    </button>
                  ) : null}
                </span>
              ))}
              {onTagsChange ? (
                <input
                  value={tagDraft}
                  aria-label="Add a tag"
                  placeholder="Add a tag"
                  className="work-tag-input"
                  onChange={(event) => setTagDraft(event.target.value)}
                  onBlur={addTag}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== ",") return;
                    event.preventDefault();
                    addTag();
                  }}
                />
              ) : null}
            </div>
          </Fact>
        ) : null}
      </dl>
      {children ? <div className="mt-4">{children}</div> : null}
      {onArchive ? (
        <button type="button" className="reference-text-action -ml-1.5 mt-4" onClick={onArchive}>
          <Archive className="size-3.5" /> Archive this artifact
        </button>
      ) : null}
    </div>
  );
}

/** Where a work came from, in words. */
const MADE_FROM: Record<string, string> = {
  chat: "By Spectra in a thread",
  ai: "By Spectra",
  workspace: "In a workspace",
  artifact: "From another artifact",
  manual: "By you",
};

function CompanionRow({
  glyph,
  accent,
  title,
  meta,
  onOpen,
}: {
  glyph: IconName;
  accent?: string;
  title: string;
  meta?: string;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        data-life-launch
        onClick={onOpen}
        className="flex w-full min-w-0 items-center gap-2.5 rounded-control px-2 py-2 text-left outline-none transition-colors hover:bg-[var(--bg-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring-color)]"
      >
        <Icon name={glyph} size={16} accent={accent} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-medium text-[var(--text-primary)]">{title}</span>
          {meta ? <span className="block truncate text-caption text-[var(--text-tertiary)]">{meta}</span> : null}
        </span>
      </button>
    </li>
  );
}

function aboutWork(thread: SpectraThread, workId: string) {
  return (
    thread.artifactId === workId ||
    thread.contextArtifactIds?.includes(workId)
  );
}

export function WorkConversations({
  work,
  onOpenThread,
}: {
  work: SpectraArtifact;
  onOpenThread: (thread: { id: string; title: string }) => void;
}) {
  const [state, setState] = useState<{ status: "loading" | "ready" | "failed"; threads: SpectraThread[] }>({
    status: "loading",
    threads: [],
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    // The thread list is one request shared by every caller, so it is never
    // aborted here; a panel that has moved on only ignores the answer.
    let current = true;
    setState({ status: "loading", threads: [] });
    getSpectraThreads({ limit: 120, brief: true })
      .then((result) => {
        if (current) setState({ status: "ready", threads: result.threads.filter((thread) => aboutWork(thread, work._id)) });
      })
      .catch(() => {
        if (current) setState({ status: "failed", threads: [] });
      });
    return () => {
      current = false;
    };
  }, [attempt, work._id]);

  if (state.status === "loading") return <LoadingRows label="Loading conversations" count={3} className="pt-2" />;
  if (state.status === "failed")
    return (
      <ProblemState
        compact
        title="Conversations couldn't load"
        detail="Check your connection, then try again."
        action={
          <Button variant="secondary" size="sm" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </Button>
        }
      />
    );
  if (!state.threads.length)
    return (
      <EmptyState
        compact
        icon="conversations"
        title="No conversations yet"
        detail="Ask Spectra about this artifact and the conversation is kept here."
      />
    );
  return (
    <ul className="-mx-1 space-y-0.5 pt-2">
      {state.threads
        .slice()
        .sort((a, b) => (b.lastMessageAt ?? b.updatedAt) - (a.lastMessageAt ?? a.updatedAt))
        .map((thread) => (
          <CompanionRow
            key={thread._id}
            glyph="conversations"
            title={thread.title}
            meta={formatRelativeTime(thread.lastMessageAt ?? thread.updatedAt)}
            onOpen={() => onOpenThread({ id: thread._id, title: thread.title })}
          />
        ))}
    </ul>
  );
}
