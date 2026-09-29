import { runLog } from "@/features/spectra/ai/run-log";
import { query } from "./io";
import { normalizeArtifactContent } from "@/features/spectra/ai/content-normalization";
import { latestNativeWritePerReplica } from "@/features/spectra/ai/native-write-status";
import { documentAcademicOperationsLanded } from "@/features/spectra/commands/office/document-academic-operations";
import {
  authoredValueLandedInContent,
  contentPatchChangeMatchesSaved,
} from "@/features/spectra/ai/content-patch-verify";
import { readResolvedContentPointer } from "@/features/spectra/ai/document-content-patch";
import { canonicalizeSheetsPatchChange } from "@/features/spectra/ai/sheets-content-patch";
import { canonicalizeWhiteboardPatchChange } from "@/features/spectra/ai/whiteboard-content-patch";
import { readLiveArtifactValue } from "@/features/spectra/ai/yjs-artifact-operation";
import { validateBlueprintContent } from "@/features/spectra/artifacts/blueprint-catalog";
import { canonicalJsonEqual } from "@/features/spectra/collaboration/artifact-yjs-model";
import {
  normalizeAiArtifactWriteContent,
  validateAiArtifactWriteContent,
} from "@/features/spectra/operations/artifact-write-content";
import {
  hollowCreateFailureMessage,
  isHollowCreateContent,
} from "@/features/spectra/operations/hollow-content";
import { isQuietRetryableApplyFailure } from "@/features/spectra/operations/plan-diagnostics";
import { SPECTRA_BLUEPRINT_KEYS } from "@/features/spectra/operations/schema";
import type { ModelOperation } from "@/features/spectra/operations/schema";
import { assertArtifactQuality } from "@/features/spectra/quality/rubrics";
import {
  contentHash,
  verifyCitation,
  type EvidenceSpan,
  type SourceRecord,
  type VerifiedCitation,
} from "@/features/spectra/sources/records";

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

async function assertNativeReplicaHonest(artifactId: string) {
  const truth = await query<
    { workId: string },
    {
      replicas: Array<{
        _id?: string;
        kind?: string;
        state?: string;
        nativeFormat?: string;
      }>;
      recentOperations?: Array<{
        direction?: string;
        state?: string;
        errorCode?: string;
        replicaId?: string;
        createdAt?: number;
        updatedAt?: number;
      }>;
    }
  >("replicas:forWork", { workId: artifactId }).catch(() => null);
  if (!truth) return;
  const locals = (truth.replicas ?? []).filter(
    (replica) =>
      replica.kind === "local" &&
      replica.state !== "unavailable" &&
      replica.nativeFormat,
  );
  if (locals.length === 0) return;
  if (locals.some((replica) => replica.state === "error"))
    throw new Error(
      "NATIVE_VERIFY_FAILED: Spectra saved the edit, but the Office file on this PC reported an error and was not updated.",
    );
  const localReplicaIds = locals
    .map((replica) => replica._id)
    .filter((replicaId): replicaId is string => Boolean(replicaId));
  const failedWrite = latestNativeWritePerReplica(
    truth.recentOperations ?? [],
    localReplicaIds,
  ).find((operation) => operation.state === "failed");
  if (failedWrite)
    throw new Error(
      "NATIVE_VERIFY_FAILED: Spectra saved the edit, but writing the Office file on this PC failed.",
    );
}

function artifactHasNativeBacking(artifact: Record<string, unknown>) {
  const nativeFormat = artifact.nativeFormat;
  if (typeof nativeFormat === "string" && nativeFormat.trim()) return true;
  return artifact.compatibilityProfile === "strict-native" ||
    artifact.compatibilityProfile === "enhanced";
}

export async function committedCreatesAreUsable(
  actorClerkId: string,
  outcomes: Array<{
    operation: ModelOperation;
    affected: Array<{ type: string; id: string }>;
  }>,
  options: { requireResearchEvidence?: boolean; prompt?: string; numericSourceRequired?: boolean } = {},
) {
  const creates = outcomes.filter(
    (outcome) => outcome.operation.type === "artifact.create",
  );
  // A usable create cannot excuse a failed update, action or native write in
  // the same request. Every outcome must pass its own verification boundary.
  if (creates.length === 0 || creates.length !== outcomes.length) return false;
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
    if (options.requireResearchEvidence) {
      try {
        assertResearchEvidenceReadback(artifact);
      } catch {
        return false;
      }
    }
    try {
      assertArtifactQuality({ blueprintKey: operation.input.blueprintKey, content: artifact.content,
        prompt: options.prompt, numericSourceRequired: options.numericSourceRequired });
      if (artifactHasNativeBacking(artifact)) await assertNativeReplicaHonest(artifactId);
    } catch { return false; }
  }
  return true;
}

