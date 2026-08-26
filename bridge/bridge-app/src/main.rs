use sha2::Digest;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use spectra_bridge_core::fs::{FsError, Grant, GrantRegistry, SafeWriter, WriteRequest};
use spectra_bridge_core::identity::{AdoptionCandidate, adopt, local_resource_id};
use spectra_bridge_core::journal::{Journal, OpState, ResourceRecord};
use spectra_bridge_core::platform::{HostPlatform, OsFileIdentity, Platform};
use spectra_bridge_core::protocol::{LocalMountStatus, PairingOffer};
use spectra_bridge_core::server::{LocalBridgeControl, ServerState, serve};
use spectra_bridge_core::sync::{
    Backoff, ClaimPrecondition, ClaimedWrite, DeliveredChange, DiscoveredRegistration,
    DiscoveredResource, QueuedChangeEnvelope, ReplicaMigrationPage, ReportedChange,
    claim_fs_request, claim_write, complete_fs_request, complete_write, detach_mount,
    discover_resources_page, drain_cloud_queue, exchange_pairing, inspect_claim_target,
    migrate_cloud_replica_page, reconcile_missing_resources, register_mount, resume_pairing,
    set_mount_availability, upload_resource_payload,
};
use spectra_bridge_core::watcher::{
    MountWatcher, StabilityTracker, WatcherConfig, office_lock_exists, office_lock_paths,
    relative_key, scan_mount, stable_file_snapshot,
};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::UpdaterExt;

struct BridgeRuntime {
    grants: Arc<GrantRegistry>,
    journal: Arc<Journal>,
}

fn resolve_bridge_data_dir(
    isolated_runtime: Option<std::ffi::OsString>,
    app_data_dir: std::path::PathBuf,
) -> anyhow::Result<std::path::PathBuf> {
    let Some(path) = isolated_runtime else {
        return Ok(app_data_dir);
    };
    let path = std::path::PathBuf::from(path);
    anyhow::ensure!(
        path.is_absolute(),
        "SPECTRA_BRIDGE_DATA_DIR must be absolute"
    );
    Ok(path)
}

#[derive(Clone)]
struct SpectraLocalControl {
    app: tauri::AppHandle,
    state: Arc<ServerState>,
    grants: Arc<GrantRegistry>,
    journal: Arc<Journal>,
}

impl SpectraLocalControl {
    fn mount_views(&self) -> Vec<MountView> {
        mount_views(&self.grants, &self.journal)
    }
}

#[async_trait::async_trait]
impl LocalBridgeControl for SpectraLocalControl {
    fn pairing_requested(&self) {
        // Pairing is initiated and completed from Spectra; the tray window stays hidden.
    }

    async fn auto_pair(&self, challenge: &str) -> Result<(), String> {
        let offer = self
            .state
            .take_pairing_offer(challenge)
            .map_err(|error| error.to_string())?;
        complete_pairing_offer(&offer, &self.state, &self.journal).await
    }

    async fn request_update(&self) -> Result<String, String> {
        request_bridge_update(&self.app).await
    }

    fn mounts(&self) -> Vec<LocalMountStatus> {
        self.mount_views()
            .into_iter()
            .map(|mount| LocalMountStatus {
                id: mount.id,
                label: mount.label,
                state: mount.state,
                detail: mount.detail,
                synced: mount.synced,
                total: mount.total,
                double_sync_risk: mount.double_sync_risk,
            })
            .collect()
    }

    async fn select_mount(&self) -> Result<(), String> {
        select_mount_impl(&self.app, &self.grants, &self.journal)
            .await
            .map(|_| ())
    }

    async fn retry_mount(&self, grant_id: &str) -> Result<(), String> {
        retry_mount_impl(grant_id, &self.grants, &self.journal).await
    }

    async fn remove_mount(&self, grant_id: &str) -> Result<(), String> {
        remove_mount_impl(grant_id, &self.grants, &self.journal).await
    }
}

