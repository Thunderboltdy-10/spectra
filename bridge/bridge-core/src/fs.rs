use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, RwLock};

use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::journal::{Journal, OpState};
use crate::platform::Platform;
use crate::watcher::office_lock_exists;

#[derive(Debug, Error)]
pub enum FsError {
    #[error("grant not found")]
    GrantNotFound,
    #[error("path escapes its grant")]
    GrantEscape,
    #[error("file is open in another application")]
    FileLocked,
    #[error("stale base revision")]
    StaleRevision,
    #[error("read-back verification failed")]
    VerificationFailed,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[derive(Debug, Clone)]
pub struct Grant {
    pub id: String,
    pub label: String,
    root: PathBuf,
}
impl Grant {
    pub fn device_root(&self) -> &Path {
        &self.root
    }

    pub fn is_available(&self) -> bool {
        self.root.is_dir()
    }
}

#[derive(Default)]
pub struct GrantRegistry {
    grants: RwLock<HashMap<String, Grant>>,
}

impl GrantRegistry {
    pub fn add_native_selection(
        &self,
        label: String,
        selected_root: &Path,
    ) -> Result<Grant, FsError> {
        let root = selected_root.canonicalize()?;
        if let Some(existing) = self
            .grants
            .read()
            .unwrap()
            .values()
            .find(|grant| grant.root == root)
            .cloned()
        {
            return Ok(existing);
        }
        let grant = Grant {
            id: format!("grant_{}", uuid::Uuid::new_v4().simple()),
            label,
            root,
        };
        self.grants
            .write()
            .unwrap()
            .insert(grant.id.clone(), grant.clone());
        Ok(grant)
    }

    pub fn restore_device_grant(
        &self,
        id: String,
        label: String,
        root: &Path,
    ) -> Result<Grant, FsError> {
        let normalized_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
        if let Some(existing) = self
            .grants
            .read()
            .unwrap()
            .values()
            .find(|grant| grant.root == normalized_root)
            .cloned()
        {
            return Ok(existing);
        }
        let grant = Grant {
            id,
            label,
            // Keep the persisted location even while an external drive or
            // provider mount is offline. Dropping it here makes the folder
            // disappear from Spectra and forces an unnecessary re-selection.
            root: normalized_root,
        };
        self.grants
            .write()
            .unwrap()
            .insert(grant.id.clone(), grant.clone());
        Ok(grant)
    }

    pub fn public_grants(&self) -> Vec<(String, String)> {
        self.grants
            .read()
            .unwrap()
            .values()
            .map(|g| (g.id.clone(), g.label.clone()))
            .collect()
    }

    pub fn device_grants(&self) -> Vec<Grant> {
        self.grants.read().unwrap().values().cloned().collect()
    }
    pub fn remove(&self, grant_id: &str) -> Option<Grant> {
        self.grants.write().unwrap().remove(grant_id)
    }

    pub fn resolve(&self, grant_id: &str, relative: &Path) -> Result<PathBuf, FsError> {
        if relative.is_absolute()
            || relative.components().any(|part| {
                matches!(
                    part,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err(FsError::GrantEscape);
        }
        let grants = self.grants.read().unwrap();
        let grant = grants.get(grant_id).ok_or(FsError::GrantNotFound)?;
        let candidate = grant.root.join(relative);
        let canonical = if candidate.exists() {
            candidate.canonicalize()?
        } else {
            let parent = candidate
                .parent()
                .ok_or(FsError::GrantEscape)?
                .canonicalize()?;
            parent.join(candidate.file_name().ok_or(FsError::GrantEscape)?)
        };
        if !canonical.starts_with(&grant.root) {
            return Err(FsError::GrantEscape);
        }
        Ok(canonical)
    }
}

pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(hex::encode(digest.finalize()))
}

#[derive(Debug, Clone)]
pub struct WriteRequest<'a> {
    pub grant_id: &'a str,
    pub relative_path: &'a Path,
    pub resource_id: &'a str,
    pub base_revision: &'a str,
    pub known_revision: &'a str,
    pub bytes: &'a [u8],
    pub expected_hash: &'a str,
    pub idempotency_key: &'a str,
}

pub struct SafeWriter<P: Platform> {
    grants: Arc<GrantRegistry>,
    journal: Arc<Journal>,
    platform: Arc<P>,
}

impl<P: Platform> SafeWriter<P> {
    pub fn new(grants: Arc<GrantRegistry>, journal: Arc<Journal>, platform: Arc<P>) -> Self {
        Self {
            grants,
            journal,
            platform,
        }
    }

