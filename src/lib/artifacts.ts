import { convexMutation } from "@/lib/convex-server";
import { parseGeneratedDocument, type GeneratedDocument } from "@/lib/document-generator";
import {
  buildDocxBytes,
  buildHtmlBytes,
  buildPdfBytes,
  buildPptxBytes,
  sanitizeArtifactBasename,
} from "@/lib/document-export";
import type { ArtifactFormat } from "@/types";

type PersistedArtifact = {
  filename: string;
  mimeType: string;
  resourceId: string;
  downloadUrl: string;
};

async function uploadArtifact(params: {
  actorClerkId: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}) {
  const uploadUrl = await convexMutation("resources:createUploadUrl", {
    actorClerkId: params.actorClerkId,
    scope: "personal",
    ignorePersonalLimit: true,
  }) as string;

  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": params.mimeType,
    },
    body: Uint8Array.from(params.bytes),
  });

  if (!uploadResponse.ok) {
    throw new Error(`Artifact upload failed: ${await uploadResponse.text()}`);
  }

  const uploadPayload = (await uploadResponse.json()) as { storageId?: string };
  if (!uploadPayload.storageId) {
    throw new Error("Artifact upload did not return storageId");
  }

  const registered = await convexMutation("resources:registerResource", {
    actorClerkId: params.actorClerkId,
    scope: "personal",
    filename: params.filename,
    mimeType: params.mimeType,
    size: params.bytes.byteLength,
    storageId: uploadPayload.storageId,
    saveToLibrary: false,
  }) as { resourceId: string };

  await convexMutation("resources:finalizeGeneratedResource", {
    actorClerkId: params.actorClerkId,
    resourceId: registered.resourceId,
    parsedCharCount: 0,
  });

  return {
    filename: params.filename,
    mimeType: params.mimeType,
    resourceId: registered.resourceId,
    downloadUrl: `/api/resources/${registered.resourceId}/download`,
  } satisfies PersistedArtifact;
}

function defaultFormatsForDocument(documentData: GeneratedDocument): ArtifactFormat[] {
  if (documentData.type === "webpage") {
    return ["html"];
  }
  if (documentData.type === "presentation") {
    return ["pptx"];
  }
  return ["docx"];
}

export async function generateArtifactResources(params: {
  actorClerkId: string;
  content: string;
  requestedFormats?: ArtifactFormat[];
}) {
  const parsed = parseGeneratedDocument(params.content);
  if (!parsed.document) {
    return {
      attachments: [] as string[],
      attachmentResourceIds: [] as string[],
      markdownBlock: "",
    };
  }

  const basename = sanitizeArtifactBasename(parsed.document.title);
  const uploads: PersistedArtifact[] = [];
  const requestedFormats = Array.from(new Set(params.requestedFormats ?? []));
  const targetFormats = requestedFormats.length > 0 ? requestedFormats : defaultFormatsForDocument(parsed.document);

  if (targetFormats.includes("docx")) {
    const docxBytes = await buildDocxBytes(parsed.document);
    uploads.push(await uploadArtifact({
      actorClerkId: params.actorClerkId,
      filename: `${basename}.docx`,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: docxBytes,
    }));
  }

  if (targetFormats.includes("pdf")) {
    const pdfBytes = await buildPdfBytes(parsed.document);
    uploads.push(await uploadArtifact({
      actorClerkId: params.actorClerkId,
      filename: `${basename}.pdf`,
      mimeType: "application/pdf",
      bytes: pdfBytes,
    }));
  }

  if (targetFormats.includes("pptx")) {
    const pptxBytes = await buildPptxBytes(parsed.document);
    uploads.push(await uploadArtifact({
      actorClerkId: params.actorClerkId,
      filename: `${basename}.pptx`,
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      bytes: pptxBytes,
    }));
  }

  if (targetFormats.includes("html")) {
    const htmlBytes = buildHtmlBytes(parsed.document);
    uploads.push(await uploadArtifact({
      actorClerkId: params.actorClerkId,
      filename: `${basename}.html`,
      mimeType: "text/html; charset=utf-8",
      bytes: htmlBytes,
    }));
  }

  return {
    attachments: uploads.map((artifact) => artifact.filename),
    attachmentResourceIds: uploads.map((artifact) => artifact.resourceId),
    markdownBlock: uploads.length > 0
      ? ["## Downloads", ...uploads.map((artifact) => `- [${artifact.filename}](${artifact.downloadUrl})`)].join("\n")
      : "",
  };
}
