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
};

type ConvexQueryFn = <T>(name: string, args: Record<string, unknown>) => Promise<T>;

const IMAGE_MIME_RE = /image\/(png|jpg|jpeg|webp|gif)/i;
const DOC_EXT_RE = /\.(pdf|docx|txt|md)$/i;

function inferType(filename: string, mimeType: string): PreparedAttachment["type"] {
  if (IMAGE_MIME_RE.test(mimeType) || /\.(png|jpg|jpeg|webp|gif)$/i.test(filename)) return "image";
  if (DOC_EXT_RE.test(filename) || /pdf|word|text|markdown/i.test(mimeType)) return "document";
  return "text";
}

function toDataUrl(mimeType: string, bytes: ArrayBuffer) {
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${mimeType};base64,${base64}`;
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
    };
  }

  const resources = await params.convexQuery<
    Array<{
      _id: string;
      filename: string;
      mimeType: string;
      size: number;
      scope: "pack" | "personal" | "agent";
      status: "uploaded" | "processed" | "failed";
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

  for (const resource of resources) {
    const type = inferType(resource.filename, resource.mimeType);
    const preparedAttachment: PreparedAttachment = {
      resourceId: resource._id,
      filename: resource.filename,
      mimeType: resource.mimeType,
      type,
      size: resource.size,
    };

    if (type === "image") {
      const download = await params.convexQuery<{ url: string }>("resources:getResourceDownloadUrl", {
        actorClerkId: params.actorClerkId,
        resourceId: resource._id,
      });

      const response = await fetch(download.url);
      if (response.ok) {
        const imageDataUrl = toDataUrl(resource.mimeType || "image/png", await response.arrayBuffer());
        preparedAttachment.imageDataUrl = imageDataUrl;
        imageContentBlocks.push({
          type: "image_url",
          image_url: {
            url: imageDataUrl,
            detail: resource.size > 500_000 ? "low" : "auto",
          },
        });
      }
    }

    if (type === "document") {
      let quickExtract = resource.quickExtractText?.slice(0, 4000).trim() ?? "";

      if (!quickExtract) {
        const download = await params.convexQuery<{ url: string }>("resources:getResourceDownloadUrl", {
          actorClerkId: params.actorClerkId,
          resourceId: resource._id,
        });
        quickExtract = await quickExtractFromRemoteFile(download.url, resource.filename);
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
    requiresVision: imageContentBlocks.length > 0,
  };
}
