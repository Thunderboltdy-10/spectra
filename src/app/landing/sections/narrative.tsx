"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
} from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  MessageSquareText,
  ListChecks,
} from "lucide-react";
import { PrismStage } from "../prism/prism-stage";
import {
  PRISM_SCENES,
  sceneForProgress,
  sceneIndexForProgress,
  type PrismSceneState,
} from "../prism/prism-scene";
import { LiveWorkDemo } from "../demo/live-work-demo";
import {
  DemoConversation,
  DemoResultCards,
  DemoThreadCard,
} from "../demo/real-surfaces";

/**
 * The landing narrative (Phase 15.1–15.4): ONE persistent prism tells the
 * whole story across the hero and the four scroll scenes. The sticky canvas
 * never remounts; each scene pairs its copy with a real Spectra surface on
 * the opposite column, revealed by scroll and dissolved as it leaves — one
 * thing on stage at a time, never everything at once.
 */

const HERO_FRAGMENTS = [
  {
    Icon: BookOpen,
    label: "Cell biology, ch. 4",
    from: "left-[9%] top-[20%]",
    to: "translate-x-[30vw] translate-y-[16vh] scale-[0.6]",
    delay: "-2.2s",
  },
  {
    Icon: MessageSquareText,
    label: "Maya: “tighten paragraph 3”",
    from: "left-[5%] top-[58%]",
    to: "translate-x-[34vw] -translate-y-[4vh] scale-[0.6]",
    delay: "-5.4s",
  },
  {
    Icon: CalendarDays,
    label: "Lab report · Friday",
    from: "left-[16%] top-[79%]",
    to: "translate-x-[28vw] -translate-y-[22vh] scale-[0.6]",
    delay: "-1.1s",
  },
  {
    Icon: ListChecks,
    label: "Problem set 6 — 4 of 7",
    from: "left-[32%] top-[12%]",
    to: "translate-x-[13vw] translate-y-[25vh] scale-[0.6]",
    delay: "-3.8s",
  },
] as const;

const TRACK_SCENES = [
  {
    id: "fragments",
    step: "01 · Pieces",
    title: "The week, in pieces.",
    body: "A half-read chapter, a comment from Maya, a deadline on Friday, three tabs of research. Schoolwork arrives scattered across surfaces that never meet.",
    visual: null,
  },
  {
    id: "transformation",
    step: "02 · Through the glass",
    title: "Hold the thread.",
    body: "Spectra draws the pieces onto one plane of work — your context, your classmates and your tools meeting on the same surface, each in its own colour.",
    visual: "conversation",
  },
  {
    id: "live",
    step: "03 · In the work",
    title: "Work that is alive.",
    body: "AI edits inside the document wearing its own presence colour, a collaborator's cursor moves as they think, and every change lands exactly where it belongs.",
    visual: "live",
  },
  {
    id: "converge",
    step: "04 · Together",
    title: "One clear picture.",
    body: "Reading, drafts, quizzes and plans — connected, cited and ready when the week starts. This is what the light resolves into.",
    visual: "resolve",
  },
] as const;

type SceneVisualKind = (typeof TRACK_SCENES)[number]["visual"];

/** Right-column scene surfaces: the real product components, frameless. */
function SceneVisual({ kind }: { kind: SceneVisualKind }) {
  if (kind === "conversation")
    return (
      <div className="flex h-[min(540px,62vh)] w-full max-w-[440px] flex-col overflow-hidden rounded-[18px] bg-[color-mix(in_oklab,var(--bg-primary)_84%,transparent)] p-6 shadow-[0_40px_90px_rgba(27,20,12,0.14)] backdrop-blur-xl">
        <DemoConversation />
        <div
          className="pointer-events-none -mt-14 h-14 shrink-0"
          style={{
            background:
              "linear-gradient(to top, color-mix(in oklab, var(--bg-primary) 92%, transparent) 15%, transparent)",
          }}
        />
      </div>
    );
  if (kind === "live") return <LiveWorkDemo />;
  if (kind === "resolve")
    return (
      <div className="flex w-full max-w-[440px] flex-col gap-4">
        <div className="rounded-[16px] bg-[color-mix(in_oklab,var(--bg-primary)_86%,transparent)] p-4 shadow-[0_32px_70px_rgba(27,20,12,0.13)] backdrop-blur-xl">
          <DemoResultCards />
        </div>
        <div className="rounded-[14px] bg-[color-mix(in_oklab,var(--bg-primary)_86%,transparent)] shadow-[0_20px_44px_rgba(27,20,12,0.09)] backdrop-blur-xl">
          <DemoThreadCard />
        </div>
      </div>
    );
  return null;
}

