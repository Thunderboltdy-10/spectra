"use client";

import { ArtifactCard } from "@/features/spectra/components/artifact-card";
import { deriveLiveDockTab } from "@/features/spectra/runs/live-dock/live-dock-model";
import { CrossfadeText } from "@/features/spectra/motion/motion-primitives";
import { PRESENCE_PALETTE } from "@/features/spectra/collaboration/interaction-model";
import { demoDocumentCard } from "./real-surfaces";

/**
 * Live work demo (Phase 15.6): real Spectra UI composed into the landing
 * scene — the Library card component, the Live Dock derivation and chrome
 * classes, the tail-shimmer class and the follow chip surface all come from
 * the product, so this vignette drifts with it automatically.
 *
 * Data is a fixed scene fixture; nothing here touches persistence or auth.
 */

const MAYA = PRESENCE_PALETTE[1]; // mint — Maya's identity everywhere
const JONAS = PRESENCE_PALETTE[2]; // blue

const DOCUMENT_LINES = [
  { width: "92%", quiet: true },
  { width: "100%", quiet: true },
  { width: "97%", quiet: true },
] as const;

const DEMO_TAB = deriveLiveDockTab({
  runId: "run-demo",
  threadId: "thread-demo",
  threadTitle: "Revision notes",
  run: { status: "running" },
  card: { title: "Revising the photosynthesis summary" },
  checkpointSummary: "Tightening section two against the rubric",
});

export function LiveWorkDemo() {
  return (
    <div className="landing-demo-frame w-full max-w-[520px] overflow-hidden rounded-[16px] bg-[color-mix(in_oklab,var(--bg-elevated)_84%,transparent)] shadow-[0_30px_70px_rgba(27,20,12,0.13)] backdrop-blur-xl">
      {/* the real Library card, live */}
      <div className="border-b border-[var(--border-subtle)] p-2">
        <ArtifactCard
          artifact={demoDocumentCard}
          size="compact"
          quiet
          actions={
            <span className="flex items-center">
              {[
                ["M", MAYA],
                ["J", JONAS],
              ].map(([initial, color]) => (
                <span
                  key={initial}
                  className="-ml-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-[var(--bg-elevated)] text-micro font-bold text-white"
                  style={{ backgroundColor: color }}
                >
                  {initial}
                </span>
              ))}
            </span>
          }
        />
      </div>

      {/* document body: the line the AI is writing, real tail shimmer */}
      <div className="relative space-y-2.5 px-5 py-4">
        {DOCUMENT_LINES.map((line, index) => (
          <div
            key={index}
            className="h-[9px] rounded-full bg-[var(--bg-secondary)]"
            style={{ width: line.width }}
          />
        ))}
        <div className="spectra-stream-active pt-0.5">
          <p className="text-[12.5px] leading-5 text-[var(--text-primary)]">
            Photosynthesis converts light energy into chemical energy stored in
            glucose. The Calvin cycle then fixes carbon inside the stroma, where
          </p>
        </div>
        {/* AI cursor wearing its owner's presence color, as the protocol does */}
        <span
          className="spectra-presence-caret pointer-events-none absolute rounded-full"
          style={
            {
              left: "62%",
              top: "76px",
              width: 2.5,
              height: 15,
              backgroundColor: MAYA,
              "--presence-color": MAYA,
              boxShadow: `0 0 8px color-mix(in oklab, ${MAYA} 55%, transparent)`,
            } as React.CSSProperties
          }
        />
      </div>

      {/* dock strip: the real run tab derivation + real follow chip */}
      <div className="flex items-center gap-2.5 border-t border-[var(--border-subtle)] px-4 py-2.5">
        <div className="spectra-run-tab-strip min-w-0 flex-1">
          <article
            data-run-status="running"
            className="flex min-w-0 items-center gap-2.5 rounded-[9px] border border-[var(--border-default)] px-2.5 py-1.5"
          >
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--accent-cyan)] motion-reduce:animate-none" />
            <div className="min-w-0">
              <CrossfadeText
                value={DEMO_TAB.title}
                className="block truncate text-[11px] font-semibold text-[var(--text-primary)]"
              />
              <CrossfadeText
                value={DEMO_TAB.semanticStep}
                className="block truncate text-micro text-[var(--text-tertiary)]"
              />
            </div>
          </article>
        </div>
        <span className="spectra-follow-chip flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-default)] py-1 pl-2 pr-2.5 text-micro font-semibold text-[var(--text-secondary)]">
          <span
            className="spectra-follow-chip-dot h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: MAYA }}
          />
          Following Maya
        </span>
      </div>
    </div>
  );
}