    pub fn write(&self, request: WriteRequest<'_>) -> Result<String, FsError> {
        // The durable file is the journal resource, not a cloud relativePath
        // that may still name a sibling copy of the same bytes.
        let journal_path = self
            .journal
            .resource_by_id(request.resource_id)?
            .map(|record| PathBuf::from(record.path_key.replace('\\', "/")));
        let relative = journal_path.as_deref().unwrap_or(request.relative_path);
        let target = self.grants.resolve(request.grant_id, relative)?;
        let pre_hash = target.exists().then(|| sha256_file(&target)).transpose()?;
        let op = self.journal.begin_intent(
            request.idempotency_key,
            "file.write",
            Some(request.resource_id),
            Some(request.base_revision),
            pre_hash.as_deref(),
        )?;
        if op.state == OpState::Verified && op.post_hash.as_deref() == Some(request.expected_hash) {
            return Ok(op.op_id);
        }
        if target.exists() && sha256_file(&target)? == request.expected_hash {
            self.journal.transition(
                &op.op_id,
                OpState::Verified,
                Some(request.expected_hash),
                None,
            )?;
            return Ok(op.op_id);
        }
        if request.base_revision != request.known_revision {
            self.journal.transition(
                &op.op_id,
                OpState::Failed,
                None,
                Some(("stale-revision", "base revision does not match")),
            )?;
            return Err(FsError::StaleRevision);
        }
        if target.exists() && (office_lock_exists(&target) || self.platform.is_locked(&target)?) {
            return Err(FsError::FileLocked);
        }
        let parent = target.parent().ok_or(FsError::GrantEscape)?;
        let temp = parent.join(format!(".spectra-{}.tmp", op.op_id));
        let result = (|| -> Result<(), FsError> {
            self.platform.before_write(&target)?;
            if temp.exists() {
                fs::remove_file(&temp)?;
            }
            let mut file = File::options().create_new(true).write(true).open(&temp)?;
            file.write_all(request.bytes)?;
            file.sync_all()?;
            drop(file);
            let temp_hash = sha256_file(&temp)?;
            if temp_hash != request.expected_hash {
                return Err(FsError::VerificationFailed);
            }
            self.journal
                .transition(&op.op_id, OpState::Performed, Some(&temp_hash), None)?;
            self.platform.atomic_replace(&temp, &target)?;
            sync_parent_directory(parent)?;
            let mut ready = false;
            for attempt in 0..5 {
                match self.platform.readback_ready(&target) {
                    Ok(()) => {
                        ready = true;
                        break;
                    }
                    Err(_error) if attempt < 4 => {
                        std::thread::sleep(std::time::Duration::from_millis(10 * (attempt + 1)))
                    }
                    Err(error) => return Err(FsError::Io(error)),
                }
            }
            if !ready {
                return Err(FsError::VerificationFailed);
            }
            if sha256_file(&target)? != request.expected_hash {
                return Err(FsError::VerificationFailed);
            }
            self.journal.transition(
                &op.op_id,
                OpState::Verified,
                Some(request.expected_hash),
                None,
            )?;
            Ok(())
        })();
        if let Err(error) = result {
            let _ = fs::remove_file(&temp);
            let _ = self.journal.transition(
                &op.op_id,
                OpState::Failed,
                None,
                Some(("write-failed", &error.to_string())),
            );
            return Err(error);
        }
        Ok(op.op_id)
    }

    pub fn recycle(
        &self,
        grant_id: &str,
        relative_path: &Path,
        resource_id: &str,
        idempotency_key: &str,
    ) -> Result<String, FsError> {
        let target = self.grants.resolve(grant_id, relative_path)?;
        let pre_hash = target.is_file().then(|| sha256_file(&target)).transpose()?;
        let op = self.journal.begin_intent(
            idempotency_key,
            "fs.delete",
            Some(resource_id),
            None,
            pre_hash.as_deref(),
        )?;
        if op.state == OpState::Verified {
            return Ok(op.op_id);
        }
        // Recycle is a destructive but idempotent terminal action. If the
        // process stopped after the OS moved the target to the Recycle Bin
        // and before the journal could record the transition, replay must not
        // turn the already-achieved absent state into a failure by trying to
        // recycle a path that no longer exists.
        if !target.exists() {
            self.journal
                .transition(&op.op_id, OpState::Performed, None, None)?;
            self.journal
                .transition(&op.op_id, OpState::Verified, None, None)?;
            return Ok(op.op_id);
        }
        self.platform.recycle(&target)?;
        self.journal
            .transition(&op.op_id, OpState::Performed, None, None)?;
        if target.exists() {
            self.journal.transition(
                &op.op_id,
                OpState::Failed,
                None,
                Some(("recycle-verification-failed", "target still exists")),
            )?;
            return Err(FsError::VerificationFailed);
        }
        self.journal
            .transition(&op.op_id, OpState::Verified, None, None)?;
        Ok(op.op_id)
    }

