"use client";

/**
 * Scene 10 — the agent someone builds for themselves.
 *
 * The Foundry's claim is that it interviews rather than configures: it asks the
 * next question that the mission still needs, and it stops asking when the
 * mission is sufficient. So the load-bearing thing to show is not a form. It is
 * the sufficiency check closing, facet by facet, as Pablo answers.
 *
 * The sections here are real `FoundrySection` values and the coverage is
 * computed by the product's own `coveredFacets`, so the meter is arithmetic on
 * real state rather than a number chosen to look convincing. The presentation
 * is landing-native because `AgentFoundry` itself reaches for releases, eval
 * runs and the compiler job on mount (§31): a marketing page has no business
 * opening those requests, and the model is the honest part anyway.
 */

import { useMemo, useRef } from "react";
import {
  FOUNDRY_FACETS,
  activeSections,
  coveredFacets,
  type FoundryFacet,
  type FoundrySection,
  type FoundryState,
} from "@/features/spectra/agents/foundry/sections";
import { targetAttrs } from "@/features/spectra/collaboration/target-attributes";
import { SceneRegion } from "../story/scene-region";
import { Body, Chip, Headline, Marker, Plate, useSceneT } from "../story/scene-kit";
import { usePrismSlot } from "../prism/prism-slot";
import { FIXTURE_TIME, WORK } from "../story/work";
import type { Beat } from "../story/beats";

export const FOUNDRY_BEATS: readonly Beat[] = [
  {
    actor: "spectra",
    from: 0.02,
    to: 0.1,
    path: "foundry/marker",
    primitive: "richtext",
    act: { kind: "type", text: "Agent Foundry" },
  },
  {
    actor: "spectra",
    from: 0.1,
    to: 0.2,
    path: "foundry/line-1",
    primitive: "richtext",
    act: { kind: "type", text: "It interviews you" },
  },
  {
    actor: "spectra",
    from: 0.2,
    to: 0.29,
    path: "foundry/line-2",
    primitive: "richtext",
    act: { kind: "type", text: "until it understands." },
  },

  /* Pablo answers three questions. Each one closes a facet, and the meter is
     the consequence rather than the illustration. */
  {
    actor: "pablo",
    from: 0.3,
    to: 0.42,
    path: "foundry/section/objective",
    primitive: "richtext",
    label: "What should it do",
    act: {
      kind: "type",
      text: "Quiz me on the parts of biology I get wrong, not the parts I already know.",
    },
  },
  {
    actor: "pabloAi",
    from: 0.4,
    to: 0.47,
    path: "foundry/section/inputs",
    primitive: "listItem",
    label: "Inputs",
    act: { kind: "create" },
    note: "Offering the sources it already has",
  },
  {
    actor: "pablo",
    from: 0.47,
    to: 0.56,
    path: "foundry/section/interaction",
    primitive: "dropdown",
    label: "How it should talk",
    act: { kind: "menu", option: "Socratic" },
  },
  {
    actor: "spectra",
    from: 0.56,
    to: 0.64,
    path: "foundry/section/criteria",
    primitive: "richtext",
    label: "What good looks like",
    act: { kind: "type", text: "One question at a time. Never the answer first." },
    note: "Writing the criterion it inferred",
  },
  {
    actor: "pablo",
    from: 0.64,
    to: 0.71,
    path: "foundry/section/boundaries",
    primitive: "toggle",
    label: "Boundaries",
    act: { kind: "press" },
  },

  /* The two acts that only make sense once the interview is sufficient. */
  {
    actor: "pabloAi",
    from: 0.72,
    to: 0.8,
    path: "foundry/evidence",
    primitive: "canvasObject",
    label: "Course rubric",
    act: { kind: "drag", to: "foundry/agent" },
    note: "Binding the rubric as evidence",
  },
  {
    actor: "pablo",
    from: 0.82,
    to: 0.9,
    path: "foundry/compile",
    primitive: "button",
    label: "Compile",
    act: { kind: "press" },
    note: "Compiling version 1",
  },
  {
    actor: "spectra",
    from: 0.88,
    to: 0.98,
    path: "foundry/close",
    primitive: "richtext",
    act: {
      kind: "type",
      text: "Nobody wrote a prompt. The answers were the specification.",
    },
  },
];