#[cfg(windows)]
fn repair_windows_autostart_command() -> anyhow::Result<()> {
    use std::os::windows::process::CommandExt;
    use winreg::RegKey;
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    let executable = std::env::current_exe()?;
    let run = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(
        "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
        KEY_SET_VALUE,
    )?;
    let app_data =
        std::env::var_os("APPDATA").ok_or_else(|| anyhow::anyhow!("APPDATA is unavailable"))?;
    let shortcut = std::path::PathBuf::from(app_data)
        .join("Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Spectra Bridge.lnk");
    let working_directory = executable
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Bridge executable has no parent directory"))?;
    let status = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", "$service=New-Object -ComObject Schedule.Service;$service.Connect();$root=$service.GetFolder('\\');$definition=$service.NewTask(0);$definition.RegistrationInfo.Description='Starts Spectra Bridge immediately at user logon';$definition.Settings.Enabled=$true;$definition.Settings.StartWhenAvailable=$true;$definition.Settings.MultipleInstances=2;$trigger=$definition.Triggers.Create(9);$trigger.Enabled=$true;$trigger.UserId=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;$action=$definition.Actions.Create(0);$action.Path=$env:SPECTRA_BRIDGE_EXE;$action.Arguments='--autostart';$action.WorkingDirectory=$env:SPECTRA_BRIDGE_WORKDIR;$null=$root.RegisterTaskDefinition('Spectra Bridge',$definition,6,$null,$null,3,$null)"])
        .env("SPECTRA_BRIDGE_EXE", &executable)
        .env("SPECTRA_BRIDGE_WORKDIR", working_directory)
        .creation_flags(0x08000000)
        .status()?;
    anyhow::ensure!(status.success(), "Windows logon task could not be created");
    let _ = run.delete_value("Spectra Bridge");
    if shortcut.exists() {
        std::fs::remove_file(shortcut)?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn repair_windows_autostart_command() -> anyhow::Result<()> {
    Ok(())
}

fn record_process_start() {
    let Some(base) = std::env::var_os("APPDATA") else {
        return;
    };
    let directory = std::path::PathBuf::from(base).join("com.spectra.bridge");
    if std::fs::create_dir_all(&directory).is_err() {
        return;
    }
    use std::io::Write;
    if let Ok(mut log) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(directory.join("startup.log"))
    {
        let source = if std::env::args().any(|argument| argument == "--autostart") {
            "autostart"
        } else {
            "interactive"
        };
        let _ = writeln!(
            log,
            "{:?} {source} process started",
            std::time::SystemTime::now()
        );
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MountView {
    id: String,
    label: String,
    state: String,
    detail: String,
    synced: usize,
    total: usize,
    double_sync_risk: bool,
}

fn mount_views(grants: &GrantRegistry, journal: &Journal) -> Vec<MountView> {
    grants
        .device_grants()
        .into_iter()
        .map(|grant| {
            let value = journal
                .config(&format!("mount_status:{}", grant.id))
                .ok()
                .flatten()
                .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok())
                .unwrap_or_else(|| serde_json::json!({}));
            let double_sync_risk = journal
                .config(&format!("mount_double_sync:{}", grant.id))
                .ok()
                .flatten()
                .as_deref()
                == Some("true");
            let base_detail = value
                .get("detail")
                .and_then(|v| v.as_str())
                .unwrap_or("Selected on this device");
            let detail = if double_sync_risk {
                format!(
                    "{base_detail} Provider-managed folder detected; conflict windows may be wider."
                )
            } else {
                base_detail.to_owned()
            };
            MountView {
                id: grant.id,
                label: grant.label,
                state: value
                    .get("state")
                    .and_then(|v| v.as_str())
                    .unwrap_or("selected")
                    .to_owned(),
                detail,
                synced: value.get("synced").and_then(|v| v.as_u64()).unwrap_or(0) as usize,
                total: value.get("total").and_then(|v| v.as_u64()).unwrap_or(0) as usize,
                double_sync_risk,
            }
        })
        .collect()
}

fn set_mount_status(
    journal: &Journal,
    grant_id: &str,
    state: &str,
    detail: &str,
    synced: usize,
    total: usize,
) -> Result<(), String> {
    journal.set_config(&format!("mount_status:{grant_id}"), &serde_json::json!({ "state": state, "detail": detail, "synced": synced, "total": total }).to_string()).map_err(|error| error.to_string())
}

fn mount_root_key(grant: &Grant) -> String {
    let normalized = grant
        .device_root()
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .replace('/', "\\")
        .to_ascii_lowercase();
    hex::encode(sha2::Sha256::digest(normalized.as_bytes()))
}

fn deployment_url(journal: &Journal) -> Result<String, String> {
    if let Ok(url) = std::env::var("SPECTRA_CONVEX_URL") {
        journal
            .set_config("deployment_url", &url)
            .map_err(|error| error.to_string())?;
        return Ok(url);
    }
    #[cfg(debug_assertions)]
    if journal
        .config("deployment_url")
        .map_err(|error| error.to_string())?
        .is_none()
    {
        let url = "https://proper-orca-653.convex.cloud".to_owned();
        journal
            .set_config("deployment_url", &url)
            .map_err(|error| error.to_string())?;
        return Ok(url);
    }
    journal
        .config("deployment_url")
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "SPECTRA_CONVEX_URL is not configured".to_string())
}

async fn run_replica_migration(
    journal: &Journal,
    deployment: &str,
    credential: &str,
) -> Result<(), String> {
    if journal
        .config("replica_migration_complete")
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Ok(());
    }

    async fn pass(
        deployment: &str,
        credential: &str,
        dry_run: bool,
    ) -> Result<ReplicaMigrationPage, String> {
        let mut cursor: Option<String> = None;
        let mut total = ReplicaMigrationPage::default();
        loop {
            let page =
                migrate_cloud_replica_page(deployment, credential, cursor.as_deref(), dry_run)
                    .await
                    .map_err(|error| error.to_string())?;
            total.scanned += page.scanned;
            total.missing += page.missing;
            total.inserted += page.inserted;
            total.duplicates += page.duplicates;
            total.local_only += page.local_only;
            if page.is_done {
                break;
            }
            cursor = page.continue_cursor;
        }
        total.is_done = true;
        Ok(total)
    }

    let dry_run = pass(deployment, credential, true).await?;
    journal
        .set_config(
            "replica_migration_dry_run",
            &serde_json::to_string(&dry_run).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
    if dry_run.duplicates != 0.0 {
        return Err("replica migration found duplicate cloud replicas".into());
    }

    let cutover = pass(deployment, credential, false).await?;
    journal
        .set_config(
            "replica_migration_cutover",
            &serde_json::to_string(&cutover).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;

    let verify = pass(deployment, credential, true).await?;
    journal
        .set_config(
            "replica_migration_verify",
            &serde_json::to_string(&verify).map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
    if verify.missing != 0.0 || verify.duplicates != 0.0 {
        return Err("replica migration invariants did not hold".into());
    }
    journal
        .set_config("replica_migration_complete", "v1")
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn native_format(path: &std::path::Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("file")
        .to_ascii_lowercase()
}

fn carries_native_payload(format: &str) -> bool {
    [
        "docx",
        "docm",
        "dotx",
        "dotm",
        "xlsx",
        "xlsm",
        "xltx",
        "xltm",
        "xlam",
        "pptx",
        "pptm",
        "potx",
        "potm",
        "ppsx",
        "ppsm",
        "ppam",
        "spectra-pkg",
    ]
    .contains(&format)
}

fn media_type(format: &str) -> &'static str {
    match format {
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "docm" | "dotm" => "application/vnd.ms-word.document.macroEnabled.12",
        "dotx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
        "xlsx" | "xltx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xlsm" | "xltm" | "xlam" => "application/vnd.ms-excel.sheet.macroEnabled.12",
        "pptm" | "potm" | "ppsm" | "ppam" => {
            "application/vnd.ms-powerpoint.presentation.macroEnabled.12"
        }
        "potx" => "application/vnd.openxmlformats-officedocument.presentationml.template",
        "spectra-pkg" => "application/vnd.spectra.package+zip",
        _ => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }
}

fn derived_change_key(
    grant_id: &str,
    resource_id: &str,
    previous_path: Option<&str>,
    path: &str,
    before: Option<&str>,
    after: Option<&str>,
    op: &str,
) -> String {
    let mut digest = sha2::Sha256::new();
    for value in [
        "spectra-bridge-change-v1",
        grant_id,
        resource_id,
        previous_path.unwrap_or(""),
        path,
        before.unwrap_or(""),
        after.unwrap_or(""),
        op,
    ] {
        digest.update(value.as_bytes());
        digest.update([0]);
    }
    hex::encode(digest.finalize())
}

fn adopt_resource_record(
    grant: &Grant,
    journal: &Journal,
    path: &std::path::Path,
    hash: &str,
    os_identity: &OsFileIdentity,
    generation: u64,
) -> anyhow::Result<(ResourceRecord, Option<ResourceRecord>)> {
    let relative_path = relative_key(grant.device_root(), path);
    anyhow::ensure!(!relative_path.is_empty(), "changed path is the mount root");
    let candidates = journal
        .resources_for_grant(&grant.id)?
        .into_iter()
        .map(|resource| AdoptionCandidate {
            local_resource_id: resource.local_resource_id,
            path_key: resource.path_key,
            content_hash: resource.content_hash.unwrap_or_default(),
            os_identity: match (resource.volume, resource.file_index) {
                (Some(volume), Some(file_index)) => Some(OsFileIdentity { volume, file_index }),
                _ => None,
            },
            available: resource.available,
            last_seen_generation: resource.last_seen_generation,
        })
        .collect::<Vec<_>>();
    let adopted_id = adopt(
        &candidates,
        Some(os_identity),
        &relative_path,
        hash,
        generation,
    )
    .map(|candidate| candidate.local_resource_id.clone())
    .unwrap_or_else(|| local_resource_id(os_identity));
    let previous = journal.resource_by_id(&adopted_id)?;
    Ok((
        ResourceRecord {
            local_resource_id: adopted_id,
            grant_id: grant.id.clone(),
            path_key: relative_path,
            volume: Some(os_identity.volume),
            file_index: Some(os_identity.file_index),
            content_hash: Some(hash.to_owned()),
            revision: previous
                .as_ref()
                .and_then(|resource| resource.revision.clone()),
            available: true,
            unavailable_reason: None,
            last_seen_generation: generation,
        },
        previous,
    ))
}

fn enqueue_stable_change(
    grant: &Grant,
    journal: &Journal,
    path: &std::path::Path,
    hash: &str,
    generation: u64,
) -> anyhow::Result<bool> {
    let snapshot = stable_file_snapshot(path)?
        .ok_or_else(|| anyhow::anyhow!("file writer is still active"))?;
    anyhow::ensure!(
        snapshot.fingerprint == hash,
        "file changed after its quiescence proof"
    );
    let (resource, previous) = adopt_resource_record(
        grant,
        journal,
        path,
        hash,
        &snapshot.os_identity,
        generation,
    )?;
    let unchanged = previous.as_ref().is_some_and(|candidate| {
        candidate.available
            && candidate.path_key == resource.path_key
            && candidate.content_hash.as_deref() == Some(hash)
            && candidate.revision.as_deref() == Some(hash)
    });
    journal.upsert_resource(&resource)?;
    if unchanged {
        return Ok(false);
    }
    let mount_id = journal
        .config(&format!("cloud_mount:{}", grant.id))?
        .ok_or_else(|| anyhow::anyhow!("cloud mount is not registered yet"))?;
    let before = previous.as_ref().and_then(|candidate| {
        candidate
            .content_hash
            .as_deref()
            .or(candidate.revision.as_deref())
    });
    let previous_path = previous
        .as_ref()
        .filter(|candidate| candidate.path_key != resource.path_key)
        .map(|candidate| candidate.path_key.as_str());
    let key = derived_change_key(
        &grant.id,
        &resource.local_resource_id,
        previous_path,
        &resource.path_key,
        before,
        Some(hash),
        "upsert",
    );
    let operation = journal.begin_intent(
        &key,
        "cloud.report-change",
        Some(&resource.local_resource_id),
        before,
        Some(hash),
    )?;
    if operation.state != OpState::Verified {
        let envelope = QueuedChangeEnvelope {
            grant_id: grant.id.clone(),
            mount_id,
            change: ReportedChange {
                journal_id: operation.op_id.clone(),
                resource_id: resource.local_resource_id,
                op: "upsert".into(),
                relative_path: Some(resource.path_key),
                previous_relative_path: previous_path.map(str::to_owned),
                hash: Some(hash.to_owned()),
                revision_before: before.map(str::to_owned),
                size: Some(snapshot.size),
                native_format: Some(native_format(path)),
            },
        };
        journal.enqueue(
            &operation.op_id,
            "outbound-change",
            &serde_json::to_string(&envelope)?,
        )?;
    }
    Ok(true)
}

fn enqueue_missing_path(
    grant: &Grant,
    journal: &Journal,
    path: &std::path::Path,
    generation: u64,
) -> anyhow::Result<usize> {
    let relative_path = relative_key(grant.device_root(), path);
    let mount_id = journal
        .config(&format!("cloud_mount:{}", grant.id))?
        .ok_or_else(|| anyhow::anyhow!("cloud mount is not registered yet"))?;
    let mut queued = 0;
    for resource in journal.resources_with_path_prefix(&grant.id, &relative_path)? {
        if !resource.available {
            continue;
        }
        journal.mark_resource_unavailable(
            &resource.local_resource_id,
            "missing-on-disk",
            generation,
        )?;
        let key = derived_change_key(
            &grant.id,
            &resource.local_resource_id,
            None,
            &resource.path_key,
            resource
                .content_hash
                .as_deref()
                .or(resource.revision.as_deref()),
            None,
            "unavailable",
        );
        let operation = journal.begin_intent(
            &key,
            "cloud.report-change",
            Some(&resource.local_resource_id),
            resource
                .content_hash
                .as_deref()
                .or(resource.revision.as_deref()),
            None,
        )?;
        if operation.state != OpState::Verified {
            let envelope = QueuedChangeEnvelope {
                grant_id: grant.id.clone(),
                mount_id: mount_id.clone(),
                change: ReportedChange {
                    journal_id: operation.op_id.clone(),
                    resource_id: resource.local_resource_id,
                    op: "unavailable".into(),
                    relative_path: Some(resource.path_key),
                    previous_relative_path: None,
                    hash: None,
                    revision_before: resource.content_hash.or(resource.revision),
                    size: None,
                    native_format: None,
                },
            };
            journal.enqueue(
                &operation.op_id,
                "outbound-change",
                &serde_json::to_string(&envelope)?,
            )?;
            queued += 1;
        }
    }
    Ok(queued)
}

fn enqueue_locked_path(
    grant: &Grant,
    journal: &Journal,
    path: &std::path::Path,
) -> anyhow::Result<usize> {
    let relative_path = relative_key(grant.device_root(), path);
    let mount_id = journal
        .config(&format!("cloud_mount:{}", grant.id))?
        .ok_or_else(|| anyhow::anyhow!("cloud mount is not registered yet"))?;
    let mut queued = 0;
    for resource in journal.resources_with_path_prefix(&grant.id, &relative_path)? {
        if !resource.available {
            continue;
        }
        let before = resource
            .content_hash
            .as_deref()
            .or(resource.revision.as_deref());
        let key = derived_change_key(
            &grant.id,
            &resource.local_resource_id,
            None,
            &resource.path_key,
            before,
            None,
            "locked",
        );
        let operation = journal.begin_intent(
            &key,
            "cloud.report-change",
            Some(&resource.local_resource_id),
            before,
            None,
        )?;
        if operation.state != OpState::Verified {
            let envelope = QueuedChangeEnvelope {
                grant_id: grant.id.clone(),
                mount_id: mount_id.clone(),
                change: ReportedChange {
                    journal_id: operation.op_id.clone(),
                    resource_id: resource.local_resource_id,
                    op: "locked".into(),
                    relative_path: Some(resource.path_key),
                    previous_relative_path: None,
                    hash: None,
                    revision_before: resource.content_hash.or(resource.revision),
                    size: None,
                    native_format: None,
                },
            };
            journal.enqueue(
                &operation.op_id,
                "outbound-change",
                &serde_json::to_string(&envelope)?,
            )?;
            queued += 1;
        }
    }
    Ok(queued)
}

async fn upload_discovered_resource(
    deployment: &str,
    credential: &str,
    grant: &Grant,
    resource: &DiscoveredResource,
    registration: &DiscoveredRegistration,
) -> anyhow::Result<()> {
    if !registration.needs_payload || !carries_native_payload(&resource.native_format) {
        return Ok(());
    }
    let replica_id = registration
        .replica_id
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("Bridge registration returned no replica id"))?;
    let relative = std::path::Path::new(&resource.relative_path);
    let candidate = grant.device_root().join(relative);
    anyhow::ensure!(candidate.exists(), "file disappeared before payload upload");
    anyhow::ensure!(
        !office_lock_exists(&candidate),
        "Office is still saving this file"
    );
    let canonical = candidate.canonicalize()?;
    anyhow::ensure!(
        canonical.starts_with(grant.device_root()),
        "payload path escaped its selected folder"
    );
    let mut snapshot = stable_file_snapshot(&canonical)?
        .ok_or_else(|| anyhow::anyhow!("file writer is still active"))?;
    let bytes = snapshot.read_bytes()?;
    let hash = hex::encode(sha2::Sha256::digest(&bytes));
    drop(snapshot);
    anyhow::ensure!(
        resource.content_hash.as_deref() == Some(hash.as_str()),
        "file changed before payload upload"
    );
    upload_resource_payload(
        deployment,
        credential,
        replica_id,
        &bytes,
        &hash,
        media_type(&resource.native_format),
    )
    .await?;
    Ok(())
}

async fn finish_delivered_change(
    grants: &Arc<GrantRegistry>,
    journal: &Arc<Journal>,
    deployment: &str,
    credential: &str,
    delivery: DeliveredChange,
) -> anyhow::Result<()> {
    let post_hash = delivery.envelope.change.hash.as_deref();
    if !delivery.result.needs_payload {
        return journal.acknowledge_change(
            &delivery.item,
            &delivery.envelope.change.resource_id,
            post_hash,
        );
    }
    let Some(replica_id) = delivery.result.replica_id.as_deref() else {
        return journal.fail_queue(
            &delivery.item,
            "payload-target-missing",
            "The cloud did not return a payload target",
        );
    };
    let Some(grant) = grants
        .device_grants()
        .into_iter()
        .find(|grant| grant.id == delivery.envelope.grant_id)
    else {
        return journal.fail_queue(
            &delivery.item,
            "grant-unavailable",
            "The selected folder is no longer available",
        );
    };
    let Some(relative_path) = delivery.envelope.change.relative_path.as_deref() else {
        return journal.fail_queue(
            &delivery.item,
            "payload-path-missing",
            "The queued payload path is missing",
        );
    };
    let target = match grants.resolve(&grant.id, std::path::Path::new(relative_path)) {
        Ok(path) => path,
        Err(error) => {
            return journal.fail_queue(&delivery.item, "payload-path-invalid", &error.to_string());
        }
    };
    if !target.exists() {
        journal.fail_queue(
            &delivery.item,
            "file-missing-before-upload",
            "The file was removed before its bytes could be uploaded",
        )?;
        let generation = journal.next_generation(&grant.id)?;
        let _ = enqueue_missing_path(&grant, journal, &target, generation);
        return Ok(());
    }
    if office_lock_exists(&target) {
        return journal.retry_queue(
            delivery.item.id,
            Backoff::delay_for_attempt(delivery.item.attempts),
        );
    }
    let mut snapshot = match stable_file_snapshot(&target) {
        Ok(Some(snapshot)) => snapshot,
        Ok(None) => {
            return journal.retry_queue(
                delivery.item.id,
                Backoff::delay_for_attempt(delivery.item.attempts),
            );
        }
        Err(_) => {
            return journal.retry_queue(
                delivery.item.id,
                Backoff::delay_for_attempt(delivery.item.attempts),
            );
        }
    };
    let bytes = match snapshot.read_bytes() {
        Ok(bytes) => bytes,
        Err(_) => {
            return journal.retry_queue(
                delivery.item.id,
                Backoff::delay_for_attempt(delivery.item.attempts),
            );
        }
    };
    let hash = hex::encode(sha2::Sha256::digest(&bytes));
    drop(snapshot);
    if post_hash != Some(hash.as_str()) {
        return journal.fail_queue(
            &delivery.item,
            "file-changed-before-upload",
            "The file changed again before its queued bytes could be uploaded",
        );
    }
    let format = delivery
        .envelope
        .change
        .native_format
        .as_deref()
        .unwrap_or("file");
    match upload_resource_payload(
        deployment,
        credential,
        replica_id,
        &bytes,
        &hash,
        media_type(format),
    )
    .await
    {
        Ok(_) => journal.acknowledge_change(
            &delivery.item,
            &delivery.envelope.change.resource_id,
            Some(&hash),
        ),
        Err(_) => journal.retry_queue(
            delivery.item.id,
            Backoff::delay_for_attempt(delivery.item.attempts),
        ),
    }
}

async fn run_sync(grant: &Grant, journal: &Journal) -> Result<(), String> {
    set_mount_status(
        journal,
        &grant.id,
        "scanning",
        "Reading folder metadata…",
        0,
        0,
    )?;
    let device_id = journal
        .config("device_id")
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Connect Spectra Bridge before adding a folder".to_string())?;
    let credential = HostPlatform
        .read_credential(&device_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Bridge credential is unavailable".to_string())?;
    let deployment = deployment_url(journal)?;
    let generation = journal
        .next_generation(&grant.id)
        .map_err(|error| error.to_string())?;
    let mut files = Vec::new();
    let owner_lock_paths = office_lock_paths(grant.device_root(), 500);
    let scan_id = uuid::Uuid::new_v4().to_string();
    let mut double_sync_risk = false;
    let mut locked_files = 0usize;
    let mut isolated_failures = 0usize;
    let mut scan_complete = true;
    let scan = scan_mount(&HostPlatform, grant.device_root()).map_err(|error| error.to_string())?;
    for _failure in scan.failures {
        isolated_failures += 1;
        scan_complete = false;
    }
    for entry in scan.entries {
        if entry.is_directory {
            continue;
        }
        double_sync_risk |= entry.double_sync_risk;
        let native_format = std::path::Path::new(&entry.relative_path)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
            .to_ascii_lowercase();
        let entry_path = grant.device_root().join(&entry.relative_path);
        let locked = office_lock_exists(&entry_path);
        if locked {
            locked_files += 1;
            scan_complete = false;
            continue;
        }
        let snapshot = match stable_file_snapshot(&entry_path) {
            Ok(Some(snapshot)) => snapshot,
            Ok(None) => {
                locked_files += 1;
                scan_complete = false;
                continue;
            }
            Err(_) => {
                isolated_failures += 1;
                scan_complete = false;
                continue;
            }
        };
        let content_hash = snapshot.fingerprint;
        let (record, _) = match adopt_resource_record(
            grant,
            journal,
            &entry_path,
            &content_hash,
            &snapshot.os_identity,
            generation,
        ) {
            Ok(record) => record,
            Err(_) => {
                isolated_failures += 1;
                scan_complete = false;
                continue;
            }
        };
        if journal.upsert_resource(&record).is_err() {
            isolated_failures += 1;
            scan_complete = false;
            continue;
        }
        files.push(DiscoveredResource {
            local_resource_id: record.local_resource_id,
            relative_path: entry.relative_path,
            size: snapshot.size,
            content_hash: Some(content_hash),
            native_format,
        });
    }
    set_mount_status(
        journal,
        &grant.id,
        "syncing",
        "Making files available in Spectra…",
        0,
        files.len(),
    )?;
    journal
        .set_config(
            &format!("mount_double_sync:{}", grant.id),
            if double_sync_risk { "true" } else { "false" },
        )
        .map_err(|error| error.to_string())?;
    let mount_id = register_mount(
        &deployment,
        &credential,
        &grant.label,
        &grant.id,
        &mount_root_key(grant),
        &scan_id,
        files.len(),
        double_sync_risk,
        &owner_lock_paths,
    )
    .await
    .map_err(|error| error.to_string())?;
    journal
        .set_config(&format!("cloud_mount:{}", grant.id), &mount_id)
        .map_err(|error| error.to_string())?;
    let mut processed = 0usize;
    for page in files.chunks(100) {
        let registrations = discover_resources_page(&deployment, &credential, &mount_id, page)
            .await
            .map_err(|error| error.to_string())?;
        for (resource, registration) in page.iter().zip(registrations.iter()) {
            processed += 1;
            if registration.skipped {
                if registration.reason.as_deref() != Some("approval-required") {
                    isolated_failures += 1;
                }
            } else if upload_discovered_resource(
                &deployment,
                &credential,
                grant,
                resource,
                registration,
            )
            .await
            .is_err()
            {
                isolated_failures += 1;
            } else {
                let _ = journal.mark_resource_reported(
                    &resource.local_resource_id,
                    resource.content_hash.as_deref(),
                );
            }
            set_mount_status(
                journal,
                &grant.id,
                "syncing",
                "Making files available in Spectra…",
                processed,
                files.len(),
            )?;
        }
    }
    if scan_complete {
        reconcile_missing_resources(&deployment, &credential, &mount_id, &scan_id)
            .await
            .map_err(|error| error.to_string())?;
    }
    if locked_files > 0 || isolated_failures > 0 {
        set_mount_status(
            journal,
            &grant.id,
            "waiting",
            &format!(
                "{} file{} will retry after the next change or repair scan",
                locked_files + isolated_failures,
                if locked_files + isolated_failures == 1 {
                    ""
                } else {
                    "s"
                }
            ),
            files.len().saturating_sub(isolated_failures),
            files.len() + locked_files,
        )
    } else {
        set_mount_status(
            journal,
            &grant.id,
            "active",
            "Available in Spectra",
            files.len(),
            files.len(),
        )
    }
}

async fn process_write_request(
    grants: &Arc<GrantRegistry>,
    journal: &Arc<Journal>,
    deployment: &str,
    credential: &str,
    request: ClaimedWrite,
) -> anyhow::Result<bool> {
    let relative = std::path::Path::new(&request.relative_path);
    let target = match grants.resolve(&request.grant_id, relative) {
        Ok(target) => target,
        Err(error) => {
            complete_write(
                deployment,
                credential,
                &request.request_id,
                "failed",
                None,
                Some(("target-unavailable", &error.to_string())),
            )
            .await?;
            return Ok(true);
        }
    };
    let actual_revision = match inspect_claim_target(&HostPlatform, &target, &request.base_revision)
    {
        ClaimPrecondition::Ready { revision } => revision,
        ClaimPrecondition::Missing => {
            complete_write(
                deployment,
                credential,
                &request.request_id,
                "conflicted",
                None,
                Some((
                    "externally-deleted",
                    "The file was removed outside Spectra; it was not recreated.",
                )),
            )
            .await?;
            return Ok(true);
        }
        ClaimPrecondition::Locked => {
            complete_write(
                deployment,
                credential,
                &request.request_id,
                "waiting",
                None,
                Some(("office-locked", "Waiting for Office to finish saving")),
            )
            .await?;
            return Ok(false);
        }
        ClaimPrecondition::Stale { revision } => {
            complete_write(
                deployment,
                credential,
                &request.request_id,
                "conflicted",
                Some(&revision),
                Some((
                    "stale-revision",
                    "The file changed before Spectra could write it.",
                )),
            )
            .await?;
            return Ok(true);
        }
        ClaimPrecondition::Unreadable { message } => {
            complete_write(
                deployment,
                credential,
                &request.request_id,
                "waiting",
                None,
                Some(("file-read-failed", &message)),
            )
            .await?;
            return Ok(false);
        }
    };
    let response = match reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(3))
        .timeout(std::time::Duration::from_secs(60))
        .build()?
        .get(&request.payload_url)
        .send()
        .await
    {
        Ok(response) => response.error_for_status(),
        Err(error) => Err(error),
    };
    let payload = match response {
        Ok(response) => match response.bytes().await {
            Ok(bytes) => bytes.to_vec(),
            Err(error) => {
                complete_write(
                    deployment,
                    credential,
                    &request.request_id,
                    "waiting",
                    None,
                    Some(("payload-download-failed", &error.to_string())),
                )
                .await?;
                return Ok(false);
            }
        },
        Err(error) => {
            complete_write(
                deployment,
                credential,
                &request.request_id,
                "waiting",
                None,
                Some(("payload-download-failed", &error.to_string())),
            )
            .await?;
            return Ok(false);
        }
    };
    let payload_hash = hex::encode(sha2::Sha256::digest(&payload));
    if payload_hash != request.content_hash {
        complete_write(
            deployment,
            credential,
            &request.request_id,
            "failed",
            None,
            Some((
                "payload-hash-mismatch",
                "downloaded payload did not match its verified hash",
            )),
        )
        .await?;
        return Ok(true);
    }
    let writer = SafeWriter::new(grants.clone(), journal.clone(), Arc::new(HostPlatform));
    let result = writer.write(WriteRequest {
        grant_id: &request.grant_id,
        relative_path: relative,
        resource_id: &request.local_resource_id,
        base_revision: &request.base_revision,
        known_revision: &actual_revision,
        bytes: &payload,
        expected_hash: &request.content_hash,
        idempotency_key: &request.idempotency_key,
    });
    match result {
        Ok(_) => {
            complete_write(
                deployment,
                credential,
                &request.request_id,
                "verified",
                Some(&request.target_revision),
                None,
            )
            .await?;
            Ok(true)
        }
        Err(FsError::FileLocked) => {
            complete_write(
                deployment,
                credential,
                &request.request_id,
                "waiting",
                Some(&actual_revision),
                Some(("office-locked", "Waiting for Office to finish saving")),
            )
            .await?;
            Ok(false)
        }
        Err(FsError::StaleRevision) => {
            complete_write(
                deployment,
                credential,
                &request.request_id,
                "conflicted",
                Some(&actual_revision),
                Some((
                    "stale-revision",
                    "Word changed this file before Spectra could write it",
                )),
            )
            .await?;
            Ok(true)
        }
        Err(error) => {
            complete_write(
                deployment,
                credential,
                &request.request_id,
                "failed",
                Some(&actual_revision),
                Some(("write-failed", &error.to_string())),
            )
            .await?;
            Ok(true)
        }
    }
}

async fn drain_write_requests(
    grants: &Arc<GrantRegistry>,
    journal: &Arc<Journal>,
    deployment: &str,
    credential: &str,
) -> anyhow::Result<usize> {
    let mut by_replica = BTreeMap::<String, Vec<ClaimedWrite>>::new();
    for _ in 0..20 {
        let Some(request) = claim_write(deployment, credential).await? else {
            break;
        };
        by_replica
            .entry(request.replica_id.clone())
            .or_default()
            .push(request);
    }
    let mut tasks = tokio::task::JoinSet::new();
    for requests in by_replica.into_values() {
        let grants = grants.clone();
        let journal = journal.clone();
        let deployment = deployment.to_owned();
        let credential = credential.to_owned();
        tasks.spawn(async move {
            let mut handled = 0;
            let mut requests = requests.into_iter();
            while let Some(request) = requests.next() {
                if process_write_request(&grants, &journal, &deployment, &credential, request)
                    .await?
                {
                    handled += 1;
                } else {
                    // Preserve ordering for one file: a parked write must be
                    // retried before a later revision for the same replica.
                    for blocked in requests {
                        complete_write(
                            &deployment,
                            &credential,
                            &blocked.request_id,
                            "waiting",
                            None,
                            Some((
                                "prior-write-pending",
                                "Waiting for an earlier save to finish",
                            )),
                        )
                        .await?;
                    }
                    break;
                }
            }
            Ok::<usize, anyhow::Error>(handled)
        });
    }
    let mut handled = 0;
    while let Some(result) = tasks.join_next().await {
        handled += result??;
    }
    Ok(handled)
}

fn collision_path(root: &std::path::Path, requested: &std::path::Path) -> std::path::PathBuf {
    if !root.join(requested).exists() {
        return requested.to_owned();
    }
    let parent = requested
        .parent()
        .unwrap_or_else(|| std::path::Path::new(""));
    let name = requested
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    let dot = name.rfind('.');
    let (stem, extension) = match dot {
        Some(index) if index > 0 => (&name[..index], &name[index..]),
        _ => (name, ""),
    };
    for index in 2..10_000 {
        let candidate = parent.join(format!("{stem} (Spectra {index}){extension}"));
        if !root.join(&candidate).exists() {
            return candidate;
        }
    }
    requested.to_owned()
}

async fn drain_structure_requests(
    grants: &Arc<GrantRegistry>,
    journal: &Arc<Journal>,
    deployment: &str,
    credential: &str,
) -> anyhow::Result<usize> {
    let mut handled = 0;
    for _ in 0..20 {
        let Some(request) = claim_fs_request(deployment, credential).await? else {
            break;
        };
        let relative_source = std::path::Path::new(&request.source_relative_path);
        let target_candidate = request
            .target_relative_path
            .as_deref()
            .map(std::path::Path::new);
        let grant = grants
            .device_grants()
            .into_iter()
            .find(|grant| grant.id == request.grant_id);
        let Some(grant) = grant else {
            complete_fs_request(
                deployment,
                credential,
                &request.request_id,
                "failed",
                None,
                Some((
                    "grant-unavailable",
                    "The selected folder is no longer available.",
                )),
            )
            .await?;
            handled += 1;
            continue;
        };
        let writer = SafeWriter::new(grants.clone(), journal.clone(), Arc::new(HostPlatform));
        let result = match request.kind.as_str() {
            "delete" => writer
                .recycle(
                    &request.grant_id,
                    relative_source,
                    &request.local_resource_id,
                    &request.idempotency_key,
                )
                .map(|_| None),
            "move" | "rename" => match target_candidate {
                Some(target) => {
                    let parent = grant
                        .device_root()
                        .join(target.parent().unwrap_or_else(|| std::path::Path::new("")));
                    if let Err(error) = std::fs::create_dir_all(&parent) {
                        Err(FsError::Other(anyhow::anyhow!(error)))
                    } else {
                        let actual = collision_path(grant.device_root(), target);
                        writer
                            .relocate(
                                &request.grant_id,
                                relative_source,
                                &actual,
                                &request.local_resource_id,
                                &request.idempotency_key,
                            )
                            .map(|_| Some(actual.to_string_lossy().replace('\\', "/")))
                    }
                }
                None => Err(FsError::Other(anyhow::anyhow!("structure target missing"))),
            },
            _ => Err(FsError::Other(anyhow::anyhow!(
                "unknown structure operation"
            ))),
        };
        match result {
            Ok(actual) => {
                complete_fs_request(
                    deployment,
                    credential,
                    &request.request_id,
                    "verified",
                    actual.as_deref(),
                    None,
                )
                .await?
            }
            Err(FsError::FileLocked) => {
                complete_fs_request(
                    deployment,
                    credential,
                    &request.request_id,
                    "failed",
                    None,
                    Some(("office-locked", "The file is open in another application.")),
                )
                .await?
            }
            Err(error) => {
                complete_fs_request(
                    deployment,
                    credential,
                    &request.request_id,
                    "failed",
                    None,
                    Some(("structure-operation-failed", &error.to_string())),
                )
                .await?
            }
        }
        handled += 1;
    }
    Ok(handled)
}

fn spawn_grant_watcher(grant: Grant, grants: Arc<GrantRegistry>, journal: Arc<Journal>) {
    tauri::async_runtime::spawn(async move {
        let config = WatcherConfig::for_root(std::path::Path::new(grant.device_root()));
        // Keep startup in the same path as reconnects.  A watcher can be
        // created immediately for a newly selected folder, but that does not
        // perform the initial repair scan; the `watcher.is_none()` branch
        // below owns both watcher creation and the first `sync_grant` call.
        // Starting with `Some` would leave a new mount at the initial
        // `scanning` status forever because no filesystem event is guaranteed
        // after selection.
        let mut watcher = None;
        let mut stability = StabilityTracker::new(config.stability_window);
        let mut pending_files = HashSet::<std::path::PathBuf>::new();
        let mut pending_missing = HashMap::<std::path::PathBuf, std::time::Instant>::new();
        let mut last_reconciliation = std::time::Instant::now();
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            if !grants
                .device_grants()
                .iter()
                .any(|candidate| candidate.id == grant.id)
            {
                break;
            }
            if !grant.is_available() {
                watcher = None;
                let marker_key = format!("mount_availability:{}", grant.id);
                let already_reported =
                    journal.config(&marker_key).ok().flatten().as_deref() == Some("unavailable");
                if !already_reported {
                    if let (Ok(url), Ok(Some(device_id))) =
                        (deployment_url(&journal), journal.config("device_id"))
                    {
                        if let Ok(Some(credential)) = HostPlatform.read_credential(&device_id) {
                            if set_mount_availability(&url, &credential, &grant.id, false)
                                .await
                                .is_ok()
                            {
                                let _ = journal.set_config(&marker_key, "unavailable");
                            }
                        }
                    }
                }
                let _ = set_mount_status(
                    &journal,
                    &grant.id,
                    "unavailable",
                    "Folder is unavailable on this device; reconnect the drive to resume.",
                    0,
                    0,
                );
                continue;
            }
            if watcher.is_none() {
                watcher =
                    MountWatcher::start(std::path::Path::new(grant.device_root()), config.clone())
                        .ok();
                if watcher.is_none() {
                    let _ = set_mount_status(
                        &journal,
                        &grant.id,
                        "error",
                        "The folder could not be watched yet.",
                        0,
                        0,
                    );
                    continue;
                }
                let _ = sync_grant(&grant, &journal).await;
                let marker_key = format!("mount_availability:{}", grant.id);
                let was_unavailable =
                    journal.config(&marker_key).ok().flatten().as_deref() == Some("unavailable");
                if was_unavailable {
                    if let (Ok(url), Ok(Some(device_id))) =
                        (deployment_url(&journal), journal.config("device_id"))
                    {
                        if let Ok(Some(credential)) = HostPlatform.read_credential(&device_id) {
                            if set_mount_availability(&url, &credential, &grant.id, true)
                                .await
                                .is_ok()
                            {
                                let _ = journal.delete_config(&marker_key);
                            }
                        }
                    }
                }
                stability = StabilityTracker::new(config.stability_window);
                pending_files.clear();
                pending_missing.clear();
                last_reconciliation = std::time::Instant::now();
            }
            let batch = watcher
                .as_ref()
                .map(MountWatcher::drain_paths)
                .unwrap_or_default();
            let observed_at = std::time::Instant::now();
            for path in batch.existing_files {
                pending_missing.remove(&path);
                pending_files.insert(path);
            }
            for path in batch.missing_paths {
                pending_files.remove(&path);
                pending_missing.entry(path).or_insert(observed_at);
            }
            if !batch.failures.is_empty() {
                let _ = set_mount_status(
                    &journal,
                    &grant.id,
                    "waiting",
                    "A file could not be read yet; other files continue syncing.",
                    0,
                    0,
                );
            }

            let mut generation = None;
            let mut isolated_failures = 0usize;
            for path in pending_files.clone() {
                if !path.exists() {
                    pending_files.remove(&path);
                    pending_missing.entry(path).or_insert(observed_at);
                    continue;
                }
                if office_lock_exists(&path) {
                    if enqueue_locked_path(&grant, &journal, &path).is_ok() {
                        let _ = set_mount_status(
                            &journal,
                            &grant.id,
                            "waiting",
                            "Word still has a file open. Spectra will verify it after Word finishes saving.",
                            0,
                            0,
                        );
                    }
                    continue;
                }
                match stability.observe(&path, observed_at) {
                    Ok(Some(hash)) => {
                        let current_generation = match generation {
                            Some(value) => value,
                            None => match journal.next_generation(&grant.id) {
                                Ok(value) => {
                                    generation = Some(value);
                                    value
                                }
                                Err(_) => {
                                    isolated_failures += 1;
                                    continue;
                                }
                            },
                        };
                        match enqueue_stable_change(
                            &grant,
                            &journal,
                            &path,
                            &hash,
                            current_generation,
                        ) {
                            Ok(_) => {
                                pending_files.remove(&path);
                            }
                            Err(_) => isolated_failures += 1,
                        }
                    }
                    Ok(None) => {}
                    Err(_) => isolated_failures += 1,
                }
            }
            let settled_missing = pending_missing
                .iter()
                .filter(|(_, first_seen)| {
                    observed_at.duration_since(**first_seen) >= config.stability_window
                })
                .map(|(path, _)| path.clone())
                .collect::<Vec<_>>();
            for path in settled_missing {
                let current_generation = match generation {
                    Some(value) => value,
                    None => match journal.next_generation(&grant.id) {
                        Ok(value) => {
                            generation = Some(value);
                            value
                        }
                        Err(_) => {
                            isolated_failures += 1;
                            continue;
                        }
                    },
                };
                match enqueue_missing_path(&grant, &journal, &path, current_generation) {
                    Ok(_) => {
                        pending_missing.remove(&path);
                    }
                    Err(_) => isolated_failures += 1,
                }
            }
            if isolated_failures > 0 {
                let _ = set_mount_status(
                    &journal,
                    &grant.id,
                    "waiting",
                    "A changed file could not be synced yet; unrelated files continue.",
                    0,
                    0,
                );
            } else if generation.is_some() {
                let _ =
                    set_mount_status(&journal, &grant.id, "active", "Changes queued safely", 0, 0);
            }
            if last_reconciliation.elapsed() >= config.reconciliation_interval {
                let _ = sync_grant(&grant, &journal).await;
                last_reconciliation = std::time::Instant::now();
            }
        }
    });
}

async fn sync_grant(grant: &Grant, journal: &Journal) -> Result<(), String> {
    if !grant.is_available() {
        set_mount_status(
            journal,
            &grant.id,
            "unavailable",
            "Folder is unavailable on this device; reconnect the drive to resume.",
            0,
            0,
        )?;
        return Ok(());
    }
    match run_sync(grant, journal).await {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = set_mount_status(journal, &grant.id, "error", &error, 0, 0);
            Err(error)
        }
    }
}

#[tauri::command]
fn pending_pairing_code(state: tauri::State<'_, Arc<ServerState>>) -> Option<String> {
    state.pending_pairing_code()
}

#[tauri::command]
fn bridge_status(
    state: tauri::State<'_, Arc<ServerState>>,
    runtime: tauri::State<'_, BridgeRuntime>,
) -> (bool, Vec<MountView>) {
    let mounts = mount_views(&runtime.grants, &runtime.journal);
    (state.is_paired(), mounts)
}

#[tauri::command]
async fn complete_pairing_offer(
    offer: &PairingOffer,
    state: &Arc<ServerState>,
    journal: &Arc<Journal>,
) -> Result<(), String> {
    let deployment = deployment_url(journal)?;
    let device_name = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "This device".into());
    let installation_id = match journal
        .config("installation_id")
        .map_err(|error| error.to_string())?
    {
        Some(value) => value,
        None => {
            let value = uuid::Uuid::new_v4().to_string();
            journal
                .set_config("installation_id", &value)
                .map_err(|error| error.to_string())?;
            value
        }
    };
    let existing = journal
        .config("device_id")
        .map_err(|error| error.to_string())?
        .and_then(|device_id| {
            HostPlatform
                .read_credential(&device_id)
                .ok()
                .flatten()
                .map(|credential| (device_id, credential))
        });
    let (device_id, browser_origin) = if let Some((_device_id, credential)) = existing {
        match resume_pairing(
            &deployment,
            &credential,
            offer,
            &device_name,
            &installation_id,
        )
        .await
        {
            Ok(exchange) => (exchange.device_id, exchange.browser_origin),
            Err(error) if should_repair_pairing(&error.to_string()) => {
                let exchange = exchange_pairing(&deployment, offer, &device_name, &installation_id)
                    .await
                    .map_err(|error| error.to_string())?;
                HostPlatform
                    .store_credential(&exchange.device_id, &exchange.device_credential)
                    .map_err(|error| error.to_string())?;
                (exchange.device_id, exchange.browser_origin)
            }
            Err(error) => return Err(error.to_string()),
        }
    } else {
        let exchange = exchange_pairing(&deployment, offer, &device_name, &installation_id)
            .await
            .map_err(|error| error.to_string())?;
        HostPlatform
            .store_credential(&exchange.device_id, &exchange.device_credential)
            .map_err(|error| error.to_string())?;
        (exchange.device_id, exchange.browser_origin)
    };
    journal
        .set_config("device_id", &device_id)
        .map_err(|error| error.to_string())?;
    state.set_device_id(device_id);
    let session_token = state.complete_pairing(offer.challenge.clone(), browser_origin.clone());
    journal
        .set_config("browser_origin", &browser_origin)
        .map_err(|error| error.to_string())?;
    journal
        .set_config("browser_session_token", &session_token)
        .map_err(|error| error.to_string())?;
    Ok(())
}

