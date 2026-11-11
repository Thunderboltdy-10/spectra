import * as Y from "yjs";
import { syncRetryDelayMs } from "../../../../../shared/sync-retry-policy";
import { encodeDurableFrontier } from "../../../../../shared/collaboration-durable-frontier.mjs";
import type { NativeRecoveryConflict } from "../../collaboration/types";
import { mergeRecoveryAncestry, readDurableRoomAnchor, recoveryRegionIds, type DurableRoomAnchor } from "../../../../../shared/collaboration-recovery.mjs";

// room-v1 begins with the server-authored native baseline protocol. Earlier
// caches may
// contain independently initialized Yjs identities, so replaying them into a
// canonical room can duplicate document blocks and structured collections.
export const LOCAL_YJS_DATABASE = "spectra-yjs-room-v1";
export const LOCAL_YJS_STORE = "work-updates";
export const LOCAL_YJS_META_STORE = "work-meta";
export const LOCAL_YJS_BASE_STORE = "work-bases";
const LOCAL_YJS_BASE_CHUNK_BYTES = 512 * 1024;
export const LOCAL_PERSISTENCE_ORIGIN = Symbol("spectra-local-persistence");
export const LOCAL_PERSISTENCE_MAX_ATTEMPTS = 8;

// React cleanup cannot await IndexedDB. A replacement editor must wait for
// the previous instance's final write before restoring the same cache key.
const closingWrites = new Map<string, Promise<void>>();
const failedWrites = new Map<string, number>();

export type LocalYjsRecord = {
  key: string;
  update: Uint8Array;
  bytes: number;
  updatedAt: number;
  lastOpenedAt: number;
  pendingRemoteSync: boolean;
  modelVersion: number;
  // Immutable local base chunks plus a bounded causal journal. Reads hydrate
  // baseUpdate; IndexedDB headers contain only the matching base identity.
  recoveryMode?: "delta";
  durableFrontier?: Uint8Array;
  baseId?: string;
  baseUpdate?: Uint8Array;
  baseByteLength?: number;
  recoveryConflict?: NativeRecoveryConflict;
  recoveryAnchor?: DurableRoomAnchor;
  authoredRegionIds?: string[];
  recoveryGeneration?: number;
  generation?: string;
  adoptionId?: string;
  writerId?: string;
};

export type LocalYjsMeta = {
  key: string;
  bytes: number;
  lastOpenedAt: number;
  pendingRemoteSync: boolean;
  generation?: string;
  recoveryAnchor?: DurableRoomAnchor;
  recoveryConflict?: NativeRecoveryConflict;
  authoredRegionIds?: string[];
  updatedAt?: number;
};

export interface LocalYjsStore {
  get(key: string): Promise<LocalYjsRecord | null>;
  put(record: LocalYjsRecord): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<LocalYjsRecord[]>;
  listMeta(): Promise<LocalYjsMeta[]>;
  commit(record: LocalYjsRecord, limits: LocalYjsLimits): Promise<LocalYjsRecord>;
  deleteIfDurable(key: string): Promise<boolean>;
  archiveAndReplace?(args: LocalRecoveryReplacement): Promise<{ archivedBranchId: string; record: LocalYjsRecord }>;
  /** Deletes one retained recovery branch only if it is still the exact reviewed generation. */
  discardBranch?(key: string, expectedGeneration: string): Promise<void>;
}

/** Retained recovery branches live beside the active record under this prefix. */
export const localRecoveryBranchPrefix = (key: string) => `${key}:recovery:`;

export type LocalRecoveryReplacement = { key: string; branchKey: string; expectedGeneration: string;
  expectedActiveGeneration: string; record: LocalYjsRecord; limits: LocalYjsLimits; validate?: () => void };
export const localRecordGeneration = (record: Pick<LocalYjsRecord, "generation" | "updatedAt" | "bytes">) =>
  record.generation ?? `legacy:${record.updatedAt}:${record.bytes}`;

/** The active draft is archived intact (with its own base) before adoption.
 * A clean active record holds nothing to retain. */
function retainedActive(args: LocalRecoveryReplacement, active: LocalYjsRecord): LocalYjsRecord | null {
  if (args.branchKey !== args.key && !active.pendingRemoteSync) return null;
  return { ...active, key: `${localRecoveryBranchPrefix(args.key)}${crypto.randomUUID()}`, pendingRemoteSync: true,
    generation: crypto.randomUUID() };
}

function assertReplacementQuota(args: LocalRecoveryReplacement, records: Array<Pick<LocalYjsMeta, "key" | "bytes">>,
  active: LocalYjsRecord, archived: LocalYjsRecord | null) {
  const others = records.filter(record => record.key !== args.key);
  const total = others.reduce((sum, record) => sum + record.bytes, 0) + (archived ? active.bytes : 0) + args.record.bytes;
  if (others.length + (archived ? 2 : 1) > args.limits.maxWorks || total > args.limits.totalBytes)
    throw new Error("LOCAL_YJS_QUOTA_RESERVED_FOR_PENDING_CHANGES");
}

export type LocalYjsLimits = { perWorkBytes: number; totalBytes: number; maxWorks: number };

function recordMeta(record: LocalYjsRecord): LocalYjsMeta {
  return { key: record.key, bytes: record.bytes, lastOpenedAt: record.lastOpenedAt, pendingRemoteSync: record.pendingRemoteSync,
    generation: localRecordGeneration(record), recoveryAnchor: record.recoveryAnchor, recoveryConflict: record.recoveryConflict,
    authoredRegionIds: record.authoredRegionIds, updatedAt: record.updatedAt };
}

