use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use sha2::{Digest, Sha256};
use spectra_bridge_core::fs::{FsError, GrantRegistry, SafeWriter, WriteRequest};
use spectra_bridge_core::journal::{Journal, OpState};
use spectra_bridge_core::platform::{OsFileIdentity, Platform};
use spectra_bridge_core::sync::{
    Backoff, ClaimPrecondition, CloudResult, accept_cloud_result, inspect_claim_target,
    inspect_write_target,
};
use spectra_bridge_core::watcher::{MountWatcher, StabilityTracker, WatcherConfig, scan_mount};
use tempfile::tempdir;

#[derive(Default)]
struct ChaosPlatform {
    fail_before_write: Option<io::ErrorKind>,
    vanish_parent: bool,
    readback_failures: AtomicUsize,
    external_write: Option<&'static [u8]>,
    delete_before_write: bool,
    lock_before_write: bool,
}

struct PlaceholderPlatform;

#[async_trait]
impl Platform for PlaceholderPlatform {
    fn file_identity(&self, _: &File) -> io::Result<OsFileIdentity> {
        Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "provider placeholder is not hydrated",
        ))
    }
    fn is_locked(&self, _: &Path) -> io::Result<bool> {
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

#[async_trait]
impl Platform for ChaosPlatform {
    fn file_identity(&self, _: &File) -> io::Result<OsFileIdentity> {
        Ok(OsFileIdentity {
            volume: 1,
            file_index: 1,
        })
    }
    fn is_locked(&self, _: &Path) -> io::Result<bool> {
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
    fn before_write(&self, target: &Path) -> io::Result<()> {
        if let Some(bytes) = self.external_write {
            fs::write(target, bytes)?;
        }
        if self.delete_before_write {
            fs::remove_file(target)?;
        }
        if self.lock_before_write {
            fs::write(target.with_file_name("~$rk.txt"), b"owner")?;
        }
        if self.vanish_parent {
            let _ = fs::remove_dir_all(target.parent().unwrap());
        }
        if let Some(kind) = self.fail_before_write {
            return Err(io::Error::new(kind, "injected fault"));
        }
        Ok(())
    }
    fn readback_ready(&self, _: &Path) -> io::Result<()> {
        let remaining = self.readback_failures.load(Ordering::SeqCst);
        if remaining > 0 {
            self.readback_failures.fetch_sub(1, Ordering::SeqCst);
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "antivirus busy",
            ));
        }
        Ok(())
    }
}

fn harness(
    platform: ChaosPlatform,
) -> (
    tempfile::TempDir,
    Arc<GrantRegistry>,
    String,
    Arc<Journal>,
    SafeWriter<ChaosPlatform>,
) {
    let dir = tempdir().unwrap();
    let grants = Arc::new(GrantRegistry::default());
    let grant = grants
        .add_native_selection("Chaos".into(), dir.path())
        .unwrap();
    let journal = Arc::new(Journal::in_memory().unwrap());
    let writer = SafeWriter::new(grants.clone(), journal.clone(), Arc::new(platform));
    (dir, grants, grant.id, journal, writer)
}

fn request<'a>(grant: &'a str, hash: &'a str, key: &'a str) -> WriteRequest<'a> {
    WriteRequest {
        grant_id: grant,
        relative_path: Path::new("work.txt"),
        resource_id: "resource",
        base_revision: "new:resource",
        known_revision: "new:resource",
        bytes: b"verified bytes",
        expected_hash: hash,
        idempotency_key: key,
    }
}

#[test]
fn kill_mid_write_replays_from_intent_and_removes_stale_temp() {
    let (dir, _, grant, journal, writer) = harness(ChaosPlatform::default());
    let hash = hex::encode(Sha256::digest(b"verified bytes"));
    let op = journal
        .begin_intent(
            "kill-mid-write",
            "file.write",
            Some("resource"),
            Some("base"),
            None,
        )
        .unwrap();
    fs::write(
        dir.path().join(format!(".spectra-{}.tmp", op.op_id)),
        b"partial",
    )
    .unwrap();
    writer
        .write(request(&grant, &hash, "kill-mid-write"))
        .unwrap();
    assert_eq!(
        fs::read(dir.path().join("work.txt")).unwrap(),
        b"verified bytes"
    );
    assert_eq!(
        journal.by_key("kill-mid-write").unwrap().unwrap().state,
        OpState::Verified
    );
}

