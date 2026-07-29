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
import type {
  ActorIdentity as FabricActor,
  InteractionAct,
} from "@/features/spectra/collaboration/interaction-model";

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

/**
 * A live-preview beat already describes the native gesture being performed.
 * Preserve that choreography instead of re-deriving every frame solely from
 * its value delta: menu-opening and pointer beats intentionally carry the
 * unchanged value, while the eventual menu selection carries the mutation.
 */
function actForStreamBeat(input: {
  beat: AiStreamBeat;
  previousBeat?: AiStreamBeat;
  before: unknown;
  after: unknown;
}): InteractionAct | undefined {
  const { beat, previousBeat, before, after } = input;
  if (beat.menu?.open) {
    if (!previousBeat?.menu?.open) return { kind: "menuOpen" };
    // The committed menu beat both moves the highlight and changes the native
    // value. Treat the value transition as the selection; otherwise the actor
    // appears to navigate and then silently changes the control before close.
    if (!Object.is(before, after))
      return {
        kind: "menuSelect",
        option: beat.menu.highlighted ?? String(after ?? ""),
      };
    if (previousBeat.menu.highlighted !== beat.menu.highlighted)
      return {
        kind: "menuNavigate",
        option: beat.menu.highlighted ?? "",
      };
    return { kind: "menuOpen" };
  }
  if (beat.menu === null && previousBeat?.menu?.open)
    return { kind: "menuClose" };

  switch (beat.interaction?.kind) {
    case "pointer":
      return { kind: "hover" };
    case "focus":
      return { kind: "focus" };
    case "toggle":
      return !Object.is(before, after)
        ? { kind: "toggle", value: Boolean(after) }
        : { kind: "press" };
    case "dragging":
      return beat.gesturePhase === "release"
        ? { kind: "dragRelease" }
        : beat.gesturePhase === "move"
          ? { kind: "dragMove" }
          : { kind: "dragStart" };
    case "resizing":
      return beat.gesturePhase === "release"
        ? { kind: "resizeRelease" }
        : beat.gesturePhase === "move"
          ? { kind: "resizeMove" }
          : { kind: "resizeStart" };
    default:
      return undefined;
  }
}

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
    // The gateway appends owner attribution for AI awareness. Keep the token's
    // authenticated display name as the owner so it never becomes
    // "Pablo's AI's AI" after sanitization.
    displayName: actor.name.trim() || "Spectra",
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

function humanHeldRegions(provider: HocuspocusProvider): Set<string> {
  const held = new Set<string>();
  for (const state of provider.awareness?.getStates().values() ?? []) {
    const user =
      state?.user && typeof state.user === "object"
        ? (state.user as Record<string, unknown>)
        : null;
    const interaction =
      user?.interactionState &&
      typeof user.interactionState === "object" &&
      !Array.isArray(user.interactionState)
        ? (user.interactionState as Record<string, unknown>)
        : null;
    const actor =
      interaction?.actor &&
      typeof interaction.actor === "object" &&
      !Array.isArray(interaction.actor)
        ? (interaction.actor as Record<string, unknown>)
        : null;
    const act =
      interaction?.act &&
      typeof interaction.act === "object" &&
      !Array.isArray(interaction.act)
        ? (interaction.act as Record<string, unknown>)
        : null;
    const lifecycle = interaction?.lifecycle;
    if (
      actor?.kind !== "human" ||
      act?.kind === "idle" ||
      act?.kind === "hover" ||
      lifecycle === "idle" ||
      lifecycle === "completed" ||
      lifecycle === "settled" ||
      lifecycle === "failed" ||
      lifecycle === "cancelled"
    )
      continue;
    for (const regionId of Array.isArray(interaction?.heldRegionIds)
      ? interaction.heldRegionIds
      : []) {
      if (typeof regionId === "string" && regionId) held.add(regionId);
    }
  }
  return held;
}

