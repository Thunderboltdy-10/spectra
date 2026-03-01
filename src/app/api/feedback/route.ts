import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { convexAction } from "@/lib/convex-server";
import { convexMutation } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";

const MAX_MESSAGE_LENGTH = 500;
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const VALID_CATEGORIES = new Set(["bug", "confusing", "feature", "safety"]);

function asTrimmedString(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeOptional(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function omitUndefined<T extends Record<string, string | undefined>>(input: T): Partial<T> {
  const output: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      output[key as keyof T] = value as T[keyof T];
    }
  }
  return output;
}

function isLegacyFeedbackContextError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lower = message.toLowerCase();
  return (
    lower.includes("argumentvalidationerror") &&
    (lower.includes("extra field") || lower.includes("not in the validator"))
  );
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const form = await request.formData();
    const category = asTrimmedString(form.get("category"));
    const message = asTrimmedString(form.get("message"));

    if (!VALID_CATEGORIES.has(category)) {
      return badRequest("Invalid category");
    }
    if (!message) {
      return badRequest("Message is required");
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return badRequest(`Message must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
    }

    const screenshotValue = form.get("screenshot");
    let screenshotStorageId: string | undefined;

    if (screenshotValue instanceof File && screenshotValue.size > 0) {
      if (!screenshotValue.type.startsWith("image/")) {
        return badRequest("Screenshot must be an image file");
      }
      if (screenshotValue.size > MAX_SCREENSHOT_BYTES) {
        return badRequest("Screenshot must be 2MB or smaller");
      }

      try {
        const buffer = Buffer.from(await screenshotValue.arrayBuffer());
        const screenshotBase64 = buffer.toString("base64");
        const stored = await convexAction<
          { base64Data: string; mimeType: string },
          { storageId: string }
        >("feedback:storeFeedbackScreenshot", {
          base64Data: screenshotBase64,
          mimeType: screenshotValue.type,
        });
        screenshotStorageId = stored.storageId;
      } catch (error) {
        console.warn("[feedback] screenshot upload failed, continuing without screenshot", error);
      }
    }

    let actorClerkId: string | undefined;
    try {
      const session = await auth();
      actorClerkId = session.userId ?? undefined;
    } catch {
      actorClerkId = undefined;
    }

    const mode = normalizeOptional(asTrimmedString(form.get("mode")));
    const page = normalizeOptional(asTrimmedString(form.get("page")));
    const device = normalizeOptional(asTrimmedString(form.get("device")));
    const traceId = normalizeOptional(asTrimmedString(form.get("traceId")));
    const chatId = normalizeOptional(asTrimmedString(form.get("chatId")));
    const lastMessage = normalizeOptional(asTrimmedString(form.get("lastMessage")));
    const activeMode = normalizeOptional(asTrimmedString(form.get("activeMode")));
    const activeModel = normalizeOptional(asTrimmedString(form.get("activeModel")));
    const viewportSize = normalizeOptional(asTrimmedString(form.get("viewportSize")));

    let finalScreenshotStorageId = screenshotStorageId;
    const autoScreenshotValue = form.get("autoScreenshot");
    if (!finalScreenshotStorageId && typeof autoScreenshotValue === "string" && autoScreenshotValue.startsWith("data:image/jpeg;base64,")) {
      const base64Data = autoScreenshotValue.replace("data:image/jpeg;base64,", "");
      if (base64Data.length < MAX_SCREENSHOT_BYTES * 1.5) { // rough base64 overhead allowance
        try {
          const stored = await convexAction<
            { base64Data: string; mimeType: string },
            { storageId: string }
          >("feedback:storeFeedbackScreenshot", {
            base64Data,
            mimeType: "image/jpeg",
          });
          finalScreenshotStorageId = stored.storageId;
        } catch (error) {
          console.warn("[feedback] auto screenshot upload failed, continuing without screenshot", error);
        }
      }
    }

    const fullContext = omitUndefined({
      mode,
      page,
      device,
      traceId,
      chatId,
      lastMessage,
      activeMode,
      activeModel,
      viewportSize,
    });
    const baseContext = omitUndefined({
      mode,
      page,
      device,
      traceId,
    });

    const mutationArgs = {
      actorClerkId,
      category: category as "bug" | "confusing" | "feature" | "safety",
      message,
      screenshotStorageId: finalScreenshotStorageId,
      context: fullContext,
    };

    let result: { ok: boolean; feedbackId: string };
    try {
      result = await convexMutation<
        {
          actorClerkId?: string;
          category: "bug" | "confusing" | "feature" | "safety";
          message: string;
          screenshotStorageId?: string;
          context: {
            mode?: string;
            page?: string;
            device?: string;
            traceId?: string;
            chatId?: string;
            lastMessage?: string;
            activeMode?: string;
            activeModel?: string;
            viewportSize?: string;
          };
        },
        { ok: boolean; feedbackId: string }
      >("feedback:submitFeedback", mutationArgs);
    } catch (error) {
      if (!isLegacyFeedbackContextError(error)) {
        throw error;
      }
      result = await convexMutation<
        {
          actorClerkId?: string;
          category: "bug" | "confusing" | "feature" | "safety";
          message: string;
          screenshotStorageId?: string;
          context: {
            mode?: string;
            page?: string;
            device?: string;
            traceId?: string;
          };
        },
        { ok: boolean; feedbackId: string }
      >("feedback:submitFeedback", {
        ...mutationArgs,
        context: baseContext,
      });
    }

    return ok(result);
  }, request);
}
