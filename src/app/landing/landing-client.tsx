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
import { OrchestrationDemo } from "./orchestration-demo";
import { SoulDiagram } from "./soul-diagram";

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
    emoji: "🔬",
    name: "Science Tutor",
    subject: "Biology · Chemistry · Physics",
    color: "var(--accent-mint)",
    skills: ["Lab report guidance", "Conceptual deep-dives", "Exam prep drills"],
  },
  {
    emoji: "✍️",
    name: "Essay Coach",
    subject: "English · History · Humanities",
    color: "var(--accent-coral)",
    skills: ["Structure feedback", "Argument sharpening", "Citation help"],
  },
  {
    emoji: "🧮",
    name: "Maths Specialist",
    subject: "Algebra · Calculus · Statistics",
    color: "var(--mode-tutor)",
    skills: ["Step-by-step workthrough", "Error diagnosis", "Formula recall"],
  },
  {
    emoji: "🌐",
    name: "Research Assistant",
    subject: "Cross-subject · Sourcing · Analysis",
    color: "var(--mode-research)",
    skills: ["Source verification", "Evidence synthesis", "Citation generation"],
  },
];

const STAKEHOLDERS = [
  {
    role: "Students",
    Icon: GraduationCap,
    color: "var(--mode-tutor)",
    points: [
      "9 structured learning modes",
      "Personal memory across sessions",
      "School materials in every answer",
      "Guided learning, not just answers",
    ],
  },
  {
    role: "Teachers",
    Icon: Users,
    color: "var(--mode-marker)",
    points: [
      "Upload class materials and resources",
      "Per-student usage analytics",
      "Custom AI agents for your subject",
      "Review AI answers by student",
    ],
  },
  {
    role: "Leadership",
    Icon: ShieldCheck,
    color: "var(--mode-research)",
    points: [
      "Content and model guardrails",
      "Full usage visibility",
      "Invite-based access management",
      "School-wide behaviour controls",
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
        <path d="M0,0 L1440,0 L1440,24 Q1100,64 720,32 Q340,0 0,48 Z" fill="var(--bg-secondary)" />
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
        <path d="M0,0 L1440,0 L1440,72 Q900,8 0,72 Z" fill="var(--bg-secondary)" />
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
        <path d="M0,0 L1440,0 L1440,20 L720,56 L0,20 Z" fill="var(--bg-secondary)" />
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

type TraceStep = -1 | 0 | 1 | 2 | 3 | 4 | 5;

function HeroDemo() {
  const [step, setStep] = useState<TraceStep>(-1);

  useEffect(() => {
    const cancelled = { current: false };

    function schedule(offset: number) {
      const t = (n: number, fn: () => void) =>
        setTimeout(() => {
          if (!cancelled.current) fn();
        }, offset + n);

      t(0, () => setStep(0));
      t(500, () => setStep(1));
      t(1100, () => setStep(2));
      t(1720, () => setStep(3));
      t(2340, () => setStep(4));
      t(3060, () => setStep(5));
      t(7400, () => {
        if (!cancelled.current) {
          setStep(-1);
          schedule(offset + 8200);
        }
      });
    }

    const initId = setTimeout(() => {
      if (!cancelled.current) schedule(0);
    }, 900);

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

  return (
    <div className="relative w-full max-w-md mx-auto">
      {/* Ambient glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          inset: -32,
          background: "radial-gradient(ellipse 60% 50% at 50% 50%, color-mix(in oklab, var(--brand-primary) 12%, transparent), transparent 70%)",
          zIndex: 0,
        }}
      />

      {/* Live indicator */}
      <div className="flex items-center gap-1.5 mb-3 justify-end relative z-10">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: "var(--success)", animation: "subtle-pulse 2s ease-in-out infinite" }}
        />
        <span className="text-xs font-medium text-[var(--text-tertiary)]">Live routing demo</span>
      </div>

      {/* Card */}
      <div
        className="relative z-10 rounded-[var(--radius-container)] border overflow-hidden"
        style={{
          background: "var(--bg-elevated)",
          borderColor: "var(--border-default)",
          boxShadow: "0 20px 60px -20px rgba(0,0,0,0.2), 0 0 0 1px var(--border-default)",
        }}
      >
        {/* Window chrome */}
        <div
          className="px-4 py-3 flex items-center gap-2 border-b border-[var(--border-default)]"
          style={{ background: "var(--bg-secondary)" }}
        >
          {["var(--danger)", "var(--warning)", "var(--success)"].map((c, i) => (
            <div key={i} className="w-2.5 h-2.5 rounded-full opacity-50" style={{ background: c }} />
          ))}
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--text-tertiary)] mx-auto">
            AI School
          </span>
        </div>

        <div className="p-5 space-y-4">
          {/* User bubble */}
          <div style={anim(0)}>
            <div
              className="inline-block rounded-xl px-3.5 py-2.5 text-sm leading-relaxed max-w-full"
              style={{ background: "var(--bg-user-bubble)" }}
            >
              I need to understand Newton&apos;s laws for my exam tomorrow
            </div>
          </div>

          {/* Routing state */}
          <div
            style={{
              opacity: step === 1 ? 1 : 0,
              maxHeight: step >= 1 ? 28 : 0,
              overflow: "hidden",
              transition: "opacity 200ms, max-height 200ms",
            }}
          >
            <span className="thinking-wave text-xs text-[var(--text-tertiary)]">Routing your query…</span>
          </div>

          {/* Route pills */}
          <div className="flex flex-wrap gap-2">
            <div style={anim(2)}>
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
                style={{
                  borderColor: "var(--mode-tutor)" + "35",
                  background: "var(--mode-tutor)" + "10",
                  color: "var(--mode-tutor)",
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--mode-tutor)" }} />
                Tutor mode
              </span>
            </div>
            <div style={anim(3)}>
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
                style={{
                  borderColor: "var(--accent-mint)" + "35",
                  background: "var(--accent-mint)" + "10",
                  color: "var(--accent-mint)",
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent-mint)" }} />
                DeepSeek R1
              </span>
            </div>
            <div style={anim(4)}>
              <span
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
                style={{
                  borderColor: "var(--accent-coral)" + "35",
                  background: "var(--accent-coral)" + "10",
                  color: "var(--accent-coral)",
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent-coral)" }} />
                Science Tutor
              </span>
            </div>
          </div>

          {/* Response */}
          <div
            className="pt-4 border-t border-[var(--border-default)]"
            style={anim(5)}
          >
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Let&apos;s work through this together. Newton&apos;s first law says an object at rest
              stays at rest unless a force acts on it. What do you already know about inertia?
            </p>
            <p className="mt-2 text-[10px] font-mono" style={{ color: "var(--text-tertiary)" }}>
              Socratic method · step-by-step
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stat strip ────────────────────────────────────────────────────────────────

function StatStrip() {
  const [modes, modesRef] = useCountUp(9);
  const [models, modelsRef] = useCountUp(400);

  return (
    <div style={{ background: "var(--bg-secondary)", borderTop: "1px solid var(--border-default)", borderBottom: "1px solid var(--border-default)" }}>
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex divide-x divide-[var(--border-default)]">
          {[
            { ref: modesRef, display: String(modes), label: "learning modes", sub: "each with a distinct pedagogy" },
            { ref: modelsRef, display: `${models}+`, label: "AI models", sub: "routed automatically per task" },
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

// ── Main ──────────────────────────────────────────────────────────────────────

export function LandingClient() {
  const [scrolled, setScrolled] = useState(false);

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
          transition: transform 0.3s cubic-bezier(0.22,1,0.36,1),
                      box-shadow 0.3s ease,
                      border-color 0.3s ease;
        }
        .mode-card:hover {
          transform: translateY(-5px);
          border-color: color-mix(in oklab, var(--mode-color) 35%, var(--border-default)) !important;
          box-shadow:
            0 16px 40px -12px color-mix(in oklab, var(--mode-color) 18%, transparent),
            0 0 0 1px color-mix(in oklab, var(--mode-color) 20%, transparent);
        }
        .mode-card .mode-icon {
          transition: transform 0.35s cubic-bezier(0.22,1,0.36,1), box-shadow 0.3s ease;
        }
        .mode-card:hover .mode-icon {
          transform: scale(1.12);
          box-shadow: 0 0 16px color-mix(in oklab, var(--mode-color) 30%, transparent);
        }
        .mode-card .mode-wash {
          opacity: 0;
          transition: opacity 0.3s ease;
        }
        .mode-card:hover .mode-wash { opacity: 1; }
        .mode-card .mode-arrow {
          opacity: 0;
          transform: translateY(6px);
          transition: opacity 0.25s ease, transform 0.25s ease;
        }
        .mode-card:hover .mode-arrow { opacity: 1; transform: none; }
        .mode-card .mode-desc { transition: color 0.25s ease; }
        .mode-card:hover .mode-desc { color: var(--text-primary) !important; }

        /* Shimmer connector line */
        @keyframes shimmer-move { 0% { left: -100%; } 100% { left: 200%; } }

        /* Agent cards */
        .agent-card {
          transition: transform 0.3s cubic-bezier(0.22,1,0.36,1), box-shadow 0.3s ease, border-color 0.3s ease;
        }
        .agent-card:hover {
          transform: translateY(-4px);
        }
        .agent-card .agent-skills {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.35s cubic-bezier(0.22,1,0.36,1), opacity 0.3s ease;
          opacity: 0;
        }
        .agent-card:hover .agent-skills {
          max-height: 120px;
          opacity: 1;
        }

        /* Stakeholder cards */
        .stakeholder-card {
          transition: transform 0.3s cubic-bezier(0.22,1,0.36,1), box-shadow 0.3s ease, border-color 0.3s ease;
        }
        .stakeholder-card:hover {
          transform: translateY(-3px);
          box-shadow: var(--shadow-hover);
        }

        @media (prefers-reduced-motion: reduce) {
          [data-reveal], .hero-in-1, .hero-in-2, .hero-in-3, .hero-in-4, .hero-in-5 {
            animation: none !important; transition: none !important; opacity: 1 !important; transform: none !important;
          }
          .mode-card, .agent-card, .stakeholder-card { transition: none !important; }
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
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center text-white"
              style={{
                background: "var(--brand-primary)",
                boxShadow: "0 4px 14px color-mix(in oklab, var(--brand-primary) 30%, transparent)",
              }}
            >
              <Sparkles size={15} />
            </div>
            <span className="font-display text-xl tracking-tight" style={{ color: "var(--text-primary)" }}>
              AI School
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
                School-grade AI assistant
              </div>

              <h1
                className="hero-in-2 font-display font-bold leading-[1.04] mb-6"
                style={{ fontSize: "clamp(2.75rem, 6vw, 4.5rem)" }}
              >
                AI that teaches.
                <br />
                <span style={{ color: "var(--brand-primary)" }}>Not just answers.</span>
              </h1>

              <p
                className="hero-in-3 text-lg leading-relaxed mb-8"
                style={{ color: "var(--text-secondary)", maxWidth: "32rem" }}
              >
                A structured AI assistant for schools — with 9 learning modes, automatic model
                routing, and context from your curriculum. Students already use AI. Now their
                school can make sure it actually helps them learn.
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
                  Get started free
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

      {/* ── WaveA ── */}
      <WaveA />

      {/* ── How it works ── */}
      <section
        id="how-it-works"
        className="py-32"
        style={{ background: "var(--bg-secondary)" }}
        data-reveal
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="mb-20" data-reveal>
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

          <div className="relative grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Shimmer connector */}
            <div
              className="hidden lg:block absolute top-10 left-[12.5%] right-[12.5%] h-px overflow-hidden"
              style={{ background: "var(--border-default)", zIndex: 0 }}
            >
              <div
                className="absolute inset-y-0"
                style={{
                  background: "linear-gradient(to right, transparent, var(--brand-primary), transparent)",
                  width: "30%",
                  animation: "shimmer-move 2.8s linear infinite",
                }}
              />
            </div>

            {HOW_IT_WORKS.map(({ num, title, body, Icon }, i) => (
              <div
                key={num}
                className="relative rounded-2xl border border-[var(--border-default)] p-7 cursor-default transition-all duration-300 hover:shadow-lg hover:-translate-y-1"
                style={{ background: "var(--bg-elevated)", zIndex: 1 }}
                data-reveal
                data-delay={String(i * 80)}
              >
                <div
                  className="absolute -top-3 -left-2 w-6 h-6 rounded-full border border-[var(--border-default)] flex items-center justify-center text-[10px] font-black"
                  style={{ background: "var(--bg-secondary)", color: "var(--text-tertiary)" }}
                >
                  {num}
                </div>
                <div
                  className="w-11 h-11 rounded-2xl flex items-center justify-center mb-6 transition-all duration-300 group-hover:scale-105"
                  style={{
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border-default)",
                    color: "var(--text-secondary)",
                  }}
                >
                  <Icon size={20} strokeWidth={1.5} />
                </div>
                <h3 className="font-display text-base font-bold mb-2">{title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WaveB ── */}
      <WaveB />

      {/* ── Orchestration demo ── */}
      <section
        className="py-32"
        style={{ background: "var(--bg-primary)" }}
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-12" data-reveal>
            <p
              className="text-[9px] font-bold uppercase tracking-[0.28em] mb-3"
              style={{ color: "var(--text-tertiary)" }}
            >
              See it in action
            </p>
            <h2
              className="font-display font-bold mb-3"
              style={{ fontSize: "clamp(1.875rem, 4vw, 2.75rem)" }}
            >
              Orchestration in{" "}
              <span style={{ color: "var(--brand-primary)" }}>action</span>
            </h2>
            <p className="text-base max-w-sm mx-auto" style={{ color: "var(--text-secondary)" }}>
              Click a scenario or press ← → to explore. Auto-advances every 6 seconds.
            </p>
          </div>
          <div data-reveal>
            <OrchestrationDemo />
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
              Beyond a generic chatbot — specialist agents trained for specific subjects and
              pedagogical tasks. Each one knows how to teach, not just answer.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {AGENTS.map((agent, i) => (
              <div
                key={agent.name}
                className="agent-card rounded-2xl border border-[var(--border-default)] p-6 cursor-default overflow-hidden"
                style={{ background: "var(--bg-elevated)" }}
                data-reveal
                data-delay={String(i * 80)}
                onMouseEnter={(e) => {
                  const el = e.currentTarget;
                  el.style.borderColor = agent.color + "40";
                  el.style.boxShadow = `0 12px 32px -8px ${agent.color}25`;
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget;
                  el.style.borderColor = "var(--border-default)";
                  el.style.boxShadow = "none";
                }}
              >
                <div className="text-4xl mb-4 transition-transform duration-300 hover:scale-110 inline-block">
                  {agent.emoji}
                </div>
                <h3 className="font-display text-base font-bold mb-1">{agent.name}</h3>
                <p className="text-[10px] font-medium mb-4" style={{ color: agent.color }}>
                  {agent.subject}
                </p>
                <div className="agent-skills">
                  <div className="space-y-1.5 pt-1">
                    {agent.skills.map((skill) => (
                      <div key={skill} className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                        <div className="w-1 h-1 rounded-full shrink-0" style={{ background: agent.color }} />
                        {skill}
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>
                  Hover to explore skills
                </p>
              </div>
            ))}
          </div>

          {/* Feature pills */}
          <div className="mt-14 flex flex-wrap gap-3 justify-center" data-reveal>
            {[
              { Icon: Bot, label: "400+ AI models" },
              { Icon: Zap, label: "Sub-second routing" },
              { Icon: Database, label: "Personal memory" },
              { Icon: ShieldCheck, label: "School guardrails" },
              { Icon: Network, label: "Multi-agent" },
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

      {/* ── Study modes ── */}
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
              Pedagogical depth
            </p>
            <h2
              className="font-display font-bold mb-4"
              style={{ fontSize: "clamp(2rem, 4.5vw, 3rem)" }}
            >
              9 ways to <span style={{ color: "var(--brand-primary)" }}>learn</span>
            </h2>
            <p className="text-lg leading-relaxed max-w-lg" style={{ color: "var(--text-secondary)" }}>
              Each mode has a distinct pedagogical pattern — automatically selected, or manually
              chosen. Hover to explore.
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

                  <div className="relative z-10 p-7 h-full flex flex-col">
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

                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-display text-base font-bold">{mode.label}</h4>
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
                      className="mode-desc text-sm leading-relaxed flex-1"
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
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── ChevronUp ── */}
      <ChevronUp />

      {/* ── Stakeholders ── */}
      <section
        className="py-32"
        style={{ background: "var(--bg-primary)" }}
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14" data-reveal>
            <p
              className="text-[9px] font-bold uppercase tracking-[0.28em] mb-4"
              style={{ color: "var(--text-tertiary)" }}
            >
              Built for everyone
            </p>
            <h2
              className="font-display font-bold mb-4"
              style={{ fontSize: "clamp(2rem, 4.5vw, 3rem)" }}
            >
              One platform.{" "}
              <span style={{ color: "var(--brand-primary)" }}>Every stakeholder.</span>
            </h2>
            <p
              className="text-lg max-w-xl mx-auto leading-relaxed"
              style={{ color: "var(--text-secondary)" }}
            >
              Structured for students, transparent for teachers, governable for leadership.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {STAKEHOLDERS.map(({ role, Icon, color, points }, i) => (
              <div
                key={role}
                className="stakeholder-card rounded-2xl border border-[var(--border-default)] p-8"
                style={{ background: "var(--bg-elevated)" }}
                data-reveal
                data-delay={String(i * 100)}
                onMouseEnter={(e) => {
                  const el = e.currentTarget;
                  el.style.borderColor = color + "40";
                  el.style.boxShadow = `0 16px 40px -12px ${color}20`;
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget;
                  el.style.borderColor = "var(--border-default)";
                  el.style.boxShadow = "";
                }}
              >
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center mb-6"
                  style={{
                    background: color + "14",
                    border: "1px solid " + color + "28",
                    color,
                  }}
                >
                  <Icon size={22} strokeWidth={1.5} />
                </div>
                <h3 className="font-display text-lg font-bold mb-5">{role}</h3>
                <ul className="space-y-3">
                  {points.map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-sm" style={{ color: "var(--text-secondary)" }}>
                      <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: color }} />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WaveA (reversed - secondary → primary) ── */}
      <div style={{ lineHeight: 0, pointerEvents: "none", background: "var(--bg-primary)" }}>
        <svg viewBox="0 0 1440 56" style={{ display: "block", width: "100%", height: 56 }} preserveAspectRatio="none" aria-hidden>
          <path d="M0,0 L1440,0 L1440,40 Q1080,56 720,20 Q360,0 0,56 Z" fill="var(--bg-secondary)" />
        </svg>
      </div>

      {/* ── CTA ── */}
      <section
        className="py-28 relative overflow-hidden"
        style={{ background: "var(--bg-secondary)" }}
        data-reveal
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
            Structured modes. School context. Personal memory. Full oversight.
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
              Get started free
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
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-white"
              style={{ background: "var(--brand-primary)" }}
            >
              <Sparkles size={13} />
            </div>
            <span className="font-display text-base tracking-tight">AI School</span>
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
          </div>
          <p className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
            © {new Date().getFullYear()} AI School
          </p>
        </div>
      </footer>
    </div>
  );
}