#[test]
fn lost_ack_finds_target_hash_and_double_replay_is_harmless() {
    let (dir, _, grant, journal, writer) = harness(ChaosPlatform::default());
    let hash = hex::encode(Sha256::digest(b"verified bytes"));
    fs::write(dir.path().join("work.txt"), b"verified bytes").unwrap();
    let op = journal
        .begin_intent(
            "lost-ack",
            "file.write",
            Some("resource"),
            Some("base"),
            None,
        )
        .unwrap();
    journal
        .transition(&op.op_id, OpState::Performed, Some(&hash), None)
        .unwrap();
    writer.write(request(&grant, &hash, "lost-ack")).unwrap();
    writer.write(request(&grant, &hash, "lost-ack")).unwrap();
    assert_eq!(
        journal.by_key("lost-ack").unwrap().unwrap().state,
        OpState::Verified
    );
}

#[test]
fn claimed_replay_reaches_readback_after_replace_before_receipt() {
    let (dir, _, grant, journal, writer) = harness(ChaosPlatform::default());
    let path = dir.path().join("work.txt");
    let hash = hex::encode(Sha256::digest(b"verified bytes"));
    fs::write(&path, b"verified bytes").unwrap();
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    let op = journal
        .begin_intent(
            "receipt-crash",
            "file.write",
            Some("resource"),
            Some("base"),
            None,
        )
        .unwrap();
    journal
        .transition(&op.op_id, OpState::Performed, Some(&hash), None)
        .unwrap();
    assert_eq!(
        inspect_write_target(&ChaosPlatform::default(), &path, "base", Some(&hash)),
        ClaimPrecondition::Ready {
            revision: hash.clone()
        },
    );
    let mut replay = request(&grant, &hash, "receipt-crash");
    replay.base_revision = "base";
    replay.known_revision = &hash;
    assert_eq!(
        writer
            .write_with_readback(replay)
            .unwrap()
            .verified_revision,
        hash
    );
    assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), modified);

    fs::write(&path, b"subsequent external edit").unwrap();
    assert!(matches!(
        inspect_write_target(&ChaosPlatform::default(), &path, "base", Some(&hash)),
        ClaimPrecondition::Stale { .. },
    ));
    assert!(matches!(
        writer.write(request(&grant, &hash, "receipt-crash")),
        Err(FsError::StaleRevision)
    ));
    assert_eq!(fs::read(path).unwrap(), b"subsequent external edit");
}

#[test]
fn external_save_during_download_is_not_overwritten_by_a_cached_base() {
    let (dir, _, grant, _, writer) = harness(ChaosPlatform::default());
    let path = dir.path().join("work.txt");
    let base = hex::encode(Sha256::digest(b"original"));
    let hash = hex::encode(Sha256::digest(b"verified bytes"));
    fs::write(&path, b"external save during download").unwrap();
    let mut write = request(&grant, &hash, "download-race");
    write.base_revision = &base;
    write.known_revision = &base;
    assert!(matches!(writer.write(write), Err(FsError::StaleRevision)));
    assert_eq!(fs::read(path).unwrap(), b"external save during download");
}

#[test]
fn external_save_during_staging_is_not_overwritten() {
    let (dir, _, grant, _, writer) = harness(ChaosPlatform {
        external_write: Some(b"external staged edit"),
        ..Default::default()
    });
    let path = dir.path().join("work.txt");
    fs::write(&path, b"original").unwrap();
    let base = hex::encode(Sha256::digest(b"original"));
    let hash = hex::encode(Sha256::digest(b"verified bytes"));
    let mut write = request(&grant, &hash, "stage-race");
    write.base_revision = &base;
    write.known_revision = &base;
    assert!(matches!(writer.write(write), Err(FsError::StaleRevision)));
    assert_eq!(fs::read(path).unwrap(), b"external staged edit");
    assert_eq!(
        fs::read_dir(dir.path()).unwrap().count(),
        1,
        "temporary file is removed"
    );
}

#[test]
fn external_delete_during_staging_does_not_recreate_the_file() {
    let (dir, _, grant, _, writer) = harness(ChaosPlatform {
        delete_before_write: true,
        ..Default::default()
    });
    let path = dir.path().join("work.txt");
    fs::write(&path, b"original").unwrap();
    let base = hex::encode(Sha256::digest(b"original"));
    let hash = hex::encode(Sha256::digest(b"verified bytes"));
    let mut write = request(&grant, &hash, "delete-race");
    write.base_revision = &base;
    write.known_revision = &base;
    assert!(matches!(writer.write(write), Err(FsError::StaleRevision)));
    assert!(!path.exists());
}

#[test]
fn new_copy_refuses_a_target_created_during_staging() {
    let (dir, _, grant, _, writer) = harness(ChaosPlatform {
        external_write: Some(b"new external file"),
        ..Default::default()
    });
    let hash = hex::encode(Sha256::digest(b"verified bytes"));
    assert!(matches!(
        writer.write(request(&grant, &hash, "create-race")),
        Err(FsError::StaleRevision)
    ));
    assert_eq!(
        fs::read(dir.path().join("work.txt")).unwrap(),
        b"new external file"
    );
}

