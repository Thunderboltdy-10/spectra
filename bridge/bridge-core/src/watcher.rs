use std::collections::{BTreeSet, HashMap};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use sha2::Digest;
use walkdir::WalkDir;

use crate::identity::local_resource_id;
use crate::platform::{HostPlatform, OsFileIdentity, Platform};

#[derive(Debug, Clone)]
pub struct WatcherConfig {
    pub stability_window: Duration,
    pub reconciliation_interval: Duration,
}
impl Default for WatcherConfig {
    fn default() -> Self {
        Self {
            stability_window: Duration::from_millis(750),
            // Watcher deltas are the normal engine. A full walk is only a
            // repair for missed OS events, not a five-minute sync rhythm.
            reconciliation_interval: Duration::from_secs(6 * 60 * 60),
        }
    }
}

impl WatcherConfig {
    /// Provider-backed folders can emit a short rewrite sequence after the
    /// user's save. Give that sequence one wider quiescence window so the
    /// Bridge reports the final revision instead of a phantom intermediate.
    pub fn for_root(root: &Path) -> Self {
        let mut config = Self::default();
        if is_double_sync_path(root) {
            config.stability_window = Duration::from_secs(2);
        }
        config
    }
}

pub struct MountWatcher {
    _watcher: RecommendedWatcher,
    events: std::sync::mpsc::Receiver<notify::Result<Event>>,
    root: PathBuf,
    pub config: WatcherConfig,
}

impl MountWatcher {
    pub fn start(root: &Path, config: WatcherConfig) -> notify::Result<Self> {
        let (sender, events) = std::sync::mpsc::channel();
        let mut watcher = notify::recommended_watcher(move |event| {
            let _ = sender.send(event);
        })?;
        watcher.watch(root, RecursiveMode::Recursive)?;
        Ok(Self {
            _watcher: watcher,
            events,
            root: root.to_owned(),
            config,
        })
    }
    pub fn drain(&self) -> Vec<notify::Result<Event>> {
        self.events.try_iter().collect()
    }