export function mergeLocalYjsRecord(previous: LocalYjsRecord | null, incoming: LocalYjsRecord, maxBytes: number): LocalYjsRecord {
  if (previous && (previous.key !== incoming.key || previous.modelVersion !== incoming.modelVersion))
    throw new Error("LOCAL_YJS_MODEL_MISMATCH");
  if (incoming.recoveryMode === "delta" && (!incoming.baseId || !incoming.baseUpdate))
    throw new Error("LOCAL_YJS_RECOVERY_BASE_MISSING");
  let baseId = incoming.baseId;
  const baseUpdate = incoming.baseUpdate;
  const sameBase = Boolean(baseUpdate && previous?.baseUpdate &&
    (baseId === previous.baseId || (baseUpdate.byteLength === previous.baseUpdate.byteLength && baseUpdate.every((byte, index) => byte === previous.baseUpdate![index]))));
  if (sameBase) baseId = previous!.baseId;
  // Repeated edits sharing an immutable base merge only journal bytes. A
  // different checkpoint is reconstructed once before selecting its base.
  const incomingState = baseUpdate && !sameBase ? Y.mergeUpdates([baseUpdate, incoming.update]) : incoming.update;
  const previousState = previous?.baseUpdate && !sameBase ? Y.mergeUpdates([previous.baseUpdate, previous.update]) : previous?.update;
  const same = previousState && previousState.byteLength === incomingState.byteLength && previousState.every((byte, index) => byte === incomingState[index]);
  let covered = !previous || Boolean(same);
  if (previousState && !incoming.pendingRemoteSync && !covered) {
    const cleanState = incoming.baseUpdate ? Y.mergeUpdates([incoming.baseUpdate, incoming.update]) : incomingState;
    const frontier = incoming.durableFrontier ? Y.decodeSnapshot(incoming.durableFrontier)
      : Y.createSnapshot(Y.decodeUpdate(cleanState).ds, Y.decodeStateVector(Y.encodeStateVectorFromUpdate(cleanState)));
    covered = Y.snapshotContainsUpdate(frontier, previousState);
  }
  const merged = previousState && !same ? Y.mergeUpdates([previousState, incomingState]) : incomingState;
  const update = baseUpdate && !sameBase ? Y.diffUpdate(merged, Y.encodeStateVectorFromUpdate(baseUpdate)) : merged;
  const ancestry = mergeRecoveryAncestry(previous, incoming, covered && !incoming.pendingRemoteSync);
  const fromPrevious = ancestry.recoveryAnchor && previous?.recoveryAnchor &&
    ancestry.recoveryAnchor.roomId === previous.recoveryAnchor.roomId &&
    ancestry.recoveryAnchor.nextSequence === previous.recoveryAnchor.nextSequence &&
    ancestry.recoveryAnchor.frontierHash === previous.recoveryAnchor.frontierHash;
  const durableFrontier = fromPrevious ? previous.durableFrontier : incoming.durableFrontier;
  const journalBytes = update.byteLength + (durableFrontier?.byteLength ?? 0);
  if (journalBytes > maxBytes) throw new Error("LOCAL_YJS_QUOTA_RESERVED_FOR_PENDING_CHANGES");
  Y.decodeUpdate(update);
  return { ...incoming, generation: crypto.randomUUID(), baseId, baseByteLength: baseUpdate?.byteLength, update, bytes: journalBytes + (baseUpdate?.byteLength ?? 0),
    ...ancestry, durableFrontier,
    recoveryConflict: incoming.recoveryConflict ?? (covered && !incoming.pendingRemoteSync ? undefined : previous?.recoveryConflict),
    pendingRemoteSync: incoming.pendingRemoteSync || Boolean(previous?.pendingRemoteSync && !covered) };
}
export type LocalDurabilitySnapshot = {
  state: "loading" | "ready" | "persisting" | "local_only" | "quota_exceeded" | "unsupported" | "error" | "closed";
  bytes: number;
  pendingRemoteSync: boolean;
  restored: boolean;
  error?: string;
  retryExhausted?: boolean;
  recoveryConflict?: NativeRecoveryConflict;
  recoveryAnchor?: DurableRoomAnchor;
  authoredRegionIds?: string[];
  generation?: string;
  branchKey?: string;
};

const UNSUPPORTED: LocalDurabilitySnapshot = {
  state: "unsupported",
  bytes: 0,
  pendingRemoteSync: false,
  restored: false,
};

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("INDEXEDDB_REQUEST_FAILED"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("INDEXEDDB_TRANSACTION_ABORTED"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("INDEXEDDB_TRANSACTION_FAILED"));
  });
}

type LocalBaseChunk = { key: string; workKey: string; baseId: string; index: number; update: Uint8Array };

async function hydrateBase(transaction: IDBTransaction, record: LocalYjsRecord | undefined): Promise<LocalYjsRecord | null> {
  if (!record?.baseId) return record ?? null;
  const chunks = await requestResult(transaction.objectStore(LOCAL_YJS_BASE_STORE).index("by_work").getAll(record.key) as IDBRequest<LocalBaseChunk[]>);
  chunks.sort((left, right) => left.index - right.index);
  if (!chunks.length || chunks.some((chunk, index) => chunk.baseId !== record.baseId || chunk.index !== index))
    throw new Error("LOCAL_YJS_RECOVERY_BASE_MISSING");
  const length = chunks.reduce((total, chunk) => total + chunk.update.byteLength, 0);
  if (length !== record.baseByteLength) throw new Error("LOCAL_YJS_RECOVERY_BASE_INCOMPLETE");
  const baseUpdate = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { baseUpdate.set(chunk.update, offset); offset += chunk.update.byteLength; }
  return { ...record, baseUpdate };
}

async function deleteBase(transaction: IDBTransaction, key: string) {
  const store = transaction.objectStore(LOCAL_YJS_BASE_STORE);
  const keys = await requestResult(store.index("by_work").getAllKeys(key));
  for (const chunkKey of keys) store.delete(chunkKey);
}

