import type { ModelOperation, OperationInput, RequestIntent, SpectraOperationType } from "./schema";

const DIRECT_OPERATION_TYPES = new Set<SpectraOperationType>([
  "artifact.create", "artifact.update", "workspaceItem.add", "workspaceItem.hide", "thread.create",
  "workspace.update", "artifact.link",
  "resultCard.create", "resultCard.update", "plannerTask.create", "quiz.create", "flashcardDeck.create",
]);

const CONFIRMATION_OPERATION_TYPES = new Set<SpectraOperationType>(["workspace.create", "delete"]);

export const MAX_OPERATIONS_PER_RUN = 8;
export const MAX_ARTIFACTS_PER_RUN = 5;
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
  if (operations.length > MAX_OPERATIONS_PER_RUN) throw new Error(`A run may contain at most ${MAX_OPERATIONS_PER_RUN} operations.`);
  const artifactCreates = operations.filter((operation) => operation.type === "artifact.create").length;
  if (artifactCreates > MAX_ARTIFACTS_PER_RUN) throw new Error(`A run may create at most ${MAX_ARTIFACTS_PER_RUN} artifacts.`);

  const reasons: string[] = [];
  if (operations.some((operation) => operation.type === "workspace.create")) reasons.push("Create a new workspace");
  if (artifactCreates > 1) reasons.push(`Create ${artifactCreates} visible artifacts`);
  if (operations.length > DIRECT_MUTATION_LIMIT) reasons.push(`Apply ${operations.length} changes`);
  const placementChanges = operations.filter((operation) => operation.type === "workspaceItem.add" || operation.type === "workspaceItem.hide").length;
  if (placementChanges > 1) reasons.push(`Change ${placementChanges} workspace placements`);

  // Cards and quiz questions are content inside one artifact and never increase this count.
  if (options?.intent && options.intent.requestedVisibleArtifactCount > MAX_ARTIFACTS_PER_RUN) {
    reasons.push(`The request covers ${options.intent.requestedVisibleArtifactCount} visible artifacts; propose a smaller batch first`);
  }

  return { requiresConfirmation: reasons.length > 0, reasons, visibleObjectCreations: artifactCreates };
}
