import { buildContext } from "./gather";
import { provisionalSingleCreation } from "./intake";
import { remapDocumentSectionRewriteChanges } from "@/features/spectra/ai/document-content-patch";
import { PRESENTATION_LAYOUT_IDS } from "@/features/spectra/presentation/layouts";
import {
  promoteMatchingUpdateToCreate,
  promptLooksLikeFocusedStructuralEdit,
  promptLooksLikeFreshCreate,
} from "@/features/spectra/operations/intent-alignment";
import { formatPlanApplicationPublicError } from "@/features/spectra/operations/plan-diagnostics";
import {
  SPECTRA_BLUEPRINT_KEYS,
  parseModelOperation,
  parseSpectraPlan,
} from "@/features/spectra/operations/schema";
import type {
  ModelOperation,
  SpectraPlan,
} from "@/features/spectra/operations/schema";
import { validatePlanAgainstIntent } from "@/features/spectra/operations/validate-plan";
import type { OwnedOperationReferences } from "@/features/spectra/operations/validate-plan";
import { isCalendarMutationCommand } from "@/features/spectra/calendar/domain/command";

export function ownedReferences(
  context: Awaited<ReturnType<typeof buildContext>>,
): OwnedOperationReferences {
  const artifactIds = new Set<string>();
  const artifactBlueprints = new Map<string, string>();
  const workspaceIds = new Set<string>();
  const placementNodes = new Map<
    string,
    { artifactId?: string; workspaceId: string }
  >();
  for (const workspace of context.workspaces)
    if (typeof workspace.id === "string") workspaceIds.add(workspace.id);
  for (const artifact of context.artifacts) {
    if (typeof artifact.id === "string") {
      artifactIds.add(artifact.id);
      if (typeof artifact.blueprintKey === "string")
        artifactBlueprints.set(artifact.id, artifact.blueprintKey);
    }
    for (const placement of artifact.placements) {
      if (typeof placement.workspaceId === "string")
        workspaceIds.add(placement.workspaceId);
      if (
        typeof placement.nodeId === "string" &&
        typeof placement.workspaceId === "string"
      )
        placementNodes.set(placement.nodeId, {
          artifactId: typeof artifact.id === "string" ? artifact.id : undefined,
          workspaceId: placement.workspaceId,
        });
    }
  }
  if (
    context.focusedArtifact &&
    typeof context.focusedArtifact.id === "string"
  ) {
    artifactIds.add(context.focusedArtifact.id);
    if (typeof context.focusedArtifact.blueprintKey === "string")
      artifactBlueprints.set(
        context.focusedArtifact.id,
        context.focusedArtifact.blueprintKey,
      );
  }
  if (
    context.currentWorkspace?.id &&
    typeof context.currentWorkspace.id === "string"
  )
    workspaceIds.add(context.currentWorkspace.id);
  for (const item of context.currentWorkspace?.items ?? []) {
    if (typeof item.id === "string" && typeof item.workspaceId === "string")
      placementNodes.set(item.id, {
        artifactId:
          item.kind === "work" && typeof item.sourceId === "string"
            ? item.sourceId
            : undefined,
        workspaceId: item.workspaceId,
      });
  }
  return {
    artifactIds,
    artifactBlueprints,
    workspaceIds,
    placementNodes,
    threadIds: new Set([
      ...context.threads.flatMap((thread) =>
        typeof thread.id === "string" ? [thread.id] : [],
      ),
      ...(context.currentThreadId ? [context.currentThreadId] : []),
    ]),
  };
}

export function normalizedReference(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function resolveNamedReference(
  value: string | null | undefined,
  candidates: Array<{ id: unknown; title: unknown }>,
) {
  if (!value) return value;
  const valid = candidates.flatMap((candidate) =>
    typeof candidate.id === "string" && typeof candidate.title === "string"
      ? [{ id: candidate.id, title: candidate.title }]
      : [],
  );
  if (valid.some((candidate) => candidate.id === value)) return value;
  const needle = normalizedReference(value);
  if (!needle) return value;
  const exact = valid.filter(
    (candidate) => normalizedReference(candidate.title) === needle,
  );
  if (exact.length === 1) return exact[0]!.id;
  if (needle.length < 5) return value;
  const contained = valid.filter((candidate) => {
    const title = normalizedReference(candidate.title);
    return title.includes(needle) || needle.includes(title);
  });
  return contained.length === 1 ? contained[0]!.id : value;
}

/**
 * Resolve a workspace named in the user's request even when the model omitted
 * or malformed the destination field. This is title-based only for owned
 * workspace candidates; it never turns an arbitrary string into a database id.
 * The longest matching title wins so "Chemistry Lab" is not shadowed by a
 * broader "Lab" workspace.
 */
/**
 * True when the prompt places new work into the named workspace, not when the
 * workspace is only a source/context mention ("from Chemistry Lab", "using
 * Biology notes"). Mentions alone must not rewrite create destinations.
 */
export function promptPlacesIntoWorkspace(prompt: string, workspaceTitle: string) {
  const promptKey = normalizedReference(prompt);
  const titleKey = normalizedReference(workspaceTitle);
  if (!promptKey || titleKey.length < 3 || !containsNormalizedPhrase(promptKey, titleKey))
    return false;
  const escaped = titleKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const destinationNearTitle = new RegExp(
    `\\b(?:in|into|inside|under|within|onto|to)\\s+${escaped}\\b`,
  );
  const placeVerbNearTitle = new RegExp(
    `\\b(?:put|place|save|add|move|create|make|build|draft|write)\\b[\\s\\S]{0,96}\\b(?:in|into|inside|under|within|onto|to)\\s+${escaped}\\b`,
  );
  if (!destinationNearTitle.test(promptKey) && !placeVerbNearTitle.test(promptKey))
    return false;
  const sourceOnly = new RegExp(
    `\\b(?:from|using|based on|with material from|copied from)\\s+${escaped}\\b`,
  );
  // "from X into Y" still has a destination; only reject pure source mentions.
  if (sourceOnly.test(promptKey) && !destinationNearTitle.test(promptKey))
    return false;
  return true;
}

export function resolveWorkspaceMention(
  prompt: string,
  candidates: Array<{ id: unknown; title: unknown }>,
  options?: { requireDestinationLanguage?: boolean },
) {
  const promptKey = normalizedReference(prompt);
  if (!promptKey) return undefined;
  const requireDestination = options?.requireDestinationLanguage === true;
  const matches = candidates.flatMap((candidate) => {
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.title !== "string"
    )
      return [];
    const titleKey = normalizedReference(candidate.title);
    if (titleKey.length < 3 || !containsNormalizedPhrase(promptKey, titleKey))
      return [];
    if (requireDestination && !promptPlacesIntoWorkspace(prompt, candidate.title))
      return [];
    return [{ id: candidate.id, length: titleKey.length }];
  });
  if (!matches.length) return undefined;
  const longest = Math.max(...matches.map((match) => match.length));
  const strongest = matches.filter((match) => match.length === longest);
  return strongest.length === 1 ? strongest[0]!.id : undefined;
}

export type ArtifactTargetCandidate = {
  id: string;
  title: string;
  blueprintKey?: string;
  summary?: string;
  updatedAt?: number;
  placements: Array<{ workspaceId?: unknown; workspaceTitle?: unknown }>;
  confidence: number;
  reasons: string[];
};

export type ArtifactTargetResolution = {
  role: string;
  requestedReference: string | null;
  blueprintKey?: string;
  status: "resolved" | "ambiguous" | "missing";
  confidence: number;
  resolvedArtifactId?: string;
  resolvedTitle?: string;
  candidates: ArtifactTargetCandidate[];
};

export type ResolvedPlan = {
  plan: SpectraPlan;
  targetResolutions: ArtifactTargetResolution[];
};

type ArtifactCandidateSource = {
  id: unknown;
  title: unknown;
  blueprintKey?: unknown;
  type?: unknown;
  summary?: unknown;
  updatedAt?: unknown;
  placements?: unknown;
};

const TARGET_TOKEN_STOP_WORDS = new Set([
  "artifact",
  "document",
  "file",
  "notes",
  "note",
  "deck",
  "presentation",
  "slides",
  "sheet",
  "workbook",
  "quiz",
  "task",
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
]);

function referenceTokens(value: string) {
  return normalizedReference(value)
    .split(" ")
    .filter(
      (token) => token.length >= 3 && !TARGET_TOKEN_STOP_WORDS.has(token),
    );
}

