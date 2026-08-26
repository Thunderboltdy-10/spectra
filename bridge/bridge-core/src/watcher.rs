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
        if is_office_lock_file(&path) {
            if let Some(parent) = path.parent() {
                match std::fs::read_dir(parent) {
                    Ok(entries) => {
                        for entry in entries {
                            match entry {
                                Ok(entry) => {
                                    let candidate = entry.path();
                                    if candidate.is_file() && !is_office_lock_file(&candidate) {
                                        existing.insert(candidate);
                                    }
                                }
                                Err(error) => failures.push(ScanFailure {
                                    relative_path: relative_key(root, parent),
                                    reason: error.to_string(),
                                }),
                            }
                        }
                    }
                    Err(error) => failures.push(ScanFailure {
                        relative_path: relative_key(root, &path),
                        reason: error.to_string(),
                    }),
                }
            }
            continue;
        }
        if path.is_dir() {
            for entry in WalkDir::new(&path).follow_links(false) {
                match entry {
                    Ok(entry)
                        if entry.file_type().is_file() && !is_office_lock_file(entry.path()) =>
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
            Ok(entry) if entry.path() != root && !is_office_lock_file(entry.path()) => {
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
    })
}

fn is_double_sync_path(path: &Path) -> bool {
    path.components().any(|component| {
        matches!(
            component
                .as_os_str()
                .to_string_lossy()
                .to_ascii_lowercase()
                .as_str(),
            "onedrive" | "dropbox" | "google drive" | "my drive"
        )
    })
}

pub fn is_office_lock_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("~$"))
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
    if office_lock_exists(path) {
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

    pub fn observe(&mut self, path: &Path, now: Instant) -> anyhow::Result<Option<String>> {
        if office_lock_exists(path) {
            self.candidates.remove(path);
            return Ok(None);
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

/// Returns whether Office currently owns the file through its owner lock.
/// This is intentionally public to the Bridge app so lock handling can stay
/// per-file; one open Word document must not stall an entire selected mount.
pub fn office_lock_exists(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let owner_name = if name.chars().count() > 2 {
        format!("~${}", name.chars().skip(2).collect::<String>())
    } else {
        format!("~${name}")
    };
    path.with_file_name(owner_name).exists()
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
        std::fs::write(dir.path().join("~$per.docx"), b"lock").unwrap();
        let mut tracker = StabilityTracker::new(Duration::from_millis(1));
        let now = Instant::now();
        assert_eq!(tracker.observe(&path, now).unwrap(), None);
        std::fs::remove_file(dir.path().join("~$per.docx")).unwrap();
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
    fn word_owner_file_name_matches_the_open_document() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("paper.docx");
        std::fs::write(&path, b"bytes").unwrap();
        std::fs::write(dir.path().join("~$per.docx"), b"lock").unwrap();
        assert!(office_lock_exists(&path));
    }

    #[test]
    fn provider_backed_roots_use_a_wider_stability_window() {
        let provider = Path::new(r"C:\Users\pablo\OneDrive\Documents\Physics");
        let ordinary = Path::new(r"C:\Users\pablo\Documents\Physics");
        assert!(
            WatcherConfig::for_root(provider).stability_window
                > WatcherConfig::default().stability_window
        );
        assert_eq!(
            WatcherConfig::for_root(ordinary).stability_window,
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
        assert_eq!(
            tracker
                .observe(&path, start + Duration::from_millis(900))
                .unwrap(),
            None
        );
        std::fs::write(&path, b"final provider bytes").unwrap();
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
