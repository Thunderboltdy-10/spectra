"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Award,
  BrainCircuit,
  Compass,
  Flame,
  Footprints,
  Library,
  Loader2,
  Lock,
  Medal,
  RefreshCw,
  SearchCheck,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";

type AchievementDefinition = {
  type: string;
  name: string;
  description: string;
  xpEarned: number;
  difficulty?: "starter" | "bronze" | "silver" | "gold" | "legend";
};

type UnlockedAchievement = AchievementDefinition & {
  earnedAt: number;
};

type GamificationPayload = {
  currentStreak: number;
  longestStreak: number;
  totalXp: number;
  lastActiveDate: string | null;
  achievements: UnlockedAchievement[];
  catalog: AchievementDefinition[];
};

function iconForAchievement(type: string) {
  if (type === "first_chat") return Footprints;
  if (type.startsWith("streak_")) return Flame;
  if (type === "quiz_perfect") return Medal;
  if (type === "quiz_master") return Trophy;
  if (type === "flashcard_100") return BrainCircuit;
  if (type === "research_pro") return SearchCheck;
  if (type === "mode_explorer") return Compass;
  if (type === "bookworm") return Library;
  return Award;
}

function difficultyLabel(difficulty?: AchievementDefinition["difficulty"]) {
  if (!difficulty) return "standard";
  return difficulty;
}

export default function AchievementsPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<GamificationPayload | null>(null);

  async function loadGamification(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await fetch("/api/gamification");
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as Partial<GamificationPayload>;
      setData({
        currentStreak: payload.currentStreak ?? 0,
        longestStreak: payload.longestStreak ?? 0,
        totalXp: payload.totalXp ?? 0,
        lastActiveDate: payload.lastActiveDate ?? null,
        achievements: payload.achievements ?? [],
        catalog: payload.catalog ?? [],
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load achievements");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadGamification();
  }, []);

  const unlockedByType = useMemo(() => {
    const map = new Map<string, UnlockedAchievement>();
    for (const achievement of data?.achievements ?? []) {
      map.set(achievement.type, achievement);
    }
    return map;
  }, [data?.achievements]);

  const completion = useMemo(() => {
    const total = Math.max(1, data?.catalog.length ?? 0);
    const unlocked = unlockedByType.size;
    return {
      unlocked,
      total,
      percent: Math.round((unlocked / total) * 100),
    };
  }, [data?.catalog.length, unlockedByType]);

  const orderedCatalog = useMemo(() => {
    const items = data?.catalog ?? [];
    return [...items].sort((a, b) => {
      const aUnlocked = unlockedByType.has(a.type);
      const bUnlocked = unlockedByType.has(b.type);
      if (aUnlocked !== bUnlocked) return aUnlocked ? -1 : 1;
      return a.xpEarned - b.xpEarned || a.name.localeCompare(b.name);
    });
  }, [data?.catalog, unlockedByType]);

  return (
    <AppShell fullBleed contentClassName="2xl:px-14">
      <section className="space-y-6">
        <header data-tour="achievements-header" className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl">Achievements</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Track every unlock, build streak momentum, and level up your study profile.
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={() => void loadGamification({ silent: true })} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </header>

        <div data-tour="achievements-overview" className="flex flex-wrap divide-x divide-[var(--border-default)] border-t border-b border-[var(--border-default)]">
          <div className="px-4 py-3 first:pl-0">
            <p className="text-xs text-[var(--text-secondary)]">Total XP</p>
            <p className="mt-0.5 text-2xl font-semibold">{(data?.totalXp ?? 0).toLocaleString()}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-[var(--text-secondary)]">Current streak</p>
            <p className="mt-0.5 text-2xl font-semibold">{(data?.currentStreak ?? 0).toLocaleString()} day{(data?.currentStreak ?? 0) === 1 ? "" : "s"}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-[var(--text-secondary)]">Completion</p>
            <p className="mt-0.5 text-2xl font-semibold">{completion.percent}%</p>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{completion.unlocked}/{completion.total} unlocked</p>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-10 text-center text-sm text-[var(--text-secondary)]">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
            Loading achievements...
          </div>
        ) : orderedCatalog.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border-default)] bg-[var(--bg-elevated)] p-10 text-center">
            <Award className="mx-auto h-8 w-8 text-[var(--text-secondary)]" />
            <h2 className="mt-3 text-lg font-semibold">No badges configured yet</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Achievements will appear here once your profile is initialized.
            </p>
          </div>
        ) : (
          <div data-tour="achievements-grid" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {orderedCatalog.map((definition) => {
              const unlocked = unlockedByType.get(definition.type);
              const Icon = iconForAchievement(definition.type);
              return (
                <article
                  key={definition.type}
                  className={`relative rounded-2xl border p-4 transition ${
                    unlocked
                      ? "border-l-4 border-[var(--warning)] bg-[var(--bg-elevated)]"
                      : "border-[var(--border-default)] bg-[var(--bg-elevated)] opacity-70"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]">
                      <Icon className="h-5 w-5 text-[var(--text-primary)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold">{definition.name}</h3>
                      <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{definition.description}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between text-xs text-[var(--text-secondary)]">
                    <span className="font-semibold text-[var(--text-primary)]">
                      +{definition.xpEarned} XP
                    </span>
                    <span className="text-[var(--text-secondary)]">
                      {difficultyLabel(definition.difficulty)}
                    </span>
                    {unlocked ? (
                      <span className="text-[var(--success)]">· {new Date(unlocked.earnedAt).toLocaleDateString()}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" /> Pending</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </AppShell>
  );
}
