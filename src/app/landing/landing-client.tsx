"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  Sparkles,
  Network,
  ShieldCheck,
  BarChart3,
  BookOpen,
  Users,
  GraduationCap,
  Brain,
  Layers,
  Search,
  MessageCircle,
  FileText,
  CircleHelp,
  Lightbulb,
  ArrowRight,
  Bot,
  Zap,
  Database,
  FlaskConical,
  Pencil,
} from "lucide-react";
import { MODE_REGISTRY, COMING_SOON_MODES } from "@/lib/modes";
import { SoulDiagram } from "./soul-diagram";
import { PrismAnimation } from "./prism-section";
import { PricingSection } from "./pricing-section";
import { SpectraLogo } from "@/components/spectra-logo";

// ── Data ─────────────────────────────────────────────────────────────────────

const MODE_ICONS: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  tutor: GraduationCap,
  quiz: CircleHelp,
  flashcard: Layers,
  research: Search,
  document: FileText,
  general: MessageCircle,
  marker: BarChart3,
  exam: Brain,
  draft_coach: Lightbulb,
  explain: Lightbulb,
};

const SHOWN_MODES = ["tutor", "quiz", "flashcard", "research", "document", "general", "marker", "exam"] as const;

const HOW_IT_WORKS = [
  {
    Icon: MessageCircle,
    num: 1,
    title: "Ask naturally",
    body: "Type any question. No commands, no mode-switching, no special syntax required.",
  },
  {
    Icon: Network,
    num: 2,
    title: "Routes to the right mode",
    body: "The system reads intent and selects the pedagogical approach best suited to your goal.",
  },
  {
    Icon: BookOpen,
    num: 3,
    title: "Uses your school context",
    body: "Uploaded materials, curriculum standards, and teacher guidelines shape every answer.",
  },
  {
    Icon: Brain,
    num: 4,
    title: "Adapts to you over time",
    body: "A personal memory layer learns your pace, gaps, and style across every session.",
  },
];

const AGENTS = [
  {
    symbol: "Sc",
    name: "Science Tutor",
    subject: "Biology · Chemistry · Physics",
    color: "var(--accent-mint)",
    snippet: {
      user: "Explain why enzymes denature at high temperatures.",
      reply: "Before the textbook answer — what do you think happens to the enzyme's shape as heat increases? Take a guess.",
      technique: "Socratic method",
    },
  },
  {
    symbol: "Ec",
    name: "Essay Coach",
    subject: "English · History · Humanities",
    color: "var(--accent-coral)",
    snippet: {
      user: "Can you check my introduction?",
      reply: "Your hook is strong. But your central claim is buried in sentence four — move it to sentence two and I'll review the rest.",
      technique: "Process writing",
    },
  },
  {
    symbol: "∑",
    name: "Maths Specialist",
    subject: "Algebra · Calculus · Statistics",
    color: "var(--mode-tutor)",
    snippet: {
      user: "I keep getting the wrong answer for differentiation.",
      reply: "Show me your working for the last question. The error is likely in step 2 — let's find exactly where it breaks.",
      technique: "Error diagnosis",
    },
  },
  {
    symbol: "Ra",
    name: "Research Assistant",
    subject: "Cross-subject · Sourcing · Analysis",
    color: "var(--mode-research)",
    snippet: {
      user: "Find sources on climate migration for my essay.",
      reply: "Here are 4 peer-reviewed sources. Source 3 contradicts your thesis — do you want to address it or refine your argument?",
      technique: "Evidence synthesis",
    },
  },
];

// Mode hover examples — shown in place of description on hover
const MODE_EXAMPLES: Record<string, string> = {
  tutor: "\"What do you think happens to the equation when you move the constant? Try it first.\"",
  marker: "\"Paragraph 2 is strong, but needs a textual quote. See the rubric at Bloom's L5.\"",
  exam: "\"Q: Name the three branches of the US government. 45 seconds — go.\"",
  draft_coach: "\"Your intro grabs attention. What's your central claim before I dive deeper?\"",
  quiz: "\"Front: What triggers an action potential? Flip to check.\"",
  flashcard: "\"Card 1 of 12 — Mitosis stages: PMAT. Tap when ready for the next.\"",
  research: "\"Source 1 supports your thesis. Source 3 contradicts it. How do you reconcile them?\"",
  document: "\"Generating study guide: Causes → Events → Figures → Legacy. Export as PDF?\"",
  general: "\"Sure — ask me anything. I'll follow your lead.\"",
};

const STAKEHOLDERS = [
  {
    role: "For students",
    Icon: GraduationCap,
    color: "var(--mode-tutor)",
    tagline: "Structured help, not shortcuts",
    points: [
      "12 learning modes (8 live + 4 staged), with auto-routing",
      "Two-layer memory fabric that builds across sessions",
      "Every response anchored to your school's culture, values, and curriculum",
      "Guided discovery — builds AI literacy alongside subject knowledge",
    ],
  },
  {
    role: "For teachers",
    Icon: Users,
    color: "var(--mode-marker)",
    tagline: "Your materials. Your context.",
    points: [
      "Upload class notes, rubrics, and past papers",
      "Custom AI agents per subject or topic",
      "See how students are using AI — and what they're asking",
      "AI that reflects your pedagogy, not a generic chatbot shell",
    ],
  },
];

// ── Count-up hook ─────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 1500) {
  const [count, setCount] = useState(0);
  const triggered = useRef(false);
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !triggered.current) {
          triggered.current = true;
          observer.unobserve(el);
          const start = performance.now();
          function tick(now: number) {
            const p = Math.min((now - start) / duration, 1);
            setCount(Math.round((1 - Math.pow(1 - p, 4)) * target));
            if (p < 1) requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [target, duration]);

  return [count, elRef] as [number, React.RefObject<HTMLDivElement>];
}

// ── SVG Shape Dividers ────────────────────────────────────────────────────────

function WaveA() {
  // bg-primary → bg-secondary (wave going down-right)
  return (
    <div style={{ lineHeight: 0, pointerEvents: "none", background: "var(--bg-primary)" }}>
      <svg viewBox="0 0 1440 64" style={{ display: "block", width: "100%", height: 64 }} preserveAspectRatio="none" aria-hidden>
        <path d="M0,64 L1440,64 L1440,24 Q1100,64 720,32 Q340,0 0,48 Z" fill="var(--bg-secondary)" />
      </svg>
    </div>
  );
}

function WaveB() {
  // bg-secondary → bg-primary (wave going up-left)
  return (
    <div style={{ lineHeight: 0, pointerEvents: "none", background: "var(--bg-secondary)" }}>
      <svg viewBox="0 0 1440 64" style={{ display: "block", width: "100%", height: 64 }} preserveAspectRatio="none" aria-hidden>
        <path d="M0,64 L0,40 Q360,0 720,28 Q1100,56 1440,18 L1440,64 Z" fill="var(--bg-primary)" />
      </svg>
    </div>
  );
}

function ArchSlash() {
  // bg-primary → bg-secondary (asymmetric diagonal)
  return (
    <div style={{ lineHeight: 0, pointerEvents: "none", background: "var(--bg-primary)" }}>
      <svg viewBox="0 0 1440 72" style={{ display: "block", width: "100%", height: 72 }} preserveAspectRatio="none" aria-hidden>
        <path d="M0,72 L1440,72 L1440,16 Q720,-24 0,72 Z" fill="var(--bg-secondary)" />
      </svg>
    </div>
  );
}

function DoubleWaveDown() {
  // bg-secondary → bg-primary (double wave)
  return (
    <div style={{ lineHeight: 0, pointerEvents: "none", background: "var(--bg-secondary)" }}>
      <svg viewBox="0 0 1440 56" style={{ display: "block", width: "100%", height: 56 }} preserveAspectRatio="none" aria-hidden>
        <path d="M0,56 L0,20 Q240,56 480,28 Q720,0 960,32 Q1200,56 1440,16 L1440,56 Z" fill="var(--bg-primary)" />
      </svg>
    </div>
  );
}

