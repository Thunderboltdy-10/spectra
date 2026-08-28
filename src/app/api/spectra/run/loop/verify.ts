import { query } from "./io";
import { normalizeArtifactContent } from "@/features/spectra/ai/content-normalization";
import {
  authoredValueLandedInContent,
  contentPatchChangeMatchesSaved,
} from "@/features/spectra/ai/content-patch-verify";
import { readResolvedContentPointer } from "@/features/spectra/ai/document-content-patch";
import { canonicalizeSheetsPatchChange } from "@/features/spectra/ai/sheets-content-patch";
import { canonicalizeWhiteboardPatchChange } from "@/features/spectra/ai/whiteboard-content-patch";
import { readLiveArtifactValue } from "@/features/spectra/ai/yjs-artifact-operation";
import { validateBlueprintContent } from "@/features/spectra/artifacts/blueprint-catalog";
import {
  hollowCreateFailureMessage,
  isHollowCreateContent,
} from "@/features/spectra/operations/hollow-content";
import { SPECTRA_BLUEPRINT_KEYS } from "@/features/spectra/operations/schema";
import type { ModelOperation } from "@/features/spectra/operations/schema";

export function readContentPointer(content: unknown, path: string) {
  const sheetsPath = canonicalizeSheetsPatchChange({
    path,
    value: null,
  }).path;
  const canonicalPath = canonicalizeWhiteboardPatchChange(content, {
    path: sheetsPath,
    value: null,
  }).path;
  return readResolvedContentPointer(content, canonicalPath);
}

export function artifactContentLooksUsable(
  blueprintKey: (typeof SPECTRA_BLUEPRINT_KEYS)[number],
  content: unknown,
  intent: "create" | "update" = "update",
) {
  if (isHollowCreateContent(blueprintKey, content, intent)) return false;
  const normalized = normalizeArtifactContent(blueprintKey, content);
  const verified = validateBlueprintContent(blueprintKey, normalized);
  if (verified.success) return true;
  const rawVerified = validateBlueprintContent(blueprintKey, content);
  if (rawVerified.success) return true;
  // Code sketches often land with a non-empty file tree even when a late
  // schema nuance fails verify. Prefer soft-complete over rebuild/confirm —
  // but never for hollow default shells.
  if (
    blueprintKey === "code" &&
    normalized &&
    typeof normalized === "object" &&
    !Array.isArray(normalized)
  ) {
    const files = (normalized as Record<string, unknown>).files;
    if (Array.isArray(files) && files.length > 0) {
      return files.some((file) => {
        if (!file || typeof file !== "object" || Array.isArray(file))
          return false;
        const source = (file as Record<string, unknown>).source;
        return (
          typeof source === "string" &&
          source.trim().length >= 24 &&
          !isHollowCreateContent("code", { files: [file] }, "create")
        );
      });
    }
  }
  return false;
}

export async function committedCreatesAreUsable(
  actorClerkId: string,
  outcomes: Array<{
    operation: ModelOperation;
    affected: Array<{ type: string; id: string }>;
  }>,
) {
  const creates = outcomes.filter(
    (outcome) => outcome.operation.type === "artifact.create",
  );
  if (creates.length === 0) return false;
  for (const outcome of creates) {
    const operation = outcome.operation;
    if (operation.type !== "artifact.create") continue;
    const artifactId = outcome.affected.find(
      (item) => item.type === "artifact",
    )?.id;
    if (!artifactId) return false;
    const saved = await query<unknown & object, unknown>(
      "spectraArtifacts:get",
      { actorClerkId, artifactId },
    ).catch(() => null);
    if (!saved || typeof saved !== "object") return false;
    const artifact = saved as Record<string, unknown>;
    if (artifact.blueprintKey !== operation.input.blueprintKey) return false;
    if (artifact.status === "archived" || artifact.status === "deleted")
      return false;
    if (
      !artifactContentLooksUsable(
        operation.input.blueprintKey,
        artifact.content,
        "create",
      )
    )
      return false;
  }
  return true;
}

