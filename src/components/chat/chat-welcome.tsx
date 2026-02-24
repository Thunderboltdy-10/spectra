"use client";

import { useEffect, useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";
import {
  CircleHelp,
  Flame,
  GraduationCap,
  ImagePlus,
  Layers,
  Lightbulb,
  MessageCircle,
  Search,
  Sparkles,
  Star,
  Trophy,
  Users,
} from "lucide-react";
import { ALL_MODES, COMING_SOON_MODES, getModeConfig, isModeAvailable } from "@/lib/modes";
import type { Agent, StudyMode } from "@/types";

const MODE_ICONS: Record<string, React.ReactNode> = {
  GraduationCap: <GraduationCap className="h-5 w-5" />,
  CircleHelp: <CircleHelp className="h-5 w-5" />,
  Layers: <Layers className="h-5 w-5" />,
  Search: <Search className="h-5 w-5" />,
  Lightbulb: <Lightbulb className="h-5 w-5" />,
  MessageCircle: <MessageCircle className="h-5 w-5" />,
  ImagePlus: <ImagePlus className="h-5 w-5" />,
  Sparkles: <Sparkles className="h-5 w-5" />,
};

type WelcomeChat = {
  _id: string;
  title: string;
  latestUserPrompt?: string;
  mode: StudyMode;
  updatedAt: number;
};

type ChatWelcomeProps = {
  onSelectAgent: (agentId: string) => void;
  onSelectMode: (mode: StudyMode) => void;
  onResumeChat?: (chatId: string) => void;
  onUsePrompt?: (prompt: string, mode: StudyMode) => void;
  agents: Agent[];
  activeMode?: StudyMode;
  recentChats?: WelcomeChat[];
  welcomeMessage?: string;
};

const CORE_MODES: StudyMode[] = ["tutor", "quiz", "flashcard", "research"];

const MORNING_GREETINGS = [
  "Good morning",
  "Ready to build momentum this morning",
  "Fresh start, focused mind",
  "Morning study session unlocked",
];

const AFTERNOON_GREETINGS = [
  "Good afternoon",
  "Perfect time for deep practice",
  "Midday focus mode is active",
  "Afternoon checkpoint time",
];

const EVENING_GREETINGS = [
  "Good evening",
  "Strong finish to your day",
  "Evening review starts now",
  "Let’s lock in your learning tonight",
];

const SEASONAL_ADDONS = {
  winter: ["Cozy revision session"],
  spring: ["Spring into your next milestone"],
  summer: ["Summer sprint, steady gains"],
  autumn: ["Autumn focus season"],
} as const;

const DAILY_TIPS = [
  "Tip: Start with Quiz to diagnose gaps, then switch to Learn for targeted fixes.",
  "Tip: Use Flashcards after each topic block to improve long-term retention.",
  "Tip: Research mode works best when you ask for sources and confidence levels.",
  "Tip: Alternate Learn and Quiz sessions to improve transfer and recall speed.",
  "Tip: Keep prompts specific: include topic, level, and goal in one sentence.",
];

function hashString(value: string) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return Math.abs(hash >>> 0);
}

function seasonForMonth(month: number) {
  if (month === 11 || month <= 1) return "winter" as const;
  if (month >= 2 && month <= 4) return "spring" as const;
  if (month >= 5 && month <= 7) return "summer" as const;
  return "autumn" as const;
}

function getGreeting(hour: number, month: number, firstName: string, dayKey: string) {
  const basePool =
    hour < 12
      ? MORNING_GREETINGS
      : hour < 18
        ? AFTERNOON_GREETINGS
        : EVENING_GREETINGS;
  const seasonalPool = SEASONAL_ADDONS[seasonForMonth(month)];
  const pool = [...basePool, ...seasonalPool];
  const index = hashString(`${dayKey}:${firstName.toLowerCase()}:greeting`) % pool.length;
  return pool[index] ?? "Welcome back";
}

