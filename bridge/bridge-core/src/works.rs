//! Work kept on this computer.
//!
//! Each work is a Yjs document in a private SQLite file under the app's data
//! folder. It isn't a file people see: "Save as Word" makes one of those when
//! asked. Rooms (`rooms.rs`) keep the document live and write here; the routes
//! below read the last projection the app saved, for lists, search and the AI.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::Context;
use base64::Engine as _;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use yrs::updates::decoder::Decode as _;
use yrs::{ReadTxn as _, Transact as _};

/// Older saved points are dropped past this many, or past this many bytes.
const VERSIONS_KEPT: i64 = 200;
const VERSION_BYTES_KEPT: i64 = 64 * 1024 * 1024;
const BACKUP_MAGIC: &[u8; 8] = b"SPECTRA1";

pub fn default_store_path() -> Option<PathBuf> {
    store_path_for_profile(
        std::env::var_os("SPECTRA_BRIDGE_DATA_DIR").map(PathBuf::from),
        std::env::var_os("LOCALAPPDATA").or_else(|| std::env::var_os("HOME")).map(PathBuf::from),
    )
}

fn store_path_for_profile(isolated: Option<PathBuf>, base: Option<PathBuf>) -> Option<PathBuf> {
    let root = match isolated {
        Some(path) if path.is_absolute() => path,
        Some(_) => return None,
        None => base?.join("Spectra"),
    };
    Some(root.join("works").join("works.db"))
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
    account: Option<String>,
}

/// The complete envelope has been checked; its bytes cannot change while
/// ownership is being verified. Keep it compressed until the import pass.
pub struct ValidatedBackup {
    bytes: Vec<u8>,
    artifact_ids: Vec<String>,
}

impl ValidatedBackup {
    pub fn from_bytes(bytes: Vec<u8>) -> anyhow::Result<Self> {
        let mut artifact_ids = Vec::new();
        let mut seen = HashSet::new();
        visit_backup(&bytes, |header, _| {
            if let Some(id) = header["artifactId"].as_str() {
                if seen.insert(id.to_owned()) { artifact_ids.push(id.to_owned()); }
            }
            Ok(())
        })?;
        Ok(Self { bytes, artifact_ids })
    }

    pub fn artifact_ids(&self) -> &[String] { &self.artifact_ids }
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

    pub fn account_id(&self) -> Option<&str> { self.account.as_deref() }

    /// The verified pairing selects a private store; device ids may change.
    pub fn for_account(legacy_path: &Path, deployment: &str, account: &str) -> anyhow::Result<Self> {
        anyhow::ensure!(!deployment.is_empty() && !account.is_empty(), "A verified work account is required");
        let binding = format!("{}\0{account}", deployment.trim_end_matches('/'));
        let directory = hex::encode(Sha256::digest(binding.as_bytes()));
        let path = legacy_path.parent().context("finding the works folder")?.join("accounts").join(directory).join("works.db");
        let mut store = Self::open(&path)?;
        store.account = Some(account.to_owned());
        Ok(store)
    }