async fn request_bridge_update(app: &tauri::AppHandle) -> Result<String, String> {
    let tray_sentence = "Look for Spectra Bridge near the clock and open it to install the update.";
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(_) => return Ok(tray_sentence.into()),
    };
    match updater.check().await {
        Ok(Some(update)) => {
            update
                .download_and_install(|_, _| {}, || {})
                .await
                .map_err(|_| tray_sentence.to_string())?;
            Ok("Spectra Bridge is installing the update and will restart.".into())
        }
        Ok(None) | Err(_) => Ok(tray_sentence.into()),
    }
}

fn should_repair_pairing(error: &str) -> bool {
    error.contains("BRIDGE_CREDENTIAL_INVALID")
}

#[cfg(test)]
mod pairing_tests {
    use super::should_repair_pairing;

    #[test]
    fn only_invalid_credentials_trigger_device_repair() {
        assert!(should_repair_pairing("bridge: BRIDGE_CREDENTIAL_INVALID"));
        assert!(!should_repair_pairing("network timeout"));
        assert!(!should_repair_pairing("PAIRING_CHALLENGE_INVALID"));
    }
}

#[tauri::command]
async fn confirm_pairing(
    code: String,
    state: tauri::State<'_, Arc<ServerState>>,
    runtime: tauri::State<'_, BridgeRuntime>,
) -> Result<(), String> {
    let offer = state
        .confirm_pairing_code(&code)
        .map_err(|error| error.to_string())?;
    complete_pairing_offer(&offer, &state, &runtime.journal).await
}