function targetCandidatesFromSources(sources: ArtifactCandidateSource[]) {
  return sources.flatMap((source) => {
    if (typeof source.id !== "string" || typeof source.title !== "string")
      return [];
    const placements = Array.isArray(source.placements)
      ? source.placements.filter(
          (placement): placement is Record<string, unknown> =>
            Boolean(placement) && typeof placement === "object",
        )
      : [];
    return [
      {
        id: source.id,
        title: source.title,
        blueprintKey:
          typeof (source.blueprintKey ?? source.type) === "string"
            ? String(source.blueprintKey ?? source.type)
            : undefined,
        summary:
          typeof source.summary === "string" ? source.summary : undefined,
        updatedAt:
          typeof source.updatedAt === "number" ? source.updatedAt : undefined,
        placements,
      },
    ];
  });
}

function candidatesFromPacket(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  const workspaceIndex = Array.isArray(record.workspaceIndex)
    ? (record.workspaceIndex as ArtifactCandidateSource[])
    : [];
  const artifacts = Array.isArray(record.artifacts)
    ? (record.artifacts as ArtifactCandidateSource[])
    : [];
  return targetCandidatesFromSources([...workspaceIndex, ...artifacts]).filter(
    (candidate, index, all) =>
      all.findIndex((item) => item.id === candidate.id) === index,
  );
}

function containsNormalizedPhrase(haystack: string, needle: string) {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

function promptHasDeicticTarget(prompt: string) {
  return (
    /\b(?:this|the open|the current|the visible|the selected)\s+(?:artifact|document|file|note|deck|presentation|slides?|sheet|workbook|quiz|task|whiteboard|code)\b/i.test(
      prompt,
    ) ||
    /\b(?:rewrite|replace|edit|update|change|set|repair|fix|add|remove|rename)\s+(?:this|it|that)\b/i.test(
      prompt,
    )
  );
}

export function promptExplicitlyTargetsFocusedArtifact(
  prompt: string,
  context: unknown,
) {
  if (!context || typeof context !== "object" || Array.isArray(context))
    return false;
  const record = context as Record<string, unknown>;
  const focused =
    record.focusedArtifact &&
    typeof record.focusedArtifact === "object" &&
    !Array.isArray(record.focusedArtifact)
      ? (record.focusedArtifact as Record<string, unknown>)
      : null;
  if (typeof focused?.id !== "string" || typeof focused.title !== "string")
    return false;
  const candidates = candidatesFromPacket(record);
  const promptKey = normalizedReference(prompt);
  const focusedTitle = normalizedReference(focused.title);
  const namedOther = candidates.some(
    (candidate) =>
      candidate.id !== focused.id &&
      normalizedReference(candidate.title) !== focusedTitle &&
      normalizedReference(candidate.title).length >= 3 &&
      containsNormalizedPhrase(promptKey, normalizedReference(candidate.title)),
  );
  if (namedOther) return false;
  if (
    normalizedReference(focused.title).length >= 3 &&
    containsNormalizedPhrase(promptKey, normalizedReference(focused.title))
  )
    return true;
  if (promptHasDeicticTarget(prompt)) return true;
  // A region-specific command in Artifact Studio is an explicit reference to
  // the visible structure only when no other titled artifact was named.
  return (
    /\b(?:rewrite|replace|edit|update|change|set|repair|fix|add|remove|rename|improve|write|draft|make|transform)\b/i.test(
      prompt,
    ) &&
    /\b(?:title|summary|tag|hint|memory cue|answer|question|card|paragraph|heading|section|block|cell|row|column|sheet|slide|speaker notes?|object|node|subtask|deadline|due (?:date|time)|progress note|status|priority)\b/i.test(
      prompt,
    )
  );
}

function selectedArtifactIds(
  context: Awaited<ReturnType<typeof buildContext>>,
) {
  return new Set(context.selectedArtifactIds);
}

export function resolveArtifactTarget(input: {
  prompt: string;
  reference?: string | null;
  blueprintKey?: string;
  role: string;
  candidates: Array<Omit<ArtifactTargetCandidate, "confidence" | "reasons">>;
  focusedArtifactId?: string | null;
  selectedArtifactIds?: Iterable<string>;
  threadAttachmentArtifactId?: string | null;
}): ArtifactTargetResolution {
  const promptKey = normalizedReference(input.prompt);
  const referenceKey = input.reference
    ? normalizedReference(input.reference)
    : "";
  const selected = new Set(input.selectedArtifactIds ?? []);
  const filtered = input.candidates.filter(
    (candidate) =>
      !input.blueprintKey || candidate.blueprintKey === input.blueprintKey,
  );
  const newest = Math.max(
    0,
    ...filtered.map((candidate) => candidate.updatedAt ?? 0),
  );
  const explicitFocus = promptExplicitlyTargetsFocusedArtifact(input.prompt, {
    focusedArtifact: filtered.find(
      (candidate) => candidate.id === input.focusedArtifactId,
    ),
    workspaceIndex: filtered,
  });
  const focusedCandidate = filtered.find(
    (candidate) => candidate.id === input.focusedArtifactId,
  );
  if (explicitFocus && focusedCandidate) {
    // The selected/open artifact is the user's disambiguator when duplicate
    // library items share a title. A model's fuzzy title reference must not
    // turn that clear in-app context into a dead-end clarification.
    return {
      role: input.role,
      requestedReference: input.reference ?? null,
      blueprintKey: input.blueprintKey,
      status: "resolved",
      confidence: 1,
      resolvedArtifactId: focusedCandidate.id,
      resolvedTitle: focusedCandidate.title,
      candidates: [
        {
          ...focusedCandidate,
          confidence: 1,
          reasons: ["request targets the visible work"],
        },
      ],
    };
  }
  const promptNamed = filtered.filter((candidate) => {
    const titleKey = normalizedReference(candidate.title);
    return (
      titleKey.length >= 3 && containsNormalizedPhrase(promptKey, titleKey)
    );
  });
  const scored = filtered
    .map((candidate) => {
      const reasons: string[] = [];
      const titleKey = normalizedReference(candidate.title);
      const titleTokens = referenceTokens(candidate.title);
      const promptTokenSet = new Set(referenceTokens(input.prompt));
      const matchedTitleTokens = titleTokens.filter((token) =>
        promptTokenSet.has(token),
      ).length;
      const titleCoverage =
        titleTokens.length > 0 ? matchedTitleTokens / titleTokens.length : 0;
      const summaryTokens = referenceTokens(candidate.summary ?? "");
      const summaryCoverage =
        summaryTokens.length > 0
          ? summaryTokens.filter((token) => promptTokenSet.has(token)).length /
            Math.min(8, summaryTokens.length)
          : 0;
      let confidence = 0;
      if (titleKey && containsNormalizedPhrase(promptKey, titleKey)) {
        confidence += 0.94;
        reasons.push("title named in request");
      } else if (titleTokens.length >= 2 && titleCoverage === 1) {
        confidence += 0.82;
        reasons.push("all distinctive title words matched");
      } else if (matchedTitleTokens >= 2) {
        confidence += Math.min(0.68, 0.32 + titleCoverage * 0.42);
        reasons.push("partial title match");
      }
      if (input.reference === candidate.id) {
        confidence +=
          (promptNamed.length > 0 &&
            !promptNamed.some((named) => named.id === candidate.id)) ||
          (candidate.id === input.focusedArtifactId && !explicitFocus)
            ? 0.12
            : 0.48;
        reasons.push("planned owned id");
      } else if (referenceKey && referenceKey === titleKey) {
        confidence += 0.94;
        reasons.push("planned title matched exactly");
      }
      if (explicitFocus && candidate.id === input.focusedArtifactId) {
        confidence += 0.96;
        reasons.push("request explicitly refers to visible work");
      } else if (candidate.id === input.focusedArtifactId) {
        confidence += 0.05;
        reasons.push("visible work prior");
      }
      if (selected.has(candidate.id)) {
        confidence += 0.3;
        reasons.push("explicit selection prior");
      }
      if (candidate.id === input.threadAttachmentArtifactId) {
        confidence +=
          !input.focusedArtifactId && promptHasDeicticTarget(input.prompt)
            ? 0.72
            : 0.04;
        reasons.push("thread attachment prior");
      }
      if (summaryCoverage > 0) {
        confidence += Math.min(0.14, summaryCoverage * 0.14);
        reasons.push("summary terms matched");
      }
      if (newest > 0 && candidate.updatedAt === newest) {
        confidence += 0.025;
        reasons.push("recent work prior");
      }
      return {
        ...candidate,
        confidence,
        reasons,
      };
    })
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        (right.updatedAt ?? 0) - (left.updatedAt ?? 0) ||
        left.title.localeCompare(right.title),
    );
  for (const candidate of scored)
    candidate.confidence = Math.min(1, candidate.confidence);
  const top = scored[0];
  if (!top)
    return {
      role: input.role,
      requestedReference: input.reference ?? null,
      blueprintKey: input.blueprintKey,
      status: "missing",
      confidence: 0,
      candidates: [],
    };
  const second = scored[1];
  const duplicateNamedTitle =
    promptNamed.length > 1 &&
    promptNamed.some(
      (candidate) =>
        candidate.id !== top.id &&
        normalizedReference(candidate.title) === normalizedReference(top.title),
    );
  const exactOwnedReference = input.reference
    ? scored.find((candidate) => candidate.id === input.reference)
    : undefined;
  // An exact id that came from the owned candidate packet is already
  // permission-checked evidence. Do not run it through the fuzzy title
  // ambiguity threshold: opaque ids have no title tokens and otherwise score
  // below the generic 0.76 cutoff even though they are the safest target.
  const namedDifferentArtifact = promptNamed.some(
    (candidate) => candidate.id !== input.reference,
  );
  if (exactOwnedReference && !namedDifferentArtifact) {
    return {
      role: input.role,
      requestedReference: input.reference ?? null,
      blueprintKey: input.blueprintKey,
      status: "resolved",
      confidence: 1,
      resolvedArtifactId: exactOwnedReference.id,
      resolvedTitle: exactOwnedReference.title,
      candidates: scored.slice(0, 6),
    };
  }
  const strongCompositeEvidence =
    top.reasons.includes("title named in request") &&
    top.reasons.includes("planned owned id");
  const ambiguous =
    duplicateNamedTitle ||
    top.confidence < 0.76 ||
    (!strongCompositeEvidence &&
      Boolean(second) &&
      second!.confidence >= 0.7 &&
      top.confidence - second!.confidence < 0.1);
  return {
    role: input.role,
    requestedReference: input.reference ?? null,
    blueprintKey: input.blueprintKey,
    status: ambiguous ? "ambiguous" : "resolved",
    confidence: top.confidence,
    ...(ambiguous
      ? {}
      : {
          resolvedArtifactId: top.id,
          resolvedTitle: top.title,
        }),
    candidates: scored.slice(0, 6),
  };
}

