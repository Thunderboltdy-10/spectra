import { z } from "zod";
import { runItemRecordSchema } from "@/features/spectra/actions/protocol/run-item";
import { SPECTRA_PROTOCOL_VERSIONS } from "@/features/spectra/migrations/protocol";

export const resultCardActionSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    targetType: z.enum(["artifact", "thread", "run", "workspace"]).optional(),
    targetId: z.string().optional(),
  })
  .strict();

export const resultCardStreamViewSchema = z
  .object({
    id: z.string(),
    runId: z.string(),
    status: z.enum([
      "queued",
      "running",
      "awaiting_confirmation",
      "awaiting_resolution",
      "completed",
      "failed",
      "cancelled",
    ]),
    title: z.string(),
    summary: z.string().optional(),
    variant: z.enum(["status", "artifact", "thread", "operation", "error"]),
    actions: z.array(resultCardActionSchema).default([]),
    provenance: z
      .object({
        artifactIds: z.array(z.string()).optional(),
        artifactTitles: z.array(z.string()).optional(),
        threadId: z.string().optional(),
        workspaceId: z.string().optional(),
        workspaceTitle: z.string().optional(),
        attachmentNames: z.array(z.string()).optional(),
        agentId: z.string().optional(),
        agentVersionId: z.string().optional(),
        agentTitle: z.string().optional(),
        agentRoutingReason: z.string().optional(),
        agentRoutingSource: z
          .enum(["automatic", "continued", "explicit"])
          .optional(),
      })
      .optional(),
    updatedAt: z.number(),
  })
  .strict();

const affectedSchema = z.object({ type: z.string(), id: z.string() }).strict();

export const harnessInputOptionSchema = z
  .object({ key: z.string(), label: z.string(), description: z.string().optional() })
  .strict();

/** A question or approval the run is waiting on, in plain words. */
export const harnessInputSchema = z
  .object({
    kind: z.enum(["question", "approval"]),
    toolCallId: z.string(),
    executionId: z.string(),
    question: z.string(),
    options: z.array(harnessInputOptionSchema).optional(),
    allowText: z.boolean().optional(),
    /** "Always allow sharing", when the user can store this choice. */
    alwaysAllowLabel: z.string().optional(),
  })
  .strict();

export const harnessArtifactTouchSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
    action: z.enum(["created", "edited", "referenced"]),
    change: z.string().optional(),
  })
  .strict();

