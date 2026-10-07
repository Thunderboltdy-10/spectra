"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { EmptyState, LoadingRows, ProblemState } from "@/components/ui/page-state";
import { PanelTabs, SidePanel } from "@/components/ui/side-panel";
import { useLifeLanding } from "../life/use-life";
import { workTypeMeta } from "../artifacts/presentation";
import { getSpectraThreads, type SpectraArtifact, type SpectraThread } from "../data/api";
import { spectraBus } from "../events";
import { isArtifactTypeKey } from "../artifacts/registry";
import { useRelated } from "../semantic/use-semantic";
import type { RelatedReason } from "../semantic/types";
import { artifactPlacements, formatRelativeTime } from "./spectra-view-model";
import { previewText } from "./preview-text";
import { WorkbenchInspectorTabs } from "./workbench-inspector-tabs";
import { expectLanding } from "../anchors/open-anchor";
import { regionOfResult } from "../anchors/locate";

/*
 * The companion (SHELL.md, "Workspace and fullscreen"): everything about a
 * piece of work that is not the work itself. Beside a fullscreen work it is a
 * collapsible Side panel; for work held in the Side it comes in as an inner
 * sheet over that work, and Esc or Back returns to it.
 */

export type CompanionTab = "details" | "comments" | "activity" | "related" | "conversations";

const TABS: ReadonlyArray<{ id: CompanionTab; label: string; icon: IconName }> = [
  { id: "details", label: "Details", icon: "info" },
  { id: "comments", label: "Comments", icon: "reply" },
  { id: "activity", label: "Activity", icon: "activity" },
  { id: "related", label: "Related", icon: "link" },
  { id: "conversations", label: "Conversations", icon: "conversations" },
];

type CompanionProps = {
  work: SpectraArtifact;
  artifacts: SpectraArtifact[];
  tab: CompanionTab;
  onTabChange: (tab: CompanionTab) => void;
  onOpenWork: (work: SpectraArtifact) => void;
  onOpenThread: (thread: { id: string; title: string }) => void;
};

const subscribeThreadsView = (listener: () => void) => spectraBus.subscribe("threads.view", listener);
const threadsViewOpen = () => Boolean(spectraBus.getQuery("threads.view")?.open);
const threadsViewClosed = () => false;

function CompanionTabs({ tab, onTabChange }: Pick<CompanionProps, "tab" | "onTabChange">) {
  return <PanelTabs label="About this work" tabs={TABS} value={tab} onChange={(id) => onTabChange(id as CompanionTab)} />;
}

/** Beside a fullscreen work. The threads view, while open, takes its place. */
export function WorkCompanionPanel({ revealKey, ...props }: CompanionProps & { revealKey?: number | null }) {
  const threadsOpen = useSyncExternalStore(subscribeThreadsView, threadsViewOpen, threadsViewClosed);
  if (threadsOpen) return null;
  return (
    <SidePanel
      id="workspace.companion"
      title="About this work"
      icon="info"
      stageMin={640}
      defaultWidth={380}
      revealKey={revealKey}
      header={<CompanionTabs tab={props.tab} onTabChange={props.onTabChange} />}
    >
      <CompanionBody {...props} />
    </SidePanel>
  );
}

/**
 * For work held in the Side: the companion slides in over most of it, leaving
 * a dimmed strip of the work showing. Esc, Back or the strip returns.
 * `rootRef` is searched for the Side's work panel, which the sheet is drawn into.
 */
export function CompanionSheet({
  rootRef,
  onClose,
  onOpenFull,
  ...props
}: CompanionProps & { rootRef: RefObject<HTMLElement | null>; onClose: () => void; onOpenFull: () => void }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  // After the commit, so the root's ref is attached even when both mount together.
  useEffect(() => {
    setHost(rootRef.current?.querySelector<HTMLElement>("[data-studio-panel][aria-label='Work studio']") ?? null);
  }, [rootRef, props.work._id]);
  useLifeLanding(sheetRef, host ? `companion:${props.work._id}` : null);
  useEffect(() => {
    if (!host) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    backRef.current?.focus();
    return () => before?.focus();
  }, [host]);
  if (!host) return null;
  return createPortal(
    <div
      className="absolute inset-0 z-panel flex"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
    >
      <button
        type="button"
        aria-label="Back to the work"
        tabIndex={-1}
        onClick={onClose}
        className="h-full w-[22%] shrink-0 bg-[var(--bg-overlay)] transition-opacity"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-label={`About ${props.work.title}`}
        className="flex h-full min-w-0 flex-1 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-primary)] shadow-[var(--shadow-lg)]"
      >
        <div className="shrink-0 px-3 pt-2">
          <div className="flex min-h-10 items-center gap-1.5">
            <IconButton ref={backRef} icon="arrowLeft" label="Back to the work" onClick={onClose} />
            <h2 className="min-w-0 flex-1 truncate text-ui font-semibold text-[var(--text-primary)]">About this work</h2>
            <IconButton icon="openFull" label="Open full" onClick={onOpenFull} />
          </div>
          <CompanionTabs tab={props.tab} onTabChange={props.onTabChange} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
          <CompanionBody {...props} />
        </div>
      </div>
    </div>,
    host,
  );
}

function CompanionBody({ work, artifacts, tab, onOpenWork, onOpenThread }: CompanionProps) {
  if (tab === "details") return <WorkDetails work={work} />;
  if (tab === "comments") return <WorkbenchInspectorTabs work={work} section="comments" overview={null} />;
  if (tab === "activity") return <WorkbenchInspectorTabs work={work} section="history" overview={null} />;
  if (tab === "related") return <RelatedWork work={work} artifacts={artifacts} onOpenWork={onOpenWork} />;
  return <WorkConversations work={work} onOpenThread={onOpenThread} />;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-caption text-[var(--text-tertiary)]">{label}</dt>
      <dd className="min-w-0 truncate text-right text-ui text-[var(--text-primary)]">{children}</dd>
    </div>
  );
}