export function resolvePlanReferences(
  plan: SpectraPlan,
  context: Awaited<ReturnType<typeof buildContext>>,
) {
  const next = structuredClone(plan) as SpectraPlan;
  const artifactCandidates = context.artifacts.map((artifact) => ({
    id: artifact.id,
    title: artifact.title,
  }));
  const workspaceCandidates = [
    ...context.workspaces.map((workspace) => ({
      id: workspace.id,
      title: workspace.title,
    })),
    ...(context.currentWorkspace
      ? [
          {
            id: context.currentWorkspace.id,
            title: context.currentWorkspace.title,
          },
        ]
      : []),
  ];
  const threadCandidates = context.threads.map((thread) => ({
    id: thread.id,
    title: thread.title,
  }));
  const resolveArtifact = (value: string | null | undefined) =>
    resolveNamedReference(value, artifactCandidates);
  const resolveWorkspace = (value: string | null | undefined) =>
    resolveNamedReference(value, workspaceCandidates);
  const resolveThread = (value: string | null | undefined) =>
    resolveNamedReference(value, threadCandidates);
  next.intent.targetArtifactId =
    resolveArtifact(next.intent.targetArtifactId) ?? null;
  next.intent.targetWorkspaceId =
    resolveWorkspace(next.intent.targetWorkspaceId) ?? null;
  for (const operation of next.operations) {
    if (operation.type === "artifact.create") {
      operation.input.workspaceId =
        resolveWorkspace(operation.input.workspaceId) ?? null;
      if (operation.input.blueprintKey === "planner_task") {
        operation.input.content.linkedArtifactIds = (
          operation.input.content.linkedArtifactIds ?? []
        ).map((id) => resolveArtifact(id) ?? id);
        operation.input.content.linkedThreadIds = (
          operation.input.content.linkedThreadIds ?? []
        ).map((id) => resolveThread(id) ?? id);
      }
    } else if (operation.type === "artifact.update") {
      operation.input.artifactId =
        resolveArtifact(operation.input.artifactId) ??
        operation.input.artifactId;
    } else if (operation.type === "workspace.update") {
      operation.input.workspaceId =
        resolveWorkspace(operation.input.workspaceId) ??
        operation.input.workspaceId;
    } else if (operation.type === "workspaceItem.add") {
      operation.input.artifactId =
        resolveArtifact(operation.input.artifactId) ??
        operation.input.artifactId;
      operation.input.workspaceId =
        resolveWorkspace(operation.input.workspaceId) ??
        operation.input.workspaceId;
    } else if (operation.type === "workspaceItem.hide") {
      if (
        !context.currentWorkspace?.items.some(
          (item) => item.id === operation.input.nodeId,
        )
      ) {
        const artifactId = resolveArtifact(operation.input.nodeId);
        const matches =
          context.currentWorkspace?.items.filter(
            (item) => item.kind === "work" && item.sourceId === artifactId,
          ) ?? [];
        if (matches.length === 1 && typeof matches[0]!.id === "string")
          operation.input.nodeId = matches[0]!.id;
      }
    } else if (operation.type === "workspaceItem.setPinned") {
      if (
        !context.currentWorkspace?.items.some(
          (item) => item.id === operation.input.nodeId,
        )
      ) {
        const artifactId = resolveArtifact(operation.input.nodeId);
        const matches =
          context.currentWorkspace?.items.filter(
            (item) => item.sourceId === artifactId,
          ) ?? [];
        if (matches.length === 1 && typeof matches[0]!.id === "string")
          operation.input.nodeId = matches[0]!.id;
      }
    } else if (operation.type === "artifact.link") {
      operation.input.sourceArtifactId =
        resolveArtifact(operation.input.sourceArtifactId) ??
        operation.input.sourceArtifactId;
      operation.input.targetArtifactId =
        resolveArtifact(operation.input.targetArtifactId) ??
        operation.input.targetArtifactId;
      operation.input.workspaceId =
        resolveWorkspace(operation.input.workspaceId) ?? null;
    }
  }
  return parseSpectraPlan(next);
}

function ownedArtifactTargetCandidates(
  context: Awaited<ReturnType<typeof buildContext>>,
) {
  return targetCandidatesFromSources(
    [
      ...context.artifacts,
      ...(context.focusedArtifact ? [context.focusedArtifact] : []),
    ].map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      blueprintKey: artifact.blueprintKey,
      summary: artifact.summary,
      updatedAt: artifact.updatedAt,
      placements: artifact.placements,
    })),
  ).filter(
    (candidate, index, all) =>
      all.findIndex((item) => item.id === candidate.id) === index,
  );
}

function candidateChoiceTitle(
  candidate: ArtifactTargetCandidate,
  candidates: ArtifactTargetCandidate[],
) {
  const duplicateTitle = candidates.some(
    (other) =>
      other.id !== candidate.id &&
      normalizedReference(other.title) === normalizedReference(candidate.title),
  );
  if (!duplicateTitle) return candidate.title.slice(0, 80);
  const workspace = candidate.placements.find(
    (placement) => typeof placement.workspaceTitle === "string",
  )?.workspaceTitle;
  const sameWorkspace = candidates.some(
    (other) =>
      other.id !== candidate.id &&
      normalizedReference(other.title) ===
        normalizedReference(candidate.title) &&
      other.placements.some(
        (placement) => placement.workspaceTitle === workspace,
      ),
  );
  const summary = candidate.summary?.trim().slice(0, 44);
  const sameSummary = Boolean(
    summary &&
    candidates.some(
      (other) =>
        other.id !== candidate.id &&
        normalizedReference(other.title) ===
          normalizedReference(candidate.title) &&
        normalizedReference(other.summary ?? "") ===
          normalizedReference(candidate.summary ?? ""),
    ),
  );
  const qualifier =
    typeof workspace === "string" && !sameWorkspace
      ? workspace
      : summary && !sameSummary
        ? summary
        : `copy ${candidates.indexOf(candidate) + 1}`;
  return `${candidate.title} (${qualifier})`.slice(0, 80);
}

