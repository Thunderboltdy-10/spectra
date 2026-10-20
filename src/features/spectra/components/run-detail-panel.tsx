"use client";

import { Loader2, MessageSquarePlus, RotateCcw, Check, ExternalLink, Maximize2, MessageSquare, X, BookmarkPlus, type GlyphIcon } from "@/components/icons/glyph-icons";
import { useEffect, useMemo, useState } from "react";
import { useSpectraRouter as useRouter } from "@/features/spectra/hooks/use-spectra-router";
import { toast } from "@/components/ui/toast";
import { spectraBus } from "../events";
import {
  ConversationSurface,
  ThreadConversation,
} from "./conversation-surface";
import { StudioSplitShell } from "./artifact-studio-shell";
import {
  getSpectraRunDetail,
  postSpectra,
  type SpectraRunDetail,
  type SpectraThreadDetail,
} from "../data/api";
import type { ResultCardStreamView } from "../ai/stream-events";
import { deriveLiveDockTab, liveDockStateCopy } from "../runs/live-dock";
import { IconAction } from "./card-system";
import { threadHref } from "../chat/home-routes";

function legacyRunDetail(detail: SpectraRunDetail): SpectraThreadDetail {
  const run = detail.run;
  const assistantContent =
    run.finalSummary ??
    run.error ??
    detail.cards[0]?.summary ??
    "Spectra is working on this request.";
  const threadId = `run:${run._id}`;
  return {
    thread: {
      _id: threadId,
      title: run.userPrompt.split(/\s+/).slice(0, 8).join(" "),
      origin: run.sourceSurface,
      workspaceId: run.workspaceId,
      artifactId: run.artifactId,
      status: "active",
      messageCount: 2,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    },
    messages: [
      {
        _id: `run:user:${run._id}`,
        threadId,
        role: "user",
        content: run.userPrompt,
        runId: run._id,
        createdAt: run.createdAt,
      },
      {
        _id: `run:assistant:${run._id}`,
        threadId,
        role: "assistant",
        content: assistantContent,
        runId: run._id,
        createdAt: run.updatedAt,
      },
    ],
    traces: [
      {
        run,
        operations: detail.operations,
        cards: detail.cards,
        artifacts: [],
      },
    ],
    viewerName: "You",
  };
}