function ChevronDown() {
  // bg-primary → bg-secondary (pointed chevron)
  return (
    <div style={{ lineHeight: 0, pointerEvents: "none", background: "var(--bg-primary)" }}>
      <svg viewBox="0 0 1440 56" style={{ display: "block", width: "100%", height: 56 }} preserveAspectRatio="none" aria-hidden>
        <path d="M0,56 L1440,56 L1440,20 L720,56 L0,20 Z" fill="var(--bg-secondary)" />
      </svg>
    </div>
  );
}

function ChevronUp() {
  // bg-secondary → bg-primary (pointed chevron up)
  return (
    <div style={{ lineHeight: 0, pointerEvents: "none", background: "var(--bg-secondary)" }}>
      <svg viewBox="0 0 1440 56" style={{ display: "block", width: "100%", height: 56 }} preserveAspectRatio="none" aria-hidden>
        <path d="M0,56 L0,36 L720,0 L1440,36 L1440,56 Z" fill="var(--bg-primary)" />
      </svg>
    </div>
  );
}

// ── Hero Live Demo ────────────────────────────────────────────────────────────

// Cycles through 3 different scenarios (not just Newton's laws)
const HERO_SCENARIOS = [
  {
    user: "I need to understand Newton\u2019s laws for my exam tomorrow",
    mode: { label: "Tutor mode", color: "var(--mode-tutor)" },
    model: { label: "DeepSeek R1", color: "var(--accent-mint)" },
    agent: { label: "Science Tutor", color: "var(--accent-coral)" },
    reply: "Let\u2019s work through this together. Newton\u2019s first law says an object at rest stays at rest unless a force acts. What do you already know about inertia?",
    tag: "Socratic method \u00b7 step-by-step",
  },
  {
    user: "Can you quiz me on the causes of World War I?",
    mode: { label: "Practice mode", color: "var(--mode-exam)" },
    model: { label: "Gemini", color: "var(--brand-accent)" },
    agent: { label: "History agent", color: "var(--mode-research)" },
    reply: "Ready? Q1: What event in Sarajevo triggered the war \u2014 and which alliance did it activate first?",
    tag: "Active recall \u00b7 spaced retrieval",
  },
  {
    user: "Give me feedback on my essay introduction.",
    mode: { label: "Coach mode", color: "var(--mode-draft_coach)" },
    model: { label: "Claude", color: "var(--accent-coral)" },
    agent: { label: "Essay Coach", color: "var(--accent-mint)" },
    reply: "Your opening line is strong. Before I go further \u2014 what\u2019s your central argument? I\u2019ll give you sharper feedback once I know your claim.",
    tag: "Process writing \u00b7 iterative revision",
  },
];

type TraceStep = 0 | 1 | 2 | 3 | 4 | 5;

function HeroDemo() {
  const [step, setStep] = useState<TraceStep>(5);
  const [scenarioIdx, setScenarioIdx] = useState(0);

  useEffect(() => {
    const cancelled = { current: false };
    let scenarioCounter = 0;

    function runCycle() {
      if (cancelled.current) return;
      const ids: ReturnType<typeof setTimeout>[] = [];
      const t = (n: number, fn: () => void) => ids.push(setTimeout(() => { if (!cancelled.current) fn(); }, n));

      t(0, () => setStep(0));
      t(500, () => setStep(1));
      t(1100, () => setStep(2));
      t(1700, () => setStep(3));
      t(2300, () => setStep(4));
      t(3000, () => setStep(5));
      // After 7s showing completed state, switch scenario and replay
      t(7200, () => {
        if (!cancelled.current) {
          scenarioCounter = (scenarioCounter + 1) % HERO_SCENARIOS.length;
          setScenarioIdx(scenarioCounter);
          // Brief reset then immediately restart
          setStep(0);
          runCycle();
        }
      });
    }

    const initId = setTimeout(() => { if (!cancelled.current) runCycle(); }, 400);

    return () => {
      cancelled.current = true;
      clearTimeout(initId);
    };
  }, []);

  const visible = (n: number) => step >= n;
  const anim = (n: number): React.CSSProperties => ({
    opacity: visible(n) ? 1 : 0,
    transform: `translateY(${visible(n) ? 0 : 8}px)`,
    transition: "opacity 320ms cubic-bezier(0.22,1,0.36,1), transform 320ms cubic-bezier(0.22,1,0.36,1)",
  });

  const scenario = HERO_SCENARIOS[scenarioIdx];

  return (
    <div className="relative w-full max-w-2xl mx-auto scale-105 transform origin-center">
      {/* Ambient glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          inset: -60,
          background: "radial-gradient(ellipse 65% 55% at 50% 50%, color-mix(in oklab, var(--brand-primary) 12%, transparent), transparent 70%)",
          zIndex: 0,
        }}
      />

      {/* Live indicator */}
      <div className="flex items-center gap-2 mb-4 justify-end relative z-10">
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: "var(--success)", animation: "subtle-pulse 2s ease-in-out infinite" }}
        />
        <span className="text-sm font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">Live routing demo</span>
      </div>

      {/* Card */}
      <div
        className="relative z-10 rounded-[2rem] border overflow-hidden"
        style={{
          background: "var(--bg-elevated)",
          borderColor: "var(--border-default)",
          boxShadow: "0 32px 80px -20px rgba(0,0,0,0.3), 0 0 0 1px var(--border-default)",
        }}
      >
        {/* Window chrome */}
        <div
          className="px-6 py-4 flex items-center gap-2.5 border-b border-[var(--border-default)]"
          style={{ background: "var(--bg-secondary)" }}
        >
          {(["#ff5f57", "#febc2e", "#28c840"] as const).map((c, i) => (
            <div key={i} className="w-3.5 h-3.5 rounded-full opacity-80" style={{ background: c }} />
          ))}
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--text-tertiary)] mx-auto">
            Spectra Routing
          </span>
        </div>

        <div className="p-8 space-y-6">
          {/* User bubble */}
          <div style={anim(0)}>
            <div
              className="inline-block rounded-2xl px-5 py-4 text-lg font-medium leading-relaxed max-w-[90%]"
              style={{ background: "var(--bg-user-bubble)" }}
            >
              {scenario.user}
            </div>
          </div>

          {/* Routing state */}
          <div
            style={{
              opacity: step === 1 ? 1 : 0,
              maxHeight: step === 1 ? 32 : 0,
              overflow: "hidden",
              transition: "opacity 200ms, max-height 200ms",
            }}
          >
            <span className="thinking-wave text-sm font-medium text-[var(--text-tertiary)] italic">Analyzing intent & routing…</span>
          </div>

          {/* Route pills */}
          <div className="flex flex-wrap gap-3">
            {[scenario.mode, scenario.model, scenario.agent].map((tag, ti) => (
              <div key={ti} style={anim(ti + 2)}>
                <span
                  className="inline-flex items-center gap-2 rounded-xl border px-3.5 py-1.5 text-sm font-bold shadow-sm"
                  style={{
                    borderColor: tag.color + "40",
                    background: `color-mix(in oklab, ${tag.color} 10%, var(--bg-elevated))`,
                    color: tag.color,
                  }}
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: tag.color, boxShadow: `0 0 8px ${tag.color}` }} />
                  {tag.label}
                </span>
              </div>
            ))}
          </div>

          {/* Response */}
          <div
            className="pt-6 border-t border-[var(--border-default)]"
            style={anim(5)}
          >
            <p className="text-lg text-[var(--text-primary)] leading-relaxed font-serif">
              {scenario.reply}
            </p>
            <p className="mt-4 text-xs font-mono font-semibold" style={{ color: "var(--text-tertiary)" }}>
              {scenario.tag}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stat strip ────────────────────────────────────────────────────────────────