    pub fn drain_paths(&self) -> ChangeBatch {
        let mut paths = Vec::new();
        let mut errors = Vec::new();
        for event in self.drain() {
            match event {
                Ok(event) if matches!(event.kind, notify::EventKind::Access(_)) => {}
                Ok(event) => paths.extend(event.paths),
                Err(error) => errors.push(ScanFailure {
                    relative_path: "<watcher>".into(),
                    reason: error.to_string(),
                }),
            }
        }
        let mut batch = classify_changed_paths(&self.root, paths);
        batch.failures.extend(errors);
        batch
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScanEntry {
    pub local_resource_id: String,
    pub relative_path: String,
    pub is_directory: bool,
    pub size: u64,
    pub content_hash: Option<String>,
    pub double_sync_risk: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScanPage {
    pub entries: Vec<ScanEntry>,
    pub failures: Vec<ScanFailure>,
    pub next_cursor: Option<String>,
    /// Files whose bytes are only in a cloud provider. They are neither
    /// entries (reading them would download them) nor failures.
    #[serde(default)]
    pub online_only: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScanFailure {
    pub relative_path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChangeBatch {
    pub existing_files: Vec<PathBuf>,
    pub missing_paths: Vec<PathBuf>,
    pub failures: Vec<ScanFailure>,
}

pub fn classify_changed_paths(
    root: &Path,
    paths: impl IntoIterator<Item = PathBuf>,
) -> ChangeBatch {
    let mut existing = BTreeSet::new();
    let mut missing = BTreeSet::new();
    let mut failures = Vec::new();
    for path in paths {
        if path == root || !path.starts_with(root) {
            continue;
        }
        if is_bridge_staging_file(&path) {
            continue;
        }
        if is_office_lock_file(&path) {
            // Office creating or removing its owner file changes whether its
            // document may sync. Wake only that document: re-hashing every
            // sibling on each open and close makes a large folder thrash.
            existing.extend(office_lock_targets(&path));
            continue;
        }
        if path.is_dir() {
            for entry in WalkDir::new(&path).follow_links(false) {
                match entry {
                    Ok(entry)
                        if entry.file_type().is_file()
                            && !is_office_lock_file(entry.path())
                            && !is_bridge_staging_file(entry.path()) =>
                    {
                        existing.insert(entry.into_path());
                    }
                    Ok(_) => {}
                    Err(error) => failures.push(ScanFailure {
                        relative_path: error
                            .path()
                            .map(|path| relative_key(root, path))
                            .unwrap_or_else(|| relative_key(root, &path)),
                        reason: error.to_string(),
                    }),
                }
            }
        } else if path.is_file() {
            existing.insert(path);
        } else {
            missing.insert(path);
        }
    }
    ChangeBatch {
        existing_files: existing.into_iter().collect(),
        missing_paths: missing.into_iter().collect(),
        failures,
    }
}

pub fn relative_key(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

pub fn scan_page<P: Platform>(
    platform: &P,
    root: &Path,
    cursor: Option<&str>,
    limit: usize,
) -> anyhow::Result<ScanPage> {
    let limit = limit.clamp(1, 500);
    let snapshot = scan_mount(platform, root)?;
    let start = cursor
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let entries = snapshot
        .entries
        .iter()
        .skip(start)
        .take(limit)
        .cloned()
        .collect::<Vec<_>>();
    let next = start + entries.len();
    Ok(ScanPage {
        entries,
        failures: if start == 0 {
            snapshot.failures
        } else {
            Vec::new()
        },
        next_cursor: (next < snapshot.entries.len()).then(|| next.to_string()),
        online_only: if start == 0 { snapshot.online_only } else { 0 },
    })
}

/// A repair scan walks the selected tree exactly once. The caller pages the
/// resulting resources to the cloud; repeating the filesystem walk for every
/// cloud page would turn a 10k-file mount into quadratic local work.
pub fn scan_mount<P: Platform>(platform: &P, root: &Path) -> anyhow::Result<ScanPage> {
    let mut paths = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|entry| match entry {
            Ok(entry)
                if entry.path() != root
                    && !is_office_lock_file(entry.path())
                    && !is_bridge_staging_file(entry.path()) =>
            {
                Some((entry.path().to_owned(), Some(entry), None))
            }
            Ok(_) => None,
            Err(error) => Some((
                error.path().unwrap_or(root).to_owned(),
                None,
                Some(error.to_string()),
            )),
        })
        .collect::<Vec<_>>();
    paths.sort_by(|a, b| a.0.cmp(&b.0));
    let mut entries = Vec::with_capacity(paths.len());
    let mut failures = Vec::new();
    let mut online_only = 0;
    for (path, entry, walk_error) in &paths {
        if let Some(reason) = walk_error {
            failures.push(ScanFailure {
                relative_path: relative_key(root, path),
                reason: reason.clone(),
            });
            continue;
        }
        let Some(entry) = entry else { continue };
        let relative = relative_key(root, path);
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(error) => {
                failures.push(ScanFailure {
                    relative_path: relative,
                    reason: error.to_string(),
                });
                continue;
            }
        };
        let is_directory = metadata.is_dir();
        if !is_directory && platform.is_online_only(path, &metadata) {
            online_only += 1;
            continue;
        }
        let resource_id = if is_directory {
            format!(
                "dir_{}",
                &hex::encode(sha2::Sha256::digest(relative.as_bytes()))[..24]
            )
        } else {
            let file = match File::open(path) {
                Ok(file) => file,
                Err(error) => {
                    failures.push(ScanFailure {
                        relative_path: relative,
                        reason: error.to_string(),
                    });
                    continue;
                }
            };
            match platform.file_identity(&file) {
                Ok(identity) => local_resource_id(&identity),
                Err(error) => {
                    failures.push(ScanFailure {
                        relative_path: relative,
                        reason: error.to_string(),
                    });
                    continue;
                }
            }
        };
        entries.push(ScanEntry {
            local_resource_id: resource_id,
            relative_path: relative,
            is_directory,
            size: if is_directory { 0 } else { metadata.len() },
            content_hash: None,
            double_sync_risk: is_double_sync_path(path),
        });
    }
    Ok(ScanPage {
        entries,
        failures,
        next_cursor: None,
        online_only,
    })
}

fn is_double_sync_path(path: &Path) -> bool {
    path.components().any(|component| {
        let component = component.as_os_str().to_string_lossy().to_ascii_lowercase();
        component == "onedrive"
            || component.starts_with("onedrive - ")
            || component == "dropbox"
            || component.starts_with("dropbox - ")
            || component == "google drive"
            || component.starts_with("google drive - ")
            || component == "my drive"
    })
}

pub fn is_office_lock_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("~$"))
}

fn is_bridge_staging_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .and_then(|name| name.strip_prefix(".spectra-op_"))
        .and_then(|name| name.strip_suffix(".tmp"))
        .is_some_and(|id| id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit()))
}

