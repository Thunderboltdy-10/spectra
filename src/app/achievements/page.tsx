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
  Sparkles,
  Star,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type AchievementDefinition = {
  type: string;
  name: string;
  description: string;
  xpEarned: number;
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
    return [...items].sort((a, b) => a.xpEarned - b.xpEarned || a.name.localeCompare(b.name));
  }, [data?.catalog]);

  return (
    <AppShell fullBleed contentClassName="2xl:px-14">
      <section className="space-y-6">
        <header className="relative overflow-hidden px-1 py-3 sm:px-2">
          <div
            className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-35 blur-3xl"
            style={{ background: "radial-gradient(circle at center, var(--warning), transparent 68%)" }}
          />
          <div
            className="pointer-events-none absolute -bottom-20 left-10 h-56 w-56 rounded-full opacity-30 blur-3xl"
            style={{ background: "radial-gradient(circle at center, var(--accent-cyan), transparent 70%)" }}
          />
          <div className="relative flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_78%,transparent)] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                <Sparkles className="h-3 w-3" />
                Achievement Board
              </p>
              <h1 className="mt-2 font-display text-3xl leading-tight sm:text-4xl">Badges and Milestones</h1>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Track every unlock, build streak momentum, and level up your study profile.
              </p>
            </div>
            <Button type="button" variant="secondary" onClick={() => void loadGamification({ silent: true })} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-[color-mix(in_oklab,var(--bg-elevated)_76%,transparent)] p-4 shadow-[var(--shadow-card)]">
            <p className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
              <Star className="h-3.5 w-3.5 text-[var(--warning)]" />
              Total XP
            </p>
            <p className="mt-1 text-2xl font-semibold">{(data?.totalXp ?? 0).toLocaleString()}</p>
          </div>
          <div className="rounded-2xl bg-[color-mix(in_oklab,var(--bg-elevated)_76%,transparent)] p-4 shadow-[var(--shadow-card)]">
            <p className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
              <Flame className="h-3.5 w-3.5 text-[var(--accent-coral)]" />
              Current Streak
            </p>
            <p className="mt-1 text-2xl font-semibold">{(data?.currentStreak ?? 0).toLocaleString()} day{(data?.currentStreak ?? 0) === 1 ? "" : "s"}</p>
          </div>
          <div className="rounded-2xl bg-[color-mix(in_oklab,var(--bg-elevated)_76%,transparent)] p-4 shadow-[var(--shadow-card)]">
            <p className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
              <Trophy className="h-3.5 w-3.5 text-[var(--success)]" />
              Completion
            </p>
            <p className="mt-1 text-2xl font-semibold">{completion.percent}%</p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {completion.unlocked}/{completion.total} badges unlocked
            </p>
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
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {orderedCatalog.map((definition) => {
              const unlocked = unlockedByType.get(definition.type);
              const Icon = iconForAchievement(definition.type);
              return (
                <article
                  key={definition.type}
                  className={`relative overflow-hidden rounded-2xl border p-4 transition ${
                    unlocked
                      ? "border-[color-mix(in_oklab,var(--warning)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--warning)_8%,var(--bg-elevated))]"
                      : "border-[var(--border-default)] bg-[var(--bg-elevated)] opacity-85"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)]">
                      <Icon className="h-5 w-5 text-[var(--text-primary)]" />
                    </div>
                    {unlocked ? (
                      <Badge variant="success">Unlocked</Badge>
                    ) : (
                      <Badge variant="secondary" className="inline-flex items-center gap-1">
                        <Lock className="h-3 w-3" />
                        Locked
                      </Badge>
                    )}
                  </div>

                  <h3 className="mt-3 text-base font-semibold">{definition.name}</h3>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">{definition.description}</p>

                  <div className="mt-3 flex items-center justify-between text-xs text-[var(--text-secondary)]">
                    <span className="inline-flex items-center gap-1 font-semibold text-[var(--text-primary)]">
                      <Star className="h-3.5 w-3.5 text-[var(--warning)]" />
                      +{definition.xpEarned} XP
                    </span>
                    {unlocked ? (
                      <span>Unlocked {new Date(unlocked.earnedAt).toLocaleDateString()}</span>
                    ) : (
                      <span>Complete criteria</span>
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
