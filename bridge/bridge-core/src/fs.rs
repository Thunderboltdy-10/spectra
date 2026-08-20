use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, RwLock};

use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::journal::{Journal, OpState};
use crate::platform::Platform;

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
        let grant = Grant {
            id,
            label,
            root: root.canonicalize()?,
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
        let target = self
            .grants
            .resolve(request.grant_id, request.relative_path)?;
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
        if target.exists() && self.platform.is_locked(&target)? {
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
}
