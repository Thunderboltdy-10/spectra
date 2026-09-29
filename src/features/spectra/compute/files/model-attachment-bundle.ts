import type { PreparedAttachment } from "./attachment-preprocessor";

export type FileHandle = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  data?: string;
};
export type AttachmentSourceLocation = {
  kind: "page" | "slide" | "sheet" | "range" | "section";
  label: string;
  startOffset?: number;
  endOffset?: number;
};
export type AttachmentProvenance = {
  source: "user_upload" | "integration" | "linked_work" | "research";
  originalFileId: string;
  originalName: string;
  originalMimeType: string;
  originalBytes: number;
  preparedAt: string;
  extractor: string;
};
export type ModelAttachmentBundle = {
  originalFile: FileHandle;
  visualRepresentation?: {
    kind: "pdf" | "image";
    data: string;
    mimeType: string;
  };
  structuredRepresentation?: { kind: string; value: unknown };
  searchableText?: string;
  sourceMap: AttachmentSourceLocation[];
  warnings: Array<{ code: string; message: string }>;
  provenance: AttachmentProvenance;
};

export type AttachmentConsumer =
  | "chat"
  | "agent_evidence"
  | "reference"
  | "import"
  | "research";

export function createModelAttachmentBundle(
  attachment: PreparedAttachment,
): ModelAttachmentBundle {
  const originalFile: FileHandle = {
    id: attachment.id ?? `file:${attachment.name}:${attachment.size}`,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    ...(attachment.data ? { data: attachment.data } : {}),
  };
  // Office files reach the model as their extracted text evidence only; a
  // re-rendered text-only PDF of that same text was a paid duplicate.
  const visualRepresentation =
    attachment.data &&
    (attachment.handling === "pdf" || attachment.handling === "image")
      ? {
          kind: attachment.handling,
          data: attachment.data,
          mimeType: attachment.mimeType,
        }
      : undefined;
  const sourceMap: AttachmentSourceLocation[] =
    attachment.sourceMap ??
    (attachment.pageCount
      ? Array.from({ length: attachment.pageCount }, (_, index) => ({
          kind: "page" as const,
          label: `Page ${index + 1}`,
        }))
      : attachment.handling === "pptx"
        ? [{ kind: "slide" as const, label: "Slides retained in the original package" }]
        : attachment.handling === "xlsx"
          ? [{ kind: "sheet" as const, label: "Worksheets retained in the original package" }]
          : attachment.handling === "docx"
            ? [{ kind: "section" as const, label: "Document structure retained from the original package" }]
            : []);
  return {
    originalFile,
    ...(visualRepresentation ? { visualRepresentation } : {}),
    ...(attachment.extractedText
      ? { searchableText: attachment.extractedText }
      : {}),
    ...(attachment.structuredRepresentation
      ? { structuredRepresentation: attachment.structuredRepresentation }
      : ["docx", "pptx", "xlsx"].includes(attachment.handling)
        ? {
            structuredRepresentation: {
              kind: attachment.handling,
              value: attachment.extractedText ?? "",
            },
          }
        : {}),
    sourceMap,
    warnings: attachment.warnings ?? [],
    provenance:
      attachment.provenance ?? {
        source: "user_upload",
        originalFileId: originalFile.id,
        originalName: attachment.name,
        originalMimeType: attachment.mimeType,
        originalBytes: attachment.size,
        preparedAt: new Date(0).toISOString(),
        extractor: `spectra/${attachment.handling}`,
      },
  };
}

export function attachmentBundleForConsumer(
  bundle: ModelAttachmentBundle,
  consumer: AttachmentConsumer,
) {
  return {
    consumer,
    originalFile: bundle.originalFile,
    visualRepresentation: bundle.visualRepresentation,
    structuredRepresentation: bundle.structuredRepresentation,
    searchableText: bundle.searchableText,
    sourceMap: bundle.sourceMap,
    warnings: bundle.warnings,
    provenance: bundle.provenance,
  };
}

export function nativeOpenRouterAttachmentContent(
  prompt: string,
  attachments: PreparedAttachment[],
) {
  type NativeContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
    | { type: "file"; file: { filename: string; file_data: string } };
  return [
    { type: "text" as const, text: prompt },
    ...attachments
      .map((attachment) => ({ attachment, bundle: createModelAttachmentBundle(attachment) }))
      .flatMap<NativeContentPart>(({ attachment, bundle }) => {
      if (!bundle.originalFile.data) return [];
      if (attachment.handling === "image") {
        return [
          { type: "image_url" as const, image_url: { url: bundle.originalFile.data } },
        ];
      }
      if (attachment.handling === "pdf") {
        return [
          {
            type: "file" as const,
            file: { filename: attachment.name, file_data: bundle.originalFile.data },
          },
        ];
      }
      return [];
    }),
  ] satisfies NativeContentPart[];
}
