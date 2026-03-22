import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery, convexAction } from "@/lib/convex-server";
import { openRouterGenerateImage } from "@/lib/openrouter";
import { IMAGE_GEN_FALLBACKS, MODEL_CONFIG } from "@/lib/model-config";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { recordOpenRouterUsage } from "@/lib/usage-tracking";

export async function GET() {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const result = await convexQuery("images:listGeneratedImages", {
      actorClerkId: actor.clerkId,
      limit: 100,
    }) as { images: unknown[] };

    return ok({ images: result.images ?? [] });
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json().catch(() => null)) as {
      prompt?: string;
      chatId?: string;
      model?: string;
    } | null;

    if (!body?.prompt?.trim()) {
      return badRequest("Prompt is required");
    }

    try {
      const generated = await openRouterGenerateImage({
        model: body.model ?? MODEL_CONFIG.imageGen,
        fallbackModels: [...IMAGE_GEN_FALLBACKS],
        prompt: body.prompt.trim(),
        size: "1024x1024",
      });
      await recordOpenRouterUsage({
        actorClerkId: actor.clerkId,
        chatId: body.chatId,
        model: generated.modelUsed,
        usage: generated.usage,
        skipIfZeroTokens: false,
      }).catch(() => {});
      const imageUrl = generated.imageUrl;
      const modelUsed = generated.modelUsed;

      let servingUrl: string;

      if (body.chatId && imageUrl.startsWith("data:")) {
        const storeResult = await convexAction("images:storeImageBlob", {
          actorClerkId: actor.clerkId,
          chatId: body.chatId,
          base64Data: imageUrl,
          mimeType: "image/png",
          prompt: body.prompt.trim(),
          model: modelUsed,
          size: "1024x1024",
        }) as { servingUrl: string };
        servingUrl = storeResult.servingUrl;
      } else {
        servingUrl = imageUrl;
      }

      return ok({ imageUrl: servingUrl, prompt: body.prompt.trim(), modelUsed });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image generation failed";
      const isModelError = /not found|unavailable|not supported|invalid model/i.test(message);
      const isRateLimit = /429|rate|busy|capacity/i.test(message);
      const userMessage = isModelError
        ? "The image generation model is temporarily unavailable. Please try again later or switch to a different model."
        : isRateLimit
          ? "Image generation is rate-limited. Please wait a moment and try again."
          : "Image generation failed. Please try again.";
      return NextResponse.json(
        { error: userMessage },
        { status: isRateLimit ? 429 : isModelError ? 503 : 500 },
      );
    }
  });
}

export async function DELETE(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json().catch(() => null)) as { imageId?: string } | null;

    if (!body?.imageId) {
      return badRequest("imageId is required");
    }

    await convexMutation("images:deleteGeneratedImage", {
      actorClerkId: actor.clerkId,
      imageId: body.imageId,
    });

    return ok({ ok: true });
  });
}
