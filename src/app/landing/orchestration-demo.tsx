"use client";

import { useEffect, useRef, useState } from "react";

const SCENARIOS = [
  {
    tab: "Math problem",
    question: "How do I solve a quadratic by completing the square?",
    mode: { label: "Tutor", color: "var(--mode-tutor)" },
    model: { label: "DeepSeek R1", color: "var(--success)" },
    agent: { label: "Maths Tutor", color: "var(--accent-cyan)" },
    preview:
      "Let's break this into steps. Start with x² + bx + c = 0, move c right, then add (b/2)² to both sides to form a perfect square. Want to try the first step together?",
  },
  {
    tab: "Essay draft",
    question: "Can you help me draft my introduction on climate migration?",
    mode: { label: "Draft Coach", color: "var(--mode-draft_coach)" },
    model: { label: "Claude Sonnet", color: "var(--accent-coral)" },
    agent: { label: "Writing Coach", color: "var(--accent-orange)" },
    preview:
      "Good topic. Before we draft, let's pin your thesis angle — are you arguing for policy intervention, or describing the humanitarian scale? That choice shapes everything.",
  },
  {
    tab: "Quiz me",
    question: "Quiz me on the causes of World War I",
    mode: { label: "Quiz", color: "var(--mode-quiz)" },
    model: { label: "Gemini Flash", color: "var(--accent-mint)" },
    agent: { label: "History Agent", color: "var(--warning)" },
    preview:
      "Ready? Question 1: What specific event in Sarajevo triggered the war, and which alliance system did it activate first — the Triple Entente or the Triple Alliance?",
  },
  {
    tab: "Research",
    question: "Find evidence on the effectiveness of spaced repetition",
    mode: { label: "Research", color: "var(--mode-research)" },
    model: { label: "Perplexity", color: "var(--brand-primary)" },
    agent: { label: "Research Aide", color: "var(--mode-explain)" },
    preview:
      "Synthesising sources… Ebbinghaus (1885) established the forgetting curve. Cepeda et al. (2006) found 10–30% retention gains over massed study across 8 controlled experiments.",
  },
];

export function OrchestrationDemo() {
  const [activeScenario, setActiveScenario] = useState(0);
  const [animStep, setAnimStep] = useState(-1);
  const timeoutIds = useRef<ReturnType<typeof setTimeout>[]>([]);
  const lastInteraction = useRef<number>(0);

  // Animation sequence
  useEffect(() => {
    timeoutIds.current.forEach(clearTimeout);
    timeoutIds.current = [];
    setAnimStep(-1);

    const ids: ReturnType<typeof setTimeout>[] = [];
    ids.push(setTimeout(() => setAnimStep(0), 60));
    ids.push(setTimeout(() => setAnimStep(1), 500));
    ids.push(setTimeout(() => setAnimStep(2), 1000));
    ids.push(setTimeout(() => setAnimStep(3), 1420));
    ids.push(setTimeout(() => setAnimStep(4), 1840));
    ids.push(setTimeout(() => setAnimStep(5), 2360));
    timeoutIds.current = ids;

    return () => {
      timeoutIds.current.forEach(clearTimeout);
      timeoutIds.current = [];
    };
  }, [activeScenario]);

  // Auto-cycle when idle > 10s
  useEffect(() => {
    const interval = setInterval(() => {
      if (Date.now() - lastInteraction.current > 10000) {
        setActiveScenario((prev) => (prev + 1) % SCENARIOS.length);
      }
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  function handleTabClick(i: number) {
    lastInteraction.current = Date.now();
    setActiveScenario(i);
  }

  const scenario = SCENARIOS[activeScenario];

  const anim = (n: number): React.CSSProperties => ({
    opacity: animStep >= n ? 1 : 0,
    transform: `translateY(${animStep >= n ? 0 : 8}px)`,
    transition:
      "opacity 280ms cubic-bezier(0.22,1,0.36,1), transform 280ms cubic-bezier(0.22,1,0.36,1)",
  });

  return (
    <div>
      {/* Scenario tabs */}
      <div className="flex flex-wrap gap-2 mb-5">
        {SCENARIOS.map((s, i) => (
          <button
            key={i}
            onClick={() => handleTabClick(i)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
              activeScenario === i
                ? "bg-[var(--brand-primary)] text-white"
                : "border border-[var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            }`}
          >
            {s.tab}
          </button>
        ))}
      </div>

      {/* Demo card */}
      <div className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 sm:p-6 shadow-[var(--shadow-card)]">
        {/* User question */}
        <div style={anim(0)}>
          <p className="text-xs text-[var(--text-tertiary)] font-medium mb-2">
            You ask
          </p>
          <div className="bg-[var(--bg-user-bubble)] rounded-xl px-4 py-3 text-sm leading-relaxed inline-block max-w-prose">
            {scenario.question}
          </div>
        </div>

        {/* Routing shimmer */}
        <div
          style={{
            opacity: animStep === 1 ? 1 : 0,
            maxHeight: animStep >= 1 ? 32 : 0,
            overflow: "hidden",
            transition: "opacity 200ms, max-height 200ms",
            marginTop: 12,
          }}
        >
          <span className="thinking-wave text-xs">Routing your query…</span>
        </div>

        {/* Route pills */}
        <div className="mt-4 flex flex-wrap gap-2 items-center">
          <div style={anim(2)}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] px-2.5 py-1 text-xs">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: scenario.mode.color }}
              />
              {scenario.mode.label}
            </span>
          </div>

          {animStep >= 3 && (
            <span
              className="text-[var(--text-tertiary)]"
              style={{ fontSize: 10 }}
            >
              →
            </span>
          )}

          <div style={anim(3)}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] px-2.5 py-1 text-xs">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: scenario.model.color }}
              />
              {scenario.model.label}
            </span>
          </div>

          {animStep >= 4 && (
            <span
              className="text-[var(--text-tertiary)]"
              style={{ fontSize: 10 }}
            >
              →
            </span>
          )}

          <div style={anim(4)}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] px-2.5 py-1 text-xs">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: scenario.agent.color }}
              />
              {scenario.agent.label}
            </span>
          </div>
        </div>

        {/* Response preview */}
        <div
          className="mt-5 pt-4 border-t border-[var(--border-default)]"
          style={anim(5)}
        >
          <p className="text-xs text-[var(--text-tertiary)] mb-2 font-medium">
            Response
          </p>
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
            {scenario.preview}
          </p>
        </div>
      </div>
    </div>
  );
}
