"use client";

import type { LucideIcon } from "lucide-react";

type StatsCardProps = {
  icon: LucideIcon;
  label: string;
  value: string | number;
  subtitle?: string;
  color?: string;
};

export function StatsCard({ icon: Icon, label, value, subtitle, color }: StatsCardProps) {
  return (
    <div className="p-3">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-input)] border border-[var(--border-default)] text-[var(--text-primary)]"
          style={{
            background: `color-mix(in oklab, ${color ?? "var(--accent)"} 18%, var(--bg-secondary))`,
          }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">{label}</span>
      </div>
      <p className="font-display text-2xl font-semibold">{value}</p>
      {subtitle && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{subtitle}</p>}
    </div>
  );
}
