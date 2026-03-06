"use client";

import { MODE_REGISTRY } from "@/lib/modes";
import type { StudyMode } from "@/types";

type ModeBreakdownProps = {
  modeCounts: Record<string, number>;
};

export function ModeBreakdown({ modeCounts }: ModeBreakdownProps) {
  const entries = Object.entries(modeCounts)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);

  if (entries.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-[var(--text-secondary)]">
        No mode usage data yet
      </div>
    );
  }

  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  return (
    <div className="p-4">
      <p className="mb-4 text-xs uppercase tracking-wide text-[var(--text-secondary)]">Mode usage</p>

      {/* Stacked bar */}
      <div className="mb-4 flex h-3 w-full overflow-hidden rounded-full">
        {entries.slice(0, 6).map(([mode, count]) => {
          const config = MODE_REGISTRY[mode as StudyMode];
          const pct = (count / total) * 100;
          return (
            <div
              key={mode}
              title={`${config?.label ?? mode}: ${Math.round(pct)}%`}
              style={{
                width: `${pct}%`,
                backgroundColor: config?.color ?? "var(--accent-cyan)",
              }}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="space-y-1.5">
        {entries.slice(0, 6).map(([mode, count]) => {
          const config = MODE_REGISTRY[mode as StudyMode];
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={mode} className="flex items-center gap-2 text-xs">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: config?.color ?? "var(--accent-cyan)" }}
              />
              <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]">{config?.label ?? mode}</span>
              <span className="tabular-nums text-[var(--text-primary)]">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
