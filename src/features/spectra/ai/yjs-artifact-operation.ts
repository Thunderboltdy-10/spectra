import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { HocuspocusProvider } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";
import { convexMutation, convexQuery } from "@/lib/convex-server";
import { signCollaborationSession } from "@/lib/collaboration-token";
import {
  planArtifactYjsMutation,
  readArtifactYjsDocument,
  snapshotArtifactRegions,
  type ArtifactLiveValue,
  type ArtifactRegionSnapshot,
  type ArtifactYjsMutationPlan,
} from "@/features/spectra/collaboration/artifact-yjs-model";
import {
  artifactLivePreviewPatches,
  lineAnchorForRewrite,
  valueAtPath,
} from "@/features/spectra/collaboration/artifact-live-preview";
import {
  buildArtifactLivePreviewBeats,
  type AiStreamBeat,
} from "@/features/spectra/collaboration/interaction-choreography";
import {
  ARTIFACT_TYPE_KEYS,
  type ArtifactTypeKey,
} from "@/features/spectra/artifacts/types";
import { validateArtifactContent } from "@/features/spectra/artifacts/registry";
import { normalizeArtifactContent } from "@/features/spectra/ai/content-normalization";
import {
  aiInteractionFrame,
  aiSettleFrame,
} from "@/features/spectra/ai/ai-interaction-frames";
import type { ActorIdentity as FabricActor } from "@/features/spectra/collaboration/interaction-model";

type ArtifactRecord = {
  _id: string;
  blueprintKey: string;
  schemaVersion?: number;
  title: string;
  summary?: string;
  tags: string[];
  content: unknown;
};

type ActorIdentity = {
  accountId: string;
  schoolId: string;
  name: string;
};

type CollaborationSession = {
  actor: ActorIdentity;
  artifact: ArtifactRecord;
  clientId: string;
  documentName: string;
  token: string;
  url: string;
};

type RegionClaim = {
  claimId: string;
  status: "active" | "queued";
  leaseExpiresAt: number;
  conflict: null | {
    claimId: string;
    actorKind: "human" | "ai";
    regionId: string;
    leaseExpiresAt: number;
    queuePosition: number;
  };
};

export class AiArtifactRegionConflictError extends Error {
  readonly code = "AI_ARTIFACT_REGION_QUEUED";

  constructor(
    readonly claim: RegionClaim,
    readonly artifactId: string,
    readonly operationId: string,
    readonly clientId: string,
    readonly baseSnapshot?: ArtifactRegionSnapshot,
    readonly proposedSnapshot?: ArtifactRegionSnapshot,
  ) {
    super(
      `AI_ARTIFACT_REGION_QUEUED: ${claim.conflict?.regionId ?? "occupied region"}`,
    );
    this.name = "AiArtifactRegionConflictError";
  }
}

function requireArtifactType(value: string): ArtifactTypeKey {
  if (!(ARTIFACT_TYPE_KEYS as readonly string[]).includes(value)) {
    throw new Error(`ARTIFACT_TYPE_UNSUPPORTED: ${value}`);
  }
  return value as ArtifactTypeKey;
}

function stateVectorHash(document: Y.Doc) {
  return createHash("sha256")
    .update(Y.encodeStateVector(document))
    .digest("base64url");
}

async function createCollaborationSession(
  artifactId: string,
  clientId: string,
  level: "read" | "modify" = "modify",
): Promise<CollaborationSession> {
  const [actor, artifact] = await Promise.all([
    convexQuery<Record<string, never>, ActorIdentity | null>("identity:me", {}),
    convexQuery<{ artifactId: string }, ArtifactRecord>(
      "spectraArtifacts:get",
      { artifactId },
    ),
  ]);
  if (!actor)
    throw new Error(
      "AUTH_NOT_SIGNED_IN: The AI worker no longer has an authenticated owner.",
    );
  const typeKey = requireArtifactType(artifact.blueprintKey);
  const resourceType = typeKey === "agent" ? "agent" : "artifact";
  const [room, access] = await Promise.all([
    convexMutation<
      { artifactId: string; partitionKey: string; schemaVersion: number },
      { roomId: string; policyVersion: number; schemaVersion: number }
    >("collaboration:ensureRoom", {
      artifactId,
      partitionKey: "root",
      schemaVersion: artifact.schemaVersion ?? 1,
    }),
    convexQuery<
      { resourceType: string; resourceId: string },
      { allowed: boolean; level: "read" | "modify" | null }
    >("authority:access", { resourceType, resourceId: artifactId }),
  ]);
  const allowed =
    access.allowed &&
    (level === "read"
      ? access.level === "read" || access.level === "modify"
      : access.level === "modify");
  if (!allowed) {
    throw new Error(
      level === "read"
        ? "AI_ARTIFACT_PERMISSION_REVOKED: Read access was removed before the live document could be loaded."
        : "AI_ARTIFACT_PERMISSION_REVOKED: Modify access was removed before the operation committed.",
    );
  }
  const documentName = `artifact:${artifactId}:${Buffer.from("root").toString("base64url")}`;
  const token = await signCollaborationSession({
    artifactId,
    roomId: room.roomId,
    partitionKey: "root",
    documentName,
    accountId: actor.accountId,
    schoolId: actor.schoolId,
    clientId,
    displayName: actor.name.trim() ? `${actor.name.trim()}'s AI` : "Spectra AI",
    level,
    policyVersion: room.policyVersion,
    schemaVersion: room.schemaVersion ?? artifact.schemaVersion ?? 1,
  });
  return {
    actor,
    artifact,
    clientId,
    documentName,
    token,
    url: process.env.NEXT_PUBLIC_SPECTRA_COLLAB_URL ?? "ws://localhost:1234",
  };
}

