import { parseUploadedFile } from "@/lib/ingest";

export type PreparedAttachment = {
  resourceId: string;
  filename: string;
  mimeType: string;
  type: "image" | "document" | "text";
  imageDataUrl?: string;
  quickExtractText?: string;
  size: number;
};

export type NormalizedAttachments = {
  prepared: PreparedAttachment[];
  imageContentBlocks: Array<{
    type: "image_url";
    image_url: { url: string; detail: "low" | "auto" };
  }>;
  quickExtractBlock: string;
  requiresVision: boolean;
  requiresDocumentReasoning: boolean;
  requiresFileUnderstanding: boolean;
  preferredCapabilities: Array<"vision" | "file_understanding" | "document_reasoning">;
};

type ConvexQueryFn = <T>(name: string, args: Record<string, unknown>) => Promise<T>;

const IMAGE_MIME_RE = /image\/(png|jpg|jpeg|webp|gif)/i;
const DOC_EXT_RE = /\.(pdf|docx|txt|md|pptx|xlsx|odt)$/i;

function inferType(filename: string, mimeType: string): PreparedAttachment["type"] {
  if (IMAGE_MIME_RE.test(mimeType) || /\.(png|jpg|jpeg|webp|gif)$/i.test(filename)) return "image";
  if (DOC_EXT_RE.test(filename) || /pdf|word|text|markdown|presentation|spreadsheet|opendocument/i.test(mimeType)) return "document";
  return "text";
}

function toDataUrl(mimeType: string, bytes: ArrayBuffer) {
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(task: () => Promise<T>, attempts = 3, waitMs = 180): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await sleep(waitMs * (attempt + 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Retry attempts exhausted");
}

async function quickExtractFromRemoteFile(downloadUrl: string, filename: string) {
  const response = await fetch(downloadUrl);
  if (!response.ok) return "";

  const bytes = await response.arrayBuffer();
  try {
    const parsed = await parseUploadedFile(new File([bytes], filename));
    return parsed.text.slice(0, 4000).trim();
  } catch {
    return "";
  }
}

export async function normalizeAttachments(params: {
  actorClerkId: string;
  resourceIds: string[];
  convexQuery: ConvexQueryFn;
}): Promise<NormalizedAttachments> {
  if (params.resourceIds.length === 0) {
    return {
      prepared: [],
      imageContentBlocks: [],
      quickExtractBlock: "",
      requiresVision: false,
      requiresDocumentReasoning: false,
      requiresFileUnderstanding: false,
      preferredCapabilities: [],
    };
  }

  const resources = await params.convexQuery<
    Array<{
      _id: string;
      filename: string;
      mimeType: string;
      size: number;
      scope: "pack" | "personal" | "agent";
      status: "uploaded" | "processing" | "processed" | "failed";
      storageId?: string;
      quickExtractText?: string;
    }>
  >("resources:getResourcesByIds", {
    actorClerkId: params.actorClerkId,
    resourceIds: params.resourceIds,
    maxQuickExtractChars: 4000,
  });

  const prepared: PreparedAttachment[] = [];
  const imageContentBlocks: NormalizedAttachments["imageContentBlocks"] = [];
  const quickExtracts: string[] = [];
  let hasImageAttachment = false;
  let hasDocumentAttachment = false;
  let hasFileUnderstandingNeed = false;

  for (const resource of resources) {
    const type = inferType(resource.filename, resource.mimeType);
    if (type === "image") {
      hasImageAttachment = true;
    }
    const preparedAttachment: PreparedAttachment = {
      resourceId: resource._id,
      filename: resource.filename,
      mimeType: resource.mimeType,
      type,
      size: resource.size,
    };

    if (type === "image") {
      try {
        const download = await withRetry(
          () =>
            params.convexQuery<{ url: string }>("resources:getResourceDownloadUrl", {
              actorClerkId: params.actorClerkId,
              resourceId: resource._id,
            }),
          3,
          220,
        );
        let finalUrl = download.url;

        try {
          const response = await withRetry(() => fetch(download.url), 3, 220);
          if (response.ok) {
            const imageDataUrl = toDataUrl(resource.mimeType || "image/png", await response.arrayBuffer());
            preparedAttachment.imageDataUrl = imageDataUrl;
            finalUrl = imageDataUrl;
          }
        } catch {
          // Fall back to signed URL if byte fetch fails; avoids dropping the attachment entirely.
        }

        imageContentBlocks.push({
          type: "image_url",
          image_url: {
            url: finalUrl,
            detail: resource.size > 500_000 ? "low" : "auto",
          },
        });
      } catch {
        quickExtracts.push(`[${resource.filename}]\nImage attachment is still finalizing. Ask user to retry if visual details are missing.`);
      }
    }

    if (type === "document") {
      hasDocumentAttachment = true;
      hasFileUnderstandingNeed = true;
      let quickExtract = resource.quickExtractText?.slice(0, 4000).trim() ?? "";

      if (!quickExtract) {
        try {
          const download = await withRetry(
            () =>
              params.convexQuery<{ url: string }>("resources:getResourceDownloadUrl", {
                actorClerkId: params.actorClerkId,
                resourceId: resource._id,
              }),
            3,
            220,
          );
          quickExtract = await quickExtractFromRemoteFile(download.url, resource.filename);
        } catch {
          quickExtract = "";
        }
      }

      if (quickExtract) {
        preparedAttachment.quickExtractText = quickExtract;
        quickExtracts.push(`[${resource.filename}]\n${quickExtract}`);
      }
    }

    prepared.push(preparedAttachment);
  }

  return {
    prepared,
    imageContentBlocks,
    quickExtractBlock: quickExtracts.length > 0 ? `ATTACHMENT CONTEXT:\n${quickExtracts.join("\n\n")}` : "",
    requiresVision: hasImageAttachment,
    requiresDocumentReasoning: hasDocumentAttachment,
    requiresFileUnderstanding: hasFileUnderstandingNeed,
    preferredCapabilities: [
      ...(hasImageAttachment ? ["vision" as const] : []),
      ...(hasFileUnderstandingNeed ? ["file_understanding" as const] : []),
      ...(hasDocumentAttachment ? ["document_reasoning" as const] : []),
    ],
  };
}
