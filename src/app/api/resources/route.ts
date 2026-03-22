import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { requireActor } from "@/lib/auth-server";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { badRequest, ok } from "@/lib/http";
import { FILE_LIMITS } from "@/lib/file-limits";
import {
  formatMegabytes,
  normalizedResourceMimeType,
  resolveMaxResourceFileSizeBytes,
  validateResourceUploadFile,
} from "@/lib/resource-upload-validation";
import { withRouteErrorHandling } from "@/lib/route-handler";

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

async function uploadToConvexStorage(uploadUrl: string, file: File, contentType: string) {
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
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

export async function POST(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const formData = await request.formData();

    const files = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
    const scope = (formData.get("scope") as "pack" | "personal" | "agent" | null) ?? "personal";
    const packId = (formData.get("packId") as string | null) ?? undefined;
    const agentId = (formData.get("agentId") as string | null) ?? undefined;
    const saveToLibraryRequested = (formData.get("saveToLibrary") as string | null) !== "0";

    if (files.length === 0) {
      return badRequest("No files uploaded");
    }

    if (scope === "agent" && !agentId) {
      return badRequest("agentId is required for agent uploads");
    }

    const orgSettings = (await convexQuery("admin:getOrgSettings", {
      actorClerkId: actor.clerkId,
    })) as {
      org?: {
        maxResourceFileSizeBytes?: number;
      };
    };
    const maxResourceFileSizeBytes = resolveMaxResourceFileSizeBytes(
      orgSettings.org?.maxResourceFileSizeBytes,
    );

    const results: Array<{
      file: string;
      resourceId?: string;
      status: string;
      error?: string;
      savedToLibrary?: boolean;
    }> = [];
    let currentPersonalCount = 0;
    const acceptedFiles: File[] = [];
    const localHashToResourceId = new Map<string, string>();
    const hashByKey = new Map<string, string>();

    for (const file of files) {
      const fileTypeError = validateResourceUploadFile(file);
      if (fileTypeError) {
        results.push({
          file: file.name,
          status: "failed",
          error: fileTypeError,
        });
        continue;
      }

      if (file.size > maxResourceFileSizeBytes) {
        results.push({
          file: file.name,
          status: "failed",
          error: `File too large. Max ${formatMegabytes(maxResourceFileSizeBytes)} per file.`,
        });
        continue;
      }
      const hash = await sha256OfFile(file);
      hashByKey.set(`${file.name}:${file.size}:${file.lastModified}`, hash);
      acceptedFiles.push(file);
    }

    const reusableByHash = new Map<string, string>();
    if (scope === "personal") {
      const existingPersonal = (await convexQuery("resources:listPersonalResources", {
        actorClerkId: actor.clerkId,
      })) as Array<unknown>;
      currentPersonalCount = existingPersonal.length;

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

    for (const file of acceptedFiles) {
      const hashKey = `${file.name}:${file.size}:${file.lastModified}`;
      const contentHash = hashByKey.get(hashKey);

      if (scope === "personal" && contentHash) {
        const already = localHashToResourceId.get(contentHash) ?? reusableByHash.get(contentHash);
        if (already) {
          results.push({
            file: file.name,
            resourceId: already,
            status: "reused",
            savedToLibrary: true,
          });
          continue;
        }
      }

      try {
        const mimeType = normalizedResourceMimeType(file);
        const saveToLibrary =
          scope !== "personal"
            ? true
            : saveToLibraryRequested && currentPersonalCount < FILE_LIMITS.maxPersonalLibraryFiles;

        const uploadUrl = (await convexMutation("resources:createUploadUrl", {
          actorClerkId: actor.clerkId,
          scope,
          packId,
          agentId,
          ignorePersonalLimit: scope === "personal" ? !saveToLibrary : undefined,
        })) as string;

        const storageId = await uploadToConvexStorage(uploadUrl, file, mimeType);

        const registered = (await convexMutation("resources:registerResource", {
          actorClerkId: actor.clerkId,
          scope,
          packId,
          agentId,
          filename: file.name,
          mimeType,
          size: file.size,
          contentHash,
          storageId,
          saveToLibrary,
        })) as { resourceId: string };
        const enqueueResult = (await convexMutation("resources:enqueueResourceProcessing", {
          actorClerkId: actor.clerkId,
          resourceId: registered.resourceId,
        })) as { ok?: boolean; reason?: string };

        if (enqueueResult?.ok === false) {
          results.push({
            file: file.name,
            resourceId: registered.resourceId,
            status: "failed",
            error: enqueueResult.reason ?? "Unable to queue file processing.",
            savedToLibrary: saveToLibrary,
          });
          continue;
        }

        results.push({
          file: file.name,
          resourceId: registered.resourceId,
          status: "uploaded",
          savedToLibrary: saveToLibrary,
          error: saveToLibrary
            ? undefined
            : saveToLibraryRequested
              ? `Attached for this chat only (personal file cap ${FILE_LIMITS.maxPersonalLibraryFiles} reached).`
              : "Attached for this chat only (auto-save to My Files is disabled).",
        });
        if (scope === "personal" && contentHash) {
          localHashToResourceId.set(contentHash, registered.resourceId);
        }
        if (scope === "personal" && saveToLibrary) {
          currentPersonalCount += 1;
        }
      } catch (error) {
        results.push({
          file: file.name,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown ingestion error",
        });
      }
    }

    const chatOnlyResourceIds = results
      .filter((item) => item.resourceId && item.savedToLibrary === false)
      .map((item) => item.resourceId as string);

    return ok({
      results,
      resourceIds: results.map((item) => item.resourceId).filter((id): id is string => Boolean(id)),
      chatOnlyResourceIds,
      count: results.length,
    });
  });
}

export async function PATCH(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json().catch(() => null)) as {
      resourceId?: string;
      pinned?: boolean;
    } | null;
    if (!body?.resourceId || typeof body.pinned !== "boolean") {
      return badRequest("resourceId and pinned are required");
    }

    await convexMutation("resources:togglePin", {
      actorClerkId: actor.clerkId,
      resourceId: body.resourceId,
      pinned: body.pinned,
    });

    return ok({ ok: true });
  });
}

export async function DELETE(request: NextRequest) {
  return withRouteErrorHandling(async () => {
    const actor = await requireActor();
    const body = (await request.json().catch(() => null)) as {
      resourceId?: string;
    } | null;
    if (!body?.resourceId) {
      return badRequest("resourceId is required");
    }

    await convexMutation("resources:deleteResource", {
      actorClerkId: actor.clerkId,
      resourceId: body.resourceId,
    });

    return ok({ ok: true });
  });
}
