"use client";

import { cn } from "@/lib/utils";

export type TintZoneVariant = "warm" | "cool" | "neutral" | "accent" | "muted";

const ZONE_TINTS: Record<TintZoneVariant, { bg: string; bgInner: string; header: string }> = {
  warm: {
    bg: "rgba(245, 158, 11, 0.04)",
    bgInner: "rgba(245, 158, 11, 0.025)",
    header: "var(--accent-orange)",
  },
  cool: {
    bg: "rgba(14, 142, 232, 0.035)",
    bgInner: "rgba(14, 142, 232, 0.02)",
    header: "var(--accent-cyan)",
  },
  neutral: {
    bg: "rgba(107, 95, 82, 0.03)",
    bgInner: "rgba(107, 95, 82, 0.018)",
    header: "var(--text-tertiary)",
  },
  accent: {
    bg: "rgba(32, 184, 178, 0.035)",
    bgInner: "rgba(32, 184, 178, 0.02)",
    header: "var(--accent-mint)",
  },
  muted: {
    bg: "rgba(158, 144, 130, 0.025)",
    bgInner: "rgba(158, 144, 130, 0.015)",
    header: "var(--text-tertiary)",
  },
};

export function TintZone({
  label,
  variant = "neutral",
  children,
  className,
  itemCount,
}: {
  label: string;
  variant?: TintZoneVariant;
  children: React.ReactNode;
  className?: string;
  itemCount?: number;
}) {
  const tint = ZONE_TINTS[variant];

  return (
    <div
      className={cn("relative rounded-[24px] p-5 pb-4", className)}
      style={{
        background: `radial-gradient(ellipse 130% 90% at 50% 35%, ${tint.bg} 0%, transparent 75%)`,
        boxShadow: `inset 0 0 50px 24px ${tint.bgInner}`,
      }}
    >
      {/* Section header */}
      <div className="mb-3.5 flex items-center gap-2">
        <span
          className="text-[10px] font-semibold uppercase leading-none tracking-[0.14em] opacity-45"
          style={{ color: tint.header }}
        >
          {label}
        </span>
        {itemCount !== undefined && (
          <span
            className="text-[10px] font-medium tabular-nums opacity-28"
            style={{ color: tint.header }}
          >
            {itemCount}
          </span>
        )}
        {/* Divider line */}
        <div className="flex-1 h-px bg-[var(--border-default)]/12 ml-1" />
      </div>

      {/* Items */}
      <div className="flex flex-wrap gap-3">{children}</div>
    </div>
  );
}
