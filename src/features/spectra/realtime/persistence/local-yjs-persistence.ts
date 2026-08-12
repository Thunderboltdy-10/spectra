import * as Y from "yjs";

// room-v1 begins with the server-authored native baseline protocol. Earlier
// caches may
// contain independently initialized Yjs identities, so replaying them into a
// canonical room can duplicate document blocks and structured collections.
export const LOCAL_YJS_DATABASE = "spectra-yjs-room-v1";
export const LOCAL_YJS_STORE = "work-updates";
export const LOCAL_PERSISTENCE_ORIGIN = Symbol("spectra-local-persistence");

export type LocalYjsRecord = {
  key: string;
  update: Uint8Array;
  bytes: number;
  updatedAt: number;
  lastOpenedAt: number;
  pendingRemoteSync: boolean;
  modelVersion: number;
};

export interface LocalYjsStore {
  get(key: string): Promise<LocalYjsRecord | null>;
  put(record: LocalYjsRecord): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<LocalYjsRecord[]>;
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

export class IndexedDbYjsStore implements LocalYjsStore {
  private database: Promise<IDBDatabase> | null = null;

  private open() {
    if (this.database) return this.database;
    this.database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(LOCAL_YJS_DATABASE, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(LOCAL_YJS_STORE))
          database.createObjectStore(LOCAL_YJS_STORE, { keyPath: "key" });
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
    const transaction = database.transaction(LOCAL_YJS_STORE, "readwrite");
    await requestResult(transaction.objectStore(LOCAL_YJS_STORE).put(record));
  }

  async delete(key: string) {
    const database = await this.open();
    const transaction = database.transaction(LOCAL_YJS_STORE, "readwrite");
    await requestResult(transaction.objectStore(LOCAL_YJS_STORE).delete(key));
  }

  async list() {
    const database = await this.open();
    const transaction = database.transaction(LOCAL_YJS_STORE, "readonly");
    return requestResult(
      transaction.objectStore(LOCAL_YJS_STORE).getAll() as IDBRequest<LocalYjsRecord[]>,
    );
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

  async delete(key: string) {
    this.records.delete(key);
  }

  async list() {
    return [...this.records.values()].map((record) => ({ ...record, update: record.update.slice() }));
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
      this.patch({ state: "persisting", pendingRemoteSync: true });
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
      const record = await this.store.get(this.options.key);
      if (record?.update?.length) {
        Y.applyUpdate(this.options.document, record.update, LOCAL_PERSISTENCE_ORIGIN);
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
    this.patch({ state: "ready", pendingRemoteSync: false });
    this.schedulePersist();
  }

  async persistNow() {
    if (!this.store || this.destroyed || !this.initialized) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const update = Y.encodeStateAsUpdate(this.options.document);
    if (update.byteLength > this.perWorkBytes) {
      this.patch({
        state: "quota_exceeded",
        bytes: update.byteLength,
        error: "This work exceeds the mobile-safe local collaboration cache limit.",
      });
      return;
    }
    try {
      const timestamp = this.now();
      await this.evictFor(update.byteLength);
      await this.store.put({
        key: this.options.key,
        update,
        bytes: update.byteLength,
        updatedAt: timestamp,
        lastOpenedAt: timestamp,
        pendingRemoteSync: this.snapshot.pendingRemoteSync,
        modelVersion: this.options.modelVersion,
      });
      this.patch({
        state: this.snapshot.pendingRemoteSync ? "local_only" : "ready",
        bytes: update.byteLength,
        error: undefined,
      });
    } catch (error) {
      this.patch({
        state: "error",
        error: error instanceof Error ? error.message : "Local collaboration cache failed.",
      });
    }
  }

  async clear() {
    if (!this.store) return;
    await this.store.delete(this.options.key);
    this.patch({ state: "ready", bytes: 0, pendingRemoteSync: false, restored: false });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.options.document.off("update", this.onUpdate);
    this.snapshot = { ...this.snapshot, state: "closed" };
    this.emit();
    this.listeners.clear();
  }

  private schedulePersist() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.persistNow();
    }, this.debounceMs);
  }

  private async evictFor(nextBytes: number) {
    if (!this.store) return;
    const records = (await this.store.list())
      .filter((record) => record.key !== this.options.key)
      .sort((left, right) => left.lastOpenedAt - right.lastOpenedAt);
    let total = records.reduce((sum, record) => sum + record.bytes, 0) + nextBytes;
    let count = records.length + 1;
    for (const record of records) {
      if (total <= this.totalBytes && count <= this.maxWorks) break;
      if (record.pendingRemoteSync) continue;
      await this.store.delete(record.key);
      total -= record.bytes;
      count -= 1;
    }
    if (total > this.totalBytes || count > this.maxWorks)
      throw new Error("LOCAL_YJS_QUOTA_RESERVED_FOR_PENDING_CHANGES");
  }

  private patch(patch: Partial<LocalDurabilitySnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}
