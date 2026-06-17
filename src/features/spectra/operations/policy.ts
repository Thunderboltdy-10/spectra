import type { OperationInput, SpectraOperationType } from "./schema";

const DIRECT_OPERATION_TYPES = new Set<SpectraOperationType>([
  "artifact.create",
  "artifact.update",
  "workspaceItem.add",
  "workspaceItem.hide",
  "thread.create",
  "resultCard.create",
  "resultCard.update",
  "plannerTask.create",
  "quiz.create",
  "flashcardDeck.create",
]);

const CONFIRMATION_OPERATION_TYPES = new Set<SpectraOperationType>([
  "workspace.create",
  "delete",
]);

export function operationRequiresConfirmation(operation: OperationInput) {
  if (CONFIRMATION_OPERATION_TYPES.has(operation.type)) return true;
  if (operation.bulkCount !== undefined && operation.bulkCount > 1) return true;
  if (operation.affected.length > 10) return true;
  return !DIRECT_OPERATION_TYPES.has(operation.type);
}

export function assertOperationAllowed(operation: OperationInput) {
  return {
    ...operation,
    requiresConfirmation: operationRequiresConfirmation(operation),
  };
}

