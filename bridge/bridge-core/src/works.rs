//! Work kept on this computer.
//!
//! Each work is a Yjs document in a private SQLite file under the app's data
//! folder. It isn't a file people see: "Save as Word" makes one of those when
//! asked. Rooms (`rooms.rs`) keep the document live and write here; the routes
//! below read the last projection the app saved, for lists, search and the AI.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::Context;
use base64::Engine as _;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Older saved points are dropped past this.
const VERSIONS_KEPT: i64 = 200;
const BACKUP_MAGIC: &[u8; 8] = b"SPECTRA1";

pub fn default_store_path() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(base).join("Spectra").join("works").join("works.db"))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Projection {
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub tags: Option<Value>,
    #[serde(default)]
    pub blueprint_key: Option<String>,
    #[serde(default)]
    pub schema_version: Option<i64>,
    #[serde(default)]
    pub content: Option<Value>,
    #[serde(default)]
    pub content_hash: Option<String>,
    /// The work's words, for search.
    #[serde(default)]
    pub text: Option<String>,
}

pub struct WorkStore {
    db: Mutex<Connection>,
    path: Option<PathBuf>,
}

impl WorkStore {
    pub fn open(path: &Path) -> anyhow::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).context("making the works folder")?;
        }
        let db = Connection::open(path).context("opening the works file")?;
        Self::prepare(db, Some(path.to_path_buf()))
    }

    pub fn in_memory() -> anyhow::Result<Self> {
        Self::prepare(Connection::open_in_memory()?, None)
    }

    fn prepare(db: Connection, path: Option<PathBuf>) -> anyhow::Result<Self> {
        db.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             CREATE TABLE IF NOT EXISTS works(
               artifact_id TEXT PRIMARY KEY,
               owner TEXT,
               state BLOB,
               title TEXT, summary TEXT, tags TEXT,
               blueprint_key TEXT, schema_version INTEGER,
               content TEXT, content_hash TEXT,
               updated_at INTEGER NOT NULL,
               backed_up_at INTEGER
             );
             CREATE TABLE IF NOT EXISTS work_updates(
               artifact_id TEXT NOT NULL,
               seq INTEGER NOT NULL,
               body BLOB NOT NULL,
               PRIMARY KEY(artifact_id, seq)
             ) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS work_versions(
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               artifact_id TEXT NOT NULL,
               at INTEGER NOT NULL,
               source TEXT NOT NULL,
               summary TEXT,
               actor TEXT,
               run_id TEXT,
               state BLOB NOT NULL,
               title TEXT,
               content TEXT
             );
             CREATE INDEX IF NOT EXISTS work_versions_by_work ON work_versions(artifact_id, id);
             CREATE VIRTUAL TABLE IF NOT EXISTS work_text USING fts5(
               artifact_id UNINDEXED, owner UNINDEXED, title, body,
               tokenize = 'unicode61 remove_diacritics 2'
             );
             CREATE TABLE IF NOT EXISTS store_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        )?;
        Ok(Self { db: Mutex::new(db), path })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The saved state and everything written since, in order.
    pub fn load(&self, artifact_id: &str) -> anyhow::Result<(Option<Vec<u8>>, Vec<Vec<u8>>)> {
        let db = self.lock();
        let state: Option<Vec<u8>> = db
            .query_row("SELECT state FROM works WHERE artifact_id = ?1", [artifact_id], |row| row.get(0))
            .optional()?
            .flatten();
        let mut statement = db.prepare("SELECT body FROM work_updates WHERE artifact_id = ?1 ORDER BY seq")?;
        let updates = statement
            .query_map([artifact_id], |row| row.get::<_, Vec<u8>>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok((state, updates))
    }

    pub fn append_update(&self, artifact_id: &str, update: &[u8]) -> anyhow::Result<i64> {
        let now = now_ms();
        let mut db = self.lock();
        let tx = db.transaction()?;
        tx.execute(
            "INSERT INTO works(artifact_id, updated_at) VALUES(?1, ?2)
             ON CONFLICT(artifact_id) DO UPDATE SET updated_at = ?2",
            params![artifact_id, now],
        )?;
        let next: i64 = tx.query_row(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM work_updates WHERE artifact_id = ?1",
            [artifact_id],
            |row| row.get(0),
        )?;
        tx.execute(
            "INSERT INTO work_updates(artifact_id, seq, body) VALUES(?1, ?2, ?3)",
            params![artifact_id, next, update],
        )?;
        tx.commit()?;
        Ok(next)
    }

    /// Replaces the log with the document it adds up to.
    pub fn compact(&self, artifact_id: &str, state: &[u8]) -> anyhow::Result<()> {
        let mut db = self.lock();
        let tx = db.transaction()?;
        tx.execute(
            "UPDATE works SET state = ?2 WHERE artifact_id = ?1",
            params![artifact_id, state],
        )?;
        tx.execute("DELETE FROM work_updates WHERE artifact_id = ?1", [artifact_id])?;
        tx.commit()?;
        Ok(())
    }

    pub fn save_projection(&self, artifact_id: &str, projection: &Projection) -> anyhow::Result<()> {
        let content = projection.content.as_ref().map(Value::to_string);
        let tags = projection.tags.as_ref().map(Value::to_string);
        let now = now_ms();
        let mut db = self.lock();
        let tx = db.transaction()?;
        tx.execute(
            "INSERT INTO works(artifact_id, owner, title, summary, tags, blueprint_key, schema_version, content, content_hash, updated_at)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(artifact_id) DO UPDATE SET
               owner = COALESCE(?2, owner), title = COALESCE(?3, title), summary = COALESCE(?4, summary),
               tags = COALESCE(?5, tags), blueprint_key = COALESCE(?6, blueprint_key),
               schema_version = COALESCE(?7, schema_version), content = COALESCE(?8, content),
               content_hash = COALESCE(?9, content_hash), updated_at = ?10",
            params![
                artifact_id,
                projection.owner,
                projection.title,
                projection.summary,
                tags,
                projection.blueprint_key,
                projection.schema_version,
                content,
                projection.content_hash,
                now
            ],
        )?;
        if projection.text.is_some() || projection.title.is_some() {
            let (owner, title): (Option<String>, Option<String>) = tx.query_row(
                "SELECT owner, title FROM works WHERE artifact_id = ?1",
                [artifact_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let body = match &projection.text {
                Some(text) => text.clone(),
                None => tx
                    .query_row("SELECT body FROM work_text WHERE artifact_id = ?1", [artifact_id], |row| row.get(0))
                    .optional()?
                    .unwrap_or_default(),
            };
            tx.execute("DELETE FROM work_text WHERE artifact_id = ?1", [artifact_id])?;
            tx.execute(
                "INSERT INTO work_text(artifact_id, owner, title, body) VALUES(?1, ?2, ?3, ?4)",
                params![artifact_id, owner, title, body],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn add_version(
        &self,
        artifact_id: &str,
        source: &str,
        summary: Option<&str>,
        actor: Option<&str>,
        run_id: Option<&str>,
        state: &[u8],
    ) -> anyhow::Result<i64> {
        let mut db = self.lock();
        let tx = db.transaction()?;
        let (title, content): (Option<String>, Option<String>) = tx
            .query_row(
                "SELECT title, content FROM works WHERE artifact_id = ?1",
                [artifact_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .unwrap_or((None, None));
        tx.execute(
            "INSERT INTO work_versions(artifact_id, at, source, summary, actor, run_id, state, title, content)
             VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![artifact_id, now_ms(), source, summary, actor, run_id, state, title, content],
        )?;
        let id = tx.last_insert_rowid();
        tx.execute(
            "DELETE FROM work_versions WHERE artifact_id = ?1 AND id NOT IN
               (SELECT id FROM work_versions WHERE artifact_id = ?1 ORDER BY id DESC LIMIT ?2)",
            params![artifact_id, VERSIONS_KEPT],
        )?;
        tx.commit()?;
        Ok(id)
    }

    pub fn versions(&self, artifact_id: &str, limit: i64) -> anyhow::Result<Vec<Value>> {
        let db = self.lock();
        let mut statement = db.prepare(
            "SELECT id, at, source, summary, actor, run_id, title FROM work_versions
             WHERE artifact_id = ?1 ORDER BY id DESC LIMIT ?2",
        )?;
        let rows = statement.query_map(params![artifact_id, limit.clamp(1, VERSIONS_KEPT)], |row| {
            Ok(json!({
                "id": row.get::<_, i64>(0)?,
                "at": row.get::<_, i64>(1)?,
                "source": row.get::<_, String>(2)?,
                "summary": row.get::<_, Option<String>>(3)?,
                "actor": row.get::<_, Option<String>>(4)?,
                "runId": row.get::<_, Option<String>>(5)?,
                "title": row.get::<_, Option<String>>(6)?,
            }))
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn version(&self, artifact_id: &str, id: i64) -> anyhow::Result<Option<Value>> {
        let db = self.lock();
        let row = db
            .query_row(
                "SELECT at, source, summary, state, title, content FROM work_versions WHERE artifact_id = ?1 AND id = ?2",
                params![artifact_id, id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Vec<u8>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, Option<String>>(5)?,
                    ))
                },
            )
            .optional()?;
        Ok(row.map(|(at, source, summary, state, title, content)| {
            json!({
                "id": id, "at": at, "source": source, "summary": summary, "title": title,
                "content": content.and_then(|text| serde_json::from_str::<Value>(&text).ok()),
                "stateBase64": base64::engine::general_purpose::STANDARD.encode(state),
            })
        }))
    }

    fn work_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
        let parse = |text: Option<String>| text.and_then(|text| serde_json::from_str::<Value>(&text).ok());
        Ok(json!({
            "artifactId": row.get::<_, String>(0)?,
            "title": row.get::<_, Option<String>>(1)?,
            "summary": row.get::<_, Option<String>>(2)?,
            "tags": parse(row.get(3)?),
            "blueprintKey": row.get::<_, Option<String>>(4)?,
            "schemaVersion": row.get::<_, Option<i64>>(5)?,
            "content": parse(row.get(6)?),
            "contentHash": row.get::<_, Option<String>>(7)?,
            "updatedAt": row.get::<_, i64>(8)?,
        }))
    }

    pub fn work(&self, artifact_id: &str) -> anyhow::Result<Option<Value>> {
        let db = self.lock();
        Ok(db
            .query_row(
                "SELECT artifact_id, title, summary, tags, blueprint_key, schema_version, content, content_hash, updated_at
                 FROM works WHERE artifact_id = ?1",
                [artifact_id],
                Self::work_row,
            )
            .optional()?)
    }

    pub fn works(&self, ids: &[String]) -> anyhow::Result<Vec<Value>> {
        let mut found = Vec::with_capacity(ids.len());
        for id in ids.iter().take(200) {
            if let Some(work) = self.work(id)? {
                found.push(work);
            }
        }
        Ok(found)
    }

    /// Word search over this computer's work, best matches first.
    pub fn search(&self, query: &str, owner: Option<&str>, limit: i64) -> anyhow::Result<Vec<Value>> {
        let terms = query
            .split(|c: char| !c.is_alphanumeric())
            .filter(|term| !term.is_empty())
            .map(|term| format!("\"{term}\"*"))
            .collect::<Vec<_>>()
            .join(" ");
        if terms.is_empty() {
            return Ok(Vec::new());
        }
        let db = self.lock();
        let mut statement = db.prepare(
            "SELECT artifact_id, title, snippet(work_text, 3, '', '', ' … ', 24) FROM work_text
             WHERE work_text MATCH ?1 AND (?2 IS NULL OR owner = ?2) ORDER BY rank LIMIT ?3",
        )?;
        let rows = statement.query_map(params![terms, owner, limit.clamp(1, 50)], |row| {
            Ok(json!({
                "artifactId": row.get::<_, String>(0)?,
                "title": row.get::<_, Option<String>>(1)?,
                "excerpt": row.get::<_, Option<String>>(2)?,
            }))
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn remove(&self, artifact_id: &str) -> anyhow::Result<()> {
        let mut db = self.lock();
        let tx = db.transaction()?;
        tx.execute("DELETE FROM works WHERE artifact_id = ?1", [artifact_id])?;
        tx.execute("DELETE FROM work_updates WHERE artifact_id = ?1", [artifact_id])?;
        tx.execute("DELETE FROM work_versions WHERE artifact_id = ?1", [artifact_id])?;
        tx.execute("DELETE FROM work_text WHERE artifact_id = ?1", [artifact_id])?;
        tx.commit()?;
        Ok(())
    }

    /// Takes a whole work in, as when moving it here from the cloud or a backup.
    pub fn import(&self, artifact_id: &str, projection: &Projection, state: &[u8]) -> anyhow::Result<()> {
        self.save_projection(artifact_id, projection)?;
        self.compact(artifact_id, state)
    }

    /// Names this computer's store; a work's row says which store holds it.
    pub fn store_id(&self) -> anyhow::Result<String> {
        let db = self.lock();
        if let Some(id) = db
            .query_row("SELECT value FROM store_meta WHERE key = 'store_id'", [], |row| row.get::<_, String>(0))
            .optional()?
        {
            return Ok(id);
        }
        let id = uuid::Uuid::new_v4().to_string();
        db.execute("INSERT INTO store_meta(key, value) VALUES('store_id', ?1)", [&id])?;
        Ok(id)
    }

    pub fn summary(&self) -> anyhow::Result<Value> {
        let store_id = self.store_id()?;
        let db = self.lock();
        let count: i64 = db.query_row("SELECT COUNT(*) FROM works", [], |row| row.get(0))?;
        let changed: i64 = db.query_row(
            "SELECT COUNT(*) FROM works WHERE backed_up_at IS NULL OR updated_at > backed_up_at",
            [],
            |row| row.get(0),
        )?;
        let backed_up: Option<String> = db
            .query_row("SELECT value FROM store_meta WHERE key = 'last_backup_at'", [], |row| row.get(0))
            .optional()?;
        let bytes = self
            .path
            .as_ref()
            .and_then(|path| std::fs::metadata(path).ok())
            .map_or(0, |meta| meta.len());
        Ok(json!({
            "storeId": store_id,
            "works": count,
            "changedSinceBackup": changed,
            "bytes": bytes,
            "lastBackupAt": backed_up.and_then(|value| value.parse::<i64>().ok()),
        }))
    }

    /// Everything since the last backup, gathered into one compressed file.
    pub fn backup_bundle(&self, full: bool) -> anyhow::Result<(Vec<u8>, i64)> {
        use std::io::Write as _;
        let db = self.lock();
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(BACKUP_MAGIC)?;
        let mut statement = db.prepare(
            "SELECT artifact_id, owner, state, title, summary, tags, blueprint_key, schema_version, content, content_hash, updated_at
             FROM works WHERE ?1 OR backed_up_at IS NULL OR updated_at > backed_up_at",
        )?;
        let mut rows = statement.query([full])?;
        let mut count = 0;
        while let Some(row) = rows.next()? {
            let artifact_id: String = row.get(0)?;
            let mut state: Option<Vec<u8>> = row.get(2)?;
            let mut log = db.prepare("SELECT body FROM work_updates WHERE artifact_id = ?1 ORDER BY seq")?;
            let updates = log
                .query_map([&artifact_id], |entry| entry.get::<_, Vec<u8>>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            if !updates.is_empty() {
                state = Some(crate::rooms::merge_state(state.as_deref(), &updates)?);
            }
            let header = json!({
                "artifactId": artifact_id,
                "owner": row.get::<_, Option<String>>(1)?,
                "title": row.get::<_, Option<String>>(3)?,
                "summary": row.get::<_, Option<String>>(4)?,
                "tags": row.get::<_, Option<String>>(5)?.and_then(|text| serde_json::from_str::<Value>(&text).ok()),
                "blueprintKey": row.get::<_, Option<String>>(6)?,
                "schemaVersion": row.get::<_, Option<i64>>(7)?,
                "content": row.get::<_, Option<String>>(8)?.and_then(|text| serde_json::from_str::<Value>(&text).ok()),
                "contentHash": row.get::<_, Option<String>>(9)?,
                "updatedAt": row.get::<_, i64>(10)?,
            })
            .to_string();
            let body = state.unwrap_or_default();
            encoder.write_all(&(header.len() as u32).to_be_bytes())?;
            encoder.write_all(header.as_bytes())?;
            encoder.write_all(&(body.len() as u32).to_be_bytes())?;
            encoder.write_all(&body)?;
            count += 1;
        }
        Ok((encoder.finish()?, count))
    }

    /// The backup reached its home, so what it holds needn't go again.
    pub fn mark_backed_up(&self, at: i64) -> anyhow::Result<()> {
        let db = self.lock();
        db.execute("UPDATE works SET backed_up_at = ?1 WHERE updated_at <= ?1", [at])?;
        db.execute(
            "INSERT INTO store_meta(key, value) VALUES('last_backup_at', ?1)
             ON CONFLICT(key) DO UPDATE SET value = ?1",
            [at.to_string()],
        )?;
        Ok(())
    }

    /// Brings a backup back. Work changed here since then stays as it is.
    pub fn restore_bundle(&self, bundle: &[u8]) -> anyhow::Result<i64> {
        use std::io::Read as _;
        let mut decoder = flate2::read::GzDecoder::new(bundle);
        let mut magic = [0u8; 8];
        decoder.read_exact(&mut magic)?;
        anyhow::ensure!(&magic == BACKUP_MAGIC, "That isn't a Spectra backup.");
        let mut restored = 0;
        loop {
            let mut length = [0u8; 4];
            match decoder.read_exact(&mut length) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => break,
                Err(error) => return Err(error.into()),
            }
            let mut header = vec![0u8; u32::from_be_bytes(length) as usize];
            decoder.read_exact(&mut header)?;
            decoder.read_exact(&mut length)?;
            let mut body = vec![0u8; u32::from_be_bytes(length) as usize];
            decoder.read_exact(&mut body)?;
            let header: Value = serde_json::from_slice(&header)?;
            let Some(artifact_id) = header["artifactId"].as_str() else {
                continue;
            };
            let incoming = header["updatedAt"].as_i64().unwrap_or(0);
            let existing = self.work(artifact_id)?.and_then(|work| work["updatedAt"].as_i64());
            if existing.is_some_and(|at| at >= incoming) {
                continue;
            }
            let projection: Projection = serde_json::from_value(header.clone())?;
            self.import(artifact_id, &projection, &body)?;
            restored += 1;
        }
        Ok(restored)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Projection {
        Projection {
            owner: Some("account-a".into()),
            title: Some("Hamlet essay".into()),
            summary: Some("On revenge".into()),
            blueprint_key: Some("document".into()),
            schema_version: Some(2),
            content: Some(json!({ "blocks": [] })),
            text: Some("To be or not to be, café".into()),
            ..Projection::default()
        }
    }

    #[test]
    fn a_work_comes_back_as_it_was_saved() {
        let store = WorkStore::in_memory().unwrap();
        store.save_projection("w1", &sample()).unwrap();
        let work = store.work("w1").unwrap().unwrap();
        assert_eq!(work["title"], "Hamlet essay");
        assert_eq!(work["content"]["blocks"], json!([]));
        assert!(store.work("nothing").unwrap().is_none());
    }

    #[test]
    fn a_partial_save_keeps_what_it_did_not_mention() {
        let store = WorkStore::in_memory().unwrap();
        store.save_projection("w1", &sample()).unwrap();
        store
            .save_projection("w1", &Projection { title: Some("Renamed".into()), ..Projection::default() })
            .unwrap();
        let work = store.work("w1").unwrap().unwrap();
        assert_eq!(work["title"], "Renamed");
        assert_eq!(work["summary"], "On revenge");
        assert_eq!(store.search("cafe", None, 5).unwrap().len(), 1);
    }

    #[test]
    fn search_finds_words_and_keeps_to_its_owner() {
        let store = WorkStore::in_memory().unwrap();
        store.save_projection("w1", &sample()).unwrap();
        let found = store.search("hamlet", Some("account-a"), 5).unwrap();
        assert_eq!(found[0]["artifactId"], "w1");
        assert!(store.search("hamlet", Some("account-b"), 5).unwrap().is_empty());
        assert!(store.search("\"; DROP TABLE works; --", None, 5).unwrap().is_empty());
    }

    #[test]
    fn compacting_replaces_the_log() {
        let store = WorkStore::in_memory().unwrap();
        store.append_update("w1", b"one").unwrap();
        store.append_update("w1", b"two").unwrap();
        assert_eq!(store.load("w1").unwrap().1.len(), 2);
        store.compact("w1", b"both").unwrap();
        let (state, updates) = store.load("w1").unwrap();
        assert_eq!(state.as_deref(), Some(&b"both"[..]));
        assert!(updates.is_empty());
    }

    #[test]
    fn old_saved_points_are_dropped_and_recent_ones_read_back() {
        let store = WorkStore::in_memory().unwrap();
        store.save_projection("w1", &sample()).unwrap();
        let mut last = 0;
        for _ in 0..(VERSIONS_KEPT + 5) {
            last = store.add_version("w1", "edit", None, None, None, b"state").unwrap();
        }
        let listed = store.versions("w1", VERSIONS_KEPT + 50).unwrap();
        assert_eq!(listed.len() as i64, VERSIONS_KEPT);
        let version = store.version("w1", last).unwrap().unwrap();
        assert_eq!(version["title"], "Hamlet essay");
        assert!(store.version("w1", 1).unwrap().is_none());
    }

    #[test]
    fn a_backup_holds_only_what_changed_and_restores_without_overwriting_newer_work() {
        let store = WorkStore::in_memory().unwrap();
        store.save_projection("w1", &sample()).unwrap();
        let (bundle, count) = store.backup_bundle(false).unwrap();
        assert_eq!(count, 1);
        store.mark_backed_up(now_ms() + 1).unwrap();
        assert_eq!(store.backup_bundle(false).unwrap().1, 0);
        assert_eq!(store.summary().unwrap()["changedSinceBackup"], 0);

        let elsewhere = WorkStore::in_memory().unwrap();
        assert_eq!(elsewhere.restore_bundle(&bundle).unwrap(), 1);
        assert_eq!(elsewhere.work("w1").unwrap().unwrap()["title"], "Hamlet essay");

        store
            .save_projection("w1", &Projection { title: Some("Newer".into()), ..Projection::default() })
            .unwrap();
        assert_eq!(store.restore_bundle(&bundle).unwrap(), 0);
        assert_eq!(store.work("w1").unwrap().unwrap()["title"], "Newer");
    }

    #[test]
    fn removing_a_work_leaves_nothing_behind() {
        let store = WorkStore::in_memory().unwrap();
        store.save_projection("w1", &sample()).unwrap();
        store.append_update("w1", b"one").unwrap();
        store.add_version("w1", "edit", None, None, None, b"state").unwrap();
        store.remove("w1").unwrap();
        assert!(store.work("w1").unwrap().is_none());
        assert!(store.search("hamlet", None, 5).unwrap().is_empty());
        assert!(store.versions("w1", 5).unwrap().is_empty());
    }
}