export function RunDetailPanel({
  runId,
  card,
  onClose,
  onAction,
  onUseThread,
  onSaved,
  overlay,
  width: controlledWidth,
  onWidthChange,
}: {
  runId: string;
  card?: ResultCardStreamView;
  onClose: () => void;
  onAction?: (
    card: ResultCardStreamView,
    actionKey: string,
    targetId?: string,
  ) => void;
  onUseThread?: (threadId: string, title: string) => void;
  onSaved?: (threadId: string) => void;
  /** Workbench-row controlled presentation (`resolveWorkbenchPanes`). */
  overlay?: boolean;
  /** Workbench-row allocated width (`allocateWorkbenchPanes`). */
  width?: number;
  onWidthChange?: (width: number) => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<SpectraRunDetail | null>(null);
  const [busy, setBusy] = useState<"keep" | "continue" | null>(null);
  const [internalWidth, setInternalWidth] = useState(680);
  const width = controlledWidth ?? internalWidth;
  const setWidth = onWidthChange ?? setInternalWidth;
  useEffect(() => {
    let active = true;
    void getSpectraRunDetail(runId)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((error) =>
        toast.error(
          error instanceof Error ? error.message : "Could not load run.",
        ),
      );
    return () => {
      active = false;
    };
  }, [runId, card?.updatedAt]);
  const conversation = useMemo(() => {
    if (!detail) return null;
    return legacyRunDetail(detail);
  }, [detail]);
  const persistedCard = detail?.cards[0];
  const isPermanent = Boolean(detail?.run.threadId);
  const displayCard: ResultCardStreamView | undefined = useMemo(
    () =>
      card ??
      (persistedCard
        ? {
            id: persistedCard._id,
            runId: persistedCard.runId,
            status: persistedCard.status,
            title: persistedCard.title,
            summary: persistedCard.summary,
            variant: persistedCard.variant,
            actions: persistedCard.actions,
            provenance: persistedCard.provenance,
            updatedAt: persistedCard.updatedAt,
          }
        : undefined),
    [card, persistedCard],
  );
  /* The header speaks the dock's one run vocabulary (CANON R13) — never a
     raw status enum with the underscores stripped. */
  const runTruth = useMemo(() => {
    if (!detail) return null;
    return deriveLiveDockTab({
      runId: detail.run._id,
      threadId: detail.run.threadId ?? "",
      run: detail.run,
      card: displayCard ?? null,
    });
  }, [detail, displayCard]);

  async function keep(
    placeInWorkspace: boolean,
    navigate: boolean,
    createReference = true,
  ) {
    setBusy(navigate ? "continue" : "keep");
    try {
      const result = await postSpectra<{ threadId: string }>({
        action: "keepRunAsThread",
        runId,
        placeInWorkspace,
        createReference,
      });
      spectraBus.emit("threads.changed", {});
      if (navigate)
        router.push(threadHref(result.threadId));
      else
        toast.success(
          placeInWorkspace
            ? "Thread kept and placed in this workspace."
            : "Thread kept.",
        );
      onSaved?.(result.threadId);
      return result.threadId;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not keep thread.",
      );
    } finally {
      setBusy(null);
    }
    return null;
  }

  function runActionIcon(key: string): GlyphIcon {
    if (key === "retry") return RotateCcw;
    if (key === "confirm") return Check;
    if (key === "cancel" || key === "reject") return X;
    return ExternalLink;
  }

  return (
    <StudioSplitShell
      width={width}
      onWidthChange={setWidth}
      ariaLabel="Chat panel"
      cssWidthVariable="--spectra-run-panel-width"
      overlay={overlay}
    >
      {/* The floating composer band spans the full row width, including under
          this panel — the clearance keeps the conversation and the action
          footer above it. */}
      <div className="spectra-composer-clearance flex h-full min-h-0 flex-col">
        <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--bg-elevated))] text-[var(--brand-primary)]">
              <MessageSquare className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate font-display text-title font-semibold">
                {conversation?.thread.title ?? "Conversation"}
              </div>
              <div className="text-micro text-[var(--text-tertiary)]">
                Chat · {runTruth ? liveDockStateCopy[runTruth.state] : "Loading"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <IconAction
              icon={busy === "continue" ? Loader2 : Maximize2}
              label="Open in Chat"
              disabled={busy !== null}
              className={busy === "continue" ? "animate-spin" : undefined}
              onClick={() => {
                if (detail?.run.threadId)
                  router.push(
                    threadHref(detail.run.threadId),
                  );
                else void keep(false, true, false);
              }}
            />
            <IconAction icon={X} label="Close" onClick={onClose} />
          </div>
        </header>
        <div className="min-h-0 flex-1">
          {detail?.run.threadId ? (
            <ThreadConversation
              threadId={detail.run.threadId}
              compact
            />
          ) : conversation ? (
            <ConversationSurface detail={conversation} compact />
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-caption text-[var(--text-tertiary)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading chat
            </div>
          )}
        </div>
        <footer className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)] p-3">
          {displayCard?.actions.some((action) => action.key === "confirm") ? (
            <div
              data-spectra-card="result"
              data-card-state="confirmation"
              className="mb-2 px-3 py-2"
            >
              <div className="text-micro font-semibold text-[var(--text-primary)]">
                Proposed changes need approval
              </div>
              <p className="mt-1 text-micro leading-4 text-[var(--text-secondary)]">
                Accept only if the affected objects and workspace placement look
                right.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="h-8 rounded-control bg-[var(--text-primary)] px-3 text-micro font-semibold text-[var(--bg-primary)]"
                  onClick={() =>
                    onAction?.(displayCard, "confirm", displayCard.runId)
                  }
                >
                  Apply changes
                </button>
                <button
                  type="button"
                  className="h-8 rounded-control px-3 text-micro font-semibold text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]"
                  onClick={() =>
                    onAction?.(displayCard, "cancel", displayCard.runId)
                  }
                >
                  Reject proposal
                </button>
              </div>
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            {displayCard?.actions.map((action, index) => {
              const Icon = runActionIcon(action.key);
              return (
                <IconAction
                  key={`${action.key}:${action.targetId ?? index}`}
                  icon={Icon}
                  label={action.label}
                  active={action.key === "confirm"}
                  danger={action.key === "cancel" || action.key === "reject"}
                  onClick={() =>
                    onAction?.(displayCard, action.key, action.targetId)
                  }
                />
              );
            })}
            {!isPermanent ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  const place = Boolean(detail?.run.workspaceId);
                  void keep(place, false, place);
                }}
                className="flex h-9 items-center gap-2 rounded-control border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-micro font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                aria-label={
                  detail?.run.workspaceId
                    ? "Save conversation to workspace"
                    : "Save conversation"
                }
              >
                {busy === "keep" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <BookmarkPlus className="h-4 w-4" />
                )}
                {detail?.run.workspaceId
                  ? "Save to workspace"
                  : "Save conversation"}
              </button>
            ) : null}
            {!isPermanent && onUseThread ? (
              <IconAction
                icon={busy === "keep" ? Loader2 : MessageSquarePlus}
                label="Continue chat"
                active
                disabled={busy !== null}
                className={busy === "keep" ? "animate-spin" : undefined}
                onClick={() =>
                  void keep(false, false, false).then((threadId) => {
                    if (!threadId) return;
                    onUseThread(
                      threadId,
                      conversation?.thread.title ?? "Conversation",
                    );
                    onClose();
                  })
                }
              />
            ) : null}
          </div>
        </footer>
      </div>
    </StudioSplitShell>
  );
}