    pub fn relocate(
        &self,
        grant_id: &str,
        source_relative_path: &Path,
        target_relative_path: &Path,
        resource_id: &str,
        idempotency_key: &str,
    ) -> Result<String, FsError> {
        if let Some(existing) = self.journal.by_key(idempotency_key)? {
            if existing.state == OpState::Verified {
                return Ok(existing.op_id);
            }
        }
        let source = self.grants.resolve(grant_id, source_relative_path)?;
        let target = self.grants.resolve(grant_id, target_relative_path)?;
        if source == target {
            return Err(FsError::Other(anyhow::anyhow!(
                "source and target are identical"
            )));
        }
        if !source.exists() {
            return Err(FsError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "source does not exist",
            )));
        }
        if target.exists() {
            return Err(FsError::Other(anyhow::anyhow!(
                "destination already exists"
            )));
        }
        let pre_hash = source.is_file().then(|| sha256_file(&source)).transpose()?;
        let op = self.journal.begin_intent(
            idempotency_key,
            "fs.move",
            Some(resource_id),
            None,
            pre_hash.as_deref(),
        )?;
        if op.state == OpState::Verified {
            return Ok(op.op_id);
        }
        let parent = target.parent().ok_or(FsError::GrantEscape)?;
        fs::create_dir_all(parent)?;
        if self.platform.is_locked(&source)? {
            return Err(FsError::FileLocked);
        }
        if target.exists() {
            return Err(FsError::Other(anyhow::anyhow!(
                "destination already exists"
            )));
        }
        fs::rename(&source, &target)?;
        self.journal
            .transition(&op.op_id, OpState::Performed, pre_hash.as_deref(), None)?;
        if source.exists() || !target.exists() {
            self.journal.transition(
                &op.op_id,
                OpState::Failed,
                None,
                Some((
                    "move-verification-failed",
                    "source or destination state was unexpected",
                )),
            )?;
            return Err(FsError::VerificationFailed);
        }
        self.journal
            .transition(&op.op_id, OpState::Verified, pre_hash.as_deref(), None)?;
        Ok(op.op_id)
    }
}

#[cfg(windows)]
fn sync_parent_directory(_parent: &Path) -> std::io::Result<()> {
    // Windows FlushFileBuffers on the file plus MoveFileEx atomic replacement
    // is the durability boundary; opening directories without backup semantics
    // is rejected by Win32.
    Ok(())
}