function assertResearchEvidenceReadback(artifact: Record<string, unknown>) {
  const createdFrom =
    artifact.createdFrom &&
    typeof artifact.createdFrom === "object" &&
    !Array.isArray(artifact.createdFrom)
      ? (artifact.createdFrom as Record<string, unknown>)
      : null;
  const bundle =
    createdFrom?.sourceBundle &&
    typeof createdFrom.sourceBundle === "object" &&
    !Array.isArray(createdFrom.sourceBundle)
      ? (createdFrom.sourceBundle as Record<string, unknown>)
      : null;
  const sources = Array.isArray(bundle?.sources)
    ? (bundle.sources as SourceRecord[])
    : [];
  const evidence = Array.isArray(bundle?.evidence)
    ? (bundle.evidence as EvidenceSpan[])
    : [];
  if (!sources.length || !evidence.length)
    throw new Error("RESEARCH_EVIDENCE_NOT_PERSISTED");
  const sourceIds = new Set(
    sources.filter((source) => source && typeof source.id === "string").map((source) => source.id),
  );
  const evidenceIds = new Set<string>();
  for (const span of evidence) {
    if (
      !span ||
      typeof span.id !== "string" ||
      typeof span.sourceId !== "string" ||
      !sourceIds.has(span.sourceId) ||
      !span.id.startsWith("evidence:") ||
      typeof span.excerpt !== "string" ||
      !span.excerpt.trim() ||
      contentHash(span.excerpt) !== span.excerptHash ||
      (span.startOffset !== undefined &&
        span.endOffset !== span.startOffset + span.excerpt.length)
    )
      throw new Error("RESEARCH_EVIDENCE_INVALID");
    evidenceIds.add(span.id);
  }
  if ([...sourceIds].some((id) => !id.startsWith("source:")))
    throw new Error("RESEARCH_SOURCE_HANDLE_INVALID");
  const citations = Array.isArray(bundle?.citations)
    ? (bundle.citations as VerifiedCitation[])
    : [];
  for (const citation of citations) {
    const source = sources.find((entry) => entry.id === citation.sourceId);
    if (
      !sourceIds.has(citation.sourceId) ||
      source?.verified !== true ||
      !citation.evidenceIds.length ||
      !citation.evidenceIds.every((id) => evidenceIds.has(id))
    )
      throw new Error("RESEARCH_CITATION_INVALID");
    verifyCitation(citation, sources, evidence);
  }
  return {
    sourceIds: [...sourceIds],
    evidenceIds: [...evidenceIds],
    partial: bundle?.partial === true,
    citationCount: citations.length,
  };
}

export async function verifyResearchEvidenceReadback(
  actorClerkId: string,
  artifactId: string,
) {
  const saved = await query<unknown & object, unknown>("spectraArtifacts:get", {
    actorClerkId,
    artifactId,
  });
  if (!saved || typeof saved !== "object")
    throw new Error("RESEARCH_EVIDENCE_ARTIFACT_MISSING");
  return assertResearchEvidenceReadback(saved as Record<string, unknown>);
}

type VerifiedOutcome = {
  operation: ModelOperation;
  affected: Array<{ type: string; id: string }>;
  /** Where each acknowledged append landed (change index -> element index),
   * recorded when the write was verified against its own result. A person's
   * later append then cannot hide or impersonate the AI's element. */
  appendedAt?: Record<number, number>;
};

function verifiedArtifactId(outcome: VerifiedOutcome) {
  const operation = outcome.operation;
  if (operation.type === "artifact.update" || operation.type === "artifact.archive")
    return operation.input.artifactId;
  if (operation.type === "artifact.create")
    return outcome.affected.find((item) => item.type === "artifact")?.id;
  return undefined;
}

function patchSegments(path: string) {
  return canonicalizeSheetsPatchChange({ path, value: null }).path
    .replace(/^\/content(?=\/)/, "")
    .split("/")
    .slice(1);
}

/** Two appends add distinct elements. An append may be the element a later
 * indexed or selected write addresses, so that pair is treated as overlapping. */
function patchPathsOverlap(earlier: string[], later: string[]) {
  const shared = Math.min(earlier.length, later.length);
  for (let index = 0; index < shared; index += 1) {
    const left = earlier[index]!;
    const right = later[index]!;
    if (left === "-" && right === "-") return false;
    // A later append adds a new last element and cannot reach an existing
    // index; a later index may still name the element an earlier append made.
    if (left !== right && left !== "-") return false;
  }
  return true;
}

type FinalObligation = {
  title: boolean;
  summary: boolean;
  tags: boolean;
  content: boolean;
  changes: Set<number>;
  /** Later retained appends to the same array, by change index. */
  laterAppends: Map<number, number>;
};

