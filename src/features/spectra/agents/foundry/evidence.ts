/**
 * Evidence analysis and extraction
 * Phase 10 §10.6
 *
 * Evidence is source material a creator supplies to raise an agent's
 * competence: rubrics, policies, worked examples, manuals, datasets. Each
 * source is analysed into inspectable structures so the creator can see what
 * the agent actually learned.
 *
 * Security boundary: evidence content is *data being described*, never
 * instructions to follow. Anything in a source that reads like an instruction
 * to the agent is captured as a `securityConcern` and quarantined — it never
 * becomes agent policy (§10.6, INV-18).
 */

import type { EvidenceSpan, SourceRecord } from "../../sources/records/source-record";

export type EvidenceKind =
  | "rubric"
  | "policy"
  | "example"
  | "annotated_work"
  | "manual"
  | "source_document"
  | "dataset"
  | "previous_output"
  | "accepted_example"
  | "rejected_example";

export type ExtractedCriterion = {
  id: string;
  name: string;
  description: string;
  /** Levels/bands where the source defines them (rubrics, policies). */
  levels: Array<{ label: string; descriptor: string; value?: number }>;
  weight?: number;
  evidenceSpanIds: string[];
};

export type ExtractedRule = {
  id: string;
  statement: string;
  /** "must" rules are hard constraints; "should" rules are defaults. */
  strength: "must" | "should" | "may";
  evidenceSpanIds: string[];
};

export type ExtractedVocabulary = {
  term: string;
  meaning: string;
  evidenceSpanIds: string[];
};

export type ExtractedProcedure = {
  id: string;
  name: string;
  steps: string[];
  evidenceSpanIds: string[];
};

export type ExtractedExample = {
  id: string;
  input: string;
  output: string;
  /** Whether the source presents this as a good or bad example. */
  polarity: "positive" | "negative" | "neutral";
  commentary?: string;
  evidenceSpanIds: string[];
};

export type ExtractedEdgeCase = {
  id: string;
  situation: string;
  expectedHandling: string;
  evidenceSpanIds: string[];
};

export type ExtractedContradiction = {
  id: string;
  description: string;
  /** Ids of the extracted items that conflict. */
  conflictingIds: string[];
  /** Resolution requires the creator; the compiler must not guess. */
  resolution:
    | { kind: "unresolved" }
    | { kind: "resolved_by_creator"; note: string; at: number };
};

export type UnresolvedQuestion = {
  id: string;
  question: string;
  why: string;
  answer?: string;
};

/**
 * Text in a source that attempts to direct the agent rather than inform it.
 * Quarantined by construction: the compiler reads these to warn the creator and
 * to build injection-resistance evaluation cases, never to derive policy.
 */
export type SecurityConcern = {
  id: string;
  kind:
    | "instruction_injection"
    | "role_override"
    | "exfiltration_attempt"
    | "policy_override"
    | "tool_coercion"
    | "embedded_credential";
  excerpt: string;
  evidenceSpanIds: string[];
  /** Always true — recorded explicitly so downstream code cannot forget. */
  quarantined: true;
};

export type EvidenceExtraction = {
  sourceId: string;
  kind: EvidenceKind;
  criteria: ExtractedCriterion[];
  rules: ExtractedRule[];
  vocabulary: ExtractedVocabulary[];
  procedures: ExtractedProcedure[];
  examples: ExtractedExample[];
  edgeCases: ExtractedEdgeCase[];
  contradictions: ExtractedContradiction[];
  unresolvedQuestions: UnresolvedQuestion[];
  securityConcerns: SecurityConcern[];
  extractedAt: number;
  /** Extraction schema version, so re-extraction is detectable. */
  version: number;
};

export const EVIDENCE_EXTRACTION_VERSION = 1;

export type EvidenceBinding = {
  id: string;
  sourceId: string;
  kind: EvidenceKind;
  label: string;
  /** Creator confirmed the extraction reflects the source. */
  confirmed: boolean;
  extraction?: EvidenceExtraction;
};

export function createEmptyExtraction(
  sourceId: string,
  kind: EvidenceKind,
  at: number,
): EvidenceExtraction {
  return {
    sourceId,
    kind,
    criteria: [],
    rules: [],
    vocabulary: [],
    procedures: [],
    examples: [],
    edgeCases: [],
    contradictions: [],
    unresolvedQuestions: [],
    securityConcerns: [],
    extractedAt: at,
    version: EVIDENCE_EXTRACTION_VERSION,
  };
}

/* ------------------------------------------------------------------ */
/* Injection detection                                                */
/* ------------------------------------------------------------------ */

type InjectionSignal = {
  kind: SecurityConcern["kind"];
  pattern: RegExp;
};

/**
 * Patterns that indicate a source is trying to act on the agent rather than be
 * read by it. Detection is deliberately generous: a false positive costs the
 * creator one dismissal, a false negative lets untrusted text become policy.
 */