function clarificationForTarget(
  plan: SpectraPlan,
  resolution: ArtifactTargetResolution,
) {
  const topConfidence = resolution.candidates[0]?.confidence ?? 0;
  const candidates = resolution.candidates
    .filter(
      (candidate) =>
        candidate.confidence >= Math.max(0.6, topConfidence - 0.18),
    )
    .slice(0, 6);
  const question = "Which Spectra work should I change?";
  return parseSpectraPlan({
    ...plan,
    decision: "clarify",
    intent: {
      ...plan.intent,
      targetArtifactId: null,
      // The mutation is deferred until the target is chosen; discard indexes
      // that referred to the operations removed from this clarification.
      obligations: undefined,
    },
    operations: [],
    choices:
      candidates.length >= 2
        ? {
            question,
            options: candidates.map((candidate) => ({
              key: candidate.id,
              title: candidateChoiceTitle(candidate, candidates),
              description: [
                candidate.blueprintKey?.replaceAll("_", " "),
                candidate.summary?.trim().slice(0, 160),
              ]
                .filter(Boolean)
                .join(": ")
                .slice(0, 240),
            })),
          }
        : null,
    finalResponse:
      candidates.length >= 2
        ? `${question} I found ${candidates.map((candidate) => `“${candidateChoiceTitle(candidate, candidates)}”`).join(", ")}.`
        : "I could not match that request to permissioned Spectra work. Name or select the work you want to change.",
  });
}

export function resolvePlanArtifactTargets(
  plan: SpectraPlan,
  context: Awaited<ReturnType<typeof buildContext>>,
  prompt: string,
): ResolvedPlan {
  let next = structuredClone(plan) as SpectraPlan;
  const candidates = ownedArtifactTargetCandidates(context);
  const focusedArtifactId =
    typeof context.focusedArtifact?.id === "string"
      ? context.focusedArtifact.id
      : null;
  const resolutions: ArtifactTargetResolution[] = [];
  const resolveReference = (
    reference: string | null | undefined,
    blueprintKey: string | undefined,
    role: string,
    createdBeforeOperationIndex?: number,
  ) => {
    const createdMatch = /^@created:(\d+)$/.exec(reference ?? "");
    if (createdMatch) {
      const creationIndex = Number(createdMatch[1]);
      const creation = next.operations[creationIndex];
      const validCreation =
        createdBeforeOperationIndex !== undefined &&
        creationIndex < createdBeforeOperationIndex &&
        creation?.type === "artifact.create";
      const resolution: ArtifactTargetResolution = validCreation
        ? {
            role,
            requestedReference: reference ?? null,
            blueprintKey: creation.input.blueprintKey,
            status: "resolved",
            confidence: 1,
            resolvedArtifactId: reference!,
            resolvedTitle: creation.input.title,
            candidates: [
              {
                id: reference!,
                title: creation.input.title,
                blueprintKey: creation.input.blueprintKey,
                summary: creation.input.summary ?? undefined,
                placements: [],
                confidence: 1,
                reasons: ["created earlier in this plan"],
              },
            ],
          }
        : {
            role,
            requestedReference: reference ?? null,
            blueprintKey,
            status: "missing",
            confidence: 0,
            candidates: [],
          };
      resolutions.push(resolution);
      return resolution;
    }
    const resolution = resolveArtifactTarget({
      prompt,
      reference,
      blueprintKey,
      role,
      candidates,
      focusedArtifactId,
      selectedArtifactIds: selectedArtifactIds(context),
      threadAttachmentArtifactId: context.threadAttachmentArtifactId,
    });
    resolutions.push(resolution);
    return resolution;
  };
  const operations = next.operations.map((operation, operationIndex) => {
    if (operation.type === "artifact.update") {
      const resolution = resolveReference(
        operation.input.artifactId,
        operation.input.blueprintKey,
        `operation:${operationIndex}:artifact.update`,
      );
      return resolution.status === "resolved"
        ? parseModelOperation({
            ...operation,
            input: {
              ...operation.input,
              artifactId: resolution.resolvedArtifactId,
            },
          })
        : operation;
    }
    if (operation.type === "artifact.archive") {
      const resolution = resolveReference(
        operation.input.artifactId,
        undefined,
        `operation:${operationIndex}:artifact.archive`,
      );
      return resolution.status === "resolved"
        ? parseModelOperation({
            ...operation,
            input: {
              ...operation.input,
              artifactId: resolution.resolvedArtifactId,
            },
          })
        : operation;
    }
    if (operation.type === "workspaceItem.add") {
      const resolution = resolveReference(
        operation.input.artifactId,
        undefined,
        `operation:${operationIndex}:workspaceItem.add`,
      );
      return resolution.status === "resolved"
        ? parseModelOperation({
            ...operation,
            input: {
              ...operation.input,
              artifactId: resolution.resolvedArtifactId,
            },
          })
        : operation;
    }
    if (operation.type === "artifact.link") {
      const source = resolveReference(
        operation.input.sourceArtifactId,
        undefined,
        `operation:${operationIndex}:artifact.link.source`,
        operationIndex,
      );
      const target = resolveReference(
        operation.input.targetArtifactId,
        undefined,
        `operation:${operationIndex}:artifact.link.target`,
        operationIndex,
      );
      return source.status === "resolved" && target.status === "resolved"
        ? parseModelOperation({
            ...operation,
            input: {
              ...operation.input,
              sourceArtifactId: source.resolvedArtifactId,
              targetArtifactId: target.resolvedArtifactId,
            },
          })
        : operation;
    }
    return operation;
  });
  next = parseSpectraPlan({ ...next, operations });
  const unresolved = resolutions.find(
    (resolution) => resolution.status !== "resolved",
  );
  if (unresolved?.status === "ambiguous" && unresolved.candidates.length >= 2)
    return {
      plan: clarificationForTarget(next, unresolved),
      targetResolutions: resolutions,
    };
  if (unresolved)
    throw new Error(
      "The requested artifactId target could not be resolved to a permissioned candidate.",
    );
  const updateTargets = [
    ...new Set(
      resolutions.flatMap((resolution) =>
        resolution.role.endsWith(":artifact.update") &&
        resolution.resolvedArtifactId
          ? [resolution.resolvedArtifactId]
          : [],
      ),
    ),
  ];
  const primary = resolutions.find(
    (resolution) => resolution.resolvedArtifactId,
  );
  // intent.targetArtifactId is a singular hint. Preserve it for one-target
  // updates, but do not overwrite an explicit multi-target update plan with
  // the first operation's id; the validator would then reject every later
  // target even though each operation resolved to permissioned work.
  if (updateTargets.length > 1)
    next = parseSpectraPlan({
      ...next,
      intent: { ...next.intent, targetArtifactId: null },
    });
  else if (updateTargets.length === 1)
    next = parseSpectraPlan({
      ...next,
      intent: { ...next.intent, targetArtifactId: updateTargets[0]! },
    });
  else if (primary?.resolvedArtifactId)
    next = parseSpectraPlan({
      ...next,
      intent: {
        ...next.intent,
        targetArtifactId: primary.resolvedArtifactId,
      },
    });
  return { plan: next, targetResolutions: resolutions };
}

export function narrateResolvedTargets(
  plan: SpectraPlan,
  resolutions: ArtifactTargetResolution[],
) {
  if (plan.decision !== "operate") return plan;
  const titles = [
    ...new Set(
      resolutions.flatMap((resolution) =>
        resolution.status === "resolved" && resolution.resolvedTitle
          ? [resolution.resolvedTitle]
          : [],
      ),
    ),
  ];
  if (titles.length === 0) return plan;
  const quotedTitles = titles.map((title) => `“${title}”`).join(", ");
  let finalResponse = plan.finalResponse.replace(
    /\b(?:the\s+)?(?:focused|open|current)\s+(?:artifact|document|file|work)\b/gi,
    titles[0]!,
  );
  if (
    !titles.every((title) =>
      normalizedReference(finalResponse).includes(normalizedReference(title)),
    )
  ) {
    const operationKinds = new Set(
      plan.operations.map((operation) => operation.type),
    );
    const action =
      operationKinds.size === 1 && operationKinds.has("artifact.update")
        ? "Updated"
        : operationKinds.size === 1 && operationKinds.has("artifact.archive")
          ? "Archived"
          : operationKinds.size === 1 && operationKinds.has("artifact.link")
            ? "Linked"
            : "Changed";
    finalResponse = `${finalResponse.replace(/\s+$/, "")} ${action} ${quotedTitles}.`;
  }
  return parseSpectraPlan({ ...plan, finalResponse });
}

