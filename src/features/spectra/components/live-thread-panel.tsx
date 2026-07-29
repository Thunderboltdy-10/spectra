"use client";

import { Crosshair, MessageSquare, X } from "lucide-react";
import type { CSSProperties } from "react";
import type { SpectraLiveExchange } from "../ai/use-spectra-run";
import { useFollowAi } from "../collaboration/follow-ai";
import { ThreadConversation } from "./conversation-surface";
import { StudioSplitShell } from "./artifact-studio";

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
}: {
  threadId: string;
  title: string;
  liveExchange?: SpectraLiveExchange | null;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  /** Legacy selection hook; open threads now continue automatically. */
  onContinue?: () => void;
  continuing?: boolean;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenWorkspace?: (workspaceId: string) => void;
}) {
  const follow = useFollowAi();
  return (
    <StudioSplitShell
      width={width}
      onWidthChange={onWidthChange}
      ariaLabel="Live thread"
    >
      <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--border-default)] px-4">
          <span
            className="spectra-card-type-icon !h-8 !w-8 text-[var(--brand-primary)]"
            style={{ "--card-accent": "var(--brand-primary)" } as CSSProperties}
          >
            <MessageSquare className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-[16px] font-semibold text-[var(--text-primary)]">
              {title || "Live thread"}
            </div>
            <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              Live conversation
            </div>
          </div>
          {/* Follow AI is a mode, not a command, so it reads as a pill that
              stays lit rather than as another icon in the row. */}
          <button
            type="button"
            onClick={() => follow.setFollowing(!follow.following)}
            className="spectra-follow-toggle"
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
          {continuing ? (
            <span
              className="spectra-icon-action text-[var(--accent-cyan)]"
              aria-label="Messages automatically continue this thread"
              data-tooltip="Messages continue here"
              title="The next message continues this conversation"
            >
              <MessageSquare className="h-4 w-4" />
            </span>
          ) : onContinue ? (
            <button
              type="button"
              onClick={onContinue}
              className={`spectra-icon-action ${continuing ? "text-[var(--accent-cyan)]" : "text-[var(--text-secondary)] hover:text-[var(--accent-cyan)]"}`}
              aria-label={
                continuing
                  ? "Stop continuing this thread; next message starts a new chat"
                  : "Continue this thread"
              }
              aria-pressed={continuing}
              data-tooltip={
                continuing
                  ? "Stop continuing — start a new chat"
                  : "Continue thread"
              }
              title={
                continuing
                  ? "Deselect this thread so the next message starts a new conversation"
                  : "Select this thread and pin it to the run tabs"
              }
            >
              <MessageSquare className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="spectra-icon-action"
            aria-label="Close live thread"
            data-tooltip="Close thread"
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
              onClick={() => follow.setFollowing(false)}
              className="spectra-follow-strip-stop"
            >
              Stop
            </button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1">
          <ThreadConversation
            threadId={threadId}
            compact
            showComposer={false}
            liveExchange={liveExchange}
            onOpenArtifact={onOpenArtifact}
            onOpenWorkspace={onOpenWorkspace}
          />
        </div>
      </div>
    </StudioSplitShell>
  );
}