const INJECTION_SIGNALS: readonly InjectionSignal[] = [
  {
    kind: "instruction_injection",
    pattern:
      /\b(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+|your\s+|previous\s+|prior\s+|above\s+)*(instruction|instructions|prompt|prompts|rule|rules|direction|directions|guideline|guidelines|context)\b/i,
  },
  {
    kind: "role_override",
    pattern:
      /\b(you\s+are\s+now|from\s+now\s+on\s+you|act\s+as|pretend\s+to\s+be|assume\s+the\s+role|new\s+persona|your\s+new\s+identity)\b/i,
  },
  {
    kind: "policy_override",
    pattern:
      /\b(no\s+longer\s+(bound|restricted)|without\s+(any\s+)?restrictions?|bypass\s+(the\s+)?(safety|policy|filter)|disable\s+(your\s+)?(safety|guardrails?|filters?)|developer\s+mode|jailbreak)\b/i,
  },
  {
    kind: "exfiltration_attempt",
    pattern:
      /\b(reveal|print|output|repeat|show)\s+(me\s+)?(your\s+|the\s+)?(system\s+prompt|instructions|hidden\s+|internal\s+|full\s+prompt|api\s+key|secret|credentials?)\b/i,
  },
  {
    kind: "tool_coercion",
    pattern:
      /\b(call|invoke|use|run|execute)\s+(the\s+)?\w*\s*(tool|function|command|shell)\b[^.]{0,80}\b(without|regardless|no\s+matter|even\s+if|do\s+not\s+ask|skip\s+approval)\b/i,
  },
  {
    kind: "embedded_credential",
    pattern:
      /\b(sk-[A-Za-z0-9]{16,}|api[_-]?key\s*[:=]\s*\S{12,}|bearer\s+[A-Za-z0-9._-]{20,}|password\s*[:=]\s*\S{6,})/i,
  },
];

/**
 * Also flag directive second-person imperatives aimed at the agent inside
 * material that should be descriptive (rubrics, datasets, student work).
 */
const DIRECTIVE_SIGNAL =
  /\b(you\s+must\s+(?:always|never)|always\s+(?:award|give|grant|mark)\s+(?:full|maximum|top)|never\s+(?:deduct|penalise|penalize|report)|give\s+(?:this|me)\s+(?:full|maximum|top)\s+marks?)\b/i;

/** Evidence kinds whose content is untrusted by nature. */
const UNTRUSTED_BY_NATURE: readonly EvidenceKind[] = [
  "annotated_work",
  "previous_output",
  "dataset",
  "accepted_example",
  "rejected_example",
  "example",
];

function concernId(index: number, kind: string) {
  return `sec-${kind}-${index}`;
}

/**
 * Scans an evidence excerpt for injection attempts. Returns quarantined
 * concerns; callers must not derive policy from the matched text.
 */
export function detectSecurityConcerns(
  text: string,
  options: { evidenceSpanIds?: string[]; kind?: EvidenceKind } = {},
): SecurityConcern[] {
  const concerns: SecurityConcern[] = [];
  const spanIds = options.evidenceSpanIds ?? [];

  INJECTION_SIGNALS.forEach((signal) => {
    const match = signal.pattern.exec(text);
    if (!match) return;
    concerns.push({
      id: concernId(concerns.length, signal.kind),
      kind: signal.kind,
      excerpt: excerptAround(text, match.index, match[0].length),
      evidenceSpanIds: spanIds,
      quarantined: true,
    });
  });

  const directive = DIRECTIVE_SIGNAL.exec(text);
  if (
    directive &&
    (!options.kind || UNTRUSTED_BY_NATURE.includes(options.kind)) &&
    !concerns.some((concern) => concern.kind === "instruction_injection")
  ) {
    concerns.push({
      id: concernId(concerns.length, "instruction_injection"),
      kind: "instruction_injection",
      excerpt: excerptAround(text, directive.index, directive[0].length),
      evidenceSpanIds: spanIds,
      quarantined: true,
    });
  }

  return concerns;
}