export function reconcileExplicitRequestContract(
  plan: SpectraPlan,
  prompt: string,
) {
  const requestedCreation = provisionalSingleCreation(prompt);
  if (!requestedCreation || plan.decision !== "operate") return plan;
  let retainedCreate = false;
  const forbiddenUpdateNoun: Record<
    (typeof SPECTRA_BLUEPRINT_KEYS)[number],
    string
  > = {
    document: "documents?|notes?|guide|outline",
    flashcard_deck: "(?:flashcard\s+)?decks?|flashcards?",
    quiz: "quizzes?|quiz",
    planner_task: "(?:planner\s+|study\s+)?tasks?",
    agent: "agents?|assistants?",
    timetable: "timetables?|calendars?|schedules?",
    presentation: "presentations?|slides?|slide decks?",
    sheets: "spreadsheets?|workbooks?|sheets?",
    code: "code|visuali[sz]ations?|web apps?",
    whiteboard: "whiteboards?|canvases?|mind maps?",
  };
  const retainedIndexes = new Map<number, number>();
  const operations: typeof plan.operations = [];
  plan.operations.forEach((operation, index) => {
    let keep = true;
    if (operation.type === "artifact.create") {
      if (
        operation.input.blueprintKey !== requestedCreation.blueprintKey ||
        retainedCreate
      )
        keep = false;
      else retainedCreate = true;
    }
    if (keep && operation.type === "artifact.update") {
      const noun = forbiddenUpdateNoun[operation.input.blueprintKey];
      keep = !new RegExp(
        `\\b(?:do not|don't|dont|without)\\s+(?:change|edit|update|modify|rewrite|replace)[^.!?]{0,100}\\b(?:${noun})\\b`,
        "i",
      ).test(prompt);
    }
    if (keep) {
      retainedIndexes.set(index, operations.length);
      operations.push(operation);
    }
  });
  if (!retainedCreate) return plan;
  const obligations = plan.intent.obligations?.flatMap((obligation) => {
    const operationIndexes = [
      ...new Set(
        obligation.operationIndexes.flatMap((index) => {
          const mapped = retainedIndexes.get(index);
          return mapped === undefined ? [] : [mapped];
        }),
      ),
    ];
    return operationIndexes.length ? [{ ...obligation, operationIndexes }] : [];
  });
  const retained = operations.find(
    (operation) => operation.type === "artifact.create",
  );
  const hasOtherMutations = operations.some(
    (operation) => operation.type !== "artifact.create",
  );
  const targetedArtifactIds = [
    ...new Set(
      operations.flatMap((operation) => {
        if (
          operation.type === "artifact.update" ||
          operation.type === "artifact.archive"
        )
          return [operation.input.artifactId];
        return [];
      }),
    ),
  ];
  return parseSpectraPlan({
    ...plan,
    intent: {
      ...plan.intent,
      mode: hasOtherMutations ? "mixed" : "create",
      requestedArtifactTypes: [requestedCreation.blueprintKey],
      requestedVisibleArtifactCount: 1,
      // A mixed create + focused edit still has an authoritative edit target.
      // Erasing it turns an exact owned update into artificial ambiguity during
      // intent validation, even though the operation itself already names the
      // canonical artifact.
      targetArtifactId:
        targetedArtifactIds.length === 1
          ? targetedArtifactIds[0]!
          : plan.intent.targetArtifactId,
      targetWorkspaceId:
        retained?.type === "artifact.create"
          ? retained.input.workspaceId
          : plan.intent.targetWorkspaceId,
      obligations,
    },
    operations,
  });
}

export function reconcileExplicitDocumentOperation(
  operation: ModelOperation,
  prompt: string,
  focusedArtifact: unknown,
): ModelOperation {
  if (
    operation.type !== "artifact.update" ||
    operation.input.blueprintKey !== "document" ||
    !focusedArtifact ||
    typeof focusedArtifact !== "object" ||
    Array.isArray(focusedArtifact)
  )
    return operation;
  const artifact = focusedArtifact as Record<string, unknown>;
  const content =
    artifact.content &&
    typeof artifact.content === "object" &&
    !Array.isArray(artifact.content)
      ? (artifact.content as Record<string, unknown>)
      : null;
  const blocks = Array.isArray(content?.blocks) ? content.blocks : [];

  // Exact region repair requests are a contract, not a suggestion. The model
  // still authors the operation, but the harness resolves the natural-language
  // target against the canonical block tree so a plausible-looking JSON
  // pointer cannot silently edit the heading (or no block at all).
  const exactHeadingRepair = prompt.match(
    /heading\s+that\s+currently\s+starts\s+["'“]([^"'”]+)["'”]\s+(?:back\s+)?to\s+exactly\s+["'“]([^"'”]+)["'”]/i,
  );
  const exactParagraphRepair = prompt.match(
    /first\s+paragraph\s+under\s+(?:that|the)\s+heading(?:\s+with)?\s*:\s*["'“]([\s\S]+?)["'”](?=\s+(?:preserve|keep|leave)\b|\s*$)/i,
  );
  if (exactHeadingRepair && exactParagraphRepair) {
    const startsWith = exactHeadingRepair[1]!.trim().toLowerCase();
    const headingText = exactHeadingRepair[2]!.trim();
    const headingIndex = blocks.findIndex((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block))
        return false;
      const row = block as Record<string, unknown>;
      return (
        typeof row.type === "string" &&
        row.type.startsWith("heading") &&
        typeof row.text === "string" &&
        row.text.trim().toLowerCase().startsWith(startsWith)
      );
    });
    const paragraphIndex = blocks.findIndex(
      (block, index) =>
        index > headingIndex &&
        block !== null &&
        typeof block === "object" &&
        !Array.isArray(block) &&
        (block as Record<string, unknown>).type === "paragraph",
    );
    if (headingIndex >= 0 && paragraphIndex >= 0) {
      return parseModelOperation({
        ...operation,
        input: {
          ...operation.input,
          content: null,
          contentPatch: {
            changes: [
              { path: `/blocks/${headingIndex}/text`, value: headingText },
              {
                path: `/blocks/${paragraphIndex}/text`,
                value: exactParagraphRepair[1]!.trim(),
              },
            ],
          },
        },
      });
    }
  }
  const exactNthParagraph = prompt.match(
    /(?:replace|set|rewrite)\s+(?:only\s+)?(?:the\s+)?(first|second|third)\s+paragraph\s+under\s+(?:the\s+)?["'“]?([^"'”:,.]+?)["'”]?\s+(?:with|to)\s*:\s*["'“]([\s\S]+?)["'”](?=\s+(?:preserve|keep|leave)\b|\s*$)/i,
  );
  if (exactNthParagraph) {
    const ordinal = { first: 0, second: 1, third: 2 }[
      exactNthParagraph[1]!.toLowerCase() as "first" | "second" | "third"
    ];
    const requestedHeading = exactNthParagraph[2]!.trim().toLowerCase();
    const headingIndex = blocks.findIndex((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block))
        return false;
      const row = block as Record<string, unknown>;
      return (
        typeof row.type === "string" &&
        row.type.startsWith("heading") &&
        typeof row.text === "string" &&
        row.text.trim().toLowerCase() === requestedHeading
      );
    });
    if (headingIndex >= 0) {
      const paragraphIndices: number[] = [];
      for (let index = headingIndex + 1; index < blocks.length; index += 1) {
        const block = blocks[index];
        if (!block || typeof block !== "object" || Array.isArray(block))
          continue;
        const type = (block as Record<string, unknown>).type;
        if (typeof type === "string" && type.startsWith("heading")) break;
        if (type === "paragraph") paragraphIndices.push(index);
      }
      const paragraphIndex = paragraphIndices[ordinal];
      if (paragraphIndex !== undefined)
        return parseModelOperation({
          ...operation,
          input: {
            ...operation.input,
            content: null,
            contentPatch: {
              changes: [
                {
                  path: `/blocks/${paragraphIndex}/text`,
                  value: exactNthParagraph[3]!.trim(),
                },
              ],
            },
          },
        });
    }
  }
  if (!operation.input.contentPatch) return operation;

  // Section rewrites ("rewrite section 2 more concisely") must never land on
  // earlier headings via fragile absolute indices. Remap onto the named
  // section by heading text before any other path repair.
  const sectionRemapped = remapDocumentSectionRewriteChanges(
    content,
    prompt,
    operation.input.contentPatch.changes,
  );
  if (
    sectionRemapped.length !== operation.input.contentPatch.changes.length ||
    sectionRemapped.some(
      (change, index) =>
        change.path !== operation.input.contentPatch!.changes[index]!.path ||
        change.value !== operation.input.contentPatch!.changes[index]!.value,
    )
  ) {
    return parseModelOperation({
      ...operation,
      input: {
        ...operation.input,
        content: null,
        contentPatch: { changes: sectionRemapped },
      },
    });
  }

  const headingRequest = prompt
    .match(
      /\b(?:first\s+)?paragraph\s+(?:directly\s+)?under\s+(?:the\s+)?["']?([^"',.]+?)["']?(?=\s+(?:so|to|and|while|without|with)\b|[,.;]|$)/i,
    )?.[1]
    ?.trim();
  if (!headingRequest) return operation;
  const normalizedHeading = headingRequest.toLowerCase();
  const headingIndex = blocks.findIndex((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block))
      return false;
    const row = block as Record<string, unknown>;
    const text =
      typeof row.text === "string" ? row.text.trim().toLowerCase() : "";
    return (
      typeof row.type === "string" &&
      row.type.startsWith("heading") &&
      (text === normalizedHeading || text.startsWith(`${normalizedHeading} `))
    );
  });
  if (headingIndex < 0) return operation;
  const paragraphIndex = blocks.findIndex((block, index) => {
    if (
      index <= headingIndex ||
      !block ||
      typeof block !== "object" ||
      Array.isArray(block)
    )
      return false;
    const type = (block as Record<string, unknown>).type;
    return type === "paragraph";
  });
  if (paragraphIndex < 0) return operation;
  const textChanges = operation.input.contentPatch.changes.filter((change) =>
    /^\/(?:content\/)?blocks\/(?:id:[^/]+|byId\/[^/]+|\d+)\/text$/.test(
      change.path,
    ),
  );
  if (textChanges.length !== 1) return operation;
  const intendedPath = `/blocks/${paragraphIndex}/text`;
  if (textChanges[0]!.path === intendedPath) return operation;
  return parseModelOperation({
    ...operation,
    input: {
      ...operation.input,
      contentPatch: {
        changes: operation.input.contentPatch.changes.map((change) =>
          change === textChanges[0]
            ? { ...change, path: intendedPath }
            : change,
        ),
      },
    },
  });
}

