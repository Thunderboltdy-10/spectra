import type { RunSource } from "@/features/spectra/ai/harness/sources";
import { runLog } from "@/features/spectra/ai/run-log";
import type { Card, RunDetail } from "./contract";
import { mutate, query } from "./io";
import type {
  RunItem,
  RunItemPayload,
} from "@/features/spectra/actions/protocol";
import type { OpenRouterUsage } from "@/features/spectra/ai/openrouter-stream";
import { formatPlanApplicationPublicError } from "@/features/spectra/operations/plan-diagnostics";
import type { SpectraPlan } from "@/features/spectra/operations/schema";
import { ZodError } from "zod";

export function protocolItemForLegacyEvent(
  event: Record<string, unknown>,
): RunItemPayload {
  const type = String(event.type ?? "status");
  if (type === "text_delta")
    return {
      type: "text_delta",
      channel: "answer",
      text: String(event.content ?? event.delta ?? event.text ?? ""),
    };
  if (type === "progress" || type === "status")
    return {
      type: "progress",
      summary: String(event.title ?? event.message ?? "Working").slice(0, 240),
      ...(event.detail ? { detail: String(event.detail).slice(0, 1_000) } : {}),
    };
  if (type === "operation_preview")
    return { type: "action_start", action: event };
  if (type === "artifact_patch" || type === "text_replace")
    return { type: "patch", patch: event };
  if (type === "confirmation_required")
    return { type: "approval", request: event };
  if (type === "choice_required") return { type: "question", request: event };
  if (type === "input_required")
    return {
      type: (event.input as { kind?: string } | undefined)?.kind === "approval" ? "approval" : "question",
      request: event,
    };
  if (type === "reasoning_delta") return { type: "progress", summary: "Thinking" };
  if (type === "waiting" || type === "interrupted")
    return { type: "wait", reason: event };
  if (type === "final") return { type: "final", result: event };
  if (type === "error") return { type: "error", error: event };
  return {
    type: "progress",
    summary:
      String(event.message ?? event.title ?? type.replaceAll("_", " ")).slice(
        0,
        240,
      ) || "Working",
  };
}

type QueuedRunEvent = { type: string; payload: Record<string, unknown> };
const MAX_COALESCED_DELTA = 16_000;

/** A streamed answer arrives as many small deltas. Consecutive ones share one
 * durable event row, so a long answer does not write hundreds of rows. */
export function coalesceTextDeltas(events: readonly QueuedRunEvent[]) {
  const merged: QueuedRunEvent[] = [];
  for (const event of events) {
    const previous = merged.at(-1);
    const content = `${String(previous?.payload.content ?? "")}${String(event.payload.content ?? "")}`;
    const continues =
      previous?.type === event.type &&
      (event.type === "text_delta" || (event.type === "reasoning_delta" && previous.payload.id === event.payload.id));
    if (!continues || content.length > MAX_COALESCED_DELTA) {
      merged.push(event);
      continue;
    }
    const runItem = previous.payload.runItem as Record<string, unknown> | undefined;
    merged[merged.length - 1] = {
      type: event.type,
      payload: {
        ...previous.payload,
        content,
        ...(event.payload.done ? { done: true } : {}),
        ...(runItem && event.type === "text_delta" ? { runItem: { ...runItem, text: content } } : {}),
      },
    };
  }
  return merged;
}

export function legacyEventForRunItem(
  item: RunItem,
  compatibility: Record<string, unknown>,
) {
  return {
    ...compatibility,
    protocolVersion: item.protocolVersion,
    runItem: item,
  };
}

export function streamCard(card: Card) {
  return {
    id: card._id,
    runId: card.runId,
    status: card.status,
    title: card.title,
    summary: card.summary,
    variant: card.variant,
    actions: card.actions,
    provenance: card.provenance,
    updatedAt: card.updatedAt,
  };
}

export function publicError(error: unknown, options?: { explanationOnly?: boolean }) {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const path = issue?.path.join(".") ?? "";
    const code = issue?.code ?? "invalid";
    runLog().error("spectra.plan.validation", error, {
      path,
      code,
      issues: error.issues.slice(0, 8).map((entry) => ({
        path: entry.path.join("."),
        code: entry.code,
        message: entry.message,
      })),
    });
  } else if (error instanceof Error) {
    runLog().error("spectra.plan.application", error, {
      stack: error.stack?.split("\n").slice(0, 6),
    });
  } else {
    runLog().error("spectra.plan.application", new Error(String(error).slice(0, 400)));
  }
  return formatPlanApplicationPublicError(error, options);
}

export async function latestCard(actorClerkId: string, runId: string) {
  const value = await query<{ actorClerkId: string; runId: string }, RunDetail>(
    "spectraRuns:get",
    { actorClerkId, runId },
  );
  const card = value.cards[0];
  if (!card) throw new Error("Result card not found");
  return card;
}

export async function saveAssistantMessage(params: {
  actorClerkId: string;
  threadId?: string;
  runId: string;
  executionId?: string;
  content: string;
  decision?: SpectraPlan["decision"];
  affected?: Array<{ type: string; id: string }>;
  awaitingConfirmation?: boolean;
  model?: string;
  provider?: string;
  usage?: OpenRouterUsage;
  choices?: SpectraPlan["choices"];
  /** The work this run created, edited or referenced: one card each. */
  artifacts?: Array<{ id: string; type: string; title: string; action: string; change?: string; region?: string }>;
  /** Widgets the run showed, so the saved reply shows them again. */
  widgets?: Array<{ id: string; title: string; html: string }>;
  /** The sources the reply cites, so its citations open them. */
  sources?: RunSource[];
  /** Active time: the working stretches, without waits for the person. */
  workedMs?: number;
  /** The runtime the run moved to and finished with, when it moved. */
  finishedWith?: string;
}) {
  if (!params.threadId || !params.content.trim()) return;
  await mutate("spectraThreads:appendMessage", {
    actorClerkId: params.actorClerkId,
    threadId: params.threadId,
    role: "assistant",
    content: params.content,
    runId: params.runId,
    executionId: params.executionId,
    metadata: {
      decision: params.decision,
      hasOperationalTrace: true,
      awaitingConfirmation: params.awaitingConfirmation === true,
      affected: params.affected ?? [],
      model: params.model,
      provider: params.provider,
      usage: params.usage,
      choices: params.choices ?? null,
      ...(params.artifacts?.length ? { artifacts: params.artifacts } : {}),
      ...(params.widgets?.length ? { widgets: params.widgets } : {}),
      ...(params.sources?.length ? { sources: params.sources } : {}),
      ...(params.workedMs !== undefined ? { workedMs: Math.round(params.workedMs) } : {}),
      ...(params.finishedWith ? { finishedWith: params.finishedWith } : {}),
    },
  });
}
