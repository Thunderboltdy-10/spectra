"use client";

import { motion, useReducedMotion } from "framer-motion";
import { SpectraMark } from "@/components/spectra-mark";

/**
 * Specialist agents (Phase 15.3/15.6): an index of teaching techniques, set
 * as quiet hairline rows — not a card wall. Each specialist is a technique,
 * a summary and the subjects it covers. Built in the Agent Foundry,
 * versioned, shared like any other work.
 */

const AGENTS = [
  {
    name: "Science Tutor",
    technique: "Socratic method",
    summary: "Asks what you think before it explains anything.",
    subjects: "Biology · Chemistry · Physics",
  },
  {
    name: "Essay Coach",
    technique: "Process writing",
    summary: "Moves the claim first, then reviews the structure around it.",
    subjects: "English · History · Humanities",
  },
  {
    name: "Maths Specialist",
    technique: "Error diagnosis",
    summary: "Finds exactly the step where the working breaks down.",
    subjects: "Algebra · Calculus · Statistics",
  },
  {
    name: "Research Assistant",
    technique: "Evidence synthesis",
    summary: "Cites sources and flags contradictions between them.",
    subjects: "Cross-subject · Sourcing · Analysis",
  },
] as const;

export function AgentsSection() {
  const reduced = useReducedMotion() ?? false;
  return (
    <section className="py-28" style={{ background: "var(--bg-secondary)" }}>
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-14 max-w-2xl" data-reveal>
          <h2 className="text-[clamp(1.9rem,4vw,2.75rem)] font-bold leading-[1.1] tracking-[-0.015em]">
            Specialists that{" "}
            <span className="text-[var(--brand-primary)]">teach,</span> not
            answer keys.
          </h2>
          <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-[var(--text-secondary)]">
            Built once in the Agent Foundry, versioned, and shared like any
            other work. Each one brings a technique, not a generic assistant
            voice.
          </p>
        </div>

        <div data-reveal>
          {AGENTS.map((agent, index) => (
            <motion.div
              key={agent.name}
              className={`grid items-baseline gap-2 py-8 md:grid-cols-12 md:gap-8 ${
                index < AGENTS.length - 1
                  ? "border-b border-[var(--border-subtle)]"
                  : ""
              } ${index === 0 ? "border-t border-[var(--border-subtle)]" : ""}`}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ amount: 0.5, once: true }}
              transition={{
                duration: reduced ? 0.15 : 0.45,
                delay: reduced ? 0 : index * 0.06,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <div className="flex items-center gap-2.5 md:col-span-4">
                <SpectraMark size={16} />
                <span className="text-[17px] font-bold tracking-[-0.01em] text-[var(--text-primary)]">
                  {agent.name}
                </span>
              </div>
              <div className="font-mono text-micro font-semibold uppercase tracking-[0.2em] text-[var(--brand-primary)] md:col-span-2">
                {agent.technique}
              </div>
              <p className="text-[14px] leading-relaxed text-[var(--text-secondary)] md:col-span-4">
                {agent.summary}
              </p>
              <div className="text-micro font-medium text-[var(--text-tertiary)] md:col-span-2 md:text-right">
                {agent.subjects}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