/// The owner-file names Office may create for a document. Excel and
/// PowerPoint prefix the whole name with `~$`; Word replaces the first one or
/// two characters of longer names instead, depending on the name's length.
fn office_owner_file_names(name: &str) -> Vec<String> {
    let mut names = Vec::with_capacity(3);
    for skipped in 0..=2 {
        if skipped > 0 && name.chars().count() <= skipped {
            break;
        }
        let owner = format!("~${}", name.chars().skip(skipped).collect::<String>());
        if !names.contains(&owner) {
            names.push(owner);
        }
    }
    names
}

/// Maps an Office `~$` owner file back to the documents in the same folder it
/// may belong to. Every candidate is re-checked by the caller, so an ambiguous
/// owner name (Word's truncated form) conservatively wakes each of them.
pub fn office_lock_targets(lock_path: &Path) -> Vec<PathBuf> {
    let Some(lock_name) = lock_path.file_name().and_then(|name| name.to_str()) else {
        return Vec::new();
    };
    let (Some(dir), true) = (lock_path.parent(), lock_name.starts_with("~$")) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut targets = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_str()?;
            (!name.starts_with("~$")
                && office_owner_file_names(name)
                    .iter()
                    .any(|owner| owner == lock_name))
            .then(|| entry.path())
        })
        .collect::<Vec<_>>();
    targets.sort();
    targets
}

/// Office owns the file through an exclusive writer handle. A leftover `~$`
/// owner file after Word crashes is not a live hold: hashing and Keep in
/// Spectra must proceed. Compatibility Mode is the other way around — the
/// share-lock is present even when the owner-file name does not match.
pub fn file_held_by_office(path: &Path) -> bool {
    match HostPlatform.is_locked(path) {
        Ok(true) => true,
        Ok(false) => false,
        Err(_) => office_lock_exists(path),
    }
}

#[derive(Debug, Clone)]
struct Candidate {
    size: u64,
    modified: Option<SystemTime>,
    fingerprint: String,
    first_stable_at: Instant,
}

#[derive(Debug, Clone)]
struct FingerprintSnapshot {
    size: u64,
    modified: Option<SystemTime>,
    fingerprint: String,
}

#[derive(Debug)]
pub struct StableFileSnapshot {
    pub size: u64,
    pub fingerprint: String,
    pub os_identity: OsFileIdentity,
    modified: Option<SystemTime>,
    _reader_lease: File,
}

impl StableFileSnapshot {
    /// Reads the bytes through the same writer-exclusive lease used for the
    /// fingerprint. The lease remains held until the snapshot is dropped.
    pub fn read_bytes(&mut self) -> std::io::Result<Vec<u8>> {
        self._reader_lease.seek(SeekFrom::Start(0))?;
        let mut bytes = Vec::with_capacity(self.size as usize);
        self._reader_lease.read_to_end(&mut bytes)?;
        Ok(bytes)
    }
}

