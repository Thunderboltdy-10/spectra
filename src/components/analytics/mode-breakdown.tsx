"use client";

import { MODE_REGISTRY } from "@/lib/modes";
import type { StudyMode } from "@/types";

type ModeBreakdownProps = {
  modeCounts: Record<string, number>;
};

export function ModeBreakdown({ modeCounts }: ModeBreakdownProps) {
  const entries = Object.entries(modeCounts).sort(([, a], [, b]) => b - a);
  const max = Math.max(...entries.map(([, count]) => count), 1);

  if (entries.length === 0) {
    return (
      <div className="rounded-[var(--radius-container)] border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 text-center text-sm text-[var(--text-secondary)]">
        No mode usage data yet
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-card)]">
      <p className="mb-3 text-xs uppercase tracking-wide text-[var(--text-secondary)]">Mode usage</p>
      <div className="space-y-2">
        {entries.map(([mode, count]) => {
          const config = MODE_REGISTRY[mode as StudyMode];
          const pct = (count / max) * 100;
          return (
            <div key={mode} className="flex items-center gap-2">
              <span className="w-20 text-xs font-medium">{config?.label ?? mode}</span>
              <div className="flex-1 overflow-hidden rounded-full bg-[var(--bg-secondary)]" style={{ height: 8 }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: config?.color ?? "var(--accent)" }}
                />
              </div>
              <span className="w-8 text-right text-xs text-[var(--text-secondary)]">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