async fn select_mount_impl(
    app: &tauri::AppHandle,
    grants: &Arc<GrantRegistry>,
    journal: &Arc<Journal>,
) -> Result<Option<(String, String)>, String> {
    let Some(selection) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = selection.into_path().map_err(|error| error.to_string())?;
    let label = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Selected folder")
        .to_owned();
    let grant = grants
        .add_native_selection(label.clone(), &path)
        .map_err(|error| error.to_string())?;
    journal
        .set_config(
            &format!("mount:{}", grant.id),
            &serde_json::json!({ "label": label, "path": grant.device_root() }).to_string(),
        )
        .map_err(|error| error.to_string())?;
    // Persist and expose the grant before doing any network or payload work.
    // Selection must remain responsive even when Cloud is slow/offline; the
    // watcher owns the asynchronous scan and updates the durable status.
    set_mount_status(
        journal,
        &grant.id,
        "scanning",
        "Reading folder metadata…",
        0,
        0,
    )?;
    spawn_grant_watcher(grant.clone(), grants.clone(), journal.clone());
    Ok(Some((grant.id, label)))
}

#[tauri::command]
async fn select_mount(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, BridgeRuntime>,
) -> Result<Option<(String, String)>, String> {
    select_mount_impl(&app, &runtime.grants, &runtime.journal).await
}

