/**
 * First-class skills
 * Phase 10 §10.7
 *
 * A skill is a versioned, contract-bearing procedure — not a paragraph
 * concatenated into a system prompt. Skills are retrieved and activated based
 * on mission and request context (§10.14), so a compiled release loads only
 * what a request actually needs.
 */

import type { EvidenceBinding } from "./evidence";

export type SkillTrigger =
  | { kind: "intent"; description: string; examples: string[] }
  | { kind: "input_type"; types: string[] }
  | { kind: "work_type"; workTypes: string[] }
  | { kind: "keyword"; terms: string[] }
  | { kind: "always" };

export type SkillInputContract = {
  required: Array<{ name: string; kind: string; description: string }>;
  optional: Array<{ name: string; kind: string; description: string }>;
};

export type SkillOutputContract = {
  shape: string;
  mustInclude: string[];
  mustNotInclude: string[];
  format?: "prose" | "structured" | "work_edit" | "table" | "code";
};

export type SkillStep = {
  order: number;
  action: string;
  /** How the agent knows this step succeeded. */
  verification?: string;
  /** Tool ids this step may use. */
  tools?: string[];
};

export type EvidenceReference = {
  bindingId: string;
  /** Which extracted structures this skill depends on. */
  usedFor: Array<"criteria" | "rules" | "vocabulary" | "procedures" | "examples" | "edge_cases">;
};

export type SkillExample = {
  id: string;
  input: string;
  output: string;
  note?: string;
};

export type SkillFailureMode = {
  id: string;
  description: string;
  detection: string;
  recovery: string;
};

export type SkillEvaluationCase = {
  id: string;
  /** Layer this case belongs to (§10.10). */
  layer:
    | "contract"
    | "held_out"
    | "mission_truth"
    | "tool_sandbox"
    | "adversarial"
    | "regression";
  input: string;
  /** Deterministic expectation where one exists. */
  expectation:
    | { kind: "contains"; values: string[] }
    | { kind: "excludes"; values: string[] }
    | { kind: "matches"; pattern: string }
    | { kind: "structured"; schema: string }
    | { kind: "judged"; criteria: string; externalTruth: boolean };
  required: boolean;
};

export type SpectraSkill = {
  id: string;
  version: number;
  name: string;
  purpose: string;
  triggers: SkillTrigger[];
  inputContract: SkillInputContract;
  outputContract: SkillOutputContract;
  procedure: SkillStep[];
  evidenceBindings: EvidenceReference[];
  examples: SkillExample[];
  failureModes: SkillFailureMode[];
  evaluationCases: SkillEvaluationCase[];
  status: "draft" | "verified" | "deprecated";
  /** Set when this version supersedes an earlier one. */
  supersedesVersion?: number;
  createdAt: number;
  updatedAt: number;
};