function excerptAround(text: string, index: number, length: number) {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + length + 60);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${
    end < text.length ? "…" : ""
  }`;
}

/**
 * Strips quarantined spans from text before it can contribute to agent policy.
 * Used when compiling skills from evidence: the surrounding descriptive content
 * is still usable, the injected directive is not.
 */
export function redactQuarantinedText(
  text: string,
  concerns: readonly SecurityConcern[],
): string {
  let output = text;
  for (const concern of concerns) {
    const bare = concern.excerpt.replace(/^…|…$/g, "").trim();
    if (bare.length > 0) {
      output = output.split(bare).join("[quarantined: untrusted directive]");
    }
  }
  return output;
}

/**
 * True when an extraction is safe to compile into skills without creator
 * review. Any unresolved contradiction or security concern requires a human.
 */
export function extractionRequiresReview(
  extraction: EvidenceExtraction,
): boolean {
  return (
    extraction.securityConcerns.length > 0 ||
    extraction.contradictions.some(
      (contradiction) => contradiction.resolution.kind === "unresolved",
    ) ||
    extraction.unresolvedQuestions.some((question) => !question.answer)
  );
}

/* ------------------------------------------------------------------ */
/* Aggregation across sources                                         */
/* ------------------------------------------------------------------ */

export type EvidenceSummary = {
  sourceCount: number;
  confirmedCount: number;
  criteriaCount: number;
  ruleCount: number;
  exampleCount: number;
  edgeCaseCount: number;
  unresolvedContradictions: number;
  unansweredQuestions: number;
  securityConcerns: number;
  /** Extractions that cannot be compiled without creator review. */
  needsReview: string[];
};

export function summarizeEvidence(
  bindings: readonly EvidenceBinding[],
): EvidenceSummary {
  const extractions = bindings
    .map((binding) => binding.extraction)
    .filter((extraction): extraction is EvidenceExtraction => Boolean(extraction));

  return {
    sourceCount: bindings.length,
    confirmedCount: bindings.filter((binding) => binding.confirmed).length,
    criteriaCount: sum(extractions, (item) => item.criteria.length),
    ruleCount: sum(extractions, (item) => item.rules.length),
    exampleCount: sum(extractions, (item) => item.examples.length),
    edgeCaseCount: sum(extractions, (item) => item.edgeCases.length),
    unresolvedContradictions: sum(
      extractions,
      (item) =>
        item.contradictions.filter(
          (contradiction) => contradiction.resolution.kind === "unresolved",
        ).length,
    ),
    unansweredQuestions: sum(
      extractions,
      (item) => item.unresolvedQuestions.filter((q) => !q.answer).length,
    ),
    securityConcerns: sum(extractions, (item) => item.securityConcerns.length),
    needsReview: extractions
      .filter((extraction) => extractionRequiresReview(extraction))
      .map((extraction) => extraction.sourceId),
  };
}

function sum<T>(items: readonly T[], pick: (item: T) => number) {
  return items.reduce((total, item) => total + pick(item), 0);
}

/**
 * Detects contradictions across sources: two "must" rules whose statements
 * oppose each other, or criteria with the same name but different weights.
 */
export function detectCrossSourceContradictions(
  extractions: readonly EvidenceExtraction[],
): ExtractedContradiction[] {
  const contradictions: ExtractedContradiction[] = [];

  const criteriaByName = new Map<
    string,
    Array<{ id: string; weight?: number; sourceId: string }>
  >();
  for (const extraction of extractions) {
    for (const criterion of extraction.criteria) {
      const key = criterion.name.trim().toLowerCase();
      const list = criteriaByName.get(key) ?? [];
      const entry: { id: string; weight?: number; sourceId: string } = {
        id: criterion.id,
        sourceId: extraction.sourceId,
      };
      if (criterion.weight !== undefined) entry.weight = criterion.weight;
      list.push(entry);
      criteriaByName.set(key, list);
    }
  }

  for (const [name, entries] of criteriaByName) {
    const weights = new Set(
      entries
        .map((entry) => entry.weight)
        .filter((weight): weight is number => weight !== undefined),
    );
    if (entries.length > 1 && weights.size > 1) {
      contradictions.push({
        id: `contradiction-weight-${name.replace(/\s+/g, "-")}`,
        description: `Criterion "${name}" carries different weights across sources (${[
          ...weights,
        ].join(", ")}).`,
        conflictingIds: entries.map((entry) => entry.id),
        resolution: { kind: "unresolved" },
      });
    }
  }

  const mustRules = extractions.flatMap((extraction) =>
    extraction.rules
      .filter((rule) => rule.strength === "must")
      .map((rule) => ({ rule, sourceId: extraction.sourceId })),
  );
  for (let index = 0; index < mustRules.length; index += 1) {
    for (let other = index + 1; other < mustRules.length; other += 1) {
      const left = mustRules[index]!;
      const right = mustRules[other]!;
      if (rulesOppose(left.rule.statement, right.rule.statement)) {
        contradictions.push({
          id: `contradiction-rule-${left.rule.id}-${right.rule.id}`,
          description: `Conflicting requirements: "${left.rule.statement}" versus "${right.rule.statement}".`,
          conflictingIds: [left.rule.id, right.rule.id],
          resolution: { kind: "unresolved" },
        });
      }
    }
  }

  return contradictions;
}

const NEGATION = /\b(never|not|no|without|avoid|must\s+not|cannot|don't|do\s+not)\b/i;

function rulesOppose(left: string, right: string): boolean {
  const leftNegated = NEGATION.test(left);
  const rightNegated = NEGATION.test(right);
  if (leftNegated === rightNegated) return false;
  const leftTokens = contentTokens(left);
  const rightTokens = contentTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return false;
  const shared = leftTokens.filter((token) => rightTokens.includes(token));
  // Require substantial subject overlap before claiming a contradiction.
  return shared.length >= Math.min(3, Math.min(leftTokens.length, rightTokens.length));
}

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "for",
  "on",
  "with",
  "is",
  "are",
  "be",
  "must",
  "should",
  "may",
  "not",
  "never",
  "no",
  "without",
  "avoid",
  "cannot",
  "do",
  "does",
  "this",
  "that",
  "it",
  "its",
]);

function contentTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

/** Convenience re-exports so callers get the source model from one place. */
export type { EvidenceSpan, SourceRecord };
