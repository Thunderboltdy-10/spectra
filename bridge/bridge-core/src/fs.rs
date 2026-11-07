use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock, RwLockReadGuard, Weak};

use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::journal::{Journal, OpState};
use crate::platform::Platform;
use crate::watcher::office_lock_exists_with;

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
    // A file selection grants only this name, never its containing directory.
    selected_file: Option<PathBuf>,
}
impl Grant {
    pub fn device_root(&self) -> &Path {
        &self.root
    }

    pub fn is_available(&self) -> bool {
        self.root.is_dir()
    }

    pub fn selected_file(&self) -> Option<&Path> {
        self.selected_file.as_deref()
    }

    pub fn selection_path(&self) -> PathBuf {
        self.selected_file
            .as_ref()
            .map_or_else(|| self.root.clone(), |name| self.root.join(name))
    }

    pub fn permits_path(&self, path: &Path) -> bool {
        match &self.selected_file {
            Some(name) => path == self.root.join(name),
            None => path.starts_with(&self.root),
        }
    }
}

/// A file someone chose that already syncs through `grant_id`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncedFile {
    pub grant_id: String,
    pub relative_path: String,
}

/// What choosing files came to: those newly synced and those already here.
#[derive(Debug, Clone, Default)]
pub struct FileSelection {
    pub added: Vec<Grant>,
    pub already_synced: Vec<SyncedFile>,
}

#[derive(Default)]
pub struct GrantRegistry {
    grants: RwLock<HashMap<String, Grant>>,
    write_locks: Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>,
}