function waitUntil(
  predicate: () => boolean,
  getError: () => Error | null,
  timeoutMs: number,
  timeoutMessage: string | (() => string),
) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const poll = () => {
      const error = getError();
      if (error) return reject(error);
      if (predicate()) return resolve();
      if (Date.now() - startedAt >= timeoutMs) {
        return reject(
          new Error(
            typeof timeoutMessage === "function"
              ? timeoutMessage()
              : timeoutMessage,
          ),
        );
      }
      setTimeout(poll, 20);
    };
    poll();
  });
}

async function releaseClaims(
  claims: RegionClaim[],
  clientId: string,
  resolution: "apply" | "cancel",
) {
  for (const claim of [...claims].reverse()) {
    await convexMutation<
      { claimId: string; clientId: string; resolution: "apply" | "cancel" },
      unknown
    >("regionClaims:release", {
      claimId: claim.claimId,
      clientId,
      resolution,
    }).catch(() => undefined);
  }
}

function abortError(signal?: AbortSignal) {
  if (!signal?.aborted) return null;
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The AI run was stopped.", "AbortError");
}

/** Prefer stable block ids + line scopes so TipTap can ink the live bullet. */
function normalizeStagedDocumentPath(
  path: string,
  streamValue: ArtifactLiveValue,
  lineIndex: number,
) {
  const match = path.match(/^(\/blocks\/)([^/]+)(\/.*)?$/i);
  if (!match) return path;
  const [, prefix, rawId, rest = ""] = match;
  let blockId = decodeURIComponent(rawId!);
  if (/^\d+$/.test(blockId)) {
    const blocks = (
      streamValue.content as { blocks?: Array<{ id?: unknown }> } | undefined
    )?.blocks;
    const indexed = Array.isArray(blocks) ? blocks[Number(blockId)] : undefined;
    if (indexed && typeof indexed.id === "string") blockId = indexed.id;
  }
  const lineSuffix =
    Number.isFinite(lineIndex) && lineIndex >= 0
      ? `/lines/${Math.floor(lineIndex)}`
      : "";
  if (rest.startsWith("/lines/")) return `${prefix}${blockId}${rest}`;
  if (rest === "/text" || rest.startsWith("/text"))
    return `${prefix}${blockId}${lineSuffix}`;
  return `${prefix}${blockId}${rest || lineSuffix}`;
}

async function acquirePlanClaims(params: {
  artifactId: string;
  clientId: string;
  runId: string;
  operationId: string;
  baseStateVectorHash: string;
  plan: ArtifactYjsMutationPlan;
  signal?: AbortSignal;
  onConflict?: (conflict: {
    regionId: string;
    queuePosition: number;
    actorKind: "human" | "ai";
  }) => void | Promise<void>;
  baseSnapshot?: ArtifactRegionSnapshot;
  proposedSnapshot?: ArtifactRegionSnapshot;
}) {
  const claims: RegionClaim[] = [];
  for (const region of params.plan.regions) {
    const aborted = abortError(params.signal);
    if (aborted) {
      await releaseClaims(claims, params.clientId, "cancel");
      throw aborted;
    }
    const claim = await convexMutation<
      {
        artifactId: string;
        partitionKey: string;
        clientId: string;
        regionId: string;
        overlapDomains: string[];
        baseStateVectorHash: string;
        actorKind: "ai";
        runId: string;
        operationId: string;
      },
      RegionClaim
    >("regionClaims:acquire", {
      artifactId: params.artifactId,
      partitionKey: "root",
      clientId: params.clientId,
      regionId: region.regionId,
      overlapDomains: region.overlapDomains,
      baseStateVectorHash: params.baseStateVectorHash,
      actorKind: "ai",
      runId: params.runId,
      operationId: params.operationId,
    });
    claims.push(claim);
    if (claim.status === "queued") {
      await releaseClaims(claims.slice(0, -1), params.clientId, "cancel");
      await params.onConflict?.({
        regionId: claim.conflict?.regionId ?? region.regionId,
        queuePosition: claim.conflict?.queuePosition ?? 1,
        actorKind: claim.conflict?.actorKind ?? "human",
      });
      throw new AiArtifactRegionConflictError(
        claim,
        params.artifactId,
        params.operationId,
        params.clientId,
        params.baseSnapshot,
        params.proposedSnapshot,
      );
    }
  }
  return claims;
}

