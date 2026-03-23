import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { MODEL_CONFIG } from "@/lib/model-config";
import { resolveRoleModelBundle } from "@/lib/model-role-resolver";
import { openRouterChatCompletion } from "@/lib/openrouter";
import { classifyComplexity, classifyRequest } from "@/lib/auto-settings";
import { safeStudyMode } from "@/lib/contracts/studyModes";
import { recordOpenRouterUsage } from "@/lib/usage-tracking";

function localEnhance(message: string, mode: string) {
  return {
    original: message,
    enhanced: `${message.trim()}\n\nPlease answer in ${mode} mode with clear sections and concise steps.`,
    improvements: [
      "Added mode-specific instruction",
      "Requested a clear structure",
      "Preserved original intent",
    ],
  };
}

function passthroughEnhance(message: string) {
  return {
    original: message,
    enhanced: message,
    improvements: ["Enhancement skipped for short/simple prompt."],
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, timeoutMs);

    void promise
      .then((value) => {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          resolve(value);
        }
      })
      .catch(() => {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          resolve(null);
        }
      });
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();

    const body = (await request.json().catch(() => null)) as {
      message?: string;
      mode?: string;
    } | null;

    if (!body?.message?.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const mode = safeStudyMode(body.mode, "POST /api/enhance-prompt");
    const normalizedMessage = body.message.trim();
    const wordCount = normalizedMessage.split(/\s+/).filter(Boolean).length;
    const complexity = classifyComplexity(normalizedMessage);
    const requestClass = classifyRequest({
      message: normalizedMessage,
      complexity,
      mode,
      hasAttachments: false,
      isFirstMessage: false,
      spendingTier: "normal",
    }).requestClass;
    const isShortQuestion = normalizedMessage.includes("?") && wordCount < 10;
    if (normalizedMessage.length < 25 || isShortQuestion || requestClass === "T0" || requestClass === "T1") {
      return NextResponse.json(passthroughEnhance(body.message));
    }

    const utility = await resolveRoleModelBundle({
      actorClerkId: actor.clerkId,
      role: "utilityFree",
      fallbackModel: MODEL_CONFIG.utilityFree,
      maxFallbacks: 2,
    }).catch(() => ({
      model: MODEL_CONFIG.utilityFree,
      fallbackModels: [MODEL_CONFIG.marker],
    }));

    const completion = await withTimeout(
      openRouterChatCompletion({
        model: utility.model,
        fallbackModels: utility.fallbackModels,
        messages: [
          {
            role: "system",
            content:
              `You are a prompt enhancement assistant for an educational AI platform.
Improve student prompts while preserving original intent.
Mode: ${mode}
Return ONLY JSON: {"original":"...","enhanced":"...","improvements":["..."]}`,
          },
          {
            role: "user",
            content: body.message,
          },
        ],
        temperature: 0.2,
      }),
      2000,
    );

    if (!completion) {
      return NextResponse.json(localEnhance(body.message, mode));
    }

    await recordOpenRouterUsage({
      actorClerkId: actor.clerkId,
      model: completion.model ?? utility.model,
      usage: completion.usage,
    }).catch(() => {});

    const raw = completion.choices?.[0]?.message?.content ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(localEnhance(body.message, mode));
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        original?: string;
        enhanced?: string;
        improvements?: string[];
      };

      const enhancements = Array.isArray(parsed.improvements)
        ? parsed.improvements.filter((item) => typeof item === "string").slice(0, 5)
        : [];

      return NextResponse.json({
        original: body.message,
        enhanced: parsed.enhanced || body.message,
        improvements: enhancements,
      });
    } catch {
      return NextResponse.json(localEnhance(body.message, mode));
    }
  });
}