export function createSkill(
  input: Pick<SpectraSkill, "id" | "name" | "purpose"> &
    Partial<Omit<SpectraSkill, "id" | "name" | "purpose">>,
  now: number,
): SpectraSkill {
  return {
    version: 1,
    triggers: [],
    inputContract: { required: [], optional: [] },
    outputContract: { shape: "", mustInclude: [], mustNotInclude: [] },
    procedure: [],
    evidenceBindings: [],
    examples: [],
    failureModes: [],
    evaluationCases: [],
    status: "draft",
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

/** A new immutable version. The prior version is never mutated in place. */
export function reviseSkill(
  skill: SpectraSkill,
  changes: Partial<Omit<SpectraSkill, "id" | "version" | "createdAt">>,
  now: number,
): SpectraSkill {
  return {
    ...skill,
    ...changes,
    id: skill.id,
    version: skill.version + 1,
    supersedesVersion: skill.version,
    status: changes.status ?? "draft",
    updatedAt: now,
  };
}

export function skillIssues(skill: SpectraSkill): string[] {
  const issues: string[] = [];
  if (skill.name.trim().length < 3) issues.push("Skill needs a name.");
  if (skill.purpose.trim().length < 20)
    issues.push(`"${skill.name}" needs a purpose of at least 20 characters.`);
  if (skill.triggers.length === 0)
    issues.push(`"${skill.name}" has no trigger, so it can never activate.`);
  if (skill.procedure.length === 0)
    issues.push(`"${skill.name}" has no procedure steps.`);
  if (!skill.outputContract.shape.trim())
    issues.push(`"${skill.name}" does not describe its output.`);
  if (skill.status === "verified" && skill.evaluationCases.length === 0)
    issues.push(`"${skill.name}" cannot be verified without evaluation cases.`);
  return issues;
}

/* ------------------------------------------------------------------ */
/* Retrieval and activation                                           */
/* ------------------------------------------------------------------ */

export type SkillActivationContext = {
  request: string;
  inputTypes?: string[];
  workTypes?: string[];
  /** Evidence bindings actually available at runtime. */
  availableEvidenceIds?: string[];
  /** Tool ids the runtime may use for this request. */
  availableToolIds?: string[];
};

export type SkillActivation = {
  skill: SpectraSkill;
  score: number;
  reasons: string[];
  /** Missing prerequisites — an activation with these is reported, not used. */
  missing: string[];
};

const MAX_ACTIVE_SKILLS = 6;

/**
 * Selects the skills relevant to one request. Skills are never concatenated
 * blindly; a skill whose evidence or tools are unavailable is reported as
 * missing so routing can refuse rather than silently degrade (§10.11).
 */
export function activateSkills(
  skills: readonly SpectraSkill[],
  context: SkillActivationContext,
  limit: number = MAX_ACTIVE_SKILLS,
): SkillActivation[] {
  const request = context.request.toLowerCase();

  const scored = skills
    .filter((skill) => skill.status !== "deprecated")
    .map((skill): SkillActivation => {
      let score = 0;
      const reasons: string[] = [];

      for (const trigger of skill.triggers) {
        switch (trigger.kind) {
          case "always":
            score += 20;
            reasons.push("always active");
            break;
          case "keyword": {
            const hits = trigger.terms.filter((term) =>
              request.includes(term.toLowerCase()),
            );
            if (hits.length > 0) {
              score += 25 + hits.length * 5;
              reasons.push(`matched ${hits.join(", ")}`);
            }
            break;
          }
          case "intent": {
            const overlap = intentOverlap(trigger, request);
            if (overlap > 0) {
              score += Math.round(overlap * 50);
              reasons.push("intent match");
            }
            break;
          }
          case "input_type": {
            const hits = (context.inputTypes ?? []).filter((type) =>
              trigger.types.includes(type),
            );
            if (hits.length > 0) {
              score += 30;
              reasons.push(`input type ${hits.join(", ")}`);
            }
            break;
          }
          case "work_type": {
            const hits = (context.workTypes ?? []).filter((type) =>
              trigger.workTypes.includes(type),
            );
            if (hits.length > 0) {
              score += 30;
              reasons.push(`work type ${hits.join(", ")}`);
            }
            break;
          }
        }
      }

      if (skill.status === "verified") score += 10;

      const missing: string[] = [];
      if (context.availableEvidenceIds) {
        for (const binding of skill.evidenceBindings) {
          if (!context.availableEvidenceIds.includes(binding.bindingId)) {
            missing.push(`evidence:${binding.bindingId}`);
          }
        }
      }
      if (context.availableToolIds) {
        const required = new Set(
          skill.procedure.flatMap((step) => step.tools ?? []),
        );
        for (const tool of required) {
          if (!context.availableToolIds.includes(tool)) {
            missing.push(`tool:${tool}`);
          }
        }
      }

      return { skill, score, reasons, missing };
    })
    .filter((activation) => activation.score > 0)
    .sort((left, right) => right.score - left.score);

  return scored.slice(0, limit);
}

function intentOverlap(
  trigger: Extract<SkillTrigger, { kind: "intent" }>,
  request: string,
): number {
  const tokens = new Set(
    `${trigger.description} ${trigger.examples.join(" ")}`
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 3),
  );
  if (tokens.size === 0) return 0;
  const requestTokens = new Set(
    request
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 3),
  );
  let hits = 0;
  for (const token of tokens) if (requestTokens.has(token)) hits += 1;
  return hits / tokens.size;
}

/** Skills whose evidence bindings reference a binding that no longer exists. */
export function orphanedSkillBindings(
  skills: readonly SpectraSkill[],
  bindings: readonly EvidenceBinding[],
): Array<{ skillId: string; bindingId: string }> {
  const known = new Set(bindings.map((binding) => binding.id));
  return skills.flatMap((skill) =>
    skill.evidenceBindings
      .filter((reference) => !known.has(reference.bindingId))
      .map((reference) => ({
        skillId: skill.id,
        bindingId: reference.bindingId,
      })),
  );
}

/** Skills that cover substantially the same trigger surface. */
export function detectSkillOverlap(
  skills: readonly SpectraSkill[],
): Array<{ left: string; right: string; overlap: number }> {
  const results: Array<{ left: string; right: string; overlap: number }> = [];
  for (let index = 0; index < skills.length; index += 1) {
    for (let other = index + 1; other < skills.length; other += 1) {
      const left = skills[index]!;
      const right = skills[other]!;
      const overlap = triggerOverlap(left, right);
      if (overlap >= 0.6) {
        results.push({ left: left.id, right: right.id, overlap });
      }
    }
  }
  return results;
}

function triggerOverlap(left: SpectraSkill, right: SpectraSkill): number {
  const leftTerms = triggerTerms(left);
  const rightTerms = triggerTerms(right);
  if (leftTerms.size === 0 || rightTerms.size === 0) return 0;
  let shared = 0;
  for (const term of leftTerms) if (rightTerms.has(term)) shared += 1;
  return shared / Math.min(leftTerms.size, rightTerms.size);
}

function triggerTerms(skill: SpectraSkill): Set<string> {
  const terms = new Set<string>();
  for (const trigger of skill.triggers) {
    switch (trigger.kind) {
      case "keyword":
        trigger.terms.forEach((term) => terms.add(term.toLowerCase()));
        break;
      case "intent":
        trigger.description
          .toLowerCase()
          .split(/\s+/)
          .filter((token) => token.length > 3)
          .forEach((token) => terms.add(token));
        break;
      case "input_type":
        trigger.types.forEach((type) => terms.add(`input:${type}`));
        break;
      case "work_type":
        trigger.workTypes.forEach((type) => terms.add(`work:${type}`));
        break;
      case "always":
        terms.add("*");
        break;
    }
  }
  return terms;
}