async function writeLocalRecord(transaction: IDBTransaction, record: LocalYjsRecord, previousBaseId?: string) {
  const { baseUpdate, ...header } = record;
  if (previousBaseId !== record.baseId) {
    await deleteBase(transaction, record.key);
    if (baseUpdate && record.baseId) {
      const store = transaction.objectStore(LOCAL_YJS_BASE_STORE);
      for (let offset = 0, index = 0; offset < baseUpdate.length; offset += LOCAL_YJS_BASE_CHUNK_BYTES, index++) {
        store.put({ key: `${record.key}:${index}`, workKey: record.key, baseId: record.baseId, index,
          update: baseUpdate.slice(offset, offset + LOCAL_YJS_BASE_CHUNK_BYTES) } satisfies LocalBaseChunk);
      }
    }
  }
  transaction.objectStore(LOCAL_YJS_STORE).put({ ...header, ...(baseUpdate ? { baseByteLength: baseUpdate.byteLength } : {}) });
  transaction.objectStore(LOCAL_YJS_META_STORE).put(recordMeta(record));
}

export class IndexedDbYjsStore implements LocalYjsStore {
  private database: Promise<IDBDatabase> | null = null;
  private open() {
    if (this.database) return this.database;
    this.database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(LOCAL_YJS_DATABASE, 3);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(LOCAL_YJS_STORE))
          database.createObjectStore(LOCAL_YJS_STORE, { keyPath: "key" });
        if (!database.objectStoreNames.contains(LOCAL_YJS_META_STORE))
          database.createObjectStore(LOCAL_YJS_META_STORE, { keyPath: "key" });
        if (!database.objectStoreNames.contains(LOCAL_YJS_BASE_STORE))
          database.createObjectStore(LOCAL_YJS_BASE_STORE, { keyPath: "key" }).createIndex("by_work", "workKey");
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); this.database = null; };
        resolve(request.result);
      };
      request.onerror = () => { this.database = null; reject(request.error ?? new Error("INDEXEDDB_OPEN_FAILED")); };
    });
    return this.database;
  }

  async get(key: string) {
    const database = await this.open();
    const transaction = database.transaction([LOCAL_YJS_STORE, LOCAL_YJS_BASE_STORE], "readonly");
    return hydrateBase(transaction, await requestResult(transaction.objectStore(LOCAL_YJS_STORE).get(key) as IDBRequest<LocalYjsRecord | undefined>));
  }

  async put(record: LocalYjsRecord) {
    const database = await this.open();
    const transaction = database.transaction([LOCAL_YJS_STORE, LOCAL_YJS_META_STORE, LOCAL_YJS_BASE_STORE], "readwrite");
    const completed = transactionDone(transaction);
    void completed.catch(() => undefined);
    try {
      const previous = await requestResult(transaction.objectStore(LOCAL_YJS_STORE).get(record.key) as IDBRequest<LocalYjsRecord | undefined>);
      await writeLocalRecord(transaction, record, previous?.baseId);
      await completed;
    } catch (error) { try { transaction.abort(); } catch {} await completed.catch(() => undefined); throw error; }
  }

  async commit(record: LocalYjsRecord, limits: LocalYjsLimits) {
    const database = await this.open();
    const transaction = database.transaction([LOCAL_YJS_STORE, LOCAL_YJS_META_STORE, LOCAL_YJS_BASE_STORE], "readwrite");
    const completed = transactionDone(transaction);
    void completed.catch(() => undefined);
    const updates = transaction.objectStore(LOCAL_YJS_STORE);
    const metadata = transaction.objectStore(LOCAL_YJS_META_STORE);
    try {
      const active = await requestResult(updates.get(record.key) as IDBRequest<LocalYjsRecord | undefined>);
      if (active && active.adoptionId !== record.adoptionId) record = { ...record,
        key: `${localRecoveryBranchPrefix(record.key)}${record.writerId ?? crypto.randomUUID()}`, pendingRemoteSync: true,
        recoveryConflict: { regionIds: ["artifact:structure"], nativeOperationId: null } };
      const previousHeader = await requestResult(updates.get(record.key) as IDBRequest<LocalYjsRecord | undefined>);
      const previous = previousHeader?.baseId && previousHeader.baseId === record.baseId && record.baseUpdate?.byteLength === previousHeader.baseByteLength
        ? { ...previousHeader, baseUpdate: record.baseUpdate } : await hydrateBase(transaction, previousHeader);
      const merged = mergeLocalYjsRecord(previous, record, limits.perWorkBytes);
      const records = await requestResult(metadata.getAll() as IDBRequest<LocalYjsMeta[]>);
      const known = new Set(records.map(entry => entry.key));
      const keys = await requestResult(updates.getAllKeys());
      for (const key of keys) if (!known.has(String(key))) {
        const legacy = await requestResult(updates.get(key) as IDBRequest<LocalYjsRecord | undefined>);
        if (legacy) { const meta = recordMeta(legacy); records.push(meta); metadata.put(meta); }
      }
      const candidates = records.filter(entry => entry.key !== record.key).sort((left, right) => left.lastOpenedAt - right.lastOpenedAt);
      let total = candidates.reduce((sum, entry) => sum + entry.bytes, 0) + merged.bytes;
      let count = candidates.length + 1;
      for (const candidate of candidates) {
        if (total <= limits.totalBytes && count <= limits.maxWorks) break;
        const current = await requestResult(updates.get(candidate.key) as IDBRequest<LocalYjsRecord | undefined>);
        if (current?.pendingRemoteSync) continue;
        updates.delete(candidate.key); metadata.delete(candidate.key); await deleteBase(transaction, candidate.key);
        total -= candidate.bytes; count -= 1;
      }
      if (total > limits.totalBytes || count > limits.maxWorks)
        throw new Error("LOCAL_YJS_QUOTA_RESERVED_FOR_PENDING_CHANGES");
      await writeLocalRecord(transaction, merged, previous?.baseId);
      await completed;
      return merged;
    } catch (error) {
      try { transaction.abort(); } catch { /* Already aborted. */ }
      await completed.catch(() => undefined); throw error;
    }
  }

  async archiveAndReplace(args: LocalRecoveryReplacement) {
    const database = await this.open();
    const transaction = database.transaction([LOCAL_YJS_STORE, LOCAL_YJS_META_STORE, LOCAL_YJS_BASE_STORE], "readwrite");
    const completed = transactionDone(transaction); void completed.catch(() => undefined);
    try {
      const updates = transaction.objectStore(LOCAL_YJS_STORE);
      const active = await hydrateBase(transaction, await requestResult(updates.get(args.key) as IDBRequest<LocalYjsRecord | undefined>));
      const branch = args.branchKey === args.key ? active : await hydrateBase(transaction,
        await requestResult(updates.get(args.branchKey) as IDBRequest<LocalYjsRecord | undefined>));
      if (!active || !branch || localRecordGeneration(active) !== args.expectedActiveGeneration ||
          localRecordGeneration(branch) !== args.expectedGeneration) throw new Error("LOCAL_RECOVERY_GENERATION_CHANGED");
      const archived = retainedActive(args, active);
      const records = await requestResult(transaction.objectStore(LOCAL_YJS_META_STORE).getAll() as IDBRequest<LocalYjsMeta[]>);
      assertReplacementQuota(args, records, active, archived);
      args.validate?.();
      if (archived) await writeLocalRecord(transaction, archived);
      await writeLocalRecord(transaction, args.record, active.baseId);
      await completed;
      return { archivedBranchId: archived?.key ?? args.branchKey, record: args.record };
    } catch (error) { try { transaction.abort(); } catch {} await completed.catch(() => undefined); throw error; }
  }

  async discardBranch(key: string, expectedGeneration: string) {
    const database = await this.open();
    const transaction = database.transaction([LOCAL_YJS_STORE, LOCAL_YJS_META_STORE, LOCAL_YJS_BASE_STORE], "readwrite");
    const completed = transactionDone(transaction); void completed.catch(() => undefined);
    try {
      const updates = transaction.objectStore(LOCAL_YJS_STORE);
      const current = await requestResult(updates.get(key) as IDBRequest<LocalYjsRecord | undefined>);
      if (!current || localRecordGeneration(current) !== expectedGeneration) throw new Error("LOCAL_RECOVERY_GENERATION_CHANGED");
      updates.delete(key); transaction.objectStore(LOCAL_YJS_META_STORE).delete(key); await deleteBase(transaction, key);
      await completed;
    } catch (error) { try { transaction.abort(); } catch {} await completed.catch(() => undefined); throw error; }
  }

  async deleteIfDurable(key: string) {
    const database = await this.open();
    const transaction = database.transaction([LOCAL_YJS_STORE, LOCAL_YJS_META_STORE, LOCAL_YJS_BASE_STORE], "readwrite");
    const completed = transactionDone(transaction);
    void completed.catch(() => undefined);
    try {
      const updates = transaction.objectStore(LOCAL_YJS_STORE);
      const current = await requestResult(updates.get(key) as IDBRequest<LocalYjsRecord | undefined>);
      if (current?.pendingRemoteSync) { await completed; return false; }
      updates.delete(key); transaction.objectStore(LOCAL_YJS_META_STORE).delete(key); await deleteBase(transaction, key);
      await completed; return true;
    } catch (error) { try { transaction.abort(); } catch {} await completed.catch(() => undefined); throw error; }
  }

  async delete(key: string) {
    const database = await this.open();
    const transaction = database.transaction([LOCAL_YJS_STORE, LOCAL_YJS_META_STORE, LOCAL_YJS_BASE_STORE], "readwrite");
    const completed = transactionDone(transaction);
    transaction.objectStore(LOCAL_YJS_STORE).delete(key);
    transaction.objectStore(LOCAL_YJS_META_STORE).delete(key);
    await deleteBase(transaction, key);
    await completed;
  }

  async list() {
    const database = await this.open();
    const transaction = database.transaction([LOCAL_YJS_STORE, LOCAL_YJS_BASE_STORE], "readonly");
    const records = await requestResult(transaction.objectStore(LOCAL_YJS_STORE).getAll() as IDBRequest<LocalYjsRecord[]>);
    return Promise.all(records.map(record => hydrateBase(transaction, record) as Promise<LocalYjsRecord>));
  }

  async listMeta() {
    const database = await this.open();
    const transaction = database.transaction([LOCAL_YJS_STORE, LOCAL_YJS_META_STORE], "readonly");
    const metadata = await requestResult(transaction.objectStore(LOCAL_YJS_META_STORE).getAll() as IDBRequest<LocalYjsMeta[]>);
    const known = new Set(metadata.map(record => record.key));
    const updates = transaction.objectStore(LOCAL_YJS_STORE);
    const keys = await requestResult(updates.getAllKeys());
    for (const key of keys) if (!known.has(String(key))) {
      const record = await requestResult(updates.get(key) as IDBRequest<LocalYjsRecord | undefined>);
      if (record) metadata.push(recordMeta(record));
    }
    return metadata;
  }
}
export class MemoryYjsStore implements LocalYjsStore {
  private readonly records = new Map<string, LocalYjsRecord>();

