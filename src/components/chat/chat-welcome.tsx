"use client";

import {
  GraduationCap,
  ClipboardCheck,
  Timer,
  PenLine,
  CircleHelp,
  Layers,
  Search,
  Lightbulb,
  MessageCircle,
  Sparkles,
  Users,
} from "lucide-react";
import { ALL_MODES, getModeConfig } from "@/lib/modes";
import type { Agent, StudyMode } from "@/types";

const MODE_ICONS: Record<string, React.ReactNode> = {
  GraduationCap: <GraduationCap className="h-5 w-5" />,
  ClipboardCheck: <ClipboardCheck className="h-5 w-5" />,
  Timer: <Timer className="h-5 w-5" />,
  PenLine: <PenLine className="h-5 w-5" />,
  CircleHelp: <CircleHelp className="h-5 w-5" />,
  Layers: <Layers className="h-5 w-5" />,
  Search: <Search className="h-5 w-5" />,
  Lightbulb: <Lightbulb className="h-5 w-5" />,
  MessageCircle: <MessageCircle className="h-5 w-5" />,
};

type ChatWelcomeProps = {
  onSelectAgent: (agentId: string) => void;
  onSelectMode: (mode: StudyMode) => void;
  agents: Agent[];
};

export function ChatWelcome({ onSelectAgent, onSelectMode, agents }: ChatWelcomeProps) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-5xl">
        <div className="mb-10 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[color-mix(in_oklab,var(--accent-cyan)_35%,var(--border-default))] bg-[color-mix(in_oklab,var(--accent-cyan)_12%,transparent)] px-4 py-1.5">
            <Sparkles className="h-4 w-4 text-[var(--accent-cyan)]" />
            <span className="text-xs font-medium text-[var(--accent-cyan)]">Adaptive AI classroom</span>
          </div>

          <h1 className="font-display text-4xl tracking-tight text-[var(--text-primary)] sm:text-5xl">
            Start With A Study Mode
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm text-[var(--text-secondary)] sm:text-base">
            Pick a mode to control how the assistant responds. You can switch at any time without resetting the conversation.
          </p>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ALL_MODES.map((mode) => {
            const config = getModeConfig(mode.key);

            return (
              <button
                key={mode.key}
                type="button"
                className="group relative overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]"
                onClick={() => onSelectMode(mode.key)}
              >
                <div
                  className="absolute inset-x-0 top-0 h-1 opacity-70"
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

        {agents.length > 0 && (
          <div>
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
          </div>
        )}
      </div>
    </div>
  );
}
