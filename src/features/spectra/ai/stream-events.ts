import { z } from "zod";

export const resultCardActionSchema = z.object({
  key: z.string(),
  label: z.string(),
  targetType: z.enum(["artifact", "thread", "run", "workspace"]).optional(),
  targetId: z.string().optional(),
}).strict();

export const resultCardStreamViewSchema = z.object({
  id: z.string(),
  runId: z.string(),
  status: z.enum(["queued", "running", "awaiting_confirmation", "completed", "failed", "cancelled"]),
  title: z.string(),
  summary: z.string().optional(),
  variant: z.enum(["status", "artifact", "thread", "operation", "error"]),
  actions: z.array(resultCardActionSchema).default([]),
  updatedAt: z.number(),
}).strict();

const affectedSchema = z.object({ type: z.string(), id: z.string() }).strict();

export const spectraStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run_created"), runId: z.string(), card: resultCardStreamViewSchema }).strict(),
  z.object({ type: z.literal("status"), runId: z.string(), message: z.string() }).strict(),
  z.object({ type: z.literal("operation_preview"), runId: z.string(), operationId: z.string(), operationType: z.string() }).strict(),
  z.object({ type: z.literal("operation_commit"), runId: z.string(), operationId: z.string() }).strict(),
  z.object({ type: z.literal("operation_result"), runId: z.string(), operationId: z.string(), affected: z.array(affectedSchema) }).strict(),
  z.object({ type: z.literal("confirmation_required"), runId: z.string(), reasons: z.array(z.string()), card: resultCardStreamViewSchema }).strict(),
  z.object({ type: z.literal("result_card"), runId: z.string(), card: resultCardStreamViewSchema }).strict(),
  z.object({ type: z.literal("final"), runId: z.string(), summary: z.string(), card: resultCardStreamViewSchema }).strict(),
  z.object({ type: z.literal("error"), runId: z.string().optional(), message: z.string(), card: resultCardStreamViewSchema.optional() }).strict(),
]);

export type ResultCardStreamView = z.infer<typeof resultCardStreamViewSchema>;
export type SpectraStreamEvent = z.infer<typeof spectraStreamEventSchema>;

export function parseSpectraStreamEvent(value: unknown) {
  return spectraStreamEventSchema.parse(value);
}
