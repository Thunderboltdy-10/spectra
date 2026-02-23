"use client";

import Link from "next/link";
import { Sparkles, Star, Trophy, X } from "lucide-react";

export type AchievementToastData = {
  type: string;
  name: string;
  description: string;
  xpEarned: number;
  earnedAt: number;
};

type AchievementToastProps = {
  achievement: AchievementToastData;
  onDismiss: () => void;
};

export function AchievementToast({ achievement, onDismiss }: AchievementToastProps) {
  return (
    <div className="achievement-toast relative w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--border-default)] p-4 shadow-[var(--shadow-soft)]">
      <div className="achievement-toast__spark achievement-toast__spark--a" />
      <div className="achievement-toast__spark achievement-toast__spark--b" />
      <div className="achievement-toast__spark achievement-toast__spark--c" />

      <div className="relative flex items-start gap-3">
        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color-mix(in_oklab,var(--warning)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_16%,var(--bg-secondary))] text-[color-mix(in_oklab,var(--warning)_86%,var(--text-primary))]">
          <Trophy className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">
            <Sparkles className="h-3 w-3" />
            Achievement Unlocked
          </p>
          <p className="mt-1 truncate text-base font-semibold text-[var(--text-primary)]">{achievement.name}</p>
          <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{achievement.description}</p>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss achievement notification"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="relative mt-3 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--warning)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_14%,var(--bg-secondary))] px-2.5 py-1 text-xs font-semibold text-[var(--text-primary)]">
          <Star className="h-3.5 w-3.5 text-[var(--warning)]" />
          +{achievement.xpEarned} XP
        </span>
        <Link
          href="/achievements"
          onClick={onDismiss}
          className="inline-flex items-center rounded-full border border-[var(--border-default)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          View badges
        </Link>
      </div>
    </div>
  );
}