    pub fn legacy_ids(path: &Path) -> anyhow::Result<Vec<String>> {
        if !path.try_exists()? { return Ok(Vec::new()); }
        let db = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let mut statement = db.prepare("SELECT artifact_id FROM works ORDER BY artifact_id")?;
        Ok(statement.query_map([], |row| row.get(0))?.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn migration_complete(&self) -> anyhow::Result<bool> {
        Ok(self.lock().query_row("SELECT value FROM store_meta WHERE key = 'legacy_migration'", [], |row| row.get::<_, String>(0)).optional()?.as_deref() == Some("done"))
    }

    pub fn finish_migration(&self) -> anyhow::Result<()> {
        self.lock().execute("INSERT INTO store_meta(key, value) VALUES('legacy_migration', 'done') ON CONFLICT(key) DO UPDATE SET value = 'done'", [])?;
        Ok(())
    }

    /// Only the cloud-proven ids may cross the old, unscoped boundary.
    pub fn copy_verified_legacy(&self, source: &Path, ids: &[String]) -> anyhow::Result<()> {
        let account = self.account.as_deref().context("A verified work account is required")?;
        let mut uri = reqwest::Url::from_file_path(source).map_err(|_| anyhow::anyhow!("The legacy work path must be absolute"))?;
        uri.set_query(Some("mode=ro"));
        let mut db = self.lock();
        db.execute("ATTACH DATABASE ?1 AS legacy", [uri.as_str()])?;
        let copied = (|| -> anyhow::Result<()> {
            let tx = db.transaction()?;
            for id in ids {
                let inserted = tx.execute(
                    "INSERT OR IGNORE INTO works(artifact_id, owner, state, title, summary, tags, blueprint_key, schema_version, content, content_hash, updated_at, backed_up_at)
                     SELECT artifact_id, ?2, state, title, summary, tags, blueprint_key, schema_version, content, content_hash, updated_at, NULL FROM legacy.works WHERE artifact_id = ?1",
                    params![id, account],
                )?;
                if inserted == 0 { continue; }
                tx.execute("INSERT INTO work_updates(artifact_id, seq, body) SELECT artifact_id, seq, body FROM legacy.work_updates WHERE artifact_id = ?1", [id])?;
                tx.execute("INSERT INTO work_versions(id, artifact_id, at, source, summary, actor, run_id, state, title, content) SELECT id, artifact_id, at, source, summary, actor, run_id, state, title, content FROM legacy.work_versions WHERE artifact_id = ?1", [id])?;
                tx.execute("INSERT INTO work_text(artifact_id, owner, title, body) SELECT artifact_id, ?2, title, body FROM legacy.work_text WHERE artifact_id = ?1", params![id, account])?;
            }
            tx.execute("INSERT OR IGNORE INTO store_meta(key, value) SELECT key, value FROM legacy.store_meta WHERE key = 'store_id'", [])?;
            tx.commit()?;
            Ok(())
        })();
        let detached = db.execute_batch("DETACH DATABASE legacy");
        copied?;
        detached?;
        Ok(())
    }

    fn prepare(db: Connection, path: Option<PathBuf>) -> anyhow::Result<Self> {
        db.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=FULL;
             CREATE TABLE IF NOT EXISTS works(
               artifact_id TEXT PRIMARY KEY,
               owner TEXT,
               state BLOB,
               title TEXT, summary TEXT, tags TEXT,
               blueprint_key TEXT, schema_version INTEGER,
               content TEXT, content_hash TEXT,
               updated_at INTEGER NOT NULL,
               backed_up_at INTEGER,
               rev INTEGER NOT NULL DEFAULT 1,
               backed_up_rev INTEGER NOT NULL DEFAULT 0
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
        Self::count_changes(&db)?;
        Ok(Self { db: Mutex::new(db), path, account: None })
    }

    /// "Changed since backup" is counted, never read off two computers' clocks:
    /// every write to a work takes the store's next `rev`, and a backup records
    /// the `rev` it was read at. Older stores gain the columns once.
    fn count_changes(db: &Connection) -> anyhow::Result<()> {
        let has_rev = db
            .prepare("SELECT 1 FROM pragma_table_info('works') WHERE name = 'rev'")?
            .exists([])?;
        if !has_rev {
            db.execute_batch(
                "BEGIN;
                 ALTER TABLE works ADD COLUMN rev INTEGER NOT NULL DEFAULT 1;
                 ALTER TABLE works ADD COLUMN backed_up_rev INTEGER NOT NULL DEFAULT 0;
                 UPDATE works SET backed_up_rev = 1 WHERE backed_up_at IS NOT NULL AND backed_up_at >= updated_at;
                 COMMIT;",
            )?;
        }
        db.execute("INSERT OR IGNORE INTO store_meta(key, value) VALUES('rev', '1')", [])?;
        Ok(())
    }

    /// The store's next change number, taken inside the writing transaction.
    fn next_rev(tx: &rusqlite::Transaction<'_>, artifact_id: &str) -> rusqlite::Result<i64> {
        tx.execute("UPDATE store_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'rev'", [])?;
        let rev: i64 = tx.query_row("SELECT CAST(value AS INTEGER) FROM store_meta WHERE key = 'rev'", [], |row| row.get(0))?;
        tx.execute("UPDATE works SET rev = ?2 WHERE artifact_id = ?1", params![artifact_id, rev])?;
        Ok(rev)
    }

    /// The newest saved point's document, for a work whose saved state can't be read.
    pub fn latest_version_state(&self, artifact_id: &str) -> anyhow::Result<Option<Vec<u8>>> {
        Ok(self
            .lock()
            .query_row(
                "SELECT state FROM work_versions WHERE artifact_id = ?1 ORDER BY id DESC LIMIT 1",
                [artifact_id],
                |row| row.get(0),
            )
            .optional()?)
    }

    /// The work's whole document as far as it can be read, and whether any of it couldn't be.
    pub fn readable_state(&self, artifact_id: &str) -> anyhow::Result<(Vec<u8>, bool)> {
        let (state, updates) = self.load(artifact_id)?;
        if updates.is_empty() {
            if let Some(state) = state.as_ref().filter(|state| !state.is_empty()) {
                return Ok((state.clone(), false));
            }
        }
        let (doc, damaged) = crate::rooms::readable_doc(state.as_deref(), &updates, artifact_id, || {
            self.latest_version_state(artifact_id).ok().flatten()
        });
        Ok((doc.transact().encode_state_as_update_v1(&yrs::StateVector::default()), damaged))
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
            "INSERT INTO works(artifact_id, updated_at, owner) VALUES(?1, ?2, ?3)
             ON CONFLICT(artifact_id) DO UPDATE SET updated_at = ?2",
            params![artifact_id, now, self.account],
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
        Self::next_rev(&tx, artifact_id)?;
        tx.commit()?;
        Ok(next)
    }

    /// Replaces the log with the document it adds up to. The row is created
    /// if it is missing, so the log is never deleted without its state.
    pub fn compact(&self, artifact_id: &str, state: &[u8]) -> anyhow::Result<()> {
        let mut db = self.lock();
        let tx = db.transaction()?;
        let written = tx.execute(
            "INSERT INTO works(artifact_id, state, updated_at, owner) VALUES(?1, ?2, ?3, ?4)
             ON CONFLICT(artifact_id) DO UPDATE SET state = ?2",
            params![artifact_id, state, now_ms(), self.account],
        )?;
        anyhow::ensure!(written == 1, "The work's saved state wasn't written");
        tx.execute("DELETE FROM work_updates WHERE artifact_id = ?1", [artifact_id])?;
        Self::next_rev(&tx, artifact_id)?;
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
                self.account.as_ref().or(projection.owner.as_ref()),
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
        Self::next_rev(&tx, artifact_id)?;
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
        // Each saved point is a whole copy; a large work keeps fewer of them.
        let oldest_kept: Option<i64> = {
            let mut sizes = tx.prepare("SELECT id, length(state) FROM work_versions WHERE artifact_id = ?1 ORDER BY id DESC")?;
            let mut rows = sizes.query([artifact_id])?;
            let (mut total, mut kept) = (0_i64, None);
            while let Some(row) = rows.next()? {
                let (version, bytes): (i64, i64) = (row.get(0)?, row.get(1)?);
                total += bytes;
                if kept.is_some() && total > VERSION_BYTES_KEPT {
                    break;
                }
                kept = Some(version);
            }
            kept
        };
        if let Some(oldest) = oldest_kept {
            tx.execute("DELETE FROM work_versions WHERE artifact_id = ?1 AND id < ?2", params![artifact_id, oldest])?;
        }
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

    /// Takes a whole work in, as when moving it here from the cloud. A work
    /// already held here is merged with it, so neither side's edits are lost.
    pub fn import(&self, artifact_id: &str, projection: &Projection, state: &[u8]) -> anyhow::Result<()> {
        let held = self.work(artifact_id)?.is_some();
        let state = if held {
            let (existing, _) = self.readable_state(artifact_id)?;
            crate::rooms::merge_state(Some(&existing), &[state.to_vec()])?
        } else {
            state.to_vec()
        };
        self.save_projection(artifact_id, projection)?;
        self.compact(artifact_id, &state)
    }

    /// Merges a work arriving from a backup into what is here, after keeping
    /// what was here as a saved point. Clocks decide nothing: both sides stay.
    pub fn merge_in(&self, artifact_id: &str, projection: &Projection, incoming: &[u8]) -> anyhow::Result<()> {
        if self.work(artifact_id)?.is_none() {
            self.save_projection(artifact_id, projection)?;
            return self.compact(artifact_id, incoming);
        }
        let (existing, _) = self.readable_state(artifact_id)?;
        let Some(merged) = crate::rooms::merge_if_new(&existing, incoming)? else {
            return Ok(());
        };
        self.add_version(artifact_id, "restore", Some("Before restore"), None, None, &existing)?;
        // The incoming side brought something new; its description is the fresher one.
        self.save_projection(artifact_id, projection)?;
        self.compact(artifact_id, &merged)
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
            "SELECT COUNT(*) FROM works WHERE rev > backed_up_rev",
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

    /// Everything since the last backup, gathered into one compressed file,
    /// with the change number it was read at (`backedUp` takes it back).
    pub fn backup_bundle(&self, full: bool) -> anyhow::Result<(Vec<u8>, i64, i64)> {
        use std::io::Write as _;
        // Read under the lock; merge and compress after it, so edits aren't held up.
        let (snapshot, gathered) = {
            let mut db = self.lock();
            let tx = db.transaction()?;
            let snapshot: i64 = tx.query_row("SELECT CAST(value AS INTEGER) FROM store_meta WHERE key = 'rev'", [], |row| row.get(0))?;
            let mut gathered = Vec::new();
            {
                let mut statement = tx.prepare(
                    "SELECT artifact_id, owner, state, title, summary, tags, blueprint_key, schema_version, content, content_hash, updated_at
                     FROM works WHERE ?1 OR rev > backed_up_rev",
                )?;
                let mut log = tx.prepare("SELECT body FROM work_updates WHERE artifact_id = ?1 ORDER BY seq")?;
                let mut rows = statement.query([full])?;
                while let Some(row) = rows.next()? {
                    let artifact_id: String = row.get(0)?;
                    let updates = log
                        .query_map([&artifact_id], |entry| entry.get::<_, Vec<u8>>(0))?
                        .collect::<Result<Vec<_>, _>>()?;
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
                    gathered.push((artifact_id, header, row.get::<_, Option<Vec<u8>>>(2)?, updates));
                }
            }
            tx.commit()?;
            (snapshot, gathered)
        };
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(BACKUP_MAGIC)?;
        let count = gathered.len() as i64;
        for (artifact_id, header, state, updates) in gathered {
            let body = if updates.is_empty() {
                state.unwrap_or_default()
            } else {
                let (doc, _) = crate::rooms::readable_doc(state.as_deref(), &updates, &artifact_id, || {
                    self.latest_version_state(&artifact_id).ok().flatten()
                });
                doc.transact().encode_state_as_update_v1(&yrs::StateVector::default())
            };
            encoder.write_all(&(header.len() as u32).to_be_bytes())?;
            encoder.write_all(header.as_bytes())?;
            encoder.write_all(&(body.len() as u32).to_be_bytes())?;
            encoder.write_all(&body)?;
        }
        Ok((encoder.finish()?, count, snapshot))
    }

    /// The backup reached its home, so what it holds needn't go again. Only
    /// works unchanged since the backup's change number count as backed up; a
    /// caller that doesn't send one (an older Spectra) marks nothing.
    /// Works written since their last backup, for a hand-over.
    pub fn changed_ids(&self) -> anyhow::Result<Vec<String>> {
        let db = self.lock();
        let mut statement = db.prepare("SELECT artifact_id FROM works WHERE rev > backed_up_rev ORDER BY artifact_id LIMIT 1000")?;
        let ids = statement.query_map([], |row| row.get(0))?.collect::<Result<Vec<String>, _>>()?;
        Ok(ids)
    }

    /// A hand-over from another computer, once merged here.
    pub fn record_hand_over(&self, backup_id: &str) -> anyhow::Result<()> {
        self.lock().execute(
            "INSERT INTO store_meta(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO NOTHING",
            params![format!("handover:{backup_id}"), now_ms().to_string()],
        )?;
        Ok(())
    }

    pub fn hand_overs_merged(&self) -> anyhow::Result<Vec<String>> {
        let db = self.lock();
        let mut statement = db.prepare("SELECT substr(key, 10) FROM store_meta WHERE key LIKE 'handover:%' ORDER BY key")?;
        let ids = statement.query_map([], |row| row.get(0))?.collect::<Result<Vec<String>, _>>()?;
        Ok(ids)
    }

    pub fn mark_backed_up(&self, at: i64, snapshot: Option<i64>) -> anyhow::Result<()> {
        let db = self.lock();
        if let Some(snapshot) = snapshot {
            db.execute("UPDATE works SET backed_up_rev = rev, backed_up_at = ?2 WHERE rev <= ?1", params![snapshot, at])?;
        }
        db.execute(
            "INSERT INTO store_meta(key, value) VALUES('last_backup_at', ?1)
             ON CONFLICT(key) DO UPDATE SET value = ?1",
            [at.to_string()],
        )?;
        Ok(())
    }

    /// Brings a backup back, merged into what is here. Returns the works it held.
    /// `place` puts each work in: into an open room when there is one.
    pub fn restore_bundle(&self, bundle: &[u8], place: &dyn Fn(&str, &Projection, &[u8]) -> anyhow::Result<bool>) -> anyhow::Result<Vec<String>> {
        anyhow::ensure!(self.account.is_none(), "This backup needs verified work ownership before restoring");
        visit_backup(bundle, |_, _| Ok(()))?;
        self.restore_filtered(bundle, None, place)
    }

    pub fn restore_verified(&self, bundle: ValidatedBackup, allowed: &HashSet<String>, place: &dyn Fn(&str, &Projection, &[u8]) -> anyhow::Result<bool>) -> anyhow::Result<Vec<String>> {
        anyhow::ensure!(self.account.is_some(), "A verified work account is required");
        self.restore_filtered(&bundle.bytes, Some(allowed), place)
    }

    fn restore_filtered(&self, bundle: &[u8], allowed: Option<&HashSet<String>>, place: &dyn Fn(&str, &Projection, &[u8]) -> anyhow::Result<bool>) -> anyhow::Result<Vec<String>> {
        let mut restored = Vec::new();
        visit_backup(bundle, |header, body| {
            let Some(artifact_id) = header["artifactId"].as_str() else {
                return Ok(());
            };
            if allowed.is_some_and(|ids| !ids.contains(artifact_id)) { return Ok(()); }
            if !body.is_empty() {
                yrs::Update::decode_v1(&body).with_context(|| format!("reading {artifact_id} in the backup"))?;
            }
            let projection: Projection = serde_json::from_value(header.clone())?;
            if place(artifact_id, &projection, &body)? {
                restored.push(artifact_id.to_owned());
            }
            Ok(())
        })?;
        Ok(restored)
    }
}

fn visit_backup(bundle: &[u8], mut visit: impl FnMut(Value, Vec<u8>) -> anyhow::Result<()>) -> anyhow::Result<()> {
    use std::io::Read as _;
    fn part(reader: &mut impl std::io::Read, length: u32) -> anyhow::Result<Vec<u8>> {
        let mut bytes = Vec::new();
        reader.take(u64::from(length)).read_to_end(&mut bytes)?;
        anyhow::ensure!(bytes.len() == length as usize, "This backup is incomplete");
        Ok(bytes)
    }
    let mut decoder = flate2::read::GzDecoder::new(bundle);
    let mut magic = [0u8; 8];
    decoder.read_exact(&mut magic)?;
    anyhow::ensure!(&magic == BACKUP_MAGIC, "That isn't a Spectra backup.");
    loop {
        let mut length = [0u8; 4];
        if decoder.read(&mut length[..1])? == 0 { return Ok(()); }
        decoder.read_exact(&mut length[1..])?;
        let header = part(&mut decoder, u32::from_be_bytes(length))?;
        decoder.read_exact(&mut length)?;
        let body = part(&mut decoder, u32::from_be_bytes(length))?;
        visit(serde_json::from_slice(&header)?, body)?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_stores_keep_work_separate_across_accounts_and_deployments() {
        let root = tempfile::tempdir().unwrap();
        let legacy = root.path().join("works.db");
        let first = WorkStore::for_account(&legacy, "https://school.example/", "a").unwrap();
        first.save_projection("work", &sample()).unwrap();
        let other = WorkStore::for_account(&legacy, "https://school.example", "b").unwrap();
        let deployment = WorkStore::for_account(&legacy, "https://other.example", "a").unwrap();
        assert!(other.work("work").unwrap().is_none());
        assert!(deployment.work("work").unwrap().is_none());
        let reopened = WorkStore::for_account(&legacy, "https://school.example", "a").unwrap();
        assert_eq!(reopened.work("work").unwrap().unwrap()["title"], "Hamlet essay");
        assert_ne!(first.path, other.path);
    }

    #[test]
    fn verified_migration_preserves_only_permitted_work_state_and_history() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("legacy # space.db");
        let legacy = WorkStore::open(&path).unwrap();
        legacy.save_projection("owned", &Projection { owner: None, ..sample() }).unwrap();
        legacy.compact("owned", b"state").unwrap();
        legacy.append_update("owned", b"update").unwrap();
        let version = legacy.add_version("owned", "before_ai", Some("Before"), Some("actor"), Some("run"), b"version-state").unwrap();
        // A caller-supplied local owner never proves that this work belongs here.
        legacy.save_projection("foreign", &sample()).unwrap();
        legacy.mark_backed_up(now_ms() + 10_000, Some(i64::MAX)).unwrap();
        let store_id = legacy.store_id().unwrap();
        let original = legacy.work("owned").unwrap();
        let scoped = WorkStore::for_account(&path, "https://school.example", "a").unwrap();
        assert!(!scoped.migration_complete().unwrap());
        scoped.copy_verified_legacy(&path, &["owned".into()]).unwrap();
        assert_eq!(scoped.work("owned").unwrap(), original);
        assert_eq!(scoped.load("owned").unwrap(), (Some(b"state".to_vec()), vec![b"update".to_vec()]));
        assert_eq!(scoped.version("owned", version).unwrap(), legacy.version("owned", version).unwrap());
        assert!(scoped.work("foreign").unwrap().is_none());
        assert!(scoped.versions("foreign", 200).unwrap().is_empty());
        assert_eq!(scoped.search("hamlet", None, 10).unwrap().len(), 1);
        assert_eq!(scoped.summary().unwrap()["storeId"], store_id);
        assert_eq!(scoped.summary().unwrap()["changedSinceBackup"], 1);
        assert_eq!(scoped.summary().unwrap()["lastBackupAt"], Value::Null);
        assert_eq!(legacy.work("owned").unwrap(), original);
        assert_eq!(legacy.summary().unwrap()["works"], 2);
        assert_eq!(legacy.lock().query_row("SELECT owner FROM works WHERE artifact_id='owned'", [], |row| row.get::<_, Option<String>>(0)).unwrap(), None);
        assert!(!scoped.migration_complete().unwrap());
        scoped.finish_migration().unwrap();
        assert!(WorkStore::for_account(&path, "https://school.example", "a").unwrap().migration_complete().unwrap());
    }

    #[test]
    fn a_failed_legacy_copy_rolls_back_and_can_retry_without_losing_source_work() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("works.db");
        let legacy = WorkStore::open(&path).unwrap();
        legacy.save_projection("owned", &sample()).unwrap();
        legacy.append_update("owned", b"update").unwrap();
        let scoped = WorkStore::for_account(&path, "https://school.example", "a").unwrap();
        scoped.lock().execute_batch("CREATE TRIGGER fail_copy BEFORE INSERT ON work_updates BEGIN SELECT RAISE(ABORT, 'fixture migration failure'); END").unwrap();
        assert!(scoped.copy_verified_legacy(&path, &["owned".into()]).is_err());
        assert!(scoped.work("owned").unwrap().is_none());
        assert!(!scoped.migration_complete().unwrap());
        assert!(legacy.work("owned").unwrap().is_some());
        scoped.lock().execute_batch("DROP TRIGGER fail_copy").unwrap();
        scoped.copy_verified_legacy(&path, &["owned".into()]).unwrap();
        assert_eq!(scoped.load("owned").unwrap().1, vec![b"update".to_vec()]);
    }

    #[test]
    fn repeated_migration_preserves_newer_scoped_work_and_has_no_duplicate_history() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("works.db");
        let legacy = WorkStore::open(&path).unwrap();
        legacy.save_projection("owned", &sample()).unwrap();
        let id = legacy.add_version("owned", "edit", None, None, None, b"state").unwrap();
        let scoped = WorkStore::for_account(&path, "https://school.example", "a").unwrap();
        scoped.copy_verified_legacy(&path, &["owned".into()]).unwrap();
        scoped.save_projection("owned", &Projection { title: Some("My newer title".into()), ..Projection::default() }).unwrap();
        scoped.copy_verified_legacy(&path, &["owned".into(), "owned".into()]).unwrap();
        assert_eq!(scoped.work("owned").unwrap().unwrap()["title"], "My newer title");
        assert_eq!(scoped.versions("owned", 200).unwrap().len(), 1);
        assert!(scoped.version("owned", id).unwrap().is_some());
    }

    #[test]
    fn default_profile_keeps_the_existing_work_path() {
        let base = std::env::temp_dir().join("spectra-user-data");
        assert_eq!(store_path_for_profile(None, Some(base.clone())), Some(base.join("Spectra/works/works.db")));
        assert_eq!(store_path_for_profile(None, None), None);
    }

    #[test]
    fn an_absolute_profile_does_not_require_or_use_the_default_base() {
        let profile = std::env::temp_dir().join("spectra-isolated-profile");
        for base in [None, Some(std::env::temp_dir().join("other-user-data"))] {
            assert_eq!(store_path_for_profile(Some(profile.clone()), base), Some(profile.join("works/works.db")));
        }
    }

    #[test]
    fn an_invalid_profile_never_falls_back_to_the_default_store() {
        for profile in ["", "profile", "../profile"] {
            assert_eq!(store_path_for_profile(Some(PathBuf::from(profile)), Some(std::env::temp_dir())), None);
        }
    }

    #[test]
    fn isolated_profiles_preserve_separate_work_and_history() {
        let root = tempfile::tempdir().unwrap();
        let base = Some(root.path().join("normal-user"));
        let original = store_path_for_profile(None, base.clone()).unwrap();
        let first = store_path_for_profile(Some(root.path().join("first")), base.clone()).unwrap();
        let second = store_path_for_profile(Some(root.path().join("second")), base).unwrap();
        for (path, title) in [(&original, "Original"), (&first, "First"), (&second, "Second")] {
            let store = WorkStore::open(path).unwrap();
            store.save_projection("same-id", &Projection { title: Some(title.into()), ..sample() }).unwrap();
            store.add_version("same-id", "edit", None, None, None, b"state").unwrap();
        }
        for (path, title) in [(&original, "Original"), (&first, "First"), (&second, "Second")] {
            let store = WorkStore::open(path).unwrap();
            assert_eq!(store.work("same-id").unwrap().unwrap()["title"], title);
            let versions = store.versions("same-id", 5).unwrap();
            assert_eq!(versions.len(), 1);
            assert_eq!(store.version("same-id", versions[0]["id"].as_i64().unwrap()).unwrap().unwrap()["title"], title);
        }
    }

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

    fn place(store: &WorkStore) -> impl Fn(&str, &Projection, &[u8]) -> anyhow::Result<bool> + '_ {
        move |id, projection, state| store.merge_in(id, projection, state).map(|()| true)
    }

    /// Hand-over on the computer a work moved to: only the works it holds.
    fn place_held(store: &WorkStore) -> impl Fn(&str, &Projection, &[u8]) -> anyhow::Result<bool> + '_ {
        move |id, projection, state| {
            if store.work(id)?.is_none() {
                return Ok(false);
            }
            store.merge_in(id, projection, state).map(|()| true)
        }
    }

    // W10. Two computers in one process: A wrote after its last backup, B took
    // the work over from that backup, and A's later edits reach B by hand-over.
    /// W4: what a durable "saved" costs. Ten minutes of typing at about five
    /// edits a second is about 3,000 writes. Run with `--ignored --nocapture`.
    #[test]
    #[ignore]
    fn measure_synchronous_full() {
        let root = tempfile::tempdir().unwrap();
        for mode in ["NORMAL", "FULL"] {
            let store = WorkStore::open(&root.path().join(format!("{mode}.db"))).unwrap();
            store.lock().execute_batch(&format!("PRAGMA synchronous={mode};")).unwrap();
            let doc = yrs::Doc::new();
            let edits: Vec<_> = (0..3_000).map(|_| text_edit(&doc, "a")).collect();
            let started = std::time::Instant::now();
            for edit in &edits {
                store.append_update("w1", edit).unwrap();
            }
            let elapsed = started.elapsed();
            println!("synchronous={mode}: 3000 writes in {elapsed:?}, {:?} each", elapsed / 3_000);
        }
    }

    #[test]
    fn a_hand_over_brings_the_edits_left_behind() {
        let a = WorkStore::in_memory().unwrap();
        let doc = yrs::Doc::new();
        a.save_projection("w1", &Projection { title: Some("Essay".into()), ..Projection::default() }).unwrap();
        a.append_update("w1", &text_edit(&doc, "one ")).unwrap();
        let (full, _, snapshot) = a.backup_bundle(true).unwrap();
        a.mark_backed_up(now_ms(), Some(snapshot)).unwrap();
        a.append_update("w1", &text_edit(&doc, "two ")).unwrap();
        assert_eq!(a.changed_ids().unwrap(), vec!["w1".to_string()]);

        let b = WorkStore::in_memory().unwrap();
        b.restore_bundle(&full, &place(&b)).unwrap();
        let on_b = yrs::Doc::new();
        {
            use yrs::Transact as _;
            on_b.transact_mut().apply_update(yrs::Update::decode_v1(&b.readable_state("w1").unwrap().0).unwrap()).unwrap();
        }
        b.append_update("w1", &text_edit(&on_b, "three ")).unwrap();

        let (hand_over, _, _) = a.backup_bundle(false).unwrap();
        b.restore_bundle(&hand_over, &place_held(&b)).unwrap();
        let text = text_of(&b.readable_state("w1").unwrap().0);
        assert!(text.contains("one") && text.contains("two") && text.contains("three"), "{text}");

        // Applied twice, nothing changes.
        let before = b.readable_state("w1").unwrap().0;
        b.restore_bundle(&hand_over, &place_held(&b)).unwrap();
        assert_eq!(b.readable_state("w1").unwrap().0, before);
        b.record_hand_over("backup-2").unwrap();
        b.record_hand_over("backup-2").unwrap();
        assert_eq!(b.hand_overs_merged().unwrap(), vec!["backup-2".to_string()]);
    }

    #[test]
    fn a_hand_over_before_the_take_over_ends_the_same() {
        let a = WorkStore::in_memory().unwrap();
        let doc = yrs::Doc::new();
        a.save_projection("w1", &Projection { title: Some("Essay".into()), ..Projection::default() }).unwrap();
        a.append_update("w1", &text_edit(&doc, "one ")).unwrap();
        let (full, _, snapshot) = a.backup_bundle(true).unwrap();
        a.mark_backed_up(now_ms(), Some(snapshot)).unwrap();
        a.append_update("w1", &text_edit(&doc, "two ")).unwrap();
        let (hand_over, _, _) = a.backup_bundle(false).unwrap();

        // B sees the hand-over first: it holds nothing yet, so nothing is taken.
        let b = WorkStore::in_memory().unwrap();
        assert!(b.restore_bundle(&hand_over, &place_held(&b)).unwrap().is_empty());
        b.restore_bundle(&full, &place(&b)).unwrap();
        b.restore_bundle(&hand_over, &place_held(&b)).unwrap();
        let text = text_of(&b.readable_state("w1").unwrap().0);
        assert!(text.contains("one") && text.contains("two"), "{text}");

        // Restoring the chain in either order gives the same words.
        let c = WorkStore::in_memory().unwrap();
        c.restore_bundle(&hand_over, &place(&c)).unwrap();
        c.restore_bundle(&full, &place(&c)).unwrap();
        assert_eq!(text_of(&c.readable_state("w1").unwrap().0), text);
    }

    #[test]
    fn without_a_hand_over_the_backup_is_kept() {
        let a = WorkStore::in_memory().unwrap();
        let doc = yrs::Doc::new();
        a.append_update("w1", &text_edit(&doc, "one")).unwrap();
        let (full, _, _) = a.backup_bundle(true).unwrap();
        drop(a);
        let b = WorkStore::in_memory().unwrap();
        b.restore_bundle(&full, &place(&b)).unwrap();
        assert_eq!(text_of(&b.readable_state("w1").unwrap().0), "one");
    }

    fn text_edit(doc: &yrs::Doc, text: &str) -> Vec<u8> {
        use yrs::{GetString as _, Text as _, Transact as _};
        let content = doc.get_or_insert_text("content");
        let before = doc.transact().state_vector();
        {
            let mut txn = doc.transact_mut();
            let end = content.get_string(&txn).len() as u32;
            content.insert(&mut txn, end, text);
        }
        doc.transact().encode_state_as_update_v1(&before)
    }

    fn text_of(state: &[u8]) -> String {
        use yrs::{GetString as _, Transact as _, updates::decoder::Decode as _};
        let doc = yrs::Doc::new();
        let content = doc.get_or_insert_text("content");
        doc.transact_mut().apply_update(yrs::Update::decode_v1(state).unwrap()).unwrap();
        content.get_string(&doc.transact())
    }

    #[test]
    fn a_backup_holds_only_what_changed_and_restores_without_losing_newer_work() {
        let store = WorkStore::in_memory().unwrap();
        store.save_projection("w1", &sample()).unwrap();
        let (bundle, count, snapshot) = store.backup_bundle(false).unwrap();
        assert_eq!(count, 1);
        store.mark_backed_up(now_ms(), Some(snapshot)).unwrap();
        assert_eq!(store.backup_bundle(false).unwrap().1, 0);
        assert_eq!(store.summary().unwrap()["changedSinceBackup"], 0);

        let elsewhere = WorkStore::in_memory().unwrap();
        assert_eq!(elsewhere.restore_bundle(&bundle, &place(&elsewhere)).unwrap(), vec!["w1".to_string()]);
        assert_eq!(elsewhere.work("w1").unwrap().unwrap()["title"], "Hamlet essay");

        store
            .save_projection("w1", &Projection { title: Some("Newer".into()), ..Projection::default() })
            .unwrap();
        store.restore_bundle(&bundle, &place(&store)).unwrap();
        assert_eq!(store.work("w1").unwrap().unwrap()["title"], "Newer");
    }

    #[test]
    fn an_edit_during_a_backup_is_still_counted_as_changed() {
        let store = WorkStore::in_memory().unwrap();
        let doc = yrs::Doc::new();
        store.append_update("w1", &text_edit(&doc, "first")).unwrap();
        let (_, _, snapshot) = store.backup_bundle(false).unwrap();
        // Written after the backup was read, before it was recorded.
        store.append_update("w1", &text_edit(&doc, " second")).unwrap();
        store.mark_backed_up(now_ms(), Some(snapshot)).unwrap();
        assert_eq!(store.summary().unwrap()["changedSinceBackup"], 1);
        let (_, count, _) = store.backup_bundle(false).unwrap();
        assert_eq!(count, 1);
        // An older Spectra that sends no change number marks nothing.
        store.mark_backed_up(now_ms(), None).unwrap();
        assert_eq!(store.summary().unwrap()["changedSinceBackup"], 1);
    }

    #[test]
    fn older_stores_count_changes_from_their_backup_times() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("works.db");
        {
            let db = Connection::open(&path).unwrap();
            db.execute_batch(
                "CREATE TABLE works(artifact_id TEXT PRIMARY KEY, owner TEXT, state BLOB, title TEXT, summary TEXT, tags TEXT,
                   blueprint_key TEXT, schema_version INTEGER, content TEXT, content_hash TEXT, updated_at INTEGER NOT NULL, backed_up_at INTEGER);
                 INSERT INTO works(artifact_id, updated_at, backed_up_at) VALUES('saved', 10, 20), ('changed', 30, 20), ('never', 5, NULL);",
            )
            .unwrap();
        }
        let store = WorkStore::open(&path).unwrap();
        assert_eq!(store.summary().unwrap()["changedSinceBackup"], 2);
        let (_, count, _) = store.backup_bundle(false).unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn restoring_merges_both_sides_and_keeps_what_was_here() {
        let here = WorkStore::in_memory().unwrap();
        let doc = yrs::Doc::new();
        here.import("w1", &sample(), &text_edit(&doc, "shared ")).unwrap();
        let backup_side = WorkStore::in_memory().unwrap();
        backup_side.import("w1", &sample(), &here.readable_state("w1").unwrap().0).unwrap();
        // Each side writes on its own after they parted.
        here.append_update("w1", &text_edit(&doc, "here")).unwrap();
        let other = yrs::Doc::new();
        {
            use yrs::{Transact as _, updates::decoder::Decode as _};
            other.transact_mut().apply_update(yrs::Update::decode_v1(&backup_side.readable_state("w1").unwrap().0).unwrap()).unwrap();
        }
        backup_side.append_update("w1", &text_edit(&other, "there")).unwrap();
        let (bundle, _, _) = backup_side.backup_bundle(true).unwrap();
        here.restore_bundle(&bundle, &place(&here)).unwrap();
        let merged = text_of(&here.readable_state("w1").unwrap().0);
        assert!(merged.contains("here") && merged.contains("there"), "{merged}");
        let saved = here.versions("w1", 5).unwrap();
        assert_eq!(saved[0]["summary"], "Before restore");
        // Bringing the same backup back again changes nothing.
        here.restore_bundle(&bundle, &place(&here)).unwrap();
        assert_eq!(here.versions("w1", 5).unwrap().len(), 1);
    }

