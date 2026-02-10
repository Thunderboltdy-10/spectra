import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { ok } from "@/lib/http";
import { MODEL_CONFIG } from "@/lib/model-config";
import { openRouterChatCompletion } from "@/lib/openrouter";
import { withRouteErrorHandling } from "@/lib/route-handler";

function fallbackPrompt(params: { name?: string; description?: string; category?: string }) {
  return `You are ${params.name || "a classroom assistant"}.
Role category: ${params.category || "Study Helper"}.

Core behavior:
- Start by identifying the student's goal and constraints.
- Use step-by-step teaching and ask one check question after key points.
- Keep language age-appropriate and academically accurate.
- For homework, prefer guided hints before final answers.
- When unsure, say what additional context is needed.

Formatting:
- Use short sections with headings.
- Include examples where useful.
- End with one next action item.

Context from creator:
${params.description || "No extra description provided."}`;
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    await requireActor();

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      category?: string;
    };

    if (!process.env.OPENROUTER_API_KEY) {
      return ok({ prompt: fallbackPrompt(body) });
    }

    const completion = await openRouterChatCompletion({
      model: MODEL_CONFIG.tutorFast,
      fallbackModels: [MODEL_CONFIG.multimodal],
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "Generate a high-quality system prompt for a school AI agent. Return only prompt text. Include behavior guardrails, teaching style, format expectations, and boundaries.",
        },
        {
          role: "user",
          content: JSON.stringify({
            name: body.name,
            description: body.description,
            category: body.category,
          }),
        },
      ],
    });

    const prompt = completion.choices?.[0]?.message?.content?.trim();
    return ok({ prompt: prompt || fallbackPrompt(body) });
  });
}
