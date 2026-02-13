import { openRouterChatCompletion } from "@/lib/openrouter";
import { ROUTER_FALLBACKS } from "@/lib/model-config";

export async function runVisionPrepass(params: {
  imageContentBlocks: Array<{ type: "image_url"; image_url: { url: string; detail?: "low" | "auto" } }>;
  userMessage: string;
  model: string;
}): Promise<string> {
  if (params.imageContentBlocks.length === 0) return "";

  const completion = await openRouterChatCompletion({
    model: params.model,
    fallbackModels: ROUTER_FALLBACKS[params.model] ?? [],
    messages: [
      {
        role: "system",
        content:
          "Describe these images in detail, focusing on educational content, diagrams, equations, charts, and visible text. Keep output factual and concise.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: params.userMessage },
          ...params.imageContentBlocks,
        ],
      },
    ],
    temperature: 0.1,
  });

  return completion.choices?.[0]?.message?.content?.trim() ?? "";
}
