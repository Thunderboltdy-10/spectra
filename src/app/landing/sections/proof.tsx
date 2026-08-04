/**
 * Stakeholders & trust (Phase 15.5, editorial): calm proof, not a glowing
 * card grid. Three roles set as quiet divided rows; a guardrail band carries
 * the claims schools actually check.
 */

const STAKEHOLDERS = [
  {
    role: "For students",
    tagline: "Structured help, not shortcuts",
    color: "var(--brand-primary)",
    points: [
      "Guidance that teaches the syllabus instead of answering past it",
      "Work that keeps its history — drafts, citations and feedback in place",
      "Practice generated from your own material, on your own timetable",
    ],
  },
  {
    role: "For teachers",
    tagline: "Oversight without policing",
    color: "var(--accent-mint)",
    points: [
      "See how AI help was used — steps and sources, not just the final answer",
      "Guardrails and curriculum context you set once and everyone shares",
      "Real work to review: documents, quizzes, plans, presentations",
    ],
  },
  {
    role: "For schools",
    tagline: "Adoption you can defend",
    color: "var(--accent-gold)",
    points: [
      "Permissioned context: classes, materials and roles stay separated",
      "Per-student budgets with visibility into how they're spent",
      "A pilot path that starts with one department, not a platform bet",
    ],
  },
] as const;

const GUARDRAILS = [
  "Permissioned by default",
  "Cited work, auditable",
  "Budget visible per student",
  "Teacher-set boundaries",
] as const;

export function ProofSection() {
  return (
    <section className="py-24" style={{ background: "var(--bg-primary)" }}>
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-6 max-w-2xl" data-reveal>
          <h2 className="text-[clamp(1.9rem,4vw,2.75rem)] font-bold leading-[1.1] tracking-[-0.015em]">
            Built for the people{" "}
            <span className="text-[var(--brand-primary)]">
              in the building.
            </span>
          </h2>
        </div>

        {/* editorial rows: content divided by rules, not boxed into cards */}
        <div data-reveal>
          {STAKEHOLDERS.map(({ role, tagline, color, points }) => (
            <div
              key={role}
              className="grid gap-6 border-t border-[var(--border-subtle)] py-10 md:grid-cols-12 md:gap-10"
            >
              <div className="md:col-span-4">
                <h3 className="text-[19px] font-bold tracking-[-0.01em] text-[var(--text-primary)]">
                  {role}
                </h3>
                <p
                  className="mt-1.5 text-[13.5px] font-semibold"
                  style={{ color }}
                >
                  {tagline}
                </p>
              </div>
              <ul className="space-y-3.5 md:col-span-8 md:columns-2 md:space-y-0 md:[column-gap:3rem]">
                {points.map((point) => (
                  <li
                    key={point}
                    className="mb-3.5 flex items-start gap-3 break-inside-avoid text-[14px] leading-relaxed text-[var(--text-secondary)]"
                  >
                    <span
                      className="mt-[8px] h-[3px] w-6 shrink-0 rounded-full"
                      style={{ background: color }}
                    />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* quiet guardrail band: lines, not cards */}
        <div
          className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-3 border-t border-[var(--border-subtle)] pt-8"
          data-reveal
        >
          {GUARDRAILS.map((item) => (
            <span
              key={item}
              className="font-mono text-micro font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]"
            >
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
