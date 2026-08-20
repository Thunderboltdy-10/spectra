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
            "INSERT INTO queue(op_id,direction,payload,available_at) VALUES(?,?,?,?)",
            params![op_id, direction, payload, unix_ms()],
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
}
