import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { chunkTextWithPages, embedChunks, parseUploadedFile } from "@/lib/ingest";
import { openRouterChatCompletion } from "@/lib/openrouter";
import { MODEL_CONFIG } from "@/lib/model-config";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const scope = request.nextUrl.searchParams.get("scope");
    const agentId = request.nextUrl.searchParams.get("agentId");

    if (scope === "agent" && agentId) {
      const resources = await convexQuery("resources:listAgentResources", {
        actorClerkId: actor.clerkId,
        agentId,
      });
      return ok({ resources });
    }

    const resources = await convexQuery("resources:listPersonalResources", {
      actorClerkId: actor.clerkId,
    });
    return ok({ resources });
  });
}

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

async function sha256OfFile(file: File) {
  const bytes = await file.arrayBuffer();
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

async function regenerateAgentGuidelines(actorClerkId: string, agentId: string) {
  const texts = (await convexQuery("resources:listAgentTexts", {
    actorClerkId,
    agentId,
  })) as Array<{ filename: string; text: string }>;

  if (texts.length === 0) return;

  const sourceText = texts
    .map((resource, idx) => `Source ${idx + 1} (${resource.filename}):\n${resource.text.slice(0, 4_000)}`)
    .join("\n\n")
    .slice(0, 20_000);

  const response = await openRouterChatCompletion({
    model: MODEL_CONFIG.tutorFast,
    fallbackModels: [MODEL_CONFIG.marker],
    messages: [
      {
        role: "system",
        content:
          "Generate concise JSON with keys: summary (string), topicMap (string[]). Keep it teacher-friendly.",
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

  await convexMutation("agents:updateAgentGuidelines", {
    actorClerkId,
    agentId,
    guidelinesSummary:
      typeof parsed.summary === "string"
        ? parsed.summary
        : "Guidelines generated from uploaded resources.",
    guidelinesTopicMap: Array.isArray(parsed.topicMap) ? parsed.topicMap.slice(0, 24) : [],
  });
}

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const formData = await request.formData();

    const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
    const scope = (formData.get("scope") as "pack" | "personal" | "agent" | null) ?? "personal";
    const packId = (formData.get("packId") as string | null) ?? undefined;
    const agentId = (formData.get("agentId") as string | null) ?? undefined;

    if (files.length === 0) {
      return badRequest("No files uploaded");
    }

    if (scope === "agent" && !agentId) {
      return badRequest("agentId is required for agent uploads");
    }

    const results: Array<{ file: string; resourceId?: string; status: string; error?: string }> = [];
    const localHashToResourceId = new Map<string, string>();
    const hashByKey = new Map<string, string>();

    for (const file of files) {
      const hash = await sha256OfFile(file);
      hashByKey.set(`${file.name}:${file.size}:${file.lastModified}`, hash);
    }

    const reusableByHash = new Map<string, string>();
    if (scope === "personal") {
      const reusable = (await convexQuery("resources:findReusablePersonalResourcesByHashes", {
        actorClerkId: actor.clerkId,
        hashes: [...new Set(hashByKey.values())],
      })) as Array<{ resourceId: string; contentHash: string }>;

      for (const match of reusable) {
        if (!reusableByHash.has(match.contentHash)) {
          reusableByHash.set(match.contentHash, match.resourceId);
        }
      }
    }

    for (const file of files) {
      const hashKey = `${file.name}:${file.size}:${file.lastModified}`;
      const contentHash = hashByKey.get(hashKey);

      if (scope === "personal" && contentHash) {
        const already = localHashToResourceId.get(contentHash) ?? reusableByHash.get(contentHash);
        if (already) {
          results.push({
            file: file.name,
            resourceId: already,
            status: "reused",
          });
          continue;
        }
      }

      try {
        const uploadUrl = (await convexMutation("resources:createUploadUrl", {
          actorClerkId: actor.clerkId,
          scope,
          packId,
          agentId,
        })) as string;

        const storageId = await uploadToConvexStorage(uploadUrl, file);

        const registered = (await convexMutation("resources:registerResource", {
          actorClerkId: actor.clerkId,
          scope,
          packId,
          agentId,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          contentHash,
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
        if (scope === "personal" && contentHash) {
          localHashToResourceId.set(contentHash, registered.resourceId);
        }
      } catch (error) {
        results.push({
          file: file.name,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown ingestion error",
        });
      }
    }

    if (scope === "agent" && agentId) {
      try {
        await regenerateAgentGuidelines(actor.clerkId, agentId);
      } catch {
        // Upload should succeed even if guideline refresh fails.
      }
    }

    return ok({
      results,
      resourceIds: results.map((item) => item.resourceId).filter((id): id is string => Boolean(id)),
      count: results.length,
    });
  });
}