async fn retry_mount_impl(
    grant_id: &str,
    grants: &Arc<GrantRegistry>,
    journal: &Arc<Journal>,
) -> Result<(), String> {
    let grant = grants
        .device_grants()
        .into_iter()
        .find(|grant| grant.id == grant_id)
        .ok_or_else(|| "Folder grant not found".to_string())?;
    sync_grant(&grant, journal).await
}

#[tauri::command]
async fn retry_mount(
    grant_id: String,
    runtime: tauri::State<'_, BridgeRuntime>,
) -> Result<(), String> {
    retry_mount_impl(&grant_id, &runtime.grants, &runtime.journal).await
}

async fn remove_mount_impl(
    grant_id: &str,
    grants: &Arc<GrantRegistry>,
    journal: &Arc<Journal>,
) -> Result<(), String> {
    if let (Ok(deployment), Some(device_id)) = (
        deployment_url(journal),
        journal
            .config("device_id")
            .map_err(|error| error.to_string())?,
    ) {
        if let Some(credential) = HostPlatform
            .read_credential(&device_id)
            .map_err(|error| error.to_string())?
        {
            detach_mount(&deployment, &credential, grant_id)
                .await
                .map_err(|error| error.to_string())?;
        }
    }
    grants.remove(grant_id);
    for prefix in [
        "mount:",
        "mount_status:",
        "mount_double_sync:",
        "cloud_mount:",
    ] {
        journal
            .delete_config(&format!("{prefix}{grant_id}"))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn remove_mount(
    grant_id: String,
    runtime: tauri::State<'_, BridgeRuntime>,
) -> Result<(), String> {
    remove_mount_impl(&grant_id, &runtime.grants, &runtime.journal).await
}

fn main() {
    record_process_start();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg("--autostart")
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            pending_pairing_code,
            bridge_status,
            confirm_pairing,
            select_mount,
            retry_mount,
            remove_mount
        ])
        .setup(|app| {
            // Debug and release binaries must share the same per-user journal
            // by default. Test isolation is opt-in through the explicit
            // SPECTRA_BRIDGE_DATA_DIR environment variable; silently deriving
            // a workspace-local journal creates duplicate devices and leaves
            // queued writes attached to an offline Bridge.
            let isolated_runtime = std::env::var_os("SPECTRA_BRIDGE_DATA_DIR");
            if isolated_runtime.is_none() {
                app.autolaunch().enable()?;
                repair_windows_autostart_command()?;
            }
            // The Bridge is tray infrastructure. Spectra owns pairing, folder
            // selection, policy and status; the native surface is opt-in from
            // the tray only and never appears during normal startup.
            if let Some(window) = app.get_webview_window("main") {
                window.hide()?;
            }
            let data_dir = resolve_bridge_data_dir(isolated_runtime, app.path().app_data_dir()?)?;
            std::fs::create_dir_all(&data_dir)?;
            let journal = Arc::new(Journal::open(&data_dir.join("bridge.sqlite"))?);
            let state = Arc::new(ServerState::unpaired());
            let credential_ready = journal
                .config("device_id")?
                .and_then(|device_id| HostPlatform.read_credential(&device_id).ok().flatten())
                .is_some();
            if credential_ready {
                if let (Some(origin), Some(token)) = (
                    journal.config("browser_origin")?,
                    journal.config("browser_session_token")?,
                ) {
                    let _ = state.restore_pairing(origin, &token);
                }
            }
            if let Some(device_id) = journal.config("device_id")? {
                state.set_device_id(device_id);
            }
            app.manage(state.clone());
            let grants = Arc::new(GrantRegistry::default());
            for (key, value) in journal.config_prefix("mount:")? {
                if let Ok(config) = serde_json::from_str::<serde_json::Value>(&value) {
                    if let (Some(label), Some(path)) = (
                        config.get("label").and_then(|value| value.as_str()),
                        config.get("path").and_then(|value| value.as_str()),
                    ) {
                        let _ = grants.restore_device_grant(
                            key.trim_start_matches("mount:").to_owned(),
                            label.to_owned(),
                            std::path::Path::new(path),
                        );
                    }
                }
            }
            let restored_grants = grants.device_grants();
            for grant in &restored_grants {
                if !grant.is_available() {
                    let _ = set_mount_status(
                        &journal,
                        &grant.id,
                        "unavailable",
                        "Folder is unavailable on this device; reconnect the drive to resume.",
                        0,
                        0,
                    );
                }
            }
            app.manage(BridgeRuntime {
                grants: grants.clone(),
                journal: journal.clone(),
            });
            state.install_local_control(Arc::new(SpectraLocalControl {
                app: app.handle().clone(),
                state: state.clone(),
                grants: grants.clone(),
                journal: journal.clone(),
            }));
            for grant in restored_grants {
                spawn_grant_watcher(grant, grants.clone(), journal.clone());
            }
            let sync_journal = app.state::<BridgeRuntime>().journal.clone();
            let sync_grants = app.state::<BridgeRuntime>().grants.clone();
            let sync_state = state.clone();
            tauri::async_runtime::spawn(async move {
                // A file can change while the Bridge is offline. Reconcile every
                // restored grant before claiming queued cloud-to-local writes so
                // SafeWriter compares against the uploaded local truth, never a
                // stale pre-shutdown revision. New grants are reconciled by
                // add_mount before their watcher starts.
                let mut restored_grants_reconciled = false;
                let mut last_compaction = std::time::Instant::now();
                loop {
                    if let (Ok(url), Ok(Some(device_id))) = (
                        deployment_url(&sync_journal),
                        sync_journal.config("device_id"),
                    ) {
                        if let Ok(Some(credential)) = HostPlatform.read_credential(&device_id) {
                            if let Err(error) =
                                run_replica_migration(&sync_journal, &url, &credential).await
                            {
                                let _ = sync_journal.set_config("replica_migration_error", &error);
                            } else {
                                sync_state.mark_cloud_seen();
                                let _ = sync_journal.delete_config("replica_migration_error");
                                if !restored_grants_reconciled {
                                    let mut reconciliation_succeeded = true;
                                    for grant in sync_grants.device_grants() {
                                        if sync_grant(&grant, &sync_journal).await.is_err() {
                                            reconciliation_succeeded = false;
                                        }
                                    }
                                    if !reconciliation_succeeded {
                                        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                                        continue;
                                    }
                                    restored_grants_reconciled = true;
                                }
                                match drain_cloud_queue(&sync_journal, &url, &credential).await {
                                    Ok(deliveries) => {
                                        let mut delivery_failed = false;
                                        let mut delivery_tasks = tokio::task::JoinSet::new();
                                        for delivery in deliveries {
                                            let grants = sync_grants.clone();
                                            let journal = sync_journal.clone();
                                            let deployment = url.clone();
                                            let device_credential = credential.clone();
                                            delivery_tasks.spawn(async move {
                                                finish_delivered_change(
                                                    &grants,
                                                    &journal,
                                                    &deployment,
                                                    &device_credential,
                                                    delivery,
                                                )
                                                .await
                                            });
                                        }
                                        while let Some(result) = delivery_tasks.join_next().await {
                                            if !matches!(result, Ok(Ok(()))) {
                                                delivery_failed = true;
                                            }
                                        }
                                        if delivery_failed {
                                            let _ = sync_journal.set_config(
                                                "outbound_queue_error",
                                                "One file change will retry; unrelated files continued.",
                                            );
                                        } else {
                                            let _ = sync_journal.delete_config("outbound_queue_error");
                                        }
                                    }
                                    Err(error) => {
                                        let _ = sync_journal.set_config(
                                            "outbound_queue_error",
                                            &error.to_string(),
                                        );
                                    }
                                }
                                let _ = drain_structure_requests(
                                    &sync_grants,
                                    &sync_journal,
                                    &url,
                                    &credential,
                                )
                                .await;
                                if let Err(error) = drain_write_requests(
                                    &sync_grants,
                                    &sync_journal,
                                    &url,
                                    &credential,
                                )
                                .await
                                {
                                    let _ = sync_journal
                                        .set_config("write_queue_error", &error.to_string());
                                } else {
                                    let _ = sync_journal.delete_config("write_queue_error");
                                }
                                if last_compaction.elapsed()
                                    >= std::time::Duration::from_secs(6 * 60 * 60)
                                {
                                    let older_than = std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_millis() as i64
                                        - 7 * 24 * 60 * 60 * 1_000;
                                    match sync_journal.compact_verified(older_than) {
                                        Ok(_) => {
                                            let _ = sync_journal.delete_config("journal_compaction_error");
                                        }
                                        Err(error) => {
                                            let _ = sync_journal.set_config(
                                                "journal_compaction_error",
                                                &error.to_string(),
                                            );
                                        }
                                    }
                                    last_compaction = std::time::Instant::now();
                                }
                            }
                        }
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                }
            });
            tauri::async_runtime::spawn(async move {
                if let Err(error) = serve(state).await {
                    eprintln!("{error:#}");
                }
            });
            let show = MenuItem::with_id(app, "show", "Open Spectra Bridge", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "Pause", true, None::<&str>)?;
            let logs = MenuItem::with_id(app, "logs", "Open logs", true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "Stop Bridge", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &pause, &logs, &stop])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Spectra Bridge · Disconnected")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "stop" => app.exit(0),
                    "pause" | "logs" | _ => {}
                });
            let tray_icon =
                tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
            tray = tray.icon(tray_icon);
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Closing the window is a presentation action, not a Bridge
                // shutdown. Keep the service and tray icon alive; the explicit
                // tray action is the only normal way to stop the Bridge.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("Spectra Bridge shell failed");
}