  async get(key: string) {
    const record = this.records.get(key);
    return record ? { ...record, update: record.update.slice() } : null;
  }

  async put(record: LocalYjsRecord) {
    this.records.set(record.key, { ...record, update: record.update.slice() });
  }

  async commit(record: LocalYjsRecord, limits: LocalYjsLimits) {
    // No await between the read and commit: this store models one atomic IDB transaction.
    const active = this.records.get(record.key);
    if (active && active.adoptionId !== record.adoptionId) record = { ...record,
      key: `${localRecoveryBranchPrefix(record.key)}${record.writerId ?? crypto.randomUUID()}`, pendingRemoteSync: true,
      recoveryConflict: { regionIds: ["artifact:structure"], nativeOperationId: null } };
    const merged = mergeLocalYjsRecord(this.records.get(record.key) ?? null, record, limits.perWorkBytes);
    const candidates = [...this.records.values()].filter(entry => entry.key !== record.key)
      .sort((left, right) => left.lastOpenedAt - right.lastOpenedAt);
    let total = candidates.reduce((sum, entry) => sum + entry.bytes, 0) + merged.bytes;
    let count = candidates.length + 1;
    const removed: string[] = [];
    for (const candidate of candidates) {
      if (total <= limits.totalBytes && count <= limits.maxWorks) break;
      if (candidate.pendingRemoteSync) continue;
      removed.push(candidate.key); total -= candidate.bytes; count -= 1;
    }
    if (total > limits.totalBytes || count > limits.maxWorks)
      throw new Error("LOCAL_YJS_QUOTA_RESERVED_FOR_PENDING_CHANGES");
    for (const key of removed) this.records.delete(key);
    this.records.set(record.key, { ...merged, update: merged.update.slice() });
    return { ...merged, update: merged.update.slice() };
  }

