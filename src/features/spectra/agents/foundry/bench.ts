/**
 * The agent bench (EDITORS.md, "Agents (user-built)").
 *
 * Testing and training a user-built agent happens here: the creator runs the
 * current draft on sample prompts, compares what it says with what came before
 * (the last release, or the previous run of the same prompt), adjusts the
 * instructions in place, and keeps a case as a test. A kept case joins the
 * agent's evaluation suite in the regression layer, so "Run checks" includes
 * it and a later draft cannot quietly lose what the creator already accepted.
 *
 * Everything in this module is pure: the routes, Convex and the editor share
 * the same reading of a check, a comparison and an instruction edit.
 */

import type { AgentFoundryContent } from "./foundry-document";
import type { InteractionStyle } from "./mission";
import type { SkillEvaluationCase, SpectraSkill } from "./skills";

export const BENCH_LIMITS = {
  prompt: 4_000,
  checkValue: 200,
  checks: 12,
  rubric: 2_000,
  output: 16_000,
  savedCases: 50,
  runsPerPrompt: 6,
} as const;

/** What a good answer must or must not do. */
export type BenchChecks = {
  mustInclude: string[];
  mustNotInclude: string[];
  /** Optional words for a judge: what a good answer does, in the creator's terms. */
  rubric?: string;
};

/** A bench case the creator kept as a test. */
export type BenchCase = {
  id: string;
  prompt: string;
  checks: BenchChecks;
  required: boolean;
  createdAt: number;
  updatedAt: number;
};

export type BenchTarget = "draft" | "release";

/** One answer the bench got, from this draft or from a release. */
export type BenchRun = {
  id: string;
  prompt: string;
  target: BenchTarget;
  releaseNumber?: number;
  output: string;
  createdAt: number;
};

export type BenchCompareMode = "previous" | "release";

/** One line of the bench route's answer stream. */
export type BenchStreamEvent =
  | { type: "start"; target: BenchTarget; releaseNumber?: number }
  | { type: "text"; delta: string }
  /** The provider was retried: what streamed so far is discarded. */
  | { type: "retry" }
  | { type: "done"; run: BenchRun }
  | { type: "error"; message: string };

/* ------------------------------------------------------------------ */
/* Prompts and checks                                                 */
/* ------------------------------------------------------------------ */

function collapse(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * The identity of a prompt: the same question asked twice is the same case,
 * whatever its spacing or capitals. Convex stores it, so it stays short.
 */
export function benchPromptKey(prompt: string): string {
  return collapse(prompt).toLowerCase().slice(0, 500);
}

/** One check per line, trimmed, without blanks or repeats. */
export function parseCheckLines(text: string): string[] {
  return cleanChecks(text.split(/\r?\n/));
}

function cleanChecks(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const entry = collapse(value).slice(0, BENCH_LIMITS.checkValue);
    const key = entry.toLowerCase();
    if (!entry || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= BENCH_LIMITS.checks) break;
  }
  return out;
}

export function normalizeBenchChecks(input: unknown): BenchChecks {
  const source =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const rubric =
    typeof source.rubric === "string"
      ? source.rubric.trim().slice(0, BENCH_LIMITS.rubric)
      : "";
  return {
    mustInclude: cleanChecks(Array.isArray(source.mustInclude) ? source.mustInclude : []),
    mustNotInclude: cleanChecks(
      Array.isArray(source.mustNotInclude) ? source.mustNotInclude : [],
    ),
    ...(rubric ? { rubric } : {}),
  };
}

export function benchChecksEmpty(checks: BenchChecks): boolean {
  return (
    checks.mustInclude.length === 0 &&
    checks.mustNotInclude.length === 0 &&
    !checks.rubric?.trim()
  );
}

/** Case and spacing never decide whether a phrase is there. */
export function containsPhrase(text: string, phrase: string): boolean {
  const needle = collapse(phrase).toLowerCase();
  return needle.length > 0 && collapse(text).toLowerCase().includes(needle);
}

