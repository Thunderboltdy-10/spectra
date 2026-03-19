"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, FileText, FlaskConical, PenLine, Cpu, CheckCircle2 } from "lucide-react";

const SCENARIOS = [
  {
    id: "math",
    tab: "Maths help",
    icon: FlaskConical,
    color: "var(--mode-tutor)",
    question: "How do I complete the square for x² + 6x + 5?",
    intentLabel: "Algebra · learning gap detected",
    contextItems: ["Year 11 Algebra module", "Quadratics gap — last session", "Prefers step-by-step"],
    mode: { label: "Learn", color: "var(--mode-tutor)" },
    model: { label: "DeepSeek R1", color: "var(--accent-mint)" },
    thinking: true,
    technique: "Socratic method · extended thinking",
    response: "Before I show you — what happens when you move the constant to the other side? Have a go, then tell me what you get.",
  },
  {
    id: "essay",
    tab: "Essay feedback",
    icon: PenLine,
    color: "var(--mode-draft_coach)",
    question: "Give me feedback on my climate migration intro.",
    intentLabel: "English Lit · feedback requested",
    contextItems: ["A-Level English Lit rubric", "Extended writing unit 3", "Draft stage 1 of 3"],
    mode: { label: "Coach", color: "var(--mode-draft_coach)" },
    model: { label: "Claude Sonnet", color: "var(--accent-coral)" },
    thinking: false,
    technique: "Process writing · iterative revision",
    response: "Your opening line grabs attention. Before I go further — what's your central claim? That'll help me give you sharper, targeted feedback.",
  },
  {
    id: "quiz",
    tab: "Quiz me",
    icon: BookOpen,
    color: "var(--mode-exam)",
    question: "Quiz me on the causes of World War I.",
    intentLabel: "History · active recall requested",
    contextItems: ["IB History HL syllabus", "Previous score: 6/10 on causes", "Weak area: alliance systems"],
    mode: { label: "Practice", color: "var(--mode-exam)" },
    model: { label: "Gemini 2.5 Pro", color: "var(--brand-accent)" },
    thinking: false,
    technique: "Spaced retrieval · adaptive difficulty",
    response: "Ready? Q1: What specific event in Sarajevo triggered the war — and which alliance system did it activate first?",
  },
  {
    id: "doc",
    tab: "Study notes",
    icon: FileText,
    color: "var(--mode-document)",
    question: "Create a structured study guide on the French Revolution.",
    intentLabel: "History · document generation",
    contextItems: ["GCSE History specification", "Unit 3: Revolution & Republic", "Exam in 3 weeks"],
    mode: { label: "Documents", color: "var(--mode-document)" },
    model: { label: "GPT-4o", color: "var(--mode-research)" },
    thinking: false,
    technique: "Structured output · curriculum-aligned",
    response: "Here's your guide: Causes → Key Events → Major Figures → Legacy. Export as PDF, or copy to notes?",
  },
] as const;

const PIPELINE_STAGES = [
  { key: "parse", label: "Parse intent" },
  { key: "context", label: "Pull context" },
  { key: "route", label: "Route decision" },
  { key: "generate", label: "Generate" },
] as const;

const STAGE_MS = 520;
const AUTO_MS = 7500;
const TICK_MS = 80;