/**
 * The final predicates of each write in an ordered same-target sequence.
 * A later write to the same field, an overlapping content path, or a complete
 * replacement explicitly supersedes the earlier predicate; disjoint
 * obligations and every append remain required. Each write was verified
 * against its own result when it was acknowledged, and a later replacement is
 * itself verified as the complete intended value, so nothing is adopted
 * silently from an earlier write.
 */
export function finalVerificationObligations(outcomes: readonly VerifiedOutcome[]) {
  const obligations: FinalObligation[] = outcomes.map(() => ({
    title: true, summary: true, tags: true, content: true, changes: new Set<number>(), laterAppends: new Map(),
  }));
  const writes = outcomes.map((outcome, index) => {
    const operation = outcome.operation;
    if (operation.type !== "artifact.update") return null;
    const changes = operation.input.contentPatch?.changes ?? [];
    changes.forEach((_, changeIndex) => obligations[index]!.changes.add(changeIndex));
    return {
      target: verifiedArtifactId(outcome),
      input: operation.input,
      replaces: !operation.input.documentOperations && changes.length === 0 && operation.input.content !== null,
      paths: changes.map((change) => patchSegments(change.path)),
    };
  });
  const sequence = writes.flatMap((write, index) =>
    write ? write.paths.map((segments, changeIndex) => ({ index, changeIndex, segments, target: write.target })) : []);
  for (const [position, entry] of sequence.entries()) {
    for (const later of sequence.slice(position + 1)) {
      if (later.target === entry.target && patchPathsOverlap(entry.segments, later.segments))
        obligations[entry.index]!.changes.delete(entry.changeIndex);
    }
  }
  for (const [index, write] of writes.entries()) {
    if (!write) continue;
    const obligation = obligations[index]!;
    for (const later of writes.slice(index + 1)) {
      if (!later || later.target !== write.target) continue;
      if (later.input.title !== null) obligation.title = false;
      if (later.input.summary !== null) obligation.summary = false;
      if (later.input.tags !== null) obligation.tags = false;
      const laterWritesContent = later.replaces || later.paths.length > 0 || Boolean(later.input.documentOperations);
      if (later.replaces) {
        obligation.content = false;
        obligation.changes.clear();
      } else if (write.replaces && laterWritesContent) obligation.content = false;
    }
  }
  // An append names the last element only until another append follows it.
  for (const [position, entry] of sequence.entries()) {
    if (entry.segments.at(-1) !== "-" || !obligations[entry.index]!.changes.has(entry.changeIndex)) continue;
    const parent = entry.segments.slice(0, -1).join("/");
    const following = sequence.slice(position + 1).filter((later) =>
      later.target === entry.target && later.segments.at(-1) === "-" &&
      later.segments.slice(0, -1).join("/") === parent &&
      obligations[later.index]!.changes.has(later.changeIndex)).length;
    if (following) obligations[entry.index]!.laterAppends.set(entry.changeIndex, following);
  }
  return obligations;
}

type VerificationOptions = { requireResearchEvidence?: boolean; prompt?: string; numericSourceRequired?: boolean };

/**
 * Verify one acknowledged update against its own result right after it was
 * applied, on the first run and on a resumed one alike. This is where each
 * acknowledged append's landing position is recorded, so a person's later
 * append to the same list cannot fail final verification. An acknowledged
 * edit may already have been changed by a collaborator, so one quiet readback
 * retry follows; a mismatch never authorizes overwriting or replaying.
 */
export async function verifyAcknowledgedUpdate(
  actorClerkId: string,
  outcome: VerifiedOutcome,
  options: VerificationOptions = {},
) {
  if (outcome.operation.type !== "artifact.update") return;
  try {
    await verifyCommittedOutcomes(actorClerkId, [outcome], options);
  } catch (firstVerifyError) {
    if (!isQuietRetryableApplyFailure(firstVerifyError)) throw firstVerifyError;
    await new Promise((resolve) => setTimeout(resolve, 400));
    await verifyCommittedOutcomes(actorClerkId, [outcome], options);
  }
}