export const spectraStreamEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("run_created"),
      runId: z.string(),
      card: resultCardStreamViewSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("thread_ready"),
      runId: z.string(),
      threadId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("text_delta"),
      runId: z.string(),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("text_replace"),
      runId: z.string(),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("status"),
      runId: z.string(),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("progress"),
      runId: z.string(),
      title: z.string(),
      detail: z.string().optional(),
      activity: z.enum([
        "plan",
        "retrieve",
        "inspect",
        "create",
        "edit",
        "verify",
        "approval",
        "other",
      ]),
      operationIndex: z.number().int().nonnegative().optional(),
      artifactType: z.string().optional(),
      regionHint: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("agent_routed"),
      runId: z.string(),
      agentId: z.string(),
      agentVersionId: z.string().optional(),
      title: z.string(),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
      source: z.enum(["automatic", "continued", "explicit"]),
      reversible: z.literal(true),
    })
    .strict(),
  z
    .object({
      type: z.literal("operation_preview"),
      runId: z.string(),
      operationId: z.string(),
      operationType: z.string(),
      preview: z
        .object({
          action: z.enum([
            "create",
            "update",
            "archive",
            "link",
            "place",
            "remove",
            "workspace",
          ]),
          title: z.string(),
          blueprintKey: z.string().optional(),
          targetId: z.string().optional(),
          pendingArtifactId: z.string().optional(),
        })
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("artifact_patch"),
      runId: z.string(),
      operationId: z.string(),
      artifactId: z.string(),
      patch: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal("stopped"),
      runId: z.string(),
      partial: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal("interrupted"), runId: z.string() }).strict(),
  z
    .object({ type: z.literal("approval_accepted"), runId: z.string() })
    .strict(),
  z
    .object({ type: z.literal("approval_rejected"), runId: z.string() })
    .strict(),
  z
    .object({
      type: z.literal("choice_selected"),
      runId: z.string(),
      choiceTitle: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("operation_commit"),
      runId: z.string(),
      operationId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("operation_result"),
      runId: z.string(),
      operationId: z.string(),
      affected: z.array(affectedSchema),
    })
    .strict(),
  z
    .object({
      type: z.literal("confirmation_required"),
      runId: z.string(),
      reasons: z.array(z.string()),
      card: resultCardStreamViewSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("result_card"),
      runId: z.string(),
      card: resultCardStreamViewSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("deferred_action"),
      runId: z.string(),
      executeAfter: z.literal("generation"),
      action: resultCardActionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("ui_event"),
      runId: z.string(),
      key: z.string(),
      payload: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("step"),
      runId: z.string(),
      id: z.string(),
      label: z.string(),
      status: z.enum(["running", "done", "error"]),
      durationMs: z.number().optional(),
      /** The artifact a running step works in. */
      work: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("caption"),
      runId: z.string(),
      text: z.string(),
      detail: z.string().optional(),
      final: z.boolean(),
      stepIds: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      type: z.literal("input_required"),
      runId: z.string(),
      input: harnessInputSchema,
      card: resultCardStreamViewSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("input_answered"),
      runId: z.string(),
      toolCallId: z.string(),
      /** One line: "Allowed", "Not allowed", or the chosen answer. */
      label: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("artifact_touched"),
      runId: z.string(),
      artifact: harnessArtifactTouchSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("todos"),
      runId: z.string(),
      todos: z.array(
        z.object({ content: z.string(), status: z.enum(["pending", "in_progress", "completed"]) }).strict(),
      ),
    })
    .strict(),
  z
    // What the run has read that its reply may cite, so far.
    .object({
      type: z.literal("sources"),
      runId: z.string(),
      sources: z.array(
        z.union([
          z.object({ id: z.string(), title: z.string(), workId: z.string() }).strict(),
          z.object({ id: z.string(), title: z.string(), url: z.string() }).strict(),
        ]),
      ).max(60),
    })
    .strict(),
  z
    .object({
      type: z.literal("widget"),
      runId: z.string(),
      id: z.string(),
      title: z.string(),
      html: z.string(),
    })
    .strict(),
  z
    .object({ type: z.literal("compacted"), runId: z.string() })
    .strict(),
  z
    // The message joined a working run; it reads it at its next turn.
    .object({ type: z.literal("steer_queued"), runId: z.string(), threadId: z.string().optional() })
    .strict(),
  z
    .object({ type: z.literal("thread_title"), runId: z.string(), title: z.string() })
    .strict(),
  z
    .object({
      type: z.literal("final"),
      runId: z.string(),
      summary: z.string(),
      card: resultCardStreamViewSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      runId: z.string().optional(),
      message: z.string(),
      /** A typed failure the UI acts on, e.g. AI_AGENT_UNAVAILABLE. */
      code: z.string().optional(),
      card: resultCardStreamViewSchema.optional(),
    })
    .strict(),
]);

export type ResultCardStreamView = z.infer<typeof resultCardStreamViewSchema>;
export type HarnessInputView = z.infer<typeof harnessInputSchema>;
export type HarnessArtifactTouchView = z.infer<typeof harnessArtifactTouchSchema>;
export type SpectraStreamEvent = z.infer<typeof spectraStreamEventSchema>;

export function parseSpectraStreamEvent(value: unknown) {
  const record = z.record(z.string(), z.unknown()).parse(value);
  const hasEnvelope = "protocolVersion" in record || "runItem" in record;
  if (!hasEnvelope) return spectraStreamEventSchema.parse(record);

  const envelope = z
    .object({
      protocolVersion: z.literal(SPECTRA_PROTOCOL_VERSIONS.runItems),
      runItem: runItemRecordSchema,
    })
    .passthrough()
    .parse(record);
  const {
    protocolVersion: _protocolVersion,
    runItem: _runItem,
    ...legacyEvent
  } = envelope;
  const event = spectraStreamEventSchema.parse(legacyEvent);
  if (
    "runId" in event &&
    event.runId &&
    event.runId !== envelope.runItem.runId
  ) {
    throw new Error("Run item envelope does not match the stream event run.");
  }
  return event;
}
