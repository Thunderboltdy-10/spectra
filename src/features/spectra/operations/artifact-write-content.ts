import { normalizeArtifactContent } from "../ai/content-normalization";
import { validateArtifactContent } from "../artifacts/registry";
import type { ArtifactTypeKey } from "../artifacts/types";
import { enforceAiPresentationContentPolicy } from "../presentation/ai-content-policy";
import type { PresentationContent } from "../presentation/model";
import { workYjsAdapter } from "../work/models/yjs/registry";
import { applyResolvedContentPatch } from "../ai/document-content-patch";
import { applyDocumentAcademicOperations } from "../commands/office/document-academic-operations";

/** The same normalization, schema and content policy used by the AI writer. */
export function validateAiArtifactWriteContent(type: ArtifactTypeKey, content: unknown) {
  const validated = validateArtifactContent(type, normalizeArtifactContent(type, content));
  if (!validated.success) {
    const issue = validated.error.issues[0];
    const path = issue?.path?.length ? issue.path.join(".") : "";
    const detail = issue?.message ?? "The edited artifact is invalid.";
    throw new Error(path ? `AI_ARTIFACT_SCHEMA_INVALID: Invalid input at ${path}: ${detail}` : `AI_ARTIFACT_SCHEMA_INVALID: ${detail}`);
  }
  return validated.data;
}

export function applyAiArtifactContentPolicy(type: ArtifactTypeKey, content: unknown, prompt: string) {
  return type === "presentation" ? enforceAiPresentationContentPolicy(content as PresentationContent, prompt) : content;
}

export function normalizeAiArtifactWriteContent(type: ArtifactTypeKey, content: unknown, prompt: string) {
  return applyAiArtifactContentPolicy(type, validateAiArtifactWriteContent(type, content), prompt);
}

/**
 * Bind semantic content through the existing native adapter, not a second
 * interpretation of its JSON schema. Transient Yjs client IDs never enter the
 * projected value. The temporary document is always destroyed.
 */
export function canonicalArtifactWriteContent(type: ArtifactTypeKey, content: unknown): unknown {
  const adapter = workYjsAdapter(type);
  const document = adapter.createDocument(normalizeArtifactContent(type, structuredClone(content)));
  try {
    return adapter.project(document);
  } finally {
    document.destroy();
  }
}

export function resolveArtifactWriteInput(type: ArtifactTypeKey, before: unknown, input: Record<string, unknown>, prompt: string) {
  const resolvedContent = input.documentOperations
    ? applyDocumentAcademicOperations(before, input.documentOperations)
    : input.contentPatch
      ? applyResolvedContentPatch(before, input.contentPatch as Parameters<typeof applyResolvedContentPatch>[1])
      : input.content ?? before;
  return {
    resolvedContent,
    content: canonicalArtifactWriteContent(type, normalizeAiArtifactWriteContent(type, resolvedContent, prompt)),
  };
}