/* ------------------------------------------------------------------ *
 * The interview, as real sections
 * ------------------------------------------------------------------ */

type Question = {
  section: FoundrySection;
  /** When the answer lands, in scene time. */
  at: number;
  /** What the answer reads as once it has landed. */
  answer: string;
  /** Who answers it. */
  by: "pablo" | "spectra" | "pabloAi";
};

function section(
  id: string,
  facet: FoundryFacet,
  prompt: string,
  order: number,
  detail?: string,
): FoundrySection {
  return {
    id,
    kind: "long_text",
    prompt,
    ...(detail ? { detail } : {}),
    facet,
    required: true,
    value: { kind: "empty" },
    status: "open",
    createdAt: FIXTURE_TIME.created,
    updatedAt: FIXTURE_TIME.created,
    order,
  };
}

const QUESTIONS: readonly Question[] = [
  {
    section: section(
      "sec-objective",
      "objective",
      "What should this agent do that you would otherwise do yourself?",
      0,
    ),
    at: 0.42,
    answer:
      "Quiz me on the parts of biology I get wrong, not the parts I already know.",
    by: "pablo",
  },
  {
    section: section(
      "sec-inputs",
      "inputs",
      "What should it read before it answers?",
      1,
      "Spectra suggests what is already in this workspace.",
    ),
    at: 0.47,
    answer: `${WORK.title}, Campbell ch. 4, Week 6 slides`,
    by: "pabloAi",
  },
  {
    section: section(
      "sec-interaction",
      "interaction",
      "How should it talk to you?",
      2,
    ),
    at: 0.56,
    answer: "Socratic, concise, asks when it is unsure",
    by: "pablo",
  },
  {
    section: section(
      "sec-criteria",
      "criteria",
      "How will you know an answer was good?",
      3,
    ),
    at: 0.64,
    answer: "One question at a time. Never the answer first.",
    by: "spectra",
  },
  {
    section: section(
      "sec-boundaries",
      "boundaries",
      "Is there anything it must not do?",
      4,
    ),
    at: 0.71,
    answer: "Never write the assignment. Practice questions only.",
    by: "pablo",
  },
  {
    section: section(
      "sec-evidence",
      "evidence",
      "What should it measure itself against?",
      5,
    ),
    at: 0.8,
    answer: "Course rubric, bound as evidence",
    by: "pabloAi",
  },
];

/** Facets the interview decided this mission does not need. */
const SKIPPED: readonly FoundryFacet[] = [
  "outputs",
  "procedure",
  "tools",
  "calibration",
  "evaluation",
];

const BY_LABEL: Record<Question["by"], string> = {
  pablo: "Pablo",
  pabloAi: "Pablo's AI",
  spectra: "Spectra",
};

const FOUNDRY_POSE = [0.24, -0.42, 0.1] as const;