export function assertRequestedArtifactMutation(
  operations: ModelOperation[],
  prompt: string,
) {
  // Negative preservation constraints describe what must *not* change. Remove
  // them before detecting a requested content mutation; otherwise a request
  // such as "add a tag while preserving all content" is misread as an edit to
  // the document body and a perfectly valid metadata-only operation is rejected.
  const mutationPrompt = prompt
    .replace(
      /\b(?:while|and)\s+(?:preserv(?:e|ing)|keep(?:ing)?|leav(?:e|ing))\b[^.!?]{0,180}\b(?:content|text|paragraphs?|headings?|sections?|blocks?|questions?|answers?|cards?|subtasks?|explanations?|formulas?|tables?)\b[^.!?]*/gi,
      " ",
    )
    .replace(
      /\bwithout\s+(?:chang(?:e|ing)|edit(?:ing)?|rewrit(?:e|ing)|replac(?:e|ing)|remov(?:e|ing)|touch(?:ing)?|modif(?:y|ying)|alter(?:ing)?)\b[^.!?]{0,180}\b(?:content|text|paragraphs?|headings?|sections?|blocks?|questions?|answers?|cards?|subtasks?|explanations?|formulas?|tables?)\b[^.!?]*/gi,
      " ",
    );
  const requestsContentChange =
    /\b(?:rewrite|replace|edit|change|update|add|remove|delete|set|repair|fix)\b[^.!?]{0,180}\b(?:content|text|paragraph|heading|section|block|question|answer|card|subtask|explanation|formula|table|column|cell|sheet|workbook|range|chart|slide|event)\b/i.test(
      mutationPrompt,
    ) ||
    /\b(?:paragraph|heading|section|block|question|answer|card|subtask|explanation|formula|table|column|cell|sheet|workbook|range|chart|slide|event)\b[^.!?]{0,180}\b(?:rewrite|replace|edit|change|update|add|remove|delete|set|repair|fix)\b/i.test(
      mutationPrompt,
    );
  if (!requestsContentChange) return;
  const updates = operations.filter(
    (
      operation,
    ): operation is Extract<ModelOperation, { type: "artifact.update" }> =>
      operation.type === "artifact.update",
  );
  if (
    updates.length > 0 &&
    updates.every(
      (operation) =>
        operation.input.content === null &&
        (!operation.input.contentPatch ||
          operation.input.contentPatch.changes.length === 0),
    )
  )
    throw new Error(
      "The proposed artifact update did not contain the requested content change.",
    );
}

export function promptRequestsCalendarAction(prompt: string) {
  const normalized = prompt.toLowerCase().replace(/[–—]/g, "-");
  if (
    /\b(?:calendar|time[- ]?block|work block|calendar block|scheduled work)\b/.test(
      normalized,
    )
  )
    return true;
  // Slide/deck edits often use "move" plus an ordinal ("slide 2"). A bare
  // integer is not a wall-clock signal; require an explicit time or weekday.
  if (
    /\b(?:slide|slides|deck|presentation|heading|paragraph|pptx)\b/.test(
      normalized,
    ) &&
    !/\b(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}:\d{2}|\d{1,2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?))\b/.test(
      normalized,
    )
  )
    return false;
  const schedulingVerb =
    /\b(?:schedule|put|place|book|block|reserve|move|resize)\b/.test(
      normalized,
    );
  const timeSignal =
    /\b(?:today|tomorrow|tonight|this\s+(?:morning|afternoon|evening|week)|next\s+(?:week|month)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{1,2}:\d{2}(?:\s*(?:a\.?\s*m\.?|p\.?\s*m\.?))?|\d{1,2}\s*(?:a\.?\s*m\.?|p\.?\s*m\.?)|from\s+\d{1,2}(?::\d{2})?(?:\s*(?:a\.?\s*m\.?|p\.?\s*m\.?))?)\b/.test(
      normalized,
    );
  return schedulingVerb && timeSignal;
}

/**
 * Distinguish “schedule the saved task” from the dependency graph requested by
 * “create a planner task and schedule it”. Calendar language alone must never
 * turn a named existing artifact into a duplicate planner task.
 */

/**
 * True when the successful tool may end the agent loop because the prompt's
 * visible obligations are limited to that one action family. Multi-step
 * requests (schedule two blocks, navigate then edit, insert then summarize,
 * update-then-schedule) must keep planning.
 */
export function toolFulfillsEntireRequest(prompt: string, toolName: string) {
  const normalized = prompt.toLowerCase().replace(/[–—]/g, "-");
  const calendarTools = new Set([
    "schedule_calendar_task",
    "create_calendar_personal_event",
    "move_calendar_block",
    "resize_calendar_block",
  ]);
  const soleSurfaceTools = new Set([
    ...calendarTools,
    "navigate_spectra",
    "setup_bridge",
    "insert_reference",
  ]);
  if (!soleSurfaceTools.has(toolName)) return false;

  const hasContinuation =
    /\b(?:and then|then|after that|afterwards|also|plus|as well)\b/.test(
      normalized,
    );
  const hasSecondArtifactObligation =
    /\b(?:create|make|build|generate|draft|write|summarize|summarise|explain|rewrite|replace|edit|update|change|add(?:\s+a)?\s+note|insert|open|navigate|go to)\b/.test(
      normalized,
    );
  const multipleScheduleTargets =
    calendarTools.has(toolName) &&
    (/\b(?:two|2|both|several|multiple|a pair of)\b[\s\S]{0,48}\b(?:block|blocks|task|tasks|item|items|event|events)\b/.test(
      normalized,
    ) ||
      /\b(?:schedule|put|place|book)\b[\s\S]{0,120}\band\b[\s\S]{0,80}\b(?:schedule|put|place|book|block|tomorrow|today|at\s+\d)/.test(
        normalized,
      ));

  if (calendarTools.has(toolName)) {
    if (multipleScheduleTargets) return false;
    if (hasContinuation && hasSecondArtifactObligation) return false;
    // "Update the task note and schedule it" / create-then-schedule.
    if (
      /\b(?:create|make|build|update|edit|change|rewrite|add)\b/.test(normalized) &&
      /\b(?:schedule|put|place|book|calendar|time[- ]?block|work block)\b/.test(
        normalized,
      )
    )
      return false;
    if (/\b(?:open|navigate|go to|show)\b/.test(normalized)) return false;
    return true;
  }

  if (toolName === "navigate_spectra" || toolName === "setup_bridge") {
    if (hasContinuation && hasSecondArtifactObligation) return false;
    if (
      /\b(?:edit|update|create|schedule|insert|write|summarize|summarise|open)\b/.test(
        normalized,
      ) &&
      /\b(?:and|then|after)\b/.test(normalized)
    )
      return false;
    return true;
  }

  if (toolName === "insert_reference") {
    if (
      /\b(?:and|then|also|summarize|summarise|explain|write|edit|rewrite)\b/.test(
        normalized,
      )
    )
      return false;
    return true;
  }

  return false;
}