export async function verifyCommittedOutcomes(
  actorClerkId: string,
  outcomes: Array<{
    operation: ModelOperation;
    affected: Array<{ type: string; id: string }>;
  }>,
) {
  for (const outcome of outcomes) {
    const operation = outcome.operation;
    if (
      operation.type !== "artifact.create" &&
      operation.type !== "artifact.update" &&
      operation.type !== "artifact.archive"
    )
      continue;
    const artifactId =
      operation.type === "artifact.update" ||
      operation.type === "artifact.archive"
        ? operation.input.artifactId
        : outcome.affected.find((item) => item.type === "artifact")?.id;
    if (!artifactId)
      throw new Error("The requested artifact was not present after saving.");
    const loadSaved = async () => {
      const saved = await query<unknown & object, unknown>(
        "spectraArtifacts:get",
        { actorClerkId, artifactId },
      );
      if (!saved || typeof saved !== "object")
        throw new Error("The saved artifact could not be verified.");
      return saved as Record<string, unknown>;
    };
    let artifact = await loadSaved();
    if (operation.type === "artifact.archive") {
      if (artifact.status !== "archived")
        throw new Error("The artifact was not archived after confirmation.");
      continue;
    }
    if (artifact.blueprintKey !== operation.input.blueprintKey)
      throw new Error("The saved artifact type did not match the request.");
    {
      // Yjs / storage can reshape defaults slightly after apply. Prefer the
      // same normalize path used on write so a successful create is never
      // falsely failed at verification. Hollow default shells are never
      // treated as completed creates.
      const blueprintKey = operation.input.blueprintKey;
      const verifyIntent =
        operation.type === "artifact.create" ? "create" : "update";
      if (isHollowCreateContent(blueprintKey, artifact.content, verifyIntent))
        throw new Error(hollowCreateFailureMessage(blueprintKey));
      if (
        !artifactContentLooksUsable(
          blueprintKey,
          artifact.content,
          verifyIntent,
        )
      ) {
        const normalized = normalizeArtifactContent(
          blueprintKey,
          artifact.content,
        );
        const verified = validateBlueprintContent(blueprintKey, normalized);
        throw verified.success
          ? new Error("The saved artifact content could not be verified.")
          : verified.error;
      }
    }
    if (operation.type === "artifact.update") {
      if (
        operation.input.title !== null &&
        artifact.title !== operation.input.title
      )
        throw new Error(
          "The saved artifact title did not match the requested change.",
        );
      if (
        operation.input.summary !== null &&
        artifact.summary !== operation.input.summary
      )
        throw new Error(
          "The saved artifact summary did not match the requested change.",
        );
      if (
        operation.input.tags !== null &&
        JSON.stringify(artifact.tags ?? []) !==
          JSON.stringify(operation.input.tags)
      )
        throw new Error(
          "The saved artifact topics did not match the requested change.",
        );
      const matchesPatch = (content: unknown) => {
        const changes = operation.input.contentPatch?.changes ?? [];
        if (changes.length === 0) return true;
        let matched = 0;
        for (const change of changes) {
          const sheetsCanonical = canonicalizeSheetsPatchChange(change);
          const canonical = canonicalizeWhiteboardPatchChange(
            content,
            sheetsCanonical,
          );
          const savedValue = readContentPointer(content, canonical.path);
          if (
            contentPatchChangeMatchesSaved(
              canonical.path,
              canonical.value,
              savedValue,
              {
                blueprintKey: operation.input.blueprintKey,
                artifactContent: content,
              },
            ) ||
            (operation.input.blueprintKey === "document" &&
              authoredValueLandedInContent(canonical.value, content))
          ) {
            matched += 1;
            continue;
          }
          return false;
        }
        return matched === changes.length;
      };
      if (matchesPatch(artifact.content)) continue;
      // Convex projection can lag the acknowledged Yjs commit. Prefer the live
      // collaborative document, then briefly re-poll Convex before failing a
      // successful apply.
      const live = await readLiveArtifactValue({
        artifactId,
        timeoutMs: 4_000,
      }).catch((error) => {
        console.warn("[spectra.verify.live_read_failed]", {
          artifactId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
      if (live && matchesPatch(live.content)) continue;
      if (live) {
        console.warn("[spectra.verify.live_mismatch]", {
          artifactId,
          changes: (operation.input.contentPatch?.changes ?? []).map(
            (change) => ({
              path: change.path,
              authoredType: typeof change.value,
              authored:
                typeof change.value === "string"
                  ? change.value.slice(0, 160)
                  : undefined,
            }),
          ),
        });
      }
      const projectionDeadline = Date.now() + 3_500;
      let matched = false;
      while (Date.now() < projectionDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        artifact = await loadSaved();
        if (matchesPatch(artifact.content)) {
          matched = true;
          break;
        }
      }
      if (matched) continue;
      throw new Error(
        "The saved artifact did not contain the requested content change.",
      );
    }
  }
}
