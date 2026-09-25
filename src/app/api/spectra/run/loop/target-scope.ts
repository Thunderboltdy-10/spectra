const POSITIVE_MUTATION = /\b(?:update|edit|change|modify|fix|repair|revise|rewrite|replace|add|remove)\b/i;
const NEGATIVE_REFERENCE = /\b(?:do not|don't|dont|never|avoid|leave)\b[\s\S]{0,80}\b(?:touch|edit|update|change|modify|alter|revise|rewrite|fix|repair|remove|delete|replace|use|include)\b/i;
const ARTIFACT_NOUN = "(?:artifacts?|documents?|notes?|guides?|decks?|presentations?|quizzes|flashcards?|sheets?|workbooks?|whiteboards?|code|tasks?|todos?)";
const SCOPE_LIST_HEADER = /\b(?:update|edit|change|modify|fix|repair|revise|rewrite|replace)\b(?=.*\b(?:only|both|following|these exact)\b)(?=.*\b(?:in place|existing)\b)/i;
const BULLET_LINE = /^\s*(?:[-*]|\d+[.)])\s+/;
const ARTIFACT_ID_PATTERN = /\bwx[a-z0-9]{20,}\b/gi;

function promptClauses(prompt: string) {
  return prompt.split(/(?<=[.!?;])\s+|[\r\n]+/).filter(Boolean);
}

/** Exact ids named in a positive mutation clause, excluding ids the user says to leave alone. */
export function explicitMutationArtifactIdsFromPrompt(prompt: string): string[] {
  const ids = new Set<string>();
  const pattern = ARTIFACT_ID_PATTERN;
  for (const clause of promptClauses(prompt)) {
    for (const match of clause.matchAll(pattern)) {
      const id = match[0];
      const before = clause.slice(0, match.index ?? 0);
      if (!POSITIVE_MUTATION.test(before)) continue;
      const connector = Math.max(
        before.toLowerCase().lastIndexOf(" and "),
        before.lastIndexOf(","),
        before.toLowerCase().lastIndexOf(" but "),
        before.toLowerCase().lastIndexOf(" nor "),
      );
      const localInstruction = before.slice(connector + 1);
      if (/\b(?:do not|don't|never|avoid|leave|not)\b/i.test(localInstruction))
        continue;
      ids.add(id);
    }
  }
  // Accept an explicit update-only heading followed by a short, labeled list
  // of exact artifact ids. Users commonly separate the action and its target
  // list with a line break; requiring the verb on each bullet loses a scope
  // that the user stated unambiguously.
  const lines = prompt.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!SCOPE_LIST_HEADER.test(lines[index] ?? "")) continue;
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next] ?? "";
      if (!line.trim()) break;
      if (!BULLET_LINE.test(line)) break;
      if (NEGATIVE_REFERENCE.test(line)) continue;
      for (const match of line.matchAll(pattern)) ids.add(match[0]);
    }
  }
  return [...ids].slice(0, 8);
}

/** Exact artifact ids the user explicitly excluded from the current task. */
export function explicitlyExcludedArtifactIdsFromPrompt(prompt: string): string[] {
  const ids = new Set<string>();
  const pattern = ARTIFACT_ID_PATTERN;
  for (const clause of promptClauses(prompt)) {
    for (const match of clause.matchAll(pattern)) {
      const before = clause.slice(0, match.index ?? 0);
      const connector = Math.max(
        before.toLowerCase().lastIndexOf(" and "),
        before.lastIndexOf(","),
        before.lastIndexOf(";"),
        before.toLowerCase().lastIndexOf(" but "),
        before.toLowerCase().lastIndexOf(" nor "),
      );
      if (NEGATIVE_REFERENCE.test(before.slice(connector + 1))) ids.add(match[0]);
    }
  }
  return [...ids].slice(0, 8);
}

/** A scoped run may only update exact, verified artifacts supplied by context. */
export function explicitMutationScopeViolation(
  operation: unknown,
  allowedArtifactIds: readonly string[],
): string | null {
  if (!operation || typeof operation !== "object" || Array.isArray(operation))
    return "Only an update to an explicitly named existing artifact is allowed.";
  const row = operation as Record<string, unknown>;
  const input = row.input && typeof row.input === "object" && !Array.isArray(row.input)
    ? (row.input as Record<string, unknown>)
    : null;
  if (row.type !== "artifact.update" || typeof input?.artifactId !== "string")
    return "This request updates existing artifacts only; creating or changing other Spectra objects is outside its scope.";
  if (!allowedArtifactIds.includes(input.artifactId))
    return `This request only allows updates to the exact named artifacts. The proposed target ${input.artifactId} is outside that scope.`;
  return null;
}

/** Detects a precise update-only request, so creation heuristics cannot turn “make this deck…” into a duplicate artifact. */
export function isExplicitExistingArtifactUpdateOnly(prompt: string): boolean {
  const hasUpdateOnlyCue =
    /\b(?:update|edit|change|modify|fix|repair|revise|rewrite|replace)\s+(?:only|both|these exact)\b/i.test(prompt) ||
    /\bonly\s+(?:update|edit|change|modify|fix|repair|revise|rewrite|replace)\b/i.test(prompt);
  if (!hasUpdateOnlyCue || !/\b(?:in place|existing)\b/i.test(prompt))
    return false;

  const positiveNewArtifact = promptClauses(prompt).some((clause) => {
    const hasNewArtifactRequest = new RegExp(
      `\\b(?:create|make|build|generate|write|draft)\\b[\\s\\S]{0,120}\\b(?:new|another|separate)\\b[\\s\\S]{0,48}\\b${ARTIFACT_NOUN}\\b`,
      "i",
    ).test(clause);
    const negatesCreation =
      /\b(?:do not|don't|never|avoid|without)\b[^.!?;]*\b(?:create|make|build|generate|write|draft)\b/i.test(
        clause,
      );
    return hasNewArtifactRequest && !negatesCreation;
  });
  return !positiveNewArtifact;
}