export async function verifyCommittedOutcomes(
  actorClerkId: string,
  outcomes: VerifiedOutcome[],
  options: VerificationOptions = {},
) {
  const obligations = finalVerificationObligations(outcomes);
  for (const [outcomeIndex, outcome] of outcomes.entries()) {
    const operation = outcome.operation;
    const obligation = obligations[outcomeIndex]!;
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
      if (operation.type === "artifact.create") {
        assertArtifactQuality({
          blueprintKey,
          content: artifact.content,
          prompt: options.prompt,
          numericSourceRequired: options.numericSourceRequired,
        });
        // Spectra-native artifacts can have stale local replica rows left by
        // an earlier Bridge session, but their canonical save is complete and
        // must not be failed by an unrelated native-file observer. Native
        // verification belongs to artifacts that are explicitly backed by a
        // native format.
        if (artifactHasNativeBacking(artifact))
          await assertNativeReplicaHonest(artifactId);
      }
      if (options.requireResearchEvidence)
        assertResearchEvidenceReadback(artifact);
    }
    if (operation.type === "artifact.update") {
      if (
        obligation.title &&
        operation.input.title !== null &&
        artifact.title !== operation.input.title
      )
        throw new Error(
          "The saved artifact title did not match the requested change.",
        );
      if (
        obligation.summary &&
        operation.input.summary !== null &&
        artifact.summary !== operation.input.summary
      )
        throw new Error(
          "The saved artifact summary did not match the requested change.",
        );
      if (
        obligation.tags &&
        operation.input.tags !== null &&
        JSON.stringify(artifact.tags ?? []) !==
          JSON.stringify(operation.input.tags)
      )
        throw new Error(
          "The saved artifact topics did not match the requested change.",
        );
      const changes = operation.input.contentPatch?.changes ?? [];
      const replacesContent = !operation.input.documentOperations &&
        changes.length === 0 && operation.input.content !== null;
      const expectedContent = replacesContent ? normalizeAiArtifactWriteContent(
        operation.input.blueprintKey, operation.input.content, options.prompt ?? "",
      ) : undefined;
      const matchesContent = (content: unknown) => {
        // A later complete replacement supersedes academic operations too.
        if (operation.input.documentOperations)
          return !obligation.content && changes.length === 0 ||
            documentAcademicOperationsLanded(content, operation.input.documentOperations);
        if (replacesContent) {
          if (!obligation.content) return true;
          // Compare complete normalized values: subset/substring matching loses
          // deletions and extra keys. Repair policy applies only to the request;
          // repairing observed content could hide missing saved work. Add no
          // exclusions for generated Foundry dates or native binding metadata.
          try {
            return canonicalJsonEqual(expectedContent,
              validateAiArtifactWriteContent(operation.input.blueprintKey, content));
          } catch {
            return false;
          }
        }
        if (changes.length === 0) return true;
        for (const [changeIndex, change] of changes.entries()) {
          if (!obligation.changes.has(changeIndex)) continue;
          const sheetsCanonical = canonicalizeSheetsPatchChange(change);
          const canonical = canonicalizeWhiteboardPatchChange(
            content,
            sheetsCanonical,
          );
          const laterAppends = obligation.laterAppends.get(changeIndex) ?? 0;
          const acknowledgedAt = outcome.appendedAt?.[changeIndex];
          const appendedTo = canonical.path.endsWith("/-") &&
            (laterAppends > 0 || acknowledgedAt !== undefined)
            ? readContentPointer(content, canonical.path.slice(0, -2))
            : undefined;
          // The acknowledged position is exact. Without it, later AI appends
          // follow this one, so its element is no longer last.
          const position = Array.isArray(appendedTo)
            ? acknowledgedAt ?? appendedTo.length - (laterAppends + 1)
            : undefined;
          const savedValue = Array.isArray(appendedTo)
            ? appendedTo[position!]
            : readContentPointer(content, canonical.path);
          if (
            contentPatchChangeMatchesSaved(
              canonical.path,
              canonical.value,
              savedValue,
              {
                blueprintKey: operation.input.blueprintKey,
                artifactContent: content,
              },
            )
          ) {
            if (canonical.path.endsWith("/-") && acknowledgedAt === undefined) {
              const list = readContentPointer(content, canonical.path.slice(0, -2));
              if (Array.isArray(list))
                (outcome.appendedAt ??= {})[changeIndex] = position ?? list.length - 1;
            }
            continue;
          }
          if (
            (operation.input.blueprintKey === "document" &&
              authoredValueLandedInContent(canonical.value, content))
          ) {
            continue;
          }
          return false;
        }
        return true;
      };
      if (matchesContent(artifact.content)) {
        if (artifactHasNativeBacking(artifact))
          await assertNativeReplicaHonest(artifactId);
        continue;
      }
      // Convex projection can lag the acknowledged Yjs commit. Prefer the live
      // collaborative document, then briefly re-poll Convex before failing a
      // successful apply.
      const live = await readLiveArtifactValue({
        artifactId,
        timeoutMs: 4_000,
      }).catch((error) => {
        runLog().warn("spectra.verify.live_read_failed", {
          artifactId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
      if (live && matchesContent(live.content)) {
        if (artifactHasNativeBacking(artifact))
          await assertNativeReplicaHonest(artifactId);
        continue;
      }
      if (live) {
        runLog().warn("spectra.verify.live_mismatch", {
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
        if (matchesContent(artifact.content)) {
          matched = true;
          break;
        }
      }
      if (matched) {
        if (artifactHasNativeBacking(artifact))
          await assertNativeReplicaHonest(artifactId);
        continue;
      }
      throw new Error(
        "The saved artifact did not contain the requested content change.",
      );
    }
  }
}