#[cfg(not(windows))]
fn sync_parent_directory(parent: &Path) -> std::io::Result<()> {
    File::open(parent)?.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::journal::ResourceRecord;
    use crate::platform::{OsFileIdentity, Platform};
    use async_trait::async_trait;
    use tempfile::tempdir;

    #[derive(Default)]
    struct TestPlatform {
        locked: bool,
    }
    #[async_trait]
    impl Platform for TestPlatform {
        fn file_identity(&self, _: &File) -> std::io::Result<OsFileIdentity> {
            Ok(OsFileIdentity {
                volume: 1,
                file_index: 1,
            })
        }
        fn is_locked(&self, _: &Path) -> std::io::Result<bool> {
            Ok(self.locked)
        }
        fn recycle(&self, _: &Path) -> anyhow::Result<()> {
            Ok(())
        }
        fn store_credential(&self, _: &str, _: &str) -> anyhow::Result<()> {
            Ok(())
        }
        fn read_credential(&self, _: &str) -> anyhow::Result<Option<String>> {
            Ok(None)
        }
        fn enable_autostart(&self) -> anyhow::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn rejects_parent_and_absolute_escapes() {
        let dir = tempdir().unwrap();
        let grants = GrantRegistry::default();
        let grant = grants
            .add_native_selection("Test".into(), dir.path())
            .unwrap();
        assert!(matches!(
            grants.resolve(&grant.id, Path::new("../secret")),
            Err(FsError::GrantEscape)
        ));
        assert!(matches!(
            grants.resolve(&grant.id, Path::new("C:\\secret")),
            Err(FsError::GrantEscape)
        ));
    }

    #[test]
    fn selecting_or_restoring_same_root_reuses_one_grant() {
        let dir = tempdir().unwrap();
        let grants = GrantRegistry::default();
        let first = grants
            .add_native_selection("Physics".into(), dir.path())
            .unwrap();
        let second = grants
            .add_native_selection("Physics".into(), dir.path())
            .unwrap();
        let restored = grants
            .restore_device_grant("grant_other".into(), "Physics".into(), dir.path())
            .unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(first.id, restored.id);
        assert_eq!(grants.device_grants().len(), 1);
    }

    #[test]
    fn restored_unavailable_grant_remains_visible_for_reconnect() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("external-drive");
        fs::create_dir_all(&root).unwrap();
        let grants = GrantRegistry::default();
        let id = "grant_persisted".to_owned();
        fs::remove_dir_all(&root).unwrap();
        let grant = grants
            .restore_device_grant(id.clone(), "External drive".into(), &root)
            .unwrap();
        assert_eq!(grant.id, id);
        assert!(!grant.is_available());
        assert_eq!(grants.device_grants().len(), 1);
    }

    #[test]
    fn verified_write_is_atomic_and_double_replay_does_not_rewrite() {
        let dir = tempdir().unwrap();
        let grants = Arc::new(GrantRegistry::default());
        let grant = grants
            .add_native_selection("Test".into(), dir.path())
            .unwrap();
        let journal = Arc::new(Journal::in_memory().unwrap());
        let writer = SafeWriter::new(grants, journal.clone(), Arc::new(TestPlatform::default()));
        let bytes = b"spectra";
        let hash = hex::encode(Sha256::digest(bytes));
        let request = || WriteRequest {
            grant_id: &grant.id,
            relative_path: Path::new("a.txt"),
            resource_id: "r",
            base_revision: "1",
            known_revision: "1",
            bytes,
            expected_hash: &hash,
            idempotency_key: "once",
        };
        let first = writer.write(request()).unwrap();
        let modified = fs::metadata(dir.path().join("a.txt"))
            .unwrap()
            .modified()
            .unwrap();
        let replay = writer.write(request()).unwrap();
        assert_eq!(first, replay);
        assert_eq!(
            modified,
            fs::metadata(dir.path().join("a.txt"))
                .unwrap()
                .modified()
                .unwrap()
        );
        assert_eq!(
            journal.by_key("once").unwrap().unwrap().state,
            OpState::Verified
        );
    }

    #[test]
    fn stale_revision_and_lock_leave_original_untouched() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.txt"), b"original").unwrap();
        let grants = Arc::new(GrantRegistry::default());
        let grant = grants
            .add_native_selection("Test".into(), dir.path())
            .unwrap();
        let hash = hex::encode(Sha256::digest(b"new"));
        let stale = SafeWriter::new(
            grants.clone(),
            Arc::new(Journal::in_memory().unwrap()),
            Arc::new(TestPlatform::default()),
        );
        assert!(matches!(
            stale.write(WriteRequest {
                grant_id: &grant.id,
                relative_path: Path::new("a.txt"),
                resource_id: "r",
                base_revision: "old",
                known_revision: "new",
                bytes: b"new",
                expected_hash: &hash,
                idempotency_key: "stale"
            }),
            Err(FsError::StaleRevision)
        ));
        assert_eq!(fs::read(dir.path().join("a.txt")).unwrap(), b"original");
        let locked = SafeWriter::new(
            grants,
            Arc::new(Journal::in_memory().unwrap()),
            Arc::new(TestPlatform { locked: true }),
        );
        assert!(matches!(
            locked.write(WriteRequest {
                grant_id: &grant.id,
                relative_path: Path::new("a.txt"),
                resource_id: "r",
                base_revision: "same",
                known_revision: "same",
                bytes: b"new",
                expected_hash: &hash,
                idempotency_key: "locked"
            }),
            Err(FsError::FileLocked)
        ));
        assert_eq!(fs::read(dir.path().join("a.txt")).unwrap(), b"original");
    }

    #[test]
    fn word_owner_file_queues_the_write_without_touching_the_document() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("paper.docx"), b"original").unwrap();
        fs::write(dir.path().join("~$per.docx"), b"owner").unwrap();
        let grants = Arc::new(GrantRegistry::default());
        let grant = grants
            .add_native_selection("Test".into(), dir.path())
            .unwrap();
        let writer = SafeWriter::new(
            grants,
            Arc::new(Journal::in_memory().unwrap()),
            Arc::new(TestPlatform::default()),
        );
        let hash = hex::encode(Sha256::digest(b"new"));
        assert!(matches!(
            writer.write(WriteRequest {
                grant_id: &grant.id,
                relative_path: Path::new("paper.docx"),
                resource_id: "r",
                base_revision: "same",
                known_revision: "same",
                bytes: b"new",
                expected_hash: &hash,
                idempotency_key: "word-owner-file",
            }),
            Err(FsError::FileLocked)
        ));
        assert_eq!(
            fs::read(dir.path().join("paper.docx")).unwrap(),
            b"original"
        );
    }

    #[test]
    fn write_targets_the_journal_path_not_a_sibling_relative_path() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("original.txt"), b"original").unwrap();
        fs::write(dir.path().join("copy.txt"), b"copy").unwrap();
        let grants = Arc::new(GrantRegistry::default());
        let grant = grants
            .add_native_selection("Test".into(), dir.path())
            .unwrap();
        let journal = Arc::new(Journal::in_memory().unwrap());
        journal
            .upsert_resource(&ResourceRecord {
                local_resource_id: "lr_original".into(),
                grant_id: grant.id.clone(),
                path_key: "original.txt".into(),
                volume: Some(1),
                file_index: Some(1),
                content_hash: Some(hex::encode(Sha256::digest(b"original"))),
                revision: None,
                available: true,
                unavailable_reason: None,
                last_seen_generation: 1,
            })
            .unwrap();
        let writer = SafeWriter::new(grants, journal, Arc::new(TestPlatform::default()));
        let bytes = b"spectra-version";
        let hash = hex::encode(Sha256::digest(bytes));
        writer
            .write(WriteRequest {
                grant_id: &grant.id,
                relative_path: Path::new("copy.txt"),
                resource_id: "lr_original",
                base_revision: "1",
                known_revision: "1",
                bytes,
                expected_hash: &hash,
                idempotency_key: "path-authority",
            })
            .unwrap();
        assert_eq!(
            fs::read(dir.path().join("original.txt")).unwrap(),
            b"spectra-version"
        );
        assert_eq!(fs::read(dir.path().join("copy.txt")).unwrap(), b"copy");
    }

    #[test]
    fn relocate_is_journaled_and_idempotent() {
        let dir = tempdir().unwrap();
        let grants = Arc::new(GrantRegistry::default());
        let grant = grants
            .add_native_selection("Test".into(), dir.path())
            .unwrap();
        std::fs::write(dir.path().join("before.txt"), b"move me").unwrap();
        let journal = Arc::new(Journal::in_memory().unwrap());
        let writer = SafeWriter::new(grants, journal.clone(), Arc::new(TestPlatform::default()));
        let first = writer
            .relocate(
                &grant.id,
                Path::new("before.txt"),
                Path::new("after.txt"),
                "r",
                "move-once",
            )
            .unwrap();
        assert!(!dir.path().join("before.txt").exists());
        assert_eq!(
            std::fs::read(dir.path().join("after.txt")).unwrap(),
            b"move me"
        );
        let second = writer
            .relocate(
                &grant.id,
                Path::new("before.txt"),
                Path::new("after.txt"),
                "r",
                "move-once",
            )
            .unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn recycle_replay_accepts_a_target_removed_after_the_intent() {
        let dir = tempdir().unwrap();
        let grants = Arc::new(GrantRegistry::default());
        let grant = grants
            .add_native_selection("Delete replay".into(), dir.path())
            .unwrap();
        let journal = Arc::new(Journal::in_memory().unwrap());
        let writer = SafeWriter::new(grants, journal.clone(), Arc::new(TestPlatform::default()));
        fs::write(dir.path().join("already-recycled.txt"), b"gone").unwrap();
        let intent = journal
            .begin_intent(
                "delete-after-crash",
                "fs.delete",
                Some("resource-delete"),
                None,
                None,
            )
            .unwrap();
        fs::remove_file(dir.path().join("already-recycled.txt")).unwrap();

        let replayed = writer
            .recycle(
                &grant.id,
                Path::new("already-recycled.txt"),
                "resource-delete",
                "delete-after-crash",
            )
            .unwrap();

        assert_eq!(replayed, intent.op_id);
        assert_eq!(
            journal.by_key("delete-after-crash").unwrap().unwrap().state,
            OpState::Verified
        );
    }
}
