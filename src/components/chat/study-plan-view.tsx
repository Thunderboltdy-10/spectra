"use client";

import { CalendarClock, CheckCircle2, ListChecks, Sparkles, Target } from "lucide-react";
import { getModeConfig } from "@/lib/modes";
import { cn } from "@/lib/utils";

export type StudyPlanTimelineItem = {
  day: string;
  focus: string;
  mode?: string;
  durationMinutes?: number;
  activities: string[];
};

export type StudyPlanRecommendation = {
  mode: string;
  reason: string;
  target?: string;
};

export type StudyPlanData = {
  topic: string;
  title: string;
  summary: string;
  timeline: StudyPlanTimelineItem[];
  recommendations: StudyPlanRecommendation[];
  checkpoints: string[];
};

function toModeStyle(mode?: string) {
  if (!mode) return { label: "General", color: "var(--accent-cyan)" };
  const normalized = mode.trim().toLowerCase();
  try {
    const config = getModeConfig(normalized as Parameters<typeof getModeConfig>[0]);
    return { label: config.label, color: config.cssVar };
  } catch {
    return { label: normalized, color: "var(--accent-cyan)" };
  }
}

export function StudyPlanView({ plan, className }: { plan: StudyPlanData; className?: string }) {
  return (
    <section className={cn("space-y-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 sm:p-5", className)}>
      <header className="space-y-2">
        <p className="inline-flex items-center gap-1 rounded-full border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">
          <Sparkles className="h-3 w-3" />
          Personalized Plan
        </p>
        <h3 className="font-display text-2xl leading-tight">{plan.title}</h3>
        <p className="text-sm text-[var(--text-secondary)]">{plan.summary}</p>
      </header>

      <div className="space-y-3">
        <div className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          <CalendarClock className="h-3.5 w-3.5" />
          Timeline
        </div>
        <div className="grid gap-3">
          {plan.timeline.map((item, index) => {
            const modeStyle = toModeStyle(item.mode);
            return (
              <article key={`${item.day}-${index}`} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-[11px] font-medium">{item.day}</span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
                    style={{ backgroundColor: modeStyle.color }}
                  >
                    {modeStyle.label}
                  </span>
                  {item.durationMinutes ? (
                    <span className="text-[11px] text-[var(--text-secondary)]">{item.durationMinutes} min</span>
                  ) : null}
                </div>
                <p className="text-sm font-medium text-[var(--text-primary)]">{item.focus}</p>
                <div className="mt-2 space-y-1.5">
                  {item.activities.map((activity, activityIndex) => (
                    <div key={`${item.day}-${activityIndex}`} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[var(--accent-cyan)]" />
                      <span>{activity}</span>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {plan.recommendations.length > 0 ? (
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            <Target className="h-3.5 w-3.5" />
            Mode Suggestions
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {plan.recommendations.map((recommendation, index) => {
              const modeStyle = toModeStyle(recommendation.mode);
              return (
                <div key={`${recommendation.mode}-${index}`} className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
                  <p className="text-sm font-semibold" style={{ color: modeStyle.color }}>
                    {modeStyle.label}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">{recommendation.reason}</p>
                  {recommendation.target ? (
                    <p className="mt-1 text-xs text-[var(--text-tertiary)]">Target: {recommendation.target}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {plan.checkpoints.length > 0 ? (
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            <ListChecks className="h-3.5 w-3.5" />
            Checkpoints
          </div>
          <div className="space-y-1.5">
            {plan.checkpoints.map((checkpoint, index) => (
              <div key={`${checkpoint}-${index}`} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-[var(--success)]" />
                <span>{checkpoint}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