  async archiveAndReplace(args: LocalRecoveryReplacement) {
    const active = this.records.get(args.key), branch = this.records.get(args.branchKey);
    if (!active || !branch || localRecordGeneration(active) !== args.expectedActiveGeneration ||
        localRecordGeneration(branch) !== args.expectedGeneration) throw new Error("LOCAL_RECOVERY_GENERATION_CHANGED");
    const archived = retainedActive(args, active);
    assertReplacementQuota(args, [...this.records.values()], active, archived);
    args.validate?.();
    if (archived) this.records.set(archived.key, archived);
    this.records.set(args.key, args.record);
    return { archivedBranchId: archived?.key ?? args.branchKey, record: args.record };
  }

  async discardBranch(key: string, expectedGeneration: string) {
    const current = this.records.get(key);
    if (!current || localRecordGeneration(current) !== expectedGeneration) throw new Error("LOCAL_RECOVERY_GENERATION_CHANGED");
    this.records.delete(key);
  }

  async deleteIfDurable(key: string) {
    if (this.records.get(key)?.pendingRemoteSync) return false;
    this.records.delete(key);
    return true;
  }

  async delete(key: string) {
    this.records.delete(key);
  }

  async list() {
    return [...this.records.values()].map((record) => ({ ...record, update: record.update.slice() }));
  }

  async listMeta() {
    return [...this.records.values()].map(recordMeta);
  }
}

export type BoundedYjsPersistenceOptions = {
  key: string;
  document: Y.Doc;
  modelVersion: number;
  store?: LocalYjsStore;
  now?: () => number;
  debounceMs?: number;
  perWorkBytes?: number;
  totalBytes?: number;
  maxWorks?: number;
};

export function shouldRefuseCollapsedLocalPersist(
  previous: Pick<LocalYjsRecord, "bytes" | "pendingRemoteSync"> | null,
  nextBytes: number,
  pendingRemoteSync: boolean,
) {
  return Boolean(
    previous &&
      !previous.pendingRemoteSync &&
      pendingRemoteSync &&
      previous.bytes >= 4096 &&
      nextBytes * 4 < previous.bytes,
  );
}

export class BoundedYjsLocalPersistence {
  private readonly listeners = new Set<() => void>();
  private readonly store: LocalYjsStore | null;
  private readonly now: () => number;
  private readonly debounceMs: number;
  private readonly perWorkBytes: number;
  private readonly totalBytes: number;
  private readonly maxWorks: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private initialized = false;
  private dirty = false;
  private documentPendingRemoteSync = false;
  private changeVersion = 0;
  private persistInFlight: Promise<void> | null = null;
  private persistAttempts = 0;
  private durableFrontier: Uint8Array | null = null;
  private localBase: { id: string; update: Uint8Array } | null = null;
  private recoveryAnchor: DurableRoomAnchor | undefined;
  private adoptionId: string | undefined;
  private readonly writerId = crypto.randomUUID();
  private authoredRegionIds: string[] = [];
  private closePromise: Promise<void> | null = null;
  // Set once this writer's draft was archived and a new head adopted. The
  // replacement instance owns the key; this one never writes again.
  private retired = false;
  private snapshot: LocalDurabilitySnapshot;
  private readonly onUpdate: (update: Uint8Array, origin: unknown, document: Y.Doc, transaction: Y.Transaction) => void;

