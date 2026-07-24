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
  ARTIFACT_TYPE_KEYS,
  type ArtifactTypeKey,
} from "@/features/spectra/artifacts/types";
import { validateArtifactContent } from "@/features/spectra/artifacts/registry";

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
    super(`AI_ARTIFACT_REGION_QUEUED: ${claim.conflict?.regionId ?? "occupied region"}`);
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
  return createHash("sha256").update(Y.encodeStateVector(document)).digest("base64url");
}

async function createCollaborationSession(
  artifactId: string,
  clientId: string,
): Promise<CollaborationSession> {
  const [actor, artifact] = await Promise.all([
    convexQuery<Record<string, never>, ActorIdentity | null>("identity:me", {}),
    convexQuery<{ artifactId: string }, ArtifactRecord>("spectraArtifacts:get", { artifactId }),
  ]);
  if (!actor) throw new Error("AUTH_NOT_SIGNED_IN: The AI worker no longer has an authenticated owner.");
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
  if (!access.allowed || access.level !== "modify") {
    throw new Error("AI_ARTIFACT_PERMISSION_REVOKED: Modify access was removed before the operation committed.");
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
    displayName: "Spectra",
    level: "modify",
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

async function releaseClaims(claims: RegionClaim[], clientId: string, resolution: "apply" | "cancel") {
  for (const claim of [...claims].reverse()) {
    await convexMutation<
      { claimId: string; clientId: string; resolution: "apply" | "cancel" },
      unknown
    >("regionClaims:release", { claimId: claim.claimId, clientId, resolution }).catch(() => undefined);
  }
}

function abortError(signal?: AbortSignal) {
  if (!signal?.aborted) return null;
  return signal.reason instanceof Error ? signal.reason : new DOMException("The AI run was stopped.", "AbortError");
}

async function acquirePlanClaims(params: {
  artifactId: string;
  clientId: string;
  runId: string;
  operationId: string;
  baseStateVectorHash: string;
  plan: ArtifactYjsMutationPlan;
  signal?: AbortSignal;
  onConflict?: (conflict: { regionId: string; queuePosition: number; actorKind: "human" | "ai" }) => void | Promise<void>;
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
  operationId: string;
  plan: ArtifactYjsMutationPlan;
  getConnectionError: () => Error | null;
  signal?: AbortSignal;
  onConflict?: (conflict: { regionId: string; queuePosition: number; actorKind: "human" | "ai" }) => void | Promise<void>;
  baseSnapshot?: ArtifactRegionSnapshot;
  proposedSnapshot?: ArtifactRegionSnapshot;
}) {
  if (params.plan.regions.length === 0) return { changedRegionIds: [] as string[] };
  const presence = params.provider.awareness?.getLocalState()?.user;
  const presenceRecord = presence && typeof presence === "object" ? presence as Record<string, unknown> : {};
  params.provider.setAwarenessField("user", {
    ...presenceRecord,
    activeRegionId: params.plan.regions[0]?.regionId,
    activeRegionIds: params.plan.regions.map((region) => region.regionId),
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
  let renewing = true;
  const renewal = setInterval(() => {
    if (!renewing) return;
    for (const claim of claims) {
      void convexMutation<{ claimId: string; clientId: string; baseStateVectorHash: string }, unknown>(
        "regionClaims:renew",
        { claimId: claim.claimId, clientId: params.session.clientId, baseStateVectorHash: stateVectorHash(params.document) },
      ).catch(() => undefined);
    }
  }, 12_000);
  try {
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
    return { changedRegionIds: params.plan.regions.map((region) => region.regionId) };
  } catch (error) {
    await releaseClaims(claims, params.session.clientId, "cancel");
    throw error;
  } finally {
    renewing = false;
    clearInterval(renewal);
    const settledPresence = params.provider.awareness?.getLocalState()?.user;
    const settledRecord = settledPresence && typeof settledPresence === "object" ? settledPresence as Record<string, unknown> : {};
    const idlePresence = { ...settledRecord };
    delete idlePresence.activeRegionId;
    delete idlePresence.activeRegionIds;
    params.provider.setAwarenessField("user", idlePresence);
  }
}

export async function applyAiArtifactMutation(params: {
  artifactId: string;
  runId: string;
  operationId: string;
  executionId: string;
  resolveDesired: (current: ArtifactLiveValue) => ArtifactLiveValue;
  signal?: AbortSignal;
  onConflict?: (conflict: { regionId: string; queuePosition: number; actorKind: "human" | "ai" }) => void | Promise<void>;
  collaborationClientId?: string;
  checkpointBeforeAi?: boolean;
}) {
  const clientId = params.collaborationClientId?.trim().slice(0, 180) || `ai:${params.runId}:${params.operationId}:${randomUUID()}`.slice(0, 180);
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
      connectionError = new Error(`AI_ARTIFACT_PERMISSION_REVOKED: ${reason || "Collaboration access was rejected."}`);
    },
    onDisconnect: ({ event }) => {
      if (event.code === 4403) {
        connectionError = new Error(`AI_ARTIFACT_PERMISSION_REVOKED: ${event.reason || "Access was removed."}`);
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
      () => connectionError,
      20_000,
      () =>
        `AI_ARTIFACT_CONNECT_TIMEOUT: The live artifact could not be synchronized (status=${connectionStatus}, opened=${opened}, authenticated=${authenticated || provider.isAuthenticated}, syncEvent=${syncEventReceived}, synced=${provider.synced}).`,
    );
    provider.setAwarenessField("user", {
      clientId,
      accountId: session.actor.accountId,
      name: "Spectra",
      actorKind: "ai",
      runId: params.runId,
      operationId: params.operationId,
    });

    let current = readArtifactYjsDocument(document, typeKey);
    if (!current) {
      const baseline: ArtifactLiveValue = {
        title: session.artifact.title,
        ...(session.artifact.summary ? { summary: session.artifact.summary } : {}),
        tags: session.artifact.tags,
        content: session.artifact.content,
      };
      const baselinePlan = planArtifactYjsMutation(document, typeKey, baseline);
      await synchronizeMutation({
        document,
        provider,
        session,
        runId: params.runId,
        operationId: params.operationId,
        plan: baselinePlan,
        getConnectionError: () => connectionError,
        signal: params.signal,
        onConflict: params.onConflict,
        baseSnapshot: snapshotArtifactRegions(typeKey, baseline, baselinePlan.regions.map((region) => region.regionId)),
        proposedSnapshot: snapshotArtifactRegions(typeKey, baseline, baselinePlan.regions.map((region) => region.regionId)),
      });
      current = readArtifactYjsDocument(document, typeKey);
    }
    if (!current) throw new Error("AI_ARTIFACT_INITIALIZATION_FAILED: The live artifact model is unavailable.");

    const desired = params.resolveDesired(current);
    const validated = validateArtifactContent(typeKey, desired.content);
    if (!validated.success) {
      throw new Error(`AI_ARTIFACT_SCHEMA_INVALID: ${validated.error.issues[0]?.message ?? "The edited artifact is invalid."}`);
    }
    const normalizedDesired: ArtifactLiveValue = {
      title: desired.title.trim() || "Untitled artifact",
      ...(desired.summary?.trim() ? { summary: desired.summary.trim() } : {}),
      tags: [...new Set(desired.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 80),
      content: validated.data,
    };
    const initialPlan = planArtifactYjsMutation(document, typeKey, normalizedDesired);
    if (initialPlan.regions.length === 0) return { artifactId: params.artifactId, changedRegionIds: [] as string[] };

    if (params.checkpointBeforeAi !== false) {
      await convexMutation<{ artifactId: string; runId: string; executionId: string }, unknown>(
        "changeGroups:checkpointBeforeAi",
        { artifactId: params.artifactId, runId: params.runId, executionId: params.executionId },
      );
    }

    // Claims are acquired inside synchronizeMutation. Re-resolve once against
    // the synchronized Y.Doc so a just-finished non-overlapping human edit is
    // preserved by field-level patch operations rather than overwritten from
    // an earlier database projection.
    const refreshed = readArtifactYjsDocument(document, typeKey);
    if (!refreshed) throw new Error("AI_ARTIFACT_LIVE_STATE_LOST");
    const refreshedDesired = params.resolveDesired(refreshed);
    const refreshedValidation = validateArtifactContent(typeKey, refreshedDesired.content);
    if (!refreshedValidation.success) throw new Error(`AI_ARTIFACT_SCHEMA_INVALID: ${refreshedValidation.error.issues[0]?.message ?? "The edited artifact is invalid."}`);
    const refreshedValue: ArtifactLiveValue = {
      title: refreshedDesired.title.trim() || "Untitled artifact",
      ...(refreshedDesired.summary?.trim() ? { summary: refreshedDesired.summary.trim() } : {}),
      tags: [...new Set(refreshedDesired.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 80),
      content: refreshedValidation.data,
    };
    const refreshedPlan = planArtifactYjsMutation(document, typeKey, refreshedValue);
    const changedRegionIds = refreshedPlan.regions.map((region) => region.regionId);
    const result = await synchronizeMutation({
      document,
      provider,
      session,
      runId: params.runId,
      operationId: params.operationId,
      plan: refreshedPlan,
      getConnectionError: () => connectionError,
      signal: params.signal,
      onConflict: params.onConflict,
      baseSnapshot: snapshotArtifactRegions(typeKey, refreshed, changedRegionIds),
      proposedSnapshot: snapshotArtifactRegions(typeKey, refreshedValue, changedRegionIds),
    });
    return { artifactId: params.artifactId, ...result };
  } finally {
    provider.destroy();
    document.destroy();
  }
}
