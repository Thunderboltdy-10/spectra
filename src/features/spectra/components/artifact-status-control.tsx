"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Icon, type IconName } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { life, rectOf } from "../life/life";
import { STATUS_COLOURS } from "../life/prism";
import type { Rgb } from "../life/spectrum";
import { useLifeGlow } from "../life/use-life";
import {
  statusMoment,
  type ArtifactStatus,
  type ArtifactStatusActionKind,
  type ArtifactStatusState,
} from "./artifact-status";

/*
 * The status control (EDITORS.md): one glyph at the right end of every
 * artifact header. Changes animate inside the glyph; a word or two slides
 * out of it while something is happening and back in when it is done. Hover
 * says the sentence, a click opens the details and the actions the state
 * allows. The field answers too: a soft pulse when a save lands, light held
 * around it while the desktop copy updates, the problem hue when it fails.
 */

const STATE_NAME: Record<ArtifactStatusState, string> = {
  saved: "Saved",
  saving: "Saving",
  offline: "Offline",
  syncing: "Updating the desktop file",
  waitingOffice: "Waiting for Office",
  readOnly: "Read only",
  versions: "Two versions",
  problem: "Problem",
};

/** How long a glyph plays its change, and how long words take to slide back. */
const CHANGE_MS = 900;
const WORDS_OUT_MS = 200;

/** The info hue: light held while the desktop copy catches up. */
const SYNC_LIGHT: Rgb = [79, 159, 230];

export function ArtifactStatusControl({
  status,
  onAction,
  busy = false,
  details,
}: {
  status: ArtifactStatus;
  onAction: (kind: ArtifactStatusActionKind) => void;
  /** An action is running: the popover's buttons wait. */
  busy?: boolean;
  /** Extra detail for the popover, such as the two versions side by side. */
  details?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  const changed = useChanged(status.state);
  const glyphs = useGlyphCrossfade(status.glyph);
  const words = useLingeringWords(status.words);

  useStatusLife(buttonRef, status.state);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip label={status.sentence} side="bottom">
        <PopoverTrigger asChild>
          <button
            ref={buttonRef}
            type="button"
            className="spectra-status-control"
            data-status={status.state}
            data-words={words.text ? (words.leaving ? "leaving" : "shown") : undefined}
            aria-label={`Status: ${(status.name ?? STATE_NAME[status.state])}`}
            aria-describedby={descriptionId}
            style={{ "--status-hue": status.hue } as CSSProperties}
          >
            <span className="spectra-status-glyph" aria-hidden>
              {glyphs.map((glyph) => (
                <span key={glyph.key} className="spectra-status-glyph-layer" data-leaving={glyph.leaving || undefined}>
                  <Icon name={glyph.name} size={16} accent={status.hue} animate={!glyph.leaving && (status.running || changed)} />
                </span>
              ))}
            </span>
            {words.text ? (
              <span className="spectra-status-words" aria-hidden>
                {words.text}
              </span>
            ) : null}
            <span id={descriptionId} hidden>
              {status.sentence}
            </span>
          </button>
        </PopoverTrigger>
      </Tooltip>
      <span className="sr-only" role="status" aria-live="polite">
        {status.words ?? ""}
      </span>
      <PopoverContent align="end" className="spectra-status-popover w-[19rem] p-0" aria-label="Status details">
        <div className="spectra-status-popover-head">
          <span className="spectra-status-popover-glyph" style={{ color: status.hue }}>
            <Icon name={status.glyph} size={20} accent={status.hue} animate={status.running} />
          </span>
          <div className="min-w-0">
            <p className="text-caption font-semibold text-[var(--text-primary)]">{(status.name ?? STATE_NAME[status.state])}</p>
            <p className="text-micro leading-4 text-[var(--text-secondary)]">{status.sentence}</p>
          </div>
        </div>
        {status.facts.length ? (
          <dl className="spectra-status-facts">
            {status.facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {details ? <div className="spectra-status-details">{details}</div> : null}
        {status.actions.length ? (
          <div className="spectra-status-actions" role="group" aria-label="Status actions">
            {status.actions.map((action, index) => (
              <button
                key={action.kind}
                type="button"
                disabled={busy}
                data-primary={index === 0 && (status.state === "versions" || status.state === "problem") ? "true" : undefined}
                onClick={() => {
                  onAction(action.kind);
                  if (action.kind !== "compare") setOpen(false);
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** True for a moment after the state changes, so the glyph plays its change once. */
function useChanged(state: ArtifactStatusState) {
  const [changedAt, setChangedAt] = useState<{ state: ArtifactStatusState; at: number } | null>(null);
  const previous = useRef(state);
  useEffect(() => {
    if (previous.current === state) return;
    previous.current = state;
    setChangedAt({ state, at: Date.now() });
    const timer = window.setTimeout(() => setChangedAt(null), CHANGE_MS);
    return () => window.clearTimeout(timer);
  }, [state]);
  return changedAt?.state === state;
}

type GlyphLayer = { key: number; name: IconName; leaving: boolean };

/** The old glyph fades as the new one grows in its place, inside the same square. */
function useGlyphCrossfade(name: IconName): GlyphLayer[] {
  const [layers, setLayers] = useState<GlyphLayer[]>([{ key: 0, name, leaving: false }]);
  const next = useRef(1);
  useEffect(() => {
    setLayers((current) => {
      const live = current.find((layer) => !layer.leaving);
      if (live?.name === name) return current;
      const key = next.current++;
      return [...current.filter((layer) => !layer.leaving).map((layer) => ({ ...layer, leaving: true })), { key, name, leaving: false }];
    });
    const timer = window.setTimeout(() => {
      setLayers((current) => (current.some((layer) => layer.leaving) ? current.filter((layer) => !layer.leaving) : current));
    }, 240);
    return () => window.clearTimeout(timer);
  }, [name]);
  return layers;
}

/** Words stay while they slide back into the glyph, then go. */
function useLingeringWords(words: string | undefined) {
  const [shown, setShown] = useState<{ text?: string; leaving: boolean }>({ text: words, leaving: false });
  useEffect(() => {
    if (words) {
      setShown({ text: words, leaving: false });
      return;
    }
    setShown((current) => (current.text ? { text: current.text, leaving: true } : current));
    const timer = window.setTimeout(() => setShown({ text: undefined, leaving: false }), WORDS_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [words]);
  return shown;
}

/** The field's answer to the work's state (LIFE.md: pulse, glow). */
function useStatusLife(ref: RefObject<HTMLElement | null>, state: ArtifactStatusState) {
  const previous = useRef<ArtifactStatusState | null>(null);
  useLifeGlow(ref, state === "syncing", SYNC_LIGHT, 0.55);
  useLifeGlow(ref, state === "problem" || state === "versions", STATUS_COLOURS.problem, 0.35);
  useEffect(() => {
    const before = previous.current;
    previous.current = state;
    const moment = statusMoment(before, state);
    const element = ref.current;
    if (!moment || !element || !life.on) return;
    const rect = rectOf(element);
    const x = rect.x + Math.min(rect.width, 24) / 2;
    const y = rect.y + rect.height / 2;
    if (moment === "settle") life.pulse(x, y, 0.4, STATUS_COLOURS.done);
    else if (moment === "alarm") life.pulse(x, y, 0.7, STATUS_COLOURS.problem);
    else life.pulse(x, y, 0.5, STATUS_COLOURS.needs);
  }, [ref, state]);
}
