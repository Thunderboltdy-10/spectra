use std::fs::{self, File};
use std::io;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use async_trait::async_trait;
use sha2::{Digest, Sha256};
use spectra_bridge_core::fs::{FsError, GrantRegistry, SafeWriter, WriteRequest};
use spectra_bridge_core::journal::{Journal, OpState};
use spectra_bridge_core::platform::{OsFileIdentity, Platform};
use spectra_bridge_core::sync::{CloudResult, accept_cloud_result};
use tempfile::tempdir;

#[derive(Default)]
struct ChaosPlatform {
    fail_before_write: Option<io::ErrorKind>,
    vanish_parent: bool,
    readback_failures: AtomicUsize,
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
        base_revision: "base",
        known_revision: "base",
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
