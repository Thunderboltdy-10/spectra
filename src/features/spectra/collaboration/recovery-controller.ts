"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import type { ArtifactTypeKey } from "../artifacts/types";
import type { ArtifactLiveValue } from "./artifact-yjs-model";
import type {
  ArtifactCollaborationTransport,
  CollaborationSyncState,
  DurableRoomAnchor,
  RecoveryCurrent,
} from "./types";
import type {
  BoundedYjsLocalPersistence,
  LocalDurabilitySnapshot,
  LocalYjsMeta,
  LocalYjsRecord,
} from "../realtime/persistence";
import { localRecordGeneration } from "../realtime/persistence";
import { readNativeArtifactYjsDocument } from "../work/models/yjs/native-artifact-model";
import { workYjsAdapter } from "../work/models/yjs/registry";
import { readableRegionText } from "./region-text";

export type RecoveryBranch = {
  id: string;
  createdAt: number;
  bytes: number;
  generation: string;
  reason: "native_overlap" | "unknown_ancestor" | "retained";
  regionIds: string[];
  canReadCurrent: boolean;
  canReapply: boolean;
  currentAnchor?: DurableRoomAnchor;
};

export type LocalRecoveryState = {
  state: "loading" | "review_required" | "ready" | "saving" | "error";
  branches: RecoveryBranch[];
  activeBranchId?: string;
  /** Changes only after an explicit archived adoption, never on Retry. */
  adoptionId?: string;
  error?: string;
};

export type LocalRecoveryInspection = {
  branch: RecoveryBranch;
  previews: Array<{ regionId: string; label: string; draft: string; current?: string }>;
};

export type LocalRecoveryAction = {
  branchId: string;
  expectedGeneration: string;
  expectedCurrentAnchor: DurableRoomAnchor;
  signal?: AbortSignal;
};

/** Existing conflict/notice UI consumes this controller. Source authority is
 * rechecked by actions; displayed capabilities are not an authorization grant.
 * Inspect/export operate on retained local bytes and do not clear pending work.
 * Stale witnesses fail with LOCAL_RECOVERY_GENERATION_CHANGED or
 * LOCAL_RECOVERY_CURRENT_CHANGED, never an automatic retry with a new witness.
 */
export type LocalRecoveryController = {
  recovery: LocalRecoveryState;
  inspectLocalRecovery: (branchId: string, options?: { signal?: AbortSignal }) => Promise<LocalRecoveryInspection>;
  exportLocalRecovery: (branchId: string, options?: { signal?: AbortSignal }) => Promise<{ fileName: string; blob: Blob }>;
  /** Archives the exact old branch before adopting a fresh authorized current
   * baseline. Resolves after the replacement live model is ready. UI must not
   * separately write content/baseline into React or Yjs. A closed view after
   * local commit cannot discard the retained branch or roll that commit back.
   */
  archiveAndAdoptCurrent: (action: LocalRecoveryAction) => Promise<{ archivedBranchId: string; adoptionId: string }>;
  /** Applies explicitly selected semantic regions through the normal edit and
   * current-source checks. The original recovery branch remains inspectable.
   */
  reapplyLocalRecovery: (action: LocalRecoveryAction & { regionIds: string[] }) => Promise<void>;
  /** Permanently removes one retained (archived) draft from this device. The
   * active draft cannot be discarded; adopt the current version first. */
  discardLocalRecovery: (action: { branchId: string; expectedGeneration: string; signal?: AbortSignal }) => Promise<void>;
};

const EXCERPT_CHARS = 1_200;
const STRUCTURE_REGION = "artifact:structure";
const REOPEN_TIMEOUT_MS = 15_000;

function sameAnchor(left: DurableRoomAnchor | undefined, right: DurableRoomAnchor | undefined) {
  return Boolean(left && right && left.roomId === right.roomId &&
    left.nextSequence === right.nextSequence && left.frontierHash === right.frontierHash);
}

function excerpt(value: unknown) {
  return readableRegionText(value, { limit: EXCERPT_CHARS });
}

