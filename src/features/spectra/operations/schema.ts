import { z } from "zod";

export const OPERATION_TYPES = [
  "artifact.create",
  "artifact.update",
  "workspace.create",
  "workspaceItem.add",
  "workspaceItem.hide",
  "thread.create",
  "resultCard.create",
  "resultCard.update",
  "plannerTask.create",
  "quiz.create",
  "flashcardDeck.create",
  "delete",
] as const;

export type SpectraOperationType = (typeof OPERATION_TYPES)[number];

export const operationInputSchema = z.object({
  type: z.enum(OPERATION_TYPES),
  input: z.unknown(),
  affected: z.array(z.object({
    type: z.string(),
    id: z.string(),
  })).default([]),
  bulkCount: z.number().int().nonnegative().optional(),
});

export type OperationInput = z.infer<typeof operationInputSchema>;

export function parseOperationInput(value: unknown) {
  return operationInputSchema.parse(value);
}

