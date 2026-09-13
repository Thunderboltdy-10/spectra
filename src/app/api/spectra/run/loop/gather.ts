import type { Body } from "./contract";
import { act, mutate, query } from "./io";
import {
  artifactContextSnapshot,
  buildBoundedContextPacket,
} from "@/features/spectra/ai/context-builder";
import { readLiveArtifactValue } from "@/features/spectra/ai/yjs-artifact-operation";
import { overlayLiveArtifactRecord } from "@/features/spectra/collaboration/artifact-yjs-model";
import { createHash } from "node:crypto";

export function rows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object",
      )
    : [];
}

export function summarizeArtifact(
  artifact: Record<string, unknown>,
  includeContent = false,
) {
  return {
    id: artifact._id,
    blueprintKey: artifact.blueprintKey,
    title: artifact.title,
    summary: artifact.summary,
    updatedAt: artifact.updatedAt,
    placements: rows(artifact.placements).map((placement) => ({
      workspaceId: placement.workspaceId,
      workspaceTitle: placement.workspaceTitle,
      nodeId: placement.nodeId,
    })),
    ...(includeContent ? { content: artifact.content } : {}),
  };
}

function normalizedPromptReference(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function promptContainsReference(prompt: string, reference: string) {
  const promptKey = normalizedPromptReference(prompt);
  const referenceKey = normalizedPromptReference(reference);
  return Boolean(
    referenceKey && ` ${promptKey} `.includes(` ${referenceKey} `),
  );
}

function promptRequestsNewArtifact(prompt: string) {
  const normalized = prompt.toLowerCase();
  return (
    /\b(?:create|make|build|generate|draft|write)\b[\s\S]{0,90}\b(?:new|another|separate)?\s*(?:planner\s+)?(?:task|todo|document|note|deck|presentation|quiz|flashcard|sheet|workbook|artifact)\b/.test(
      normalized,
    ) ||
    /\b(?:new|another|separate)\s+(?:planner\s+)?(?:task|todo|document|note|deck|presentation|quiz|flashcard|sheet|workbook|artifact)\b/.test(
      normalized,
    )
  );
}

/**
 * A stale open artifact is useful context, but it must not outrank a unique
 * owned title explicitly named in an existing-work request. This is kept at
 * the context boundary so the native agent, typed-plan resolver, and
 * clarification continuations all receive the same target.
 */
export function explicitlyNamedExistingArtifactId(
  prompt: string,
  candidates: Array<Record<string, unknown>>,
) {
  if (promptRequestsNewArtifact(prompt)) return undefined;
  const matches = candidates.flatMap((candidate) => {
    const id =
      typeof candidate._id === "string"
        ? candidate._id
        : typeof candidate.id === "string"
          ? candidate.id
          : undefined;
    const title = typeof candidate.title === "string" ? candidate.title : "";
    return id && title.length >= 3 && promptContainsReference(prompt, title)
      ? [{ id, title }]
      : [];
  });
  return matches.length === 1 ? matches[0]!.id : undefined;
}

export async function hydrateArtifactWithLiveContent(
  artifact: Record<string, unknown> | null,
): Promise<Record<string, unknown> | null> {
  if (!artifact || typeof artifact._id !== "string") return artifact;
  try {
    const live = await readLiveArtifactValue({
      artifactId: artifact._id,
      timeoutMs: 4_000,
    });
    return overlayLiveArtifactRecord(artifact, live);
  } catch {
    return artifact;
  }
}

export async function gatherResolvedArtifactContext(
  actorClerkId: string,
  artifactIds: string[],
) {
  const uniqueIds = [...new Set(artifactIds)].slice(0, 12);
  const artifacts = await Promise.all(
    uniqueIds.map(async (artifactId) => {
      const stored = await query<unknown & object, unknown>(
        "spectraArtifacts:get",
        { actorClerkId, artifactId },
      ).catch(() => null);
      if (!stored || typeof stored !== "object") return null;
      return hydrateArtifactWithLiveContent(stored as Record<string, unknown>);
    }),
  );
  return artifacts.flatMap((artifact) =>
    artifact
      ? [
          {
            artifact,
            snapshot: artifactContextSnapshot(artifact, {
              includeExcerpt: true,
              preferTrailingBlocks: true,
              relevance: "resolved mutation target",
            }),
          },
        ]
      : [],
  );
}

export async function buildContext(
  actorClerkId: string,
  body: Pick<
    Body,
    | "workspaceId"
    | "scopeNodeId"
    | "artifactId"
    | "threadId"
    | "focusMode"
    | "selectedArtifactIds"
    | "explicitContextObjects"
    | "currentView"
    | "clarificationId"
    | "choiceMessageId"
    | "choiceKey"
    | "clarificationExecutionId"
    | "batchSelections"
    | "executionId"
  >,
  prompt = "",
) {
  const explicitContextObjects = Array.isArray(body.explicitContextObjects)
    ? body.explicitContextObjects
        .filter(
          (item) =>
            item &&
            typeof item.id === "string" &&
            ["artifact", "workspace", "thread"].includes(String(item.type)),
        )
        .slice(0, 36)
    : [];
  const explicitArtifactIdList = explicitContextObjects
    .filter((item) => item.type === "artifact")
    .flatMap((item) => (item.id ? [item.id] : []));
  const selectedArtifactIds = [
    ...new Set(
      [
        ...(Array.isArray(body.selectedArtifactIds)
          ? body.selectedArtifactIds
          : []),
        ...explicitArtifactIdList,
      ].filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ].slice(0, 24);
  const continuationChoicePromise =
    body.clarificationId &&
    body.choiceMessageId &&
    body.choiceKey &&
    body.clarificationExecutionId
      ? query<unknown & object, unknown>("spectraThreads:getChoiceContinuation", {
          actorClerkId,
          messageId: body.choiceMessageId,
          clarificationId: body.clarificationId,
          executionId: body.clarificationExecutionId,
          choiceKey: body.choiceKey,
          batchSelections: body.batchSelections,
        }).catch(() => null)
      : Promise.resolve(null);
  const focusMode =
    body.focusMode ??
    (body.threadId
      ? "thread"
      : selectedArtifactIds.length
        ? "selection"
        : body.artifactId
          ? "artifact"
          : body.workspaceId
            ? "workspace"
            : "global");
  const lightweightConversation =
    /^(?:hi|hello|hey|thanks|thank you|good (?:morning|afternoon|evening))[!?.,\s]*$/i.test(
      prompt.trim(),
    );
  // Target resolution always receives breadth. Artifact content remains
  // shallow here and is hydrated only for the resolved targets below.
  const shouldLoadArtifactCatalog = true;
  const shouldLoadWorkspaceMap = true;
  const shouldLoadThreadMap =
    (focusMode === "global" && !lightweightConversation) ||
    focusMode === "thread" ||
    explicitContextObjects.some((item) => item.type === "thread");
  const shouldLoadActivity =
    (focusMode === "global" && !lightweightConversation) ||
    focusMode === "workspace";
  const retrievalTerms = [
    ...new Set(
      prompt
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(
          (word) =>
            word.length >= 4 &&
            !/^(this|that|with|from|into|about|please|could|would|make|create|update|change|help)$/.test(
              word,
            ),
        ),
    ),
  ].slice(0, 6);
  const [
    artifactRows,
    retrievedRows,
    workspaceRows,
    threadRows,
    workspace,
    focusedArtifact,
    threadDetail,
    continuationChoice,
    recentRuns,
    longTermMemory,
    libraryScope,
    libraryPath,
  ] = await Promise.all([
    shouldLoadArtifactCatalog
      ? query<unknown & object, unknown>("spectraArtifacts:list", {
          actorClerkId,
          placement: "all",
          limit: 48,
        })
      : Promise.resolve([]),
    shouldLoadArtifactCatalog
      ? Promise.all(
          retrievalTerms.slice(0, 3).map((search) =>
            query<unknown & object, unknown>("spectraArtifacts:list", {
              actorClerkId,
              placement: "all",
              search,
              limit: 8,
            }).catch(() => []),
          ),
        )
      : Promise.resolve([]),
    shouldLoadWorkspaceMap
      ? query<unknown & object, unknown>("spectraWorkspaces:list", {
          actorClerkId,
          includeArchived: false,
          limit: 24,
        })
      : Promise.resolve([]),
    shouldLoadThreadMap
      ? query<unknown & object, unknown>("spectraThreads:list", {
          actorClerkId,
          includeArchived: false,
          limit: 40,
        }).catch(() => [])
      : Promise.resolve([]),
    body.workspaceId
      ? query<unknown & object, unknown>("orgTree:listWorkspaceContents", {
          actorClerkId,
          workspaceId: body.workspaceId,
          includeDetails: false,
        }).catch(() => null)
      : Promise.resolve(null),
    body.artifactId
      ? query<unknown & object, unknown>("spectraArtifacts:get", {
          actorClerkId,
          artifactId: body.artifactId,
        }).catch(() => null)
      : Promise.resolve(null),
    body.threadId
      ? query<unknown & object, unknown>("spectraThreads:get", {
          actorClerkId,
          threadId: body.threadId,
        }).catch(() => null)
      : Promise.resolve(null),
    continuationChoicePromise,
    shouldLoadActivity
      ? query<unknown & object, unknown>("spectraRuns:listRecent", {
          actorClerkId,
          limit: 8,
        }).catch(() => [])
      : Promise.resolve([]),
    lightweightConversation
      ? Promise.resolve(null)
      : act<unknown & object, unknown>("memory:contextForRun", {
          actorClerkId,
          queryText: prompt,
          workspaceId: body.workspaceId,
          artifactId: body.artifactId,
        }).catch(() => null),
    body.scopeNodeId
      ? query<unknown & object, unknown>("orgTree:subtree", {
          actorClerkId,
          nodeId: body.scopeNodeId,
          limit: 120,
        }).catch(() => null)
      : Promise.resolve(null),
    body.scopeNodeId
      ? query<unknown & object, unknown>("orgTree:path", {
          nodeId: body.scopeNodeId,
        }).catch(() => null)
      : Promise.resolve(null),
  ]);
  const continuedThreadRecord =
    threadDetail && typeof threadDetail === "object"
      ? ((threadDetail as Record<string, unknown>).thread as
          Record<string, unknown> | undefined)
      : undefined;
  const continuedArtifactId =
    typeof continuedThreadRecord?.artifactId === "string"
      ? continuedThreadRecord.artifactId
      : undefined;
  const continuationRecord =
    continuationChoice && typeof continuationChoice === "object"
      ? (continuationChoice as Record<string, unknown>)
      : null;
  const continuationOriginalPrompt =
    continuationRecord?.askingRun &&
    typeof continuationRecord.askingRun === "object" &&
    typeof (continuationRecord.askingRun as Record<string, unknown>).userPrompt ===
      "string"
      ? String(
          (continuationRecord.askingRun as Record<string, unknown>).userPrompt,
        )
      : "";
  const targetingPrompt = [prompt, continuationOriginalPrompt]
    .filter((value) => value.trim())
    .join("\n");
  const continuationClarification =
    continuationRecord?.clarification && typeof continuationRecord.clarification === "object"
      ? (continuationRecord.clarification as Record<string, unknown>)
      : null;
  const continuationTargetIds = Array.isArray(continuationClarification?.targetIds)
    ? continuationClarification.targetIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      )
    : [];
  const continuationSelection =
    continuationRecord?.selection && typeof continuationRecord.selection === "object"
      ? (continuationRecord.selection as Record<string, unknown>)
      : null;
  const selectedContinuationTargetId =
    typeof continuationSelection?.key === "string" &&
    continuationTargetIds.includes(continuationSelection.key)
      ? continuationSelection.key
      : undefined;
  const boundContinuationTargetIds = selectedContinuationTargetId
    ? [selectedContinuationTargetId]
    : continuationTargetIds;
  const continuationArtifactId = boundContinuationTargetIds[0];
  const effectiveArtifactId = continuationArtifactId ?? body.artifactId;
  const effectiveFocusedArtifact =
    continuationArtifactId && continuationArtifactId !== body.artifactId
      ? await query<unknown & object, unknown>("spectraArtifacts:get", {
          actorClerkId,
          artifactId: continuationArtifactId,
        }).catch(() => null)
      : focusedArtifact;
  const threadAttachmentArtifact =
    !body.artifactId && continuedArtifactId
      ? await query<unknown & object, unknown>("spectraArtifacts:get", {
          actorClerkId,
          artifactId: continuedArtifactId,
        }).catch(() => null)
      : null;
  const durableSelectedArtifactIds = [
    ...new Set([...selectedArtifactIds, ...boundContinuationTargetIds]),
  ].slice(0, 24);
  const selectedRows = await Promise.all(
    durableSelectedArtifactIds.map((artifactId) =>
      query<unknown & object, unknown>("spectraArtifacts:get", {
        actorClerkId,
        artifactId,
      }).catch(() => null),
    ),
  );
  // Convex spectraArtifacts.content can lag the collaboration room (projection
  // races / omitted projections). Prefer live Yjs for focused + selected
  // artifacts so just-saved editor state is what the model reviews.
  const [liveFocusedArtifact, ...liveSelectedRows] = await Promise.all([
    effectiveFocusedArtifact && typeof effectiveFocusedArtifact === "object"
      ? hydrateArtifactWithLiveContent(
          effectiveFocusedArtifact as Record<string, unknown>,
        )
      : Promise.resolve(null),
    ...selectedRows.map((row) =>
      row && typeof row === "object"
        ? hydrateArtifactWithLiveContent(row as Record<string, unknown>)
        : Promise.resolve(null),
    ),
  ]);
  const hydratedFocusedArtifact =
    liveFocusedArtifact ?? effectiveFocusedArtifact;
  const baseArtifacts = [
    ...rows(artifactRows),
    ...retrievedRows.flatMap((result) => rows(result)),
    ...(hydratedFocusedArtifact && typeof hydratedFocusedArtifact === "object"
      ? [hydratedFocusedArtifact as Record<string, unknown>]
      : []),
    ...(threadAttachmentArtifact && typeof threadAttachmentArtifact === "object"
      ? [threadAttachmentArtifact as Record<string, unknown>]
      : []),
    ...liveSelectedRows.flatMap((row) =>
      row && typeof row === "object" ? [row as Record<string, unknown>] : [],
    ),
  ].filter(
    (artifact, index, all) =>
      all.findIndex((candidate) => candidate._id === artifact._id) === index,
  );
  const namedExistingArtifactId = explicitlyNamedExistingArtifactId(
    targetingPrompt,
    baseArtifacts,
  );
  const namedExistingArtifact =
    namedExistingArtifactId && namedExistingArtifactId !== effectiveArtifactId
      ? await query<unknown & object, unknown>("spectraArtifacts:get", {
          actorClerkId,
          artifactId: namedExistingArtifactId,
        }).catch(() => null)
      : null;
  const resolvedFocusedArtifact =
    namedExistingArtifact && typeof namedExistingArtifact === "object"
      ? await hydrateArtifactWithLiveContent(
          namedExistingArtifact as Record<string, unknown>,
        )
      : hydratedFocusedArtifact;
  const resolvedEffectiveArtifactId =
    namedExistingArtifactId ?? effectiveArtifactId;
  const artifacts = [
    ...baseArtifacts,
    ...(resolvedFocusedArtifact && typeof resolvedFocusedArtifact === "object"
      ? [resolvedFocusedArtifact as Record<string, unknown>]
      : []),
  ].filter(
    (artifact, index, all) =>
      all.findIndex((candidate) => candidate._id === artifact._id) === index,
  );
  // Agent artifacts are routing candidates, not ordinary knowledge. Keep
  // their instructions out of catalog/workspace context unless the user is
  // explicitly inspecting or editing that exact Agent artifact.
  const ordinaryContextArtifacts = artifacts.filter(
    (artifact) =>
      artifact.blueprintKey !== "agent" ||
      artifact._id === resolvedEffectiveArtifactId ||
      selectedArtifactIds.includes(String(artifact._id)) ||
      artifact._id === namedExistingArtifactId,
  );
  const ownedArtifactIdSet = new Set(
    artifacts.flatMap((artifact) =>
      typeof artifact._id === "string" ? [artifact._id] : [],
    ),
  );
  const ownedSelectedArtifactIds = [
    ...new Set([
      ...durableSelectedArtifactIds,
      ...(namedExistingArtifactId ? [namedExistingArtifactId] : []),
    ]),
  ].filter((id) => ownedArtifactIdSet.has(id));
  const linkedContextIds = [
    ...new Set([
      ...ownedSelectedArtifactIds,
      ...(resolvedEffectiveArtifactId ? [resolvedEffectiveArtifactId] : []),
      ...(continuedArtifactId ? [continuedArtifactId] : []),
    ]),
  ].slice(0, 12);
  const linkRows = await Promise.all(
    linkedContextIds.map(async (artifactId) => ({
      artifactId,
      links: rows(
        await query<unknown & object, unknown>(
          "spectraArtifactLinks:listForArtifact",
          { actorClerkId, artifactId, limit: 8 },
        ).catch(() => []),
      ).map((link) => ({
        relationType: link.relationType,
        direction: link.direction,
        artifact: link.artifact,
      })),
    })),
  );
  const linksByArtifact = Object.fromEntries(
    linkRows.map((row) => [row.artifactId, row.links]),
  );
  const explicitWorkspaceIds = new Set(
    explicitContextObjects
      .filter((item) => item.type === "workspace")
      .map((item) => item.id),
  );
  const explicitWorkspaceDetails = await Promise.all(
    [...explicitWorkspaceIds]
      .filter(
        (id): id is string => typeof id === "string" && id !== body.workspaceId,
      )
      .slice(0, 3)
      .map((workspaceId) =>
        query<unknown & object, unknown>("orgTree:listWorkspaceContents", {
          actorClerkId,
          workspaceId,
          includeDetails: false,
        }).catch(() => null),
      ),
  );
  const explicitWorkspaceObjectsById = new Map(
    explicitWorkspaceDetails.flatMap((detail) => {
      if (!detail || typeof detail !== "object") return [];
      const record = detail as Record<string, unknown>;
      const workspace = record.workspace as Record<string, unknown> | undefined;
      if (typeof workspace?._id !== "string") return [];
      return [
        [
          workspace._id,
          rows(record.items)
            .slice(0, 14)
            .map((item) =>
              item.artifact && typeof item.artifact === "object"
                ? summarizeArtifact(item.artifact as Record<string, unknown>)
                : { type: item.kind },
            ),
        ] as const,
      ];
    }),
  );
  const explicitThreadIds = new Set(
    explicitContextObjects
      .filter((item) => item.type === "thread")
      .map((item) => item.id),
  );
  const explicitThreadDetails = await Promise.all(
    [...explicitThreadIds]
      .filter(
        (id): id is string => typeof id === "string" && id !== body.threadId,
      )
      .slice(0, 3)
      .map((threadId) =>
        query<unknown & object, unknown>("spectraThreads:get", {
          actorClerkId,
          threadId,
        }).catch(() => null),
      ),
  );
  const explicitThreadExcerptById = new Map(
    explicitThreadDetails.flatMap((detail) => {
      if (!detail || typeof detail !== "object") return [];
      const record = detail as Record<string, unknown>;
      const thread = record.thread as Record<string, unknown> | undefined;
      if (typeof thread?._id !== "string") return [];
      return [
        [
          thread._id,
          rows(record.messages)
            .slice(-8)
            .map((message) => ({
              role: message.role,
              content:
                typeof message.content === "string"
                  ? message.content.slice(0, 1_200)
                  : "",
            })),
        ] as const,
      ];
    }),
  );
  const explicitArtifactIds = new Set(
    explicitContextObjects
      .filter((item) => item.type === "artifact")
      .map((item) => item.id),
  );
  const contextReasons = Object.fromEntries(
    ownedSelectedArtifactIds.map((id) => [
      id,
      explicitArtifactIds.has(id)
        ? "explicit"
        : id === resolvedEffectiveArtifactId
          ? "open"
          : "visible",
    ]),
  ) as Record<string, "open" | "selected" | "explicit" | "visible">;
  const workspaces = rows(workspaceRows).map((item) => ({
    id: item._id,
    title: item.title,
    description: item.description,
    explicit: explicitWorkspaceIds.has(String(item._id)),
    objects: explicitWorkspaceObjectsById.get(String(item._id)),
  }));
  const scopedLibrary =
    libraryScope && typeof libraryScope === "object"
      ? (libraryScope as Record<string, unknown>)
      : null;
  const libraryMap = [
    ...(scopedLibrary?.root && typeof scopedLibrary.root === "object"
      ? [scopedLibrary.root as Record<string, unknown>]
      : []),
    ...rows(scopedLibrary?.nodes),
  ].map((item) => {
    const source =
      item.source && typeof item.source === "object"
        ? (item.source as Record<string, unknown>)
        : null;
    return {
      id: item._id ?? item.id,
      title: item.name ?? item.title,
      type: item.kind ?? item.type,
      sourceId: item.sourceId,
      parentId: item.parentId,
      workspaceId: item.workspaceContextId,
      summary:
        typeof source?.summary === "string"
          ? source.summary.slice(0, 360)
          : undefined,
    };
  });
  const libraryPathRecord =
    libraryPath &&
    typeof libraryPath === "object" &&
    !Array.isArray(libraryPath)
      ? (libraryPath as Record<string, unknown>)
      : null;
  const libraryPathNode =
    libraryPathRecord?.node &&
    typeof libraryPathRecord.node === "object" &&
    !Array.isArray(libraryPathRecord.node)
      ? (libraryPathRecord.node as Record<string, unknown>)
      : null;
  const libraryLocation =
    body.scopeNodeId && libraryPathNode
      ? {
          id: body.scopeNodeId,
          title: String(libraryPathNode.name ?? libraryPathNode.title ?? ""),
          type: String(libraryPathNode.kind ?? libraryPathNode.type ?? ""),
          parentId:
            typeof libraryPathNode.parentId === "string"
              ? libraryPathNode.parentId
              : null,
          path: rows(libraryPathRecord?.ancestors)
            .map((item) => ({
              id: String(item._id ?? item.id ?? ""),
              title: String(item.name ?? item.title ?? ""),
              type: String(item.kind ?? item.type ?? ""),
            }))
            .concat([
              {
                id: body.scopeNodeId,
                title: String(
                  libraryPathNode.name ?? libraryPathNode.title ?? "",
                ),
                type: String(
                  libraryPathNode.kind ?? libraryPathNode.type ?? "",
                ),
              },
            ])
            .filter((item) => item.id),
        }
      : null;
  const threads = rows(threadRows)
    .map((item) => ({
      id: item._id,
      title: item.title,
      summary: item.summaryShort,
      workspaceId: item.workspaceId,
      lastMessageAt: item.lastMessageAt,
      explicit: explicitThreadIds.has(String(item._id)),
      contextExcerpt: explicitThreadExcerptById.get(String(item._id)),
    }))
    .slice(0, 24);
  const workspaceRecord =
    workspace && typeof workspace === "object"
      ? (workspace as Record<string, unknown>)
      : null;
  const focusedRecord =
    resolvedFocusedArtifact && typeof resolvedFocusedArtifact === "object"
      ? (resolvedFocusedArtifact as Record<string, unknown>)
      : null;
  const conversation =
    threadDetail && typeof threadDetail === "object"
      ? rows((threadDetail as Record<string, unknown>).messages)
          .slice(-24)
          .map((message) => ({
            role: message.role,
            content:
              typeof message.content === "string"
                ? message.content.slice(0, 8_000)
                : "",
          }))
      : [];
  const continuedThread =
    threadDetail && typeof threadDetail === "object"
      ? ((threadDetail as Record<string, unknown>).thread as
          Record<string, unknown> | undefined)
      : undefined;
  const continuedMessages =
    threadDetail && typeof threadDetail === "object"
      ? rows((threadDetail as Record<string, unknown>).messages)
      : [];
  const continuedTraces =
    threadDetail && typeof threadDetail === "object"
      ? rows((threadDetail as Record<string, unknown>).traces)
      : [];
  // A choice is an answer to one specific unresolved request, not a new
  // free-floating instruction. Bind it to the run that asked the question so
  // long, reused threads cannot resurrect an unrelated earlier goal.
  const selectedClarification = continuationRecord?.message && typeof continuationRecord.message === "object"
    ? (continuationRecord.message as Record<string, unknown>)
    : body.clarificationId && body.choiceKey
      ? [...continuedMessages].reverse().find((message) => {
          if (message.role !== "assistant" || (body.choiceMessageId && message._id !== body.choiceMessageId) || !message.metadata || typeof message.metadata !== "object") return false;
          const metadata = message.metadata as Record<string, unknown>;
          const clarification = metadata.clarification as Record<string, unknown> | undefined;
          const selection = metadata.choiceSelection as Record<string, unknown> | undefined;
          return clarification?.id === body.clarificationId && clarification?.executionId === body.clarificationExecutionId && selection?.clarificationId === body.clarificationId && selection?.key === body.choiceKey && Boolean(message.runId);
        })
      : undefined;
  const clarificationMetadata =
    selectedClarification?.metadata &&
    typeof selectedClarification.metadata === "object"
      ? (selectedClarification.metadata as Record<string, unknown>)
      : null;
  const clarificationSelection =
    clarificationMetadata?.choiceSelection &&
    typeof clarificationMetadata.choiceSelection === "object"
      ? (clarificationMetadata.choiceSelection as Record<string, unknown>)
      : null;
  const clarificationTrace = selectedClarification?.runId
    ? continuedTraces.find((trace) => {
        const run = trace.run as Record<string, unknown> | undefined;
        return run?._id === selectedClarification.runId;
      })
    : undefined;
  const clarificationRun = continuationRecord?.askingRun && typeof continuationRecord.askingRun === "object"
    ? (continuationRecord.askingRun as Record<string, unknown>)
    : clarificationTrace?.run as Record<string, unknown> | undefined;
  const activeGoal = selectedClarification
    ? {
        request: clarificationRun?.userPrompt,
        question: selectedClarification.content,
        selectedChoice: clarificationSelection?.title,
        intent: clarificationRun?.planIntent,
      }
    : null;
  const conversationMemory = continuedThread
    ? {
        title: continuedThread.title,
        summary: continuedThread.summaryShort,
        originInstructions: continuedMessages
          .filter(
            (message) =>
              message.role === "user" && typeof message.content === "string",
          )
          .slice(0, 2)
          .map((message) => message.content),
      }
    : null;
  const currentWorkspace = workspaceRecord
    ? (workspaceRecord.workspace as Record<string, unknown> | undefined)
    : undefined;
  const contextPacket = buildBoundedContextPacket({
    prompt,
    focusMode,
    workspace: focusMode === "global" ? null : currentWorkspace,
    artifacts: ordinaryContextArtifacts,
    workspaceIndexArtifacts: artifacts,
    // Keep the open studio artifact as focusedArtifact whenever the client
    // sent artifactId — even if focusMode still says workspace/global. Dropping
    // it under focusMode=workspace made QC invent creates (E-03 sheets).
    focusedArtifact: focusedRecord,
    selectedArtifactIds: ownedSelectedArtifactIds,
    conversation,
    conversationMemory,
    longTermMemory:
      longTermMemory && typeof longTermMemory === "object"
        ? (longTermMemory as {
            enabled?: unknown;
            text?: unknown;
            claims?: unknown[];
            estimatedTokens?: unknown;
            targetTokens?: unknown;
            exclusions?: unknown;
          })
        : null,
    activeGoal,
    currentView: body.currentView,
    semanticTargets: explicitContextObjects.flatMap((item) =>
      typeof item.semanticTargetId === "string"
        ? [
            {
              id: item.semanticTargetId,
              label: typeof item.label === "string" ? item.label : undefined,
              summary:
                typeof item.contextSummary === "string"
                  ? item.contextSummary
                  : undefined,
              anchor: item.semanticAnchor,
            },
          ]
        : [],
    ),
    linksByArtifact,
    recentActivity: rows(recentRuns)
      .filter(
        (run) => !body.workspaceId || run.workspaceId === body.workspaceId,
      )
      .slice(0, 8)
      .map((run) => ({
        id: run._id,
        prompt:
          typeof run.userPrompt === "string"
            ? run.userPrompt.slice(0, 240)
            : "",
        status: run.status,
        finalSummary:
          typeof run.finalSummary === "string"
            ? run.finalSummary.slice(0, 320)
            : undefined,
        updatedAt: run.updatedAt,
      })),
    workspaceMap: workspaces,
    libraryMap,
    currentLibraryLocation: libraryLocation,
    threadMap: threads,
    inboxMap: ordinaryContextArtifacts
      .filter((artifact) => rows(artifact.placements).length === 0)
      .slice(0, 20)
      .map((artifact) => summarizeArtifact(artifact)),
    contextReasons,
    continuationThreadId: body.threadId,
    threadAttachmentArtifactId: continuedArtifactId,
  });
  return {
    workspaces,
    threads,
    currentWorkspace: workspaceRecord
      ? {
          id: (workspaceRecord.workspace as Record<string, unknown> | undefined)
            ?._id,
          title: (
            workspaceRecord.workspace as Record<string, unknown> | undefined
          )?.title,
          items: rows(workspaceRecord.items).map((item) => ({
            id: item.nodeId,
            workspaceId: item.workspaceId,
            kind: item.kind,
            sourceId: item.sourceId,
            artifact:
              item.artifact && typeof item.artifact === "object"
                ? summarizeArtifact(item.artifact as Record<string, unknown>)
                : null,
          })),
        }
      : null,
    focusedArtifact: focusedRecord
      ? summarizeArtifact(focusedRecord, true)
      : null,
    artifacts: artifacts.map((artifact) => summarizeArtifact(artifact)),
    conversation,
    currentThreadId: body.threadId ?? null,
    selectedArtifactIds: ownedSelectedArtifactIds,
    focusMode,
    currentLibraryLocation: libraryLocation,
    packet: contextPacket,
    memoryRetrieval:
      longTermMemory && typeof longTermMemory === "object"
        ? (longTermMemory as Record<string, unknown>)
        : null,
    retainedAgentId:
      typeof continuedThread?.retainedAgentId === "string"
        ? continuedThread.retainedAgentId
        : null,
    threadAttachmentArtifactId: continuedArtifactId ?? null,
  };
}

export async function queueSilentMemoryMaintenance(input: {
  actorClerkId: string;
  runId: string;
  prompt: string;
  threadId?: string;
  workspaceId?: string;
  artifactId?: string;
  retrieval?: Record<string, unknown> | null;
}) {
  const sourceType = input.artifactId
    ? ("artifact" as const)
    : input.workspaceId
      ? ("workspace" as const)
      : ("thread" as const);
  const sourceId =
    input.artifactId ?? input.workspaceId ?? input.threadId ?? input.runId;
  const retrieval = input.retrieval;
  const selectedClaimIds = Array.isArray(retrieval?.selectedClaimIds)
    ? retrieval.selectedClaimIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const candidateClaimIds = Array.isArray(retrieval?.candidateClaimIds)
    ? retrieval.candidateClaimIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const exclusions =
    retrieval?.exclusions &&
    typeof retrieval.exclusions === "object" &&
    !Array.isArray(retrieval.exclusions)
      ? (retrieval.exclusions as Record<string, unknown>)
      : {};
  await Promise.all([
    mutate("memory:captureExplicitSignal", {
      actorClerkId: input.actorClerkId,
      text: input.prompt,
      sourceType,
      sourceId,
      workspaceId: input.workspaceId,
      artifactId: input.artifactId,
    }).catch(() => null),
    selectedClaimIds.length
      ? mutate("memory:recordRetrieval", {
          actorClerkId: input.actorClerkId,
          runId: input.runId,
          purpose: "initial_run_context",
          queryHash: createHash("sha256").update(input.prompt).digest("hex"),
          candidateClaimIds,
          selectedClaimIds,
          exclusionCounts: {
            scope: typeof exclusions.scope === "number" ? exclusions.scope : 0,
            permission:
              typeof exclusions.permission === "number"
                ? exclusions.permission
                : 0,
            stale: typeof exclusions.stale === "number" ? exclusions.stale : 0,
            disputed:
              typeof exclusions.disputed === "number" ? exclusions.disputed : 0,
            budget:
              typeof exclusions.budget === "number" ? exclusions.budget : 0,
          },
          estimatedTokens:
            typeof retrieval?.estimatedTokens === "number"
              ? retrieval.estimatedTokens
              : 0,
        }).catch(() => null)
      : Promise.resolve(null),
  ]);
}