#[cfg(test)]
mod tests {
    use super::resolve_bridge_data_dir;

    #[test]
    fn bridge_data_dir_defaults_to_per_user_app_data() {
        let app_data =
            std::path::PathBuf::from(r"C:\Users\test\AppData\Roaming\com.spectra.bridge");
        assert_eq!(
            resolve_bridge_data_dir(None, app_data.clone()).unwrap(),
            app_data
        );
    }

    #[test]
    fn bridge_data_dir_accepts_only_explicit_absolute_isolation() {
        let app_data =
            std::path::PathBuf::from(r"C:\Users\test\AppData\Roaming\com.spectra.bridge");
        let isolated = std::ffi::OsString::from(r"C:\fixtures\spectra-bridge");
        assert_eq!(
            resolve_bridge_data_dir(Some(isolated), app_data).unwrap(),
            std::path::PathBuf::from(r"C:\fixtures\spectra-bridge")
        );
    }

    #[test]
    fn bridge_data_dir_rejects_relative_isolation() {
        let app_data =
            std::path::PathBuf::from(r"C:\Users\test\AppData\Roaming\com.spectra.bridge");
        let error = resolve_bridge_data_dir(Some(".tmp-bridge".into()), app_data).unwrap_err();
        assert!(error.to_string().contains("must be absolute"));
    }
}
