import { z } from "zod";
import { SPECTRA_PROTOCOL_VERSIONS } from "../../migrations/protocol";

const identifier = z.string().trim().min(1).max(200);
const boundedText = z.string().max(32_000);
const jsonRecord = z.record(z.string(), z.unknown());

export const runItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("title"),
    text: z.string().min(1).max(120),
    final: z.boolean(),
  }),
  z.object({
    type: z.literal("progress"),
    summary: z.string().min(1).max(240),
    detail: z.string().max(1_000).optional(),
  }),
  z.object({
    type: z.literal("text_delta"),
    channel: z.enum(["answer", "narration"]),
    text: boundedText,
  }),
  z.object({ type: z.literal("tool_start"), call: jsonRecord }),
  z.object({
    type: z.literal("tool_progress"),
    callId: identifier,
    progress: jsonRecord,
  }),
  z.object({
    type: z.literal("tool_result"),
    callId: identifier,
    result: jsonRecord,
  }),
  z.object({ type: z.literal("action_start"), action: jsonRecord }),
  z.object({
    type: z.literal("action_progress"),
    actionId: identifier,
    step: jsonRecord,
  }),
  z.object({ type: z.literal("patch"), patch: jsonRecord }),
  z.object({ type: z.literal("wait"), reason: jsonRecord }),
  z.object({ type: z.literal("question"), request: jsonRecord }),
  z.object({ type: z.literal("approval"), request: jsonRecord }),
  z.object({ type: z.literal("steer_queued"), steer: jsonRecord }),
  z.object({ type: z.literal("checkpoint"), checkpoint: jsonRecord }),
  z.object({ type: z.literal("final"), result: jsonRecord }),
  z.object({ type: z.literal("degraded"), state: jsonRecord }),
  z.object({ type: z.literal("error"), error: jsonRecord }),
]);

export type RunItemPayload = z.infer<typeof runItemSchema>;
export const runItemRecordSchema = z.intersection(
  runItemSchema,
  z.object({
    protocolVersion: z.literal(SPECTRA_PROTOCOL_VERSIONS.runItems),
    runId: identifier,
    sequence: z.number().int().nonnegative(),
    createdAt: z.number(),
  }),
);

export type RunItem = z.infer<typeof runItemRecordSchema>;

export function createRunItem(
  runId: string,
  sequence: number,
  payload: RunItemPayload,
  createdAt = Date.now(),
): RunItem {
  return runItemRecordSchema.parse({
    ...runItemSchema.parse(payload),
    protocolVersion: SPECTRA_PROTOCOL_VERSIONS.runItems,
    runId: identifier.parse(runId),
    sequence,
    createdAt,
  });
}

export function isTerminalRunItem(item: RunItemPayload) {
  return item.type === "final" || item.type === "error";
}

export function isRecoverableRunItem(item: RunItemPayload) {
  return (
    item.type === "wait" ||
    item.type === "question" ||
    item.type === "approval" ||
    item.type === "degraded"
  );
}