#[test]
fn office_lock_appearing_during_staging_parks_the_write() {
    let (dir, _, grant, _, writer) = harness(ChaosPlatform {
        lock_before_write: true,
        ..Default::default()
    });
    fs::write(dir.path().join("work.txt"), b"original").unwrap();
    let base = hex::encode(Sha256::digest(b"original"));
    let hash = hex::encode(Sha256::digest(b"verified bytes"));
    let mut write = request(&grant, &hash, "lock-race");
    write.base_revision = &base;
    write.known_revision = &base;
    assert!(matches!(writer.write(write), Err(FsError::FileLocked)));
    assert_eq!(fs::read(dir.path().join("work.txt")).unwrap(), b"original");
}

#[test]
fn concurrent_bridge_writers_cannot_both_replace_the_same_base() {
    let (dir, grants, grant, journal, _) = harness(ChaosPlatform::default());
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let handles = [b"first".as_slice(), b"second".as_slice()]
        .into_iter()
        .enumerate()
        .map(|(index, bytes)| {
            let grants = grants.clone();
            let grant = grant.clone();
            let journal = journal.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let writer = SafeWriter::new(grants, journal, Arc::new(ChaosPlatform::default()));
                let hash = hex::encode(Sha256::digest(bytes));
                barrier.wait();
                let mut write = request(&grant, &hash, if index == 0 { "first" } else { "second" });
                write.bytes = bytes;
                writer.write(write)
            })
        })
        .collect::<Vec<_>>();
    let results = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(FsError::StaleRevision)))
            .count(),
        1
    );
    let bytes = fs::read(dir.path().join("work.txt")).unwrap();
    assert!(bytes == b"first" || bytes == b"second");
}

#[test]
fn disk_full_leaves_original_untouched_and_failed_is_truthful() {
    let (dir, _, grant, journal, writer) = harness(ChaosPlatform {
        fail_before_write: Some(io::ErrorKind::StorageFull),
        ..Default::default()
    });
    fs::write(dir.path().join("work.txt"), b"original").unwrap();
    let hash = hex::encode(Sha256::digest(b"verified bytes"));
    assert!(
        matches!(writer.write(request(&grant, &hash, "disk-full")), Err(FsError::Io(error)) if error.kind() == io::ErrorKind::StorageFull)
    );
    assert_eq!(fs::read(dir.path().join("work.txt")).unwrap(), b"original");
    assert_eq!(
        journal.by_key("disk-full").unwrap().unwrap().state,
        OpState::Failed
    );
}

#[test]
fn antivirus_busy_after_rename_retries_then_verifies() {
    let (_dir, _grants, grant, journal, writer) = harness(ChaosPlatform {
        readback_failures: AtomicUsize::new(3),
        ..Default::default()
    });
    let hash = hex::encode(Sha256::digest(b"verified bytes"));
    writer
        .write(request(&grant, &hash, "busy-after-rename"))
        .unwrap();
    assert_eq!(
        journal.by_key("busy-after-rename").unwrap().unwrap().state,
        OpState::Verified
    );
}

#[test]
fn mount_vanish_mid_operation_is_failed_not_saved() {
    let (_dir, _grants, grant, journal, writer) = harness(ChaosPlatform {
        vanish_parent: true,
        ..Default::default()
    });
    let hash = hex::encode(Sha256::digest(b"verified bytes"));
    assert!(
        writer
            .write(request(&grant, &hash, "mount-vanish"))
            .is_err()
    );
    assert_eq!(
        journal.by_key("mount-vanish").unwrap().unwrap().state,
        OpState::Failed
    );
}

#[test]
fn restart_preserves_a_full_queue_and_cloud_rejects_stale_revision() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("journal.sqlite");
    {
        let journal = Journal::open(&path).unwrap();
        for index in 0..250 {
            journal
                .begin_intent(&format!("queued-{index}"), "file.write", None, None, None)
                .unwrap();
        }
    }
    assert_eq!(
        Journal::open(&path).unwrap().pending_ops().unwrap().len(),
        250
    );
    assert!(accept_cloud_result(CloudResult::StaleRevision).is_err());
}

#[test]
fn externally_deleted_claim_is_refused_before_safe_writer_can_recreate_it() {
    let dir = tempdir().unwrap();
    let missing = dir.path().join("removed.docx");
    assert_eq!(
        inspect_claim_target(&ChaosPlatform::default(), &missing, "base"),
        ClaimPrecondition::Missing
    );
    assert!(!missing.exists());
}

