CREATE TABLE IF NOT EXISTS yjs_updates (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  update_blob BLOB NOT NULL,
  client_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  origin TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  sequence INTEGER PRIMARY KEY,
  state_blob BLOB NOT NULL,
  state_vector BLOB NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS room_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS structural_claims (
  claim_id TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  owner TEXT NOT NULL,
  operation_id TEXT,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projection_outbox (
  id TEXT PRIMARY KEY,
  sequence_from INTEGER NOT NULL,
  sequence_to INTEGER NOT NULL,
  projection_kind TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  status TEXT NOT NULL
);