/**
 * Gate used by isCompleteAfterTool. Reference inserts that only queued a UI
 * refresh must not end the agent loop as if the write already happened.
 */
export function applicationToolMayCompleteRequest(
  prompt: string,
  toolName: string,
  toolResult: unknown,
) {
  const result =
    toolResult && typeof toolResult === "object" && !Array.isArray(toolResult)
      ? (toolResult as Record<string, unknown>)
      : null;
  const data =
    result?.data &&
    typeof result.data === "object" &&
    !Array.isArray(result.data)
      ? (result.data as Record<string, unknown>)
      : null;
  const phase =
    (typeof data?.status === "string" ? data.status : undefined) ??
    (typeof result?.status === "string" ? result.status : undefined);
  const calendarTools = new Set([
    "schedule_calendar_task",
    "create_calendar_personal_event",
    "move_calendar_block",
    "resize_calendar_block",
  ]);
  const numericOk = result?.status === 0 || result?.ok === true;
  const toolSucceeded =
    ((toolName === "navigate_spectra" || toolName === "setup_bridge") &&
      numericOk) ||
    (toolName === "insert_reference" &&
      (phase === "verified_native_write" || phase === "canonical_write")) ||
    (calendarTools.has(toolName) && (numericOk || Boolean(result?.item)));
  return toolSucceeded && toolFulfillsEntireRequest(prompt, toolName);
}

export function promptRequestsNewPlannerTask(prompt: string) {
  const normalized = prompt.toLowerCase().replace(/[–—]/g, "-");
  return (
    /\b(?:create|make|build|generate|draft|write)\b[\s\S]{0,80}\b(?:planner\s+)?(?:task|todo|to-do)\b/.test(
      normalized,
    ) ||
    /\b(?:new|another|separate)\s+(?:planner\s+)?(?:task|todo|to-do)\b/.test(
      normalized,
    )
  );
}

export function assertCalendarActionContract(
  operations: ModelOperation[],
  prompt: string,
) {
  if (!promptRequestsCalendarAction(prompt)) return;
  const hasCalendarMutation = operations.some(
    (operation) =>
      operation.type === "app.command" &&
      isCalendarMutationCommand(operation.input.command),
  );
  const plannerUpdates = operations.filter(
    (
      operation,
    ): operation is Extract<ModelOperation, { type: "artifact.update" }> =>
      operation.type === "artifact.update" &&
      operation.input.blueprintKey === "planner_task",
  );
  // A legitimate "update the note, then schedule it" request includes both a
  // planner update and a Calendar mutation. Only reject planner updates that
  // stand in for a missing Calendar block.
  if (plannerUpdates.length > 0 && !hasCalendarMutation)
    throw new Error(
      "This is a Calendar request. Use the Calendar schedule, move, or resize tool; do not rewrite a planner task as a substitute for creating a Calendar block.",
    );
  const plannerCreates = operations.filter(
    (
      operation,
    ): operation is Extract<ModelOperation, { type: "artifact.create" }> =>
      operation.type === "artifact.create" &&
      operation.input.blueprintKey === "planner_task",
  );
  if (plannerCreates.length > 0 && !promptRequestsNewPlannerTask(prompt))
    throw new Error(
      "This Calendar request refers to existing work. Do not create or rewrite a planner task; locate the named artifact and schedule that exact task with Calendar.",
    );
  if (plannerCreates.length > 0 && !hasCalendarMutation)
    throw new Error(
      "This Calendar request created a planner task without a Calendar block. Emit the planner create first, then a calendar.schedule operation using its exact @created:<operation index> artifact id and planTaskId; never promise to schedule it later.",
    );
}

export function requestedPresentationLayout(prompt: string) {
  const normalized = prompt.toLowerCase().replace(/[–—]/g, "-");
  return PRESENTATION_LAYOUT_IDS.find((layoutId) =>
    normalized.includes(layoutId),
  );
}

export function presentationSlidesAuthoredByOperation(
  operation: Extract<ModelOperation, { type: "artifact.update" }>,
) {
  const candidates: unknown[] = [];
  const content =
    operation.input.content &&
    typeof operation.input.content === "object" &&
    !Array.isArray(operation.input.content)
      ? (operation.input.content as Record<string, unknown>)
      : null;
  if (Array.isArray(content?.slides)) candidates.push(...content.slides);
  for (const change of operation.input.contentPatch?.changes ?? []) {
    if (/^\/(?:content\/)?slides\/(?:-|\d+)$/.test(change.path))
      candidates.push(change.value);
    if (
      /^\/(?:content\/)?slides$/.test(change.path) &&
      Array.isArray(change.value)
    )
      candidates.push(...change.value);
  }
  return candidates.filter(
    (slide): slide is Record<string, unknown> =>
      Boolean(slide) && typeof slide === "object" && !Array.isArray(slide),
  );
}

export function assertPresentationLayoutContract(
  operations: ModelOperation[],
  prompt: string,
) {
  const requestedLayout = requestedPresentationLayout(prompt);
  if (!requestedLayout) return;
  const presentationUpdates = operations.filter(
    (
      operation,
    ): operation is Extract<ModelOperation, { type: "artifact.update" }> =>
      operation.type === "artifact.update" &&
      operation.input.blueprintKey === "presentation",
  );
  if (!presentationUpdates.length) return;
  const slides = presentationUpdates.flatMap(
    presentationSlidesAuthoredByOperation,
  );
  const matching = slides.filter((slide) => slide.layoutId === requestedLayout);
  if (!matching.length)
    throw new Error(
      `The requested presentation layout was not applied. Set the authored slide layoutId to "${requestedLayout}" and fit its native objects to that layout before proposing the operation again.`,
    );
  for (const slide of matching) {
    const objects = Array.isArray(slide.objects)
      ? slide.objects.filter(
          (object): object is Record<string, unknown> =>
            Boolean(object) &&
            typeof object === "object" &&
            !Array.isArray(object),
        )
      : [];
    const canvasHeight = 562.5;
    for (const object of objects) {
      const x = typeof object.x === "number" ? object.x : 0;
      const y = typeof object.y === "number" ? object.y : 0;
      const width = typeof object.width === "number" ? object.width : 0;
      const height = typeof object.height === "number" ? object.height : 0;
      if (
        width < 10 ||
        height < 10 ||
        x < 0 ||
        y < 0 ||
        x + width > 1_000 ||
        y + height > canvasHeight
      )
        throw new Error(
          "The authored slide has an object outside the visible canvas. Correct its geometry before proposing the operation again.",
        );
      if (object.type === "text") {
        const style =
          object.style &&
          typeof object.style === "object" &&
          !Array.isArray(object.style)
            ? (object.style as Record<string, unknown>)
            : {};
        if (
          typeof style.fontSize === "number" &&
          style.fontSize > 0 &&
          style.fontSize < 20
        )
          throw new Error(
            "The authored slide contains presentation text below 20px. Increase its type scale and rebalance the geometry before proposing the operation again.",
          );
      }
    }
    if (
      (requestedLayout === "title-visual-text" ||
        requestedLayout === "visual-story") &&
      !objects.some((object) => object.type !== "text")
    )
      throw new Error(
        `The "${requestedLayout}" slide needs an editable visual object as well as text. Add and place the visual before proposing the operation again.`,
      );
  }
}

export function reconcileExplicitDocumentRegions(
  plan: SpectraPlan,
  prompt: string,
  context: Awaited<ReturnType<typeof buildContext>>,
) {
  const operations = plan.operations.map((operation) => {
    const targetArtifact =
      operation.type === "artifact.update"
        ? (context.artifacts.find(
            (artifact) => artifact.id === operation.input.artifactId,
          ) ??
          (context.focusedArtifact?.id === operation.input.artifactId
            ? context.focusedArtifact
            : null))
        : null;
    return reconcileExplicitDocumentOperation(
      operation,
      prompt,
      targetArtifact,
    );
  });
  return operations.some(
    (operation, index) => operation !== plan.operations[index],
  )
    ? parseSpectraPlan({ ...plan, operations })
    : plan;
}

