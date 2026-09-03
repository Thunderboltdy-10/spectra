export const REFORMATION_EVIDENCE_SCHEMA_VERSION = 1;
export const REFORMATION_EVIDENCE_UNITS = Object.freeze([
  "P8.P1",
  "RC.V1",
  "P8.V1",
]);
export const REFORMATION_EVIDENCE_VERDICTS = Object.freeze([
  "open",
  "pass",
  "fail",
  "blocked",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error("Expected a string.");
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

export function createEvidenceManifest(input = {}) {
  return {
    schemaVersion: REFORMATION_EVIDENCE_SCHEMA_VERSION,
    unit: requireString(input.unit ?? "P8.P1", "unit"),
    commit: requireString(input.commit ?? "unknown", "commit"),
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    environment: isPlainObject(input.environment) ? input.environment : {},
    hashes: isPlainObject(input.hashes) ? input.hashes : {},
    actors: Array.isArray(input.actors) ? input.actors : [],
    steps: Array.isArray(input.steps) ? input.steps : [],
    observations: Array.isArray(input.observations) ? input.observations : [],
    budgets: isPlainObject(input.budgets) ? input.budgets : {},
    repairs: Array.isArray(input.repairs) ? input.repairs : [],
    verdict: input.verdict ?? "open",
  };
}

export function validateEvidenceManifest(value) {
  if (!isPlainObject(value)) {
    throw new Error("Evidence manifest must be an object.");
  }
  if (value.schemaVersion !== REFORMATION_EVIDENCE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported evidence schema ${String(value.schemaVersion)}.`,
    );
  }
  const unit = requireString(value.unit, "unit");
  if (!REFORMATION_EVIDENCE_UNITS.includes(unit)) {
    throw new Error(`Unknown evidence unit ${unit}.`);
  }
  requireString(value.commit, "commit");
  requireString(value.recordedAt, "recordedAt");
  if (!isPlainObject(value.environment)) {
    throw new Error("environment must be an object.");
  }
  const forbiddenEnv = ["secret", "password", "token", "key"];
  for (const [name, entry] of Object.entries(value.environment)) {
    const lowered = name.toLowerCase();
    if (forbiddenEnv.some((needle) => lowered.includes(needle))) {
      throw new Error(`Evidence must not record secret field ${name}.`);
    }
    if (typeof entry === "string" && /sk-|wk-|secret_|password/i.test(entry)) {
      throw new Error(`Evidence must not record secret values in ${name}.`);
    }
  }
  if (!isPlainObject(value.hashes)) {
    throw new Error("hashes must be an object.");
  }
  requireArray(value.actors, "actors");
  for (const actor of value.actors) {
    if (!isPlainObject(actor) || !actor.id || !actor.role) {
      throw new Error("Each actor needs id and role.");
    }
  }
  requireArray(value.steps, "steps");
  for (const step of value.steps) {
    if (!isPlainObject(step) || !step.id) {
      throw new Error("Each step needs an id.");
    }
    requireString(step.attempted ?? "", "step.attempted");
    requireString(step.observed ?? "", "step.observed");
  }
  requireArray(value.observations, "observations");
  if (!isPlainObject(value.budgets)) {
    throw new Error("budgets must be an object.");
  }
  requireArray(value.repairs, "repairs");
  const verdict = requireString(value.verdict, "verdict");
  if (!REFORMATION_EVIDENCE_VERDICTS.includes(verdict)) {
    throw new Error(`Unknown verdict ${verdict}.`);
  }
  optionalString(value.notes);
  return value;
}

export function evidenceStep(input) {
  return {
    id: requireString(input.id, "step.id"),
    attempted: requireString(input.attempted, "step.attempted"),
    observed: requireString(input.observed, "step.observed"),
    believed: optionalString(input.believed),
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    status: input.status ?? "recorded",
  };
}