#[test]
fn new_local_copy_can_start_only_when_the_requested_target_is_absent() {
    let dir = tempdir().unwrap();
    let missing = dir.path().join("new-copy.docx");
    let sentinel = "new:work_123";
    assert_eq!(
        inspect_claim_target(&ChaosPlatform::default(), &missing, sentinel),
        ClaimPrecondition::Ready {
            revision: sentinel.to_owned()
        }
    );
    fs::write(&missing, b"unrelated existing file").unwrap();
    assert!(matches!(
        inspect_claim_target(&ChaosPlatform::default(), &missing, sentinel),
        ClaimPrecondition::Stale { .. }
    ));
    assert_eq!(fs::read(missing).unwrap(), b"unrelated existing file");
}

#[test]
fn stale_claim_is_detected_before_payload_download_or_write() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("changed.docx");
    fs::write(&path, b"external bytes").unwrap();
    let expected = hex::encode(Sha256::digest(b"external bytes"));
    assert_eq!(
        inspect_claim_target(&ChaosPlatform::default(), &path, "old revision"),
        ClaimPrecondition::Stale { revision: expected }
    );
    assert_eq!(fs::read(path).unwrap(), b"external bytes");
}

#[test]
fn retrying_one_outbound_change_does_not_block_the_next() {
    let journal = Journal::in_memory().unwrap();
    let first = journal
        .begin_intent(
            "first-change",
            "cloud.report-change",
            Some("lr_1"),
            None,
            None,
        )
        .unwrap();
    let second = journal
        .begin_intent(
            "second-change",
            "cloud.report-change",
            Some("lr_2"),
            None,
            None,
        )
        .unwrap();
    journal
        .enqueue(&first.op_id, "outbound-change", "{}")
        .unwrap();
    journal
        .enqueue(&second.op_id, "outbound-change", "{}")
        .unwrap();
    let due = journal.due_queue(10).unwrap();
    journal
        .retry_queue(due[0].id, Backoff::delay_for_attempt(7, &due[0].op_id))
        .unwrap();
    let still_due = journal.due_queue(10).unwrap();
    assert_eq!(still_due.len(), 1);
    assert_eq!(still_due[0].op_id, second.op_id);
}

#[test]
fn slow_writer_pause_longer_than_quiescence_window_never_publishes_partial_bytes() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("slow-copy.docx");
    let mut writer = File::create(&path).unwrap();
    writer.write_all(b"partial package bytes").unwrap();
    writer.sync_all().unwrap();

    let started = Instant::now();
    let mut tracker = StabilityTracker::new(Duration::from_millis(750));
    assert_eq!(tracker.observe(&path, started).unwrap(), None);

    // A real copy can pause longer than the quiescence window while its writer
    // still owns the file. The partial prefix must not become a revision.
    assert_eq!(
        tracker
            .observe(&path, started + Duration::from_millis(800))
            .unwrap(),
        None,
    );

    writer.write_all(b" and final package bytes").unwrap();
    writer.sync_all().unwrap();
    drop(writer);
    assert_eq!(
        tracker
            .observe(&path, started + Duration::from_millis(900))
            .unwrap(),
        None,
    );
    assert!(
        tracker
            .observe(&path, started + Duration::from_millis(1_700))
            .unwrap()
            .is_some()
    );
}

#[test]
fn provider_placeholder_failure_is_explicit_instead_of_looking_deleted() {
    let dir = tempdir().unwrap();
    let root = dir.path().join("OneDrive");
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("online-only.docx"), b"placeholder").unwrap();

    let scan = scan_mount(&PlaceholderPlatform, &root).unwrap();
    assert!(
        scan.entries
            .iter()
            .all(|entry| entry.relative_path != "online-only.docx")
    );
    assert_eq!(scan.failures.len(), 1);
    assert_eq!(scan.failures[0].relative_path, "online-only.docx");
    assert!(scan.failures[0].reason.contains("not hydrated"));
}

#[test]
fn ten_thousand_file_repair_scan_is_single_bounded_walk() {
    let dir = tempdir().unwrap();
    for index in 0..10_000 {
        fs::write(dir.path().join(format!("{index:05}.docx")), b"x").unwrap();
    }

    let started = Instant::now();
    let scan = scan_mount(&ChaosPlatform::default(), dir.path()).unwrap();
    let elapsed = started.elapsed();
    assert_eq!(scan.entries.len(), 10_000);
    assert!(scan.failures.is_empty());
    assert!(
        elapsed < Duration::from_secs(10),
        "10k repair scan took {elapsed:?}"
    );
}

#[test]
fn quiet_mount_emits_no_watcher_delta_after_initial_snapshot() {
    let dir = tempdir().unwrap();
    for index in 0..100 {
        fs::write(dir.path().join(format!("{index:03}.docx")), b"x").unwrap();
    }
    let watcher = MountWatcher::start(dir.path(), WatcherConfig::default()).unwrap();
    std::thread::sleep(Duration::from_millis(100));
    let batch = watcher.drain_paths();
    assert!(batch.existing_files.is_empty());
    assert!(batch.missing_paths.is_empty());
    assert!(batch.failures.is_empty());
}