export function resolveAndValidatePlan(
  plan: SpectraPlan,
  context: Awaited<ReturnType<typeof buildContext>>,
  prompt: string,
): ResolvedPlan {
  const requestedCreation = provisionalSingleCreation(prompt);
  const workspaceId =
    typeof context.currentWorkspace?.id === "string"
      ? context.currentWorkspace.id
      : null;
  // Workspace-focused vague creates often land as artifact.update against an
  // existing same-type object. Promote that content to a fresh create first.
  // Never promote when the prompt is a structural edit of the open artifact.
  const promoted =
    requestedCreation &&
    promptLooksLikeFreshCreate(prompt) &&
    !promptLooksLikeFocusedStructuralEdit(prompt)
      ? parseSpectraPlan(
          promoteMatchingUpdateToCreate(plan, {
            requested: requestedCreation,
            workspaceId,
          }),
        )
      : plan;
  const reconciled = reconcileExplicitRequestContract(promoted, prompt);
  let resolved = resolvePlanReferences(reconciled, context);
  // Workspace mentions are discovery hints. The model's verified typed
  // destination and selected clarification govern placement; a source phrase
  // must never rewrite every create or add operation.
  const targetOutcome = resolvePlanArtifactTargets(resolved, context, prompt);
  const targetResolutions = targetOutcome.targetResolutions;
  resolved = targetOutcome.plan;
  if (resolved.decision === "clarify")
    return { plan: resolved, targetResolutions };
  resolved = reconcileExplicitDocumentRegions(resolved, prompt, context);
  // A visible artifact is context, not an instruction to mutate it. When the
  // user explicitly asks for a fresh object, keep the conversation identity
  // anchored to that new object as well; otherwise the model can correctly
  // create `Magnets Quiz` while leaving the Dock mislabeled `Update Water
  // Cycle Quiz` from the contextual artifact.
  if (requestedCreation && promptLooksLikeFreshCreate(prompt)) {
    const created = resolved.operations.find(
      (operation) =>
        operation.type === "artifact.create" &&
        operation.input.blueprintKey === requestedCreation.blueprintKey,
    );
    if (created?.type === "artifact.create") {
      resolved = parseSpectraPlan({
        ...resolved,
        conversationTitle: created.input.title.trim().slice(0, 64),
      });
    }
  }
  resolved = narrateResolvedTargets(resolved, targetResolutions);
  assertRequestedArtifactMutation(resolved.operations, prompt);
  assertPresentationLayoutContract(resolved.operations, prompt);
  console.info(
    `[spectra.plan.summary] ${JSON.stringify({
      intent: resolved.intent,
      operations: resolved.operations.map((operation) => ({
        type: operation.type,
        blueprintKey:
          operation.type === "artifact.create" ||
          operation.type === "artifact.update"
            ? operation.input.blueprintKey
            : undefined,
        workspaceId:
          operation.type === "artifact.create"
            ? operation.input.workspaceId
            : undefined,
        placement:
          operation.type === "artifact.create"
            ? operation.input.placement
            : undefined,
      })),
    })}`,
  );
  try {
    return {
      plan: validatePlanAgainstIntent(resolved, ownedReferences(context)),
      targetResolutions,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error(
      `[spectra.plan.resolve_validate] ${JSON.stringify({
        promptPreview: prompt.slice(0, 160),
        decision: resolved.decision,
        intent: resolved.intent,
        operations: resolved.operations.map((operation) => ({
          type: operation.type,
          blueprintKey:
            operation.type === "artifact.create" ||
            operation.type === "artifact.update"
              ? operation.input.blueprintKey
              : undefined,
          workspaceId:
            operation.type === "artifact.create"
              ? operation.input.workspaceId
              : undefined,
        })),
        message: message.slice(0, 400),
        publicError: formatPlanApplicationPublicError(error),
      })}`,
    );
    // Quietly collapse duplicate same-type creates from a singular request
    // instead of exposing an intent mismatch after shells already appeared.
    if (/more visible artifacts/i.test(message)) {
      const creates = resolved.operations.filter(
        (operation) => operation.type === "artifact.create",
      );
      const createdTypes = [
        ...new Set(creates.map((operation) => operation.input.blueprintKey)),
      ];
      const requested =
        provisionalSingleCreation(prompt) ??
        (createdTypes.length === 1
          ? {
              blueprintKey: createdTypes[0]!,
              label: createdTypes[0]!,
            }
          : null);
      if (
        requested &&
        creates.length > 1 &&
        creates.every(
          (operation) =>
            operation.input.blueprintKey === requested.blueprintKey,
        )
      ) {
        const trimmed = parseSpectraPlan({
          ...resolved,
          intent: {
            ...resolved.intent,
            mode: "create",
            requestedArtifactTypes: [requested.blueprintKey],
            requestedVisibleArtifactCount: 1,
            targetWorkspaceId:
              creates[0]!.input.workspaceId ??
              resolved.intent.targetWorkspaceId,
          },
          operations: [
            creates[0]!,
            ...resolved.operations.filter(
              (operation) => operation.type !== "artifact.create",
            ),
          ],
        });
        console.warn("[spectra.plan.duplicate_create_trimmed]", {
          blueprintKey: requested.blueprintKey,
          dropped: creates.length - 1,
        });
        return {
          plan: validatePlanAgainstIntent(trimmed, ownedReferences(context)),
          targetResolutions,
        };
      }
    }
    // Vague single-create prompts often leave intent.requestedArtifactTypes
    // empty/wrong while the operation itself is the correct blueprint. Align
    // intent to the create instead of failing after the model already authored.
    // Also recover create-counted-as-update slips against workspace focus.
    if (
      /unrelated to the interpreted request|does not match the interpreted request/i.test(
        message,
      )
    ) {
      const creates = resolved.operations.filter(
        (operation) => operation.type === "artifact.create",
      );
      const requested = provisionalSingleCreation(prompt);
      if (
        requested &&
        creates.length === 0 &&
        promptLooksLikeFreshCreate(prompt)
      ) {
        const promotedCreate = parseSpectraPlan(
          promoteMatchingUpdateToCreate(resolved, {
            requested,
            workspaceId,
          }),
        );
        if (
          promotedCreate.operations.some(
            (operation) => operation.type === "artifact.create",
          )
        ) {
          console.warn("[spectra.plan.update_promoted_to_create]", {
            blueprintKey: requested.blueprintKey,
          });
          return {
            plan: validatePlanAgainstIntent(
              promotedCreate,
              ownedReferences(context),
            ),
            targetResolutions,
          };
        }
      }
      if (
        requested &&
        creates.length === 1 &&
        creates[0]!.input.blueprintKey === requested.blueprintKey
      ) {
        const aligned = parseSpectraPlan({
          ...resolved,
          intent: {
            ...resolved.intent,
            mode: "create",
            requestedArtifactTypes: [requested.blueprintKey],
            requestedVisibleArtifactCount: 1,
            targetArtifactId: null,
            targetWorkspaceId:
              creates[0]!.input.workspaceId ??
              resolved.intent.targetWorkspaceId ??
              workspaceId,
          },
        });
        console.warn("[spectra.plan.intent_aligned_to_create]", {
          blueprintKey: requested.blueprintKey,
        });
        return {
          plan: validatePlanAgainstIntent(aligned, ownedReferences(context)),
          targetResolutions,
        };
      }
      if (creates.length === 1) {
        const blueprintKey = creates[0]!.input.blueprintKey;
        const aligned = parseSpectraPlan({
          ...resolved,
          intent: {
            ...resolved.intent,
            mode: resolved.operations.some(
              (operation) => operation.type !== "artifact.create",
            )
              ? "mixed"
              : "create",
            requestedArtifactTypes: [blueprintKey],
            requestedVisibleArtifactCount: Math.max(
              1,
              resolved.intent.requestedVisibleArtifactCount,
            ),
            targetWorkspaceId:
              creates[0]!.input.workspaceId ??
              resolved.intent.targetWorkspaceId ??
              workspaceId,
          },
        });
        console.warn("[spectra.plan.intent_aligned_to_authored_create]", {
          blueprintKey,
        });
        return {
          plan: validatePlanAgainstIntent(aligned, ownedReferences(context)),
          targetResolutions,
        };
      }
    }
    throw error;
  }
}