export function OrchestrationDemo() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [stage, setStage] = useState(-1);
  const [timerPct, setTimerPct] = useState(0);
  const [chars, setChars] = useState(0);

  const elapsedRef = useRef(0);
  const activeRef = useRef(0);
  const isManualRef = useRef(false);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const charIntRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  function clearAll() {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    if (charIntRef.current) clearInterval(charIntRef.current);
  }

  function triggerScenario(idx: number) {
    clearAll();
    const i = (idx + SCENARIOS.length) % SCENARIOS.length;
    activeRef.current = i;
    elapsedRef.current = 0;
    setActiveIndex(i);
    setStage(-1);
    setTimerPct(0);
    setChars(0);

    PIPELINE_STAGES.forEach((_, si) => {
      timeoutsRef.current.push(setTimeout(() => setStage(si), 180 + si * STAGE_MS));
    });

    const completeAt = 180 + PIPELINE_STAGES.length * STAGE_MS + 80;
    timeoutsRef.current.push(setTimeout(() => {
      setStage(4);
      let c = 0;
      const text = SCENARIOS[i].response;
      charIntRef.current = setInterval(() => {
        c += 4;
        setChars(Math.min(c, text.length));
        if (c >= text.length && charIntRef.current) clearInterval(charIntRef.current);
      }, 18);
    }, completeAt));
  }

  useEffect(() => {
    const t = setTimeout(() => triggerScenario(0), 500);
    return () => { clearTimeout(t); clearAll(); };
  }, []);

  useEffect(() => {
    const tick = setInterval(() => {
      if (isManualRef.current) return;
      elapsedRef.current += TICK_MS;
      const pct = Math.min((elapsedRef.current / AUTO_MS) * 100, 100);
      setTimerPct(pct);
      if (elapsedRef.current >= AUTO_MS) {
        triggerScenario(activeRef.current + 1);
      }
    }, TICK_MS);
    return () => clearInterval(tick);
  }, []);

  function handleClick(i: number) {
    isManualRef.current = true;
    setTimeout(() => { isManualRef.current = false; }, 16_000);
    triggerScenario(i);
  }

  const scenario = SCENARIOS[activeIndex];
  const responseText = scenario.response.slice(0, chars);

  function stageState(i: number): "waiting" | "active" | "done" {
    if (stage < 0) return "waiting";
    if (stage >= 4 || i < stage) return "done";
    if (i === stage) return "active";
    return "waiting";
  }

  const stageDetails = [
    scenario.intentLabel,
    scenario.contextItems[0],
    `${scenario.mode.label} mode · ${scenario.model.label}`,
    "Streaming response…",
  ];

  return (
    <div
      className="w-full rounded-[2rem] overflow-hidden border border-[var(--border-default)]"
      style={{
        background: "var(--bg-elevated)",
        boxShadow: "0 32px 80px -24px rgba(0,0,0,0.25), 0 0 0 1px var(--border-default)",
      }}
    >
      {/* Window chrome */}
      <div
        className="flex items-center gap-2 px-5 py-4 border-b border-[var(--border-default)]"
        style={{ background: "var(--bg-secondary)" }}
      >
        {(["#ff5f57", "#febc2e", "#28c840"] as const).map((c, i) => (
          <div key={i} className="w-3.5 h-3.5 rounded-full" style={{ background: c, opacity: 0.8 }} />
        ))}
        <div className="flex items-center gap-2 ml-4">
          <Cpu size={14} style={{ color: "var(--brand-primary)" }} />
          <span className="text-[11px] font-mono font-bold uppercase tracking-[0.2em] text-[var(--text-tertiary)]">
            Spectra · Orchestration Engine
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ background: "var(--success)" }}
          />
          <span className="text-[11px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">Live</span>
        </div>
      </div>

      {/* Scenario tabs */}
      <div className="flex gap-3 px-6 pt-5 pb-3 overflow-x-auto scrollbar-none border-b border-[var(--border-default)]">
        {SCENARIOS.map((s, i) => {
          const isActive = activeIndex === i;
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              onClick={() => handleClick(i)}
              className="relative flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-semibold whitespace-nowrap shrink-0 border transition-all duration-300 overflow-hidden group hover:scale-105"
              style={{
                background: isActive
                  ? `color-mix(in oklab, ${s.color} 10%, var(--bg-secondary))`
                  : "var(--bg-secondary)",
                borderColor: isActive ? `${s.color}50` : "var(--border-default)",
                color: isActive ? s.color : "var(--text-secondary)",
              }}
            >
              {isActive && (
                <div
                  className="absolute inset-0 rounded-2xl pointer-events-none"
                  style={{
                    background: s.color,
                    opacity: 0.1,
                    transform: `scaleX(${timerPct / 100})`,
                    transformOrigin: "left",
                    transition: `transform ${TICK_MS}ms linear`,
                  }}
                />
              )}
              <Icon size={14} className="group-hover:rotate-12 transition-transform" />
              <span className="relative z-10">{s.tab}</span>
            </button>
          );
        })}
      </div>

      {/* Main body: pipeline + output swapped */}
      <div className="grid lg:grid-cols-[1fr_280px] min-h-[460px]">
        {/* Output panel (Left side now) */}
        <div className="p-8 flex flex-col gap-6">
          {/* Query at the top */}
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--text-tertiary)]">
              User Query
            </p>
            <p className="text-xl font-medium text-[var(--text-primary)] leading-tight italic">
              &ldquo;{scenario.question}&rdquo;
            </p>
          </div>

          <hr className="border-[var(--border-default)]" />

          {/* Context retrieved (Optional to keep or move) */}
          <div>
            <p
              className="text-[10px] font-black uppercase tracking-[0.25em] mb-3 transition-opacity duration-300"
              style={{ color: "var(--text-tertiary)", opacity: stage >= 1 ? 1 : 0.3 }}
            >
              Applied Context
            </p>
            <div className="flex flex-wrap gap-2">
              {scenario.contextItems.map((item, i) => (
                <div
                  key={item}
                  className="inline-flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full border transition-all duration-400"
                  style={{
                    opacity: stage >= 1 ? 1 : 0,
                    transform: stage >= 1 ? "none" : "translateY(10px)",
                    transitionDelay: `${i * 70}ms`,
                    background: "var(--bg-secondary)",
                    borderColor: "var(--border-default)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: "var(--brand-primary)" }}
                  />
                  {item}
                </div>
              ))}
            </div>
          </div>

          {/* Response Box - Minimalist clean text instead of weird container */}
          <div className="flex-1 mt-4">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--text-tertiary)] mb-4">
              AI Response
            </p>
            <div className="transition-all duration-500">
              {stage >= 4 ? (
                <div className="space-y-4">
                  <p className="text-lg text-[var(--text-primary)] leading-relaxed font-serif">
                    {responseText}
                    {chars < scenario.response.length && (
                      <span
                        className="inline-block w-1 h-5 align-middle ml-1 animate-pulse"
                        style={{ background: scenario.color }}
                      />
                    )}
                  </p>
                  <p
                    className="text-[11px] font-mono font-semibold inline-flex items-center gap-2 px-2 py-1 rounded"
                    style={{ color: scenario.color, background: `color-mix(in oklab, ${scenario.color} 10%, transparent)` }}
                  >
                    <CheckCircle2 size={12} /> {scenario.technique}
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-3 py-4">
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      background: stage >= 0 ? scenario.color : "var(--text-tertiary)",
                      animation: stage >= 0 ? "subtle-pulse 1s ease-in-out infinite" : "none",
                    }}
                  />
                  <span className="text-sm font-medium text-[var(--text-tertiary)]">
                    {stage >= 3 ? "Generating response…" : stage >= 0 ? "Orchestrating AI flow…" : "Awaiting input…"}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Pipeline Panel (Right side now) */}
        <div
          className="p-8 border-t lg:border-t-0 lg:border-l border-[var(--border-default)] flex flex-col gap-6"
          style={{ background: "color-mix(in oklab, var(--bg-secondary) 30%, var(--bg-elevated))" }}
        >
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-[var(--text-tertiary)]">
            Execution Pipeline
          </p>

          {/* Routing Tags Summary at top of pipeline */}
          <div className="flex flex-col gap-2">
            {[scenario.mode, scenario.model].map((tag, ti) => (
              <span
                key={ti}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-all duration-600"
                style={{
                  opacity: stage >= 2 ? 1 : 0.15,
                  transform: stage >= 2 ? "none" : "translateX(10px)",
                  transitionDelay: `${ti * 80}ms`,
                  borderColor: stage >= 2 ? `${tag.color}30` : "var(--border-default)",
                  background: stage >= 2 ? `color-mix(in oklab, ${tag.color} 10%, transparent)` : "transparent",
                  color: stage >= 2 ? tag.color : "var(--text-tertiary)",
                }}
              >
                <div
                  className="w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]"
                  style={{ background: tag.color }}
                />
                {tag.label}
              </span>
            ))}
            {scenario.thinking && (
              <span
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-all duration-600"
                style={{
                  opacity: stage >= 2 ? 1 : 0.15,
                  transitionDelay: "160ms",
                  borderColor: "var(--border-default)",
                  background: "transparent",
                  color: "var(--text-secondary)",
                }}
              >
                <Brain size={12} />
                Extended thinking
              </span>
            )}
          </div>

          <hr className="border-[var(--border-default)] my-2" />

          {/* Stages List */}
          <div className="relative flex flex-col gap-0 flex-1 mt-2">
            {/* Vertical track */}
            <div
              className="absolute left-[22px] top-6 bottom-6 w-0.5"
              style={{ background: "var(--border-default)" }}
            />
            {/* Progress fill */}
            <div
              className="absolute left-[22px] top-6 w-0.5 transition-all duration-500 rounded-full"
              style={{
                background: `linear-gradient(to bottom, ${scenario.color}, ${scenario.color}20)`,
                height: stage >= 0
                  ? `${Math.min(stage >= 4 ? 100 : (stage / (PIPELINE_STAGES.length - 1)) * 85, 100)}%`
                  : "0%",
                boxShadow: `0 0 12px ${scenario.color}`,
              }}
            />

            {PIPELINE_STAGES.map(({ label }, i) => {
              const s = stageState(i);
              return (
                <div key={i} className="relative flex items-start gap-4 py-4">
                  {/* Node */}
                  <div
                    className="relative z-10 w-10 h-10 rounded-full border-2 flex items-center justify-center shrink-0 transition-all duration-500"
                    style={{
                      background:
                        s === "done"
                          ? scenario.color
                          : s === "active"
                          ? "var(--bg-elevated)"
                          : "var(--bg-secondary)",
                      borderColor:
                        s === "done" || s === "active" ? scenario.color : "var(--border-default)",
                      boxShadow:
                        s === "active"
                          ? `0 0 16px color-mix(in oklab, ${scenario.color} 30%, transparent)`
                          : s === "done" ? `0 2px 8px color-mix(in oklab, ${scenario.color} 20%, transparent)` : "none",
                      transform: s === "active" ? "scale(1.05)" : "scale(1)",
                    }}
                  >
                    {s === "done" ? (
                      <CheckCircle2 size={16} color="white" strokeWidth={3} />
                    ) : (
                      <>
                        <span
                          className="text-xs font-black"
                          style={{ color: s === "active" ? scenario.color : "var(--text-tertiary)" }}
                        >
                          {i + 1}
                        </span>
                        {s === "active" && (
                          <div
                            className="absolute inset-0 rounded-full animate-ping"
                            style={{ background: scenario.color, opacity: 0.15 }}
                          />
                        )}
                      </>
                    )}
                  </div>

                  {/* Label */}
                  <div className="flex-1 min-w-0 pt-2.5">
                    <p
                      className="text-sm font-bold tracking-wide transition-colors duration-300"
                      style={{
                        color: s === "waiting" ? "var(--text-tertiary)" : "var(--text-primary)",
                      }}
                    >
                      {label}
                    </p>
                    {(s === "active" || s === "done") && (
                      <p
                        className="text-[11px] mt-1 leading-snug font-medium"
                        style={{
                          color: s === "done" ? `${scenario.color}dd` : "var(--text-secondary)",
                        }}
                      >
                        {stageDetails[i]}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom progress bar */}
      <div className="relative h-1" style={{ background: "var(--border-default)" }}>
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${timerPct}%`,
            background: `linear-gradient(to right, ${scenario.color}, ${scenario.color}80)`,
            transition: `width ${TICK_MS}ms linear`,
            boxShadow: `0 0 10px ${scenario.color}`,
          }}
        />
      </div>
    </div>
  );
}
// Required dummy component import to prevent errors if Brain isn't imported
import { Brain } from "lucide-react";