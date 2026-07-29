import type { ArtifactTypeKey } from "../artifacts/types";
import { ARTIFACT_TYPE_KEYS } from "../artifacts/types";
import type { SpectraCreationIntent } from "./creation-intent";

const BLUEPRINT_SET = new Set<string>(ARTIFACT_TYPE_KEYS);

function isBlueprintKey(value: unknown): value is ArtifactTypeKey {
  return typeof value === "string" && BLUEPRINT_SET.has(value);
}

function operationRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((operation) =>
    operation && typeof operation === "object" && !Array.isArray(operation)
      ? [operation as Record<string, unknown>]
      : [],
  );
}

function createBlueprintsFromOperations(
  operations: Array<Record<string, unknown>>,
): ArtifactTypeKey[] {
  return [
    ...new Set(
      operations.flatMap((operation) => {
        if (operation.type !== "artifact.create") return [];
        const input =
          operation.input &&
          typeof operation.input === "object" &&
          !Array.isArray(operation.input)
            ? (operation.input as Record<string, unknown>)
            : null;
        return input && isBlueprintKey(input.blueprintKey)
          ? [input.blueprintKey]
          : [];
      }),
    ),
  ];
}

/**
 * Prefer repairing empty/wrong create intent from the authored create ops
 * instead of rejecting a otherwise valid sheets/quiz/etc create.
 */
export function alignIntentWithCreates(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const plan = { ...(value as Record<string, unknown>) };
  if (plan.decision !== "operate") return plan;
  const operations = operationRows(plan.operations);
  const created = createBlueprintsFromOperations(operations);
  if (created.length === 0) return plan;
  const hasOtherMutations = operations.some(
    (operation) => operation.type !== "artifact.create",
  );
  const intent: Record<string, unknown> =
    plan.intent && typeof plan.intent === "object" && !Array.isArray(plan.intent)
      ? { ...(plan.intent as Record<string, unknown>) }
      : {
          mode: "create",
          requestedArtifactTypes: [],
          requestedVisibleArtifactCount: 0,
          targetArtifactId: null,
          targetWorkspaceId: null,
        };
  const priorTypes = Array.isArray(intent.requestedArtifactTypes)
    ? intent.requestedArtifactTypes.filter(isBlueprintKey)
    : [];
  const missingCreated = created.some((key) => !priorTypes.includes(key));
  const mode =
    typeof intent.mode === "string" ? intent.mode : hasOtherMutations ? "mixed" : "create";
  const modeNeedsCreate =
    mode !== "create" && mode !== "mixed";
  const visible =
    typeof intent.requestedVisibleArtifactCount === "number"
      ? intent.requestedVisibleArtifactCount
      : 0;
  if (!modeNeedsCreate && !missingCreated && priorTypes.length > 0 && visible > 0) {
    return plan;
  }
  intent.mode = hasOtherMutations ? "mixed" : "create";
  const alignedTypes = [
    ...new Set([...priorTypes, ...created]),
  ].slice(0, 5);
  intent.requestedArtifactTypes = alignedTypes;
  intent.requestedVisibleArtifactCount = Math.max(
    visible,
    created.length,
    alignedTypes.length > 0 ? 1 : 0,
  );
  if (!("targetArtifactId" in intent)) intent.targetArtifactId = null;
  if (!("targetWorkspaceId" in intent)) intent.targetWorkspaceId = null;
  // Prefer the destination already present on the create when intent omitted it.
  if (
    (intent.targetWorkspaceId == null || intent.targetWorkspaceId === "") &&
    operations[0]?.type === "artifact.create"
  ) {
    const input =
      operations[0].input &&
      typeof operations[0].input === "object" &&
      !Array.isArray(operations[0].input)
        ? (operations[0].input as Record<string, unknown>)
        : null;
    if (typeof input?.workspaceId === "string" && input.workspaceId.trim())
      intent.targetWorkspaceId = input.workspaceId;
  }
  plan.intent = intent;
  return plan;
}

export type PromoteCreateOptions = {
  requested: SpectraCreationIntent;
  workspaceId: string | null;
  titleFallback?: string;
};

/**
 * When a vague single-create request is authored as artifact.update against an
 * existing same-type object (common with workspace focus + existing sheets),
 * promote that content into a fresh artifact.create.
 */
