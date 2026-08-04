"use client";

import { motion, useReducedMotion } from "framer-motion";
import { DemoRunTabs, DemoWorkCard } from "../demo/real-surfaces";

/**
 * Capabilities (Phase 15.5/15.6): the narrative already SHOWED conversation,
 * live work and resolution — this section names the vocabulary underneath.
 * One floating creation vignette above a quiet index of operations. No boxed
 * demo frames, no repetition of what the scenes just demonstrated.
 */

const OPERATIONS = [
  {
    key: "converse",
    name: "Converse",
    description:
      "Ask in plain words. The answer arrives where you are working, with its evidence attached.",
  },
  {
    key: "retrieve",
    name: "Retrieve",
    description:
      "Every claim traces back to your materials and sources — carried through, never re-invented.",
  },
  {
    key: "create",
    name: "Create",
    description:
      "Documents, sheets, decks, quizzes, plans and research are built in place — not pasted out of a chat.",
  },
  {
    key: "refine",
    name: "Refine",
    description:
      "Spectra edits inside the work itself. Drafts, versions and differences stay visible as objects.",
  },
  {
    key: "practice",
    name: "Practice",
    description:
      "Revision and quizzes are generated from your own material, paced to your own timetable.",
  },
] as const;

export function CapabilitiesSection() {
  const reduced = useReducedMotion() ?? false;
  return (
    <section className="py-28" style={{ background: "var(--bg-primary)" }}>
      <div className="mx-auto max-w-7xl px-6">
        {/* one floating creation moment — no frame, the object itself */}
        <div className="grid items-center gap-14 lg:grid-cols-12">
          <div className="max-w-xl lg:col-span-6" data-reveal>
            <h2 className="text-[clamp(1.9rem,4vw,2.75rem)] font-bold leading-[1.1] tracking-[-0.015em]">
              Ask once. Spectra chooses{" "}
              <span className="text-[var(--brand-primary)]">how to help.</span>
            </h2>
            <p className="mt-4 max-w-lg text-[15.5px] leading-relaxed text-[var(--text-secondary)]">
              You never pick a mode. The same request can become an answer, a
              document, a quiz or a plan — and while Spectra works, it says what
              it is doing in words you would use yourself.
            </p>
          </div>
          <motion.div
            className="relative lg:col-span-6"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 34 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ amount: 0.3, once: true }}
            transition={{
              duration: reduced ? 0.15 : 0.6,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            {/* the real Library card, mid-creation, floating on the page */}
            <div className="ml-auto max-w-[420px] rounded-[16px] bg-[var(--bg-elevated)] p-2.5 shadow-[0_36px_80px_rgba(27,20,12,0.13)]">
              <DemoWorkCard />
            </div>
            {/* the real run tab, overlapping like the dock does in-product */}
            <div className="ml-auto mr-6 mt-3 max-w-[380px] rounded-[12px] bg-[var(--bg-elevated)] p-1.5 shadow-[0_22px_50px_rgba(27,20,12,0.11)]">
              <DemoRunTabs />
            </div>
          </motion.div>
        </div>

        {/* the operations index: hairline rows, vocabulary in mono */}
        <div className="mt-24" data-reveal>
          {OPERATIONS.map((op) => (
            <div
              key={op.key}
              className="grid items-baseline gap-2 border-t border-[var(--border-subtle)] py-7 md:grid-cols-12 md:gap-8 last:border-b"
            >
              <div className="font-mono text-micro font-semibold uppercase tracking-[0.22em] text-[var(--text-tertiary)] md:col-span-3">
                {op.key}
              </div>
              <div className="text-[17px] font-bold tracking-[-0.01em] text-[var(--text-primary)] md:col-span-3">
                {op.name}
              </div>
              <p className="text-[14px] leading-relaxed text-[var(--text-secondary)] md:col-span-6">
                {op.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