function StatStrip() {
  const [modes, modesRef] = useCountUp(12);
  const [models, modelsRef] = useCountUp(260);

  return (
    <div style={{ background: "var(--bg-secondary)", borderTop: "1px solid var(--border-default)", borderBottom: "1px solid var(--border-default)" }}>
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex divide-x divide-[var(--border-default)]">
          {[
            { ref: modesRef, display: String(modes), label: "learning modes", sub: "each with a distinct pedagogy" },
            { ref: modelsRef, display: `${models}+`, label: "active AI models", sub: "continuously refreshed routing catalog" },
            { ref: null, display: "2-layer", label: "personalisation", sub: "school context + personal memory" },
          ].map((s, i) => (
            <div
              key={i}
              ref={s.ref ?? undefined}
              className="flex-1 py-10 sm:py-14 px-6 text-center cursor-default group"
            >
              <p
                className="font-display text-4xl sm:text-5xl tracking-tight transition-colors duration-300 group-hover:text-[var(--brand-primary)]"
                style={{ color: "var(--text-primary)" }}
              >
                {s.display}
              </p>
              <p
                className="text-xs font-bold uppercase tracking-widest mt-1.5"
                style={{ color: "var(--text-secondary)" }}
              >
                {s.label}
              </p>
              <p
                className="text-[10px] mt-1 max-w-[140px] mx-auto leading-snug"
                style={{ color: "var(--text-tertiary)" }}
              >
                {s.sub}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── How It Works Timeline ─────────────────────────────────────────────────────

function HowItWorksTimeline() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeStep, setActiveStep] = useState(-1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Reveal steps with stagger
          HOW_IT_WORKS.forEach((_, i) => {
            setTimeout(() => setActiveStep(i), 200 + i * 350);
          });
        }
      },
      { threshold: 0.2 },
    );
    obs.observe(container);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative w-full py-10 mt-8">
      {/* Background ambient glow */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          background: "radial-gradient(ellipse 80% 50% at 50% 50%, var(--brand-primary), transparent 70%)",
          filter: "blur(60px)"
        }}
      />
      
      {/* Horizontal timeline line */}
      <div className="absolute top-[28px] left-[12.5%] right-[12.5%] h-[2px] hidden md:block" aria-hidden>
        <div className="absolute inset-0" style={{ background: "var(--border-default)", opacity: 0.5 }} />
        <div 
          className="absolute inset-y-0 left-0 transition-all duration-1000 ease-out"
          style={{ 
            background: "linear-gradient(90deg, var(--brand-primary), var(--brand-accent))",
            boxShadow: "0 0 12px var(--brand-primary)",
            width: activeStep >= 0 ? `${Math.min((activeStep / (HOW_IT_WORKS.length - 1)) * 100, 100)}%` : "0%"
          }} 
        />
      </div>

      <div className="grid md:grid-cols-4 gap-12 md:gap-4 relative z-10">
        {HOW_IT_WORKS.map(({ num, title, body, Icon }, i) => {
          const isVisible = activeStep >= i;
          return (
            <div
              key={num}
              className="relative flex flex-col items-center text-center group"
              style={{
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? "none" : "translateY(20px)",
                transition: "opacity 0.6s cubic-bezier(0.22,1,0.36,1), transform 0.6s cubic-bezier(0.22,1,0.36,1)",
              }}
            >
              {/* Node perfectly aligned with the line at top: 28px center means h-14 (56px) needs top 0 */}
              <div 
                className="w-14 h-14 rounded-full flex items-center justify-center shrink-0 mb-6 relative z-10 transition-all duration-500 mx-auto"
                style={{
                  background: isVisible ? "var(--bg-elevated)" : "var(--bg-secondary)",
                  border: `2px solid ${isVisible ? "var(--brand-primary)" : "var(--border-default)"}`,
                  color: isVisible ? "var(--brand-primary)" : "var(--text-tertiary)",
                  boxShadow: isVisible ? "0 0 30px color-mix(in oklab, var(--brand-primary) 30%, transparent), inset 0 0 15px color-mix(in oklab, var(--brand-primary) 10%, transparent)" : "none",
                  transform: isVisible ? "scale(1)" : "scale(0.8)"
                }}
              >
                <Icon size={24} strokeWidth={1.5} className="group-hover:scale-110 transition-transform duration-300" />
                {isVisible && (
                  <div className="absolute inset-0 rounded-full opacity-20" style={{ background: "var(--brand-primary)", animation: "ping 1.5s cubic-bezier(0, 0, 0.2, 1) forwards" }} />
                )}
                {/* Step Number Badge */}
                <div 
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white transition-opacity duration-500"
                  style={{ background: "var(--brand-primary)", opacity: isVisible ? 1 : 0 }}
                >
                  {num}
                </div>
              </div>

              {/* Step Content */}
              <div className="px-4">
                <h3 className="font-display text-lg font-bold mb-2 group-hover:text-[var(--brand-primary)] transition-colors">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {body}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Contact Form ─────────────────────────────────────────────────────────────

function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", school: "", role: "", message: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "fallback" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [fallbackUrl, setFallbackUrl] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      if (data.status === "sent") {
        setStatus("sent");
      } else if (data.status === "fallback" && data.mailto) {
        setFallbackUrl(data.mailto);
        setStatus("fallback");
      } else {
        const errMsg = typeof data.error === "string" ? data.error : data.error?.message || "Something went wrong.";
        setErrorMsg(errMsg);
        setStatus("error");
      }
    } catch {
      setErrorMsg("Network error. Please try again.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="text-center py-12" data-reveal>
        <p className="font-display text-xl font-bold mb-2">Thanks for reaching out.</p>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>We&apos;ll get back to you soon.</p>
      </div>
    );
  }

  if (status === "fallback") {
    return (
      <div className="text-center py-12" data-reveal>
        <p className="font-display text-xl font-bold mb-2">Almost there</p>
        <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>Click below to send your message via email.</p>
        <a
          href={fallbackUrl}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-white font-bold text-sm"
          style={{ background: "var(--brand-primary)" }}
        >
          Open email client
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" data-reveal>
      <div className="grid sm:grid-cols-2 gap-4">
        <input
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Name *"
          className="w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--brand-primary)] placeholder:text-[var(--text-tertiary)]"
        />
        <input
          required
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="Email *"
          className="w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--brand-primary)] placeholder:text-[var(--text-tertiary)]"
        />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <input
          value={form.school}
          onChange={(e) => setForm({ ...form, school: e.target.value })}
          placeholder="School / Institution"
          className="w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--brand-primary)] placeholder:text-[var(--text-tertiary)]"
        />
        <select
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
          className="w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--brand-primary)]"
          style={{ color: form.role ? "var(--text-primary)" : "var(--text-tertiary)" }}
        >
          <option value="">Role</option>
          <option value="Student">Student</option>
          <option value="Teacher">Teacher</option>
          <option value="Administrator">Administrator</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <textarea
        required
        value={form.message}
        onChange={(e) => setForm({ ...form, message: e.target.value })}
        placeholder="Message *"
        rows={4}
        className="w-full rounded-[var(--radius-input)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--brand-primary)] placeholder:text-[var(--text-tertiary)] resize-none"
      />
      {status === "error" && errorMsg && (
        <p className="text-sm text-[var(--danger)]">{errorMsg}</p>
      )}
      <button
        type="submit"
        disabled={status === "sending"}
        className="w-full px-6 py-3.5 rounded-xl text-white font-bold text-sm transition-all hover:-translate-y-0.5 disabled:opacity-60"
        style={{
          background: "var(--brand-primary)",
          boxShadow: "0 4px 16px color-mix(in oklab, var(--brand-primary) 25%, transparent)",
        }}
      >
        {status === "sending" ? "Sending..." : "Send message"}
      </button>
    </form>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function LandingClient() {
  const [scrolled, setScrolled] = useState(false);
  const [aiCoreHovered, setAiCoreHovered] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);
  const handlePulseTrigger = () => setPulseKey(k => k + 1);

  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);

  // Scroll-reveal
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            const delay = e.target.getAttribute("data-delay") ?? "0";
            setTimeout(() => e.target.classList.add("is-visible"), Number(delay));
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.06, rootMargin: "0px 0px -24px 0px" },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  return (
    <div
      className="min-h-screen overflow-x-hidden"
      style={{ background: "var(--bg-primary)", color: "var(--text-primary)" }}
    >
      <style dangerouslySetInnerHTML={{ __html: `
        /* Reveal */
        [data-reveal] {
          opacity: 0;
          transform: translateY(24px);
          transition: opacity 0.8s cubic-bezier(0.22,1,0.36,1), transform 0.8s cubic-bezier(0.22,1,0.36,1);
        }
        [data-reveal].is-visible { opacity: 1; transform: none; }

        /* Hero entry */
        @keyframes hero-in {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: none; }
        }
        .hero-in-1 { animation: hero-in 0.9s cubic-bezier(0.22,1,0.36,1) 0.05s both; }
        .hero-in-2 { animation: hero-in 0.9s cubic-bezier(0.22,1,0.36,1) 0.15s both; }
        .hero-in-3 { animation: hero-in 0.9s cubic-bezier(0.22,1,0.36,1) 0.28s both; }
        .hero-in-4 { animation: hero-in 0.9s cubic-bezier(0.22,1,0.36,1) 0.42s both; }
        .hero-in-5 { animation: hero-in 1s cubic-bezier(0.22,1,0.36,1) 0.5s both; }

        /* Subtle pulse for live dot */
        @keyframes subtle-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }

        /* Thinking wave for routing */
        @keyframes thinking-wave {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        .thinking-wave { animation: thinking-wave 1.2s ease-in-out infinite; }

        /* Hero grid with blue glow */
        .hero-grid {
          background-image:
            linear-gradient(to right, color-mix(in oklab, var(--border-default) 60%, transparent) 1px, transparent 1px),
            linear-gradient(to bottom, color-mix(in oklab, var(--border-default) 60%, transparent) 1px, transparent 1px);
          background-size: 48px 48px;
        }
        .hero-grid-fade {
          background: radial-gradient(ellipse 75% 70% at 50% 45%, transparent 30%, var(--bg-primary) 100%);
        }

        /* Mode cards */
        .mode-card {
          --mode-color: transparent;
          transition: box-shadow 0.3s ease, border-color 0.3s ease;
        }
        .mode-card:hover {
          border-color: color-mix(in oklab, var(--mode-color) 35%, var(--border-default)) !important;
          box-shadow:
            0 16px 40px -12px color-mix(in oklab, var(--mode-color) 18%, transparent),
            0 0 0 1px color-mix(in oklab, var(--mode-color) 20%, transparent);
        }

        .mode-card .mode-icon {
          transition: all 0.5s cubic-bezier(0.22,1,0.36,1);
          transform-origin: center;
        }
        .mode-card:hover .mode-icon {
          transform: scale(8) translate(14px, 8px);
          opacity: 0.05;
          background: transparent !important;
          border-color: transparent !important;
        }

        .mode-card .mode-label-container {
          transition: all 0.5s cubic-bezier(0.22,1,0.36,1);
          transform-origin: center center;
        }
        .mode-card:hover .mode-label-container {
          transform: scale(1.0) translateY(-54px);
          justify-content: center;
          width: 100%;
        }

        .mode-card .mode-desc, .mode-card .mode-arrow {
          transition: opacity 0.3s ease, transform 0.3s ease;
        }
        .mode-card:hover .mode-desc, .mode-card:hover .mode-arrow {
          opacity: 0;
          transform: translateY(10px);
          pointer-events: none;
        }

        /* Mode card example text */
        .mode-card .mode-example {
          opacity: 0; transform: translateY(12px);
          transition: opacity 0.4s ease 0.1s, transform 0.4s ease 0.1s;
          position: absolute; inset: 0; padding: 28px;
          display: flex; flex-direction: column; justify-content: center; align-items: center;
          text-align: center;
          pointer-events: none;
        }
        .mode-card:hover .mode-example { opacity: 1; transform: translateY(10px); pointer-events: auto; }

        /* Timeline line — animated via scaleY so it "draws" downward */
        .timeline-line-track {
          transform-origin: top center;
          transform: scaleY(0);
          transition: transform 2.6s cubic-bezier(0.22,1,0.36,1);
        }
        .timeline-line-track.drawn { transform: scaleY(1); }

        /* Agent cards */
        .agent-card {
          transition: box-shadow 0.3s ease, border-color 0.3s ease;
        }
        .agent-card .agent-default { transition: opacity 0.25s ease, transform 0.25s ease; }
        .agent-card .agent-snippet {
          opacity: 0; transform: translateY(8px);
          transition: opacity 0.3s ease 0.05s, transform 0.3s ease 0.05s;
          position: absolute; inset: 0; padding: 28px;
          display: flex; flex-direction: column; justify-content: flex-end;
          pointer-events: none;
        }
        .agent-card:hover .agent-default { opacity: 0; transform: translateY(-6px); }
        .agent-card:hover .agent-snippet { opacity: 1; transform: none; pointer-events: auto; }

        /* Pricing slider */
        .pricing-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 24px; height: 24px;
          border-radius: 50%;
          background: var(--bg-elevated);
          border: 3px solid var(--brand-primary);
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          cursor: pointer;
          transition: transform 0.15s ease;
        }
        .pricing-slider::-webkit-slider-thumb:hover { transform: scale(1.15); }
        .pricing-slider::-moz-range-thumb {
          width: 24px; height: 24px;
          border-radius: 50%;
          background: var(--bg-elevated);
          border: 3px solid var(--brand-primary);
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          cursor: pointer;
        }

        @media (prefers-reduced-motion: reduce) {
          [data-reveal], .hero-in-1, .hero-in-2, .hero-in-3, .hero-in-4, .hero-in-5 {
            animation: none !important; transition: none !important; opacity: 1 !important; transform: none !important;
          }
          .mode-card, .agent-card, .stakeholder-card { transition: none !important; }
          .timeline-line { transition: none !important; }
        }
      ` }} />

      {/* ── Navbar ── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          padding: scrolled ? "0.75rem 0" : "1.5rem 0",
          background: scrolled ? "color-mix(in oklab, var(--bg-primary) 88%, transparent)" : "transparent",
          backdropFilter: scrolled ? "blur(16px)" : "none",
          borderBottom: scrolled ? "1px solid var(--border-default)" : "none",
        }}
      >
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <SpectraLogo size={30} />
            <span className="font-display text-xl tracking-tight" style={{ color: "var(--text-primary)" }}>
              Spectra
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/sign-in"
              className="text-sm font-medium transition-colors"
              style={{ color: "var(--text-secondary)" }}
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="px-5 py-2.5 text-sm font-bold rounded-xl text-white transition-all hover:-translate-y-0.5"
              style={{
                background: "var(--brand-primary)",
                boxShadow: "0 2px 8px color-mix(in oklab, var(--brand-primary) 25%, transparent)",
              }}
            >
              Get started
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative min-h-[100svh] flex items-center pt-28 pb-16 overflow-hidden">
        {/* Grid background */}
        <div className="absolute inset-0 hero-grid opacity-[0.55] pointer-events-none" />
        <div className="absolute inset-0 hero-grid-fade pointer-events-none" />

        {/* Blue glow blob */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: "15%",
            left: "40%",
            width: 700,
            height: 600,
            background: "var(--brand-primary)",
            opacity: 0.05,
            filter: "blur(160px)",
            borderRadius: "50%",
          }}
        />
        {/* Secondary accent glow */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: "55%",
            right: "5%",
            width: 400,
            height: 300,
            background: "var(--brand-accent)",
            opacity: 0.04,
            filter: "blur(100px)",
            borderRadius: "50%",
          }}
        />

        <div className="relative z-10 max-w-7xl mx-auto px-6 w-full">
          <div className="grid lg:grid-cols-2 gap-16 lg:gap-20 items-center">
            <div className="max-w-lg">
              {/* Live badge */}
              <div
                className="hero-in-1 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest mb-8 border"
                style={{
                  background: "var(--bg-secondary)",
                  borderColor: "var(--border-default)",
                  color: "var(--text-tertiary)",
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: "var(--success)", animation: "subtle-pulse 2s ease-in-out infinite" }}
                />
                Spectra · School-grade AI
              </div>

              <h1
                className="hero-in-2 font-display font-bold leading-[1.04] mb-6"
                style={{ fontSize: "clamp(2.75rem, 6vw, 4.5rem)" }}
              >
                Right AI for the
                <br />
                <span style={{ color: "var(--brand-primary)" }}>Right Task.</span>
              </h1>

              <p
                className="hero-in-3 text-lg leading-relaxed mb-8"
                style={{ color: "var(--text-secondary)", maxWidth: "32rem" }}
              >
                Spectra is an AI School Studio platform for schools: mode-aware orchestration,
                evidence-first responses, and memory grounded in your curriculum. Routing stays
                fresh from a live model catalog, reliability fallbacks prevent empty responses,
                and every workflow remains budget-aware by design.
              </p>

              <div className="hero-in-4 flex flex-wrap items-center gap-4">
                <Link
                  href="/sign-up"
                  className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-white text-sm font-bold transition-all hover:-translate-y-0.5"
                  style={{
                    background: "var(--brand-primary)",
                    boxShadow: "0 6px 20px color-mix(in oklab, var(--brand-primary) 28%, transparent)",
                  }}
                >
                  Get started
                  <ArrowRight size={15} />
                </Link>
                <a
                  href="#how-it-works"
                  className="text-sm font-semibold transition-colors"
                  style={{ color: "var(--text-secondary)" }}
                >
                  See how it works →
                </a>
              </div>
            </div>

            <div className="hero-in-5">
              <HeroDemo />
            </div>
          </div>
        </div>
      </section>

      {/* ── Stat strip ── */}
      <StatStrip />

      {/* ── Soul diagram ── */}
      <section
        className="py-32"
        style={{ background: "var(--bg-primary)" }}
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="mb-16" data-reveal>
            <p
              className="text-[9px] font-bold uppercase tracking-[0.28em] mb-4"
              style={{ color: "var(--text-tertiary)" }}
            >
              Context at every layer
            </p>
            <h2
              className="font-display font-bold mb-4"
              style={{ fontSize: "clamp(2rem, 4.5vw, 3rem)" }}
            >
              School-aware.{" "}
              <span style={{ color: "var(--brand-primary)" }}>Student-aware.</span>
            </h2>
            <p className="text-lg leading-relaxed max-w-lg" style={{ color: "var(--text-secondary)" }}>
              Two independent context layers shape every response — one anchored to your school,
              one adapted to the individual student.
            </p>
          </div>
          <SoulDiagram />
        </div>
      </section>

      {/* ── ChevronDown ── */}
      <ChevronDown />

      {/* ── How it works ── */}
      <section
        id="how-it-works"
        className="py-32"
        style={{ background: "var(--bg-secondary)" }}
      >
        <div className="max-w-4xl mx-auto px-6">
          <div className="mb-16" data-reveal>
            <p
              className="text-[9px] font-bold uppercase tracking-[0.28em] mb-4"
              style={{ color: "var(--text-tertiary)" }}
            >
              Built differently
            </p>
            <h2
              className="font-display font-bold leading-tight mb-4"
              style={{ fontSize: "clamp(2rem, 4.5vw, 3rem)" }}
            >
              Four steps from{" "}
              <span style={{ color: "var(--brand-primary)" }}>question to insight</span>
            </h2>
            <p className="text-lg leading-relaxed max-w-md" style={{ color: "var(--text-secondary)" }}>
              Routing intelligence sits between student and AI — invisible, but always working.
            </p>
          </div>

          {/* Vertical timeline */}
          <HowItWorksTimeline />
        </div>
      </section>

      {/* ── WaveB ── */}
      <WaveB />

      {/* ── Prism / spectral routing ── */}
      <section
        className="py-32 overflow-hidden"
        style={{ background: "var(--bg-primary)" }}
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14" data-reveal>
            <p
              className="text-[9px] font-bold uppercase tracking-[0.28em] mb-3"
              style={{ color: "var(--text-tertiary)" }}
            >
              Spectral routing
            </p>
            <h2
              className="font-display font-bold mb-3"
              style={{ fontSize: "clamp(1.875rem, 4vw, 2.75rem)" }}
            >
              One question.{" "}
              <span style={{ color: "var(--brand-primary)" }}>The right intelligence.</span>
            </h2>
            <p className="text-base max-w-lg mx-auto" style={{ color: "var(--text-secondary)" }}>
              Spectra decomposes every request and routes it to a purpose-built agent — the right model, the right context, the right mode.
            </p>
          </div>
          <div data-reveal>
            <PrismAnimation />
          </div>
        </div>
      </section>

      {/* ── ArchSlash ── */}
      <ArchSlash />

      {/* ── Agents ── */}
      <section
        className="py-32"
        style={{ background: "var(--bg-secondary)" }}
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="mb-16" data-reveal>
            <p
              className="text-[9px] font-bold uppercase tracking-[0.28em] mb-4"
              style={{ color: "var(--text-tertiary)" }}
            >
              Specialist intelligence
            </p>
            <h2
              className="font-display font-bold mb-4"
              style={{ fontSize: "clamp(2rem, 4.5vw, 3rem)" }}
            >
              Purpose-built{" "}
              <span style={{ color: "var(--brand-primary)" }}>agents</span> for learning
            </h2>
            <p className="text-lg leading-relaxed max-w-lg" style={{ color: "var(--text-secondary)" }}>
              Beyond a generic chatbot: specialist agents, clarification interrupts, and route-trace
              visibility for subject-specific pedagogy. Each agent is built to teach, not just answer.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {AGENTS.map((agent, i) => (
              <div
                key={agent.name}
                className="agent-card relative rounded-3xl border border-[var(--border-default)] overflow-hidden cursor-pointer h-[270px] group transition-all duration-300"
                style={{ background: "var(--bg-elevated)" }}
                data-reveal
                data-delay={String(i * 80)}
                onMouseEnter={(e) => {
                  const el = e.currentTarget;
                  el.style.borderColor = agent.color + "45";
                  el.style.boxShadow = `0 20px 40px -12px ${agent.color}28, 0 0 0 1px ${agent.color}10`;
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget;
                  el.style.borderColor = "var(--border-default)";
                  el.style.boxShadow = "none";
                }}
              >
                {/* Color wash */}
                <div
                  className="absolute inset-0 pointer-events-none transition-opacity duration-300 group-hover:opacity-100 opacity-60"
                  style={{
                    background: `linear-gradient(145deg, ${agent.color}15 0%, transparent 60%)`,
                  }}
                />

                {/* Default state */}
                <div className="agent-default relative z-10 p-7 h-full flex flex-col">
                  {/* Symbol badge */}
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 shrink-0 transition-transform duration-300 group-hover:scale-110"
                    style={{
                      background: `${agent.color}14`,
                      border: `1px solid ${agent.color}30`,
                    }}
                  >
                    <span
                      className="font-display font-black text-2xl leading-none"
                      style={{ color: agent.color }}
                    >
                      {agent.symbol}
                    </span>
                  </div>
                  <h3 className="font-display text-lg font-bold mb-1">{agent.name}</h3>
                  <p className="text-xs font-semibold" style={{ color: agent.color }}>
                    {agent.subject}
                  </p>
                  <p className="text-xs mt-auto pt-4 font-medium" style={{ color: "var(--text-tertiary)" }}>
                    Hover to see a conversation
                  </p>
                </div>

                {/* Snippet (shown on hover) */}
                <div className="agent-snippet z-20 rounded-3xl" style={{ background: "var(--bg-elevated)" }}>
                  <div className="mb-4">
                    <div
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold mb-3"
                      style={{ background: `${agent.color}14`, color: agent.color }}
                    >
                      {agent.name}
                    </div>
                    {/* Conversation snippet */}
                    <div
                      className="inline-block rounded-xl px-4 py-2.5 text-xs leading-snug mb-3 w-full"
                      style={{ background: "var(--bg-user-bubble)", color: "var(--text-secondary)" }}
                    >
                      {agent.snippet.user}
                    </div>
                    <p className="text-sm leading-relaxed" style={{ color: "var(--text-primary)" }}>
                      &ldquo;{agent.snippet.reply}&rdquo;
                    </p>
                  </div>
                  <p
                    className="text-[10px] font-mono mt-auto font-semibold"
                    style={{ color: agent.color }}
                  >
                    {agent.snippet.technique}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Feature pills */}
          <div className="mt-14 flex flex-wrap gap-3 justify-center" data-reveal>
            {[
              { Icon: Bot, label: "260+ active models" },
              { Icon: Zap, label: "Sub-second routing" },
              { Icon: Database, label: "2-layer memory fabric" },
              { Icon: ShieldCheck, label: "School guardrails" },
              { Icon: Network, label: "Multi-agent" },
              { Icon: Search, label: "Evidence-first citations" },
              { Icon: Layers, label: "Clarify + resume context" },
              { Icon: ArrowRight, label: "Branch + regenerate paths" },
              { Icon: Sparkles, label: "Length-safe fallback chain" },
              { Icon: FlaskConical, label: "Subject specialists" },
              { Icon: Pencil, label: "Writing coaches" },
              { Icon: BookOpen, label: "Spaced repetition" },
            ].map(({ Icon, label }) => (
              <div
                key={label}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full border border-[var(--border-default)] text-xs font-medium cursor-default transition-all duration-200 hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)] hover:-translate-y-0.5"
                style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}
              >
                <Icon size={13} strokeWidth={1.5} />
                {label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── DoubleWaveDown ── */}
      <DoubleWaveDown />

      {/* ── Study modes ── */}
      <section
        className="py-32"
        style={{ background: "var(--bg-primary)" }}
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="mb-16" data-reveal>
            <p
              className="text-[9px] font-bold uppercase tracking-[0.28em] mb-4"
              style={{ color: "var(--text-tertiary)" }}
            >
              Pedagogical depth
            </p>
            <h2
              className="font-display font-bold mb-4"
              style={{ fontSize: "clamp(2rem, 4.5vw, 3rem)" }}
            >
              12 modes to <span style={{ color: "var(--brand-primary)" }}>learn</span>
            </h2>
            <p className="text-lg leading-relaxed max-w-lg" style={{ color: "var(--text-secondary)" }}>
              Eight modes are live now, with four staged releases. Each has a distinct pedagogy and
              can be auto-selected or manually locked.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {SHOWN_MODES.map((key, i) => {
              const mode = MODE_REGISTRY[key];
              const isComingSoon = COMING_SOON_MODES.has(key);
              const ModeIcon = MODE_ICONS[key] ?? Sparkles;

              return (
                <div
                  key={key}
                  className="mode-card relative rounded-2xl border border-[var(--border-default)] overflow-hidden cursor-pointer h-[256px]"
                  style={{
                    background: "var(--bg-elevated)",
                    ["--mode-color" as string]: mode.cssVar,
                  }}
                  data-reveal
                  data-delay={String((i % 4) * 80)}
                >
                  {/* Color wash overlay */}
                  <div
                    className="mode-wash absolute inset-0 pointer-events-none"
                    style={{
                      background: `linear-gradient(145deg, ${mode.cssVar}10 0%, transparent 60%)`,
                    }}
                  />

                  <div className="mode-default relative z-10 p-7 h-full flex flex-col">
                    <div
                      className="mode-icon w-11 h-11 rounded-xl flex items-center justify-center mb-5 border shrink-0"
                      style={{
                        color: mode.cssVar,
                        borderColor: mode.cssVar + "30",
                        background: mode.cssVar + "14",
                      }}
                    >
                      <ModeIcon size={18} strokeWidth={1.5} />
                    </div>

                    <div className="mode-label-container flex items-center gap-2 mb-2 z-10 w-full">
                      <h4 className="font-display text-base font-bold text-center">{mode.label}</h4>
                      {isComingSoon && (
                        <span
                          className="text-[7px] font-black px-1.5 py-0.5 rounded border"
                          style={{
                            background: "var(--bg-secondary)",
                            borderColor: "var(--border-default)",
                            color: "var(--text-tertiary)",
                          }}
                        >
                          SOON
                        </span>
                      )}
                    </div>

                    <p
                      className="mode-desc text-sm leading-relaxed flex-1 transition-opacity duration-250"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {mode.description}
                    </p>

                    <div
                      className="mode-arrow flex items-center gap-1.5 text-xs font-bold mt-4"
                      style={{ color: mode.cssVar }}
                    >
                      Try in chat <ChevronRight size={13} />
                    </div>
                  </div>

                  {/* Hover example overlay */}
                  {MODE_EXAMPLES[key] && (
                    <div className="mode-example rounded-2xl">
                      <p className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: mode.cssVar }}>
                        Example
                      </p>
                      <p className="text-sm leading-relaxed italic" style={{ color: "var(--text-primary)" }}>
                        {MODE_EXAMPLES[key]}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── WaveA ── */}
      <WaveA />

      {/* ── Stakeholders ── */}
      <section
        className="py-32"
        style={{ background: "var(--bg-secondary)" }}
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="mb-14" data-reveal>
            <p
              className="text-[9px] font-bold uppercase tracking-[0.28em] mb-4"
              style={{ color: "var(--text-tertiary)" }}
            >
              Who it&apos;s for
            </p>
            <h2
              className="font-display font-bold mb-4"
              style={{ fontSize: "clamp(2rem, 4.5vw, 3rem)" }}
            >
              Built for how{" "}
              <span style={{ color: "var(--brand-primary)" }}>schools actually work.</span>
            </h2>
            <p
              className="text-lg max-w-lg leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              Every part of the learning loop — student, teacher, curriculum — gets something tangible.
            </p>
          </div>

          <style>{`
            @keyframes pulse-circle-anim {
              0% { r: 0; stroke-width: 0px; opacity: 1; }
              15% { stroke-width: 150px; opacity: 1; }
              80% { stroke-width: 250px; opacity: 1; }
              100% { r: 150%; stroke-width: 400px; opacity: 0; }
            }
            .pulse-circle-active {
              animation: pulse-circle-anim 1.2s cubic-bezier(0.2, 0, 0.2, 1) 0.3s forwards;
              opacity: 0;
            }
            @keyframes ray-left {
              0% { transform: scaleX(0); transform-origin: right; opacity: 1; }
              50% { transform: scaleX(1); transform-origin: right; opacity: 1; }
              50.1% { transform: scaleX(1); transform-origin: left; opacity: 1; }
              100% { transform: scaleX(0); transform-origin: left; opacity: 0; }
            }
            @keyframes ray-right {
              0% { transform: scaleX(0); transform-origin: left; opacity: 1; }
              50% { transform: scaleX(1); transform-origin: left; opacity: 1; }
              50.1% { transform: scaleX(1); transform-origin: right; opacity: 1; }
              100% { transform: scaleX(0); transform-origin: right; opacity: 0; }
            }
            @keyframes ray-up {
              0% { transform: scaleY(0); transform-origin: bottom; opacity: 1; }
              50% { transform: scaleY(1); transform-origin: bottom; opacity: 1; }
              50.1% { transform: scaleY(1); transform-origin: top; opacity: 1; }
              100% { transform: scaleY(0); transform-origin: top; opacity: 0; }
            }
            @keyframes ray-down {
              0% { transform: scaleY(0); transform-origin: top; opacity: 1; }
              50% { transform: scaleY(1); transform-origin: top; opacity: 1; }
              50.1% { transform: scaleY(1); transform-origin: bottom; opacity: 1; }
              100% { transform: scaleY(0); transform-origin: bottom; opacity: 0; }
            }
          `}</style>

          <div className="relative max-w-5xl mx-auto mt-16 flex flex-col md:flex-row items-center md:items-stretch gap-12 md:gap-8 justify-between" data-ai-core-active={aiCoreHovered ? "true" : undefined}>
            {/* Desktop horizontal connection lines */}
            <div className="hidden md:block absolute top-1/2 right-[50%] left-[15%] mr-[4rem] -translate-y-1/2 z-0 pointer-events-none h-[2px]">
              <div className="absolute inset-0 bg-[var(--border-default)] opacity-40 rounded-full" />
              {pulseKey > 0 && (
                <div 
                  key={`ray-left-${pulseKey}`}
                  className="absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-transparent via-[var(--brand-primary)] to-transparent" 
                  style={{ width: "40%", animation: "ray-left 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards" }} 
                />
              )}
            </div>
            <div className="hidden md:block absolute top-1/2 left-[50%] right-[15%] ml-[4rem] -translate-y-1/2 z-0 pointer-events-none h-[2px]">
              <div className="absolute inset-0 bg-[var(--border-default)] opacity-40 rounded-full" />
              {pulseKey > 0 && (
                <div 
                  key={`ray-right-${pulseKey}`}
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-transparent via-[var(--brand-primary)] to-transparent" 
                  style={{ width: "40%", animation: "ray-right 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards" }} 
                />
              )}
            </div>
            
            {/* Mobile vertical connection lines */}
            <div className="md:hidden absolute left-1/2 bottom-[50%] top-[10%] mb-[4rem] w-[2px] -translate-x-1/2 z-0 pointer-events-none">
              <div className="absolute inset-0 bg-[var(--border-default)] opacity-40 rounded-full" />
              {pulseKey > 0 && (
                <div 
                  key={`ray-up-${pulseKey}`} 
                  className="absolute inset-x-0 bottom-0 rounded-full bg-gradient-to-t from-transparent via-[var(--brand-primary)] to-transparent" 
                  style={{ height: "40%", animation: "ray-up 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards" }} 
                />
              )}
            </div>
            <div className="md:hidden absolute left-1/2 top-[50%] bottom-[10%] mt-[4rem] w-[2px] -translate-x-1/2 z-0 pointer-events-none">
              <div className="absolute inset-0 bg-[var(--border-default)] opacity-40 rounded-full" />
              {pulseKey > 0 && (
                <div 
                  key={`ray-down-${pulseKey}`} 
                  className="absolute inset-x-0 top-0 rounded-full bg-gradient-to-b from-transparent via-[var(--brand-primary)] to-transparent" 
                  style={{ height: "40%", animation: "ray-down 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards" }} 
                />
              )}
            </div>

            {/* Student Card */}
            {(() => {
              const { role, Icon, color, tagline, points } = STAKEHOLDERS[0];
              return (
                <div
                  key={role}
                  className="stakeholder-card relative z-10 flex-1 rounded-3xl border border-[var(--border-default)] p-8 overflow-hidden group transition-all duration-500 w-full max-w-sm"
                  style={{ background: "var(--bg-elevated)" }}
                  data-reveal
                  data-delay="0"
                  onMouseEnter={(e) => {
                    const el = e.currentTarget;
                    el.style.borderColor = color + "50";
                    el.style.boxShadow = `0 20px 50px -12px ${color}20, inset 0 0 0 1px ${color}10`;
                    const iconEl = el.querySelector('.stk-icon') as HTMLElement;
                    if (iconEl) iconEl.style.transform = "scale(1.15) rotate(5deg)";
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget;
                    el.style.borderColor = "var(--border-default)";
                    el.style.boxShadow = "none";
                    const iconEl = el.querySelector('.stk-icon') as HTMLElement;
                    if (iconEl) iconEl.style.transform = "scale(1) rotate(0deg)";
                  }}
                >
                  <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: `radial-gradient(circle at top right, ${color}15, transparent 70%)` }} />
                  {pulseKey > 0 && (
                    <svg key={`pulse-student-${pulseKey}`} className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" style={{ borderRadius: "1.5rem" }}>
                      <defs>
                        <filter id="electric-glow-student" x="-20%" y="-20%" width="140%" height="140%">
                          <feGaussianBlur stdDeviation="6" result="blur"/>
                          <feMerge>
                            <feMergeNode in="blur"/>
                            <feMergeNode in="blur"/>
                            <feMergeNode in="SourceGraphic"/>
                          </feMerge>
                        </filter>
                        <mask id="pulse-mask-student">
                          <circle cx="50%" cy="100%" r="0" fill="none" stroke="white" className="pulse-circle-active md:hidden" />
                          <circle cx="100%" cy="50%" r="0" fill="none" stroke="white" className="pulse-circle-active hidden md:block" />
                        </mask>
                      </defs>
                      <rect x="0" y="0" width="100%" height="100%" rx="24" fill="none" stroke="var(--brand-primary)" strokeWidth="6" mask="url(#pulse-mask-student)" filter="url(#electric-glow-student)" />
                      <rect x="0" y="0" width="100%" height="100%" rx="24" fill="none" stroke="white" strokeWidth="2" mask="url(#pulse-mask-student)" />
                    </svg>
                  )}
                  <div className="relative z-10">
                    <div className="stk-icon w-12 h-12 rounded-2xl flex items-center justify-center mb-5 transition-transform duration-300 ease-out" style={{ background: color + "14", border: "1px solid " + color + "28", color }}>
                      <Icon size={22} strokeWidth={1.5} />
                    </div>
                    <h3 className="font-display text-lg font-bold mb-1 transition-colors group-hover:text-[var(--text-primary)]">{role}</h3>
                    <p className="text-xs mb-5 font-semibold" style={{ color }}>{tagline}</p>
                    <ul className="space-y-3">
                      {points.map((p) => (
                        <li key={p} className="flex items-start gap-2.5 text-sm transition-colors duration-200 group-hover:text-[var(--text-primary)]" style={{ color: "var(--text-secondary)" }}>
                          <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 transition-transform duration-200 group-hover:scale-150" style={{ background: color }} />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })()}

            {/* Central Node */}
            <div className="relative z-20 w-24 h-24 md:w-32 md:h-32 rounded-full flex flex-col items-center justify-center shrink-0 border-4 transition-all duration-500 hover:scale-110 self-center cursor-pointer"
                 style={{ background: "var(--bg-primary)", borderColor: "var(--brand-primary)", boxShadow: aiCoreHovered ? "0 0 60px color-mix(in oklab, var(--brand-primary) 50%, transparent), 0 0 100px color-mix(in oklab, var(--brand-primary) 20%, transparent)" : "0 0 40px color-mix(in oklab, var(--brand-primary) 30%, transparent)" }}
                 onMouseEnter={() => { setAiCoreHovered(true); handlePulseTrigger(); }}
                 onMouseLeave={() => setAiCoreHovered(false)}
                 onClick={handlePulseTrigger}
                 data-reveal data-delay="100">
              <div className="absolute inset-0 rounded-full animate-spin-slow" style={{ border: "2px dashed var(--brand-primary)", opacity: aiCoreHovered ? 0.6 : 0.3, transition: "opacity 0.3s" }} />
              <div className="absolute inset-2 rounded-full" style={{ background: "var(--brand-primary)", opacity: aiCoreHovered ? 0.2 : 0.1, transition: "opacity 0.3s", animation: aiCoreHovered ? "subtle-pulse 1s ease-in-out" : "none" }} />
              <Sparkles size={24} className="text-[var(--brand-primary)] mb-1" />
              <span className="text-[9px] font-bold tracking-widest" style={{ color: "var(--text-primary)" }}>AI CORE</span>
            </div>

            {/* Teacher Card */}
            {(() => {
              const { role, Icon, color, tagline, points } = STAKEHOLDERS[1];
              return (
                <div
                  key={role}
                  className="stakeholder-card relative z-10 flex-1 rounded-3xl border border-[var(--border-default)] p-8 overflow-hidden group transition-all duration-500 w-full max-w-sm"
                  style={{ background: "var(--bg-elevated)" }}
                  data-reveal
                  data-delay="200"
                  onMouseEnter={(e) => {
                    const el = e.currentTarget;
                    el.style.borderColor = color + "50";
                    el.style.boxShadow = `0 20px 50px -12px ${color}20, inset 0 0 0 1px ${color}10`;
                    const iconEl = el.querySelector('.stk-icon') as HTMLElement;
                    if (iconEl) iconEl.style.transform = "scale(1.15) rotate(5deg)";
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget;
                    el.style.borderColor = "var(--border-default)";
                    el.style.boxShadow = "none";
                    const iconEl = el.querySelector('.stk-icon') as HTMLElement;
                    if (iconEl) iconEl.style.transform = "scale(1) rotate(0deg)";
                  }}
                >
                  <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ background: `radial-gradient(circle at top right, ${color}15, transparent 70%)` }} />
                  {pulseKey > 0 && (
                    <svg key={`pulse-teacher-${pulseKey}`} className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" style={{ borderRadius: "1.5rem" }}>
                      <defs>
                        <filter id="electric-glow-teacher" x="-20%" y="-20%" width="140%" height="140%">
                          <feGaussianBlur stdDeviation="6" result="blur"/>
                          <feMerge>
                            <feMergeNode in="blur"/>
                            <feMergeNode in="blur"/>
                            <feMergeNode in="SourceGraphic"/>
                          </feMerge>
                        </filter>
                        <mask id="pulse-mask-teacher">
                          <circle cx="50%" cy="0%" r="0" fill="none" stroke="white" className="pulse-circle-active md:hidden" />
                          <circle cx="0%" cy="50%" r="0" fill="none" stroke="white" className="pulse-circle-active hidden md:block" />
                        </mask>
                      </defs>
                      <rect x="0" y="0" width="100%" height="100%" rx="24" fill="none" stroke="var(--brand-primary)" strokeWidth="6" mask="url(#pulse-mask-teacher)" filter="url(#electric-glow-teacher)" />
                      <rect x="0" y="0" width="100%" height="100%" rx="24" fill="none" stroke="white" strokeWidth="2" mask="url(#pulse-mask-teacher)" />
                    </svg>
                  )}
                  <div className="relative z-10">
                    <div className="stk-icon w-12 h-12 rounded-2xl flex items-center justify-center mb-5 transition-transform duration-300 ease-out" style={{ background: color + "14", border: "1px solid " + color + "28", color }}>
                      <Icon size={22} strokeWidth={1.5} />
                    </div>
                    <h3 className="font-display text-lg font-bold mb-1 transition-colors group-hover:text-[var(--text-primary)]">{role}</h3>
                    <p className="text-xs mb-5 font-semibold" style={{ color }}>{tagline}</p>
                    <ul className="space-y-3">
                      {points.map((p) => (
                        <li key={p} className="flex items-start gap-2.5 text-sm transition-colors duration-200 group-hover:text-[var(--text-primary)]" style={{ color: "var(--text-secondary)" }}>
                          <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 transition-transform duration-200 group-hover:scale-150" style={{ background: color }} />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </section>

      {/* ── ChevronUp ── */}
      <ChevronUp />

      {/* ── Pricing ── */}
      <section
        className="py-32"
        style={{ background: "var(--bg-primary)" }}
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14" data-reveal>
            <p
              className="text-[9px] font-bold uppercase tracking-[0.28em] mb-3"
              style={{ color: "var(--text-tertiary)" }}
            >
              Transparent pricing
            </p>
            <h2
              className="font-display font-bold mb-3"
              style={{ fontSize: "clamp(1.875rem, 4vw, 2.75rem)" }}
            >
              Simple, <span style={{ color: "var(--brand-primary)" }}>flexible</span> pricing
            </h2>
            <p className="text-base max-w-md mx-auto" style={{ color: "var(--text-secondary)" }}>
              Schools set their own per-student budget. More budget means more AI inference for every student. No hidden fees.
            </p>
          </div>
          <div data-reveal>
            <PricingSection />
          </div>
        </div>
      </section>

      <WaveA />

      {/* ── Contact section ── */}
      <section
        id="contact"
        className="py-24"
        style={{ background: "var(--bg-secondary)" }}
      >
        <div className="max-w-xl mx-auto px-6">
          <div className="text-center mb-10" data-reveal>
            <h2 className="font-display text-2xl font-bold mb-2">Get in touch</h2>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Want to bring Spectra to your school? Have questions about our custom AI agents? We&apos;d love to hear from you.
            </p>
          </div>
          <ContactForm />
        </div>
      </section>

      {/* ── DoubleWaveDown ── */}
      <DoubleWaveDown />

      {/* ── CTA ── */}
      <section
        className="py-28 relative overflow-hidden"
        style={{ background: "var(--bg-primary)" }}
      >
        {/* Grid */}
        <div
          className="absolute inset-0 hero-grid pointer-events-none"
          style={{ opacity: 0.3 }}
        />
        {/* Blue glow */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 600,
            height: 400,
            background: "var(--brand-primary)",
            opacity: 0.05,
            filter: "blur(120px)",
            borderRadius: "50%",
          }}
        />
        <div className="relative z-10 max-w-2xl mx-auto px-6 text-center">
          <h2
            className="font-display font-bold mb-6 leading-tight"
            style={{ fontSize: "clamp(2rem, 5vw, 3.25rem)" }}
          >
            Give your students AI
            <br />
            <span style={{ color: "var(--brand-primary)" }}>that actually teaches.</span>
          </h2>
          <p className="text-lg mb-10 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Mode orchestration. School context. Evidence layer. Memory fabric. Full oversight.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/sign-up"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl text-white font-bold text-base transition-all hover:-translate-y-0.5"
              style={{
                background: "var(--brand-primary)",
                boxShadow: "0 8px 24px color-mix(in oklab, var(--brand-primary) 28%, transparent)",
              }}
            >
              Get started
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-semibold text-base border border-[var(--border-default)] transition-all hover:bg-[var(--bg-primary)]"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer
        className="py-14 border-t border-[var(--border-default)]"
        style={{ background: "var(--bg-primary)" }}
      >
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-2.5">
            <SpectraLogo size={24} />
            <span className="font-display text-base tracking-tight">Spectra</span>
          </div>
          <div
            className="flex gap-7 text-[10px] font-bold uppercase tracking-widest"
            style={{ color: "var(--text-tertiary)" }}
          >
            {["Privacy", "Terms", "Cookies"].map((l) => (
              <Link
                key={l}
                href={`/${l.toLowerCase()}`}
                className="transition-colors hover:text-[var(--text-primary)]"
              >
                {l}
              </Link>
            ))}
            <a
              href="#contact"
              className="transition-colors hover:text-[var(--text-primary)]"
            >
              Contact
            </a>
          </div>
          <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            © {new Date().getFullYear()} Spectra
          </p>
        </div>
      </footer>
    </div>
  );
}
