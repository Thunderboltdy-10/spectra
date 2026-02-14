import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { MODEL_CONFIG } from "@/lib/model-config";
import { openRouterChatCompletion } from "@/lib/openrouter";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();
    const body = (await request.json().catch(() => null)) as { description?: string } | null;
    const description = body?.description?.trim();
    if (!description) {
      return badRequest("description is required");
    }

    const completion = await openRouterChatCompletion({
      model: MODEL_CONFIG.tutorFast,
      fallbackModels: [MODEL_CONFIG.marker],
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "Return strict JSON with keys: name, avatarEmoji, systemPrompt, category, preferredModel, preferredMode, guidelinesSummary, suggestedTools(string[]). Keep response concise and safe for school use.",
        },
        { role: "user", content: description },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");

    return ok({
      name: typeof parsed.name === "string" ? parsed.name : "Custom Tutor",
      avatarEmoji: typeof parsed.avatarEmoji === "string" ? parsed.avatarEmoji : "🎓",
      systemPrompt:
        typeof parsed.systemPrompt === "string"
          ? parsed.systemPrompt
          : "You are a supportive school tutor. Explain clearly, step by step.",
      category: typeof parsed.category === "string" ? parsed.category : "General",
      preferredModel: typeof parsed.preferredModel === "string" ? parsed.preferredModel : undefined,
      preferredMode: typeof parsed.preferredMode === "string" ? parsed.preferredMode : "tutor",
      guidelinesSummary:
        typeof parsed.guidelinesSummary === "string"
          ? parsed.guidelinesSummary
          : "Support learning with concise guidance and practice checks.",
      suggestedTools: Array.isArray(parsed.suggestedTools)
        ? parsed.suggestedTools.filter((item: unknown) => typeof item === "string").slice(0, 8)
        : ["rag", "web_search"],
    });
  });
}
