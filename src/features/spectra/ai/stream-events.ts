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
  provenance: z.object({
    artifactIds: z.array(z.string()).optional(),
    artifactTitles: z.array(z.string()).optional(),
    threadId: z.string().optional(),
    workspaceId: z.string().optional(),
    workspaceTitle: z.string().optional(),
    attachmentNames: z.array(z.string()).optional(),
    focusMode: z.enum(["global", "workspace", "artifact", "selection", "thread"]).optional(),
  }).optional(),
  updatedAt: z.number(),
}).strict();

const affectedSchema = z.object({ type: z.string(), id: z.string() }).strict();

export const spectraStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run_created"), runId: z.string(), card: resultCardStreamViewSchema }).strict(),
  z.object({ type: z.literal("thread_ready"), runId: z.string(), threadId: z.string() }).strict(),
  z.object({ type: z.literal("text_delta"), runId: z.string(), content: z.string() }).strict(),
  z.object({ type: z.literal("status"), runId: z.string(), message: z.string() }).strict(),
  z.object({ type: z.literal("operation_preview"), runId: z.string(), operationId: z.string(), operationType: z.string(), preview: z.object({ action: z.enum(["create", "update", "link", "place", "remove", "workspace"]), title: z.string(), blueprintKey: z.string().optional(), targetId: z.string().optional() }).optional() }).strict(),
  z.object({ type: z.literal("operation_commit"), runId: z.string(), operationId: z.string() }).strict(),
  z.object({ type: z.literal("operation_result"), runId: z.string(), operationId: z.string(), affected: z.array(affectedSchema) }).strict(),
  z.object({ type: z.literal("confirmation_required"), runId: z.string(), reasons: z.array(z.string()), card: resultCardStreamViewSchema }).strict(),
  z.object({ type: z.literal("result_card"), runId: z.string(), card: resultCardStreamViewSchema }).strict(),
  z.object({ type: z.literal("deferred_action"), runId: z.string(), executeAfter: z.literal("generation"), action: resultCardActionSchema }).strict(),
  z.object({ type: z.literal("ui_event"), runId: z.string(), key: z.string(), payload: z.record(z.string(), z.unknown()).optional() }).strict(),
  z.object({ type: z.literal("final"), runId: z.string(), summary: z.string(), card: resultCardStreamViewSchema }).strict(),
  z.object({ type: z.literal("error"), runId: z.string().optional(), message: z.string(), card: resultCardStreamViewSchema.optional() }).strict(),
]);

export type ResultCardStreamView = z.infer<typeof resultCardStreamViewSchema>;
export type SpectraStreamEvent = z.infer<typeof spectraStreamEventSchema>;

export function parseSpectraStreamEvent(value: unknown) {
  return spectraStreamEventSchema.parse(value);
}