    #[test]
    fn compacting_a_missing_row_keeps_the_state() {
        let store = WorkStore::in_memory().unwrap();
        store.compact("w1", b"state").unwrap();
        assert_eq!(store.load("w1").unwrap().0.as_deref(), Some(&b"state"[..]));
    }

    #[test]
    fn large_works_keep_fewer_saved_points() {
        let store = WorkStore::in_memory().unwrap();
        let big = vec![7_u8; (VERSION_BYTES_KEPT / 4) as usize + 1];
        for _ in 0..6 {
            store.add_version("w1", "edit", None, None, None, &big).unwrap();
        }
        assert_eq!(store.versions("w1", 50).unwrap().len(), 3);
    }

    #[test]
    fn a_partial_backup_length_is_not_a_clean_end() {
        use std::io::Write as _;
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(BACKUP_MAGIC).unwrap();
        encoder.write_all(&[0, 0]).unwrap();
        let store = WorkStore::in_memory().unwrap();
        assert!(store.restore_bundle(&encoder.finish().unwrap(), &place(&store)).is_err());
    }

    #[test]
    fn scoped_restore_uses_only_the_verified_ids_including_legacy_ownerless_work() {
        let legacy = WorkStore::in_memory().unwrap();
        legacy.save_projection("owned", &Projection { owner: None, ..sample() }).unwrap();
        legacy.save_projection("foreign", &sample()).unwrap();
        let (bundle, _, _) = legacy.backup_bundle(true).unwrap();
        let root = tempfile::tempdir().unwrap();
        let scoped = WorkStore::for_account(&root.path().join("works.db"), "https://school.example", "a").unwrap();
        assert!(scoped.restore_bundle(&bundle, &place(&scoped)).is_err());
        let bundle = ValidatedBackup::from_bytes(bundle).unwrap();
        assert_eq!(bundle.artifact_ids().len(), 2);
        assert_eq!(scoped.restore_verified(bundle, &HashSet::from(["owned".into()]), &place(&scoped)).unwrap(), vec!["owned".to_string()]);
        assert!(scoped.work("foreign").unwrap().is_none());
        assert_eq!(scoped.lock().query_row("SELECT owner FROM works WHERE artifact_id='owned'", [], |row| row.get::<_, String>(0)).unwrap(), "a");
    }

    #[test]
    fn an_incomplete_backup_fails_before_restoring_its_valid_prefix() {
        use std::io::{Read as _, Write as _};
        let legacy = WorkStore::in_memory().unwrap();
        legacy.save_projection("owned", &sample()).unwrap();
        let mut bytes = Vec::new();
        flate2::read::GzDecoder::new(legacy.backup_bundle(true).unwrap().0.as_slice()).read_to_end(&mut bytes).unwrap();
        bytes.extend([0, 0]);
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(&bytes).unwrap();
        let destination = WorkStore::in_memory().unwrap();
        let bundle = encoder.finish().unwrap();
        assert!(destination.restore_bundle(&bundle, &place(&destination)).is_err());
        assert!(ValidatedBackup::from_bytes(bundle).is_err());
        assert!(destination.work("owned").unwrap().is_none());
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