fn hash_reader(file: &mut File) -> std::io::Result<String> {
    let mut digest = sha2::Sha256::new();
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

fn fingerprint_snapshot(file: &mut File) -> anyhow::Result<Option<FingerprintSnapshot>> {
    let before = file.metadata()?;
    if !before.is_file() {
        return Ok(None);
    }
    let fingerprint = hash_reader(file)?;
    let after = file.metadata()?;
    let before_modified = before.modified().ok();
    let after_modified = after.modified().ok();
    if before.len() != after.len() || before_modified != after_modified {
        return Ok(None);
    }
    Ok(Some(FingerprintSnapshot {
        size: after.len(),
        modified: after_modified,
        fingerprint,
    }))
}

fn stable_file_snapshot_with(
    platform: &dyn Platform,
    path: &Path,
) -> anyhow::Result<Option<StableFileSnapshot>> {
    if office_lock_exists_with(platform, path) {
        return Ok(None);
    }
    let Some(mut file) = (match platform.open_stable_reader(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    }) else {
        return Ok(None);
    };
    let os_identity = platform.file_identity(&file)?;
    let Some(snapshot) = fingerprint_snapshot(&mut file)? else {
        return Ok(None);
    };
    Ok(Some(StableFileSnapshot {
        size: snapshot.size,
        fingerprint: snapshot.fingerprint,
        os_identity,
        modified: snapshot.modified,
        _reader_lease: file,
    }))
}

/// Reads and hashes through a platform handle that remains writer-exclusive
/// for the whole pass. `None` means the file is missing, Office-owned, or an
/// external writer still has an incompatible handle open.
pub fn stable_file_snapshot(path: &Path) -> anyhow::Result<Option<StableFileSnapshot>> {
    stable_file_snapshot_with(&HostPlatform, path)
}

pub struct StabilityTracker {
    window: Duration,
    candidates: HashMap<PathBuf, Candidate>,
    platform: Arc<dyn Platform>,
}

impl StabilityTracker {
    pub fn new(window: Duration) -> Self {
        Self {
            window,
            candidates: HashMap::new(),
            platform: Arc::new(HostPlatform),
        }
    }

    /// An OS change event invalidates metadata shortcuts, even when a provider
    /// preserves both size and mtime. Read/access notifications are excluded.
    pub fn mark_changed(&mut self, path: &Path) {
        self.candidates.remove(path);
    }

    pub fn observe(&mut self, path: &Path, now: Instant) -> anyhow::Result<Option<String>> {
        if office_lock_exists_with(self.platform.as_ref(), path)
            || is_online_only_with(self.platform.as_ref(), path)
        {
            self.candidates.remove(path);
            return Ok(None);
        }
        // Poll metadata while waiting for quiescence. A fresh writer-exclusive
        // hash is still mandatory at the deadline, including when a writer
        // preserved length and mtime, so this cannot authorize partial bytes.
        if let Some(candidate) = self.candidates.get(path) {
            if now.duration_since(candidate.first_stable_at) < self.window {
                let metadata = path.metadata()?;
                if metadata.len() == candidate.size
                    && metadata.modified().ok() == candidate.modified
                {
                    return Ok(None);
                }
            }
        }
        let (snapshot, writer_complete) =
            match stable_file_snapshot_with(self.platform.as_ref(), path)? {
                Some(snapshot) => (
                    FingerprintSnapshot {
                        size: snapshot.size,
                        modified: snapshot.modified,
                        fingerprint: snapshot.fingerprint,
                    },
                    true,
                ),
                None if path.is_file() => {
                    // An active writer may pause longer than the timer. We may
                    // remember its provisional fingerprint to preserve the
                    // quiescence history, but it can never authorize emission.
                    let mut file = File::open(path)?;
                    let Some(snapshot) = fingerprint_snapshot(&mut file)? else {
                        self.candidates.remove(path);
                        return Ok(None);
                    };
                    (snapshot, false)
                }
                None => {
                    self.candidates.remove(path);
                    return Ok(None);
                }
            };
        let current = (snapshot.size, snapshot.modified);
        let fingerprint = snapshot.fingerprint;
        match self.candidates.get_mut(path) {
            Some(candidate)
                if (candidate.size, candidate.modified, &candidate.fingerprint)
                    == (current.0, current.1, &fingerprint) =>
            {
                if writer_complete && now.duration_since(candidate.first_stable_at) >= self.window {
                    self.candidates.remove(path);
                    Ok(Some(fingerprint))
                } else {
                    Ok(None)
                }
            }
            Some(candidate) => {
                candidate.size = current.0;
                candidate.modified = current.1;
                candidate.fingerprint = fingerprint;
                candidate.first_stable_at = now;
                Ok(None)
            }
            None => {
                self.candidates.insert(
                    path.to_owned(),
                    Candidate {
                        size: current.0,
                        modified: current.1,
                        fingerprint,
                        first_stable_at: now,
                    },
                );
                Ok(None)
            }
        }
    }
}

/// Whether the file's bytes are only in a cloud provider (see
/// `Platform::is_online_only`). Missing files are not online-only.
pub fn is_online_only(path: &Path) -> bool {
    is_online_only_with(&HostPlatform, path)
}

fn is_online_only_with(platform: &dyn Platform, path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && platform.is_online_only(path, &metadata))
}

