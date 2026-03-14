"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, FileText, FlaskConical, PenLine, Cpu, RotateCcw } from "lucide-react";

const SCENARIOS = [
  {
    id: "math",
    tab: "Maths help",
    icon: FlaskConical,
    question: "How do I complete the square for x² + 6x + 5?",
    mode: { label: "Learn", color: "var(--mode-tutor)" },
    model: { label: "DeepSeek R1", color: "var(--accent-mint)" },
    thinking: true,
    steps: ["Reading intent", "Detecting learning gap", "Activating Socratic pattern"],
    preview: "Before I show you — what happens when you move the constant to the other side? Have a go, and tell me what you get.",
    tag: "Socratic method · step-by-step",
  },
  {
    id: "essay",
    tab: "Essay feedback",
    icon: PenLine,
    question: "Give me feedback on my climate migration introduction.",
    mode: { label: "Coach", color: "var(--mode-draft_coach)" },
    model: { label: "Claude Sonnet", color: "var(--accent-coral)" },
    thinking: false,
    steps: ["Parsing writing context", "Applying rubric criteria", "Structuring feedback scaffold"],
    preview: "Your opening line grabs attention. Before I go further — what is your central argument? That'll help me give you sharper feedback.",
    tag: "Process writing · iterative revision",
  },
  {
    id: "quiz",
    tab: "Quiz me",
    icon: BookOpen,
    question: "Quiz me on the causes of World War I.",
    mode: { label: "Practice", color: "var(--mode-exam)" },
    model: { label: "Gemini 2.5 Pro", color: "var(--brand-accent)" },
    thinking: false,
    steps: ["Checking previous answers", "Calibrating difficulty", "Generating retrieval prompt"],
    preview: "Ready? Q1: What specific event in Sarajevo triggered the war — and which alliance system did it activate?",
    tag: "Active recall · spaced retrieval",
  },
  {
    id: "doc",
    tab: "Make study notes",
    icon: FileText,
    question: "Create a structured study guide on the French Revolution.",
    mode: { label: "Documents", color: "var(--mode-document)" },
    model: { label: "GPT-4o", color: "var(--mode-research)" },
    thinking: false,
    steps: ["Scanning school materials", "Structuring outline", "Generating export-ready content"],
    preview: "Here's your guide: Causes → Key Events → Major Figures → Legacy. Export to PDF or copy to notes?",
    tag: "Document mode · structured output",
  },
] as const;

const STEP_DELAYS = [80, 300, 550, 820, 1120];
const AUTO_ADVANCE_MS = 6000;
const TIMER_TICK_MS = 80;

