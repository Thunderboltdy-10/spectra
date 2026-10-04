"use client";

import { Crosshair, MessageSquare, Play, X } from "lucide-react";
import { useEffect, type CSSProperties } from "react";
import type { SpectraLiveExchange } from "../ai/use-spectra-run";
import { followAiActor, useFollowAi } from "../collaboration/follow-ai";
import { ThreadConversation } from "./conversation-surface";
import { StudioSplitShell } from "./artifact-studio-shell";
import { runIdForLiveThread } from "../island/run-tabs";
import { acknowledgeViewportReady } from "../viewport-readiness";

export function LiveThreadPanel({
  threadId,
  title,
  liveExchange = null,
  width,
  onWidthChange,
  onClose,
  onContinue,
  continuing = false,
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
  /** Select or remove this saved conversation as composer continuation. */
  onContinue?: () => void;
  continuing?: boolean;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
  /** Workbench-row controlled presentation (`resolveWorkbenchPanes`). */
  overlay?: boolean;
}) {
  const follow = useFollowAi();
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
      ariaLabel="Live chat"
      cssWidthVariable="--spectra-live-thread-width"
      overlay={overlay}
    >
      <div className="spectra-composer-clearance flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
        <header className="flex h-14 min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b border-[var(--border-default)] px-4">
          <span
            className="spectra-card-type-icon !h-8 !w-8 shrink-0 text-[var(--brand-primary)]"
            style={{ "--card-accent": "var(--brand-primary)" } as CSSProperties}
          >
            <MessageSquare className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1 overflow-hidden">
            <div
              className="truncate font-display text-editor font-semibold text-[var(--text-primary)]"
              title={title || "Live chat"}
            >
              {title || "Live chat"}
            </div>
            <div className="truncate text-micro font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              Live chat
            </div>
          </div>
          {/* Follow AI is a mode, not a command, so it reads as a pill that
              stays lit rather than as another icon in the row. */}
          <button
            type="button"
            data-spectra-follow-control=""
            onClick={() => {
              if (follow.following) {
                followAiActor(null);
                return;
              }
              const actor =
                liveExchange?.runId ??
                runIdForLiveThread(threadId) ??
                follow.location?.actorId;
              if (actor) followAiActor(actor);
              else follow.setFollowing(true);
            }}
            className="spectra-follow-toggle shrink-0"
            data-following={follow.following ? "true" : undefined}
            aria-label={
              follow.following
                ? "Stop following the AI"
                : "Follow the AI as it works"
            }
            aria-pressed={follow.following}
            title={
              follow.following
                ? "Stop spectating and keep your own view"
                : "Spectate the AI: open and reveal whatever it is working on"
            }
          >
            <Crosshair className="h-3.5 w-3.5" />
            <span>{follow.following ? "Following" : "Follow AI"}</span>
          </button>
          {onContinue || continuing ? (
            <button
              type="button"
              onClick={() => onContinue?.()}
              className={`spectra-icon-action ${continuing ? "is-selected" : ""}`}
              aria-label={
                continuing
                  ? "Stop continuing this chat in the Live Dock"
                  : "Continue this chat in the Live Dock"
              }
              aria-pressed={continuing}
              data-tooltip={continuing ? "Stop continuing" : "Continue in Live Dock"}
              title={
                continuing
                  ? "Stop continuing this chat"
                  : "Continue this chat in the Live Dock"
              }
            >
              <Play className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="spectra-icon-action"
            aria-label="Close live chat"
            data-tooltip="Close chat"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        {/* Spectating is a state the user is in, so it says so — and says what
            it is watching. Any direct interaction elsewhere disengages it. */}
        {follow.following && (follow.location || liveExchange) ? (
          <div className="spectra-follow-strip" role="status">
            <span className="spectra-follow-strip-pip" aria-hidden="true" />
            <span className="spectra-follow-strip-text">
              {follow.location?.note ??
                (follow.location
                  ? "Following the AI"
                  : "Waiting for the AI to start")}
            </span>
            <button
              type="button"
              data-spectra-follow-control=""
              onClick={() => followAiActor(null)}
              className="spectra-follow-strip-stop"
            >
              Stop
            </button>
          </div>
        ) : null}
        {/* The floating composer band spans the full row width, including
            under this panel — keep the conversation above it. */}
        <div className="min-h-0 flex-1">
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
