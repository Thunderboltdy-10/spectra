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
    <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-card)]">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-input)] text-white"
          style={{ backgroundColor: color ?? "var(--accent)" }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">{label}</span>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      {subtitle && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{subtitle}</p>}
    </div>
  );
}