  constructor(private readonly options: BoundedYjsPersistenceOptions) {
    this.persistAttempts = failedWrites.get(options.key) ?? 0;
    this.store =
      options.store ??
      (typeof indexedDB !== "undefined" ? new IndexedDbYjsStore() : null);
    this.now = options.now ?? Date.now;
    this.debounceMs = Math.max(0, options.debounceMs ?? 140);
    this.perWorkBytes = options.perWorkBytes ?? 8 * 1024 * 1024;
    this.totalBytes = options.totalBytes ?? 64 * 1024 * 1024;
    this.maxWorks = options.maxWorks ?? 24;
    this.snapshot = this.store
      ? { state: "loading", bytes: 0, pendingRemoteSync: false, restored: false }
      : UNSUPPORTED;
    this.onUpdate = (_update, origin, _document, transaction) => {
      if (!this.initialized || origin === LOCAL_PERSISTENCE_ORIGIN) return;
      this.documentPendingRemoteSync = true;
      if (transaction.local) {
        const regionId = origin && typeof origin === "object" ? (origin as { regionId?: unknown }).regionId : undefined;
        this.authoredRegionIds = recoveryRegionIds([...this.authoredRegionIds,
          ...(typeof regionId === "string" ? regionId.split(",") : ["artifact:structure"])]);
      }
      this.changeVersion += 1;
      this.dirty = true;
      if (this.persistAttempts >= LOCAL_PERSISTENCE_MAX_ATTEMPTS) {
        this.patch({ state: "error", pendingRemoteSync: true, retryExhausted: true,
          error: "Device storage is unavailable. Automatic retries stopped; retry synchronization to save the local draft." });
        return;
      }
      if (
        this.snapshot.state !== "persisting" ||
        !this.snapshot.pendingRemoteSync
      )
        this.patch({
          state: "persisting",
          pendingRemoteSync: true,
          error: undefined,
        });
      this.schedulePersist();
    };
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async initialize() {
    if (!this.store || this.destroyed) return this.snapshot;
    try {
      await closingWrites.get(this.options.key);
      if (this.destroyed) return this.snapshot;
      const record = await this.store.get(this.options.key);
      if (this.destroyed) return this.snapshot;
      if (record?.update?.length) {
        if (record.modelVersion !== this.options.modelVersion) throw new Error("LOCAL_YJS_MODEL_MISMATCH");
        if (record.recoveryMode === "delta" && !record.baseUpdate) throw new Error("LOCAL_YJS_RECOVERY_BASE_MISSING");
        Y.applyUpdate(this.options.document, record.baseUpdate ? Y.mergeUpdates([record.baseUpdate, record.update]) : record.update, LOCAL_PERSISTENCE_ORIGIN);
        this.localBase = record.baseId && record.baseUpdate ? { id: record.baseId, update: record.baseUpdate } : null;
        this.durableFrontier = record.durableFrontier ?? null;
        this.recoveryAnchor = readDurableRoomAnchor(record.recoveryAnchor) ?? undefined;
        this.adoptionId = record.adoptionId;
        this.authoredRegionIds = recoveryRegionIds(record.authoredRegionIds ?? (record.pendingRemoteSync ? ["artifact:structure"] : []));
        this.documentPendingRemoteSync = record.pendingRemoteSync;
        this.snapshot = {
          state: record.pendingRemoteSync ? "local_only" : "ready",
          bytes: record.bytes,
          pendingRemoteSync: record.pendingRemoteSync,
          restored: true,
          recoveryConflict: record.recoveryConflict,
          recoveryAnchor: this.recoveryAnchor,
          authoredRegionIds: this.authoredRegionIds,
          generation: localRecordGeneration(record), branchKey: record.key,
        };
      } else {
        this.snapshot = {
          state: "ready",
          bytes: 0,
          pendingRemoteSync: false,
          restored: false,
        };
      }
      this.initialized = true;
      this.options.document.on("update", this.onUpdate);
      this.emit();
      return this.snapshot;
    } catch (error) {
      this.patch({
        state: "error",
        error: error instanceof Error ? error.message : "Local collaboration cache failed.",
      });
      return this.snapshot;
    }
  }

  markRemoteDurable(anchor?: DurableRoomAnchor) {
    if (this.snapshot.recoveryConflict || this.retired) return;
    if (!this.store || !this.initialized) return;
    if (!this.snapshot.pendingRemoteSync && (!anchor ||
        (anchor.roomId === this.recoveryAnchor?.roomId && anchor.nextSequence === this.recoveryAnchor.nextSequence &&
          anchor.frontierHash === this.recoveryAnchor.frontierHash))) return;
    this.changeVersion += 1;
    const frontier = encodeDurableFrontier(Y, this.options.document);
    // Unresolved branches cannot be acknowledged by a vector or saved as a
    // durable base. Their bytes remain reserved until dependencies arrive.
    if (!frontier) return;
    this.durableFrontier = frontier;
    this.recoveryAnchor = anchor;
    this.authoredRegionIds = [];
    this.documentPendingRemoteSync = false;
    this.patch({ state: "ready", pendingRemoteSync: false });
    this.dirty = true;
    this.schedulePersist();
  }

  async persistNow() {
    if (!this.store || this.destroyed || !this.initialized || this.retired) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    if (this.persistInFlight) {
      await this.persistInFlight;
      if (
        this.dirty &&
        !this.destroyed &&
        this.snapshot.state !== "error" &&
        this.snapshot.state !== "quota_exceeded"
      )
        await this.persistNow();
      return;
    }
    const version = this.changeVersion;
    const pendingRemoteSync = this.documentPendingRemoteSync;
    const recovery = this.captureRecovery();
    const { update } = recovery;
    if (update.byteLength > this.perWorkBytes) {
      this.patch({
        state: "quota_exceeded",
        bytes: update.byteLength,
        error: "This unsynchronized edit exceeds the local recovery budget. Keep this artifact open until synchronization completes.",
      });
      return;
    }
    const persist = this.writeSnapshot(
      update,
      version,
      pendingRemoteSync,
      false,
      recovery,
    );
    this.persistInFlight = persist;
    try {
      await persist;
    } finally {
      if (this.persistInFlight === persist) this.persistInFlight = null;
    }
    // writeSnapshot owns retry scheduling for failed writes. Only schedule an
    // immediate follow-up when a newer edit arrived during a successful write.
    if (
      this.dirty &&
      !this.destroyed &&
      this.snapshot.state === "persisting"
    )
      this.schedulePersist();
  }

  async clear() {
    if (!this.store) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.persistInFlight) await this.persistInFlight;
    if (!await this.store.deleteIfDurable(this.options.key))
      throw new Error("LOCAL_YJS_PENDING_RECOVERY_RESERVED");
    this.changeVersion += 1;
    this.dirty = false;
    this.documentPendingRemoteSync = false;
    this.durableFrontier = null;
    this.localBase = null;
    this.recoveryAnchor = undefined;
    this.authoredRegionIds = [];
    this.patch({ state: "ready", bytes: 0, pendingRemoteSync: false, restored: false });
  }