export function OrchestrationDemo() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [animStep, setAnimStep] = useState(4);
  const [timerProgress, setTimerProgress] = useState(0);
  const [hoveredStep, setHoveredStep] = useState<number | null>(null);

  const elapsedRef = useRef(0);
  const activeIndexRef = useRef(0);
  const isManualRef = useRef(false);
  const manualTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const animTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  function triggerScenario(idx: number) {
    const next = Math.max(0, Math.min(idx, SCENARIOS.length - 1));
    activeIndexRef.current = next;
    elapsedRef.current = 0;
    setActiveIndex(next);
    setAnimStep(-1);
    setTimerProgress(0);
    setHoveredStep(null);
    animTimeoutsRef.current.forEach(clearTimeout);
    animTimeoutsRef.current = STEP_DELAYS.map((d, i) =>
      setTimeout(() => setAnimStep(i), d),
    );
  }

  // Timer — auto-advance
  useEffect(() => {
    const tick = setInterval(() => {
      if (isManualRef.current) return;
      elapsedRef.current += TIMER_TICK_MS;
      const pct = Math.min((elapsedRef.current / AUTO_ADVANCE_MS) * 100, 100);
      setTimerProgress(pct);
      if (elapsedRef.current >= AUTO_ADVANCE_MS) {
        const next = (activeIndexRef.current + 1) % SCENARIOS.length;
        triggerScenario(next);
      }
    }, TIMER_TICK_MS);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") handleManualClick((activeIndexRef.current - 1 + SCENARIOS.length) % SCENARIOS.length);
      if (e.key === "ArrowRight") handleManualClick((activeIndexRef.current + 1) % SCENARIOS.length);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleManualClick(i: number) {
    isManualRef.current = true;
    clearTimeout(manualTimeoutRef.current);
    manualTimeoutRef.current = setTimeout(() => {
      isManualRef.current = false;
    }, 15_000);
    triggerScenario(i);
  }

  function handleReplay() {
    isManualRef.current = false;
    triggerScenario(activeIndexRef.current);
  }

  const scenario = SCENARIOS[activeIndex];

  return (
    <div className="w-full flex flex-col lg:flex-row gap-5 lg:gap-8 items-stretch">
      {/* Scenario tabs */}
      <div className="w-full lg:w-60 flex flex-col gap-2 shrink-0">
        <p className="text-[9px] font-bold uppercase tracking-[0.25em] text-[var(--text-tertiary)] mb-1 px-1">
          Click · ← → to navigate
        </p>
        {SCENARIOS.map((s, i) => {
          const isActive = activeIndex === i;
          const ScenarioIcon = s.icon;
          return (
            <button
              key={s.id}
              onClick={() => handleManualClick(i)}
              className={`relative text-left rounded-2xl border overflow-hidden transition-all duration-300 ${
                isActive
                  ? "border-[var(--brand-primary)]/40 shadow-md"
                  : "border-[var(--border-default)] opacity-50 hover:opacity-90 hover:border-[var(--brand-primary)]/20"
              }`}
              style={{
                background: isActive ? "var(--bg-elevated)" : "var(--bg-secondary)",
              }}
            >
              {/* Progress fill */}
              {isActive && (
                <div
                  aria-hidden
                  className="absolute inset-0 rounded-2xl pointer-events-none"
                  style={{
                    background: "var(--brand-primary)",
                    opacity: 0.07,
                    transformOrigin: "left",
                    transform: `scaleX(${timerProgress / 100})`,
                    transition: `transform ${TIMER_TICK_MS}ms linear`,
                  }}
                />
              )}
              <div className="relative z-10 flex items-center gap-3 px-4 py-3.5">
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200 ${
                    isActive ? "text-white" : "text-[var(--text-secondary)]"
                  }`}
                  style={{
                    background: isActive ? "var(--brand-primary)" : "var(--bg-elevated)",
                    boxShadow: isActive ? "0 2px 8px color-mix(in oklab, var(--brand-primary) 30%, transparent)" : "none",
                  }}
                >
                  <ScenarioIcon size={15} />
                </div>
                <span
                  className={`text-sm font-semibold leading-tight transition-colors ${
                    isActive ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                  }`}
                >
                  {s.tab}
                </span>
              </div>
              {/* Bottom progress line */}
              {isActive && (
                <div
                  className="absolute bottom-0 left-0 h-[2px] rounded-full"
                  style={{
                    background: "linear-gradient(to right, var(--brand-primary), var(--brand-accent))",
                    width: `${timerProgress}%`,
                    transition: `width ${TIMER_TICK_MS}ms linear`,
                  }}
                />
              )}
            </button>
          );
        })}

        {/* Progress dots + replay */}
        <div className="flex items-center gap-2 mt-3 px-1">
          <div className="flex gap-1.5 flex-1">
            {SCENARIOS.map((_, i) => (
              <button
                key={i}
                className="h-1 flex-1 rounded-full transition-all duration-500 cursor-pointer hover:opacity-80"
                style={{
                  background: i <= activeIndex ? "var(--brand-primary)" : "var(--border-default)",
                }}
                onClick={() => handleManualClick(i)}
              />
            ))}
          </div>
          <button
            onClick={handleReplay}
            className="w-6 h-6 rounded-full flex items-center justify-center border border-[var(--border-default)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)] transition-all duration-200"
            style={{ color: "var(--text-tertiary)" }}
            title="Replay scenario"
          >
            <RotateCcw size={10} />
          </button>
        </div>
      </div>

      {/* Display panel */}
      <div
        className="flex-1 rounded-[2rem] border border-[var(--border-default)] overflow-hidden flex flex-col"
        style={{
          background: "var(--bg-elevated)",
          boxShadow: "0 0 0 1px var(--border-default), 0 24px 48px -16px rgba(0,0,0,0.12)",
        }}
      >
        {/* Panel header */}
        <div
          className="px-8 py-4 border-b border-[var(--border-default)] flex items-center gap-3"
          style={{ background: "var(--bg-secondary)" }}
        >
          <div
            className="w-8 h-8 rounded-xl border border-[var(--border-default)] flex items-center justify-center"
            style={{ background: "var(--bg-elevated)" }}
          >
            <Cpu size={15} className="text-[var(--brand-primary)]" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Live routing
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <div
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: "var(--success)" }}
            />
            <span className="text-[10px] text-[var(--text-tertiary)] font-medium">Active</span>
          </div>
        </div>

        <div className="p-8 flex flex-col gap-7 flex-1">
          {/* Question */}
          <div
            className={`transition-all duration-500 ${
              animStep >= 0 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-tertiary)] mb-3">
              Input
            </p>
            <p className="text-xl font-bold text-[var(--text-primary)] leading-snug">
              &ldquo;{scenario.question}&rdquo;
            </p>
          </div>

          {/* Routing steps */}
          <div
            className={`transition-all duration-500 ${
              animStep >= 1 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-tertiary)] mb-3">
              Routing
            </p>
            <div className="space-y-1">
              {scenario.steps.map((step, i) => (
                <div
                  key={step}
                  className={`flex items-center gap-2.5 text-sm transition-all duration-300 rounded-lg px-2 py-1.5 -mx-2 cursor-default ${
                    animStep > i ? "opacity-100" : "opacity-0"
                  }`}
                  style={{
                    background: hoveredStep === i ? scenario.mode.color + "12" : "transparent",
                  }}
                  onMouseEnter={() => setHoveredStep(i)}
                  onMouseLeave={() => setHoveredStep(null)}
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full shrink-0 transition-all duration-200"
                    style={{
                      background: hoveredStep === i ? scenario.mode.color : "var(--brand-primary)",
                      boxShadow: hoveredStep === i ? `0 0 8px ${scenario.mode.color}` : "none",
                      transform: hoveredStep === i ? "scale(1.3)" : "scale(1)",
                    }}
                  />
                  <span
                    className="transition-colors duration-200"
                    style={{
                      color: hoveredStep === i ? "var(--text-primary)" : "var(--text-secondary)",
                    }}
                  >
                    {step}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Decision */}
          <div
            className={`transition-all duration-500 ${
              animStep >= 2 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--text-tertiary)] mb-3">
              Selected
            </p>
            <div className="flex flex-wrap gap-2">
              <span
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all duration-200 hover:scale-105"
                style={{
                  borderColor: scenario.mode.color + "35",
                  background: scenario.mode.color + "10",
                  color: scenario.mode.color,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: scenario.mode.color }}
                />
                {scenario.mode.label} mode
              </span>
              <span
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border transition-all duration-200 hover:scale-105"
                style={{
                  borderColor: scenario.model.color + "35",
                  background: scenario.model.color + "10",
                  color: scenario.model.color,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: scenario.model.color }}
                />
                {scenario.model.label}
              </span>
              {scenario.thinking && (
                <span className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold border border-[var(--border-default)] text-[var(--text-secondary)] bg-[var(--bg-secondary)]">
                  Extended thinking
                </span>
              )}
            </div>
          </div>

          {/* Response */}
          <div
            className={`mt-auto pt-6 border-t border-[var(--border-default)] transition-all duration-700 ${
              animStep >= 4 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[var(--success)]">
                Response
              </span>
              <span
                className="text-[9px] font-mono px-2 py-1 rounded border"
                style={{
                  background: "var(--bg-secondary)",
                  borderColor: "var(--border-default)",
                  color: "var(--text-tertiary)",
                }}
              >
                {scenario.tag}
              </span>
            </div>
            <div
              className="rounded-2xl border border-[var(--border-default)] p-6"
              style={{ background: "var(--bg-secondary)" }}
            >
              <p className="text-base text-[var(--text-secondary)] leading-relaxed italic">
                &ldquo;{scenario.preview}&rdquo;
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
