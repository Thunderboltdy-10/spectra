export type StoredUpdate = {
  sequence: number;
  update: Uint8Array;
  clientId: string;
  actorKind: "human" | "ai" | "system";
  origin: string;
  createdAt: number;
};

export type StoredSnapshot = {
  sequence: number;
  state: Uint8Array;
  stateVector: Uint8Array;
  schemaVersion: number;
  createdAt: number;
};

export type ProjectionOutboxItem = {
  id: string;
  sequenceFrom: number;
  sequenceTo: number;
  projectionKind: string;
  attempts: number;
  nextAttemptAt: number;
  status: "pending" | "processing" | "completed";
};

export interface YDocStore {
  loadLatestSnapshot(): Promise<StoredSnapshot | null>;
  loadUpdatesAfter(sequence: number): Promise<StoredUpdate[]>;
  appendUpdate(update: Omit<StoredUpdate, "sequence">): Promise<number>;
  saveSnapshot(snapshot: StoredSnapshot): Promise<void>;
  deleteUpdatesThrough(sequence: number): Promise<void>;
  enqueueProjection(item: ProjectionOutboxItem): Promise<void>;
  dueProjections(now: number): Promise<ProjectionOutboxItem[]>;
  updateProjection(item: ProjectionOutboxItem): Promise<void>;
}

export class MemoryYDocStore implements YDocStore {
  updates: StoredUpdate[] = [];
  snapshots: StoredSnapshot[] = [];
  outbox = new Map<string, ProjectionOutboxItem>();

  async loadLatestSnapshot() {
    return this.snapshots.at(-1) ?? null;
  }

  async loadUpdatesAfter(sequence: number) {
    return this.updates.filter((update) => update.sequence > sequence);
  }

  async appendUpdate(update: Omit<StoredUpdate, "sequence">) {
    const sequence = (this.updates.at(-1)?.sequence ?? this.snapshots.at(-1)?.sequence ?? 0) + 1;
    this.updates.push({ ...update, sequence });
    return sequence;
  }

  async saveSnapshot(snapshot: StoredSnapshot) {
    this.snapshots.push(snapshot);
    this.snapshots.sort((left, right) => left.sequence - right.sequence);
  }

  async deleteUpdatesThrough(sequence: number) {
    this.updates = this.updates.filter((update) => update.sequence > sequence);
  }

  async enqueueProjection(item: ProjectionOutboxItem) {
    if (!this.outbox.has(item.id)) this.outbox.set(item.id, item);
  }

  async dueProjections(now: number) {
    return [...this.outbox.values()].filter(
      (item) => item.status === "pending" && item.nextAttemptAt <= now,
    );
  }

  async updateProjection(item: ProjectionOutboxItem) {
    this.outbox.set(item.id, item);
  }
}

function first<T>(rows: Iterable<T>) {
  return [...rows][0];
}

export class SqlYDocStore implements YDocStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  async loadLatestSnapshot() {
    const row = first<{
      sequence: number;
      state_blob: ArrayBuffer;
      state_vector: ArrayBuffer;
      schema_version: number;
      created_at: number;
    }>(
      this.storage.sql.exec(
        "SELECT sequence,state_blob,state_vector,schema_version,created_at FROM snapshots ORDER BY sequence DESC LIMIT 1",
      ),
    );
    return row
      ? {
          sequence: row.sequence,
          state: new Uint8Array(row.state_blob),
          stateVector: new Uint8Array(row.state_vector),
          schemaVersion: row.schema_version,
          createdAt: row.created_at,
        }
      : null;
  }

  async loadUpdatesAfter(sequence: number) {
    return [
      ...this.storage.sql.exec<{
        sequence: number;
        update_blob: ArrayBuffer;
        client_id: string;
        actor_kind: "human" | "ai" | "system";
        origin: string;
        created_at: number;
      }>(
        "SELECT sequence,update_blob,client_id,actor_kind,origin,created_at FROM yjs_updates WHERE sequence > ? ORDER BY sequence",
        sequence,
      ),
    ].map((row) => ({
      sequence: row.sequence,
      update: new Uint8Array(row.update_blob),
      clientId: row.client_id,
      actorKind: row.actor_kind,
      origin: row.origin,
      createdAt: row.created_at,
    }));
  }

  async appendUpdate(update: Omit<StoredUpdate, "sequence">) {
    this.storage.sql.exec(
      "INSERT INTO yjs_updates(update_blob,client_id,actor_kind,origin,created_at) VALUES(?,?,?,?,?)",
      update.update,
      update.clientId,
      update.actorKind,
      update.origin,
      update.createdAt,
    );
    const row = first<{ sequence: number }>(
      this.storage.sql.exec("SELECT last_insert_rowid() AS sequence"),
    );
    return Number(row?.sequence ?? 0);
  }

  async saveSnapshot(snapshot: StoredSnapshot) {
    this.storage.sql.exec(
      "INSERT OR REPLACE INTO snapshots(sequence,state_blob,state_vector,schema_version,created_at) VALUES(?,?,?,?,?)",
      snapshot.sequence,
      snapshot.state,
      snapshot.stateVector,
      snapshot.schemaVersion,
      snapshot.createdAt,
    );
  }

  async deleteUpdatesThrough(sequence: number) {
    this.storage.sql.exec("DELETE FROM yjs_updates WHERE sequence <= ?", sequence);
  }

  async enqueueProjection(item: ProjectionOutboxItem) {
    this.storage.sql.exec(
      "INSERT OR IGNORE INTO projection_outbox(id,sequence_from,sequence_to,projection_kind,attempts,next_attempt_at,status) VALUES(?,?,?,?,?,?,?)",
      item.id,
      item.sequenceFrom,
      item.sequenceTo,
      item.projectionKind,
      item.attempts,
      item.nextAttemptAt,
      item.status,
    );
  }

  async dueProjections(now: number) {
    return [
      ...this.storage.sql.exec<{
        id: string;
        sequence_from: number;
        sequence_to: number;
        projection_kind: string;
        attempts: number;
        next_attempt_at: number;
        status: "pending" | "processing" | "completed";
      }>(
        "SELECT * FROM projection_outbox WHERE status='pending' AND next_attempt_at <= ? ORDER BY next_attempt_at",
        now,
      ),
    ].map((row) => ({
      id: row.id,
      sequenceFrom: row.sequence_from,
      sequenceTo: row.sequence_to,
      projectionKind: row.projection_kind,
      attempts: row.attempts,
      nextAttemptAt: row.next_attempt_at,
      status: row.status,
    }));
  }

  async updateProjection(item: ProjectionOutboxItem) {
    this.storage.sql.exec(
      "UPDATE projection_outbox SET attempts=?,next_attempt_at=?,status=? WHERE id=?",
      item.attempts,
      item.nextAttemptAt,
      item.status,
      item.id,
    );
  }
}
