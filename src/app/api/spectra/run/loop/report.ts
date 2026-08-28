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
      text: String(event.delta ?? event.text ?? ""),
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

export function publicError(error: unknown) {
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const path = issue?.path.join(".") ?? "";
    const code = issue?.code ?? "invalid";
    console.error(
      `[spectra.plan.validation] ${JSON.stringify({
        path,
        code,
        message: issue?.message,
        issues: error.issues.slice(0, 8).map((entry) => ({
          path: entry.path.join("."),
          code: entry.code,
          message: entry.message,
        })),
      })}`,
    );
  } else if (error instanceof Error) {
    console.error(
      `[spectra.plan.application] ${JSON.stringify({
        name: error.name,
        message: error.message.slice(0, 800),
        stack: error.stack?.split("\n").slice(0, 6),
      })}`,
    );
  } else {
    console.error(
      `[spectra.plan.application] ${JSON.stringify({ error: String(error).slice(0, 400) })}`,
    );
  }
  return formatPlanApplicationPublicError(error);
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
    },
  });
}
