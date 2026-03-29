import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { ok, badRequest } from "@/lib/http";
import { getLiveCatalogSnapshot } from "@/lib/openrouter-catalog-cache";
import { pickModelAndFallbacks } from "@/lib/model-selection";
import { openRouterChatCompletion } from "@/lib/openrouter";
import { recordOpenRouterUsage } from "@/lib/usage-tracking";

export const runtime = "nodejs";

type DiffOp = {
  type: "replace" | "insert" | "delete";
  from: number;
  to: number;
  content?: string;
  reason: string;
};

type ArtifactContext = {
  _id: string;
  workstreamId?: string;
  title?: string;
};

type ArtifactThreadResult = {
  chatId: string;
  created: boolean;
};

type AppendedMessageResult = {
  messageId: string;
};

function normalizeDiffOps(input: unknown, documentLength: number): DiffOp[] {
  if (!Array.isArray(input)) return [];

  return input.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const op = value as Partial<DiffOp>;
    if (op.type !== "replace" && op.type !== "insert" && op.type !== "delete") return [];
    if (!Number.isFinite(op.from) || !Number.isFinite(op.to)) return [];
    const rawFrom = op.from as number;
    const rawTo = op.to as number;

    const from = Math.max(0, Math.min(documentLength, Math.trunc(rawFrom)));
    const to = Math.max(from, Math.min(documentLength, Math.trunc(rawTo)));

    return [{
      type: op.type,
      from,
      to,
      content: typeof op.content === "string" ? op.content : undefined,
      reason: typeof op.reason === "string" && op.reason.trim().length > 0 ? op.reason.trim() : "AI edit",
    }];
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();

    const body = (await request.json()) as {
      instruction: string;
      document: object;
      documentText: string;
      noteId?: string;
      artifactId?: string;
      autoAccept?: boolean;
    };

    if (!body.instruction?.trim()) return badRequest("instruction is required");
    if (typeof body.documentText !== "string") return badRequest("documentText is required");

    const targetArtifactId = body.artifactId?.trim()
      || (
        body.noteId?.trim()
          ? (
              (await convexQuery("artifacts:get", {
                actorClerkId: actor.clerkId,
                artifactId: body.noteId.trim(),
              }).catch(() => null) as ArtifactContext | null)?._id
              ?? (await convexMutation("artifacts:getOrMigrateFromNote", {
                actorClerkId: actor.clerkId,
                noteId: body.noteId.trim(),
              }).catch(() => null) as { artifactId?: string } | null)?.artifactId
            )
          : undefined
      );
    const artifactContext = targetArtifactId
      ? await convexQuery("artifacts:get", {
          actorClerkId: actor.clerkId,
          artifactId: targetArtifactId,
        }).catch(() => null) as ArtifactContext | null
      : null;

    const systemPrompt = `You are an AI document editor. Return ONLY a JSON object — no prose, no markdown.

The JSON must have:
- "ops": array of edit operations. Each op:
  - "type": "replace" | "insert" | "delete"
  - "from": character position start (integer, 0-indexed)
  - "to": character position end (integer)
  - "content": new text string (for replace/insert ops)
  - "reason": brief string explaining the change
- "summary": one sentence describing what changed

Rules:
- Be minimal — only change what the instruction asks for
- Preserve the author's voice and style
- Return valid JSON only`;

    const userPrompt = `Instruction: ${body.instruction}

Document:
"""
${body.documentText.slice(0, 8000)}
"""`;

    const [budget, dbCatalog] = await Promise.all([
      (convexQuery("usage:checkUserBudget", { actorClerkId: actor.clerkId }) as Promise<{
        tier: "normal" | "expensive_blocked" | "cheap_only" | "free_only";
      }>).catch(() => ({ tier: "normal" as const })),
      convexQuery("models:listModels", { actorClerkId: actor.clerkId }).catch(() => [] as Array<Record<string, unknown>>),
    ]);
    const liveCatalog = await getLiveCatalogSnapshot({
      fallbackCatalog: dbCatalog as Array<{
        modelId: string;
        name?: string;
        provider?: string;
        description?: string;
        contextLength?: number;
        inputCostPerM?: number;
        outputCostPerM?: number;
        tags?: string[];
        isFree?: boolean;
        costRating?: "low" | "medium" | "high";
        speedRating?: "low" | "medium" | "high";
        reasoningRating?: "low" | "medium" | "high";
        multimodalRating?: "none" | "basic" | "strong";
        capabilities?: {
          reasoning?: number;
          creative?: number;
          code?: number;
          vision?: number;
          speed?: number;
        };
      }>,
    });
    const catalog = liveCatalog.models.length > 0 ? liveCatalog.models : dbCatalog as Array<{
      modelId: string;
      name?: string;
      provider?: string;
      description?: string;
      contextLength?: number;
      inputCostPerM?: number;
      outputCostPerM?: number;
      tags?: string[];
      isFree?: boolean;
      costRating?: "low" | "medium" | "high";
      speedRating?: "low" | "medium" | "high";
      reasoningRating?: "low" | "medium" | "high";
      multimodalRating?: "none" | "basic" | "strong";
      capabilities?: {
        reasoning?: number;
        creative?: number;
        code?: number;
        vision?: number;
        speed?: number;
      };
    }>;
    const selection = pickModelAndFallbacks({
      catalog: catalog.filter((model) => model.modelId !== "openrouter/auto" && !model.modelId.includes(":online")),
      tier: budget.tier,
      requiredCapabilities: ["reasoning"],
      preferredCapabilities: ["reasoning"],
      preferCheap: true,
      preferFast: true,
      maxFallbacks: 3,
    });
    const model = selection.selected?.modelId ?? "openai/gpt-5-nano";
    const completion = await openRouterChatCompletion({
      model,
      fallbackModels: selection.fallbacks.filter((candidate) => candidate !== model),
      maxTokens: 2000,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });
    await recordOpenRouterUsage({
      actorClerkId: actor.clerkId,
      model: completion.model ?? model,
      usage: completion.usage,
    }).catch(() => {});

    const rawText = completion.choices?.[0]?.message?.content ?? "{}";

    let parsed: { ops: DiffOp[]; summary: string };
    try {
      parsed = JSON.parse(rawText) as { ops: DiffOp[]; summary: string };
    } catch {
      parsed = { ops: [], summary: "Edit applied" };
    }

    parsed.ops = normalizeDiffOps(parsed.ops, body.documentText.length);
    parsed.summary = typeof parsed.summary === "string" && parsed.summary.trim().length > 0
      ? parsed.summary.trim()
      : (parsed.ops.length > 0 ? "Applied AI edit suggestions." : "No document changes suggested.");

    let threadChatId: string | undefined;
    let assistantMessageId: string | undefined;

    if (targetArtifactId && artifactContext?._id) {
      const thread = await convexMutation("chats:getOrCreateArtifactThread", {
        actorClerkId: actor.clerkId,
        artifactId: targetArtifactId,
        workstreamId: typeof artifactContext.workstreamId === "string" ? artifactContext.workstreamId : undefined,
        mode: "document",
        thinkingLevel: "low",
        routerMode: "auto",
        usePersonalResources: true,
        title: typeof artifactContext.title === "string" ? `${artifactContext.title} edits` : "Artifact edits",
      }).catch(() => null) as ArtifactThreadResult | null;

      if (thread?.chatId) {
        threadChatId = thread.chatId;
        const userMessage = await convexMutation("chats:appendMessage", {
          actorClerkId: actor.clerkId,
          chatId: thread.chatId,
          role: "user",
          content: body.instruction.trim(),
          mode: "document",
          citations: [],
          routeTrace: {},
        }).catch(() => null) as AppendedMessageResult | null;

        const assistantMessage = await convexMutation("chats:appendMessage", {
          actorClerkId: actor.clerkId,
          chatId: thread.chatId,
          role: "assistant",
          content: parsed.summary || "Applied artifact edit suggestions.",
          mode: "document",
          citations: [],
          modelRequested: model,
          modelUsed: completion.model ?? model,
          whyThisResponse: "Artifact edit assistant",
          parentMessageId: userMessage?.messageId,
          routeTrace: {
            toolchain: ["artifact_edit"],
          },
        }).catch(() => null) as AppendedMessageResult | null;
        assistantMessageId = assistantMessage?.messageId;
      }
    }

    return ok({
      ...parsed,
      threadChatId,
      assistantMessageId,
    });
  });
}