export type BenchCheckResult = {
  kind: "include" | "exclude";
  value: string;
  passed: boolean;
};

export type BenchGrade = {
  results: BenchCheckResult[];
  passed: number;
  total: number;
  /** Every simple check holds. A rubric still needs a judge. */
  allPassed: boolean;
  needsJudgement: boolean;
};

/** The simple checks, decided in code, the same way "Run checks" decides them. */
export function gradeBenchChecks(checks: BenchChecks, output: string): BenchGrade {
  const results: BenchCheckResult[] = [
    ...checks.mustInclude.map((value) => ({
      kind: "include" as const,
      value,
      passed: containsPhrase(output, value),
    })),
    ...checks.mustNotInclude.map((value) => ({
      kind: "exclude" as const,
      value,
      passed: !containsPhrase(output, value),
    })),
  ];
  const passed = results.filter((result) => result.passed).length;
  return {
    results,
    passed,
    total: results.length,
    allPassed: passed === results.length,
    needsJudgement: Boolean(checks.rubric?.trim()),
  };
}

export const BENCH_CASE_PREFIX = "bench-";

export function isBenchEvaluationCase(caseId: string): boolean {
  return caseId.startsWith(BENCH_CASE_PREFIX);
}

/**
 * A kept case as the evaluation suite runs it: in the regression layer, so a
 * draft that stops doing what the creator accepted fails "Run checks".
 */
export function benchCaseToEvaluationCase(entry: BenchCase): SkillEvaluationCase {
  const checks = normalizeBenchChecks(entry.checks);
  return {
    id: `${BENCH_CASE_PREFIX}${entry.id}`,
    layer: "regression",
    input: entry.prompt.slice(0, BENCH_LIMITS.prompt),
    expectation: {
      kind: "checklist",
      mustInclude: checks.mustInclude,
      mustNotInclude: checks.mustNotInclude,
      ...(checks.rubric ? { rubric: checks.rubric } : {}),
    },
    required: entry.required,
  };
}

/** How many cases one evaluation run takes (convex/agents.ts beginEvalRun). */
export const SUITE_CASE_LIMIT = 50;

/**
 * The compiled suite with the creator's saved tests in it. A suite runs at
 * most fifty cases, so when it would overflow, the saved tests stay and the
 * compiled cases give way, always from the layer that has the most, so no
 * layer the suite needs is emptied first.
 */
export function withBenchCases<T extends { id: string; layer: string }>(
  suite: readonly T[],
  saved: readonly T[],
  limit = SUITE_CASE_LIMIT,
): T[] {
  const kept = saved.slice(0, limit);
  const savedIds = new Set(kept.map((entry) => entry.id));
  const compiled = suite.filter((entry) => !savedIds.has(entry.id));
  let overflow = compiled.length + kept.length - limit;
  const dropped = new Set<T>();
  while (overflow > 0) {
    const counts = new Map<string, T[]>();
    for (const entry of compiled) {
      if (dropped.has(entry)) continue;
      counts.set(entry.layer, [...(counts.get(entry.layer) ?? []), entry]);
    }
    let largest: T[] = [];
    for (const entries of counts.values())
      if (entries.length > largest.length) largest = entries;
    const last = largest[largest.length - 1];
    if (!last) break;
    dropped.add(last);
    overflow -= 1;
  }
  return [...compiled.filter((entry) => !dropped.has(entry)), ...kept];
}

/* ------------------------------------------------------------------ */
/* Comparing two answers                                              */
/* ------------------------------------------------------------------ */

const MAX_STATEMENTS = 200;
const SAME_POINT = 0.6;

/**
 * An answer as the points it makes: one per list item or sentence,
 * without the markdown around it. A raw line diff reads badly for prose; a
 * point that is new, gone or reworded is what a creator actually checks.
 */
