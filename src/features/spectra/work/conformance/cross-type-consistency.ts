import { WORK_TYPE_KEYS, type ArtifactTypeKey } from "../../artifacts/types";
import {
  availableWorkModes,
  getWorkDefinition,
  workCapabilities,
} from "../registry/registry";

/**
 * Cross-work-type consistency (§11.10).
 *
 * The per-type conformance suite says each type honours the kernel. These
 * checks compare the types with each other: a mode label must mean the same
 * thing everywhere it appears, names cannot collide, and the shared reading
 * vocabulary (Read/Browse/Preview) must stay a viewing experience rather than
 * quietly becoming an editing one in one type.
 */

export type CrossTypeIssue = {
  check: string;
  workType?: ArtifactTypeKey;
  detail: string;
};

/**
 * Labels that intentionally carry two capabilities. "Preview" is the author
 * checking the quiz they are writing (edit) and the viewer watching a project
 * run (interact) — the word means "see what this will be like", and the
 * capability follows who is allowed to see that. Any split outside this list
 * is a defect to fix, not a precedent to copy.
 */
export const DOCUMENTED_LABEL_SPLITS: Readonly<Record<string, string>> =
  Object.freeze({});

/**
 * The label a person reads is a promise about the capability behind it. If
 * "Build" needs Edit on cards, it cannot be a viewing mode on quizzes.
 */
export function checkModeLabelConsistency(): readonly CrossTypeIssue[] {
  const byLabel = new Map<string, Map<ArtifactTypeKey, string>>();
  for (const type of WORK_TYPE_KEYS) {
    for (const mode of getWorkDefinition(type).modes) {
      const seen =
        byLabel.get(mode.label) ?? new Map<ArtifactTypeKey, string>();
      seen.set(type, mode.requiredCapability);
      byLabel.set(mode.label, seen);
    }
  }
  const issues: CrossTypeIssue[] = [];
  for (const [label, capabilities] of byLabel) {
    const distinct = new Set(capabilities.values());
    if (distinct.size > 1 && !(label in DOCUMENTED_LABEL_SPLITS)) {
      const detail = [...capabilities.entries()]
        .map(([type, capability]) => `${type} needs ${capability}`)
        .join("; ");
      issues.push({
        check: "mode_label_capability",
        detail: `"${label}" means different things: ${detail}`,
      });
    }
    // Distinguish a recorded split from an unchecked one: recorded splits must
    // stay exactly as documented, so the list cannot grow quietly.
    if (label in DOCUMENTED_LABEL_SPLITS && distinct.size === 1)
      issues.push({
        check: "mode_label_capability",
        detail: `"${label}" no longer splits; remove it from DOCUMENTED_LABEL_SPLITS`,
      });
  }
  return issues;
}

/**
 * Viewing words stay viewing words. The capability behind them may legitimately
 * be view or interact (selecting, filtering, following), never edit.
 */
export function checkReadingModesStayReading(): readonly CrossTypeIssue[] {
  const reading =
    /^(Read|Browse|Results|Releases|Preview as (?:reader|learner))$/i;
  const editing = /^(Edit|Write|Build|Source|Settings)$/i;
  const issues: CrossTypeIssue[] = [];
  for (const type of WORK_TYPE_KEYS) {
    for (const mode of getWorkDefinition(type).modes) {
      if (reading.test(mode.label) && mode.requiredCapability === "edit")
        issues.push({
          check: "reading_mode_edits",
          workType: type,
          detail: `"${mode.label}" is labelled as reading but requires edit`,
        });
      if (editing.test(mode.label) && mode.requiredCapability === "view")
        issues.push({
          check: "editing_mode_reads",
          workType: type,
          detail: `"${mode.label}" is labelled as making but requires only view`,
        });
    }
  }
  return issues;
}

/**
 * Every type's primary mode is the mode a person opens the work to do. Making
 * types (document, deck, quiz, plan, agent) lead with their making mode; the
 * rest lead with their type's defining mode.
 */
export function checkPrimaryModes(): readonly CrossTypeIssue[] {
  const making = new Set<ArtifactTypeKey>([
    "document",
    "flashcard_deck",
    "quiz",
    "planner_task",
    "agent",
    "code",
  ]);
  const issues: CrossTypeIssue[] = [];
  for (const type of WORK_TYPE_KEYS) {
    const definition = getWorkDefinition(type);
    const primary = definition.modes.find((mode) => mode.primary);
    if (!primary) {
      issues.push({
        check: "primary_mode",
        workType: type,
        detail: "no primary mode",
      });
      continue;
    }
    if (making.has(type) && primary.requiredCapability !== "edit")
      issues.push({
        check: "primary_mode",
        workType: type,
        detail: `a making type leads with "${primary.label}", which is not the making mode`,
      });
  }
  return issues;
}

/** Two types must not answer to the same user-facing name. */
export function checkUniqueUserFacingNames(): readonly CrossTypeIssue[] {
  const byName = new Map<string, ArtifactTypeKey[]>();
  for (const type of WORK_TYPE_KEYS) {
    const name = getWorkDefinition(type).userFacingName;
    byName.set(name, [...(byName.get(name) ?? []), type]);
  }
  return [...byName.entries()]
    .filter(([, types]) => types.length > 1)
    .map(([name, types]) => ({
      check: "shared_user_facing_name",
      detail: `"${name}" is used by ${types.join(" and ")}`,
    }));
}

/**
 * Every type keeps a usable read-only experience: a viewer can always view and
 * interact, and at least one mode stays open to them (INV-11).
 */
export function checkReadOnlyExperience(): readonly CrossTypeIssue[] {
  const issues: CrossTypeIssue[] = [];
  for (const type of WORK_TYPE_KEYS) {
    const readOnly = workCapabilities(type, "read_only");
    if (!readOnly.includes("view") || !readOnly.includes("interact"))
      issues.push({
        check: "read_only_experience",
        workType: type,
        detail: "read-only cannot both view and interact",
      });
    if (!availableWorkModes(type, "read_only").length)
      issues.push({
        check: "read_only_experience",
        workType: type,
        detail: "no mode remains open to a read-only viewer",
      });
  }
  return issues;
}

/**
 * Renderer dedication: each type's full editor is its own, and the panel and
 * tile renderers are intentional reductions of it rather than aliases.
 */
export function checkRendererDedication(): readonly CrossTypeIssue[] {
  const issues: CrossTypeIssue[] = [];
  const fullRenderers = new Map<string, ArtifactTypeKey>();
  for (const type of WORK_TYPE_KEYS) {
    const { surfaces } = getWorkDefinition(type);
    if (!surfaces.full) continue;
    const existing = fullRenderers.get(surfaces.full);
    if (existing)
      issues.push({
        check: "renderer_dedication",
        workType: type,
        detail: `shares its full renderer with ${existing} (${surfaces.full})`,
      });
    fullRenderers.set(surfaces.full, type);
    if (surfaces.panel === surfaces.full)
      issues.push({
        check: "renderer_dedication",
        workType: type,
        detail: "panel renderer is the full editor untouched",
      });
  }
  return issues;
}

export function runCrossTypeConsistency() {
  const issues = [
    ...checkModeLabelConsistency(),
    ...checkReadingModesStayReading(),
    ...checkPrimaryModes(),
    ...checkUniqueUserFacingNames(),
    ...checkReadOnlyExperience(),
    ...checkRendererDedication(),
  ];
  return { passed: issues.length === 0, issues };
}
