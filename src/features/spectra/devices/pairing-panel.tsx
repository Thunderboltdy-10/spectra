"use client";

import { BridgeInstallSteps } from "./bridge-install-steps";
import { useEffect, useRef } from "react";
import { Icon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { life } from "../life/life";
import { STATUS_COLOURS } from "../life/prism";
import { useLifeDeparture, useLifeEntrance, useLifeGlow } from "../life/use-life";
import type { PairingState } from "./pairing";

const PANEL_BARS = "p, [data-devices-code]";
/** This computer, connecting or connected: the pairing card and its row are one thing. */
export const THIS_COMPUTER_LIFE_KEY = "device:this";

/*
 * Connecting this computer, one step at a time: look for Bridge, offer the
 * download with one sentence and wait for it, then show the code Bridge asks
 * the user to confirm. It continues by itself; the user only installs and
 * confirms.
 *
 * Its life (LIFE.md): the panel forms from the Connect press, light breathes
 * round it while it waits for Bridge, each step lands with a pulse (red when
 * it went wrong), and once paired it parts as the computer's row forms.
 */
export function PairingPanel(props: { state: PairingState; onCancel: () => void; onRetry: () => void }) {
  if (props.state.phase === "idle" || props.state.phase === "paired") return null;
  return <PairingCard {...props} state={props.state} />;
}

type ShownState = Exclude<PairingState, { phase: "idle" } | { phase: "paired" }>;

function PairingCard({
  state,
  onCancel,
  onRetry,
}: {
  state: ShownState;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const waiting = state.phase === "checking" || state.phase === "requesting" || state.phase === "download" || state.phase === "confirming";
  useLifeEntrance(ref);
  // Connected: the card flows into this computer's row, which arrives under the same key.
  useLifeDeparture(ref, true, { bars: PANEL_BARS }, THIS_COMPUTER_LIFE_KEY);
  useLifeGlow(ref, waiting);
  const phase = useRef(state.phase);
  useEffect(() => {
    if (phase.current === state.phase) return;
    phase.current = state.phase;
    const r = ref.current?.getBoundingClientRect();
    if (!r?.width) return;
    life.pulse(r.left + r.width / 2, r.top + r.height / 2, 0.6, state.phase === "failed" ? STATUS_COLOURS.problem : "spectrum");
  }, [state.phase]);
  return (
    <div
      ref={ref}
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
            Spectra Bridge keeps the folders you choose on this computer in sync. Download it, then:
          </p>
          <BridgeInstallSteps platform={state.platform} />
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
        <Waiting text="Connecting this computer." onCancel={onCancel} />
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