export function statementsOf(text: string): string[] {
  const out: string[] = [];
  const withoutCode = text.replace(/```[\s\S]*?```/g, " ");
  for (const rawLine of withoutCode.split(/\r?\n/)) {
    // A heading organizes points rather than making one; the shape counts it.
    if (/^\s{0,3}#{1,6}\s/.test(rawLine)) continue;
    const line = rawLine
      .replace(/^\s{0,3}(?:>\s*|[-*+]\s+|\d+[.)]\s+)/, "")
      .replace(/[*_`~]+/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .trim();
    if (!line || /^\|?[\s:|-]+\|?$/.test(line)) continue;
    for (const sentence of line.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)) {
      const statement = collapse(sentence);
      if (statement.length > 1) out.push(statement);
      if (out.length >= MAX_STATEMENTS) return out;
    }
  }
  return out;
}

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function similarity(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function countMatches(text: string, pattern: RegExp) {
  return (text.match(pattern) ?? []).length;
}

export type BenchShapeChange = { label: string; before: number; after: number };

export type BenchComparison = {
  identical: boolean;
  /** Points only the newer answer makes. */
  added: string[];
  /** Points the newer answer no longer makes. */
  removed: string[];
  kept: number;
  reworded: number;
  wordsBefore: number;
  wordsAfter: number;
  shape: BenchShapeChange[];
  /** Share of points the two answers have in common, from 0 to 1. */
  overlap: number;
};

export function compareBenchOutputs(before: string, after: string): BenchComparison {
  const wordsBefore = wordsOf(before).length;
  const wordsAfter = wordsOf(after).length;
  const shapes: Array<[string, RegExp]> = [
    ["Headings", /^\s{0,3}#{1,6}\s/gm],
    ["List items", /^\s*(?:[-*+]|\d+[.)])\s/gm],
    ["Code blocks", /^\s*```[^\n]*\n[\s\S]*?```/gm],
    ["Table rows", /^\s*\|.*\|\s*$/gm],
  ];
  const shape = shapes
    .map(([label, pattern]) => ({
      label,
      before: countMatches(before, pattern),
      after: countMatches(after, pattern),
    }))
    .filter((entry) => entry.before !== entry.after);

  if (collapse(before) === collapse(after)) {
    const kept = statementsOf(after).length;
    return {
      identical: true,
      added: [],
      removed: [],
      kept,
      reworded: 0,
      wordsBefore,
      wordsAfter,
      shape: [],
      overlap: 1,
    };
  }

  const left = statementsOf(before).map((text) => ({ text, words: new Set(wordsOf(text)) }));
  const right = statementsOf(after).map((text) => ({ text, words: new Set(wordsOf(text)) }));
  const used = new Set<number>();
  const added: string[] = [];
  let kept = 0;
  let reworded = 0;
  for (const statement of right) {
    let best = -1;
    let bestScore = 0;
    left.forEach((candidate, index) => {
      if (used.has(index)) return;
      const score = similarity(statement.words, candidate.words);
      if (score > bestScore) {
        best = index;
        bestScore = score;
      }
    });
    if (best >= 0 && bestScore >= SAME_POINT) {
      used.add(best);
      kept += 1;
      if (bestScore < 1) reworded += 1;
    } else {
      added.push(statement.text);
    }
  }
  const removed = left.filter((_, index) => !used.has(index)).map((entry) => entry.text);
  const points = Math.max(left.length, right.length);
  return {
    identical: false,
    added,
    removed,
    kept,
    reworded,
    wordsBefore,
    wordsAfter,
    shape,
    overlap: points === 0 ? 1 : kept / points,
  };
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/** The comparison in a few short phrases, for the line above the two answers. */
export function describeComparison(comparison: BenchComparison): string[] {
  if (comparison.identical) return ["Same answer, word for word"];
  const phrases: string[] = [];
  const delta = comparison.wordsAfter - comparison.wordsBefore;
  const notable = Math.max(15, Math.round(comparison.wordsBefore * 0.1));
  if (Math.abs(delta) >= notable)
    phrases.push(`${plural(Math.abs(delta), "word")} ${delta > 0 ? "longer" : "shorter"}`);
  else phrases.push("About the same length");
  if (comparison.added.length) phrases.push(plural(comparison.added.length, "new point"));
  if (comparison.removed.length)
    phrases.push(`${plural(comparison.removed.length, "point")} dropped`);
  if (comparison.reworded) phrases.push(`${plural(comparison.reworded, "point")} reworded`);
  if (!comparison.added.length && !comparison.removed.length && !comparison.reworded)
    phrases.push("Same points");
  for (const change of comparison.shape)
    phrases.push(`${change.label.toLowerCase()} ${change.before} to ${change.after}`);
  return phrases;
}

/* ------------------------------------------------------------------ */
/* Which two answers sit side by side                                 */
/* ------------------------------------------------------------------ */

export type BenchPair = {
  /** This draft's latest answer. */
  current?: BenchRun;
  /** What it is compared with: the run before it, or the last release's. */
  baseline?: BenchRun;
};

export function benchPair(
  runs: readonly BenchRun[],
  mode: BenchCompareMode,
  releaseNumber?: number,
): BenchPair {
  const ordered = runs.slice().sort((left, right) => right.createdAt - left.createdAt);
  const drafts = ordered.filter((run) => run.target === "draft");
  const current = drafts[0];
  const baseline =
    mode === "previous"
      ? drafts[1]
      : releaseNumber === undefined
        ? undefined
        : ordered.find(
            (run) => run.target === "release" && run.releaseNumber === releaseNumber,
          );
  return {
    ...(current ? { current } : {}),
    ...(baseline ? { baseline } : {}),
  };
}

export type BenchEntry = {
  key: string;
  prompt: string;
  saved?: BenchCase;
  runs: BenchRun[];
};

const RECENT_PROMPTS = 12;

/**
 * The prompts on the bench: kept tests first, in the order they were kept,
 * then what the creator tried recently, then anything typed in this visit.
 */
export function benchEntries(input: {
  cases: readonly BenchCase[];
  runs: readonly BenchRun[];
  added: readonly string[];
  removed?: ReadonlySet<string>;
}): BenchEntry[] {
  const entries = new Map<string, BenchEntry>();
  const removed = input.removed ?? new Set<string>();
  const runsByKey = new Map<string, BenchRun[]>();
  for (const run of input.runs) {
    const key = benchPromptKey(run.prompt);
    runsByKey.set(key, [...(runsByKey.get(key) ?? []), run]);
  }
  const add = (prompt: string, saved?: BenchCase) => {
    const key = benchPromptKey(prompt);
    if (!key || removed.has(key)) return;
    const existing = entries.get(key);
    if (existing) {
      if (saved && !existing.saved) existing.saved = saved;
      return;
    }
    entries.set(key, {
      key,
      prompt: prompt.trim(),
      ...(saved ? { saved } : {}),
      runs: (runsByKey.get(key) ?? [])
        .slice()
        .sort((left, right) => right.createdAt - left.createdAt),
    });
  };
  for (const entry of input.cases.slice().sort((left, right) => left.createdAt - right.createdAt))
    add(entry.prompt, entry);
  const recent = input.runs
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt)
    .map((run) => run.prompt);
  let recentCount = 0;
  for (const prompt of recent) {
    if (recentCount >= RECENT_PROMPTS) break;
    const key = benchPromptKey(prompt);
    if (entries.has(key)) continue;
    add(prompt);
    recentCount += 1;
  }
  for (const prompt of input.added) add(prompt);
  return [...entries.values()];
}

/**
 * Prompts worth trying that the bench does not already hold: the creator's
 * own worked examples and routing examples first, then the unseen requests the
 * suite asks. Injection probes are left to "Run checks".
 */
export function samplePrompts(
  content: AgentFoundryContent,
  suite: readonly SkillEvaluationCase[],
  existing: readonly string[],
  limit = 4,
): string[] {
  const taken = new Set(existing.map(benchPromptKey));
  const out: string[] = [];
  const offer = (value: string | undefined) => {
    if (!value || out.length >= limit) return;
    const prompt = value.trim().slice(0, BENCH_LIMITS.prompt);
    const key = benchPromptKey(prompt);
    if (!key || key.length < 8 || taken.has(key)) return;
    taken.add(key);
    out.push(prompt);
  };
  for (const skill of content.foundry.skills) {
    if (skill.status === "deprecated") continue;
    for (const example of skill.examples) offer(example.input);
  }
  for (const example of content.routing.examples) offer(example);
  for (const entry of suite)
    if (entry.layer === "held_out" || entry.layer === "mission_truth") offer(entry.input);
  return out;
}

/* ------------------------------------------------------------------ */
/* Adjusting the instructions                                         */
/* ------------------------------------------------------------------ */

export type BenchSkillInstructions = {
  id: string;
  name: string;
  purpose: string;
  steps: string[];
  mustInclude: string[];
  mustNotInclude: string[];
};

/**
 * The parts of a Foundry agent that make up what it is told: the operating
 * brief and the lab prompt are compiled from exactly these, so editing them is
 * editing the agent's instructions.
 */
export type BenchInstructions = {
  objective: string;
  tone: InteractionStyle["tone"];
  responseLength: InteractionStyle["responseLength"];
  exclusions: string[];
  skills: BenchSkillInstructions[];
};

function orderedSteps(skill: SpectraSkill) {
  return skill.procedure.slice().sort((left, right) => left.order - right.order);
}

export function readBenchInstructions(content: AgentFoundryContent): BenchInstructions {
  const { mission, skills } = content.foundry;
  return {
    objective: mission.objective,
    tone: mission.interactionStyle.tone,
    responseLength: mission.interactionStyle.responseLength,
    exclusions: [...mission.exclusions],
    skills: skills
      .filter((skill) => skill.status !== "deprecated")
      .map((skill) => ({
        id: skill.id,
        name: skill.name,
        purpose: skill.purpose,
        steps: orderedSteps(skill).map((step) => step.action),
        mustInclude: [...skill.outputContract.mustInclude],
        mustNotInclude: [...skill.outputContract.mustNotInclude],
      })),
  };
}

function sameList(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function cleanLines(values: readonly string[], limit = 40) {
  return values.map(collapse).filter(Boolean).slice(0, limit);
}

/** What the creator changed, one short phrase per change. */
export function describeInstructionChanges(
  before: BenchInstructions,
  after: BenchInstructions,
): string[] {
  const changes: string[] = [];
  if (collapse(before.objective) !== collapse(after.objective)) changes.push("Objective");
  if (before.tone !== after.tone) changes.push(`Tone: ${after.tone}`);
  if (before.responseLength !== after.responseLength)
    changes.push(`Length: ${after.responseLength}`);
  if (!sameList(cleanLines(before.exclusions), cleanLines(after.exclusions)))
    changes.push("What it must not do");
  for (const skill of after.skills) {
    const previous = before.skills.find((entry) => entry.id === skill.id);
    if (!previous) continue;
    const parts: string[] = [];
    if (collapse(previous.purpose) !== collapse(skill.purpose)) parts.push("purpose");
    if (!sameList(cleanLines(previous.steps), cleanLines(skill.steps))) parts.push("steps");
    if (
      !sameList(cleanChecks(previous.mustInclude), cleanChecks(skill.mustInclude)) ||
      !sameList(cleanChecks(previous.mustNotInclude), cleanChecks(skill.mustNotInclude))
    )
      parts.push("what it includes");
    if (parts.length) changes.push(`${skill.name}: ${parts.join(", ")}`);
  }
  return changes;
}

/**
 * Writes edited instructions back into the Foundry document. Steps keep the
 * tools and verification of the step they replace, so rewording a step never
 * silently revokes what it was allowed to use.
 */
export function applyBenchInstructions(
  content: AgentFoundryContent,
  next: BenchInstructions,
  now: number,
): AgentFoundryContent {
  const { mission } = content.foundry;
  const skills = content.foundry.skills.map((skill) => {
    const edited = next.skills.find((entry) => entry.id === skill.id);
    if (!edited) return skill;
    const purpose = edited.purpose.trim() || skill.purpose;
    const previousSteps = orderedSteps(skill);
    const steps = cleanLines(edited.steps);
    const mustInclude = cleanChecks(edited.mustInclude);
    const mustNotInclude = cleanChecks(edited.mustNotInclude);
    const unchanged =
      purpose === skill.purpose &&
      sameList(steps, previousSteps.map((step) => step.action)) &&
      sameList(mustInclude, skill.outputContract.mustInclude) &&
      sameList(mustNotInclude, skill.outputContract.mustNotInclude);
    if (unchanged) return skill;
    return {
      ...skill,
      purpose,
      procedure: steps.map((action, index) => {
        const previous = previousSteps[index];
        return {
          ...(previous ?? {}),
          order: index + 1,
          action,
        };
      }),
      outputContract: { ...skill.outputContract, mustInclude, mustNotInclude },
      updatedAt: now,
    };
  });
  return {
    ...content,
    foundry: {
      ...content.foundry,
      mission: {
        ...mission,
        objective: next.objective.trim() || mission.objective,
        exclusions: cleanLines(next.exclusions),
        interactionStyle: {
          ...mission.interactionStyle,
          tone: next.tone,
          responseLength: next.responseLength,
        },
      },
      skills,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Suggestions from a failed check                                    */
/* ------------------------------------------------------------------ */

export type BenchSuggestion = {
  kind: "include" | "exclude";
  value: string;
  skillId: string;
  skillName: string;
};

/** The skill a prompt most plausibly reaches, by the words they share. */
export function skillForPrompt(
  prompt: string,
  skills: readonly SpectraSkill[],
): SpectraSkill | undefined {
  const active = skills.filter((skill) => skill.status !== "deprecated");
  if (active.length <= 1) return active[0];
  const words = new Set(wordsOf(prompt).filter((word) => word.length > 3));
  let best = active[0];
  let bestScore = -1;
  for (const skill of active) {
    const text = [
      skill.name,
      skill.purpose,
      ...skill.examples.map((example) => example.input),
      ...skill.triggers.flatMap((trigger) =>
        trigger.kind === "intent"
          ? [trigger.description, ...trigger.examples]
          : trigger.kind === "keyword"
            ? trigger.terms
            : [],
      ),
    ].join(" ");
    const score = wordsOf(text).filter((word) => words.has(word)).length;
    if (score > bestScore) {
      best = skill;
      bestScore = score;
    }
  }
  return best;
}

/**
 * A failed simple check suggests its own fix: ask the skill that answered to
 * always include what was missing, or never to say what it said. The creator
 * decides; nothing is applied without them.
 */
export function suggestAdjustments(
  prompt: string,
  grade: BenchGrade,
  skills: readonly SpectraSkill[],
): BenchSuggestion[] {
  const skill = skillForPrompt(prompt, skills);
  if (!skill) return [];
  return grade.results
    .filter((result) => !result.passed)
    .filter((result) =>
      result.kind === "include"
        ? !skill.outputContract.mustInclude.some((value) => containsPhrase(value, result.value))
        : !skill.outputContract.mustNotInclude.some((value) => containsPhrase(value, result.value)),
    )
    .map((result) => ({
      kind: result.kind,
      value: result.value,
      skillId: skill.id,
      skillName: skill.name,
    }));
}

export function applySuggestion(
  content: AgentFoundryContent,
  suggestion: BenchSuggestion,
  now: number,
): AgentFoundryContent {
  const instructions = readBenchInstructions(content);
  return applyBenchInstructions(
    content,
    {
      ...instructions,
      skills: instructions.skills.map((skill) =>
        skill.id !== suggestion.skillId
          ? skill
          : suggestion.kind === "include"
            ? { ...skill, mustInclude: [...skill.mustInclude, suggestion.value] }
            : { ...skill, mustNotInclude: [...skill.mustNotInclude, suggestion.value] },
      ),
    },
    now,
  );
}
