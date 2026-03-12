"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bot,
  Brain,
  BookOpen,
  FileSearch,
  Mic,
  ImagePlus,
  Users,
  RotateCcw,
  Database,
  School,
  ChevronRight,
  MessageCircle,
  Zap,
  GraduationCap,
} from "lucide-react";
import { MODE_REGISTRY } from "@/lib/modes";
import { OrchestrationDemo } from "./orchestration-demo";
import { SoulDiagram } from "./soul-diagram";

// ── Data ─────────────────────────────────────────────────────────────────────

const SHOWN_MODE_KEYS = [
  "tutor",
  "marker",
  "exam",
  "draft_coach",
  "quiz",
  "flashcard",
  "research",
  "explain",
] as const;

const MODE_EXAMPLES: Record<string, string> = {
  tutor: "Walk me through photosynthesis step by step",
  marker: "Review my essay on the French Revolution",
  exam: "Give me a timed test on quadratic equations",
  draft_coach: "Help me strengthen this introduction paragraph",
  quiz: "Test my knowledge of the periodic table",
  flashcard: "Make flashcards for the stages of mitosis",
  research: "What does evidence say about spaced repetition?",
  explain: "Explain quantum entanglement like I'm 15",
};

const PROBLEMS = [
  {
    Icon: Bot,
    title: "Wrong model",
    desc: "Using a chatbot for maths reasoning — or a reasoner for quick lookups — both underperform silently.",
  },
  {
    Icon: Brain,
    title: "Forgotten thinking",
    desc: "Most tasks need deliberate reasoning steps. Most AI calls skip them entirely.",
  },
  {
    Icon: BookOpen,
    title: "Zero context",
    desc: "The AI doesn't know your subject, level, or school's expectations — so answers miss the mark.",
  },
];

const HOW_IT_WORKS = [
  {
    Icon: MessageCircle,
    num: 1,
    title: "Ask naturally",
    desc: "Just type your question. No commands, no mode-switching, no configuration required.",
  },
  {
    Icon: Zap,
    num: 2,
    title: "AI School routes it",
    desc: "Mode, model, and specialist agent are selected automatically in under a second.",
  },
  {
    Icon: GraduationCap,
    num: 3,
    title: "You learn better",
    desc: "Every response uses the right pedagogy — Socratic coaching, rubric feedback, active recall.",
  },
];

const FEATURES = [
  { Icon: Bot, label: "400+ AI models" },
  { Icon: FileSearch, label: "Document retrieval" },
  { Icon: Mic, label: "Voice input" },
  { Icon: ImagePlus, label: "Image generation" },
  { Icon: Users, label: "Multi-agent" },
  { Icon: RotateCcw, label: "Spaced repetition" },
  { Icon: Database, label: "Memory" },
  { Icon: School, label: "School personalisation" },
];

// ── Count-up animation hook ───────────────────────────────────────────────────