function valueAtPath(value: unknown, path: readonly (string | number)[]) {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

/** Decodes retained local bytes into an isolated Y.Doc; never the live one. */
export function recoveryRecordDocument(record: LocalYjsRecord) {
  const document = new Y.Doc();
  Y.applyUpdate(document, record.baseUpdate ? Y.mergeUpdates([record.baseUpdate, record.update]) : record.update);
  return document;
}

type ProjectedDocument = { document: Y.Doc; value: ArtifactLiveValue | null };

function project(document: Y.Doc, typeKey: ArtifactTypeKey): ProjectedDocument {
  try { return { document, value: readNativeArtifactYjsDocument(document, typeKey) }; }
  catch { return { document, value: null }; }
}

function regionPreview(projected: ProjectedDocument, typeKey: ArtifactTypeKey, regionId: string) {
  const value = projected.value;
  if (!value) return { label: undefined, text: undefined };
  if (regionId === "metadata:title") return { label: "Title", text: value.title };
  if (regionId === "metadata:summary") return { label: "Summary", text: value.summary ?? "" };
  if (regionId === "metadata:tags") return { label: "Tags", text: value.tags.join(", ") };
  if (regionId === STRUCTURE_REGION) return { label: "Whole work", text: excerpt([value.title, value.content]) };
  const region = workYjsAdapter(typeKey).deriveSemanticRegions(projected.document, value.content as never)
    .find(candidate => candidate.regionId === regionId);
  if (!region) return { label: undefined, text: undefined };
  return { label: region.label, text: region.readableText?.slice(0, EXCERPT_CHARS) ?? excerpt(valueAtPath(value.content, region.path)) };
}

export function localRecoveryPreviews(args: { typeKey: ArtifactTypeKey; regionIds: string[];
  draft: ProjectedDocument; current?: ProjectedDocument }): LocalRecoveryInspection["previews"] {
  return args.regionIds.slice(0, 64).map(regionId => {
    const draft = regionPreview(args.draft, args.typeKey, regionId);
    const current = args.current ? regionPreview(args.current, args.typeKey, regionId) : undefined;
    return { regionId, label: draft.label ?? current?.label ?? "Changed part", draft: draft.text ?? "",
      ...(current ? { current: current.text } : {}) };
  });
}

function branchFromMeta(meta: Pick<LocalYjsMeta, "key" | "bytes" | "lastOpenedAt" | "updatedAt" | "recoveryConflict" |
  "recoveryAnchor" | "authoredRegionIds" | "generation">, access: { canReadCurrent: boolean; canReapply: boolean },
  currentAnchor?: DurableRoomAnchor): RecoveryBranch {
  const regionIds = meta.authoredRegionIds?.length ? [...meta.authoredRegionIds] : [STRUCTURE_REGION];
  return {
    id: meta.key,
    createdAt: meta.updatedAt ?? meta.lastOpenedAt,
    bytes: meta.bytes,
    generation: meta.generation ?? localRecordGeneration({ updatedAt: meta.updatedAt ?? meta.lastOpenedAt, bytes: meta.bytes }),
    reason: meta.recoveryConflict ? "native_overlap" : meta.recoveryAnchor ? "retained" : "unknown_ancestor",
    regionIds,
    ...access,
    ...(currentAnchor ? { currentAnchor } : {}),
  };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("LOCAL_RECOVERY_ABORTED");
}

type ReopenWaiter = { from: ArtifactCollaborationTransport | null; resolve: () => void; reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> };

/**
 * The single retained-draft recovery controller. It reads only retained local
 * bytes and an exact current room read; adoption and reapply go through the
 * local store's generation CAS and the normal region-edit path respectively.
 */
export function useLocalRecoveryController(args: {
  typeKey: ArtifactTypeKey | null;
  transport: ArtifactCollaborationTransport | null;
  persistence: BoundedYjsLocalPersistence | null;
  durability: LocalDurabilitySnapshot;
  level: "read" | "modify" | null;
  syncState: CollaborationSyncState;
  /** True once the live model for the current transport is initialized. */
  sessionReady: boolean;
  /** Rebuilds the live session from the (just adopted) local head. */
  reopen: () => void;
  /** Applies selected regions of a draft value through the live model. */
  restoreRegions: (value: ArtifactLiveValue, regionIds: readonly string[]) => Promise<unknown>;
}): LocalRecoveryController {
  const { typeKey, transport, persistence, durability, level, syncState, sessionReady, reopen, restoreRegions } = args;
  const [archived, setArchived] = useState<LocalYjsMeta[] | null>(null);
  const [listError, setListError] = useState<string>();
  const [currentAnchor, setCurrentAnchor] = useState<DurableRoomAnchor>();
  const [saving, setSaving] = useState(false);
  const [adoptionId, setAdoptionId] = useState<string>();
  const [listVersion, setListVersion] = useState(0);
  const latest = useRef({ transport, persistence, restoreRegions, sessionReady });
  latest.current = { transport, persistence, restoreRegions, sessionReady };
  const reopenWaiter = useRef<ReopenWaiter | null>(null);
  const busy = useRef(false);

  const redirected = Boolean(durability.branchKey && persistence && durability.branchKey !== persistence.key);
  // A superseded writer saves into its own retained branch; relist on each save.
  const redirectedGeneration = redirected ? durability.generation : null;
  useEffect(() => {
    if (!persistence) { setArchived(null); return; }
    let cancelled = false;
    void persistence.listRecoveryRecords().then(records => {
      if (cancelled) return;
      setArchived(records.filter(record => record.key !== persistence.key));
      setListError(undefined);
    }).catch(error => {
      if (!cancelled) setListError(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
  }, [persistence, listVersion, redirected, redirectedGeneration]);

  useEffect(() => {
    const waiter = reopenWaiter.current;
    if (!waiter || !transport || transport === waiter.from || !sessionReady) return;
    reopenWaiter.current = null;
    clearTimeout(waiter.timer);
    waiter.resolve();
  }, [transport, sessionReady]);
  useEffect(() => () => {
    const waiter = reopenWaiter.current;
    reopenWaiter.current = null;
    if (waiter) { clearTimeout(waiter.timer); waiter.reject(new Error("LOCAL_RECOVERY_VIEW_CLOSED")); }
  }, []);

  const access = useMemo(() => ({
    canReadCurrent: Boolean(level) && syncState !== "permission_lost",
    canReapply: level === "modify" && syncState !== "permission_lost",
  }), [level, syncState]);

  const activePending = Boolean(persistence && durability.pendingRemoteSync && durability.generation &&
    durability.branchKey === persistence.key);
  const recovery = useMemo<LocalRecoveryState>(() => {
    const branches: RecoveryBranch[] = [];
    if (persistence && activePending)
      branches.push(branchFromMeta({ key: persistence.key, bytes: durability.bytes, lastOpenedAt: Date.now(),
        recoveryConflict: durability.recoveryConflict, recoveryAnchor: durability.recoveryAnchor,
        authoredRegionIds: durability.authoredRegionIds, generation: durability.generation }, access, currentAnchor));
    for (const record of archived ?? []) branches.push(branchFromMeta(record, access, currentAnchor));
    const state: LocalRecoveryState["state"] = saving ? "saving"
      : listError ? "error"
      : persistence && archived === null ? "loading"
      : activePending && durability.recoveryConflict ? "review_required" : "ready";
    return { state, branches, ...(activePending && persistence ? { activeBranchId: persistence.key } : {}),
      ...(adoptionId ? { adoptionId } : {}), ...(listError ? { error: listError } : {}) };
  }, [access, activePending, adoptionId, archived, currentAnchor, durability, listError, persistence, saving]);

  const readBranch = useCallback(async (branchId: string, expectedGeneration?: string) => {
    const store = latest.current.persistence;
    if (!store) throw new Error("LOCAL_RECOVERY_UNAVAILABLE");
    const record = await store.readRecoveryRecord(branchId);
    if (branchId === store.key && !record.pendingRemoteSync) throw new Error("LOCAL_RECOVERY_BRANCH_MISSING");
    if (expectedGeneration && localRecordGeneration(record) !== expectedGeneration)
      throw new Error("LOCAL_RECOVERY_GENERATION_CHANGED");
    return record;
  }, []);

  const readCurrent = useCallback(async (signal?: AbortSignal): Promise<RecoveryCurrent> => {
    const current = latest.current.transport;
    if (!current?.readRecoveryCurrent) throw new Error("LOCAL_RECOVERY_CURRENT_UNAVAILABLE");
    const result = await current.readRecoveryCurrent(signal);
    throwIfAborted(signal);
    setCurrentAnchor(previous => sameAnchor(previous, result.anchor) ? previous : result.anchor);
    return result;
  }, []);

  const inspectLocalRecovery = useCallback<LocalRecoveryController["inspectLocalRecovery"]>(async (branchId, options) => {
    if (!typeKey) throw new Error("LOCAL_RECOVERY_UNAVAILABLE");
    const record = await readBranch(branchId);
    throwIfAborted(options?.signal);
    let current: RecoveryCurrent | null = null;
    if (access.canReadCurrent) {
      try { current = await readCurrent(options?.signal); }
      catch (error) { throwIfAborted(options?.signal); if (!/CURRENT_(UNAVAILABLE|CHANGED)/.test(String(error))) throw error; }
    }
    const branch = branchFromMeta({ ...record, generation: localRecordGeneration(record) },
      { canReadCurrent: Boolean(current), canReapply: Boolean(current) && current!.level === "modify" }, current?.anchor);
    const draftDocument = recoveryRecordDocument(record);
    const currentDocument = current ? new Y.Doc() : null;
    try {
      if (current && currentDocument) Y.applyUpdate(currentDocument, current.update);
      return { branch, previews: localRecoveryPreviews({ typeKey, regionIds: branch.regionIds,
        draft: project(draftDocument, typeKey), ...(currentDocument ? { current: project(currentDocument, typeKey) } : {}) }) };
    } finally { draftDocument.destroy(); currentDocument?.destroy(); }
  }, [access.canReadCurrent, readBranch, readCurrent, typeKey]);

  const exportLocalRecovery = useCallback<LocalRecoveryController["exportLocalRecovery"]>(async (branchId, options) => {
    const record = await readBranch(branchId);
    throwIfAborted(options?.signal);
    const document = recoveryRecordDocument(record);
    try {
      const value = typeKey ? project(document, typeKey).value : null;
      const state = Y.encodeStateAsUpdate(document);
      let binary = "";
      for (let offset = 0; offset < state.length; offset += 0x8000)
        binary += String.fromCharCode(...state.subarray(offset, offset + 0x8000));
      const payload = { format: "spectra-local-draft", version: 1, branchId, savedAt: record.updatedAt,
        typeKey, recoveryAnchor: record.recoveryAnchor ?? null, regionIds: record.authoredRegionIds ?? [],
        value, yjsStateBase64: btoa(binary) };
      const name = (value?.title || "Work").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "Work";
      return { fileName: `${name} (local draft).json`,
        blob: new Blob([JSON.stringify(payload)], { type: "application/json" }) };
    } finally { document.destroy(); }
  }, [readBranch, typeKey]);

  const waitForReopen = useCallback((from: ArtifactCollaborationTransport | null) => new Promise<void>((resolve, reject) => {
    const previous = reopenWaiter.current;
    if (previous) { clearTimeout(previous.timer); previous.reject(new Error("LOCAL_RECOVERY_SUPERSEDED")); }
    const timer = setTimeout(() => {
      if (reopenWaiter.current?.timer === timer) reopenWaiter.current = null;
      reject(new Error("LOCAL_RECOVERY_REOPEN_TIMEOUT"));
    }, REOPEN_TIMEOUT_MS);
    reopenWaiter.current = { from, resolve, reject, timer };
  }), []);

  const adopt = useCallback(async (action: LocalRecoveryAction) => {
    const store = latest.current.persistence;
    if (!store) throw new Error("LOCAL_RECOVERY_UNAVAILABLE");
    await readBranch(action.branchId, action.expectedGeneration);
    const current = await readCurrent(action.signal);
    if (!sameAnchor(current.anchor, action.expectedCurrentAnchor)) throw new Error("LOCAL_RECOVERY_CURRENT_CHANGED");
    throwIfAborted(action.signal);
    const from = latest.current.transport;
    const result = await store.archiveAndAdopt({ branchKey: action.branchId, expectedGeneration: action.expectedGeneration,
      update: current.update, anchor: current.anchor, signal: action.signal });
    // Committed locally: from here the adoption completes even if the view
    // closes. Only the replacement session readiness is awaited.
    const ready = waitForReopen(from);
    reopen();
    await ready;
    setAdoptionId(result.adoptionId);
    setListVersion(version => version + 1);
    return result;
  }, [readBranch, readCurrent, reopen, waitForReopen]);

  const exclusive = useCallback(async <T,>(run: () => Promise<T>) => {
    if (busy.current) throw new Error("LOCAL_RECOVERY_BUSY");
    busy.current = true; setSaving(true);
    try { return await run(); }
    finally { busy.current = false; setSaving(false); }
  }, []);

  const archiveAndAdoptCurrent = useCallback<LocalRecoveryController["archiveAndAdoptCurrent"]>(
    action => exclusive(() => adopt(action)), [adopt, exclusive]);

  const reapplyLocalRecovery = useCallback<LocalRecoveryController["reapplyLocalRecovery"]>(action => exclusive(async () => {
    if (!typeKey) throw new Error("LOCAL_RECOVERY_UNAVAILABLE");
    if (!action.regionIds.length) return;
    const store = latest.current.persistence;
    if (!store) throw new Error("LOCAL_RECOVERY_UNAVAILABLE");
    const record = await readBranch(action.branchId, action.expectedGeneration);
    const draftDocument = recoveryRecordDocument(record);
    let value: ArtifactLiveValue | null;
    try { value = project(draftDocument, typeKey).value; } finally { draftDocument.destroy(); }
    if (!value) throw new Error("LOCAL_RECOVERY_DRAFT_UNREADABLE");
    const authored = new Set(record.authoredRegionIds?.length ? record.authoredRegionIds : [STRUCTURE_REGION]);
    if (action.regionIds.some(regionId => !authored.has(regionId))) throw new Error("LOCAL_RECOVERY_REGION_NOT_AUTHORED");
    if (action.branchId === store.key) {
      // The active draft is first archived intact; the selected regions are
      // then written on top of the adopted current version as normal edits.
      await adopt(action);
    } else {
      if (store.getSnapshot().pendingRemoteSync) throw new Error("LOCAL_RECOVERY_ACTIVE_DRAFT_PENDING");
      const current = await readCurrent(action.signal);
      if (!sameAnchor(current.anchor, action.expectedCurrentAnchor)) throw new Error("LOCAL_RECOVERY_CURRENT_CHANGED");
    }
    throwIfAborted(action.signal);
    if (!latest.current.sessionReady) throw new Error("LOCAL_RECOVERY_UNAVAILABLE");
    const result = await latest.current.restoreRegions(value, action.regionIds);
    if (result && typeof result === "object" && "applied" in result && result.applied === false)
      throw new Error("LOCAL_RECOVERY_REGION_BUSY");
  }), [adopt, exclusive, readBranch, readCurrent, typeKey]);

  const discardLocalRecovery = useCallback<LocalRecoveryController["discardLocalRecovery"]>(action => exclusive(async () => {
    const store = latest.current.persistence;
    if (!store) throw new Error("LOCAL_RECOVERY_UNAVAILABLE");
    throwIfAborted(action.signal);
    await store.discardRecoveryRecord(action.branchId, action.expectedGeneration);
    setListVersion(version => version + 1);
  }), [exclusive]);

  return useMemo(() => ({ recovery, inspectLocalRecovery, exportLocalRecovery, archiveAndAdoptCurrent,
    reapplyLocalRecovery, discardLocalRecovery }), [archiveAndAdoptCurrent, discardLocalRecovery,
    exportLocalRecovery, inspectLocalRecovery, reapplyLocalRecovery, recovery]);
}
