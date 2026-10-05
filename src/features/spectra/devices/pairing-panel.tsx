"use client";

import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { PairingState } from "./pairing";

/*
 * Connecting this computer, one step at a time: look for Bridge, offer the
 * download with one sentence and wait for it, then show the code Bridge asks
 * the user to confirm. It continues by itself; the user only installs and
 * confirms.
 */
export function PairingPanel({
  state,
  onCancel,
  onRetry,
}: {
  state: PairingState;
  onCancel: () => void;
  onRetry: () => void;
}) {
  if (state.phase === "idle" || state.phase === "paired") return null;
  return (
    <div
      data-devices-pairing={state.phase}
      role="status"
      aria-live="polite"
      className="rounded-card border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4"
    >
      {state.phase === "checking" || state.phase === "requesting" ? (
        <Waiting text={state.phase === "checking" ? "Looking for Spectra Bridge on this computer." : "Connecting this computer."} onCancel={onCancel} />
      ) : state.phase === "download" ? (
        <div className="space-y-3">
          <p className="text-ui font-medium text-[var(--text-primary)]">Get Spectra Bridge</p>
          <p className="max-w-xl text-caption text-[var(--text-secondary)]">
            Spectra Bridge keeps the folders you choose on this computer in sync: download and open it, and Spectra carries on by itself.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {state.url ? (
              <Button asChild variant="primary" size="sm">
                <a href={state.url} rel="noopener">
                  <Icon name="download" size={16} />
                  Download for {state.platform === "macos" ? "Mac" : "Windows"}
                </a>
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
          <p className="flex items-center gap-2 text-micro text-[var(--text-tertiary)]">
            <Icon name="syncing" size={14} />
            Waiting for Spectra Bridge to start.
          </p>
        </div>
      ) : state.phase === "confirming" ? (
        <div className="space-y-3">
          <p className="text-ui font-medium text-[var(--text-primary)]">Confirm this code on the computer</p>
          <p
            data-devices-code
            aria-label={`Code ${state.shortCode.split("").join(" ")}`}
            className="font-mono text-display font-semibold tracking-[0.2em] text-[var(--text-primary)]"
          >
            {state.shortCode}
          </p>
          <p className="max-w-xl text-caption text-[var(--text-secondary)]">
            Spectra Bridge shows the same code. Confirm it there to connect this computer.
          </p>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-ui font-medium text-[var(--text-primary)]">
            <Icon name="problem" size={16} />
            This computer isn&apos;t connected yet
          </p>
          <p className="max-w-xl text-caption text-[var(--text-secondary)]">{state.message}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

function Waiting({ text, onCancel }: { text: string; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <Icon name="syncing" size={16} />
      <p className="min-w-0 flex-1 text-caption text-[var(--text-secondary)]">{text}</p>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