/** Reveal on entry, dissolve on exit — the stage keeps one moment at a time. */
function SceneVisualReveal({
  kind,
  reduced,
}: {
  kind: SceneVisualKind;
  reduced: boolean;
}) {
  if (!kind) return null;
  return (
    <motion.div
      className="hidden items-center justify-end lg:flex"
      initial={
        reduced ? { opacity: 0 } : { opacity: 0, y: 40, filter: "blur(8px)" }
      }
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ amount: 0.3, once: false, margin: "-12% 0px -12% 0px" }}
      transition={{ duration: reduced ? 0.15 : 0.65, ease: [0.22, 1, 0.36, 1] }}
    >
      <SceneVisual kind={kind} />
    </motion.div>
  );
}

export function LandingNarrative() {
  const rootRef = useRef<HTMLElement>(null);
  const sceneRef = useRef<PrismSceneState>(PRISM_SCENES.hero);
  const [sceneIndex, setSceneIndex] = useState(0);
  const reduced = useReducedMotion() ?? false;

  const { scrollYProgress } = useScroll({
    target: rootRef,
    offset: ["start start", "end end"],
  });

  useMotionValueEvent(scrollYProgress, "change", (progress) => {
    sceneRef.current = sceneForProgress(progress);
    const next = sceneIndexForProgress(progress);
    setSceneIndex((current) => (current === next ? current : next));
  });

  /* The scattered week lingers through scene 01 — those ARE the pieces —
     and only surrenders into the glass when scene 02 draws them in. */
  const fragmentsFlying = sceneIndex >= 2;
  const railVisible = sceneIndex >= 1;

  return (
    <section
      ref={rootRef}
      className="relative"
      style={{
        background:
          "radial-gradient(72% 58% at 68% 34%, color-mix(in oklab, var(--brand-primary) 5.5%, transparent) 0%, transparent 62%), var(--bg-primary)",
      }}
    >
      {/* ---------------- sticky optical stage ---------------- */}
      <div className="pointer-events-none sticky top-0 z-0 h-screen">
        {/* scene aura: the stage warms and brightens as energy resolves */}
        <div
          className="absolute right-[-12%] top-[6%] h-[72vh] w-[60vw] rounded-full transition-opacity duration-[1400ms]"
          style={{
            background:
              "radial-gradient(closest-side, color-mix(in oklab, var(--brand-primary) 9%, transparent), transparent 72%)",
            opacity: 0.3 + sceneIndex * 0.16,
          }}
          aria-hidden="true"
        />

        <div className="pointer-events-auto absolute inset-0">
          <PrismStage
            scene={PRISM_SCENES.hero}
            sceneRef={sceneRef}
            className="absolute inset-0"
          />
        </div>

        {/* the scattered week — drift, then surrender to the glass */}
        {HERO_FRAGMENTS.map(({ Icon, label, from, to, delay }) => (
          <span
            key={label}
            className={`pointer-events-none absolute z-[5] hidden select-none items-center gap-1.5 rounded-lg border border-dashed bg-[color-mix(in_oklab,var(--bg-elevated)_88%,transparent)] px-2.5 py-1.5 text-micro font-medium backdrop-blur-[2px] transition-all duration-[1600ms] ease-[cubic-bezier(.3,.9,.3,1)] lg:inline-flex ${from} ${
              fragmentsFlying
                ? `${to} border-transparent text-[var(--brand-primary)] opacity-0 shadow-none`
                : "border-[var(--border-strong)] text-[var(--text-secondary)] shadow-[0_6px_18px_rgba(27,20,12,0.06)]"
            }`}
            style={{
              transitionProperty: "transform, opacity, color, border-color",
            }}
          >
            <span
              className="landing-fragment inline-flex items-center gap-1.5"
              style={{ animationDelay: delay }}
            >
              <Icon className="h-3 w-3" />
              {label}
            </span>
          </span>
        ))}

        {/* progress rail */}
        <div
          className={`absolute left-5 top-1/2 z-10 hidden -translate-y-1/2 flex-col gap-2 transition-opacity duration-700 lg:flex ${
            railVisible ? "opacity-100" : "opacity-0"
          }`}
          aria-hidden="true"
        >
          {TRACK_SCENES.map((entry, index) => (
            <span
              key={entry.id}
              className={`h-6 w-[3px] rounded-full transition-colors duration-500 ${
                index < sceneIndex
                  ? "bg-[var(--brand-primary)]"
                  : "bg-[var(--border-default)]"
              }`}
            />
          ))}
        </div>

        {/* drag hint — the glass is a real object */}
        <div
          className={`pointer-events-none absolute bottom-8 left-1/2 z-10 -translate-x-1/2 font-mono text-micro uppercase tracking-[0.32em] text-[var(--text-tertiary)] transition-opacity duration-1000 ${
            sceneIndex === 0 ? "opacity-70" : "opacity-0"
          }`}
          aria-hidden="true"
        >
          drag the glass — scroll to begin
        </div>
      </div>

      {/* ---------------- copy overlay ---------------- */}
      <div className="pointer-events-none relative z-10 -mt-[100vh]">
        {/* hero */}
        <div className="mx-auto flex min-h-[100svh] max-w-7xl items-center px-6 pb-20 pt-28">
          <div className="max-w-xl">
            <p className="landing-hero-in mb-5 font-mono text-micro font-semibold uppercase tracking-[0.26em] text-[var(--text-tertiary)] [animation-delay:60ms]">
              Spectra workspace
            </p>
            <h1 className="landing-hero-in text-[clamp(2.6rem,6vw,4.4rem)] font-bold leading-[1.04] tracking-[-0.02em] text-[var(--text-primary)] [animation-delay:160ms]">
              Every piece of
              <br />
              schoolwork,{" "}
              <span className="text-[var(--brand-primary)]">connected.</span>
            </h1>
            <p className="landing-hero-in mt-6 max-w-md text-[17px] leading-relaxed text-[var(--text-secondary)] [animation-delay:280ms]">
              Documents, quizzes, plans and decks share context, cite their
              sources and stay in sync — people and AI working side by side.
            </p>
            <div className="landing-hero-in mt-9 flex flex-wrap items-center gap-3.5 [animation-delay:400ms]">
              <Link
                href="/sign-up"
                className="pointer-events-auto inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-7 py-3.5 text-[15px] font-bold text-white shadow-[0_10px_28px_color-mix(in_oklab,var(--brand-primary)_26%,transparent)] transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_34px_color-mix(in_oklab,var(--brand-primary)_32%,transparent)] active:translate-y-0"
              >
                Get started
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#scenes"
                className="pointer-events-auto inline-flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_70%,transparent)] px-7 py-3.5 text-[15px] font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]"
              >
                See how it works
              </a>
            </div>

            {/* one concise request — the first photon entering the glass */}
            <div className="landing-hero-in mt-12 inline-flex max-w-md items-center gap-3 rounded-2xl border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_92%,transparent)] px-4 py-3 shadow-[0_14px_36px_rgba(27,20,12,0.08)] backdrop-blur-md [animation-delay:560ms]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-[color-mix(in_oklab,var(--brand-primary)_10%,var(--bg-primary))] font-mono text-[13px] font-semibold text-[var(--brand-primary)]">
                &rarr;
              </span>
              <p className="text-[13.5px] leading-snug text-[var(--text-primary)]">
                &ldquo;Turn these notes into a revision document for
                Friday&rsquo;s test.&rdquo;
              </p>
            </div>
          </div>
        </div>

        {/* scroll scenes: two columns — copy left, one live surface right */}
        <div id="scenes">
          {TRACK_SCENES.map((scene) => (
            <div
              key={scene.id}
              className="mx-auto grid min-h-[96vh] w-full max-w-7xl items-center gap-12 px-6 lg:grid-cols-2"
            >
              <div className="max-w-md max-lg:rounded-2xl max-lg:border max-lg:border-[var(--border-default)] max-lg:bg-[color-mix(in_oklab,var(--bg-primary)_86%,transparent)] max-lg:p-6 max-lg:backdrop-blur-md">
                <SceneCopy
                  sceneId={scene.id}
                  step={scene.step}
                  title={scene.title}
                  body={scene.body}
                  reduced={reduced}
                />
              </div>
              <SceneVisualReveal kind={scene.visual} reduced={reduced} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SceneCopy({
  sceneId,
  step,
  title,
  body,
  reduced,
}: {
  sceneId: string;
  step: string;
  title: string;
  body: string;
  reduced: boolean;
}) {
  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ amount: 0.55, once: true }}
      transition={{ duration: reduced ? 0.15 : 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <p className="mb-4 font-mono text-micro font-semibold uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
        {step}
      </p>
      <h2 className="text-[clamp(1.9rem,3.6vw,3rem)] font-bold leading-[1.08] tracking-[-0.015em] text-[var(--text-primary)]">
        {title}
      </h2>
      <p className="mt-5 text-[15.5px] leading-relaxed text-[var(--text-secondary)]">
        {body}
      </p>
      {sceneId === "converge" ? (
        <div className="mt-8 flex flex-wrap gap-3.5">
          <Link
            href="/sign-up"
            className="pointer-events-auto inline-flex items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-7 py-3.5 text-[15px] font-bold text-white shadow-[0_10px_28px_color-mix(in_oklab,var(--brand-primary)_26%,transparent)] transition-all hover:-translate-y-0.5"
          >
            Get started
            <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href="#contact"
            className="pointer-events-auto inline-flex items-center rounded-xl border border-[var(--border-default)] bg-[color-mix(in_oklab,var(--bg-elevated)_70%,transparent)] px-7 py-3.5 text-[15px] font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)]"
          >
            Talk to us
          </a>
        </div>
      ) : null}
    </motion.div>
  );
}
