import * as Y from "yjs";
import { syncRetryDelayMs } from "../../../../../shared/sync-retry-policy";

// room-v1 begins with the server-authored native baseline protocol. Earlier
// caches may
// contain independently initialized Yjs identities, so replaying them into a
// canonical room can duplicate document blocks and structured collections.
export const LOCAL_YJS_DATABASE = "spectra-yjs-room-v1";
export const LOCAL_YJS_STORE = "work-updates";
export const LOCAL_YJS_META_STORE = "work-meta";
export const LOCAL_PERSISTENCE_ORIGIN = Symbol("spectra-local-persistence");

// React cleanup cannot await IndexedDB. A replacement editor must wait for
// the previous instance's final write before restoring the same cache key.
const closingWrites = new Map<string, Promise<void>>();

export type LocalYjsRecord = {
  key: string;
  update: Uint8Array;
  bytes: number;
  updatedAt: number;
  lastOpenedAt: number;
  pendingRemoteSync: boolean;
  modelVersion: number;
};

export type LocalYjsMeta = {
  key: string;
  bytes: number;
  lastOpenedAt: number;
  pendingRemoteSync: boolean;
};

export interface LocalYjsStore {
  get(key: string): Promise<LocalYjsRecord | null>;
  put(record: LocalYjsRecord): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<LocalYjsRecord[]>;
  listMeta(): Promise<LocalYjsMeta[]>;
  commit(record: LocalYjsRecord, limits: LocalYjsLimits): Promise<LocalYjsRecord>;
  deleteIfDurable(key: string): Promise<boolean>;
}

export type LocalYjsLimits = { perWorkBytes: number; totalBytes: number; maxWorks: number };

function recordMeta(record: LocalYjsRecord): LocalYjsMeta {
  return { key: record.key, bytes: record.bytes, lastOpenedAt: record.lastOpenedAt, pendingRemoteSync: record.pendingRemoteSync };
}

export function mergeLocalYjsRecord(previous: LocalYjsRecord | null, incoming: LocalYjsRecord, maxBytes: number): LocalYjsRecord {
  if (previous && (previous.key !== incoming.key || previous.modelVersion !== incoming.modelVersion))
    throw new Error("LOCAL_YJS_MODEL_MISMATCH");
  const same = previous && previous.update.byteLength === incoming.update.byteLength &&
    previous.update.every((byte, index) => byte === incoming.update[index]);
  let covered = !previous || Boolean(same);
  if (previous?.pendingRemoteSync && !incoming.pendingRemoteSync && !covered) {
    const decoded = Y.decodeUpdate(incoming.update);
    const vector = Y.decodeStateVector(Y.encodeStateVectorFromUpdate(incoming.update));
    covered = Y.snapshotContainsUpdate(Y.createSnapshot(decoded.ds, vector), previous.update);
  }
  const update = previous && !same ? Y.mergeUpdates([previous.update, incoming.update]) : incoming.update;
  if (update.byteLength > maxBytes) throw new Error("LOCAL_YJS_QUOTA_RESERVED_FOR_PENDING_CHANGES");
  // Parse even the first record so corrupt bytes cannot replace a valid cache.
  Y.decodeUpdate(update);
  return { ...incoming, update, bytes: update.byteLength,
    pendingRemoteSync: incoming.pendingRemoteSync || Boolean(previous?.pendingRemoteSync && !covered) };
}