async function waitForHumanRegions(params: {
  provider: HocuspocusProvider;
  plan: ArtifactYjsMutationPlan;
  signal?: AbortSignal;
  onConflict?: (conflict: {
    regionId: string;
    queuePosition: number;
    actorKind: "human" | "ai";
  }) => void | Promise<void>;
  onConflictResolved?: () => void | Promise<void>;
}) {
  const requested = new Set(
    params.plan.regions.map((region) => region.regionId),
  );
  const firstHeld = () =>
    [...humanHeldRegions(params.provider)].find((regionId) =>
      requested.has(regionId),
    );
  let occupied = firstHeld();
  if (!occupied) return;
  await params.onConflict?.({
    regionId: occupied,
    queuePosition: 1,
    actorKind: "human",
  });
  let freeSince = 0;
  while (occupied || !freeSince || Date.now() - freeSince < 1_200) {
    const aborted = abortError(params.signal);
    if (aborted) throw aborted;
    // A human edit is not an AI failure. Keep the same operation queued for
    // as long as the run remains alive; the worker heartbeat and abort signal
    // already provide the correct lifecycle boundaries. The old 75s deadline
    // turned an entirely healthy collaboration session into a raw red error
    // while the person was still using the control.
    await new Promise<void>((resolve) => setTimeout(resolve, 90));
    occupied = firstHeld();
    if (occupied) freeSince = 0;
    else if (!freeSince) freeSince = Date.now();
  }
  await params.onConflictResolved?.();
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
  onConflictResolved?: () => void | Promise<void>;
  baseSnapshot?: ArtifactRegionSnapshot;
  proposedSnapshot?: ArtifactRegionSnapshot;
  /**
   * Re-read the live model after a human-held target becomes free. A queued
   * operation may have waited through several collaborator transactions; its
   * visible performance and conflict snapshots must start from that new truth,
   * not from the value that existed when the model response first arrived.
   */
  rebaseAfterHumanWait?: () => {
    plan: ArtifactYjsMutationPlan;
    streamBase: ArtifactLiveValue;
    streamBeats: readonly AiStreamBeat[];
    baseSnapshot: ArtifactRegionSnapshot;
    proposedSnapshot: ArtifactRegionSnapshot;
  };
}) {
  let plan = params.plan;
  let streamBase = params.streamBase;
  let streamBeats = params.streamBeats;
  let baseSnapshot = params.baseSnapshot;
  let proposedSnapshot = params.proposedSnapshot;
  if (plan.regions.length === 0)
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
  const fabricTypeKey = requireArtifactType(
    params.session.artifact.blueprintKey,
  );
  const startingRegionId = plan.regions[0]?.regionId;
  params.provider.setAwarenessField("user", {
    ...presenceRecord,
    ...(startingRegionId
      ? {
          activeRegionId: startingRegionId,
          activeRegionIds: [startingRegionId],
        }
      : {}),
  });
  // Provisional human work is already real collaboration state even though it
  // has not produced a Yjs transaction yet. Respect that exact semantic region
  // before acquiring durable claims, otherwise AI can commit underneath a
  // collaborator's local draft and later announce a result their blur erases.
  await waitForHumanRegions({
    provider: params.provider,
    plan,
    signal: params.signal,
    onConflict: params.onConflict,
    onConflictResolved: params.onConflictResolved,
  });
  const rebased = params.rebaseAfterHumanWait?.();
  if (rebased) {
    plan = rebased.plan;
    streamBase = rebased.streamBase;
    streamBeats = rebased.streamBeats;
    baseSnapshot = rebased.baseSnapshot;
    proposedSnapshot = rebased.proposedSnapshot;
  }
  if (plan.regions.length === 0) {
    return { changedRegionIds: [] as string[] };
  }
  const claims = await acquirePlanClaims({
    artifactId: params.session.artifact._id,
    clientId: params.session.clientId,
    runId: params.runId,
    operationId: params.operationId,
    baseStateVectorHash: stateVectorHash(params.document),
    plan,
    signal: params.signal,
    onConflict: params.onConflict,
    baseSnapshot,
    proposedSnapshot,
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
      streamBeats && streamBeats.length > 0
        ? [...streamBeats]
        : (params.streamValues ?? []).map((value) => ({
            delayMs: 560,
            value,
            previewGesture: "typing" as const,
            cursorMode: "typing" as const,
          }));
    let previousStream = streamBase;
    for (const [sequence, beat] of beats.entries()) {
      settleSequence = sequence + 1;
      const aborted = abortError(params.signal);
      if (aborted) throw aborted;
      if (!streamBase) continue;
      const streamValue = beat.value;
      // Cumulative from the pre-edit baseline so peers can reconstruct the full
      // speculative document. Focus/highlight use the delta against the prior
      // frame so only the live edit lights up.
      const previewPatches = artifactLivePreviewPatches(
        streamBase,
        streamValue,
      );
      const priorStream = previousStream ?? streamBase;
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
      let blockId = blockMatch ? decodeURIComponent(blockMatch[1]!) : undefined;
      if (blockId && /^\d+$/.test(blockId)) {
        const blocks = (
          streamValue.content as
            { blocks?: Array<{ id?: unknown }> } | undefined
        )?.blocks;
        const indexed = Array.isArray(blocks)
          ? blocks[Number(blockId)]
          : undefined;
        blockId =
          indexed && typeof indexed.id === "string" ? indexed.id : undefined;
      }
      const matchedRegion =
        (blockId
          ? plan.regions.find(
              (region) =>
                region.regionId === blockId ||
                region.regionId.endsWith(`:${blockId}`) ||
                region.regionId.includes(blockId),
            )
          : undefined) ??
        plan.regions.find((region) =>
          focusPath.includes(region.regionId.replace(/^.*:/, "")),
        ) ??
        plan.regions[0];
      const activeRegionId = matchedRegion?.regionId;
      // Gesture-only beats deliberately have no diff patch. They still point
      // at a real current value; treating that as `undefined` makes an
      // unchanged dropdown look like a newly created control.
      const focusValue =
        focusPatch !== undefined
          ? focusPatch.value
          : valueAtPath(streamValue, focusPath);
      const finalAtPath = valueAtPath(
        beats[beats.length - 1]?.value ?? streamValue,
        focusPath,
      );
      const beforeAtPath = valueAtPath(streamBase, focusPath);
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
      const contentRelativeFramePath = focusPath.startsWith("/content/")
        ? focusPath.slice("/content".length)
        : focusPath;
      // Document mutations are diffed by array index, but the rendered editor
      // exposes stable block ids. Presence geometry must use the stable
      // identity while speculation keeps its index-based JSON pointer. If the
      // actor publishes `/blocks/1/text`, the patch can stream correctly yet
      // the cursor has no DOM target — producing the exact split-brain
      // experience where blue ink appears without a body or caret.
      const framePath =
        blockId && blockMatch
          ? contentRelativeFramePath.replace(
              /^\/blocks\/(?:id:)?[^/]+/i,
              `/blocks/id:${encodeURIComponent(blockId)}`,
            )
          : contentRelativeFramePath;
      lastFramePath = framePath;
      const beatAct = actForStreamBeat({
        beat,
        previousBeat: beats[sequence - 1],
        before: valueAtPath(priorStream, focusPath),
        after: focusValue,
      });
      const interactionState = aiInteractionFrame({
        artifactId: params.session.artifact._id,
        typeKey: fabricTypeKey,
        actor: fabricActor,
        path: framePath,
        ...(activeRegionId ? { regionId: activeRegionId } : {}),
        before: valueAtPath(priorStream, focusPath),
        after: focusValue,
        ...(beatAct ? { act: beatAct } : {}),
        ...(beat.focusPart ? { part: beat.focusPart } : {}),
        ...(selectingLine ? { selectionEnd } : {}),
        ...(beat.menu === null
          ? { menu: null }
          : beat.menu?.open && beat.menu.label
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
          // Keep the durable preview ledger ordered with the awareness body.
          // Fire-and-forget writes could arrive after a later frame (or even
          // after settle), making the thread announce "updating" once the
          // visible gesture had already completed.
          await convexMutation("spectraArtifacts:stageAiPatch", {
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
    params.document.transact(plan.apply, {
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
          ...(plan.regions[0]?.regionId
            ? { regionId: plan.regions[0].regionId }
            : {}),
          before: undefined,
          after: undefined,
          sequence: settleSequence,
        }),
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 420));
    }
    return {
      changedRegionIds: plan.regions.map((region) => region.regionId),
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
  onConflictResolved?: () => void | Promise<void>;
  collaborationClientId?: string;
  checkpointBeforeAi?: boolean;
}) {
  // The browser client id identifies the owner/viewer, not the AI body. Reusing
  // it for the worker makes every observer with that id discard the AI cursor
  // as its own local presence. This is especially easy to trigger on queued
  // continuation, where the human id is deliberately carried into the resume
  // request. Keep attribution in `ownerAccountId`, but give every operation a
  // distinct collaboration transport identity.
  const ownerClientHint = params.collaborationClientId?.trim()
    ? `:${params.collaborationClientId.trim().slice(0, 36)}`
    : "";
  const clientId =
    `ai:${params.runId}:${params.operationId}${ownerClientHint}:${randomUUID()}`.slice(
      0,
      180,
    );
  const session = await createCollaborationSession(params.artifactId, clientId);
  const typeKey = requireArtifactType(session.artifact.blueprintKey);
  const document = new Y.Doc();
  let connectionError: Error | null = null;
  let connectionStatus = "initializing";
  let opened = false;
  let authenticated = false;
  let syncEventReceived = false;

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
        onConflictResolved: params.onConflictResolved,
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

    const resolveValidatedValue = (
      base: ArtifactLiveValue,
    ): ArtifactLiveValue => {
      const desired = params.resolveDesired(base);
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
      return {
        title: desired.title.trim() || "Untitled artifact",
        ...(desired.summary?.trim() ? { summary: desired.summary.trim() } : {}),
        tags: [
          ...new Set(desired.tags.map((tag) => tag.trim()).filter(Boolean)),
        ].slice(0, 80),
        content: validated.data,
      };
    };
    const normalizedDesired = resolveValidatedValue(current);
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
    const refreshedValue = resolveValidatedValue(refreshed);
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
      onConflictResolved: params.onConflictResolved,
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
      rebaseAfterHumanWait: () => {
        const liveBase = readArtifactYjsDocument(document, typeKey);
        if (!liveBase) throw new Error("AI_ARTIFACT_LIVE_STATE_LOST");
        const liveDesired = resolveValidatedValue(liveBase);
        const livePlan = planArtifactYjsMutation(
          document,
          typeKey,
          liveDesired,
        );
        const liveRegionIds = livePlan.regions.map(
          (region) => region.regionId,
        );
        return {
          plan: livePlan,
          streamBase: liveBase,
          streamBeats: buildArtifactLivePreviewBeats(liveBase, liveDesired),
          baseSnapshot: snapshotArtifactRegions(
            typeKey,
            liveBase,
            liveRegionIds,
          ),
          proposedSnapshot: snapshotArtifactRegions(
            typeKey,
            liveDesired,
            liveRegionIds,
          ),
        };
      },
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