export function FoundryScene() {
  const prismRef = useRef<HTMLDivElement>(null);
  const t = useSceneT("foundry");

  usePrismSlot(prismRef, { fill: 0.62, lambda: 2, pose: FOUNDRY_POSE, poseWeight: 0.3 });

  /* Real state, answered in story order. `coveredFacets` then does the work:
     the meter cannot disagree with the list above it, because it is derived
     from it. */
  const state = useMemo<FoundryState>(() => {
    return {
      sections: QUESTIONS.map(({ section: base, at, answer }) =>
        t >= at
          ? {
              ...base,
              status: "answered" as const,
              value: { kind: "text" as const, text: answer },
              updatedAt: FIXTURE_TIME.updated,
            }
          : base,
      ),
      history: [],
      skippedFacets: t >= 0.3 ? [...SKIPPED] : [],
    };
  }, [t]);

  const covered = useMemo(() => coveredFacets(state), [state]);
  const sections = useMemo(() => activeSections(state), [state]);
  const asked = sections.filter(
    (entry, index) => t >= (QUESTIONS[index]?.at ?? 1) - 0.11,
  );
  const sufficient = covered.size >= FOUNDRY_FACETS.length;
  const compiled = t >= 0.9;

  return (
    <SceneRegion scene="foundry">
      <div className="relative h-full">
        <div className="absolute left-0 top-[26px] w-[398px]">
          <Marker beats={FOUNDRY_BEATS} scene="foundry" path="foundry/marker" />
          <Headline
            beats={FOUNDRY_BEATS}
            scene="foundry"
            size="support"
            paths={["foundry/line-1", "foundry/line-2"]}
            className="mt-3"
          />
          <Body
            beats={FOUNDRY_BEATS}
            scene="foundry"
            path="foundry/close"
            className="mt-5"
          />

          {/* Sufficiency, as the product computes it. Eleven facets, and the
              interview closes each one either by an answer or by deciding it
              does not apply to this mission. */}
          <div
            className="landing-facets mt-7"
            {...targetAttrs("foundry/facets", undefined, "surface")}
          >
            <div className="landing-facets-head">
              <span>Mission coverage</span>
              <span className="ml-auto tabular-nums">
                {covered.size} of {FOUNDRY_FACETS.length}
              </span>
            </div>
            <div className="landing-facets-grid">
              {FOUNDRY_FACETS.map((facet) => (
                <span
                  key={facet}
                  className="landing-facet"
                  data-state={
                    covered.has(facet)
                      ? state.skippedFacets.includes(facet)
                        ? "skipped"
                        : "answered"
                      : "open"
                  }
                >
                  {facet}
                </span>
              ))}
            </div>
            <p className="landing-facets-note">
              {sufficient
                ? "Enough to compile. The Foundry stopped asking."
                : "The Foundry keeps asking while a required facet is open."}
            </p>
          </div>
        </div>

        {/* The prism, small and off to the side: this scene is about the
            interview, and the glass has no work to do in it. */}
        <div
          ref={prismRef}
          className="absolute left-[36px] bottom-[18px] h-[210px] w-[210px]"
          {...targetAttrs("foundry/prism", undefined, "canvasObject")}
        />

        <Plate
          scene="foundry"
          path="foundry/agent"
          title="Study coach"
          meta={compiled ? "Version 1" : "Draft"}
          trailing={
            compiled ? (
              <Chip tone="mint" dot>
                Compiled
              </Chip>
            ) : sufficient ? (
              <Chip tone="violet">Ready to compile</Chip>
            ) : (
              <Chip>Interviewing</Chip>
            )
          }
          className="absolute right-0 top-[26px] h-[600px] w-[566px]"
          radius={1}
        >
          <div className="landing-interview">
            {asked.map((entry, index) => {
              const question = QUESTIONS[index];
              if (!question) return null;
              const answered = entry.status === "answered";
              return (
                <div
                  key={entry.id}
                  className="landing-question"
                  data-answered={answered ? "true" : "false"}
                  {...targetAttrs(
                    `foundry/section/${entry.facet}`,
                    undefined,
                    "richtext",
                  )}
                >
                  <div className="landing-question-facet">{entry.facet}</div>
                  <p className="landing-question-prompt">{entry.prompt}</p>
                  {entry.detail && !answered ? (
                    <p className="landing-question-detail">{entry.detail}</p>
                  ) : null}
                  {answered ? (
                    <p className="landing-question-answer">
                      <span className="landing-question-by">
                        {BY_LABEL[question.by]}
                      </span>
                      {entry.value.kind === "text" ? entry.value.text : ""}
                    </p>
                  ) : (
                    <div className="landing-question-waiting" aria-hidden="true" />
                  )}
                </div>
              );
            })}
          </div>
        </Plate>

        {/* Compilation is the last act, and it is a button rather than a
            mystery: the specification was the interview above it. */}
        <div className="absolute right-0 bottom-[24px] flex w-[566px] items-center gap-3">
          <span
            className="landing-btn"
            data-tone={sufficient ? "primary" : undefined}
            data-idle={sufficient ? "false" : "true"}
            {...targetAttrs("foundry/compile", undefined, "button")}
          >
            {compiled ? "Compiled version 1" : "Compile"}
          </span>
          {compiled ? (
            <>
              <Chip tone="cyan">Rubric bound</Chip>
              <Chip tone="gold">6 answers</Chip>
            </>
          ) : null}
        </div>
      </div>
    </SceneRegion>
  );
}