export function promoteMatchingUpdateToCreate(
  value: unknown,
  options: PromoteCreateOptions,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const plan = { ...(value as Record<string, unknown>) };
  if (plan.decision !== "operate") return plan;
  const operations = operationRows(plan.operations);
  if (operations.some((operation) => operation.type === "artifact.create"))
    return plan;
  const matchingUpdates = operations.filter((operation) => {
    if (operation.type !== "artifact.update") return false;
    const input =
      operation.input &&
      typeof operation.input === "object" &&
      !Array.isArray(operation.input)
        ? (operation.input as Record<string, unknown>)
        : null;
    return (
      input &&
      input.blueprintKey === options.requested.blueprintKey &&
      input.content &&
      typeof input.content === "object" &&
      !Array.isArray(input.content)
    );
  });
  if (matchingUpdates.length !== 1) return plan;
  const update = matchingUpdates[0]!;
  const input = update.input as Record<string, unknown>;
  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title.trim()
      : (options.titleFallback ?? `New ${options.requested.label}`);
  const tags = Array.isArray(input.tags)
    ? input.tags
    : typeof input.tags === "string" && input.tags.trim()
      ? [input.tags.trim()]
      : [];
  const createOperation = {
    type: "artifact.create",
    input: {
      blueprintKey: options.requested.blueprintKey,
      title,
      summary:
        typeof input.summary === "string" || input.summary === null
          ? input.summary
          : null,
      content: input.content,
      tags,
      workspaceId: options.workspaceId,
      placement: options.workspaceId ? "context" : "inbox",
      pinned: false,
      exclusivePin: false,
    },
  };
  const remaining = operations.filter(
    (operation) => operation !== update,
  );
  plan.operations = [createOperation, ...remaining];
  plan.intent = {
    mode: remaining.some((operation) => operation.type !== "artifact.create")
      ? "mixed"
      : "create",
    requestedArtifactTypes: [options.requested.blueprintKey],
    requestedVisibleArtifactCount: 1,
    targetArtifactId: null,
    targetWorkspaceId: options.workspaceId,
  };
  return plan;
}

const FOCUSED_STRUCTURAL_REGION =
  /\b(?:column|cell|row|sheet|workbook|range|section|paragraph|heading|block|question|answer|card|hint|subtask|slide|event|validation|formula|table|speaker\s+notes?)\b/i;

/**
 * Structural edits of an already-open artifact ("add a validation column",
 * "rewrite section 2", "add a question after 4", "make slide 3 more concise").
 * These must never promote to artifact.create or trip single-creation
 * shorthand for a different blueprint.
 */
export function promptLooksLikeFocusedStructuralEdit(prompt: string) {
  const clean = prompt.trim();
  if (
    /\b(?:new|another|separate)\b/i.test(clean) &&
    /\b(?:create|make|build|generate|draft|write)\b/i.test(clean)
  )
    return false;
  if (!FOCUSED_STRUCTURAL_REGION.test(clean)) return false;
  if (
    /\b(?:rewrite|replace|edit|update|change|set|repair|fix|add|append|insert|remove|delete|flag)\b/i.test(
      clean,
    )
  )
    return true;
  // Soft rewrite phrasing still targets an open region: "make slide 3 more
  // concise", "shorten card 2", "tighten section 1 and keep the notes".
  return (
    /\b(?:make|shorten|tighten|trim|condense|clarify|simplify)\b/i.test(
      clean,
    ) &&
    /\b(?:more\s+)?(?:concise|shorter|brief|tighter|compact|simpler|clearer|clear)\b/i.test(
      clean,
    )
  );
}

/** True when the prompt is a create request rather than an edit of an open object. */
export function promptLooksLikeFreshCreate(prompt: string) {
  const clean = prompt.trim();
  if (promptLooksLikeFocusedStructuralEdit(clean)) return false;
  if (
    /\b(?:edit|update|revise|rewrite|rename|improve|change|set|fix|correct|replace)\b/i.test(
      clean,
    ) &&
    !/\b(?:new|another|separate|create|make|build|generate|draft|write)\b/i.test(
      clean,
    )
  )
    return false;
  return true;
}
