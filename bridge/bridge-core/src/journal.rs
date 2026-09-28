use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum OpState {
    Intent,
    Performed,
    Verified,
    Failed,
}

impl OpState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Intent => "intent",
            Self::Performed => "performed",
            Self::Verified => "verified",
            Self::Failed => "failed",
        }
    }
    fn parse(value: &str) -> anyhow::Result<Self> {
        Ok(match value {
            "intent" => Self::Intent,
            "performed" => Self::Performed,
            "verified" => Self::Verified,
            "failed" => Self::Failed,
            _ => anyhow::bail!("unknown journal state {value}"),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JournalOp {
    pub op_id: String,
    pub idempotency_key: String,
    pub kind: String,
    pub resource_id: Option<String>,
    pub state: OpState,
    pub base_revision: Option<String>,
    pub pre_hash: Option<String>,
    pub post_hash: Option<String>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueItem {
    pub id: i64,
    pub op_id: String,
    pub direction: String,
    pub payload: String,
    pub attempts: u32,
    pub available_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeAckItem {
    pub id: i64,
    pub kind: String,
    pub request_id: String,
    pub claim_generation: Option<u64>,
    pub claim_token: Option<String>,
    pub outcome: String,
    pub actual_revision: Option<String>,
    pub actual_relative_path: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub attempts: u32,
    pub available_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRecord {
    pub local_resource_id: String,
    pub grant_id: String,
    pub path_key: String,
    pub volume: Option<u64>,
    pub file_index: Option<u128>,
    pub content_hash: Option<String>,
    pub revision: Option<String>,
    pub available: bool,
    pub unavailable_reason: Option<String>,
    pub last_seen_generation: u64,
}

pub struct Journal {
    connection: Mutex<Connection>,
}

impl Journal {
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        let connection = Connection::open(path)?;
        let journal = Self {
            connection: Mutex::new(connection),
        };
        journal.migrate()?;
        Ok(journal)
    }

    pub fn in_memory() -> anyhow::Result<Self> {
        let connection = Connection::open_in_memory()?;
        let journal = Self {
            connection: Mutex::new(connection),
        };
        journal.migrate()?;
        Ok(journal)
    }

    fn migrate(&self) -> anyhow::Result<()> {
        self.connection.lock().unwrap().execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=FULL;
             CREATE TABLE IF NOT EXISTS resources (
               local_resource_id TEXT PRIMARY KEY, path_key TEXT NOT NULL,
               grant_id TEXT NOT NULL DEFAULT '',
               volume TEXT, file_index TEXT, content_hash TEXT,
               revision TEXT, available INTEGER NOT NULL DEFAULT 1,
               unavailable_reason TEXT, last_seen_generation INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS ops (
               op_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
               kind TEXT NOT NULL, resource_id TEXT, state TEXT NOT NULL,
               base_revision TEXT, pre_hash TEXT, post_hash TEXT,
               error_code TEXT, error_message TEXT, created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS queue (
               id INTEGER PRIMARY KEY AUTOINCREMENT, op_id TEXT NOT NULL,
               direction TEXT NOT NULL, payload TEXT NOT NULL,
               attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS native_ack_queue (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               ack_key TEXT NOT NULL UNIQUE,
               request_id TEXT NOT NULL,
               claim_generation INTEGER,
               claim_token TEXT,
               outcome TEXT NOT NULL,
               actual_revision TEXT,
               kind TEXT NOT NULL DEFAULT 'write',
               actual_relative_path TEXT,
               error_code TEXT,
               error_message TEXT,
               attempts INTEGER NOT NULL DEFAULT 0,
               available_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS checkpoints (
               resource_id TEXT PRIMARY KEY, last_op_id TEXT NOT NULL,
               post_hash TEXT, compacted_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS structure_targets (
               idempotency_key TEXT PRIMARY KEY, relative_path TEXT NOT NULL
             );",
        )?;
        let has_grant_id = {
            let connection = self.connection.lock().unwrap();
            let mut statement = connection.prepare("PRAGMA table_info(resources)")?;
            let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
            columns
                .collect::<Result<Vec<_>, _>>()?
                .iter()
                .any(|column| column == "grant_id")
        };
        if !has_grant_id {
            self.connection.lock().unwrap().execute(
                "ALTER TABLE resources ADD COLUMN grant_id TEXT NOT NULL DEFAULT ''",
                [],
            )?;
        }
        {
            let connection = self.connection.lock().unwrap();
            let mut statement = connection.prepare("PRAGMA table_info(native_ack_queue)")?;
            let columns = statement
                .query_map([], |row| row.get::<_, String>(1))?
                .collect::<Result<Vec<_>, _>>()?;
            if !columns.iter().any(|column| column == "kind") {
                connection.execute(
                    "ALTER TABLE native_ack_queue ADD COLUMN kind TEXT NOT NULL DEFAULT 'write'",
                    [],
                )?;
            }
            if !columns
                .iter()
                .any(|column| column == "actual_relative_path")
            {
                connection.execute(
                    "ALTER TABLE native_ack_queue ADD COLUMN actual_relative_path TEXT",
                    [],
                )?;
            }
        }
        self.connection.lock().unwrap().execute_batch(
            "CREATE INDEX IF NOT EXISTS resources_by_grant_path
               ON resources(grant_id, path_key);
             CREATE INDEX IF NOT EXISTS resources_by_grant_generation
               ON resources(grant_id, last_seen_generation);
             CREATE INDEX IF NOT EXISTS resources_by_grant_id
               ON resources(grant_id, local_resource_id);
             CREATE INDEX IF NOT EXISTS queue_by_due
               ON queue(available_at, id);
             CREATE INDEX IF NOT EXISTS native_ack_queue_by_due
               ON native_ack_queue(available_at, id);",
        )?;
        Ok(())
    }

    pub fn next_generation(&self, grant_id: &str) -> anyhow::Result<u64> {
        let key = format!("resource_generation:{grant_id}");
        let next = self
            .config(&key)?
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0)
            .saturating_add(1);
        self.set_config(&key, &next.to_string())?;
        Ok(next)
    }

    pub fn upsert_resource(&self, resource: &ResourceRecord) -> anyhow::Result<()> {
        self.connection.lock().unwrap().execute(
            "INSERT INTO resources(
               local_resource_id,grant_id,path_key,volume,file_index,content_hash,
               revision,available,unavailable_reason,last_seen_generation
             ) VALUES(?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(local_resource_id) DO UPDATE SET
               grant_id=excluded.grant_id,
               path_key=excluded.path_key,
               volume=excluded.volume,
               file_index=excluded.file_index,
               content_hash=excluded.content_hash,
               available=excluded.available,
               unavailable_reason=excluded.unavailable_reason,
               last_seen_generation=excluded.last_seen_generation",
            params![
                resource.local_resource_id,
                resource.grant_id,
                resource.path_key,
                resource.volume.map(|value| value.to_string()),
                resource.file_index.map(|value| value.to_string()),
                resource.content_hash,
                resource.revision,
                i64::from(resource.available),
                resource.unavailable_reason,
                resource.last_seen_generation as i64,
            ],
        )?;
        Ok(())
    }

    fn resource_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ResourceRecord> {
        let volume = row
            .get::<_, Option<String>>(3)?
            .and_then(|value| value.parse().ok());
        let file_index = row
            .get::<_, Option<String>>(4)?
            .and_then(|value| value.parse().ok());
        Ok(ResourceRecord {
            local_resource_id: row.get(0)?,
            grant_id: row.get(1)?,
            path_key: row.get(2)?,
            volume,
            file_index,
            content_hash: row.get(5)?,
            revision: row.get(6)?,
            available: row.get::<_, i64>(7)? != 0,
            unavailable_reason: row.get(8)?,
            last_seen_generation: row.get::<_, i64>(9)?.max(0) as u64,
        })
    }

    pub fn resource_by_id(
        &self,
        local_resource_id: &str,
    ) -> anyhow::Result<Option<ResourceRecord>> {
        Ok(self
            .connection
            .lock()
            .unwrap()
            .query_row(
                "SELECT local_resource_id,grant_id,path_key,volume,file_index,content_hash,
                    revision,available,unavailable_reason,last_seen_generation
             FROM resources WHERE local_resource_id=?",
                [local_resource_id],
                Self::resource_from_row,
            )
            .optional()?)
    }

    pub fn resource_by_path(
        &self,
        grant_id: &str,
        path_key: &str,
    ) -> anyhow::Result<Option<ResourceRecord>> {
        Ok(self
            .connection
            .lock()
            .unwrap()
            .query_row(
                "SELECT local_resource_id,grant_id,path_key,volume,file_index,content_hash,
                    revision,available,unavailable_reason,last_seen_generation
             FROM resources WHERE grant_id=? AND path_key=? LIMIT 1",
                params![grant_id, path_key],
                Self::resource_from_row,
            )
            .optional()?)
    }

    pub fn resources_for_grant(&self, grant_id: &str) -> anyhow::Result<Vec<ResourceRecord>> {
        let connection = self.connection.lock().unwrap();
        let mut statement = connection.prepare(
            "SELECT local_resource_id,grant_id,path_key,volume,file_index,content_hash,
                    revision,available,unavailable_reason,last_seen_generation
             FROM resources WHERE grant_id=? ORDER BY path_key",
        )?;
        let rows = statement.query_map([grant_id], Self::resource_from_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Keyset page for periodic lock probes. Never load the whole mount just
    /// to inspect a prefix, and keep the cursor stable across file renames.
    pub fn resource_probe_page(
        &self,
        grant_id: &str,
        after_resource_id: Option<&str>,
        limit: usize,
    ) -> anyhow::Result<Vec<ResourceRecord>> {
        let connection = self.connection.lock().unwrap();
        let mut statement = connection.prepare(
            "SELECT local_resource_id,grant_id,path_key,volume,file_index,content_hash,
                    revision,available,unavailable_reason,last_seen_generation
             FROM resources WHERE grant_id=? AND local_resource_id>?
             ORDER BY local_resource_id LIMIT ?",
        )?;
        let rows = statement.query_map(
            params![
                grant_id,
                after_resource_id.unwrap_or(""),
                limit.clamp(1, 500) as i64
            ],
            Self::resource_from_row,
        )?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn resources_with_path_prefix(
        &self,
        grant_id: &str,
        path_prefix: &str,
    ) -> anyhow::Result<Vec<ResourceRecord>> {
        let exact = path_prefix.trim_end_matches('/');
        let prefix = format!("{exact}/%");
        let connection = self.connection.lock().unwrap();
        let mut statement = connection.prepare(
            "SELECT local_resource_id,grant_id,path_key,volume,file_index,content_hash,
                    revision,available,unavailable_reason,last_seen_generation
             FROM resources
             WHERE grant_id=? AND (path_key=? OR path_key LIKE ?)
             ORDER BY path_key",
        )?;
        let rows =
            statement.query_map(params![grant_id, exact, prefix], Self::resource_from_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn mark_resource_unavailable(
        &self,
        local_resource_id: &str,
        reason: &str,
        generation: u64,
    ) -> anyhow::Result<()> {
        self.connection.lock().unwrap().execute(
            "UPDATE resources SET available=0, unavailable_reason=?, last_seen_generation=?
             WHERE local_resource_id=?",
            params![reason, generation as i64, local_resource_id],
        )?;
        Ok(())
    }

    pub fn mark_resource_reported(
        &self,
        local_resource_id: &str,
        revision: Option<&str>,
    ) -> anyhow::Result<()> {
        self.connection.lock().unwrap().execute(
            "UPDATE resources SET revision=COALESCE(?,revision) WHERE local_resource_id=?",
            params![revision, local_resource_id],
        )?;
        Ok(())
    }

    pub fn begin_intent(
        &self,
        key: &str,
        kind: &str,
        resource_id: Option<&str>,
        base_revision: Option<&str>,
        pre_hash: Option<&str>,
    ) -> anyhow::Result<JournalOp> {
        if let Some(existing) = self.by_key(key)? {
            return Ok(existing);
        }
        let now = unix_ms();
        let op_id = format!("op_{}", uuid::Uuid::new_v4().simple());
        self.connection.lock().unwrap().execute(
            "INSERT INTO ops(op_id,idempotency_key,kind,resource_id,state,base_revision,pre_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
            params![op_id, key, kind, resource_id, OpState::Intent.as_str(), base_revision, pre_hash, now, now],
        )?;
        self.by_key(key)?
            .ok_or_else(|| anyhow::anyhow!("inserted intent missing"))
    }

    pub fn transition(
        &self,
        op_id: &str,
        state: OpState,
        post_hash: Option<&str>,
        error: Option<(&str, &str)>,
    ) -> anyhow::Result<()> {
        let changed = self.connection.lock().unwrap().execute(
            "UPDATE ops SET state=?, post_hash=COALESCE(?,post_hash), error_code=?, error_message=?, updated_at=? WHERE op_id=?",
            params![state.as_str(), post_hash, error.map(|e| e.0), error.map(|e| e.1), unix_ms(), op_id],
        )?;
        anyhow::ensure!(changed == 1, "journal op not found");
        Ok(())
    }

    pub fn by_key(&self, key: &str) -> anyhow::Result<Option<JournalOp>> {
        let connection = self.connection.lock().unwrap();
        connection.query_row(
            "SELECT op_id,idempotency_key,kind,resource_id,state,base_revision,pre_hash,post_hash,error_code FROM ops WHERE idempotency_key=?",
            [key], |row| Ok(JournalOp { op_id: row.get(0)?, idempotency_key: row.get(1)?, kind: row.get(2)?, resource_id: row.get(3)?, state: OpState::parse(&row.get::<_, String>(4)?).map_err(|_| rusqlite::Error::InvalidQuery)?, base_revision: row.get(5)?, pre_hash: row.get(6)?, post_hash: row.get(7)?, error_code: row.get(8)? })
        ).optional().map_err(Into::into)
    }

    pub fn pending_ops(&self) -> anyhow::Result<Vec<JournalOp>> {
        let connection = self.connection.lock().unwrap();
        let mut statement = connection.prepare("SELECT op_id,idempotency_key,kind,resource_id,state,base_revision,pre_hash,post_hash,error_code FROM ops WHERE state IN ('intent','performed') ORDER BY created_at")?;
        let rows = statement.query_map([], |row| {
            Ok(JournalOp {
                op_id: row.get(0)?,
                idempotency_key: row.get(1)?,
                kind: row.get(2)?,
                resource_id: row.get(3)?,
                state: OpState::parse(&row.get::<_, String>(4)?)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?,
                base_revision: row.get(5)?,
                pre_hash: row.get(6)?,
                post_hash: row.get(7)?,
                error_code: row.get(8)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn diagnostic_log(&self, limit: usize) -> anyhow::Result<String> {
        let connection = self.connection.lock().unwrap();
        let mut statement = connection.prepare("SELECT op_id,idempotency_key,kind,resource_id,state,base_revision,pre_hash,post_hash,error_code FROM ops ORDER BY updated_at DESC LIMIT ?")?;
        let rows = statement.query_map([limit.clamp(1, 2_000) as i64], |row| {
            Ok(JournalOp {
                op_id: row.get(0)?,
                idempotency_key: row.get(1)?,
                kind: row.get(2)?,
                resource_id: row.get(3)?,
                state: OpState::parse(&row.get::<_, String>(4)?)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?,
                base_revision: row.get(5)?,
                pre_hash: row.get(6)?,
                post_hash: row.get(7)?,
                error_code: row.get(8)?,
            })
        })?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|row| serde_json::to_string(&row))
            .collect::<Result<Vec<_>, _>>()?
            .join("\n"))
    }

    pub fn compact_verified(&self, older_than_ms: i64) -> anyhow::Result<usize> {
        let mut connection = self.connection.lock().unwrap();
        let tx = connection.transaction()?;
        tx.execute(
            "INSERT OR REPLACE INTO checkpoints(resource_id,last_op_id,post_hash,compacted_at)
             SELECT resource_id, op_id, post_hash, ? FROM ops
             WHERE state='verified' AND updated_at < ? AND resource_id IS NOT NULL
             GROUP BY resource_id HAVING updated_at=MAX(updated_at)",
            params![unix_ms(), older_than_ms],
        )?;
        let removed = tx.execute(
            "DELETE FROM ops WHERE state='verified' AND updated_at < ?",
            [older_than_ms],
        )?;
        tx.commit()?;
        Ok(removed)
    }

    pub fn set_config(&self, key: &str, value: &str) -> anyhow::Result<()> {
        self.connection.lock().unwrap().execute(
            "INSERT OR REPLACE INTO config(key,value) VALUES(?,?)",
            params![key, value],
        )?;
        Ok(())
    }

    /// The collision-resolved destination is part of a move's durable intent.
    pub fn reserve_structure_target(
        &self,
        key: &str,
        relative_path: &str,
    ) -> anyhow::Result<String> {
        let connection = self.connection.lock().unwrap();
        connection.execute(
            "INSERT OR IGNORE INTO structure_targets(idempotency_key,relative_path) VALUES(?,?)",
            params![key, relative_path],
        )?;
        Ok(connection.query_row(
            "SELECT relative_path FROM structure_targets WHERE idempotency_key=?",
            [key],
            |row| row.get(0),
        )?)
    }
    pub fn config(&self, key: &str) -> anyhow::Result<Option<String>> {
        Ok(self
            .connection
            .lock()
            .unwrap()
            .query_row("SELECT value FROM config WHERE key=?", [key], |row| {
                row.get(0)
            })
            .optional()?)
    }
    pub fn delete_config(&self, key: &str) -> anyhow::Result<()> {
        self.connection
            .lock()
            .unwrap()
            .execute("DELETE FROM config WHERE key=?", [key])?;
        Ok(())
    }

    pub fn config_prefix(&self, prefix: &str) -> anyhow::Result<Vec<(String, String)>> {
        let connection = self.connection.lock().unwrap();
        let mut statement =
            connection.prepare("SELECT key,value FROM config WHERE key LIKE ? ORDER BY key")?;
        let rows =
            statement.query_map([format!("{prefix}%")], |row| Ok((row.get(0)?, row.get(1)?)))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn enqueue(&self, op_id: &str, direction: &str, payload: &str) -> anyhow::Result<()> {
        self.connection.lock().unwrap().execute(
            "INSERT INTO queue(op_id,direction,payload,available_at)
             SELECT ?,?,?,? WHERE NOT EXISTS(
               SELECT 1 FROM queue WHERE op_id=? AND direction=?
             )",
            params![op_id, direction, payload, unix_ms(), op_id, direction],
        )?;
        Ok(())
    }
    pub fn due_queue(&self, limit: usize) -> anyhow::Result<Vec<QueueItem>> {
        let connection = self.connection.lock().unwrap();
        let mut statement = connection.prepare("SELECT id,op_id,direction,payload,attempts,available_at FROM queue WHERE available_at <= ? OR available_at > ? ORDER BY id LIMIT ?")?;
        let (now, horizon) = due_window();
        let rows =
            statement.query_map(params![now, horizon, limit.clamp(1, 500) as i64], |row| {
                Ok(QueueItem {
                    id: row.get(0)?,
                    op_id: row.get(1)?,
                    direction: row.get(2)?,
                    payload: row.get(3)?,
                    attempts: row.get(4)?,
                    available_at: row.get(5)?,
                })
            })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }
    pub fn acknowledge_queue(&self, id: i64) -> anyhow::Result<()> {
        self.connection
            .lock()
            .unwrap()
            .execute("DELETE FROM queue WHERE id=?", [id])?;
        Ok(())
    }

    /// Persist a native completion before making its network acknowledgement.
    /// The key includes the claim lease so a replay from an expired worker can
    /// never be mistaken for the current claim.
    pub fn enqueue_native_ack(
        &self,
        request_id: &str,
        claim_generation: Option<u64>,
        claim_token: Option<&str>,
        outcome: &str,
        actual_revision: Option<&str>,
        error: Option<(&str, &str)>,
    ) -> anyhow::Result<()> {
        let ack_key = format!(
            "{request_id}:{}:{}",
            claim_generation.unwrap_or(0),
            claim_token.unwrap_or("legacy")
        );
        self.connection.lock().unwrap().execute(
            "INSERT OR IGNORE INTO native_ack_queue(
               ack_key,request_id,claim_generation,claim_token,outcome,
               actual_revision,error_code,error_message,available_at
             ) VALUES(?,?,?,?,?,?,?,?,?)",
            params![
                ack_key,
                request_id,
                claim_generation.map(|value| value as i64),
                claim_token,
                outcome,
                actual_revision,
                error.map(|value| value.0),
                error.map(|value| value.1),
                unix_ms(),
            ],
        )?;
        Ok(())
    }

    pub fn due_native_acks(&self, limit: usize) -> anyhow::Result<Vec<NativeAckItem>> {
        let connection = self.connection.lock().unwrap();
        let mut statement = connection.prepare(
            "SELECT id,request_id,claim_generation,claim_token,outcome,
                    actual_revision,error_code,error_message,attempts,available_at,kind,actual_relative_path
             FROM native_ack_queue WHERE available_at <= ? OR available_at > ?
             ORDER BY id LIMIT ?",
        )?;
        let (now, horizon) = due_window();
        let rows =
            statement.query_map(params![now, horizon, limit.clamp(1, 500) as i64], |row| {
                Ok(NativeAckItem {
                    id: row.get(0)?,
                    kind: row.get(10)?,
                    request_id: row.get(1)?,
                    claim_generation: row
                        .get::<_, Option<i64>>(2)?
                        .map(|value| value.max(0) as u64),
                    claim_token: row.get(3)?,
                    outcome: row.get(4)?,
                    actual_revision: row.get(5)?,
                    actual_relative_path: row.get(11)?,
                    error_code: row.get(6)?,
                    error_message: row.get(7)?,
                    attempts: row.get::<_, i64>(8)?.max(0) as u32,
                    available_at: row.get(9)?,
                })
            })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn enqueue_structure_ack(
        &self,
        request_id: &str,
        claim_generation: Option<u64>,
        claim_token: Option<&str>,
        outcome: &str,
        actual_relative_path: Option<&str>,
        error: Option<(&str, &str)>,
    ) -> anyhow::Result<()> {
        let key = format!(
            "structure:{request_id}:{}:{}",
            claim_generation.unwrap_or(0),
            claim_token.unwrap_or("legacy")
        );
        self.connection.lock().unwrap().execute(
            "INSERT OR IGNORE INTO native_ack_queue(
               ack_key,request_id,claim_generation,claim_token,outcome,
               actual_relative_path,error_code,error_message,available_at,kind
             ) VALUES(?,?,?,?,?,?,?,?,?,'structure')",
            params![
                key,
                request_id,
                claim_generation.map(|value| value as i64),
                claim_token,
                outcome,
                actual_relative_path,
                error.map(|value| value.0),
                error.map(|value| value.1),
                unix_ms()
            ],
        )?;
        Ok(())
    }

    pub fn acknowledge_native_ack(&self, id: i64) -> anyhow::Result<()> {
        self.connection
            .lock()
            .unwrap()
            .execute("DELETE FROM native_ack_queue WHERE id=?", [id])?;
        Ok(())
    }

    pub fn retry_native_ack(&self, id: i64, delay: Duration) -> anyhow::Result<()> {
        self.connection.lock().unwrap().execute(
            "UPDATE native_ack_queue SET attempts=attempts+1, available_at=? WHERE id=?",
            params![unix_ms() + delay.as_millis() as i64, id],
        )?;
        Ok(())
    }

    pub fn acknowledge_change(
        &self,
        item: &QueueItem,
        resource_id: &str,
        post_hash: Option<&str>,
    ) -> anyhow::Result<()> {
        let mut connection = self.connection.lock().unwrap();
        let tx = connection.transaction()?;
        tx.execute(
            "UPDATE ops SET state='verified', post_hash=COALESCE(?,post_hash),
                    error_code=NULL, error_message=NULL, updated_at=?
             WHERE op_id=?",
            params![post_hash, unix_ms(), item.op_id],
        )?;
        tx.execute(
            "UPDATE resources SET revision=COALESCE(?,revision)
             WHERE local_resource_id=?",
            params![post_hash, resource_id],
        )?;
        tx.execute("DELETE FROM queue WHERE id=?", [item.id])?;
        tx.commit()?;
        Ok(())
    }
    pub fn fail_queue(&self, item: &QueueItem, code: &str, message: &str) -> anyhow::Result<()> {
        let mut connection = self.connection.lock().unwrap();
        let tx = connection.transaction()?;
        tx.execute(
            "UPDATE ops SET state='failed', error_code=?, error_message=?, updated_at=?
             WHERE op_id=?",
            params![code, message, unix_ms(), item.op_id],
        )?;
        tx.execute("DELETE FROM queue WHERE id=?", [item.id])?;
        tx.commit()?;
        Ok(())
    }
    pub fn retry_queue(&self, id: i64, delay: Duration) -> anyhow::Result<()> {
        self.connection.lock().unwrap().execute(
            "UPDATE queue SET attempts=attempts+1, available_at=? WHERE id=?",
            params![unix_ms() + delay.as_millis() as i64, id],
        )?;
        Ok(())
    }
}

/// Rows are due at or before now, or when scheduled beyond any retry delay
/// the Bridge can choose (the wall clock was set back after scheduling).
fn due_window() -> (i64, i64) {
    let now = unix_ms();
    (
        now,
        now.saturating_add(crate::retry::retry_schedule_horizon().as_millis() as i64),
    )
}

fn unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intent_is_durable_and_idempotency_reuses_the_same_op() {
        let journal = Journal::in_memory().unwrap();
        let first = journal
            .begin_intent("same", "write", Some("r1"), Some("base"), None)
            .unwrap();
        let replay = journal
            .begin_intent("same", "write", Some("r1"), Some("base"), None)
            .unwrap();
        assert_eq!(first.op_id, replay.op_id);
        assert_eq!(journal.pending_ops().unwrap().len(), 1);
    }

    #[test]
    fn verified_transition_records_post_hash() {
        let journal = Journal::in_memory().unwrap();
        let op = journal
            .begin_intent("k", "write", None, None, None)
            .unwrap();
        journal
            .transition(&op.op_id, OpState::Performed, Some("hash"), None)
            .unwrap();
        journal
            .transition(&op.op_id, OpState::Verified, Some("hash"), None)
            .unwrap();
        let found = journal.by_key("k").unwrap().unwrap();
        assert_eq!(found.state, OpState::Verified);
        assert_eq!(found.post_hash.as_deref(), Some("hash"));
    }

    #[test]
    fn structure_receipts_survive_restart_and_keep_the_first_result_for_each_lease() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("journal.sqlite");
        {
            let journal = Journal::open(&path).unwrap();
            journal
                .enqueue_structure_ack(
                    "move-1",
                    Some(1),
                    Some("first"),
                    "verified",
                    Some("renamed.docx"),
                    None,
                )
                .unwrap();
            journal
                .enqueue_structure_ack(
                    "move-1",
                    Some(1),
                    Some("first"),
                    "failed",
                    None,
                    Some(("late", "late error")),
                )
                .unwrap();
            journal
                .enqueue_structure_ack(
                    "move-1",
                    Some(2),
                    Some("second"),
                    "waiting",
                    None,
                    Some(("office-locked", "locked")),
                )
                .unwrap();
            journal
                .enqueue_native_ack(
                    "write-1",
                    Some(1),
                    Some("write"),
                    "verified",
                    Some("hash"),
                    None,
                )
                .unwrap();
        }
        let journal = Journal::open(&path).unwrap();
        let acks = journal.due_native_acks(10).unwrap();
        assert_eq!(acks.len(), 3);
        assert_eq!(acks[0].kind, "structure");
        assert_eq!(acks[0].outcome, "verified");
        assert_eq!(
            acks[0].actual_relative_path.as_deref(),
            Some("renamed.docx")
        );
        assert_eq!(acks[1].claim_generation, Some(2));
        assert_eq!(acks[2].kind, "write");
        assert_eq!(acks[2].actual_revision.as_deref(), Some("hash"));
        journal
            .retry_native_ack(acks[0].id, Duration::from_secs(60))
            .unwrap();
        assert_eq!(journal.due_native_acks(10).unwrap().len(), 2);
    }

    #[test]
    fn upgrading_a_legacy_ack_queue_preserves_pending_byte_receipts() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("legacy.sqlite");
        {
            let connection = Connection::open(&path).unwrap();
            connection.execute_batch("CREATE TABLE native_ack_queue (
                id INTEGER PRIMARY KEY, ack_key TEXT UNIQUE, request_id TEXT, claim_generation INTEGER,
                claim_token TEXT, outcome TEXT, actual_revision TEXT, error_code TEXT, error_message TEXT,
                attempts INTEGER DEFAULT 0, available_at INTEGER);
                INSERT INTO native_ack_queue(id,ack_key,request_id,outcome,actual_revision,available_at)
                VALUES(1,'legacy','write-legacy','verified','old-hash',0);").unwrap();
        }
        let journal = Journal::open(&path).unwrap();
        let acks = journal.due_native_acks(10).unwrap();
        assert_eq!(acks.len(), 1);
        assert_eq!(acks[0].kind, "write");
        assert_eq!(acks[0].actual_revision.as_deref(), Some("old-hash"));
        assert!(acks[0].actual_relative_path.is_none());
    }

    #[test]
    fn lock_probe_pages_cover_later_resources_without_loading_the_mount() {
        let journal = Journal::in_memory().unwrap();
        for index in 0..751 {
            journal
                .upsert_resource(&ResourceRecord {
                    local_resource_id: format!("lr_{index:04}"),
                    grant_id: if index == 750 { "other" } else { "mount" }.into(),
                    path_key: format!("{index}.docx"),
                    volume: None,
                    file_index: None,
                    content_hash: None,
                    revision: None,
                    available: true,
                    unavailable_reason: None,
                    last_seen_generation: 1,
                })
                .unwrap();
        }
        let mut cursor = None;
        let mut seen = Vec::new();
        loop {
            let page = journal
                .resource_probe_page("mount", cursor.as_deref(), 100)
                .unwrap();
            assert!(page.len() <= 100);
            cursor = page
                .last()
                .map(|resource| resource.local_resource_id.clone());
            let done = page.len() < 100;
            seen.extend(page.into_iter().map(|resource| resource.local_resource_id));
            if done {
                break;
            }
        }
        assert_eq!(seen.len(), 750);
        assert_eq!(seen.last().map(String::as_str), Some("lr_0749"));
        assert_eq!(
            seen.iter().collect::<std::collections::HashSet<_>>().len(),
            750
        );
        let first = journal.resource_probe_page("mount", None, 100).unwrap();
        assert_eq!(first[0].local_resource_id, "lr_0000");
    }

    #[test]
    fn resource_identity_survives_rename_and_restart() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("journal.sqlite");
        {
            let journal = Journal::open(&path).unwrap();
            journal
                .upsert_resource(&ResourceRecord {
                    local_resource_id: "lr_stable".into(),
                    grant_id: "grant_one".into(),
                    path_key: "before/report.docx".into(),
                    volume: Some(7),
                    file_index: Some(42),
                    content_hash: Some("a".repeat(64)),
                    revision: Some("a".repeat(64)),
                    available: true,
                    unavailable_reason: None,
                    last_seen_generation: 1,
                })
                .unwrap();
            let mut renamed = journal.resource_by_id("lr_stable").unwrap().unwrap();
            renamed.path_key = "after/report.docx".into();
            renamed.last_seen_generation = 2;
            journal.upsert_resource(&renamed).unwrap();
        }
        let reopened = Journal::open(&path).unwrap();
        assert!(
            reopened
                .resource_by_path("grant_one", "before/report.docx")
                .unwrap()
                .is_none()
        );
        assert_eq!(
            reopened
                .resource_by_path("grant_one", "after/report.docx")
                .unwrap()
                .unwrap()
                .local_resource_id,
            "lr_stable"
        );
    }

    #[test]
    fn outbound_change_is_deduplicated_and_acknowledged_atomically() {
        let journal = Journal::in_memory().unwrap();
        let op = journal
            .begin_intent(
                "derived-change",
                "cloud.report-change",
                Some("lr_1"),
                Some("old"),
                None,
            )
            .unwrap();
        journal.enqueue(&op.op_id, "outbound-change", "{}").unwrap();
        journal.enqueue(&op.op_id, "outbound-change", "{}").unwrap();
        let queued = journal.due_queue(10).unwrap();
        assert_eq!(queued.len(), 1);
        journal
            .acknowledge_change(&queued[0], "lr_1", Some("new"))
            .unwrap();
        assert!(journal.due_queue(10).unwrap().is_empty());
        assert_eq!(
            journal.by_key("derived-change").unwrap().unwrap().state,
            OpState::Verified
        );
    }

    #[test]
    fn native_ack_queue_is_deduplicated_by_claim_lease_and_retriable() {
        let journal = Journal::in_memory().unwrap();
        journal
            .enqueue_native_ack(
                "request-a",
                Some(3),
                Some("claim-c"),
                "verified",
                Some("hash-b"),
                None,
            )
            .unwrap();
        journal
            .enqueue_native_ack(
                "request-a",
                Some(3),
                Some("claim-c"),
                "verified",
                Some("hash-b"),
                None,
            )
            .unwrap();
        let queued = journal.due_native_acks(10).unwrap();
        assert_eq!(queued.len(), 1);
        assert_eq!(queued[0].claim_generation, Some(3));
        assert_eq!(queued[0].claim_token.as_deref(), Some("claim-c"));
        journal
            .retry_native_ack(queued[0].id, Duration::from_secs(60))
            .unwrap();
        assert!(journal.due_native_acks(10).unwrap().is_empty());
        journal.acknowledge_native_ack(queued[0].id).unwrap();
        assert!(journal.due_native_acks(10).unwrap().is_empty());
    }

    #[test]
    fn retries_scheduled_before_the_clock_was_set_back_stay_due() {
        let journal = Journal::in_memory().unwrap();
        journal.enqueue("op-a", "outbound-change", "{}").unwrap();
        journal
            .enqueue_native_ack("request-a", Some(1), Some("claim"), "verified", None, None)
            .unwrap();
        let change = journal.due_queue(10).unwrap().remove(0);
        let ack = journal.due_native_acks(10).unwrap().remove(0);
        journal
            .retry_queue(change.id, Duration::from_secs(30))
            .unwrap();
        journal
            .retry_native_ack(ack.id, Duration::from_secs(30))
            .unwrap();
        assert!(journal.due_queue(10).unwrap().is_empty());
        assert!(journal.due_native_acks(10).unwrap().is_empty());
        // The retry was scheduled while the wall clock ran a day ahead. Once
        // the clock is corrected the rows must not wait out the whole day.
        let skewed = unix_ms() + 24 * 60 * 60 * 1_000;
        {
            let connection = journal.connection.lock().unwrap();
            connection
                .execute("UPDATE queue SET available_at=?", [skewed])
                .unwrap();
            connection
                .execute("UPDATE native_ack_queue SET available_at=?", [skewed])
                .unwrap();
        }
        assert_eq!(journal.due_queue(10).unwrap().len(), 1);
        assert_eq!(journal.due_native_acks(10).unwrap().len(), 1);
    }

    #[test]
    fn scheduled_compaction_keeps_only_the_resource_checkpoint() {
        let journal = Journal::in_memory().unwrap();
        let operation = journal
            .begin_intent(
                "compact-me",
                "cloud.report-change",
                Some("lr_1"),
                None,
                None,
            )
            .unwrap();
        journal
            .transition(&operation.op_id, OpState::Verified, Some("hash"), None)
            .unwrap();
        assert_eq!(journal.compact_verified(unix_ms() + 1).unwrap(), 1);
        assert!(journal.by_key("compact-me").unwrap().is_none());
    }
}