export type LocalDurabilitySnapshot = {
  state: "loading" | "ready" | "persisting" | "local_only" | "quota_exceeded" | "unsupported" | "error" | "closed";
  bytes: number;
  pendingRemoteSync: boolean;
  restored: boolean;
  error?: string;
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

export class IndexedDbYjsStore implements LocalYjsStore {
  private database: Promise<IDBDatabase> | null = null;

  private open() {
    if (this.database) return this.database;
    this.database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(LOCAL_YJS_DATABASE, 2);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(LOCAL_YJS_STORE))
          database.createObjectStore(LOCAL_YJS_STORE, { keyPath: "key" });
        if (!database.objectStoreNames.contains(LOCAL_YJS_META_STORE))
          database.createObjectStore(LOCAL_YJS_META_STORE, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("INDEXEDDB_OPEN_FAILED"));
    });
    return this.database;
  }

  async get(key: string) {
    const database = await this.open();
    const transaction = database.transaction(LOCAL_YJS_STORE, "readonly");
    const result = await requestResult(
      transaction.objectStore(LOCAL_YJS_STORE).get(key) as IDBRequest<LocalYjsRecord | undefined>,
    );
    return result ?? null;
  }

  async put(record: LocalYjsRecord) {
    const database = await this.open();
    const transaction = database.transaction(
      [LOCAL_YJS_STORE, LOCAL_YJS_META_STORE],
      "readwrite",
    );
    const completed = transactionDone(transaction);
    await requestResult(transaction.objectStore(LOCAL_YJS_STORE).put(record));
    await requestResult(
      transaction.objectStore(LOCAL_YJS_META_STORE).put({
        key: record.key,
        bytes: record.bytes,
        lastOpenedAt: record.lastOpenedAt,
        pendingRemoteSync: record.pendingRemoteSync,
      } satisfies LocalYjsMeta),
    );
    await completed;
  }

  async commit(record: LocalYjsRecord, limits: LocalYjsLimits) {
    const database = await this.open();
    const transaction = database.transaction([LOCAL_YJS_STORE, LOCAL_YJS_META_STORE], "readwrite");
    const completed = transactionDone(transaction);
    void completed.catch(() => undefined);
    const updates = transaction.objectStore(LOCAL_YJS_STORE);
    const metadata = transaction.objectStore(LOCAL_YJS_META_STORE);
    try {
      const previous = await requestResult(updates.get(record.key) as IDBRequest<LocalYjsRecord | undefined>);
      const merged = mergeLocalYjsRecord(previous ?? null, record, limits.perWorkBytes);
      const records = await requestResult(metadata.getAll() as IDBRequest<LocalYjsMeta[]>);
      // Old v1 entries may predate the metadata store. Include their metadata
      // once without ever excluding a pending legacy branch from quota checks.
      const known = new Set(records.map(entry => entry.key));
      const keys = await requestResult(updates.getAllKeys());
      for (const key of keys) if (!known.has(String(key))) {
        const legacy = await requestResult(updates.get(key) as IDBRequest<LocalYjsRecord | undefined>);
        if (legacy) { const meta = recordMeta(legacy); records.push(meta); metadata.put(meta); }
      }
      const candidates = records.filter(entry => entry.key !== record.key)
        .sort((left, right) => left.lastOpenedAt - right.lastOpenedAt);
      let total = candidates.reduce((sum, entry) => sum + entry.bytes, 0) + merged.bytes;
      let count = candidates.length + 1;
      for (const candidate of candidates) {
        if (total <= limits.totalBytes && count <= limits.maxWorks) break;
        // The same transaction owns the admission and the delete. Another tab
        // cannot turn this record pending between the check and deletion.
        const current = await requestResult(updates.get(candidate.key) as IDBRequest<LocalYjsRecord | undefined>);
        if (current?.pendingRemoteSync) continue;
        updates.delete(candidate.key); metadata.delete(candidate.key);
        total -= candidate.bytes; count -= 1;
      }
      if (total > limits.totalBytes || count > limits.maxWorks)
        throw new Error("LOCAL_YJS_QUOTA_RESERVED_FOR_PENDING_CHANGES");
      updates.put(merged); metadata.put(recordMeta(merged));
      await completed;
      return merged;
    } catch (error) {
      try { transaction.abort(); } catch { /* Already aborted. */ }
      await completed.catch(() => undefined);
      throw error;
    }
  }

  async deleteIfDurable(key: string) {
    const database = await this.open();
    const transaction = database.transaction([LOCAL_YJS_STORE, LOCAL_YJS_META_STORE], "readwrite");
    const completed = transactionDone(transaction);
    void completed.catch(() => undefined);
    const updates = transaction.objectStore(LOCAL_YJS_STORE);
    try {
      const current = await requestResult(updates.get(key) as IDBRequest<LocalYjsRecord | undefined>);
      if (current?.pendingRemoteSync) { await completed; return false; }
      updates.delete(key); transaction.objectStore(LOCAL_YJS_META_STORE).delete(key);
      await completed;
      return true;
    } catch (error) { await completed.catch(() => undefined); throw error; }
  }

  async delete(key: string) {
    const database = await this.open();
    const transaction = database.transaction(
      [LOCAL_YJS_STORE, LOCAL_YJS_META_STORE],
      "readwrite",
    );
    const completed = transactionDone(transaction);
    await requestResult(transaction.objectStore(LOCAL_YJS_STORE).delete(key));
    if (database.objectStoreNames.contains(LOCAL_YJS_META_STORE))
      await requestResult(
        transaction.objectStore(LOCAL_YJS_META_STORE).delete(key),
      );
    await completed;
  }

  async list() {
    const database = await this.open();
    const transaction = database.transaction(LOCAL_YJS_STORE, "readonly");
    return requestResult(
      transaction.objectStore(LOCAL_YJS_STORE).getAll() as IDBRequest<LocalYjsRecord[]>,
    );
  }

  async listMeta() {
    const database = await this.open();
    if (!database.objectStoreNames.contains(LOCAL_YJS_META_STORE)) {
      const records = await this.list();
      return records.map((record) => ({
        key: record.key,
        bytes: record.bytes,
        lastOpenedAt: record.lastOpenedAt,
        pendingRemoteSync: record.pendingRemoteSync,
      }));
    }
    const transaction = database.transaction(LOCAL_YJS_META_STORE, "readonly");
    const meta = await requestResult(
      transaction.objectStore(LOCAL_YJS_META_STORE).getAll() as IDBRequest<LocalYjsMeta[]>,
    );
    if (meta.length) return meta;
    const records = await this.list();
    return records.map((record) => ({
      key: record.key,
      bytes: record.bytes,
      lastOpenedAt: record.lastOpenedAt,
      pendingRemoteSync: record.pendingRemoteSync,
    }));
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
    return [...this.records.values()].map((record) => ({
      key: record.key,
      bytes: record.bytes,
      lastOpenedAt: record.lastOpenedAt,
      pendingRemoteSync: record.pendingRemoteSync,
    }));
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
  private closePromise: Promise<void> | null = null;
  private snapshot: LocalDurabilitySnapshot;
  private readonly onUpdate: (update: Uint8Array, origin: unknown) => void;

  constructor(private readonly options: BoundedYjsPersistenceOptions) {
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
    this.onUpdate = (_update, origin) => {
      if (!this.initialized || origin === LOCAL_PERSISTENCE_ORIGIN) return;
      this.documentPendingRemoteSync = true;
      if (
        this.snapshot.state !== "persisting" ||
        !this.snapshot.pendingRemoteSync
      )
        this.patch({
          state: "persisting",
          pendingRemoteSync: true,
          error: undefined,
        });
      this.changeVersion += 1;
      this.dirty = true;
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
        Y.applyUpdate(this.options.document, record.update, LOCAL_PERSISTENCE_ORIGIN);
        this.documentPendingRemoteSync = record.pendingRemoteSync;
        this.snapshot = {
          state: record.pendingRemoteSync ? "local_only" : "ready",
          bytes: record.bytes,
          pendingRemoteSync: record.pendingRemoteSync,
          restored: true,
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

  markRemoteDurable() {
    if (!this.store || !this.initialized || !this.snapshot.pendingRemoteSync) return;
    this.changeVersion += 1;
    this.documentPendingRemoteSync = false;
    this.patch({ state: "ready", pendingRemoteSync: false });
    this.dirty = true;
    this.schedulePersist();
  }

  async persistNow() {
    if (!this.store || this.destroyed || !this.initialized) return;
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
    const update = Y.encodeStateAsUpdate(this.options.document);
    if (update.byteLength > this.perWorkBytes) {
      this.patch({
        state: "quota_exceeded",
        bytes: update.byteLength,
        error: "This work exceeds the mobile-safe local collaboration cache limit.",
      });
      return;
    }
    const persist = this.writeSnapshot(
      update,
      version,
      pendingRemoteSync,
      false,
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
    this.patch({ state: "ready", bytes: 0, pendingRemoteSync: false, restored: false });
  }

  destroy() {
    if (this.closePromise) return this.closePromise;
    if (this.destroyed) return Promise.resolve();
    const finalSnapshot =
      this.store && this.initialized && this.dirty
        ? {
            version: this.changeVersion,
            pendingRemoteSync: this.documentPendingRemoteSync,
            update: Y.encodeStateAsUpdate(this.options.document),
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
  ) {
    if (!this.store) return;
    if (update.byteLength > this.perWorkBytes) {
      if (!closing)
        this.patch({
          state: "quota_exceeded",
          bytes: update.byteLength,
          error: "This work exceeds the mobile-safe local collaboration cache limit.",
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
      }, { perWorkBytes: this.perWorkBytes, totalBytes: this.totalBytes, maxWorks: this.maxWorks });
      this.persistAttempts = 0;
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
        });
    } catch (error) {
      this.dirty = true;
      this.persistAttempts = Math.min(this.persistAttempts + 1, 32);
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
            : message,
        });
      if (!closing && !this.destroyed && !quotaExceeded)
        this.schedulePersist(syncRetryDelayMs(this.persistAttempts, this.options.key));
    }
  }

  private schedulePersist(delayMs = this.debounceMs) {
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
    )
      return;
    this.snapshot = next;
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}