  destroy() {
    if (this.closePromise) return this.closePromise;
    if (this.destroyed) return Promise.resolve();
    const finalSnapshot =
      this.store && this.initialized && this.dirty && !this.retired
        ? {
            version: this.changeVersion,
            pendingRemoteSync: this.documentPendingRemoteSync,
            ...this.captureRecovery(),
          }
        : null;
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.options.document.off("update", this.onUpdate);
    this.snapshot = { ...this.snapshot, state: "closed" };
    this.emit();
    this.listeners.clear();
    const previousClose = closingWrites.get(this.options.key);
    const close = (async () => {
      await previousClose;
      if (this.persistInFlight) await this.persistInFlight;
      if (finalSnapshot && this.store) {
        await this.writeSnapshot(
          finalSnapshot.update,
          finalSnapshot.version,
          finalSnapshot.pendingRemoteSync,
          true,
          finalSnapshot,
        );
      }
    })();
    this.closePromise = close.finally(() => {
      if (closingWrites.get(this.options.key) === this.closePromise)
        closingWrites.delete(this.options.key);
    });
    closingWrites.set(this.options.key, this.closePromise);
    return this.closePromise;
  }

  private async writeSnapshot(
    update: Uint8Array,
    version: number,
    pendingRemoteSync: boolean,
    closing: boolean,
    recovery: Pick<LocalYjsRecord, "recoveryMode" | "durableFrontier" | "baseId" | "baseUpdate" | "recoveryAnchor" | "authoredRegionIds" | "recoveryGeneration"> = {},
  ) {
    if (!this.store) return;
    if (update.byteLength > this.perWorkBytes) {
      if (!closing)
        this.patch({
          state: "quota_exceeded",
          bytes: update.byteLength,
          error: "This unsynchronized edit exceeds the local recovery budget. Keep this artifact open until synchronization completes.",
        });
      return;
    }
    try {
      const timestamp = this.now();
      const committed = await this.store.commit({
        key: this.options.key,
        update,
        bytes: update.byteLength,
        updatedAt: timestamp,
        lastOpenedAt: timestamp,
        pendingRemoteSync,
        modelVersion: this.options.modelVersion,
        adoptionId: this.adoptionId, writerId: this.writerId,
        recoveryConflict: this.snapshot.recoveryConflict,
        ...recovery,
      }, { perWorkBytes: this.perWorkBytes, totalBytes: this.totalBytes, maxWorks: this.maxWorks });
      this.persistAttempts = 0;
      failedWrites.delete(this.options.key);
      if (committed.baseId && committed.baseUpdate) this.localBase = { id: committed.baseId, update: committed.baseUpdate };
      if (committed.key !== this.options.key) this.snapshot = { ...this.snapshot, recoveryConflict: committed.recoveryConflict };
      this.dirty = version !== this.changeVersion ||
        pendingRemoteSync !== this.documentPendingRemoteSync;
      if (!closing)
        this.patch({
          state: this.dirty
            ? "persisting"
            : committed.pendingRemoteSync
              ? "local_only"
              : "ready",
          pendingRemoteSync: committed.pendingRemoteSync || this.documentPendingRemoteSync,
          bytes: committed.bytes,
          error: undefined,
          retryExhausted: false,
          recoveryConflict: committed.recoveryConflict,
          recoveryAnchor: committed.recoveryAnchor,
          authoredRegionIds: committed.authoredRegionIds,
          generation: localRecordGeneration(committed), branchKey: committed.key,
        });
    } catch (error) {
      this.dirty = true;
      this.persistAttempts = Math.min(this.persistAttempts + 1, LOCAL_PERSISTENCE_MAX_ATTEMPTS);
      failedWrites.set(this.options.key, this.persistAttempts);
      const message =
        error instanceof Error
          ? error.message
          : "Local collaboration cache failed.";
      const quotaExceeded =
        /LOCAL_YJS_QUOTA_RESERVED_FOR_PENDING_CHANGES|QuotaExceededError/i.test(
          message,
        );
      if (!closing)
        this.patch({
          state: quotaExceeded ? "quota_exceeded" : "error",
          error: quotaExceeded
            ? "Device storage is full. Spectra could not save another local recovery copy."
            : this.persistAttempts >= LOCAL_PERSISTENCE_MAX_ATTEMPTS
              ? "Device storage is unavailable. Automatic retries stopped; retry synchronization to save the local draft."
              : message,
          retryExhausted: this.persistAttempts >= LOCAL_PERSISTENCE_MAX_ATTEMPTS,
        });
      if (!closing && !this.destroyed && !quotaExceeded && this.persistAttempts < LOCAL_PERSISTENCE_MAX_ATTEMPTS)
        this.schedulePersist(syncRetryDelayMs(this.persistAttempts, this.options.key));
    }
  }

