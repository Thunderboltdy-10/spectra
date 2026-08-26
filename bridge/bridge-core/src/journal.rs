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
             CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS checkpoints (
               resource_id TEXT PRIMARY KEY, last_op_id TEXT NOT NULL,
               post_hash TEXT, compacted_at INTEGER NOT NULL
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
        self.connection.lock().unwrap().execute_batch(
            "CREATE INDEX IF NOT EXISTS resources_by_grant_path
               ON resources(grant_id, path_key);
             CREATE INDEX IF NOT EXISTS resources_by_grant_generation
               ON resources(grant_id, last_seen_generation);
             CREATE INDEX IF NOT EXISTS queue_by_due
               ON queue(available_at, id);",
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
        let mut statement = connection.prepare("SELECT id,op_id,direction,payload,attempts,available_at FROM queue WHERE available_at <= ? ORDER BY id LIMIT ?")?;
        let rows = statement.query_map(params![unix_ms(), limit.clamp(1, 500) as i64], |row| {
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
