import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { badRequest, ok } from "@/lib/http";
import { MODEL_CONFIG } from "@/lib/model-config";
import { openRouterChatCompletion } from "@/lib/openrouter";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { recordOpenRouterUsage } from "@/lib/usage-tracking";

function fallbackPreview(params: {
  name?: string;
  systemPrompt: string;
  message: string;
}) {
  const opening = params.name?.trim() ? `${params.name} preview` : "Agent preview";
  const promptHint = params.systemPrompt.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 2).join(" ");
  return `${opening}: I can help with "${params.message.trim()}". ${
    promptHint ? `Configured focus: ${promptHint.slice(0, 180)}.` : "I will provide a clear, structured explanation."
  }`;
}

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json().catch(() => null)) as {
      name?: string;
      message?: string;
      systemPrompt?: string;
      guidelinesSummary?: string;
      topicMap?: string[];
    } | null;

    const message = body?.message?.trim() ?? "";
    const systemPrompt = body?.systemPrompt?.trim() ?? "";
    const topicMap = Array.isArray(body?.topicMap)
      ? body.topicMap.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 10)
      : [];

    if (!message) {
      return badRequest("Preview message is required.");
    }
    if (!systemPrompt || systemPrompt.length < 60) {
      return badRequest("System prompt is required before preview.");
    }

    if (!process.env.OPENROUTER_API_KEY) {
      return ok({
        reply: fallbackPreview({
          name: body?.name,
          systemPrompt,
          message,
        }),
        model: "fallback",
      });
    }

    const completion = await openRouterChatCompletion({
      model: MODEL_CONFIG.smartCheap,
      fallbackModels: [MODEL_CONFIG.tutorFast, MODEL_CONFIG.marker],
      temperature: 0.3,
      maxTokens: 480,
      messages: [
        {
          role: "system",
          content: [
            systemPrompt,
            body?.guidelinesSummary?.trim()
              ? `\nKnowledge summary:\n${body.guidelinesSummary.trim().slice(0, 700)}`
              : "",
            topicMap.length > 0 ? `\nTopic map: ${topicMap.join(", ")}` : "",
            "\nReturn a realistic first response to the user in no more than 170 words.",
          ].join("\n"),
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    await recordOpenRouterUsage({
      actorClerkId: actor.clerkId,
      model: completion.model ?? MODEL_CONFIG.smartCheap,
      usage: completion.usage,
    }).catch(() => {});

    const reply = completion.choices?.[0]?.message?.content?.trim();
    return ok({
      reply:
        reply && reply.length > 0
          ? reply
          : fallbackPreview({
            name: body?.name,
            systemPrompt,
            message,
          }),
      model: completion.model ?? MODEL_CONFIG.smartCheap,
    });
  });
}
