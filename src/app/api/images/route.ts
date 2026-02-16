import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { openRouterGenerateImage } from "@/lib/openrouter";
import { IMAGE_GEN_FALLBACKS, MODEL_CONFIG } from "@/lib/model-config";

export async function GET() {
  const actor = await requireActor();
  const images = await convexQuery("images:listGeneratedImages", {
    actorClerkId: actor.clerkId,
    limit: 100,
  });

  return NextResponse.json({ images });
}

export async function POST(request: NextRequest) {
  const actor = await requireActor();
  const body = (await request.json().catch(() => null)) as {
    prompt?: string;
    chatId?: string;
    model?: string;
  } | null;

  if (!body?.prompt?.trim()) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }

  try {
    const generated = await openRouterGenerateImage({
      model: body.model ?? MODEL_CONFIG.imageGen,
      fallbackModels: [...IMAGE_GEN_FALLBACKS],
      prompt: body.prompt.trim(),
      size: "1024x1024",
    });
    const imageUrl = generated.imageUrl;
    const modelUsed = generated.modelUsed;

    if (body.chatId) {
      await convexMutation("images:saveGeneratedImage", {
        actorClerkId: actor.clerkId,
        chatId: body.chatId,
        prompt: body.prompt.trim(),
        imageUrl,
        model: modelUsed,
      }).catch(() => {});
    }

    return NextResponse.json({ imageUrl, prompt: body.prompt.trim(), modelUsed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image generation failed";
    const isModelError = /not found|unavailable|not supported|invalid model/i.test(message);
    const isRateLimit = /429|rate|busy|capacity/i.test(message);
    const userMessage = isModelError
      ? "The image generation model is temporarily unavailable. Please try again later or switch to a different model."
      : isRateLimit
        ? "Image generation is rate-limited. Please wait a moment and try again."
        : `Image generation failed: ${message}`;
    return NextResponse.json(
      { error: userMessage },
      { status: isRateLimit ? 429 : isModelError ? 503 : 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const actor = await requireActor();
  const body = (await request.json().catch(() => null)) as { imageId?: string } | null;

  if (!body?.imageId) {
    return NextResponse.json({ error: "imageId is required" }, { status: 400 });
  }

  await convexMutation("images:deleteGeneratedImage", {
    actorClerkId: actor.clerkId,
    imageId: body.imageId,
  });

  return NextResponse.json({ ok: true });
}
