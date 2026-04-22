"use client";

import { useEffect, useState } from "react";
import { Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProviderLogo } from "@/components/provider-logo";
import { useCompactSheet } from "@/hooks/use-compact-sheet";
import { useRightPanelDock } from "@/hooks/use-right-panel-dock";
import { rightPanelSurfaceClassName } from "@/components/ui/right-panel-surface";

type LeaderboardEntry = {
  modelId: string;
  provider: string;
  name: string;
  totalTokens: number;
  usageCount: number;
};

type ModelLeaderboardDrawerProps = {
  open: boolean;
  onClose: () => void;
};

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function sanitizeModelName(value: string) {
  return value
    .replace(/:free$/i, "")
    .replace(/[\s(_-]*\bfree\b[\s)_-]*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function ModelLeaderboardDrawer({ open, onClose }: ModelLeaderboardDrawerProps) {
  const compact = useCompactSheet(1024);
  const { docked, panelWidth } = useRightPanelDock({ id: "model-leaderboard", open, compact, maxWidthPx: 420 });
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/analytics/model-leaderboard");
        if (!res.ok) return;
        const data = (await res.json()) as { models: LeaderboardEntry[] };
        setEntries(data.models ?? []);
      } catch {
        // Ignore fetch errors
      } finally {
        setLoading(false);
      }
    })();
  }, [open]);

  if (!open) return null;

  return (
    <div className={`fixed z-40 ${docked ? "inset-y-0 right-0 pointer-events-none" : "inset-0"}`} style={docked ? { width: `${panelWidth}px` } : undefined}>
      {!docked ? (
        <button
          type="button"
          className={`absolute inset-0 cursor-pointer transition bg-transparent`}
          aria-label="Close leaderboard"
          onClick={onClose}
        />
      ) : null}

      <aside
        className={`right-panel-shell ${rightPanelSurfaceClassName("w-full min-w-0 max-w-none xl:w-full xl:min-w-0 xl:max-w-none")} pointer-events-auto absolute flex flex-col shadow-[var(--shadow-soft)] ${
          docked ? "right-panel-shell--docked" : "right-panel-shell--sheet"
        } ${
          compact
            ? "bottom-3 left-3 right-3 max-h-[78vh] rounded-2xl border"
            : "inset-y-0 right-0 w-full max-w-md border-l"
        }`}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between px-4 pt-4 sm:px-5 sm:pt-5">
          <h2 className="inline-flex items-center gap-2 font-display text-xl">
            <Trophy className="h-5 w-5 text-[var(--accent-cyan)]" />
            Model Leaderboard
          </h2>
          <Button type="button" variant="secondary" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className={`right-panel-content flex-1 ${compact ? "max-h-[calc(78vh-4rem)]" : "max-h-[calc(100vh-6rem)]"} overflow-y-auto px-4 pb-4 sm:px-5 sm:pb-5`}>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-[var(--bg-secondary)]" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--border-default)] p-6 text-center text-sm text-[var(--text-secondary)]">
              No usage data yet.
            </p>
          ) : (
            <div className="space-y-2">
              {entries.map((entry, index) => (
                <div
                  key={entry.modelId}
                  className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2.5"
                >
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg-secondary)] text-xs font-bold text-[var(--text-secondary)]">
                    {index + 1}
                  </span>
                  <ProviderLogo provider={entry.provider} modelId={entry.modelId} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">{sanitizeModelName(entry.name)}</p>
                    <p className="text-[11px] text-[var(--text-secondary)]">
                      {formatTokens(entry.totalTokens)} tokens · {entry.usageCount} uses
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