impl GrantRegistry {
    /// Keep permission valid through a synchronous filesystem mutation. Removal
    /// waits for this short local section, never for a network request.
    fn hold_grant(
        &self,
        grant_id: &str,
        targets: &[&Path],
    ) -> Result<RwLockReadGuard<'_, HashMap<String, Grant>>, FsError> {
        let grants = self.grants.read().unwrap();
        let grant = grants.get(grant_id).ok_or(FsError::GrantNotFound)?;
        if targets.iter().any(|target| !grant.permits_path(target)) {
            return Err(FsError::GrantEscape);
        }
        Ok(grants)
    }

    fn write_lock(&self, target: &Path) -> Arc<Mutex<()>> {
        let mut locks = self.write_locks.lock().unwrap();
        locks.retain(|_, lock| lock.strong_count() > 0);
        if let Some(lock) = locks.get(target).and_then(Weak::upgrade) {
            return lock;
        }
        let lock = Arc::new(Mutex::new(()));
        locks.insert(target.to_owned(), Arc::downgrade(&lock));
        lock
    }

    pub fn add_native_selection(
        &self,
        label: String,
        selected_root: &Path,
    ) -> Result<Grant, FsError> {
        let root = selected_root.canonicalize()?;
        if !root.is_dir() {
            return Err(FsError::Other(anyhow::anyhow!("Choose a folder to sync")));
        }
        // A folder already synced, or one inside a folder already synced, is
        // already here. Nothing about choosing it again should fail.
        if let Some(existing) = self
            .grants
            .read()
            .unwrap()
            .values()
            .filter(|grant| grant.selected_file.is_none() && root.starts_with(&grant.root))
            .min_by_key(|grant| grant.root.components().count())
            .cloned()
        {
            return Ok(existing);
        }
        let grant = Grant {
            id: format!("grant_{}", uuid::Uuid::new_v4().simple()),
            label,
            root,
            selected_file: None,
        };
        self.grants
            .write()
            .unwrap()
            .insert(grant.id.clone(), grant.clone());
        Ok(grant)
    }

    pub fn add_native_file_selection(&self, selected: &Path) -> Result<Grant, FsError> {
        let selected = selected.canonicalize()?;
        if !selected.is_file() {
            return Err(FsError::Other(anyhow::anyhow!("Choose a file to sync")));
        }
        if self
            .grants
            .read()
            .unwrap()
            .values()
            .any(|grant| grant.selected_file.is_none() && selected.starts_with(&grant.root))
        {
            return Err(FsError::Other(anyhow::anyhow!(
                "This file is already syncing through a selected folder."
            )));
        }
        let root = selected.parent().ok_or(FsError::GrantEscape)?;
        let name = selected.file_name().ok_or(FsError::GrantEscape)?;
        self.restore_file_grant(
            format!("grant_{}", uuid::Uuid::new_v4().simple()),
            name.to_string_lossy().into_owned(),
            root,
            Path::new(name),
        )
    }

    /// What the whole of `grant`, a folder, now takes over: anything chosen
    /// earlier that sits inside it. One copy of a file on this computer is one
    /// work in Spectra, however it was first brought in, so these grants retire
    /// and the folder's next scan carries their works forward by file identity.
    pub fn take_over_selections_within(&self, grant: &Grant) -> Vec<Grant> {
        if grant.selected_file.is_some() {
            return Vec::new();
        }
        let mut grants = self.grants.write().unwrap();
        let within = grants
            .values()
            .filter(|other| other.id != grant.id && other.selection_path().starts_with(&grant.root))
            .cloned()
            .collect::<Vec<_>>();
        for other in &within {
            grants.remove(&other.id);
        }
        within
    }

    /// Validates the entire native selection before creating any grants.
    /// Choosing a file that already syncs is not a mistake, whether it was
    /// chosen alone before or came through a folder: it is reported back so
    /// the person can place the work they already have.
    pub fn add_native_file_selections(&self, paths: &[PathBuf]) -> Result<FileSelection, FsError> {
        if paths.len() > 100 {
            return Err(FsError::Other(anyhow::anyhow!(
                "Choose up to 100 files at a time."
            )));
        }
        let mut selected = std::collections::BTreeSet::new();
        for path in paths {
            let path = path.canonicalize()?;
            if !path.is_file()
                || crate::watcher::is_office_lock_file(&path)
                || crate::watcher::is_bridge_staging_file(&path)
            {
                return Err(FsError::Other(anyhow::anyhow!(
                    "Choose regular files, without Office lock or temporary files."
                )));
            }
            selected.insert(path);
        }
        let mut selection = FileSelection::default();
        for path in &selected {
            if let Some(file) = self.synced_file(path) {
                selection.already_synced.push(file);
            } else {
                selection.added.push(self.add_native_file_selection(path)?);
            }
        }
        Ok(selection)
    }

    /// Which grant already carries this file, and where it sits within it.
    fn synced_file(&self, path: &Path) -> Option<SyncedFile> {
        let grants = self.grants.read().unwrap();
        let grant = grants
            .values()
            .find(|grant| grant.selected_file.is_some() && grant.selection_path() == path)
            .or_else(|| {
                grants
                    .values()
                    .filter(|grant| grant.selected_file.is_none() && path.starts_with(&grant.root))
                    .min_by_key(|grant| grant.root.components().count())
            })?;
        let relative = path.strip_prefix(&grant.root).ok()?;
        Some(SyncedFile {
            grant_id: grant.id.clone(),
            relative_path: relative
                .components()
                .map(|part| part.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/"),
        })
    }

    pub fn restore_file_grant(
        &self,
        id: String,
        label: String,
        root: &Path,
        name: &Path,
    ) -> Result<Grant, FsError> {
        if name.components().count() != 1
            || !matches!(name.components().next(), Some(Component::Normal(_)))
            || looks_like_windows_absolute(name)
            || name.to_string_lossy().contains(['/', '\\'])
        {
            return Err(FsError::GrantEscape);
        }
        let root = root.canonicalize().unwrap_or_else(|_| root.to_owned());
        let mut grants = self.grants.write().unwrap();
        if let Some(existing) = grants
            .values()
            .find(|grant| grant.root == root && grant.selected_file.as_deref() == Some(name))
        {
            return Ok(existing.clone());
        }
        let grant = Grant {
            id,
            label,
            root,
            selected_file: Some(name.to_owned()),
        };
        grants.insert(grant.id.clone(), grant.clone());
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
            .find(|grant| grant.root == normalized_root && grant.selected_file.is_none())
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
            selected_file: None,
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
        // Refuse host-absolute paths and any Windows drive/UNC form even when
        // this process is running on Unix. Relative grant paths arrive as
        // strings from Bridge clients; on Linux `C:\secret` is one Normal
        // component (backslash is not a separator), so is_absolute()/Prefix
        // alone would silently accept a Windows absolute escape.
        if relative.is_absolute()
            || looks_like_windows_absolute(relative)
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
        if grant
            .selected_file
            .as_deref()
            .is_some_and(|name| relative != name)
        {
            return Err(FsError::GrantEscape);
        }
        let candidate = grant.root.join(relative);
        let canonical = if candidate.exists() {
            candidate.canonicalize()?
        } else {
            let mut ancestor = candidate.as_path();
            let mut missing = Vec::new();
            while !ancestor.exists() {
                missing.push(ancestor.file_name().ok_or(FsError::GrantEscape)?.to_owned());
                ancestor = ancestor.parent().ok_or(FsError::GrantEscape)?;
            }
            let mut canonical = ancestor.canonicalize()?;
            for component in missing.into_iter().rev() {
                canonical.push(component);
            }
            canonical
        };
        if !grant.permits_path(&canonical) {
            return Err(FsError::GrantEscape);
        }
        Ok(canonical)
    }
}