export function ChatWelcome({
  onSelectAgent,
  onSelectMode,
  agents,
  activeMode,
  welcomeMessage,
}: ChatWelcomeProps) {
  const { user } = useUser();
  const [selectedMode, setSelectedMode] = useState<StudyMode>(activeMode ?? "tutor");
  const [gamification, setGamification] = useState<{
    currentStreak: number;
    totalXp: number;
    achievements: Array<{ type: string }>;
  } | null>(null);

  useEffect(() => {
    if (!activeMode) return;
    setSelectedMode(activeMode);
  }, [activeMode]);

  useEffect(() => {
    async function loadGamification() {
      try {
        const response = await fetch("/api/gamification");
        if (!response.ok) return;
        const payload = (await response.json()) as {
          currentStreak?: number;
          totalXp?: number;
          achievements?: Array<{ type: string }>;
        };
        setGamification({
          currentStreak: payload.currentStreak ?? 0,
          totalXp: payload.totalXp ?? 0,
          achievements: payload.achievements ?? [],
        });
      } catch {
        // Keep welcome UI resilient if gamification endpoint is unavailable.
      }
    }

    void loadGamification();
  }, []);

  const firstName = user?.firstName?.trim() || user?.fullName?.split(" ")[0] || "there";
  const now = new Date();
  const dayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  const greeting = getGreeting(now.getHours(), now.getMonth(), firstName, dayKey);

  const dailyTip = useMemo(() => {
    const index = hashString(`${dayKey}:${firstName.toLowerCase()}:tip`) % DAILY_TIPS.length;
    return DAILY_TIPS[index] ?? DAILY_TIPS[0];
  }, [dayKey, firstName]);

  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 sm:py-12">
      <div className="w-full max-w-6xl space-y-7">
        <section className="relative overflow-hidden rounded-3xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-5 py-6 sm:px-7 sm:py-7">
          <div
            className="pointer-events-none absolute -left-20 -top-20 h-56 w-56 rounded-full opacity-30 blur-3xl"
            style={{ background: "radial-gradient(circle at center, var(--accent-orange), transparent 70%)" }}
          />
          <div
            className="pointer-events-none absolute -right-20 -bottom-20 h-56 w-56 rounded-full opacity-30 blur-3xl"
            style={{ background: "radial-gradient(circle at center, var(--accent-cyan), transparent 70%)" }}
          />

          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-2xl">
              <p className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                <Sparkles className="h-3 w-3" />
                Study Studio
              </p>
              <h1 className="mt-2 font-display text-3xl leading-tight sm:text-4xl">
                {greeting}, {firstName}
              </h1>
              <p className="mt-2 text-sm text-[var(--text-secondary)] sm:text-base">
                {welcomeMessage?.trim() || "Pick a mode and start a focused session."}
              </p>
            </div>

            {gamification ? (
              <div className="grid min-w-[220px] gap-2">
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                  <p className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.12em]">
                    <Flame className="h-3.5 w-3.5 text-[var(--accent-coral)]" />
                    Streak
                  </p>
                  <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                    {gamification.currentStreak} day{gamification.currentStreak === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                  <p className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.12em]">
                    <Star className="h-3.5 w-3.5 text-[var(--warning)]" />
                    XP + Badges
                  </p>
                  <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                    {gamification.totalXp.toLocaleString()} XP
                  </p>
                  <p className="mt-0.5 text-[11px]">{gamification.achievements.length} achievements unlocked</p>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-xl">Core Study Modes</h2>
            <p className="text-xs text-[var(--text-secondary)]">Choose a lane, switch anytime</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {CORE_MODES.map((mode) => {
              const config = getModeConfig(mode);
              const available = isModeAvailable(mode);
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={!available}
                  className={`group relative overflow-hidden rounded-2xl border bg-[var(--bg-elevated)] p-4 text-left transition ${
                    available ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]" : "cursor-not-allowed opacity-45"
                  } ${
                    selectedMode === mode
                      ? "border-[color-mix(in_oklab,var(--accent-cyan)_40%,var(--border-default))] ring-1 ring-[color-mix(in_oklab,var(--accent-cyan)_35%,transparent)]"
                      : "border-[var(--border-default)]"
                  }`}
                  onClick={() => {
                    if (!available) return;
                    setSelectedMode(mode);
                    onSelectMode(mode);
                  }}
                >
                  <div
                    className="absolute inset-x-0 top-0 h-1 opacity-80"
                    style={{ backgroundColor: config.color }}
                  />
                  <div className="mb-3 flex items-center gap-3">
                    <div
                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-white"
                      style={{ backgroundColor: config.color }}
                    >
                      {MODE_ICONS[config.icon]}
                    </div>
                    <p className="font-semibold text-[var(--text-primary)]">{config.label}</p>
                    {!available ? (
                      <span className="ml-auto rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--text-secondary)]">
                        Coming soon
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{config.description}</p>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {ALL_MODES.filter((mode) => !CORE_MODES.includes(mode.key)).map((mode) => {
              const available = isModeAvailable(mode.key);
              const comingSoon = COMING_SOON_MODES.has(mode.key);
              return (
                <button
                  key={mode.key}
                  type="button"
                  disabled={!available}
                  onClick={() => {
                    if (!available) return;
                    setSelectedMode(mode.key);
                    onSelectMode(mode.key);
                  }}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    selectedMode === mode.key
                      ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--bg-elevated))] text-[var(--text-primary)]"
                      : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                  } ${available ? "cursor-pointer hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]" : "cursor-not-allowed opacity-45"}`}
                >
                  {mode.label}
                  {comingSoon ? (
                    <span className="ml-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em]">
                      Coming Soon
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>

        {agents.length > 0 ? (
          <section>
            <h2 className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
              <Users className="h-4 w-4" />
              Featured Agents
            </h2>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {agents.slice(0, 10).map((agent) => (
                <button
                  key={agent._id}
                  type="button"
                  onClick={() => onSelectAgent(agent._id)}
                  className="flex min-w-[220px] shrink-0 items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-4 py-3 text-left transition hover:border-[color-mix(in_oklab,var(--accent-cyan)_35%,var(--border-default))] hover:shadow-[var(--shadow-soft)]"
                >
                  <span className="text-2xl">{agent.avatarEmoji}</span>
                  <div>
                    <p className="font-medium text-[var(--text-primary)]">{agent.name}</p>
                    <p className="text-xs text-[var(--text-secondary)]">{agent.category}</p>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-xs text-[var(--text-secondary)]">
          <p className="inline-flex items-center gap-1">
            <Trophy className="h-3.5 w-3.5" />
            {dailyTip}
          </p>
        </div>
      </div>
    </div>
  );
}