async function synchronizeMutation(params: {
  document: Y.Doc;
  provider: HocuspocusProvider;
  session: CollaborationSession;
  runId: string;
  executionId: string;
  operationId: string;
  plan: ArtifactYjsMutationPlan;
  streamBase?: ArtifactLiveValue;
  streamValues?: readonly ArtifactLiveValue[];
  streamBeats?: readonly AiStreamBeat[];
  getConnectionError: () => Error | null;
  signal?: AbortSignal;
  onConflict?: (conflict: {
    regionId: string;
    queuePosition: number;
    actorKind: "human" | "ai";
  }) => void | Promise<void>;
  baseSnapshot?: ArtifactRegionSnapshot;
  proposedSnapshot?: ArtifactRegionSnapshot;
}) {
  if (params.plan.regions.length === 0)
    return { changedRegionIds: [] as string[] };
  const presence = params.provider.awareness?.getLocalState()?.user;
  const presenceRecord =
    presence && typeof presence === "object"
      ? (presence as Record<string, unknown>)
      : {};
  /**
   * The AI's fabric identity. Owner attribution travels with every frame so a
   * peer never has to guess whose AI is editing, and so the AI inherits its
   * owner's presence colour instead of a separate "robot" palette.
   */
  const ownerName = params.session.actor.name.trim();
  const fabricActor: FabricActor = {
    clientId: params.session.clientId,
    kind: "ai",
    name: ownerName ? `${ownerName}'s AI` : "Spectra AI",
    ownerAccountId: params.session.actor.accountId,
    ...(ownerName ? { ownerName } : {}),
    runId: params.runId,
    operationId: params.operationId,
  };
  const fabricTypeKey = requireArtifactType(params.session.artifact.blueprintKey);
  const startingRegionId = params.plan.regions[0]?.regionId;
  params.provider.setAwarenessField("user", {
    ...presenceRecord,
    ...(startingRegionId
      ? {
          activeRegionId: startingRegionId,
          activeRegionIds: [startingRegionId],
        }
      : {}),
  });
  const claims = await acquirePlanClaims({
    artifactId: params.session.artifact._id,
    clientId: params.session.clientId,
    runId: params.runId,
    operationId: params.operationId,
    baseStateVectorHash: stateVectorHash(params.document),
    plan: params.plan,
    signal: params.signal,
    onConflict: params.onConflict,
    baseSnapshot: params.baseSnapshot,
    proposedSnapshot: params.proposedSnapshot,
  });
  /** Last control the AI touched, so the settle frame lands on it. */
  let lastFramePath: string | undefined;
  let settleSequence = 0;
  let renewing = true;
  const renewal = setInterval(() => {
    if (!renewing) return;
    for (const claim of claims) {
      void convexMutation<
        { claimId: string; clientId: string; baseStateVectorHash: string },
        unknown
      >("regionClaims:renew", {
        claimId: claim.claimId,
        clientId: params.session.clientId,
        baseStateVectorHash: stateVectorHash(params.document),
      }).catch(() => undefined);
    }
  }, 12_000);
  const clearStreamingPresence = () => {
    const settledPresence = params.provider.awareness?.getLocalState()?.user;
    const settledRecord =
      settledPresence && typeof settledPresence === "object"
        ? (settledPresence as Record<string, unknown>)
        : {};
    const idlePresence = { ...settledRecord };
    delete idlePresence.previewPatches;
    delete idlePresence.previewSequence;
    delete idlePresence.previewPhase;
    delete idlePresence.previewGesture;
    delete idlePresence.activeRegionId;
    delete idlePresence.activeRegionIds;
    delete idlePresence.cursor;
    delete idlePresence.selection;
    delete idlePresence.interaction;
    delete idlePresence.menu;
    delete idlePresence.interactionState;
    params.provider.setAwarenessField("user", idlePresence);
  };
  try {
    const beats: AiStreamBeat[] =
      params.streamBeats && params.streamBeats.length > 0
        ? [...params.streamBeats]
        : (params.streamValues ?? []).map((value) => ({
            delayMs: 560,
            value,
            previewGesture: "typing" as const,
            cursorMode: "typing" as const,
          }));
    let previousStream = params.streamBase;
    for (const [sequence, beat] of beats.entries()) {
      settleSequence = sequence + 1;
      const aborted = abortError(params.signal);
      if (aborted) throw aborted;
      if (!params.streamBase) continue;
      const streamValue = beat.value;
      // Cumulative from the pre-edit baseline so peers can reconstruct the full
      // speculative document. Focus/highlight use the delta against the prior
      // frame so only the live edit lights up.
      const previewPatches = artifactLivePreviewPatches(
        params.streamBase,
        streamValue,
      );
      const priorStream = previousStream ?? params.streamBase;
      const deltaPatches = artifactLivePreviewPatches(priorStream, streamValue);
      previousStream = streamValue;
      const focusPatch =
        (beat.focusPath
          ? previewPatches.find((patch) => patch.path === beat.focusPath)
          : undefined) ??
        deltaPatches[0] ??
        previewPatches[0];
      const focusPath = beat.focusPath ?? focusPatch?.path ?? "/";
      const blockMatch = focusPath.match(
        /\/(?:content\/)?blocks\/(?:id:)?([^/]+)/i,
      );
      let blockId = blockMatch
        ? decodeURIComponent(blockMatch[1]!)
        : undefined;
      if (blockId && /^\d+$/.test(blockId)) {
        const blocks = (
          streamValue.content as { blocks?: Array<{ id?: unknown }> } | undefined
        )?.blocks;
        const indexed = Array.isArray(blocks)
          ? blocks[Number(blockId)]
          : undefined;
        blockId =
          indexed && typeof indexed.id === "string" ? indexed.id : undefined;
      }
      const matchedRegion =
        (blockId
          ? params.plan.regions.find(
              (region) =>
                region.regionId === blockId ||
                region.regionId.endsWith(`:${blockId}`) ||
                region.regionId.includes(blockId),
            )
          : undefined) ??
        params.plan.regions.find((region) =>
          focusPath.includes(region.regionId.replace(/^.*:/, "")),
        ) ??
        params.plan.regions[0];
      const activeRegionId = matchedRegion?.regionId;
      const focusValue = focusPatch?.value;
      const finalAtPath = valueAtPath(
        beats[beats.length - 1]?.value ?? streamValue,
        focusPath,
      );
      const beforeAtPath = valueAtPath(params.streamBase, focusPath);
      const caretAnchor =
        typeof beat.caretOffset === "number"
          ? {
              offsetInLine: beat.caretOffset,
              lineIndex:
                typeof beat.lineIndex === "number" ? beat.lineIndex : 0,
            }
          : typeof focusValue === "string" &&
              typeof beforeAtPath === "string" &&
              typeof finalAtPath === "string"
            ? lineAnchorForRewrite(beforeAtPath, finalAtPath, focusValue)
            : {
                offsetInLine:
                  typeof focusValue === "string" ? focusValue.length : 0,
                lineIndex:
                  typeof beat.lineIndex === "number" ? beat.lineIndex : 0,
              };
      const caretOffset = caretAnchor.offsetInLine;
      const lineIndex = caretAnchor.lineIndex;
      const selectionEnd =
        typeof beat.selectionEnd === "number" ? beat.selectionEnd : undefined;
      const livePresence = params.provider.awareness?.getLocalState()?.user;
      const livePresenceRecord =
        livePresence && typeof livePresence === "object"
          ? (livePresence as Record<string, unknown>)
          : {};
      const previewGesture =
        beat.previewGesture ??
        (beat.menu?.open ? ("selecting" as const) : ("typing" as const));
      const selectingLine =
        previewGesture === "selecting" &&
        typeof selectionEnd === "number" &&
        selectionEnd > 0;
      // Protocol v2 frame. The act is derived from the values themselves, so
      // presence can only claim an edit that genuinely happened between beats.
      const framePath = focusPath.startsWith("/content/")
        ? focusPath.slice("/content".length)
        : focusPath;
      lastFramePath = framePath;
      const interactionState = aiInteractionFrame({
        artifactId: params.session.artifact._id,
        typeKey: fabricTypeKey,
        actor: fabricActor,
        path: framePath,
        ...(activeRegionId ? { regionId: activeRegionId } : {}),
        before: valueAtPath(priorStream, focusPath),
        after: focusValue,
        ...(selectingLine ? { selectionEnd } : {}),
        ...(beat.menu?.open && beat.menu.label
          ? {
              menu: {
                label: beat.menu.label,
                options: (beat.menu.options ?? []).map((option) =>
                  typeof option === "string"
                    ? { value: option, label: option }
                    : option,
                ),
                ...(beat.menu.highlighted
                  ? { highlighted: beat.menu.highlighted }
                  : {}),
              },
            }
          : {}),
        sequence,
        patches: previewPatches.map((patch) => ({
          path: patch.path,
          value: patch.value,
        })),
        ...(activeRegionId ? { heldRegionIds: [activeRegionId] } : {}),
      });
      params.provider.setAwarenessField("user", {
        ...livePresenceRecord,
        interactionState,
        ...(activeRegionId
          ? {
              activeRegionId,
              activeRegionIds: [activeRegionId],
            }
          : {}),
        ...(previewPatches.length ? { previewPatches } : {}),
        previewSequence: sequence,
        previewPhase: "streaming",
        previewGesture,
        ...(beat.interaction !== undefined
          ? { interaction: beat.interaction }
          : {}),
        ...(beat.menu !== undefined ? { menu: beat.menu } : { menu: null }),
        ...(blockId && (typeof focusValue === "string" || selectingLine)
          ? {
              selection: selectingLine
                ? {
                    kind: "text" as const,
                    collapsed: false,
                    ranges: [
                      {
                        blockId,
                        startOffset: 0,
                        endOffset: selectionEnd,
                        lineIndex,
                      },
                    ],
                  }
                : {
                    kind: "text" as const,
                    collapsed: true,
                    ranges: [
                      {
                        blockId,
                        startOffset: caretOffset,
                        endOffset: caretOffset,
                        lineIndex,
                      },
                    ],
                  },
            }
          : { selection: null }),
        cursor: {
          x: 0.5,
          y: 0.42,
          updatedAt: Date.now(),
          mode:
            beat.cursorMode ??
            (selectingLine || beat.menu?.open ? "selecting" : "typing"),
          anchor: blockId
            ? {
                kind: "block" as const,
                id: blockId,
                charOffset: selectingLine ? 0 : caretOffset,
                lineIndex,
              }
            : {
                kind: "path" as const,
                id: focusPath,
                charOffset: selectingLine ? 0 : caretOffset,
                lineIndex,
              },
        },
      });
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.max(48, beat.delayMs)),
      );
      if (
        (sequence === 0 ||
          sequence % 2 === 0 ||
          sequence === beats.length - 1) &&
        (deltaPatches.length > 0 ||
          previewPatches.length > 0 ||
          Boolean(beat.focusPath))
      ) {
        const focusPaths = [
          ...new Set(
            (deltaPatches.length ? deltaPatches : previewPatches).map(
              (patch) =>
                patch.path.startsWith("/content/")
                  ? patch.path.slice("/content".length)
                  : patch.path,
            ),
          ),
        ].slice(0, 16);
        const stagedPaths = (
          focusPaths.length
            ? focusPaths
            : beat.focusPath
              ? [
                  beat.focusPath.startsWith("/content/")
                    ? beat.focusPath.slice("/content".length)
                    : beat.focusPath,
                ]
              : []
        ).map((path) =>
          normalizeStagedDocumentPath(path, streamValue, lineIndex),
        );
        // Always keep a line-scoped pointer so settle ink lands on the bullet,
        // not the whole list container.
        if (
          blockId &&
          Number.isFinite(lineIndex) &&
          !stagedPaths.some((path) => path.includes("/lines/"))
        ) {
          stagedPaths.push(`/blocks/${blockId}/lines/${Math.floor(lineIndex)}`);
        }
        if (
          (sequence === beats.length - 1 ||
            beat.previewGesture === "typing" ||
            sequence % 3 === 0) &&
          stagedPaths.length > 0
        ) {
          void convexMutation("spectraArtifacts:stageAiPatch", {
            artifactId: params.session.artifact._id,
            runId: params.runId,
            executionId: params.executionId,
            title: streamValue.title,
            ...(streamValue.summary !== undefined
              ? { summary: streamValue.summary }
              : {}),
            content: streamValue.content,
            tags: streamValue.tags,
            changedPaths: stagedPaths,
          }).catch(() => undefined);
        }
      }
    }
    params.document.transact(params.plan.apply, {
      kind: "spectra-ai-operation",
      runId: params.runId,
      operationId: params.operationId,
    });
    params.provider.flushPendingUpdates();
    await waitUntil(
      () => params.provider.synced && !params.provider.hasUnsyncedChanges,
      params.getConnectionError,
      30_000,
      "AI_ARTIFACT_SYNC_TIMEOUT: The live edit was not durably acknowledged.",
    );
    await releaseClaims(claims, params.session.clientId, "apply");
    // Brief post-edit pause so peers can see the finished caret — then clear
    // streaming chrome. Do not keep previewPhase="streaming" or the owner UI
    // stays stuck in "updating" with a permanent AI badge.
    const holdPresence = params.provider.awareness?.getLocalState()?.user;
    if (holdPresence && typeof holdPresence === "object") {
      const held = { ...(holdPresence as Record<string, unknown>) };
      delete held.previewPatches;
      delete held.previewPhase;
      delete held.previewGesture;
      // Settle on the control that was just edited. Speculation is dropped here
      // because the value is durable now: peers stop previewing and read Yjs.
      const settledPath = lastFramePath ?? "/";
      params.provider.setAwarenessField("user", {
        ...held,
        interactionState: aiSettleFrame({
          artifactId: params.session.artifact._id,
          typeKey: fabricTypeKey,
          actor: fabricActor,
          path: settledPath,
          ...(params.plan.regions[0]?.regionId
            ? { regionId: params.plan.regions[0].regionId }
            : {}),
          before: undefined,
          after: undefined,
          sequence: settleSequence,
        }),
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 420));
    }
    return {
      changedRegionIds: params.plan.regions.map((region) => region.regionId),
    };
  } catch (error) {
    await releaseClaims(claims, params.session.clientId, "cancel");
    throw error;
  } finally {
    renewing = false;
    clearInterval(renewal);
    clearStreamingPresence();
  }
}

