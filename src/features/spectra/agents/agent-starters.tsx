"use client";

import type { CSSProperties } from "react";
import { useClassBook } from "../school/use-class-book";

/*
 * Where an empty Agents page starts (AGENTS.md, "Starting one"): agents a
 * student would actually make, one for each of their subjects in that class's
 * ink, and a few that help with any subject. Pressing one makes the draft
 * with its purpose and instructions already written, ready to change.
 */

export type AgentStarter = {
  key: string;
  title: string;
  /** One line under the title, saying what the agent does for the student. */
  summary: string;
  instructions: string;
  ink: string;
};

const GENERAL: readonly AgentStarter[] = [
  {
    key: "essay-reader",
    title: "Essay reader",
    summary: "Reads a draft against its criteria and says what to fix first.",
    instructions:
      "Read the student's draft against the task's criteria. Say what works, then the three changes that would raise the mark most, in order. Quote the line each one is about. Never rewrite the essay for them.",
    ink: "var(--ink-orange)",
  },
  {
    key: "revision-planner",
    title: "Revision planner",
    summary: "Turns what is due into a plan for the days before it.",
    instructions:
      "Ask what is coming up and how much time the student has. Make a day-by-day plan with short, concrete sessions, harder topics earlier, and a check-in the day before. Keep it realistic.",
    ink: "var(--ink-green)",
  },
  {
    key: "quiz-master",
    title: "Quiz master",
    summary: "Asks questions on a topic until the gaps show.",
    instructions:
      "Ask one question at a time on the topic the student names, from easy to hard. After each answer, say whether it is right and why, briefly. At the end, list the ideas they should go back to.",
    ink: "var(--ink-violet)",
  },
];

/* What a helper for a subject should do depends on the kind of subject: a
   problem coach for the sciences and maths, a partner to talk with in a
   language, a close reader for literature, an examiner for the humanities. */
const ROLES: ReadonlyArray<{ match: RegExp; title: string; summary: string; instructions: (name: string) => string }> = [
  {
    match: /math|physics|chemistry|biology|computer|design tech|sports/i,
    title: "problem coach",
    summary: "Works problems with you one step at a time, without giving the answer away.",
    instructions: (name) =>
      `You coach ${name} problems. Ask the student to try the first step, then hint rather than solve. Check units, notation and method the way the course marks them, and finish each problem with what to remember next time.`,
  },
  {
    match: /french|spanish|german|mandarin|chinese|italian|japanese|language b|ab initio/i,
    title: "conversation partner",
    summary: "Talks with you in the language and corrects what slips, gently.",
    instructions: (name) =>
      `You are a ${name} conversation partner. Talk in the target language at the student's level. After each reply, note one or two mistakes with the correct form, and bring in vocabulary from their current topics.`,
  },
  {
    match: /english|literature|language a/i,
    title: "reading partner",
    summary: "Reads texts closely with you and sharpens your analysis.",
    instructions: (name) =>
      `You read texts closely with a ${name} student. Ask what they notice before saying what you see, push them from what a text says to how and why it says it, and help them build paragraphs around evidence.`,
  },
];

const FALLBACK_ROLE = {
  title: "examiner",
  summary: "Sets exam-style questions and marks your answers against the criteria.",
  instructions: (name: string) =>
    `You set exam-style ${name} questions. After the student answers, mark it against the course's criteria, say where the marks were won and lost, and show what a stronger answer adds.`,
};

function subjectStarter(name: string, ink: string): AgentStarter {
  const role = ROLES.find((entry) => entry.match.test(name)) ?? FALLBACK_ROLE;
  return {
    key: `subject:${name}`,
    title: `${name} ${role.title}`,
    summary: role.summary,
    instructions: role.instructions(name),
    ink,
  };
}

/** The student's subjects, once each: a second section of the same course (HS) is the same subject. */
function subjectsOf(book: ReturnType<typeof useClassBook>) {
  const seen = new Set<string>();
  return book.classes
    .filter((cls) => !cls.archived)
    .map((cls) => book.of(cls.providerClassId, cls.title)!)
    // The main section of a course first, so its ink is the one the subject keeps.
    .sort((a, b) => Number(a.name.endsWith(")")) - Number(b.name.endsWith(")")))
    .filter((identity) => {
      const bare = identity.name.replace(/\s*\([^)]*\)$/, "");
      if (!identity.subject || /knowledge/i.test(bare) || seen.has(bare)) return false;
      seen.add(bare);
      return true;
    })
    .map((identity) => ({ ...identity, name: identity.name.replace(/\s*\([^)]*\)$/, "") }));
}

export function AgentStarters({ busy, onStart }: { busy: boolean; onStart: (starter: AgentStarter) => void }) {
  const book = useClassBook();
  const subjects = subjectsOf(book).map((identity) => subjectStarter(identity.name, identity.ink));

  return (
    <section aria-labelledby="agent-starters" className="mt-10">
      <h2 id="agent-starters" className="font-display text-metric font-medium leading-tight text-[var(--text-primary)]">
        Make your first agent
      </h2>
      <p className="mt-2 max-w-2xl text-ui leading-6 text-[var(--text-secondary)]">
        An agent is a helper with one job, set up once and there whenever you ask. Start from one of these and change anything, or start blank with New agent.
      </p>
      {subjects.length ? (
        <>
          <h3 className="agent-starters-heading">For your subjects</h3>
          <StarterGrid starters={subjects} busy={busy} onStart={onStart} />
        </>
      ) : null}
      <h3 className="agent-starters-heading">For any subject</h3>
      <StarterGrid starters={GENERAL} busy={busy} onStart={onStart} />
    </section>
  );
}

function StarterGrid({ starters, busy, onStart }: { starters: readonly AgentStarter[]; busy: boolean; onStart: (starter: AgentStarter) => void }) {
  return (
    <ul className="agent-starters">
      {starters.map((starter) => (
        <li key={starter.key}>
          <button
            type="button"
            disabled={busy}
            data-life-launch
            onClick={() => onStart(starter)}
            style={{ "--class-ink": starter.ink } as CSSProperties}
            className="school-tile agent-starter"
          >
            <span className="min-w-0">
              <span className="school-tile-name">{starter.title}</span>
              <span className="mt-1.5 block text-ui leading-5 text-[var(--text-secondary)]">{starter.summary}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
