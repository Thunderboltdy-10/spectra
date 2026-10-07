/**
 * Agent Foundry document
 * Phase 10 §10.1 — the collaborative content behind the Agent work surface.
 *
 * This layers on top of the legacy `AgentContent` rather than replacing it, so
 * existing agents keep working while the Foundry becomes the authoring surface.
 * The legacy fields remain the compiled projection the runtime already knows
 * how to read; mission, sections, evidence and skills are the new source.
 */

import {
  normalizeAgentContent,
  type AgentContent,
  type AgentSkill,
} from "../model";
import {
  createDefaultMission,
  type AgentMission,
  type InteractionStyle,
} from "./mission";
import {
  createFoundryState,
  type FoundryHistoryEntry,
  type FoundrySection,
  type FoundryState,
} from "./sections";
import type { EvidenceBinding } from "./evidence";
import type { SpectraSkill } from "./skills";

export const FOUNDRY_SCHEMA_VERSION = 1;

export type AgentFoundryContent = AgentContent & {
  /** Compatibility projection retained until every Agent reader uses Foundry. */
  mission?: { objective: string; [key: string]: unknown };
  foundationSections?: Record<string, unknown>[];
  evidenceBindings?: Record<string, unknown>[];
  releaseDrafts?: Record<string, unknown>[];
  foundry: {
    schemaVersion: number;
    mission: AgentMission;
    state: FoundryState;
    evidenceBindings: EvidenceBinding[];
    skills: SpectraSkill[];
    /** Draft compiled from the above; published releases are immutable. */
    draftReleaseNotes: string;
    /** Set once the two opening questions are answered (§10.2). */
    foundationEstablished: boolean;
  };
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function text(value: unknown, limit: number, fallback = ""): string {
  return typeof value === "string" ? value.slice(0, limit) : fallback;
}

function stringList(value: unknown, limit: number): string[] {
  return array<unknown>(value)
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeInteractionStyle(value: unknown): InteractionStyle {
  const style = record(value);
  const tones: InteractionStyle["tone"][] = [
    "warm",
    "direct",
    "socratic",
    "formal",
    "playful",
    "professional",
  ];
  const lengths: InteractionStyle["responseLength"][] = [
    "concise",
    "balanced",
    "detailed",
  ];
  const policies: InteractionStyle["clarificationPolicy"][] = [
    "ask_when_needed",
    "confirm",
    "never_ask",
  ];
  return {
    tone: tones.includes(style.tone as InteractionStyle["tone"])
      ? (style.tone as InteractionStyle["tone"])
      : "professional",
    responseLength: lengths.includes(
      style.responseLength as InteractionStyle["responseLength"],
    )
      ? (style.responseLength as InteractionStyle["responseLength"])
      : "balanced",
    clarificationPolicy: policies.includes(
      style.clarificationPolicy as InteractionStyle["clarificationPolicy"],
    )
      ? (style.clarificationPolicy as InteractionStyle["clarificationPolicy"])
      : "ask_when_needed",
    voiceCharacteristics: stringList(style.voiceCharacteristics, 12),
  };
}

export function normalizeMission(value: unknown): AgentMission {
  const source = record(value);
  const base = createDefaultMission();
  return {
    objective: text(source.objective, 8_000, base.objective),
    domains: stringList(source.domains, 24),
    intendedUsers: stringList(source.intendedUsers, 24).length
      ? stringList(source.intendedUsers, 24)
      : base.intendedUsers,
    expectedInputs: array<Record<string, unknown>>(source.expectedInputs)
      .map((entry) => record(entry))
      .flatMap((entry) => {
        const kind = entry.kind;
        const kinds = ["text", "file", "work", "data", "free_form"];
        if (typeof kind !== "string" || !kinds.includes(kind)) return [];
        return [
          {
            kind: kind as AgentMission["expectedInputs"][number]["kind"],
            description: text(entry.description, 600),
            required: entry.required !== false,
          },
        ];
      })
      .slice(0, 24),
    expectedOutputs: array<Record<string, unknown>>(source.expectedOutputs)
      .map((entry) => record(entry))
      .flatMap((entry) => {
        const kind = entry.kind;
        const kinds = ["document", "code", "analysis", "response", "work"];
        if (typeof kind !== "string" || !kinds.includes(kind)) return [];
        return [
          {
            kind: kind as AgentMission["expectedOutputs"][number]["kind"],
            description: text(entry.description, 600),
            ...(typeof entry.format === "string"
              ? { format: entry.format.slice(0, 120) }
              : {}),
          },
        ];
      })
      .slice(0, 24),
    decisionsAllowed: array<Record<string, unknown>>(source.decisionsAllowed)
      .map((entry) => record(entry))
      .map((entry): AgentMission["decisionsAllowed"][number] => ({
        scope: text(entry.scope, 400),
        autonomy:
          entry.autonomy === "decide_and_inform"
            ? "decide_and_inform"
            : entry.autonomy === "ask_when_uncertain"
              ? "ask_when_uncertain"
              : "always_ask",
        boundaries: stringList(entry.boundaries, 20),
      }))
      .slice(0, 24),
    approvalBoundaries: array<Record<string, unknown>>(source.approvalBoundaries)
      .map((entry) => record(entry))
      .map((entry) => ({
        action: text(entry.action, 200),
        requiresApproval: entry.requiresApproval !== false,
        reason: text(entry.reason, 600),
      }))
      .slice(0, 24),
    evidenceRequirements: array<Record<string, unknown>>(
      source.evidenceRequirements,
    )
      .map((entry) => record(entry))
      .map((entry) => ({
        domain: text(entry.domain, 200),
        minimumExamples:
          typeof entry.minimumExamples === "number"
            ? Math.max(0, Math.min(50, Math.round(entry.minimumExamples)))
            : 1,
        purpose: text(entry.purpose, 600),
      }))
      .slice(0, 24),
    exclusions: stringList(source.exclusions, 40),
    interactionStyle: normalizeInteractionStyle(source.interactionStyle),
  };
}

function normalizeSection(value: unknown, index: number): FoundrySection | null {
  const source = record(value);
  const kinds = [
    "text",
    "long_text",
    "single_choice",
    "multi_choice",
    "file_attachment",
    "work_reference",
    "example_pair",
    "permission_selection",
    "evidence_confirmation",
    "evaluation_response",
    "skill_review",
  ];
  const facets = [
    "objective",
    "interaction",
    "inputs",
    "outputs",
    "criteria",
    "evidence",
    "procedure",
    "boundaries",
    "tools",
    "calibration",
    "evaluation",
  ];
  if (typeof source.kind !== "string" || !kinds.includes(source.kind)) return null;
  if (typeof source.facet !== "string" || !facets.includes(source.facet))
    return null;

  return {
    id: text(source.id, 180, `section-${index + 1}`) || `section-${index + 1}`,
    kind: source.kind as FoundrySection["kind"],
    facet: source.facet as FoundrySection["facet"],
    prompt: text(source.prompt, 2_000),
    ...(typeof source.detail === "string"
      ? { detail: source.detail.slice(0, 2_000) }
      : {}),
    ...(Array.isArray(source.options)
      ? {
          options: array<Record<string, unknown>>(source.options)
            .map((entry) => record(entry))
            .map((entry, optionIndex) => ({
              id: text(entry.id, 120, `option-${optionIndex + 1}`),
              label: text(entry.label, 300),
              ...(typeof entry.detail === "string"
                ? { detail: entry.detail.slice(0, 600) }
                : {}),
              ...(entry.recommended === true ? { recommended: true } : {}),
            }))
            .slice(0, 20),
        }
      : {}),
    ...(source.multiSelect === true ? { multiSelect: true } : {}),
    ...(source.allowOther === true ? { allowOther: true } : {}),
    required: source.required === true,
    value: normalizeSectionValue(source.value),
    status:
      source.status === "answered" || source.status === "dismissed"
        ? source.status
        : "open",
    // Missing historical timestamps are unknown, not the time of this read.
    createdAt: typeof source.createdAt === "number" ? source.createdAt : 0,
    updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : 0,
    order: typeof source.order === "number" ? source.order : index,
  };
}

function normalizeSectionValue(value: unknown): FoundrySection["value"] {
  const source = record(value);
  switch (source.kind) {
    case "text":
      return { kind: "text", text: text(source.text, 40_000) };
    case "choice":
      return {
        kind: "choice",
        selected: stringList(source.selected, 30),
        ...(typeof source.other === "string"
          ? { other: source.other.slice(0, 4_000) }
          : {}),
      };
    case "files":
      return { kind: "files", fileIds: stringList(source.fileIds, 50) };
    case "works":
      return { kind: "works", workIds: stringList(source.workIds, 50) };
    case "examples":
      return {
        kind: "examples",
        pairs: array<Record<string, unknown>>(source.pairs)
          .map((entry) => record(entry))
          .map((entry, index) => ({
            id: text(entry.id, 120, `pair-${index + 1}`),
            input: text(entry.input, 20_000),
            output: text(entry.output, 20_000),
            ...(typeof entry.note === "string"
              ? { note: entry.note.slice(0, 2_000) }
              : {}),
          }))
          .slice(0, 50),
      };
    case "permissions":
      return { kind: "permissions", toolIds: stringList(source.toolIds, 40) };
    case "confirmation":
      return {
        kind: "confirmation",
        accepted: source.accepted === true,
        ...(typeof source.note === "string"
          ? { note: source.note.slice(0, 4_000) }
          : {}),
      };
    case "skills":
      return {
        kind: "skills",
        approvedSkillIds: stringList(source.approvedSkillIds, 100),
        rejectedSkillIds: stringList(source.rejectedSkillIds, 100),
      };
    default:
      return { kind: "empty" };
  }
}

export function normalizeFoundryContent(value: unknown): AgentFoundryContent {
  const legacy = normalizeAgentContent(value);
  const source = record(value);
  const foundry = record(source.foundry);
  const state = record(foundry.state);
  const legacyMission = record(source.mission);
  const foundationSections = array<Record<string, unknown>>(
    source.foundationSections,
  )
    .map(record)
    .slice(0, 500);
  const legacyEvidenceBindings = array<Record<string, unknown>>(
    source.evidenceBindings,
  )
    .map(record)
    .slice(0, 2_000);
  const releaseDrafts = array<Record<string, unknown>>(source.releaseDrafts)
    .map(record)
    .slice(0, 500);

  const sections = array<unknown>(state.sections)
    .map((entry, index) => normalizeSection(entry, index))
    .filter((section): section is FoundrySection => section !== null)
    .slice(0, 200)
    .sort((left, right) => left.order - right.order);

  return {
    ...legacy,
    ...(typeof legacyMission.objective === "string"
      ? {
          mission: {
            ...legacyMission,
            objective: text(legacyMission.objective, 8_000),
          },
        }
      : {}),
    ...(foundationSections.length ? { foundationSections } : {}),
    ...(legacyEvidenceBindings.length
      ? { evidenceBindings: legacyEvidenceBindings }
      : {}),
    ...(releaseDrafts.length ? { releaseDrafts } : {}),
    foundry: {
      schemaVersion:
        typeof foundry.schemaVersion === "number"
          ? foundry.schemaVersion
          : FOUNDRY_SCHEMA_VERSION,
      mission: normalizeMission(
        Object.keys(record(foundry.mission)).length
          ? foundry.mission
          : legacyMission,
      ),
      state: {
        ...createFoundryState(),
        sections,
        history: array<Record<string, unknown>>(state.history)
          .map((entry) => record(entry))
          .flatMap((entry): FoundryHistoryEntry[] => {
            if (typeof entry.action !== "string" || typeof entry.id !== "string")
              return [];
            return [
              {
                id: entry.id.slice(0, 180),
                at: typeof entry.at === "number" ? entry.at : 0,
                actor:
                  entry.actor === "user"
                    ? "user"
                    : entry.actor === "compiler"
                      ? "compiler"
                      : "creator",
                action: entry.action as FoundryHistoryEntry["action"],
                ...(typeof entry.sectionId === "string"
                  ? { sectionId: entry.sectionId }
                  : {}),
                ...(entry.previous
                  ? (() => {
                      const previous = normalizeSection(entry.previous, 0);
                      return previous ? { previous } : {};
                    })()
                  : {}),
                summary: text(entry.summary, 600),
              },
            ];
          })
          .slice(-500),
        skippedFacets: stringList(state.skippedFacets, 20).filter(
          (facet): facet is FoundryState["skippedFacets"][number] =>
            [
              "objective",
              "interaction",
              "inputs",
              "outputs",
              "criteria",
              "evidence",
              "procedure",
              "boundaries",
              "tools",
              "calibration",
              "evaluation",
            ].includes(facet),
        ),
      },
      evidenceBindings: array<Record<string, unknown>>(foundry.evidenceBindings)
        .map((entry) => record(entry))
        .flatMap((entry, index): EvidenceBinding[] => {
          if (typeof entry.sourceId !== "string") return [];
          const kinds = [
            "rubric",
            "policy",
            "example",
            "annotated_work",
            "manual",
            "source_document",
            "dataset",
            "previous_output",
            "accepted_example",
            "rejected_example",
          ];
          return [
            {
              id: text(entry.id, 180, `evidence-${index + 1}`),
              sourceId: entry.sourceId,
              kind: (typeof entry.kind === "string" && kinds.includes(entry.kind)
                ? entry.kind
                : "source_document") as EvidenceBinding["kind"],
              label: text(entry.label, 300, "Source"),
              confirmed: entry.confirmed === true,
              ...(entry.extraction
                ? { extraction: entry.extraction as EvidenceBinding["extraction"] }
                : {}),
            },
          ];
        })
        .slice(0, 100),
      skills: array<unknown>(foundry.skills)
        .filter(
          (entry): entry is SpectraSkill =>
            Boolean(entry) &&
            typeof entry === "object" &&
            typeof (entry as SpectraSkill).id === "string" &&
            typeof (entry as SpectraSkill).name === "string",
        )
        .slice(0, 100),
      draftReleaseNotes: text(foundry.draftReleaseNotes, 8_000),
      foundationEstablished: foundry.foundationEstablished === true,
    },
  };
}

export function createEmptyFoundryContent(base?: unknown): AgentFoundryContent {
  return normalizeFoundryContent(base ?? {});
}

/**
 * Projects Foundry state back onto the legacy fields the existing runtime,
 * routing and publish gates read. This keeps one source of truth (the Foundry)
 * while the compiled projection stays compatible.
 */
export function projectFoundryToLegacy(
  content: AgentFoundryContent,
): AgentFoundryContent {
  const { mission, skills } = content.foundry;

  const legacySkills: AgentSkill[] = skills
    .filter((skill) => skill.status !== "deprecated")
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      instructions: [
        skill.purpose,
        skill.procedure.length > 0
          ? `Procedure:\n${skill.procedure
              .slice()
              .sort((left, right) => left.order - right.order)
              .map((step, index) => `${index + 1}. ${step.action}`)
              .join("\n")}`
          : "",
        skill.outputContract.shape ? `Output: ${skill.outputContract.shape}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
      enabled: skill.status !== "deprecated",
    }));

  const compiledInstructions = [
    mission.objective,
    mission.domains.length ? `Work within: ${mission.domains.join(", ")}.` : "",
    mission.expectedOutputs.length
      ? `Produce: ${mission.expectedOutputs.map((output) => output.description).join("; ")}.`
      : "",
    legacySkills.length
      ? `Use these approved skills:\n${legacySkills
          .map((skill) => `- ${skill.name}: ${skill.instructions}`)
          .join("\n")}`
      : "",
    mission.exclusions.length
      ? `Do not: ${mission.exclusions.join("; ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return {
    ...content,
    profile: {
      ...content.profile,
      purpose: mission.objective || content.profile.purpose,
      outcomes: mission.expectedOutputs.map((output) => output.description),
      inScope: mission.domains,
      outOfScope: mission.exclusions,
    },
    instructions: {
      regionId: content.instructions.regionId || "agent-instructions",
      text: compiledInstructions || content.instructions.text,
    },
    behavior: {
      ...content.behavior,
      clarification: mission.interactionStyle.clarificationPolicy,
      tone:
        mission.interactionStyle.tone === "professional"
          ? "formal"
          : mission.interactionStyle.tone,
      responseLength: mission.interactionStyle.responseLength,
      boundaries: [
        ...mission.exclusions,
        ...mission.approvalBoundaries
          .filter((boundary) => boundary.requiresApproval)
          .map((boundary) => `Ask before ${boundary.action}`),
      ],
    },
    skills: legacySkills.length > 0 ? legacySkills : content.skills,
  };
}

/* ------------------------------------------------------------------ */
/* Approving a compilation                                             */
/* ------------------------------------------------------------------ */

/** What the Foundry compiler drafted for an agent: kept on its compiler job until approved. */
export type CompiledAgentResult = {
  skills: SpectraSkill[];
  routing: { description: string; examples: string[]; negativeExamples: string[] };
  releaseNotes: string;
};

/**
 * Approving one drafted skill: a skill the agent already has under the same
 * id becomes its next version; a new one joins as verified. The studio's
 * Approve and Spectra's approve_agent_skills both come here.
 */
export function acceptCompiledSkill(skills: readonly SpectraSkill[], skill: SpectraSkill): SpectraSkill[] {
  const existing = skills.find((entry) => entry.id === skill.id);
  const merged: SpectraSkill = existing
    ? { ...skill, version: existing.version + 1, supersedesVersion: existing.version }
    : skill;
  return [...skills.filter((entry) => entry.id !== skill.id), { ...merged, status: "verified" }];
}

/** The compiled routing signature and release notes, where the compiler wrote any. */
export function applyCompiledRouting(
  content: AgentFoundryContent,
  result: Pick<CompiledAgentResult, "routing" | "releaseNotes">,
): AgentFoundryContent {
  return {
    ...content,
    routing: {
      ...content.routing,
      description: result.routing.description || content.routing.description,
      examples: result.routing.examples.length ? result.routing.examples : content.routing.examples,
      negativeExamples: result.routing.negativeExamples.length
        ? result.routing.negativeExamples
        : content.routing.negativeExamples,
    },
    foundry: {
      ...content.foundry,
      draftReleaseNotes: result.releaseNotes || content.foundry.draftReleaseNotes,
    },
  };
}

/**
 * Drafted skills still waiting for approval: a skill approved from this
 * compilation, by the creator or by Spectra, carries its draft's timestamp,
 * so it no longer waits.
 */
export function pendingCompiledSkills(
  drafted: readonly SpectraSkill[],
  skills: readonly SpectraSkill[],
): SpectraSkill[] {
  return drafted.filter(
    (skill) => !skills.some((entry) => entry.id === skill.id && entry.updatedAt >= skill.updatedAt),
  );
}