fn looks_like_windows_absolute(path: &Path) -> bool {
    let raw = path.as_os_str().to_string_lossy();
    let bytes = raw.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return true;
    }
    raw.starts_with(r"\\") || raw.starts_with("//")
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

/// Resolve the same durable resource path for preflight and the actual write.
pub fn resolve_write_target(
    grants: &GrantRegistry,
    journal: &Journal,
    grant_id: &str,
    resource_id: &str,
    relative_path: &Path,
) -> Result<PathBuf, FsError> {
    let resource = journal.resource_by_id(resource_id)?;
    if resource
        .as_ref()
        .is_some_and(|record| !record.grant_id.is_empty() && record.grant_id != grant_id)
    {
        return Err(FsError::GrantEscape);
    }
    let journal_path = resource.map(|record| PathBuf::from(record.path_key.replace('\\', "/")));
    grants.resolve(grant_id, journal_path.as_deref().unwrap_or(relative_path))
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedWrite {
    pub operation_id: String,
    /// The hash read back from the durable target, never an echoed request
    /// target. The Bridge sends this value to Cloud as acknowledgement proof.
    pub verified_revision: String,
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
        Ok(self.write_with_readback(request)?.operation_id)
    }

    pub fn write_with_readback(&self, request: WriteRequest<'_>) -> Result<VerifiedWrite, FsError> {
        // The durable file is the journal resource, not a cloud relativePath
        // that may still name a sibling copy of the same bytes.
        let target = resolve_write_target(
            &self.grants,
            &self.journal,
            request.grant_id,
            request.resource_id,
            request.relative_path,
        )?;
        // Distinct replica IDs or requests can still name the same local file.
        // Serialize the check/replace/readback sequence across SafeWriter instances.
        let write_lock = self.grants.write_lock(&target);
        let _write_guard = write_lock.lock().unwrap();
        let pre_hash = target.exists().then(|| sha256_file(&target)).transpose()?;
        let op = self.journal.begin_intent(
            request.idempotency_key,
            "file.write",
            Some(request.resource_id),
            Some(request.base_revision),
            pre_hash.as_deref(),
        )?;
        if op.state == OpState::Verified {
            // A verified journal record makes acknowledgement replay safe, but
            // it does not authorize overwriting a newer external revision.
            // Re-read the target before reusing the durable result.
            if target.exists() {
                let verified_revision = sha256_file(&target)?;
                if verified_revision == request.expected_hash {
                    return Ok(VerifiedWrite {
                        operation_id: op.op_id,
                        verified_revision,
                    });
                }
            }
            return Err(FsError::StaleRevision);
        }
        if target.exists() {
            let verified_revision = sha256_file(&target)?;
            if verified_revision == request.expected_hash {
                self.journal.transition(
                    &op.op_id,
                    OpState::Verified,
                    Some(&verified_revision),
                    None,
                )?;
                return Ok(VerifiedWrite {
                    operation_id: op.op_id,
                    verified_revision,
                });
            }
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
        if target.exists()
            && (office_lock_exists_with(self.platform.as_ref(), &target)
                || self.platform.is_locked(&target)?)
        {
            return Err(FsError::FileLocked);
        }
        let parent = target.parent().ok_or(FsError::GrantEscape)?;
        let temp = parent.join(format!(".spectra-{}.tmp", op.op_id));
        let result = (|| -> Result<String, FsError> {
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
            // Downloading and staging can outlive the caller's base check.
            // Recheck both identity and bytes immediately before replacement.
            if resolve_write_target(
                &self.grants,
                &self.journal,
                request.grant_id,
                request.resource_id,
                request.relative_path,
            )? != target
            {
                return Err(FsError::StaleRevision);
            }
            let _permission = self.grants.hold_grant(request.grant_id, &[&target])?;
            if target.exists() {
                if office_lock_exists_with(self.platform.as_ref(), &target)
                    || self.platform.is_locked(&target)?
                {
                    return Err(FsError::FileLocked);
                }
                if sha256_file(&target)? != request.base_revision {
                    return Err(FsError::StaleRevision);
                }
            } else if !request
                .base_revision
                .strip_prefix("new:")
                .is_some_and(|id| !id.is_empty())
            {
                return Err(FsError::StaleRevision);
            }
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
            let verified_revision = sha256_file(&target)?;
            if verified_revision != request.expected_hash {
                return Err(FsError::VerificationFailed);
            }
            self.journal.transition(
                &op.op_id,
                OpState::Verified,
                Some(request.expected_hash),
                None,
            )?;
            Ok(verified_revision)
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
        Ok(VerifiedWrite {
            operation_id: op.op_id,
            verified_revision: result?,
        })
    }

    pub fn recycle(
        &self,
        grant_id: &str,
        relative_path: &Path,
        resource_id: &str,
        idempotency_key: &str,
    ) -> Result<String, FsError> {
        self.recycle_with_base(grant_id, relative_path, resource_id, idempotency_key, None)
    }

    pub fn recycle_with_base(
        &self,
        grant_id: &str,
        relative_path: &Path,
        resource_id: &str,
        idempotency_key: &str,
        expected_revision: Option<&str>,
    ) -> Result<String, FsError> {
        let target = self.grants.resolve(grant_id, relative_path)?;
        let lock = self.grants.write_lock(&target);
        let _guard = lock.lock().unwrap();
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
        if office_lock_exists_with(self.platform.as_ref(), &target)
            || self.platform.is_locked(&target)?
        {
            return Err(FsError::FileLocked);
        }
        if let Some(expected) = expected_revision {
            if sha256_file(&target)? != expected {
                return Err(FsError::StaleRevision);
            }
        }
        let _permission = self.grants.hold_grant(grant_id, &[&target])?;
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
        self.relocate_with_base(
            grant_id,
            source_relative_path,
            target_relative_path,
            resource_id,
            idempotency_key,
            None,
        )
    }

    pub fn relocate_with_base(
        &self,
        grant_id: &str,
        source_relative_path: &Path,
        target_relative_path: &Path,
        resource_id: &str,
        idempotency_key: &str,
        expected_revision: Option<&str>,
    ) -> Result<String, FsError> {
        // Reserve before touching the filesystem so receipt replay cannot
        // silently select a second collision suffix after the first move.
        let reserved = self.journal.reserve_structure_target(
            idempotency_key,
            &target_relative_path.to_string_lossy().replace('\\', "/"),
        )?;
        let source = self.grants.resolve(grant_id, source_relative_path)?;
        let target = self.grants.resolve(grant_id, Path::new(&reserved))?;
        if source == target {
            return Err(FsError::Other(anyhow::anyhow!(
                "source and target are identical"
            )));
        }
        let (first, second) = if source < target {
            (&source, &target)
        } else {
            (&target, &source)
        };
        let first_lock = self.grants.write_lock(first);
        let second_lock = self.grants.write_lock(second);
        let _first_guard = first_lock.lock().unwrap();
        let _second_guard = second_lock.lock().unwrap();
        if let Some(existing) = self.journal.by_key(idempotency_key)? {
            if existing.kind != "fs.move" || existing.resource_id.as_deref() != Some(resource_id) {
                return Err(FsError::StaleRevision);
            }
            if !source.exists() && target.is_file() && existing.pre_hash.is_some() {
                let actual = sha256_file(&target)?;
                if existing.pre_hash.as_deref() == Some(actual.as_str()) {
                    self.journal.transition(
                        &existing.op_id,
                        OpState::Verified,
                        Some(&actual),
                        None,
                    )?;
                    return Ok(existing.op_id);
                }
            }
            if existing.state == OpState::Verified {
                return Err(FsError::StaleRevision);
            }
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
        if expected_revision.is_some() && pre_hash.as_deref() != expected_revision {
            return Err(FsError::StaleRevision);
        }
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
        let _permission = self.grants.hold_grant(grant_id, &[&source, &target])?;
        fs::create_dir_all(parent)?;
        if office_lock_exists_with(self.platform.as_ref(), &source)
            || self.platform.is_locked(&source)?
        {
            return Err(FsError::FileLocked);
        }
        if target.exists() {
            return Err(FsError::Other(anyhow::anyhow!(
                "destination already exists"
            )));
        }
        if let Some(expected) = expected_revision {
            if sha256_file(&source)? != expected {
                return Err(FsError::StaleRevision);
            }
        }
        fs::rename(&source, &target)?;
        self.journal
            .transition(&op.op_id, OpState::Performed, pre_hash.as_deref(), None)?;
        if source.exists()
            || !target.exists()
            || (pre_hash.is_some() && sha256_file(&target).ok().as_deref() != pre_hash.as_deref())
        {
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
        revoke_at_staging: Option<(Arc<GrantRegistry>, String)>,
        held_at_readback: Option<Arc<GrantRegistry>>,
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
        fn before_write(&self, _: &Path) -> std::io::Result<()> {
            if let Some((grants, id)) = &self.revoke_at_staging {
                grants.remove(id);
            }
            Ok(())
        }
        fn readback_ready(&self, _: &Path) -> std::io::Result<()> {
            if let Some(grants) = &self.held_at_readback {
                assert!(grants.grants.try_write().is_err(), "permission removal raced native readback");
            }
            Ok(())
        }
    }

    #[test]
    fn individual_selection_never_authorizes_siblings_and_survives_replacement() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("chosen.txt");
        fs::write(&file, b"chosen").unwrap();
        fs::write(dir.path().join("private.txt"), b"private").unwrap();
        let grants = GrantRegistry::default();
        let grant = grants.add_native_file_selection(&file).unwrap();
        assert_eq!(
            grants.resolve(&grant.id, Path::new("chosen.txt")).unwrap(),
            file.canonicalize().unwrap()
        );
        for denied in [
            "private.txt",
            "new.txt",
            "../chosen.txt",
            "sub/chosen.txt",
            "",
        ] {
            assert!(matches!(
                grants.resolve(&grant.id, Path::new(denied)),
                Err(FsError::GrantEscape)
            ));
        }
        assert_eq!(
            grants.add_native_file_selection(&file).unwrap().id,
            grant.id
        );
        fs::remove_file(&file).unwrap();
        assert!(grant.is_available());
        assert!(grants.resolve(&grant.id, Path::new("chosen.txt")).is_ok());
        fs::write(&file, b"replacement").unwrap();
        assert!(grants.resolve(&grant.id, Path::new("chosen.txt")).is_ok());
        let parent = grants
            .add_native_selection("Parent".into(), dir.path())
            .unwrap();
        assert_eq!(
            grants
                .take_over_selections_within(&parent)
                .into_iter()
                .map(|taken| taken.id)
                .collect::<Vec<_>>(),
            vec![grant.id.clone()]
        );
        assert_eq!(grants.device_grants().len(), 1);
        let restored = GrantRegistry::default()
            .restore_file_grant(
                grant.id.clone(),
                grant.label.clone(),
                dir.path(),
                Path::new("chosen.txt"),
            )
            .unwrap();
        assert_eq!(restored.id, grant.id);
        assert!(!restored.permits_path(&dir.path().join("private.txt")));
    }

    #[test]
    fn multiselect_is_deduplicated_bounded_and_validated_before_granting() {
        let dir = tempdir().unwrap();
        let a = dir.path().join("a.txt");
        let b = dir.path().join("b.txt");
        fs::write(&a, b"a").unwrap();
        fs::write(&b, b"b").unwrap();
        let grants = GrantRegistry::default();
        assert!(
            grants
                .add_native_file_selections(&[a.clone(), dir.path().join("missing")])
                .is_err()
        );
        assert!(grants.device_grants().is_empty());
        assert!(
            grants
                .add_native_file_selections(&vec![a.clone(); 101])
                .is_err()
        );
        let first = grants
            .add_native_file_selections(&[a.clone(), b.clone(), a.clone()])
            .unwrap();
        assert_eq!(first.added.len(), 2);
        assert!(first.already_synced.is_empty());
        // Choosing them again adds nothing and refuses nothing.
        let again = grants
            .add_native_file_selections(&[a.clone(), b.clone()])
            .unwrap();
        assert!(again.added.is_empty());
        assert_eq!(again.already_synced.len(), 2);
        assert_eq!(grants.device_grants().len(), 2);
    }

    #[test]
    fn a_file_is_the_same_file_however_it_was_first_brought_in() {
        let dir = tempdir().unwrap();
        let nested = dir.path().join("unit 1");
        fs::create_dir(&nested).unwrap();
        let inside = nested.join("essay.docx");
        fs::write(&inside, b"a").unwrap();
        let outside_dir = tempdir().unwrap();
        let outside = outside_dir.path().join("loose.docx");
        fs::write(&outside, b"b").unwrap();

        let grants = GrantRegistry::default();
        let folder = grants
            .add_native_selection("Folder".into(), dir.path())
            .unwrap();
        // Part folder, part new: the new one is added, the other reported back.
        let selection = grants
            .add_native_file_selections(&[inside.clone(), outside.clone()])
            .unwrap();
        assert_eq!(selection.added.len(), 1);
        assert_eq!(selection.already_synced.len(), 1);
        assert_eq!(selection.already_synced[0].grant_id, folder.id);
        assert_eq!(selection.already_synced[0].relative_path, "unit 1/essay.docx");
        // A folder inside a synced folder is already here too.
        assert_eq!(
            grants
                .add_native_selection("Unit 1".into(), &nested)
                .unwrap()
                .id,
            folder.id
        );
        assert_eq!(grants.device_grants().len(), 2);
    }

    #[test]
    fn a_parent_folder_takes_over_what_was_chosen_inside_it() {
        let dir = tempdir().unwrap();
        let nested = dir.path().join("unit 1");
        fs::create_dir(&nested).unwrap();
        let file = dir.path().join("essay.docx");
        fs::write(&file, b"a").unwrap();
        let elsewhere = tempdir().unwrap();

        let grants = GrantRegistry::default();
        let chosen = grants.add_native_file_selection(&file).unwrap();
        let inner = grants
            .add_native_selection("Unit 1".into(), &nested)
            .unwrap();
        let other = grants
            .add_native_selection("Other".into(), elsewhere.path())
            .unwrap();
        let parent = grants
            .add_native_selection("All".into(), dir.path())
            .unwrap();
        let mut taken = grants
            .take_over_selections_within(&parent)
            .into_iter()
            .map(|grant| grant.id)
            .collect::<Vec<_>>();
        taken.sort();
        let mut expected = vec![chosen.id, inner.id];
        expected.sort();
        assert_eq!(taken, expected);
        let mut left = grants
            .device_grants()
            .into_iter()
            .map(|grant| grant.id)
            .collect::<Vec<_>>();
        left.sort();
        let mut expected = vec![parent.id, other.id];
        expected.sort();
        assert_eq!(left, expected);
    }

    #[test]
    fn persisted_file_scope_rejects_paths_and_keeps_missing_selection() {
        let dir = tempdir().unwrap();
        let grants = GrantRegistry::default();
        for name in ["../x", "sub/x", "sub\\x", "C:\\x", ".", ""] {
            assert!(
                grants
                    .restore_file_grant(
                        "grant_a".into(),
                        "Test".into(),
                        dir.path(),
                        Path::new(name)
                    )
                    .is_err()
            );
        }
        let grant = grants
            .restore_file_grant(
                "grant_saved".into(),
                "Missing.txt".into(),
                dir.path(),
                Path::new("Missing.txt"),
            )
            .unwrap();
        assert_eq!(grant.id, "grant_saved");
        assert!(grants.resolve(&grant.id, Path::new("Missing.txt")).is_ok());
        assert!(grants.resolve(&grant.id, Path::new("other.txt")).is_err());
    }

    #[test]
    fn isolated_file_write_uses_safe_replace_and_refuses_sibling_writes() {
        let dir = tempdir().unwrap();
        let chosen = dir.path().join("Chosen.txt");
        let sibling = dir.path().join("Private.txt");
        fs::write(&chosen, b"original").unwrap();
        fs::write(&sibling, b"private").unwrap();
        let grants = Arc::new(GrantRegistry::default());
        let grant = grants.add_native_file_selection(&chosen).unwrap();
        let writer = SafeWriter::new(
            grants,
            Arc::new(Journal::in_memory().unwrap()),
            Arc::new(TestPlatform::default()),
        );
        let base = hex::encode(Sha256::digest(b"original"));
        let target = hex::encode(Sha256::digest(b"updated"));
        let write = |path, key| WriteRequest {
            grant_id: &grant.id,
            relative_path: path,
            resource_id: "r",
            base_revision: &base,
            known_revision: &base,
            bytes: b"updated",
            expected_hash: &target,
            idempotency_key: key,
        };
        assert!(matches!(
            writer.write_with_readback(write(Path::new("Private.txt"), "denied")),
            Err(FsError::GrantEscape)
        ));
        assert!(
            writer
                .write_with_readback(write(Path::new("Chosen.txt"), "selected"))
                .is_ok()
        );
        assert_eq!(fs::read(chosen).unwrap(), b"updated");
        assert_eq!(fs::read(sibling).unwrap(), b"private");
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
            base_revision: "new:r",
            known_revision: "new:r",
            bytes,
            expected_hash: &hash,
            idempotency_key: "once",
        };
        let first = writer.write_with_readback(request()).unwrap();
        let modified = fs::metadata(dir.path().join("a.txt"))
            .unwrap()
            .modified()
            .unwrap();
        let replay = writer.write_with_readback(request()).unwrap();
        assert_eq!(first.operation_id, replay.operation_id);
        assert_eq!(first.verified_revision, hash);
        assert_eq!(replay.verified_revision, hash);
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
    fn revoked_staged_writes_stop_and_committing_writes_hold_permission_through_readback() {
        for revoke in [true, false] {
            let dir = tempdir().unwrap();
            let target = dir.path().join("a.txt");
            fs::write(&target, b"original").unwrap();
            let grants = Arc::new(GrantRegistry::default());
            let grant = grants.add_native_selection("Test".into(), dir.path()).unwrap();
            let platform = TestPlatform {
                revoke_at_staging: revoke.then(|| (grants.clone(), grant.id.clone())),
                held_at_readback: (!revoke).then(|| grants.clone()),
                ..TestPlatform::default()
            };
            let writer = SafeWriter::new(grants.clone(), Arc::new(Journal::in_memory().unwrap()), Arc::new(platform));
            let base = hex::encode(Sha256::digest(b"original"));
            let hash = hex::encode(Sha256::digest(b"new"));
            let result = writer.write(WriteRequest {
                grant_id: &grant.id, relative_path: Path::new("a.txt"),
                resource_id: "r", base_revision: &base, known_revision: &base,
                bytes: b"new", expected_hash: &hash, idempotency_key: "permission-boundary",
            });
            if revoke {
                assert!(matches!(result, Err(FsError::GrantNotFound)));
                assert_eq!(fs::read(&target).unwrap(), b"original");
            } else {
                result.unwrap();
                assert_eq!(fs::read(&target).unwrap(), b"new");
                assert!(grants.remove(&grant.id).is_some());
            }
            assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1, "staging file leaked");
        }
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
            Arc::new(TestPlatform { locked: true, ..TestPlatform::default() }),
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
        let base_hash = hex::encode(Sha256::digest(b"original"));
        writer
            .write(WriteRequest {
                grant_id: &grant.id,
                relative_path: Path::new("copy.txt"),
                resource_id: "lr_original",
                base_revision: &base_hash,
                known_revision: &base_hash,
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
    fn relocate_replay_keeps_the_reserved_collision_destination() {
        let dir = tempdir().unwrap();
        let grants = Arc::new(GrantRegistry::default());
        let grant = grants
            .add_native_selection("Test".into(), dir.path())
            .unwrap();
        fs::write(dir.path().join("before.txt"), b"move once").unwrap();
        let journal = Arc::new(Journal::in_memory().unwrap());
        let writer = SafeWriter::new(grants, journal.clone(), Arc::new(TestPlatform::default()));
        writer
            .relocate(
                &grant.id,
                Path::new("before.txt"),
                Path::new("after.txt"),
                "r",
                "move-receipt",
            )
            .unwrap();
        let reserved = journal
            .reserve_structure_target("move-receipt", "after (2).txt")
            .unwrap();
        assert_eq!(reserved, "after.txt");
        writer
            .relocate(
                &grant.id,
                Path::new("before.txt"),
                Path::new("after (2).txt"),
                "r",
                "move-receipt",
            )
            .unwrap();
        assert_eq!(
            fs::read(dir.path().join("after.txt")).unwrap(),
            b"move once"
        );
        assert!(!dir.path().join("after (2).txt").exists());
        fs::write(dir.path().join("after.txt"), b"new external bytes").unwrap();
        assert!(matches!(
            writer.relocate(
                &grant.id,
                Path::new("before.txt"),
                Path::new("after.txt"),
                "r",
                "move-receipt"
            ),
            Err(FsError::StaleRevision)
        ));
        assert_eq!(
            fs::read(dir.path().join("after.txt")).unwrap(),
            b"new external bytes"
        );
    }

    #[test]
    fn relocate_recovers_a_crash_after_rename_before_the_journal_receipt() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("mount");
        fs::create_dir(&root).unwrap();
        let grants = Arc::new(GrantRegistry::default());
        let grant = grants.add_native_selection("Test".into(), &root).unwrap();
        let journal_path = dir.path().join("journal.sqlite");
        {
            let journal = Journal::open(&journal_path).unwrap();
            fs::write(root.join("before.txt"), b"recover me").unwrap();
            let hash = sha256_file(&root.join("before.txt")).unwrap();
            journal
                .reserve_structure_target("move-crash", "after.txt")
                .unwrap();
            journal
                .begin_intent("move-crash", "fs.move", Some("r"), None, Some(&hash))
                .unwrap();
            fs::rename(root.join("before.txt"), root.join("after.txt")).unwrap();
        }
        let journal = Arc::new(Journal::open(&journal_path).unwrap());
        let writer = SafeWriter::new(grants, journal.clone(), Arc::new(TestPlatform::default()));
        writer
            .relocate(
                &grant.id,
                Path::new("before.txt"),
                Path::new("after (2).txt"),
                "r",
                "move-crash",
            )
            .unwrap();
        assert_eq!(
            journal.by_key("move-crash").unwrap().unwrap().state,
            OpState::Verified
        );
        assert_eq!(fs::read(root.join("after.txt")).unwrap(), b"recover me");
        assert!(!root.join("after (2).txt").exists());
    }

    #[test]
    fn relocate_validates_nested_destination_before_creating_parents() {
        let dir = tempdir().unwrap();
        let grants = Arc::new(GrantRegistry::default());
        let grant = grants
            .add_native_selection("Test".into(), dir.path())
            .unwrap();
        fs::write(dir.path().join("before.txt"), b"nested").unwrap();
        let writer = SafeWriter::new(
            grants,
            Arc::new(Journal::in_memory().unwrap()),
            Arc::new(TestPlatform::default()),
        );
        assert!(matches!(
            writer.relocate(
                &grant.id,
                Path::new("before.txt"),
                Path::new("../escape/new/file.txt"),
                "r",
                "escape"
            ),
            Err(FsError::GrantEscape)
        ));
        writer
            .relocate(
                &grant.id,
                Path::new("before.txt"),
                Path::new("safe/nested/file.txt"),
                "r",
                "nested",
            )
            .unwrap();
        assert_eq!(
            fs::read(dir.path().join("safe/nested/file.txt")).unwrap(),
            b"nested"
        );
    }

    #[test]
    fn structure_actions_refuse_changed_source_bytes() {
        let dir = tempdir().unwrap();
        let grants = Arc::new(GrantRegistry::default());
        let grant = grants
            .add_native_selection("Test".into(), dir.path())
            .unwrap();
        fs::write(dir.path().join("source.txt"), b"new external bytes").unwrap();
        let base = hex::encode(Sha256::digest(b"old bytes"));
        let writer = SafeWriter::new(
            grants,
            Arc::new(Journal::in_memory().unwrap()),
            Arc::new(TestPlatform::default()),
        );
        assert!(matches!(
            writer.relocate_with_base(
                &grant.id,
                Path::new("source.txt"),
                Path::new("target.txt"),
                "r",
                "stale-move",
                Some(&base)
            ),
            Err(FsError::StaleRevision)
        ));
        assert!(matches!(
            writer.recycle_with_base(
                &grant.id,
                Path::new("source.txt"),
                "r",
                "stale-delete",
                Some(&base)
            ),
            Err(FsError::StaleRevision)
        ));
        assert_eq!(
            fs::read(dir.path().join("source.txt")).unwrap(),
            b"new external bytes"
        );
        assert!(!dir.path().join("target.txt").exists());
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
