import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexQuery } from "@/lib/convex-server";
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
    if (!body.documentText) return badRequest("documentText is required");

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

    if (!Array.isArray(parsed.ops)) parsed.ops = [];
    parsed.ops = parsed.ops.filter(
      (op) =>
        op &&
        typeof op.type === "string" &&
        typeof op.from === "number" &&
        typeof op.to === "number",
    );

    return ok(parsed);
  });
}