export function WorkDetails({ work }: { work: SpectraArtifact }) {
  const meta = workTypeMeta[work.blueprintKey];
  const placements = artifactPlacements(work);
  const source = work.createdFrom?.source;
  const files = work.createdFrom?.sourceAttachmentNames?.length ?? 0;
  return (
    <div className="px-1 pb-4 pt-3">
      <span className="inline-flex items-center gap-2 text-caption font-medium text-[var(--text-secondary)]">
        <Icon name={meta.glyph} size={16} accent={meta.color} />
        {meta.label}
      </span>
      <h3 className="mt-2 text-title font-semibold leading-tight text-[var(--text-primary)]">{work.title}</h3>
      <p className="mt-1 text-caption text-[var(--text-tertiary)]">Updated {formatRelativeTime(work.updatedAt)}</p>
      <p className="mt-4 text-ui leading-6 text-[var(--text-secondary)]">{previewText(work.summary, "No description yet.")}</p>
      <dl className="mt-4 border-t border-[var(--border-subtle)] pt-3">
        <Fact label="Owner">{work.owner?.name ?? "You"}</Fact>
        <Fact label="You can">{work.accessLevel === "read" ? "Read" : "Edit"}</Fact>
        <Fact label="Shared with">
          {work.isShared ? `${work.sharedWithCount ?? 0} ${work.sharedWithCount === 1 ? "person" : "people"}` : "Only you"}
        </Fact>
        <Fact label="In">{placements.length ? placements.map((placement) => placement.workspaceTitle).join(", ") : "General"}</Fact>
      </dl>
      {source ? (
        <p className="mt-3 text-caption leading-5 text-[var(--text-tertiary)]">
          Made from {source.replaceAll("_", " ")}
          {files ? ` with ${files} file${files === 1 ? "" : "s"}` : ""}.
        </p>
      ) : null}
    </div>
  );
}

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

/** Why a related work is listed, in a few words. */
export function relatedReasonText(reasons: readonly RelatedReason[]) {
  const link = reasons.find((reason) => reason.type === "link");
  if (link?.type === "link") return link.label?.trim() || (link.direction === "outgoing" ? "Linked from this work" : "Links to this work");
  return reasons.some((reason) => reason.type === "similar") ? "Similar" : null;
}

/**
 * Related work (HARNESS.md, "Semantic layer"): explicit links first, then the
 * nearest neighbours by meaning, each saying why it is listed.
 */
function RelatedWork({
  work,
  artifacts,
  onOpenWork,
}: {
  work: SpectraArtifact;
  artifacts: SpectraArtifact[];
  onOpenWork: (work: SpectraArtifact) => void;
}) {
  const related = useRelated(work._id, { limit: 12 });
  const works = related.results.filter((result) => result.kind === "artifact" && result.itemId !== work._id);
  if (related.status === "idle" || (related.status === "loading" && !works.length))
    return <LoadingRows label="Finding related work" count={3} className="pt-2" />;
  if (related.status === "error")
    return (
      <ProblemState
        compact
        title="Related work couldn't load"
        detail="Check your connection, then try again."
        action={
          <Button variant="secondary" size="sm" onClick={related.refresh}>
            Try again
          </Button>
        }
      />
    );
  if (!works.length)
    return (
      <EmptyState
        compact
        icon="link"
        title="Nothing related yet"
        detail="Work this one links to, work that links here, and work about the same things shows up here."
      />
    );
  const byId = new Map(artifacts.map((artifact) => [artifact._id, artifact]));
  return (
    <>
      {related.degraded && related.degraded !== "index_partial" ? (
        <p role="status" className="px-1 pt-2 text-caption text-[var(--text-tertiary)]">Showing linked work only right now.</p>
      ) : null}
      <ul className="-mx-1 space-y-0.5 pt-2">
        {works.map((result) => {
          const meta = result.subtype && isArtifactTypeKey(result.subtype) ? workTypeMeta[result.subtype] : null;
          const why = relatedReasonText(result.reasons);
          const known = byId.get(result.itemId);
          return (
            <CompanionRow
              key={result.itemId}
              glyph={meta?.glyph ?? "document"}
              accent={meta?.color}
              title={result.title}
              meta={[why, meta?.label ?? result.typeLabel, result.updatedAt ? formatRelativeTime(result.updatedAt) : null].filter(Boolean).join(" · ")}
              onOpen={() => {
                const region = regionOfResult(result);
                if (known) {
                  expectLanding(result.itemId, region);
                  onOpenWork(known);
                } else void spectraBus.command("work.open", { workId: result.itemId, surface: "panel", ...(region ? { region } : {}) });
              }}
            />
          );
        })}
      </ul>
    </>
  );
}

function aboutWork(thread: SpectraThread, workId: string) {
  return (
    thread.artifactId === workId ||
    thread.contextArtifactIds?.includes(workId) ||
    thread.contexts?.artifacts?.some((item) => item.id === workId)
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
    const controller = new AbortController();
    setState({ status: "loading", threads: [] });
    getSpectraThreads({ limit: 120, signal: controller.signal })
      .then((result) => setState({ status: "ready", threads: result.threads.filter((thread) => aboutWork(thread, work._id)) }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "failed", threads: [] });
      });
    return () => controller.abort();
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
        detail="Ask Spectra about this work and the conversation is kept here."
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
