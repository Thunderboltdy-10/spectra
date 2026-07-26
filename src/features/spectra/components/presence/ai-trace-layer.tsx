"use client";

/**
 * AI change traces, painted as an overlay.
 *
 * After an AI operation lands, the exact fields it changed keep a calm mark:
 * a hairline rule, a barely-there tint, and a small sparkle chip that opens the
 * attribution and the revert affordance. Because traces resolve through the same
 * semantic geometry as cursors, every artifact editor inherits them without any
 * per-editor code — and a trace can never drift onto the parent card, which is
 * the failure this replaces.
 *
 * The content underneath stays fully editable. Nothing needs accepting.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import {
  dismissAiTrace,
  reviewAiTrace,
  useAiTraces,
  type AiTrace,
} from "../../collaboration/ai-trace";
import {
  resolvePlacement,
  resolveSurfaceFrame,
  SURFACE_ATTRIBUTE,
  type SurfaceBox,
} from "../../collaboration/interaction-geometry";
import { PRESENCE_PALETTE } from "../../collaboration/interaction-model";

type PositionedTrace = {
  trace: AiTrace;
  box: SurfaceBox;
};

function traceColor(trace: AiTrace): string {
  const seed = trace.ownerAccountId || trace.actorLabel;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index);
    hash |= 0;
  }
  return PRESENCE_PALETTE[Math.abs(hash) % PRESENCE_PALETTE.length]!;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function AiTraceLayer({
  artifactId,
  onRevert,
}: {
  artifactId: string;
  /**
   * Restore the pre-AI value through the artifact's proper history state. The
   * trace only ever asks; it never writes to the document itself.
   */
  onRevert?: (trace: AiTrace) => void;
}) {
  const traces = useAiTraces(artifactId);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [positioned, setPositioned] = useState<PositionedTrace[]>([]);
  const [openTraceId, setOpenTraceId] = useState<string | null>(null);

  const signature = useMemo(
    () => traces.map((trace) => `${trace.id}:${trace.status}`).join("|"),
    [traces],
  );

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    if (!traces.length) {
      setPositioned((previous) => (previous.length ? [] : previous));
      return;
    }
    const surface = anchor.closest<HTMLElement>(`[${SURFACE_ATTRIBUTE}]`);
    if (!surface) return;

    let frame = 0;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const surfaceFrame = resolveSurfaceFrame(surface, anchor);
      const next: PositionedTrace[] = [];
      for (const trace of traces) {
        const placement = resolvePlacement(surfaceFrame, { target: trace.target });
        // A trace whose control is not on screen simply does not paint. It stays
        // in the store, so switching back to that slide or sheet shows it again.
        if (!placement || placement.offSurface) continue;
        if (placement.precision !== "exact") continue;
        next.push({ trace, box: placement.box });
      }
      setPositioned((previous) => (sameTraces(previous, next) ? previous : next));
      frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
    };
  }, [traces, signature]);

  // A fresh trace animates in once, then becomes a quiet mark. Nothing loops.
  useEffect(() => {
    const fresh = traces.filter((trace) => trace.status === "fresh");
    if (!fresh.length) return;
    const timer = window.setTimeout(() => {
      for (const trace of fresh) reviewAiTrace(artifactId, trace.id);
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [artifactId, traces]);

  return (
    <div ref={anchorRef} className="spectra-trace-layer">
      {positioned.map(({ trace, box }) => {
        const color = traceColor(trace);
        const open = openTraceId === trace.id;
        return (
          <div
            key={trace.id}
            className="spectra-trace"
            data-status={trace.status}
            style={
              {
                "--presence-color": color,
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
              } as React.CSSProperties
            }
          >
            <span className="spectra-trace-rule" />
            <button
              type="button"
              className="spectra-trace-chip"
              aria-label={`${trace.actorLabel} changed this`}
              aria-expanded={open}
              onClick={() => setOpenTraceId(open ? null : trace.id)}
            >
              <svg viewBox="0 0 12 12" width="8" height="8" aria-hidden="true">
                <path
                  d="M6 0.6 7 4.3 10.6 5.4 7 6.5 6 10.2 5 6.5 1.4 5.4 5 4.3z"
                  fill="currentColor"
                />
              </svg>
            </button>
            {open && (
              <div className="spectra-trace-card" role="dialog">
                <div className="spectra-trace-card-head">
                  <span className="spectra-trace-card-actor">
                    {trace.actorLabel}
                  </span>
                  <span className="spectra-trace-card-time">
                    {relativeTime(trace.changedAt)}
                  </span>
                </div>
                <p className="spectra-trace-card-summary">{trace.summary}</p>
                {typeof trace.previousValue === "string" &&
                  trace.previousValue.trim() && (
                    <p className="spectra-trace-card-previous">
                      <span className="spectra-trace-card-previous-label">
                        Was
                      </span>
                      <s>{truncate(trace.previousValue, 160)}</s>
                    </p>
                  )}
                <div className="spectra-trace-card-actions">
                  {onRevert && (
                    <button
                      type="button"
                      className="spectra-trace-action"
                      onClick={() => {
                        onRevert(trace);
                        setOpenTraceId(null);
                      }}
                    >
                      <RotateCcw className="h-3 w-3" />
                      Restore previous
                    </button>
                  )}
                  <button
                    type="button"
                    className="spectra-trace-action"
                    data-primary="true"
                    onClick={() => {
                      dismissAiTrace(artifactId, trace.id);
                      setOpenTraceId(null);
                    }}
                  >
                    <X className="h-3 w-3" />
                    Keep and clear
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function truncate(value: string, limit: number): string {
  const trimmed = value.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

function sameTraces(left: PositionedTrace[], right: PositionedTrace[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index]!;
    return (
      entry.trace.id === other.trace.id &&
      entry.trace.status === other.trace.status &&
      Math.abs(entry.box.left - other.box.left) < 0.5 &&
      Math.abs(entry.box.top - other.box.top) < 0.5 &&
      Math.abs(entry.box.width - other.box.width) < 0.5 &&
      Math.abs(entry.box.height - other.box.height) < 0.5
    );
  });
}