  private schedulePersist(delayMs = this.debounceMs) {
    if (this.persistAttempts >= LOCAL_PERSISTENCE_MAX_ATTEMPTS) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persistNow();
    }, delayMs);
  }

  private patch(patch: Partial<LocalDurabilitySnapshot>) {
    const next = { ...this.snapshot, ...patch };
    if (
      next.state === this.snapshot.state &&
      next.bytes === this.snapshot.bytes &&
      next.pendingRemoteSync === this.snapshot.pendingRemoteSync &&
      next.restored === this.snapshot.restored &&
      next.error === this.snapshot.error
      && next.retryExhausted === this.snapshot.retryExhausted
      && next.recoveryConflict === this.snapshot.recoveryConflict
      && next.generation === this.snapshot.generation && next.branchKey === this.snapshot.branchKey
    )
      return;
    this.snapshot = next;
    this.emit();
  }

  get key() { return this.options.key; }

  async listRecoveryRecords() {
    if (!this.store) return [];
    const prefix = localRecoveryBranchPrefix(this.options.key);
    return (await this.store.listMeta()).filter(record => record.key.startsWith(prefix) ||
      (record.key === this.options.key && record.pendingRemoteSync));
  }

  async readRecoveryRecord(key: string) {
    if (!this.store || (key !== this.options.key && !key.startsWith(localRecoveryBranchPrefix(this.options.key))))
      throw new Error("LOCAL_RECOVERY_BRANCH_MISSING");
    const record = await this.store.get(key);
    if (!record) throw new Error("LOCAL_RECOVERY_BRANCH_MISSING");
    return record;
  }

  /** Only a retained branch can be discarded; the active draft must first be
   * archived by adopting the current version. */
  async discardRecoveryRecord(key: string, expectedGeneration: string) {
    if (!this.store?.discardBranch || !key.startsWith(localRecoveryBranchPrefix(this.options.key)))
      throw new Error("LOCAL_RECOVERY_BRANCH_MISSING");
    await this.store.discardBranch(key, expectedGeneration);
  }

  async archiveAndAdopt(args: { branchKey: string; expectedGeneration: string; update: Uint8Array;
    anchor: DurableRoomAnchor; signal?: AbortSignal }) {
    if (!this.store?.archiveAndReplace) throw new Error("LOCAL_RECOVERY_UNAVAILABLE");
    args.signal?.throwIfAborted();
    await this.persistNow();
    if (this.dirty || !["ready", "local_only"].includes(this.snapshot.state)) throw new Error("LOCAL_RECOVERY_NOT_SAVED");
    const active = await this.store.get(this.options.key);
    if (!active) throw new Error("LOCAL_RECOVERY_BRANCH_MISSING");
    const version = this.changeVersion;
    const current = new Y.Doc();
    const adoptionId = crypto.randomUUID();
    let frontier: Uint8Array;
    try { Y.applyUpdate(current, args.update); frontier = encodeDurableFrontier(Y, current)!;
      if (!frontier) throw new Error("LOCAL_RECOVERY_CURRENT_UNAVAILABLE"); }
    finally { current.destroy(); }
    const record: LocalYjsRecord = { key: this.options.key, update: new Uint8Array([0, 0]),
      baseId: crypto.randomUUID(), baseUpdate: args.update, baseByteLength: args.update.byteLength, recoveryMode: "delta",
      durableFrontier: frontier, bytes: args.update.byteLength + frontier.byteLength + 2,
      updatedAt: this.now(), lastOpenedAt: this.now(), modelVersion: this.options.modelVersion,
      pendingRemoteSync: false, recoveryAnchor: args.anchor, authoredRegionIds: [], generation: crypto.randomUUID(), adoptionId };
    const result = await this.store.archiveAndReplace({ key: this.options.key, branchKey: args.branchKey,
      expectedGeneration: args.expectedGeneration, expectedActiveGeneration: localRecordGeneration(active), record,
      limits: { perWorkBytes: this.perWorkBytes, totalBytes: this.totalBytes, maxWorks: this.maxWorks },
      validate: () => { args.signal?.throwIfAborted(); if (this.changeVersion !== version) throw new Error("LOCAL_RECOVERY_GENERATION_CHANGED"); } });
    if (this.changeVersion !== version) {
      // An edit between transaction commit and its completion event is saved
      // to this old writer's retained branch (the adoption id no longer
      // matches), never merged into the new head.
      await this.persistNow();
      if (this.dirty) throw new Error("LOCAL_RECOVERY_NOT_SAVED");
    }
    this.dirty = false;
    this.retired = true;
    this.options.document.off("update", this.onUpdate);
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    return { archivedBranchId: result.archivedBranchId, adoptionId };
  }

  private captureRecovery(): Pick<LocalYjsRecord, "update" | "recoveryMode" | "durableFrontier" | "baseId" | "baseUpdate" | "recoveryAnchor" | "authoredRegionIds" | "recoveryGeneration"> {
    let update = this.localBase
      ? Y.encodeStateAsUpdate(this.options.document, Y.encodeStateVectorFromUpdate(this.localBase.update))
      : Y.encodeStateAsUpdate(this.options.document);
    if ((!this.localBase && update.byteLength > this.perWorkBytes) ||
        (this.localBase && update.byteLength > this.perWorkBytes && !this.documentPendingRemoteSync)) {
      // The base remains actual local bytes, including any pending branch.
      // Its pending flag can clear only after the matching remote frontier.
      this.localBase = { id: crypto.randomUUID(), update: this.localBase ? Y.encodeStateAsUpdate(this.options.document) : update };
      update = Y.encodeStateAsUpdate(this.options.document, Y.encodeStateVectorFromUpdate(this.localBase.update));
    }
    return { update, recoveryAnchor: this.recoveryAnchor, authoredRegionIds: [...this.authoredRegionIds],
      recoveryGeneration: this.changeVersion, durableFrontier: this.durableFrontier?.slice(),
      ...(this.localBase ? { recoveryMode: "delta" as const, baseId: this.localBase.id, baseUpdate: this.localBase.update } : {}) };
  }

  async retry() {
    this.persistAttempts = 0;
    failedWrites.delete(this.options.key);
    this.patch({ retryExhausted: false });
    await this.persistNow();
  }

  preserveConflict(conflict: NativeRecoveryConflict) {
    if (this.snapshot.recoveryConflict === conflict || this.retired) return;
    this.changeVersion += 1;
    this.dirty = true;
    this.documentPendingRemoteSync = true;
    this.patch({ recoveryConflict: conflict, pendingRemoteSync: true,
      state: this.persistAttempts >= LOCAL_PERSISTENCE_MAX_ATTEMPTS ? "error" : "persisting" });
    this.schedulePersist();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}