/**
 * Read the synchronized collaborative Yjs document for an artifact.
 * Returns null when the room is uninitialized, unreachable, or invalid so
 * callers can fall back to the Convex baseline without failing the run.
 */
export async function readLiveArtifactValue(params: {
  artifactId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<ArtifactLiveValue | null> {
  const timeoutMs = Math.max(500, Math.min(params.timeoutMs ?? 4_000, 12_000));
  const aborted = abortError(params.signal);
  if (aborted) throw aborted;
  const clientId = `ai-read:${params.artifactId}:${randomUUID()}`.slice(0, 180);
  let session: CollaborationSession;
  try {
    session = await createCollaborationSession(
      params.artifactId,
      clientId,
      "read",
    );
  } catch {
    return null;
  }
  const typeKey = requireArtifactType(session.artifact.blueprintKey);
  const document = new Y.Doc();
  let connectionError: Error | null = null;
  const provider = new HocuspocusProvider({
    url: session.url,
    WebSocketPolyfill: WebSocket,
    name: session.documentName,
    document,
    token: session.token,
    flushDelay: 40,
    onAuthenticationFailed: ({ reason }) => {
      connectionError = new Error(
        `AI_ARTIFACT_PERMISSION_REVOKED: ${reason || "Collaboration access was rejected."}`,
      );
    },
    onDisconnect: ({ event }) => {
      if (event.code === 4403) {
        connectionError = new Error(
          `AI_ARTIFACT_PERMISSION_REVOKED: ${event.reason || "Access was removed."}`,
        );
      } else if (!provider.synced) {
        connectionError = new Error(
          `AI_ARTIFACT_CONNECTION_CLOSED: The collaboration gateway closed before synchronization (${event.code}${event.reason ? `: ${event.reason}` : ""}).`,
        );
      }
    },
  } as ConstructorParameters<typeof HocuspocusProvider>[0] & {
    WebSocketPolyfill: typeof WebSocket;
  });
  try {
    await waitUntil(
      () => provider.synced && provider.isAuthenticated,
      () => abortError(params.signal) ?? connectionError,
      timeoutMs,
      () =>
        `AI_ARTIFACT_CONNECT_TIMEOUT: Live artifact read timed out after ${timeoutMs}ms.`,
    );
    try {
      return readArtifactYjsDocument(document, typeKey);
    } catch {
      // Invalid / sparse live state — fall back to Convex baseline.
      return null;
    }
  } catch {
    return null;
  } finally {
    provider.destroy();
    document.destroy();
  }
}

export async function applyAiArtifactMutation(params: {
  artifactId: string;
  runId: string;
  operationId: string;
  executionId: string;
  resolveDesired: (current: ArtifactLiveValue) => ArtifactLiveValue;
  signal?: AbortSignal;
  onConflict?: (conflict: {
    regionId: string;
    queuePosition: number;
    actorKind: "human" | "ai";
  }) => void | Promise<void>;
  collaborationClientId?: string;
  checkpointBeforeAi?: boolean;
}) {
  const clientId =
    params.collaborationClientId?.trim().slice(0, 180) ||
    `ai:${params.runId}:${params.operationId}:${randomUUID()}`.slice(0, 180);
  const session = await createCollaborationSession(params.artifactId, clientId);
  const typeKey = requireArtifactType(session.artifact.blueprintKey);
  const document = new Y.Doc();
  let connectionError: Error | null = null;
  let connectionStatus = "initializing";
  let opened = false;
  let authenticated = false;
  let syncEventReceived = false;
  let presenceStartedAt = 0;
  const provider = new HocuspocusProvider({
    url: session.url,
    WebSocketPolyfill: WebSocket,
    name: session.documentName,
    document,
    token: session.token,
    flushDelay: 40,
    onOpen: () => {
      opened = true;
    },
    onStatus: ({ status }) => {
      connectionStatus = status;
    },
    onAuthenticated: () => {
      authenticated = true;
    },
    onSynced: () => {
      syncEventReceived = true;
    },
    onAuthenticationFailed: ({ reason }) => {
      connectionError = new Error(
        `AI_ARTIFACT_PERMISSION_REVOKED: ${reason || "Collaboration access was rejected."}`,
      );
    },
    onDisconnect: ({ event }) => {
      if (event.code === 4403) {
        connectionError = new Error(
          `AI_ARTIFACT_PERMISSION_REVOKED: ${event.reason || "Access was removed."}`,
        );
      } else if (!provider.synced) {
        connectionError = new Error(
          `AI_ARTIFACT_CONNECTION_CLOSED: The collaboration gateway closed before synchronization (${event.code}${event.reason ? `: ${event.reason}` : ""}).`,
        );
      }
    },
  } as ConstructorParameters<typeof HocuspocusProvider>[0] & {
    WebSocketPolyfill: typeof WebSocket;
  });
  const connectStartedAt = Date.now();
  try {
    await waitUntil(
      () => provider.synced && provider.isAuthenticated,
      () => connectionError,
      12_000,
      () =>
        `AI_ARTIFACT_CONNECT_TIMEOUT: The live artifact could not be synchronized within 12s (status=${connectionStatus}, opened=${opened}, authenticated=${authenticated || provider.isAuthenticated}, syncEvent=${syncEventReceived}, synced=${provider.synced}, elapsedMs=${Date.now() - connectStartedAt}). Fast-fail so pending shells can be discarded instead of pulsing indefinitely.`,
    );
    console.info("[spectra.ai.artifact.connect]", {
      artifactId: params.artifactId,
      runId: params.runId,
      operationId: params.operationId,
      connectMs: Date.now() - connectStartedAt,
      status: connectionStatus,
      authenticated: authenticated || provider.isAuthenticated,
      synced: provider.synced,
    });
    const presenceName = session.actor.name.trim()
      ? `${session.actor.name.trim()}'s AI`
      : "Spectra AI";
    // Arrive as present-but-idle. No cursor coordinate is published: before the
    // first operation envelope there is no control to point at, and inventing a
    // position is exactly how a decorative cursor ends up parked mid-canvas.
    provider.setAwarenessField("user", {
      clientId,
      accountId: session.actor.accountId,
      name: presenceName,
      displayName: presenceName,
      actorKind: "ai",
      runId: params.runId,
      operationId: params.operationId,
      interactionState: {
        v: 2 as const,
        actor: {
          clientId,
          kind: "ai" as const,
          name: presenceName,
          ownerAccountId: session.actor.accountId,
          ...(session.actor.name.trim()
            ? { ownerName: session.actor.name.trim() }
            : {}),
          runId: params.runId,
          operationId: params.operationId,
        },
        act: { kind: "idle" as const },
        lifecycle: "queued" as const,
        target: null,
        at: Date.now(),
      },
    });
    presenceStartedAt = Date.now();
    // Awareness is a visible part of the operation, not disposable metadata.
    // Give the gateway one bounded paint window to fan out the AI collaborator
    // before a fast Yjs transaction can finish and tear down the provider.
    await new Promise<void>((resolve) => setTimeout(resolve, 350));

    let current = readArtifactYjsDocument(document, typeKey);
    if (!current) {
      const baselineContent = normalizeArtifactContent(
        typeKey,
        session.artifact.content,
      );
      const baselineValidation = validateArtifactContent(
        typeKey,
        baselineContent,
      );
      if (!baselineValidation.success) {
        const issue = baselineValidation.error.issues[0];
        const path = issue?.path?.length ? issue.path.join(".") : "";
        const detail = issue?.message ?? "Pending artifact content is invalid.";
        throw new Error(
          path
            ? `AI_ARTIFACT_BASELINE_INVALID: Invalid input at ${path}: ${detail}`
            : `AI_ARTIFACT_BASELINE_INVALID: ${detail}`,
        );
      }
      const baseline: ArtifactLiveValue = {
        title: session.artifact.title,
        ...(session.artifact.summary
          ? { summary: session.artifact.summary }
          : {}),
        tags: session.artifact.tags,
        content: baselineValidation.data,
      };
      const baselinePlan = planArtifactYjsMutation(document, typeKey, baseline);
      await synchronizeMutation({
        document,
        provider,
        session,
        runId: params.runId,
        executionId: params.executionId,
        operationId: params.operationId,
        plan: baselinePlan,
        getConnectionError: () => connectionError,
        signal: params.signal,
        onConflict: params.onConflict,
        baseSnapshot: snapshotArtifactRegions(
          typeKey,
          baseline,
          baselinePlan.regions.map((region) => region.regionId),
        ),
        proposedSnapshot: snapshotArtifactRegions(
          typeKey,
          baseline,
          baselinePlan.regions.map((region) => region.regionId),
        ),
      });
      current = readArtifactYjsDocument(document, typeKey);
    }
    if (!current)
      throw new Error(
        "AI_ARTIFACT_INITIALIZATION_FAILED: The live artifact model is unavailable.",
      );

    const desired = params.resolveDesired(current);
    const desiredContent = normalizeArtifactContent(typeKey, desired.content);
    const validated = validateArtifactContent(typeKey, desiredContent);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      const path = issue?.path?.length ? issue.path.join(".") : "";
      const detail = issue?.message ?? "The edited artifact is invalid.";
      throw new Error(
        path
          ? `AI_ARTIFACT_SCHEMA_INVALID: Invalid input at ${path}: ${detail}`
          : `AI_ARTIFACT_SCHEMA_INVALID: ${detail}`,
      );
    }
    const normalizedDesired: ArtifactLiveValue = {
      title: desired.title.trim() || "Untitled artifact",
      ...(desired.summary?.trim() ? { summary: desired.summary.trim() } : {}),
      tags: [
        ...new Set(desired.tags.map((tag) => tag.trim()).filter(Boolean)),
      ].slice(0, 80),
      content: validated.data,
    };
    const initialPlan = planArtifactYjsMutation(
      document,
      typeKey,
      normalizedDesired,
    );
    if (initialPlan.regions.length === 0)
      return {
        artifactId: params.artifactId,
        changedRegionIds: [] as string[],
      };

    if (params.checkpointBeforeAi !== false) {
      await convexMutation<
        { artifactId: string; runId: string; executionId: string },
        unknown
      >("changeGroups:checkpointBeforeAi", {
        artifactId: params.artifactId,
        runId: params.runId,
        executionId: params.executionId,
      });
    }
    await convexMutation("spectraArtifacts:markAiState", {
      artifactId: params.artifactId,
      runId: params.runId,
      executionId: params.executionId,
      state: "updating",
    }).catch(() => undefined);

    // Claims are acquired inside synchronizeMutation. Re-resolve once against
    // the synchronized Y.Doc so a just-finished non-overlapping human edit is
    // preserved by field-level patch operations rather than overwritten from
    // an earlier database projection.
    const refreshed = readArtifactYjsDocument(document, typeKey);
    if (!refreshed) throw new Error("AI_ARTIFACT_LIVE_STATE_LOST");
    const refreshedDesired = params.resolveDesired(refreshed);
    const refreshedContent = normalizeArtifactContent(
      typeKey,
      refreshedDesired.content,
    );
    const refreshedValidation = validateArtifactContent(
      typeKey,
      refreshedContent,
    );
    if (!refreshedValidation.success) {
      const issue = refreshedValidation.error.issues[0];
      const path = issue?.path?.length ? issue.path.join(".") : "";
      const detail = issue?.message ?? "The edited artifact is invalid.";
      throw new Error(
        path
          ? `AI_ARTIFACT_SCHEMA_INVALID: Invalid input at ${path}: ${detail}`
          : `AI_ARTIFACT_SCHEMA_INVALID: ${detail}`,
      );
    }
    const refreshedValue: ArtifactLiveValue = {
      title: refreshedDesired.title.trim() || "Untitled artifact",
      ...(refreshedDesired.summary?.trim()
        ? { summary: refreshedDesired.summary.trim() }
        : {}),
      tags: [
        ...new Set(
          refreshedDesired.tags.map((tag) => tag.trim()).filter(Boolean),
        ),
      ].slice(0, 80),
      content: refreshedValidation.data,
    };
    const refreshedPlan = planArtifactYjsMutation(
      document,
      typeKey,
      refreshedValue,
    );
    const changedRegionIds = refreshedPlan.regions.map(
      (region) => region.regionId,
    );
    const streamBeats = buildArtifactLivePreviewBeats(
      refreshed,
      refreshedValue,
    );
    const result = await synchronizeMutation({
      document,
      provider,
      session,
      runId: params.runId,
      executionId: params.executionId,
      operationId: params.operationId,
      plan: refreshedPlan,
      streamBase: refreshed,
      streamBeats,
      getConnectionError: () => connectionError,
      signal: params.signal,
      onConflict: params.onConflict,
      baseSnapshot: snapshotArtifactRegions(
        typeKey,
        refreshed,
        changedRegionIds,
      ),
      proposedSnapshot: snapshotArtifactRegions(
        typeKey,
        refreshedValue,
        changedRegionIds,
      ),
    });
    return { artifactId: params.artifactId, ...result };
  } finally {
    const lastPresence = provider.awareness?.getLocalState()?.user;
    if (lastPresence && typeof lastPresence === "object") {
      const idle = { ...(lastPresence as Record<string, unknown>) };
      delete idle.previewPatches;
      delete idle.previewSequence;
      delete idle.previewPhase;
      delete idle.previewGesture;
      delete idle.activeRegionId;
      delete idle.activeRegionIds;
      delete idle.selection;
      delete idle.interaction;
      delete idle.menu;
      delete idle.cursor;
      provider.setAwarenessField("user", idle);
    }
    provider.destroy();
    document.destroy();
  }
}
