import type { ModelOperation, OperationInput, RequestIntent, SpectraOperationType } from "./schema";

const DIRECT_OPERATION_TYPES = new Set<SpectraOperationType>([
  "artifact.create", "artifact.update", "workspaceItem.add", "workspaceItem.hide", "workspaceItem.setPinned", "thread.create",
  "workspace.update", "artifact.link",
  "resultCard.create", "resultCard.update", "plannerTask.create", "quiz.create", "flashcardDeck.create",
]);

const CONFIRMATION_OPERATION_TYPES = new Set<SpectraOperationType>(["workspace.create", "artifact.archive", "delete"]);

// Review thresholds are not execution ceilings. Broad work pauses for one
// durable confirmation, then continues under the same lease/checkpoint model.
export const REVIEW_OPERATIONS_THRESHOLD = 64;
export const REVIEW_ARTIFACTS_THRESHOLD = 32;
export const DIRECT_MUTATION_LIMIT = 3;

export function operationRequiresConfirmation(operation: OperationInput) {
  if (CONFIRMATION_OPERATION_TYPES.has(operation.type)) return true;
  if (operation.bulkCount !== undefined && operation.bulkCount > 1 && operation.type !== "flashcardDeck.create" && operation.type !== "quiz.create") return true;
  if (operation.affected.length > 10) return true;
  return !DIRECT_OPERATION_TYPES.has(operation.type);
}

export function assertOperationAllowed(operation: OperationInput) {
  return { ...operation, requiresConfirmation: operationRequiresConfirmation(operation) };
}

export type PlanPolicy = {
  requiresConfirmation: boolean;
  reasons: string[];
  visibleObjectCreations: number;
};

export function evaluatePlanPolicy(operations: ModelOperation[], options?: { intent?: RequestIntent }): PlanPolicy {
  const artifactCreates = operations.filter((operation) => operation.type === "artifact.create").length;

  const reasons: string[] = [];
  if (operations.some((operation) => operation.type === "workspace.create")) reasons.push("Create a new workspace");
  if (operations.some((operation) => operation.type === "artifact.archive")) reasons.push("Archive the selected artifact");
  if (artifactCreates > 1) reasons.push(`Create ${artifactCreates} visible artifacts`);
  if (operations.length > DIRECT_MUTATION_LIMIT) reasons.push(`Apply ${operations.length} changes`);
  if (operations.length > REVIEW_OPERATIONS_THRESHOLD) reasons.push(`Review this ${operations.length}-step run before it begins`);
  if (artifactCreates > REVIEW_ARTIFACTS_THRESHOLD) reasons.push(`Review creation of ${artifactCreates} visible artifacts`);
  const placementChanges = operations.filter((operation) => operation.type === "workspaceItem.add" || operation.type === "workspaceItem.hide").length;
  if (placementChanges > 1) reasons.push(`Change ${placementChanges} workspace placements`);

  // Cards and quiz questions are content inside one artifact and never increase this count.
  if (options?.intent && options.intent.requestedVisibleArtifactCount > REVIEW_ARTIFACTS_THRESHOLD) {
    reasons.push(`The request covers ${options.intent.requestedVisibleArtifactCount} visible artifacts`);
  }

  return { requiresConfirmation: reasons.length > 0, reasons, visibleObjectCreations: artifactCreates };
}