function useCountUp(target: number, duration = 1400) {
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
            setCount(Math.round((1 - Math.pow(1 - p, 3)) * target));
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

// ── Animated stats strip ──────────────────────────────────────────────────────

function StatStrip() {
  const [modesCount, modesRef] = useCountUp(9);
  const [modelsCount, modelsRef] = useCountUp(400);
  const [layersCount, layersRef] = useCountUp(2);

  return (
    <div className="border-t border-b border-[var(--border-default)] bg-[var(--bg-secondary)]">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex divide-x divide-[var(--border-default)]">
          <div ref={modesRef} className="flex-1 py-8 text-center">
            <p className="font-display text-5xl tracking-tight stat-number">
              {modesCount}
            </p>
            <p className="text-xs text-[var(--text-secondary)] mt-1.5">
              learning modes
            </p>
          </div>
          <div ref={modelsRef} className="flex-1 py-8 text-center">
            <p className="font-display text-5xl tracking-tight stat-number">
              {modelsCount}+
            </p>
            <p className="text-xs text-[var(--text-secondary)] mt-1.5">
              AI models
            </p>
          </div>
          <div ref={layersRef} className="flex-1 py-8 text-center">
            <p className="font-display text-5xl tracking-tight stat-number">
              {layersCount}-layer
            </p>
            <p className="text-xs text-[var(--text-secondary)] mt-1.5">
              personalisation
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Hero routing trace ────────────────────────────────────────────────────────

type TraceStep = -1 | 0 | 1 | 2 | 3 | 4 | 5;

function HeroRoutingTrace() {
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
        setStep(-1);
        schedule(offset + 7800);
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
    transition:
      "opacity 320ms cubic-bezier(0.22,1,0.36,1), transform 320ms cubic-bezier(0.22,1,0.36,1)",
  });

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Live indicator */}
      <div className="flex items-center gap-1.5 mb-3 justify-end">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: "var(--success)",
            animation: "subtle-pulse 2s ease-in-out infinite",
          }}
        />
        <span className="text-xs text-[var(--text-tertiary)]">
          Live routing demo
        </span>
      </div>

      {/* Card */}
      <div className="trace-pulse rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5 shadow-[var(--shadow-card)]">
        {/* User question */}
        <div style={anim(0)}>
          <div className="bg-[var(--bg-user-bubble)] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed inline-block max-w-full">
            I need to understand Newton&apos;s laws for my exam tomorrow
          </div>
        </div>

        {/* Routing shimmer */}
        <div
          style={{
            opacity: step === 1 ? 1 : 0,
            maxHeight: step >= 1 ? 28 : 0,
            overflow: "hidden",
            transition: "opacity 200ms, max-height 200ms",
            marginTop: 12,
          }}
        >
          <span className="thinking-wave text-xs">Routing your query…</span>
        </div>

        {/* Route pills */}
        <div className="mt-3.5 flex flex-wrap gap-2">
          <div style={anim(2)}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] px-2.5 py-1 text-xs">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: "var(--mode-tutor)" }}
              />
              Tutor mode
            </span>
          </div>
          <div style={anim(3)}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] px-2.5 py-1 text-xs">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: "var(--accent-mint)" }}
              />
              DeepSeek R1
            </span>
          </div>
          <div style={anim(4)}>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-default)] px-2.5 py-1 text-xs">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: "var(--accent-coral)" }}
              />
              Science Tutor
            </span>
          </div>
        </div>

        {/* Response preview */}
        <div
          className="mt-4 pt-3.5 border-t border-[var(--border-default)]"
          style={anim(5)}
        >
          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            Let&apos;s work through this together. Newton&apos;s first law says
            an object at rest stays at rest unless a force acts on it. What do
            you already know about inertia?
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Scroll reveal hook ────────────────────────────────────────────────────────

