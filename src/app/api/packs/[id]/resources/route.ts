import { NextRequest } from "next/server";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { chunkTextWithPages, embedChunks, parseUploadedFile } from "@/lib/ingest";
import { openRouterChatCompletion } from "@/lib/openrouter";
import { MODEL_CONFIG } from "@/lib/model-config";

export const runtime = "nodejs";

async function uploadToConvexStorage(uploadUrl: string, file: File) {
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error(`Storage upload failed: ${await response.text()}`);
  }

  const json = (await response.json()) as { storageId?: string };
  if (!json.storageId) {
    throw new Error("Storage upload did not return storageId");
  }
  return json.storageId;
}

async function regenerateGuidelines(actorClerkId: string, packId: string) {
  const packTexts = (await convexQuery("resources:listPackTexts", {
    actorClerkId,
    packId,
  })) as Array<{ filename: string; text: string }>;

  if (packTexts.length === 0) return;

  const sourceText = packTexts
    .map((resource, idx) => `Source ${idx + 1} (${resource.filename}):\n${resource.text.slice(0, 4_000)}`)
    .join("\n\n")
    .slice(0, 20_000);

  const response = await openRouterChatCompletion({
    model: MODEL_CONFIG.tutorFast,
    fallbackModels: [MODEL_CONFIG.multimodal],
    messages: [
      {
        role: "system",
        content:
          "Generate concise pack guidelines JSON with keys: summary, topicMap (array), rubricHints (array), misconceptions (array).",
      },
      {
        role: "user",
        content: sourceText,
      },
    ],
    temperature: 0.1,
  });

  const content = response.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] ?? "{}");

  await convexMutation("packs:updatePackGuidelines", {
    actorClerkId,
    packId,
    summary:
      typeof parsed.summary === "string"
        ? parsed.summary
        : "Guidelines generated from uploaded resources.",
    topicMap: Array.isArray(parsed.topicMap) ? parsed.topicMap.slice(0, 18) : [],
    rubricHints: Array.isArray(parsed.rubricHints) ? parsed.rubricHints.slice(0, 12) : [],
    misconceptions: Array.isArray(parsed.misconceptions) ? parsed.misconceptions.slice(0, 12) : [],
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const { id: packId } = await params;
    const formData = await request.formData();

    const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
    const scope = (formData.get("scope") as "pack" | "personal" | null) ?? "pack";

    if (files.length === 0) {
      return badRequest("No files uploaded");
    }

    const results: Array<{ file: string; resourceId?: string; status: string; error?: string }> = [];

    for (const file of files) {
      try {
        const uploadUrl = (await convexMutation("resources:createUploadUrl", {
          actorClerkId: actor.clerkId,
          scope,
          packId: scope === "pack" ? packId : undefined,
        })) as string;

        const storageId = await uploadToConvexStorage(uploadUrl, file);

        const registered = (await convexMutation("resources:registerResource", {
          actorClerkId: actor.clerkId,
          scope,
          packId: scope === "pack" ? packId : undefined,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          storageId,
        })) as { resourceId: string };

        const parsed = await parseUploadedFile(file);
        const chunks = chunkTextWithPages(parsed.pages);

        let embedded: Array<{ text: string; page?: number; embedding: number[] }> = [];

        try {
          embedded = await embedChunks(chunks);
        } catch {
          await convexMutation("resources:completeResourceIngestion", {
            actorClerkId: actor.clerkId,
            resourceId: registered.resourceId,
            parsedCharCount: 0,
            chunks: [],
            failedReason: "Embedding failed. Verify OpenRouter embedding model availability.",
          });

          results.push({
            file: file.name,
            resourceId: registered.resourceId,
            status: "failed",
            error: "Embedding failed. Verify OpenRouter embedding model availability.",
          });
          continue;
        }

        await convexMutation("resources:completeResourceIngestion", {
          actorClerkId: actor.clerkId,
          resourceId: registered.resourceId,
          parsedCharCount: parsed.text.length,
          chunks: embedded,
        });

        results.push({
          file: file.name,
          resourceId: registered.resourceId,
          status: "processed",
        });
      } catch (error) {
        results.push({
          file: file.name,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown ingestion error",
        });
      }
    }

    if (scope === "pack") {
      try {
        await regenerateGuidelines(actor.clerkId, packId);
      } catch {
        // Keep upload successful even if guidelines generation fails.
      }
    }

    return ok({ results });
  });
}
