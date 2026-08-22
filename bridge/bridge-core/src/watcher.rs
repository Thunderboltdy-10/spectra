use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use sha2::Digest;
use walkdir::WalkDir;

use crate::fs::sha256_file;
use crate::identity::local_resource_id;
use crate::platform::Platform;

#[derive(Debug, Clone)]
pub struct WatcherConfig {
    pub stability_window: Duration,
    pub reconciliation_interval: Duration,
}
impl Default for WatcherConfig {
    fn default() -> Self {
        Self {
            stability_window: Duration::from_millis(750),
            reconciliation_interval: Duration::from_secs(5 * 60),
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
            config,
        })
    }
    pub fn drain(&self) -> Vec<notify::Result<Event>> {
        self.events.try_iter().collect()
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
    pub next_cursor: Option<String>,
}

pub fn scan_page<P: Platform>(
    platform: &P,
    root: &Path,
    cursor: Option<&str>,
    limit: usize,
) -> anyhow::Result<ScanPage> {
    let limit = limit.clamp(1, 500);
    let mut paths = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.path() != root)
        .filter(|entry| !is_office_lock_file(entry.path()))
        .collect::<Vec<_>>();
    paths.sort_by(|a, b| a.path().cmp(b.path()));
    let start = cursor
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    let mut entries = Vec::with_capacity(limit);
    for entry in paths.iter().skip(start).take(limit) {
        let path = entry.path();
        let relative = path
            .strip_prefix(root)?
            .to_string_lossy()
            .replace('\\', "/");
        let metadata = entry.metadata()?;
        let is_directory = metadata.is_dir();
        let resource_id = if is_directory {
            format!(
                "dir_{}",
                hex::encode(sha2::Sha256::digest(relative.as_bytes()))[..24].to_string()
            )
        } else {
            let file = File::open(path)?;
            local_resource_id(&platform.file_identity(&file)?)
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
    let next = start + entries.len();
    Ok(ScanPage {
        entries,
        next_cursor: (next < paths.len()).then(|| next.to_string()),
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

pub struct StabilityTracker {
    window: Duration,
    candidates: HashMap<PathBuf, Candidate>,
}

impl StabilityTracker {
    pub fn new(window: Duration) -> Self {
        Self {
            window,
            candidates: HashMap::new(),
        }
    }

    pub fn observe(&mut self, path: &Path, now: Instant) -> anyhow::Result<Option<String>> {
        if office_lock_exists(path) {
            self.candidates.remove(path);
            return Ok(None);
        }
        let metadata = match path.metadata() {
            Ok(value) if value.is_file() => value,
            _ => {
                self.candidates.remove(path);
                return Ok(None);
            }
        };
        let current = (metadata.len(), metadata.modified().ok());
        // Provider-backed folders can rewrite bytes without changing size or
        // timestamp resolution. Include a content fingerprint in the
        // candidate identity so an intermediate revision cannot be emitted.
        let fingerprint = sha256_file(path)?;
        match self.candidates.get_mut(path) {
            Some(candidate)
                if (candidate.size, candidate.modified, &candidate.fingerprint)
                    == (current.0, current.1, &fingerprint) =>
            {
                if now.duration_since(candidate.first_stable_at) >= self.window {
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
}
