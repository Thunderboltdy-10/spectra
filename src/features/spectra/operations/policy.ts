import type {
  ModelOperation,
  OperationInput,
  RequestIntent,
  SpectraOperationType,
} from "./schema";

const DIRECT_OPERATION_TYPES = new Set<SpectraOperationType>([
  "artifact.create",
  "artifact.update",
  "workspaceItem.add",
  "workspaceItem.hide",
  "workspaceItem.setPinned",
  "thread.create",
  "workspace.update",
  "artifact.link",
  "resultCard.create",
  "resultCard.update",
  "plannerTask.create",
  "quiz.create",
  "flashcardDeck.create",
]);

const CONFIRMATION_OPERATION_TYPES = new Set<SpectraOperationType>([
  "workspace.create",
  "artifact.archive",
  "delete",
]);

// Review thresholds are not execution ceilings. Broad work pauses for one
// durable confirmation, then continues under the same lease/checkpoint model.
export const REVIEW_OPERATIONS_THRESHOLD = 64;
export const REVIEW_ARTIFACTS_THRESHOLD = 32;
export const DIRECT_MUTATION_LIMIT = 3;

export function operationRequiresConfirmation(operation: OperationInput) {
  if (CONFIRMATION_OPERATION_TYPES.has(operation.type)) return true;
  if (
    operation.bulkCount !== undefined &&
    operation.bulkCount > 1 &&
    operation.type !== "flashcardDeck.create" &&
    operation.type !== "quiz.create"
  )
    return true;
  if (operation.affected.length > 10) return true;
  return !DIRECT_OPERATION_TYPES.has(operation.type);
}

export function assertOperationAllowed(operation: OperationInput) {
  return {
    ...operation,
    requiresConfirmation: operationRequiresConfirmation(operation),
  };
}

export type PlanPolicy = {
  requiresConfirmation: boolean;
  reasons: string[];
  visibleObjectCreations: number;
};

export function evaluatePlanPolicy(
  operations: ModelOperation[],
  options?: { intent?: RequestIntent },
): PlanPolicy {
  const artifactCreates = operations.filter(
    (operation) => operation.type === "artifact.create",
  ).length;

  const reasons: string[] = [];
  if (operations.some((operation) => operation.type === "workspace.create"))
    reasons.push("Create a new workspace");
  if (operations.some((operation) => operation.type === "artifact.archive"))
    reasons.push("Archive the selected artifact");
  if (artifactCreates > 1)
    reasons.push(`Create ${artifactCreates} visible artifacts`);
  if (operations.length > DIRECT_MUTATION_LIMIT)
    reasons.push(`Apply ${operations.length} changes`);
  if (operations.length > REVIEW_OPERATIONS_THRESHOLD)
    reasons.push(`Review this ${operations.length}-step run before it begins`);
  if (artifactCreates > REVIEW_ARTIFACTS_THRESHOLD)
    reasons.push(`Review creation of ${artifactCreates} visible artifacts`);
  const placementChanges = operations.filter(
    (operation) =>
      operation.type === "workspaceItem.add" ||
      operation.type === "workspaceItem.hide",
  ).length;
  if (placementChanges > 1)
    reasons.push(`Change ${placementChanges} workspace placements`);

  for (const operation of operations) {
    let content: Record<string, unknown> | null = null;
    let patchPaths: string[] = [];
    let replacesLiveCode = false;
    if (operation.type === "artifact.create") {
      if (operation.input.blueprintKey !== "code") continue;
      content = operation.input.content as unknown as Record<string, unknown>;
    } else if (operation.type === "artifact.update") {
      if (operation.input.blueprintKey !== "code") continue;
      const nextContent = operation.input.content;
      content =
        nextContent &&
        typeof nextContent === "object" &&
        !Array.isArray(nextContent)
          ? (nextContent as unknown as Record<string, unknown>)
          : null;
      patchPaths = (operation.input.contentPatch?.changes ?? []).map(
        (change: { path: string }) => change.path,
      );
      replacesLiveCode = Boolean(content);
    } else {
      continue;
    }
    if (replacesLiveCode) {
      reasons.push(
        "Review a broad Code rewrite before replacing the live file tree",
      );
    }
    if (
      patchPaths.some(
        (path) => path === "/files" || /^\/files\/\d+$/.test(path),
      )
    ) {
      reasons.push("Review structural Code file changes");
    }
    const bindings =
      content && Array.isArray(content.resourceBindings)
        ? content.resourceBindings
        : [];
    if (
      bindings.length ||
      patchPaths.some((path) => path.startsWith("/resourceBindings"))
    ) {
      reasons.push("Approve new or changed permissioned runtime resources");
    }
    const network =
      content?.networkPolicy &&
      typeof content.networkPolicy === "object" &&
      !Array.isArray(content.networkPolicy)
        ? (content.networkPolicy as Record<string, unknown>)
        : null;
    if (
      network?.mode === "allowlist" ||
      patchPaths.some((path) => path.startsWith("/networkPolicy"))
    ) {
      reasons.push("Approve a Code network-policy change");
    }
    if (
      (content?.dependencies && typeof content.dependencies === "object") ||
      patchPaths.some((path) => path.startsWith("/dependencies"))
    ) {
      reasons.push("Review Code dependency changes");
    }
    if (
      (content && Array.isArray(content.assets) && content.assets.length > 0) ||
      patchPaths.some((path) => path.startsWith("/assets"))
    ) {
      reasons.push("Review immutable Code asset reference changes");
    }
  }

  // Cards and quiz questions are content inside one artifact and never increase this count.
  if (
    options?.intent &&
    options.intent.requestedVisibleArtifactCount > REVIEW_ARTIFACTS_THRESHOLD
  ) {
    reasons.push(
      `The request covers ${options.intent.requestedVisibleArtifactCount} visible artifacts`,
    );
  }

  const uniqueReasons = [...new Set(reasons)];
  return {
    requiresConfirmation: uniqueReasons.length > 0,
    reasons: uniqueReasons,
    visibleObjectCreations: artifactCreates,
  };
}
