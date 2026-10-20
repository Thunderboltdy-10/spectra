"use client";

import { Crosshair } from "@/components/icons/glyph-icons";
import { IconButton } from "@/components/ui/icon-button";
import { useEffect } from "react";
import type { SpectraLiveExchange } from "../ai/use-spectra-run";
import { followAiActor, useFollowAi } from "../collaboration/follow-ai";
import { spectraBus } from "../events";
import { useSpectraRouter } from "../hooks/use-spectra-router";
import { ThreadConversation } from "./conversation-surface";
import { StudioSplitShell } from "./artifact-studio-shell";
import { runIdForLiveThread } from "../island/run-tabs";
import { acknowledgeViewportReady } from "../viewport-readiness";
import { threadHref } from "../chat/home-routes";

export function LiveThreadPanel({
  threadId,
  title,
  liveExchange = null,
  width,
  onWidthChange,
  onClose,
  onOpenArtifact,
  onOpenWorkspace,
  overlay,
}: {
  threadId: string;
  title: string;
  liveExchange?: SpectraLiveExchange | null;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
  /** Workbench-row controlled presentation (`resolveWorkbenchPanes`). */
  overlay?: boolean;
}) {
  const follow = useFollowAi();
  const router = useSpectraRouter();
  const state = liveExchange?.status;
  const standing = state === "starting" || state === "streaming" ? "Spectra is working" : state === "waiting" ? "Waiting for you" : null;
  useEffect(() => {
    const frame = requestAnimationFrame(() => acknowledgeViewportReady({
      targetId: threadId,
      view: "conversation",
    }));
    return () => cancelAnimationFrame(frame);
  }, [threadId]);
  return (
    <StudioSplitShell
      width={width}
      onWidthChange={onWidthChange}
      ariaLabel={title || "Thread"}
      cssWidthVariable="--spectra-live-thread-width"
      overlay={overlay}
    >
      <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
        {/* The thread's name, and what Spectra is doing in it while it does something: the island card's header. */}
        <header className="flex h-14 min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b border-[var(--card-border-soft)] pl-5 pr-3">
          <div className="min-w-0 flex-1 overflow-hidden">
            <h2
              className="truncate font-display text-title font-medium leading-6 text-[var(--text-primary)]"
              title={title || "Thread"}
            >
              {title || "Thread"}
            </h2>
            {standing ? (
              <p className="truncate text-micro text-[var(--text-tertiary)]">
                {standing}
              </p>
            ) : null}
          </div>
          {/* The card's own actions (thread-view.tsx): follow the run while it works, open the thread as a page, close. */}
          {standing === "Spectra is working" || follow.following ? (
            <button
              type="button"
              data-spectra-follow-control=""
              onClick={() => {
                if (follow.following) {
                  followAiActor(null);
                  return;
                }
                const actor = liveExchange?.runId ?? runIdForLiveThread(threadId) ?? follow.location?.actorId;
                if (actor) followAiActor(actor);
                else follow.setFollowing(true);
              }}
              className="spectra-follow-toggle shrink-0"
              data-following={follow.following ? "true" : undefined}
              aria-pressed={follow.following}
            >
              <Crosshair className="h-3.5 w-3.5" />
              <span>{follow.following ? "Following" : "Follow AI"}</span>
            </button>
          ) : null}
          <IconButton
            icon="openFull"
            label="Open as page"
            onClick={() => {
              onClose();
              router.push(threadHref(threadId));
            }}
          />
          <IconButton icon="close" label="Close thread" onClick={onClose} />
        </header>
        {/* The island stands over the page beside the Side, never under it, so the thread runs to the bottom. */}
        {/* Pressing the thread turns the island's field to it: the reply is written there, not in a field of its own. */}
        <div
          className="min-h-0 flex-1"
          onClick={(event) => {
            if ((event.target as Element).closest("button, a, input, textarea, select, [role='menuitem']") || window.getSelection()?.toString()) return;
            spectraBus.emit("island.compose", {});
          }}
        >
          <ThreadConversation
            threadId={threadId}
            compact
            liveExchange={liveExchange}
            onOpenArtifact={onOpenArtifact}
            onOpenWorkspace={onOpenWorkspace}
          />
        </div>
      </div>
    </StudioSplitShell>
  );
}