/// Returns whether Office currently owns the file through its owner lock.
/// This is intentionally public to the Bridge app so lock handling can stay
/// per-file; one open Word document must not stall an entire selected mount.
pub fn office_lock_exists(path: &Path) -> bool {
    office_lock_exists_with(&HostPlatform, path)
}

/// An owner file left behind by an Office crash is not a live hold where the
/// platform can prove it (Windows share modes). Otherwise it stays blocking.
pub fn office_lock_exists_with(platform: &dyn Platform, path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    office_owner_file_names(name).into_iter().any(|owner| {
        let owner = path.with_file_name(owner);
        owner.exists() && platform.owner_file_is_live(&owner)
    })
}

pub fn office_locks_present(root: &Path) -> bool {
    WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .any(|entry| {
            entry.file_type().is_file() && entry.file_name().to_string_lossy().starts_with("~$")
        })
}

pub fn office_lock_paths(root: &Path, limit: usize) -> Vec<String> {
    WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file() && entry.file_name().to_string_lossy().starts_with("~$")
        })
        .filter_map(|entry| {
            entry
                .path()
                .strip_prefix(root)
                .ok()
                .map(|path| path.to_string_lossy().replace('\\', "/"))
        })
        .take(limit.clamp(1, 500))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::{OsFileIdentity, Platform};
    use async_trait::async_trait;
    use std::io::Write;
    use tempfile::tempdir;

    struct TestPlatform;
    #[async_trait]
    impl Platform for TestPlatform {
        fn file_identity(&self, file: &File) -> std::io::Result<OsFileIdentity> {
            Ok(OsFileIdentity {
                volume: 1,
                file_index: file.metadata()?.len() as u128,
            })
        }
        fn is_locked(&self, _: &Path) -> std::io::Result<bool> {
            Ok(false)
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

    struct OnlineOnlyPlatform;
    #[async_trait]
    impl Platform for OnlineOnlyPlatform {
        fn file_identity(&self, file: &File) -> std::io::Result<OsFileIdentity> {
            TestPlatform.file_identity(file)
        }
        fn is_locked(&self, _: &Path) -> std::io::Result<bool> {
            Ok(false)
        }
        fn is_online_only(&self, path: &Path, _: &std::fs::Metadata) -> bool {
            path.file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with("cloud-"))
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
    fn online_only_placeholders_are_neither_read_nor_failures() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("cloud-essay.docx"), b"placeholder").unwrap();
        std::fs::write(dir.path().join("local-essay.docx"), b"bytes").unwrap();
        let scan = scan_mount(&OnlineOnlyPlatform, dir.path()).unwrap();
        assert_eq!(
            scan.entries
                .iter()
                .map(|entry| entry.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec!["local-essay.docx"]
        );
        assert!(
            scan.failures.is_empty(),
            "an online-only file must not keep the folder in repair retries"
        );
        assert_eq!(scan.online_only, 1);
        assert!(!is_online_only(&dir.path().join("local-essay.docx")));
        assert!(!is_online_only(&dir.path().join("missing.docx")));
    }

    #[test]
    fn staging_files_never_become_resources_or_missing_events() {
        let dir = tempdir().unwrap();
        let staged = dir
            .path()
            .join(format!(".spectra-op_{}.tmp", "a".repeat(32)));
        std::fs::write(&staged, b"uncommitted native payload").unwrap();
        std::fs::write(
            dir.path().join(".spectra-not-a-staging-file.tmp"),
            b"user file",
        )
        .unwrap();
        let scan = scan_mount(&TestPlatform, dir.path()).unwrap();
        assert_eq!(scan.entries.len(), 1);
        assert_eq!(
            scan.entries[0].relative_path,
            ".spectra-not-a-staging-file.tmp"
        );
        assert!(
            classify_changed_paths(dir.path(), [staged.clone()])
                .existing_files
                .is_empty()
        );
        std::fs::remove_file(&staged).unwrap();
        assert!(
            classify_changed_paths(dir.path(), [staged])
                .missing_paths
                .is_empty()
        );
    }

    #[test]
    fn quiescence_polls_defer_rehash_but_same_metadata_changes_are_checked_at_deadline() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("unchanged.txt");
        std::fs::write(&path, b"original").unwrap();
        let modified = path.metadata().unwrap().modified().unwrap();
        let now = Instant::now();
        let mut tracker = StabilityTracker::new(Duration::from_secs(1));
        assert_eq!(tracker.observe(&path, now).unwrap(), None);
        // Make a same-length edit and restore mtime: metadata cannot be proof
        // that bytes are unchanged. The deadline must still perform a hash.
        std::fs::write(&path, b"external").unwrap();
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(modified))
            .unwrap();
        assert_eq!(
            tracker
                .observe(&path, now + Duration::from_millis(500))
                .unwrap(),
            None
        );
        assert_eq!(
            tracker.candidates[&path].fingerprint,
            hex::encode(sha2::Sha256::digest(b"original"))
        );
        assert_eq!(
            tracker
                .observe(&path, now + Duration::from_secs(1))
                .unwrap(),
            None
        );
        assert_eq!(
            tracker
                .observe(&path, now + Duration::from_secs(2))
                .unwrap(),
            Some(hex::encode(sha2::Sha256::digest(b"external")))
        );
    }

    #[test]
    fn ten_thousand_entries_are_cursor_paginated() {
        let dir = tempdir().unwrap();
        for index in 0..10_000 {
            std::fs::write(dir.path().join(format!("{index:05}.txt")), b"x").unwrap();
        }
        let started = Instant::now();
        let first = scan_page(&TestPlatform, dir.path(), None, 200).unwrap();
        assert_eq!(first.entries.len(), 200);
        assert_eq!(first.next_cursor.as_deref(), Some("200"));
        eprintln!("10k scan first page: {:?}", started.elapsed());
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn slow_write_never_emits_mid_write() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("slow.txt");
        let mut tracker = StabilityTracker::new(Duration::from_millis(100));
        let start = Instant::now();
        let mut file = File::create(&path).unwrap();
        file.write_all(b"one").unwrap();
        file.sync_all().unwrap();
        assert_eq!(tracker.observe(&path, start).unwrap(), None);
        file.write_all(b"two").unwrap();
        file.sync_all().unwrap();
        assert_eq!(
            tracker
                .observe(&path, start + Duration::from_millis(120))
                .unwrap(),
            None
        );
        assert_eq!(
            tracker
                .observe(&path, start + Duration::from_millis(170))
                .unwrap(),
            None
        );
        file.write_all(b"three").unwrap();
        file.sync_all().unwrap();
        assert_eq!(
            tracker
                .observe(&path, start + Duration::from_millis(240))
                .unwrap(),
            None
        );
        drop(file);
        assert!(
            tracker
                .observe(&path, start + Duration::from_millis(360))
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn office_lock_suppresses_revision_until_cleared() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("paper.docx");
        std::fs::write(&path, b"bytes").unwrap();
        // Office keeps its owner file open for writing while the document is open.
        let owner = File::create(dir.path().join("~$paper.docx")).unwrap();
        let mut tracker = StabilityTracker::new(Duration::from_millis(1));
        let now = Instant::now();
        assert_eq!(tracker.observe(&path, now).unwrap(), None);
        drop(owner);
        std::fs::remove_file(dir.path().join("~$paper.docx")).unwrap();
        assert_eq!(
            tracker
                .observe(&path, now + Duration::from_millis(2))
                .unwrap(),
            None
        );
        assert!(
            tracker
                .observe(&path, now + Duration::from_millis(4))
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn office_lock_is_visible_at_mount_scope() {
        let dir = tempdir().unwrap();
        assert!(!office_locks_present(dir.path()));
        std::fs::write(dir.path().join("~$paper.docx"), b"lock").unwrap();
        assert!(office_locks_present(dir.path()));
    }

    #[test]
    fn scan_excludes_office_owner_lock_files() {
        let dir = tempdir().unwrap();
        std::fs::write(dir.path().join("~$paper.docx"), b"lock").unwrap();
        std::fs::write(dir.path().join("paper.docx"), b"bytes").unwrap();
        let page = scan_page(&TestPlatform, dir.path(), None, 20).unwrap();
        assert_eq!(page.entries.len(), 1);
        assert_eq!(page.entries[0].relative_path, "paper.docx");
    }

    #[test]
    fn owner_lock_probe_reports_paths_without_scanning_them_as_resources() {
        let dir = tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("nested")).unwrap();
        std::fs::write(dir.path().join("nested/~$paper.docx"), b"lock").unwrap();
        assert_eq!(
            office_lock_paths(dir.path(), 20),
            vec!["nested/~$paper.docx"]
        );
        assert!(
            scan_page(&TestPlatform, dir.path(), None, 20)
                .unwrap()
                .entries
                .iter()
                .all(|entry| !entry.relative_path.contains("~$"))
        );
    }

    #[test]
    fn every_office_owner_file_form_maps_to_its_document() {
        let dir = tempdir().unwrap();
        // Word replaces leading characters of longer names; Excel and
        // PowerPoint prefix the whole name.
        let cases = [
            ("Last-year essay.docx", "~$st-year essay.docx"),
            ("Budget.xlsx", "~$Budget.xlsx"),
            ("History deck.pptx", "~$History deck.pptx"),
            ("paper.docx", "~$paper.docx"),
            ("Überblick.docx", "~$erblick.docx"),
        ];
        for (document, owner) in cases {
            let path = dir.path().join(document);
            std::fs::write(&path, b"bytes").unwrap();
            let owner_path = dir.path().join(owner);
            let held = File::create(&owner_path).unwrap();
            assert!(is_office_lock_file(&owner_path));
            assert!(!is_office_lock_file(&path));
            assert!(office_lock_exists(&path), "{owner} should lock {document}");
            assert_eq!(office_lock_targets(&owner_path), vec![path.clone()]);
            assert_eq!(
                classify_changed_paths(dir.path(), [owner_path.clone()]).existing_files,
                vec![path.clone()],
                "an owner-file event wakes only its document"
            );
            drop(held);
            std::fs::remove_file(&owner_path).unwrap();
            assert!(!office_lock_exists(&path));
            assert_eq!(
                classify_changed_paths(dir.path(), [owner_path]).existing_files,
                vec![path],
                "removing the owner file wakes its document again"
            );
        }
    }

    #[test]
    fn owner_file_left_by_an_office_crash_does_not_strand_the_document() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("Budget.xlsx");
        std::fs::write(&path, b"bytes").unwrap();
        std::fs::write(dir.path().join("~$Budget.xlsx"), b"owner").unwrap();
        assert!(
            !file_held_by_office(&path),
            "a leftover owner file without a writer hold is not a live lock"
        );
        // Only a platform with share-mode proof can tell a crash leftover from
        // a live Office session; elsewhere the owner file keeps blocking.
        assert_eq!(office_lock_exists(&path), !cfg!(windows));
        let mut tracker = StabilityTracker::new(Duration::from_millis(1));
        let now = Instant::now();
        assert_eq!(tracker.observe(&path, now).unwrap(), None);
        assert_eq!(
            tracker
                .observe(&path, now + Duration::from_millis(2))
                .unwrap()
                .is_some(),
            cfg!(windows)
        );
    }

    #[test]
    fn provider_backed_roots_use_a_wider_stability_window() {
        // Build paths from components so this test exercises the same
        // provider-folder recognition on Windows, macOS, and Linux. The old
        // Windows-only spelling was one Path component on Unix and therefore
        // never tested the provider branches there.
        let provider = PathBuf::from_iter(["Users", "pablo", "OneDrive", "Documents", "Physics"]);
        let named_provider = PathBuf::from_iter([
            "Users",
            "pablo",
            "OneDrive - School",
            "Documents",
            "Physics",
        ]);
        let ordinary = PathBuf::from_iter(["Users", "pablo", "Documents", "Physics"]);
        assert!(
            WatcherConfig::for_root(&provider).stability_window
                > WatcherConfig::default().stability_window
        );
        assert!(
            WatcherConfig::for_root(&named_provider).stability_window
                > WatcherConfig::default().stability_window
        );
        assert_eq!(
            WatcherConfig::for_root(&ordinary).stability_window,
            WatcherConfig::default().stability_window
        );
    }

    #[test]
    fn provider_rewrite_emits_only_the_final_stable_revision() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("provider.docx");
        let start = Instant::now();
        let mut tracker = StabilityTracker::new(Duration::from_secs(2));
        std::fs::write(&path, b"first provider pass").unwrap();
        assert_eq!(tracker.observe(&path, start).unwrap(), None);
        std::fs::write(&path, b"second provider pass").unwrap();
        tracker.mark_changed(&path);
        assert_eq!(
            tracker
                .observe(&path, start + Duration::from_millis(900))
                .unwrap(),
            None
        );
        std::fs::write(&path, b"final provider bytes").unwrap();
        tracker.mark_changed(&path);
        assert_eq!(
            tracker
                .observe(&path, start + Duration::from_millis(1_800))
                .unwrap(),
            None
        );
        assert_eq!(
            tracker
                .observe(&path, start + Duration::from_millis(3_000))
                .unwrap(),
            None
        );
        let revision = tracker
            .observe(&path, start + Duration::from_millis(3_900))
            .unwrap()
            .expect("the final provider rewrite should settle once");
        assert_eq!(
            revision,
            hex::encode(sha2::Sha256::digest(b"final provider bytes"))
        );
        assert_eq!(
            tracker
                .observe(&path, start + Duration::from_millis(4_000))
                .unwrap(),
            None
        );
    }

    #[test]
    fn folder_event_expands_only_that_subtree() {
        let dir = tempdir().unwrap();
        let changed = dir.path().join("renamed");
        std::fs::create_dir_all(changed.join("nested")).unwrap();
        std::fs::write(changed.join("one.docx"), b"one").unwrap();
        std::fs::write(changed.join("nested/two.xlsx"), b"two").unwrap();
        std::fs::write(dir.path().join("untouched.pptx"), b"untouched").unwrap();

        let batch = classify_changed_paths(dir.path(), [changed]);
        let relative = batch
            .existing_files
            .iter()
            .map(|path| relative_key(dir.path(), path))
            .collect::<Vec<_>>();
        assert_eq!(
            relative,
            vec!["renamed/nested/two.xlsx", "renamed/one.docx"]
        );
        assert!(batch.missing_paths.is_empty());
    }

    #[test]
    fn removed_path_is_reported_without_scanning_the_mount() {
        let dir = tempdir().unwrap();
        let removed = dir.path().join("old/report.docx");
        let batch = classify_changed_paths(dir.path(), [removed.clone()]);
        assert!(batch.existing_files.is_empty());
        assert_eq!(batch.missing_paths, vec![removed]);
    }
}