function useScrollReveal() {
  useEffect(() => {
    const elements =
      document.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!elements.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -32px 0px" },
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}

// ── Main component ────────────────────────────────────────────────────────────

export function LandingClient() {
  useScrollReveal();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  // Subtle grid texture for hero (uses border color, adapts to dark mode)
  const heroGridStyle: React.CSSProperties = {
    backgroundImage: [
      "repeating-linear-gradient(color-mix(in oklab, var(--border-default) 45%, transparent) 0 1px, transparent 1px 36px)",
      "repeating-linear-gradient(90deg, color-mix(in oklab, var(--border-default) 45%, transparent) 0 1px, transparent 1px 36px)",
    ].join(", "),
    backgroundSize: "36px 36px",
  };

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* ── Navbar ── */}
      <nav
        className="sticky top-0 z-50 bg-[var(--bg-primary)]"
        style={{
          boxShadow: scrolled ? "0 1px 0 var(--border-default)" : "none",
          transition: "box-shadow 220ms",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-display text-xl">AI School</span>
            <span className="text-xs text-[var(--text-tertiary)] hidden sm:inline">
              The right tool for the right task
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/sign-in"
              className="px-3 py-1.5 rounded-lg text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="px-3 py-1.5 rounded-lg text-sm bg-[var(--brand-primary)] text-white hover:opacity-90 transition-opacity"
            >
              Get started
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section
        className="min-h-[calc(100svh-56px)] flex items-center relative"
        style={heroGridStyle}
      >
        {/* Fade-out grid at edges */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 50% 50%, transparent 30%, var(--bg-primary) 100%)",
          }}
        />

        <div className="relative z-10 max-w-6xl mx-auto px-4 py-16 w-full">
          <div className="grid lg:grid-cols-2 gap-14 lg:gap-20 items-center">
            {/* Left: copy */}
            <div>
              <h1 className="font-display text-5xl sm:text-6xl leading-[1.1] tracking-tight">
                Stop fighting your AI.{" "}
                <span style={{ color: "var(--brand-primary)" }}>
                  Let the right one find you.
                </span>
              </h1>
              <p className="mt-6 text-base text-[var(--text-secondary)] max-w-lg leading-relaxed">
                AI School automatically routes every question to the best model,
                mode, and agent — so students get expert-level help every time,
                not generic responses.
              </p>
              <div className="mt-8 flex items-center gap-3 flex-wrap">
                <Link
                  href="/sign-up"
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg bg-[var(--brand-primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity shadow-[var(--shadow-card)]"
                >
                  Get started free
                  <ChevronRight size={14} />
                </Link>
                <Link
                  href="/sign-in"
                  className="inline-flex items-center px-5 py-2.5 rounded-lg border border-[var(--border-default)] text-sm hover:bg-[var(--bg-hover)] transition-colors"
                >
                  Sign in
                </Link>
              </div>
            </div>

            {/* Right: demo widget */}
            <div className="flex justify-center lg:justify-end">
              <HeroRoutingTrace />
            </div>
          </div>
        </div>
      </section>

      {/* ── Animated stats strip ── */}
      <StatStrip />

      {/* ── How it works ── */}
      <section data-reveal className="py-16">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="font-display text-3xl mb-2">How it works</h2>
          <p className="text-sm text-[var(--text-secondary)] mb-12">
            Three steps. Nothing to configure.
          </p>

          <div className="relative grid sm:grid-cols-3 gap-8">
            {/* Connector line (desktop only) */}
            <div
              className="hidden sm:block absolute h-px bg-[var(--border-default)]"
              style={{
                top: 22,
                left: "calc(100% / 6)",
                right: "calc(100% / 6)",
              }}
            />

            {HOW_IT_WORKS.map(({ num, title, desc }) => (
              <div
                key={num}
                className="flex flex-col items-center text-center"
              >
                <div className="relative z-10 w-11 h-11 rounded-full border-2 border-[var(--brand-primary)] bg-[var(--bg-primary)] flex items-center justify-center">
                  <span className="font-display text-base text-[var(--brand-primary)]">
                    {num}
                  </span>
                </div>
                <h3 className="mt-5 font-display text-lg">{title}</h3>
                <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed max-w-xs">
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Problem section ── */}
      <section
        data-reveal
        className="bg-[var(--bg-secondary)] border-t border-b border-[var(--border-default)] py-16"
      >
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="font-display text-3xl">
            Most people use 20% of what AI can do.
          </h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Not because the tools are bad — because no one set them up
            correctly.
          </p>
          <div className="mt-8 grid sm:grid-cols-3 gap-4">
            {PROBLEMS.map(({ Icon, title, desc }) => (
              <div
                key={title}
                className="rounded-[var(--radius-container)] border border-[var(--border-default)] bg-[var(--bg-elevated)] p-5"
              >
                <Icon
                  size={20}
                  className="text-[var(--text-secondary)] mb-3"
                />
                <p className="font-display text-base mb-1.5">{title}</p>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                  {desc}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-7 text-sm font-medium">
            AI School handles all three — automatically.
          </p>
        </div>
      </section>

      {/* ── Orchestration Demo ── */}
      <section data-reveal className="py-16">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="font-display text-3xl mb-2">
            See the routing in action
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mb-8">
            Pick a scenario — or watch it cycle automatically — and see the
            system choose mode, model, and agent in real time.
          </p>
          <OrchestrationDemo />
        </div>
      </section>

      {/* ── SOUL section ── */}
      <section
        data-reveal
        className="bg-[var(--bg-secondary)] border-t border-b border-[var(--border-default)] py-16"
      >
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="font-display text-3xl mb-2">
            Two layers of intelligence. One response.
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mb-8">
            Every answer is shaped by your school&apos;s context and your
            personal learning profile — combined at the point of generation.
          </p>
          <SoulDiagram />
        </div>
      </section>

      {/* ── Study Modes Grid ── */}
      <section data-reveal className="py-16">
        <div className="max-w-6xl mx-auto px-4">
          <h2 className="font-display text-3xl mb-2">
            9 study modes. 400+ AI models. Zero configuration.
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mb-8">
            From Socratic tutoring to structured exam practice — each mode is
            purpose-built for a different learning task. Hover to see an
            example.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            {SHOWN_MODE_KEYS.map((key) => {
              const mode = MODE_REGISTRY[key];
              const example = MODE_EXAMPLES[key];
              return (
                <div
                  key={key}
                  className="group rounded-xl border border-[var(--border-default)] bg-[var(--bg-elevated)] p-4 hover:bg-[var(--bg-hover)] transition-colors duration-150"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: mode.cssVar }}
                    />
                    <span className="font-display text-sm">{mode.label}</span>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    {mode.description}
                  </p>
                  <p className="mt-2 text-xs text-[var(--text-tertiary)] italic opacity-0 group-hover:opacity-100 transition-opacity duration-200 leading-relaxed">
                    &ldquo;{example}&rdquo;
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Features Strip ── */}
      <section
        data-reveal
        className="border-t border-b border-[var(--border-default)] bg-[var(--bg-secondary)] py-10"
      >
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex flex-wrap gap-x-8 gap-y-4 justify-center">
            {FEATURES.map(({ Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"
              >
                <Icon size={15} />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonial ── */}
      <section data-reveal className="py-20">
        <div className="max-w-6xl mx-auto px-4">
          <figure className="max-w-2xl mx-auto text-center">
            <div className="font-display text-4xl text-[var(--text-tertiary)] leading-none mb-5">
              &ldquo;
            </div>
            <blockquote className="font-display text-xl sm:text-2xl leading-relaxed">
              The first AI tool that actually understands the difference between
              a student who needs coaching and one who needs exam practice.
            </blockquote>
            <figcaption className="mt-5 text-sm text-[var(--text-secondary)]">
              Head of Science, UK Secondary School
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── CTA ── */}
      <section
        data-reveal
        className="border-t border-[var(--border-default)] bg-[var(--bg-secondary)] py-20"
      >
        <div className="max-w-6xl mx-auto px-4 text-center">
          <h2 className="font-display text-4xl sm:text-5xl">
            Built for schools.{" "}
            <span style={{ color: "var(--brand-primary)" }}>
              Ready for yours.
            </span>
          </h2>
          <p className="mt-5 text-[var(--text-secondary)] max-w-lg mx-auto text-sm leading-relaxed">
            Set up takes minutes. Add your school&apos;s values, tone
            guidelines, and student cohorts — the system does the rest.
          </p>
          <div className="mt-9 flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-1.5 px-6 py-3 rounded-lg bg-[var(--brand-primary)] text-white text-sm font-medium hover:opacity-90 transition-opacity shadow-[var(--shadow-card)]"
            >
              Get started free
              <ChevronRight size={14} />
            </Link>
            <Link
              href="/sign-in"
              className="inline-flex items-center px-6 py-3 rounded-lg border border-[var(--border-default)] text-sm hover:bg-[var(--bg-hover)] transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-[var(--border-default)] py-6">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between text-xs text-[var(--text-tertiary)]">
          <span className="font-display text-sm text-[var(--text-secondary)]">
            AI School
          </span>
          <div className="flex items-center gap-4">
            <Link
              href="/legal/privacy"
              className="hover:text-[var(--text-secondary)] transition-colors"
            >
              Privacy
            </Link>
            <Link
              href="/legal/terms"
              className="hover:text-[var(--text-secondary)] transition-colors"
            >
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
