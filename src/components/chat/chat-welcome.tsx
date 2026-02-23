"use client";

import { useEffect, useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowUpRight,
  CircleHelp,
  ClipboardCheck,
  Flame,
  GraduationCap,
  ImagePlus,
  Layers,
  Lightbulb,
  Loader2,
  MessageCircle,
  PenLine,
  Search,
  Sparkles,
  Star,
  Timer,
  Trophy,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StudyPlanView, type StudyPlanData } from "@/components/chat/study-plan-view";
import { TimetableWidget } from "@/components/timetable-widget";
import { ALL_MODES, getModeConfig } from "@/lib/modes";
import { getStarterPromptsForMode } from "@/lib/starter-prompts";
import type { Agent, StudyMode } from "@/types";

const MODE_ICONS: Record<string, React.ReactNode> = {
  GraduationCap: <GraduationCap className="h-5 w-5" />,
  CircleHelp: <CircleHelp className="h-5 w-5" />,
  ClipboardCheck: <ClipboardCheck className="h-5 w-5" />,
  Timer: <Timer className="h-5 w-5" />,
  PenLine: <PenLine className="h-5 w-5" />,
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
const STARTER_MODE_TABS: StudyMode[] = ["tutor", "quiz", "flashcard", "research", "explain"];

function greetingByHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function clip(value: string, max = 96) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trimEnd()}...`;
}

function extractTopicHints(chats: WelcomeChat[]) {
  const stopWords = new Set([
    "the", "and", "for", "with", "from", "that", "this", "what", "how", "why", "can", "you", "about", "into", "when", "where", "does", "did", "are", "was", "were", "have", "has", "had", "make", "made", "need", "help", "explain", "please", "quiz", "study", "lesson", "chapter",
  ]);

  const text = chats
    .slice(0, 8)
    .flatMap((chat) => [chat.latestUserPrompt ?? "", chat.title])
    .join(" ")
    .toLowerCase();

  const tokens = text
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !stopWords.has(token));

  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([token]) => token.charAt(0).toUpperCase() + token.slice(1));
}

export function ChatWelcome({
  onSelectAgent,
  onSelectMode,
  onResumeChat,
  onUsePrompt,
  agents,
  activeMode,
  recentChats = [],
  welcomeMessage,
}: ChatWelcomeProps) {
  const { user } = useUser();
  const [studyTopic, setStudyTopic] = useState("");
  const [studyPlan, setStudyPlan] = useState<StudyPlanData | null>(null);
  const [studyPlanError, setStudyPlanError] = useState<string | null>(null);
  const [generatingStudyPlan, setGeneratingStudyPlan] = useState(false);
  const [starterMode, setStarterMode] = useState<StudyMode>(activeMode ?? "tutor");
  const [gamification, setGamification] = useState<{
    currentStreak: number;
    totalXp: number;
    achievements: Array<{ type: string }>;
  } | null>(null);

  useEffect(() => {
    if (!activeMode) return;
    setStarterMode(activeMode);
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

  const latestChat = recentChats[0];
  const topicHints = useMemo(() => extractTopicHints(recentChats), [recentChats]);
  const starterPrompts = useMemo(() => {
    return getStarterPromptsForMode(starterMode, { limit: 6, topics: topicHints });
  }, [starterMode, topicHints]);

  const now = new Date();
  const greeting = greetingByHour(now.getHours());
  const firstName = user?.firstName?.trim() || user?.fullName?.split(" ")[0] || "there";

  async function handleGenerateStudyPlan() {
    const topic = studyTopic.trim();
    if (!topic || generatingStudyPlan) return;

    setGeneratingStudyPlan(true);
    setStudyPlanError(null);
    try {
      const response = await fetch("/api/study-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = (await response.json()) as { plan?: StudyPlanData };
      if (!payload.plan) {
        throw new Error("Study plan generation returned no plan");
      }
      setStudyPlan(payload.plan);
    } catch (error) {
      setStudyPlanError(error instanceof Error ? error.message : "Failed to generate study plan");
    } finally {
      setGeneratingStudyPlan(false);
    }
  }

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
                {welcomeMessage?.trim()
                  ? welcomeMessage
                  : "Choose a study path, jump back into your last session, or use a smart starter prompt to begin immediately."}
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

        {latestChat && onResumeChat ? (
          <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-secondary)]">Continue where you left off</p>
                <h2 className="mt-1 font-display text-xl">{latestChat.title || "Untitled chat"}</h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {clip(latestChat.latestUserPrompt || "Resume this conversation to continue your progress.")}
                </p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  Updated {formatDistanceToNow(latestChat.updatedAt, { addSuffix: true })}
                </p>
              </div>
              <Button type="button" onClick={() => onResumeChat(latestChat._id)} className="gap-1.5">
                Continue chat
                <ArrowUpRight className="h-4 w-4" />
              </Button>
            </div>
          </section>
        ) : null}

        <TimetableWidget />

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-xl">Core Study Modes</h2>
            <p className="text-xs text-[var(--text-secondary)]">Choose a lane, switch anytime</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {CORE_MODES.map((mode) => {
              const config = getModeConfig(mode);
              return (
                <button
                  key={mode}
                  type="button"
                  className={`group relative overflow-hidden rounded-2xl border bg-[var(--bg-elevated)] p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)] ${
                    starterMode === mode
                      ? "border-[color-mix(in_oklab,var(--accent-cyan)_40%,var(--border-default))] ring-1 ring-[color-mix(in_oklab,var(--accent-cyan)_35%,transparent)]"
                      : "border-[var(--border-default)]"
                  }`}
                  onClick={() => {
                    setStarterMode(mode);
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
                  </div>
                  <p className="text-xs leading-relaxed text-[var(--text-secondary)]">{config.description}</p>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {ALL_MODES.filter((mode) => !CORE_MODES.includes(mode.key)).map((mode) => (
              <button
                key={mode.key}
                type="button"
                onClick={() => {
                  setStarterMode(mode.key);
                  onSelectMode(mode.key);
                }}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  starterMode === mode.key
                    ? "border-[color-mix(in_oklab,var(--accent-cyan)_45%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_14%,var(--bg-elevated))] text-[var(--text-primary)]"
                    : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--accent-cyan)_18%,transparent)] text-[var(--accent-cyan)]">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                Starter Prompts for {getModeConfig(starterMode).label}
              </p>
              <p className="text-xs text-[var(--text-secondary)]">Mode-specific templates you can launch in one click.</p>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-1.5">
            {STARTER_MODE_TABS.map((mode) => {
              const modeConfig = getModeConfig(mode);
              const active = starterMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setStarterMode(mode);
                    onSelectMode(mode);
                  }}
                  className={`rounded-full border px-3 py-1 text-[11px] font-medium transition ${
                    active
                      ? "text-[var(--text-primary)]"
                      : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                  }`}
                  style={
                    active
                      ? {
                          borderColor: `color-mix(in oklab, ${modeConfig.color} 55%, var(--border-default))`,
                          background: `color-mix(in oklab, ${modeConfig.color} 16%, transparent)`,
                        }
                      : undefined
                  }
                >
                  {modeConfig.label}
                </button>
              );
            })}
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {starterPrompts.map((item, index) => {
              const mode = getModeConfig(item.mode);
              return (
                <button
                  key={`${item.mode}-${index}`}
                  type="button"
                  onClick={() => {
                    onSelectMode(item.mode);
                    onUsePrompt?.(item.prompt, item.mode);
                  }}
                  className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-left transition hover:border-[color-mix(in_oklab,var(--accent-cyan)_35%,var(--border-default))] hover:bg-[var(--bg-hover)]"
                >
                  <p className="text-[10px] uppercase tracking-[0.12em]" style={{ color: mode.color }}>
                    {mode.label}
                  </p>
                  <p className="mt-1 text-sm text-[var(--text-primary)]">{item.prompt}</p>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 sm:p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--accent-cyan)_18%,transparent)] text-[var(--accent-cyan)]">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Generate Study Plan</p>
              <p className="text-xs text-[var(--text-secondary)]">Build a personalized timeline from your quiz + flashcard momentum.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={studyTopic}
              onChange={(event) => setStudyTopic(event.target.value)}
              placeholder={`Topic (e.g. ${topicHints[0] ?? "Cell Biology"}, ${topicHints[1] ?? "Algebra"})`}
              className="h-10 min-w-[240px] flex-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-sm outline-none transition focus:ring-2 focus:ring-[var(--accent-cyan)]/45"
            />
            <Button
              type="button"
              onClick={() => void handleGenerateStudyPlan()}
              disabled={!studyTopic.trim() || generatingStudyPlan}
            >
              {generatingStudyPlan ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generatingStudyPlan ? "Generating..." : "Generate study plan"}
            </Button>
          </div>
          {studyPlanError ? (
            <p className="mt-2 text-xs text-[var(--danger)]">{studyPlanError}</p>
          ) : null}
        </section>

        {studyPlan ? (
          <section>
            <StudyPlanView plan={studyPlan} />
          </section>
        ) : null}

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
            Tip: choose a mode card first, then use a starter prompt to populate the composer instantly.
          </p>
        </div>
      </div>
    </div>
  );
}
