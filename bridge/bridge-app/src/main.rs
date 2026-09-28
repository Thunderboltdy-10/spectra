#![cfg_attr(windows, windows_subsystem = "windows")]

mod polling;

use sha2::Digest;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::{Arc, Mutex};

use polling::{PollResult, PollScheduler, PollWake, WaitResult};
use spectra_bridge_core::fs::{
    FsError, Grant, GrantRegistry, SafeWriter, WriteRequest, resolve_write_target,
};
use spectra_bridge_core::identity::{AdoptionCandidate, adopt, local_resource_id};
use spectra_bridge_core::journal::{Journal, NativeAckItem, OpState, ResourceRecord};
use spectra_bridge_core::platform::{HostPlatform, OsFileIdentity, Platform};
use spectra_bridge_core::protocol::{LocalMountStatus, PairingOffer};
use spectra_bridge_core::retry::bridge_mount_repair_delay_ms;
use spectra_bridge_core::server::{LocalBridgeControl, ServerState, serve};
use spectra_bridge_core::sync::{
    Backoff, ClaimPrecondition, ClaimedFsRequest, ClaimedPayloadUpload, ClaimedWrite,
    DeliveredChange, DiscoveredRegistration, DiscoveredResource, QueuedChangeEnvelope,
    ReplicaMigrationPage, ReportedChange, WriteCompletion, claim_fs_request,
    claim_pending_payload_upload, claim_write, complete_fs_request_with_claim,
    complete_write_with_claim, detach_mount, discover_resources_page, drain_cloud_queue,
    exchange_pairing, inspect_write_target, migrate_cloud_replica_page,
    reconcile_missing_resources, refresh_structure_claim, refresh_write_claim, register_mount,
    resume_pairing, set_mount_availability, upload_resource_payload,
};
use spectra_bridge_core::watcher::{
    MountWatcher, StabilityTracker, WatcherConfig, file_held_by_office, is_office_lock_file,
    office_lock_exists, office_lock_paths, relative_key, scan_mount, stable_file_snapshot,
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
    wake: PollWake,
    active_mount_syncs: ActiveMountSyncs,
}

type ActiveMountSyncs = Arc<Mutex<HashSet<String>>>;

/// A timed-out page is safely replayable because resource discovery resolves
/// by stable device/resource identity. Split it once to let each half commit
/// independently; never recursively fan a failing backend into a retry storm.
async fn discover_resources_page_with_timeout_split(
    deployment: &str,
    credential: &str,
    mount_id: &str,
    resources: &[DiscoveredResource],
) -> anyhow::Result<Vec<DiscoveredRegistration>> {
    match discover_resources_page(deployment, credential, mount_id, resources).await {
        Ok(registrations) => Ok(registrations),
        Err(error)
            if resources.len() > 1
                && error
                    .to_string()
                    .to_ascii_lowercase()
                    .contains("request timed out") =>
        {
            let middle = resources.len() / 2;
            let mut registrations =
                discover_resources_page(deployment, credential, mount_id, &resources[..middle])
                    .await?;
            registrations.extend(
                discover_resources_page(deployment, credential, mount_id, &resources[middle..])
                    .await?,
            );
            Ok(registrations)
        }
        Err(error) => Err(error),
    }
}

fn record_write_progress(
    journal: &Journal,
    stage: &str,
    request: Option<&ClaimedWrite>,
    detail: Option<&str>,
) {
    let recorded_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let value = serde_json::json!({
        "stage": stage,
        "requestId": request.map(|value| value.request_id.as_str()),
        "claimGeneration": request.and_then(|value| value.claim_generation),
        "detail": detail,
        "recordedAt": recorded_at,
    });
    let _ = journal.set_config("write_worker_progress", &value.to_string());
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MountSyncOutcome {
    Completed,
    RetryScheduled,
    AlreadyRunning,
}

fn retain_current_mounts(
    reconciled: &mut HashSet<String>,
    current_mount_ids: impl IntoIterator<Item = String>,
) {
    let current_mount_ids = current_mount_ids.into_iter().collect::<HashSet<_>>();
    reconciled.retain(|mount_id| current_mount_ids.contains(mount_id));
}

struct ActiveMountSyncGuard {
    active_mount_syncs: ActiveMountSyncs,
    grant_id: String,
}

impl ActiveMountSyncGuard {
    fn acquire(active_mount_syncs: &ActiveMountSyncs, grant_id: &str) -> Option<Self> {
        let acquired = active_mount_syncs
            .lock()
            .expect("mount sync gate is not poisoned")
            .insert(grant_id.to_owned());
        acquired.then(|| Self {
            active_mount_syncs: active_mount_syncs.clone(),
            grant_id: grant_id.to_owned(),
        })
    }
}

impl Drop for ActiveMountSyncGuard {
    fn drop(&mut self) {
        match self.active_mount_syncs.lock() {
            Ok(mut active_mount_syncs) => {
                active_mount_syncs.remove(&self.grant_id);
            }
            Err(poisoned) => {
                poisoned.into_inner().remove(&self.grant_id);
            }
        }
    }
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
    wake: PollWake,
    active_mount_syncs: ActiveMountSyncs,
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
        let result = complete_pairing_offer(&offer, &self.state, &self.journal).await;
        if result.is_ok() {
            self.wake.wake_configuration();
        }
        result
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
        select_mount_impl(
            &self.app,
            &self.grants,
            &self.journal,
            &self.wake,
            &self.active_mount_syncs,
        )
        .await
        .map(|_| ())
    }

    async fn retry_mount(&self, grant_id: &str) -> Result<(), String> {
        retry_mount_impl(
            grant_id,
            &self.grants,
            &self.journal,
            &self.wake,
            &self.active_mount_syncs,
        )
        .await
    }

    async fn remove_mount(&self, grant_id: &str) -> Result<(), String> {
        remove_mount_impl(grant_id, &self.grants, &self.journal, &self.wake).await
    }
}

#[cfg(windows)]
const WINDOWS_CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(windows)]
const WINDOWS_AUTOSTART_SCRIPT: &str = r#"$service=New-Object -ComObject Schedule.Service;$service.Connect();$root=$service.GetFolder('\');$definition=$service.NewTask(0);$definition.RegistrationInfo.Description='Starts Spectra Bridge immediately at user logon';$definition.Settings.Enabled=$true;$definition.Settings.StartWhenAvailable=$true;$definition.Settings.MultipleInstances=2;$trigger=$definition.Triggers.Create(9);$trigger.Enabled=$true;$trigger.UserId=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name;$action=$definition.Actions.Create(0);$action.Path=$env:SPECTRA_BRIDGE_EXE;$action.Arguments='--autostart';$action.WorkingDirectory=$env:SPECTRA_BRIDGE_WORKDIR;$null=$root.RegisterTaskDefinition('Spectra Bridge',$definition,6,$null,$null,3,$null)"#;

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
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            WINDOWS_AUTOSTART_SCRIPT,
        ])
        .env("SPECTRA_BRIDGE_EXE", &executable)
        .env("SPECTRA_BRIDGE_WORKDIR", working_directory)
        // The top-level GUI subsystem does not affect this PowerShell child.
        // Hide the launcher itself as well as the scheduled Bridge process.
        .creation_flags(WINDOWS_CREATE_NO_WINDOW)
        .status()?;
    anyhow::ensure!(status.success(), "Windows logon task could not be created");
    let _ = run.delete_value("Spectra Bridge");
    if shortcut.exists() {
        std::fs::remove_file(shortcut)?;
    }
    Ok(())
}

#[cfg(all(test, windows))]
#[test]
fn windows_autostart_launcher_is_hidden_and_starts_the_gui_binary_directly() {
    assert!(
        WINDOWS_AUTOSTART_SCRIPT.contains("-autostart")
            || WINDOWS_AUTOSTART_SCRIPT.contains("--autostart")
    );
    assert!(WINDOWS_AUTOSTART_SCRIPT.contains("$service.GetFolder('\\');"));
    assert!(WINDOWS_AUTOSTART_SCRIPT.contains("$action.Path=$env:SPECTRA_BRIDGE_EXE"));
    assert_eq!(WINDOWS_CREATE_NO_WINDOW, 0x08000000);
}

#[cfg(not(windows))]
fn repair_windows_autostart_command() -> anyhow::Result<()> {
    Ok(())
}

/// Release builds receive the public deployment/origin configuration from the
/// manually-dispatched release workflow. Local development and friend-Mac
/// testing can still override these values at process launch. Keeping the
/// fallback at the app boundary means the bridge never silently returns to a
/// localhost deployment when it is launched by an installer/autostart entry.
fn configure_embedded_release_environment() {
    for (name, value) in [
        ("SPECTRA_CONVEX_URL", option_env!("SPECTRA_CONVEX_URL")),
        ("SPECTRA_ORIGINS", option_env!("SPECTRA_ORIGINS")),
    ] {
        if std::env::var_os(name).is_none() {
            if let Some(value) = value {
                // Rust 2024 makes process-wide environment mutation explicit.
                // This runs before Tauri starts any worker or plugin thread.
                unsafe { std::env::set_var(name, value) };
            }
        }
    }
}

fn record_process_start() {
    let Some(directory) = bridge_log_directory() else {
        return;
    };
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

fn bridge_log_directory() -> Option<std::path::PathBuf> {
    #[cfg(windows)]
    {
        return std::env::var_os("APPDATA")
            .map(std::path::PathBuf::from)
            .map(|base| base.join("com.spectra.bridge"));
    }
    #[cfg(target_os = "macos")]
    {
        return std::env::var_os("HOME")
            .map(std::path::PathBuf::from)
            .map(|home| home.join("Library/Application Support/com.spectra.bridge"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return std::env::var_os("HOME")
            .map(std::path::PathBuf::from)
            .map(|home| home.join(".local/share/com.spectra.bridge"));
    }
    #[allow(unreachable_code)]
    None
}

fn record_runtime_error(journal: &Journal, context: &str, error: &dyn std::fmt::Display) {
    let detail = format!("{context}: {error}");
    let bounded = detail.chars().take(1_000).collect::<String>();
    let _ = journal.set_config("last_runtime_error", &bounded);
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

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MountRepairRetry {
    attempts: u32,
    retry_at_ms: u64,
}

fn mount_repair_retry_key(grant_id: &str) -> String {
    format!("mount_repair_retry:{grant_id}")
}

fn current_time_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn clear_mount_repair_retry(journal: &Journal, grant_id: &str) -> Result<(), String> {
    journal
        .delete_config(&mount_repair_retry_key(grant_id))
        .map_err(|error| error.to_string())
}

fn mount_repair_retry_due(journal: &Journal, grant_id: &str) -> bool {
    journal
        .config(&mount_repair_retry_key(grant_id))
        .ok()
        .flatten()
        .and_then(|value| serde_json::from_str::<MountRepairRetry>(&value).ok())
        .is_some_and(|retry| retry.retry_at_ms <= current_time_ms())
}

fn display_retry_delay(delay_ms: u64) -> String {
    if delay_ms < 60_000 {
        let seconds = delay_ms.saturating_add(999) / 1_000;
        format!("{seconds} seconds")
    } else {
        let minutes = delay_ms.saturating_add(59_999) / 60_000;
        format!("{minutes} minutes")
    }
}

fn schedule_mount_repair_retry(
    journal: &Journal,
    grant_id: &str,
    detail: &str,
    synced: usize,
    total: usize,
) -> Result<u64, String> {
    let key = mount_repair_retry_key(grant_id);
    let previous = journal
        .config(&key)
        .map_err(|error| error.to_string())?
        .and_then(|value| serde_json::from_str::<MountRepairRetry>(&value).ok());
    let attempts = previous
        .map(|retry| retry.attempts)
        .unwrap_or_default()
        .saturating_add(1);
    let delay_ms = bridge_mount_repair_delay_ms(attempts, grant_id);
    let retry = MountRepairRetry {
        attempts,
        retry_at_ms: current_time_ms().saturating_add(delay_ms),
    };
    let value = serde_json::to_string(&retry).map_err(|error| error.to_string())?;
    journal
        .set_config(&key, &value)
        .map_err(|error| error.to_string())?;
    let base_detail = detail.chars().take(500).collect::<String>();
    let status_detail = format!(
        "{base_detail} Automatic repair is scheduled in {}.",
        display_retry_delay(delay_ms),
    );
    set_mount_status(journal, grant_id, "waiting", &status_detail, synced, total)?;
    Ok(delay_ms)
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

fn configured_deployment_url(value: Option<String>) -> Result<String, String> {
    let url = value
        .map(|value| value.trim().trim_end_matches('/').to_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Set SPECTRA_CONVEX_URL to this Spectra instance's Convex URL before starting the Bridge."
                .to_string()
        })?;
    let parsed = reqwest::Url::parse(&url).map_err(|_| {
        "SPECTRA_CONVEX_URL must be a complete http:// or https:// Convex URL.".to_string()
    })?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(
            "SPECTRA_CONVEX_URL must be a complete http:// or https:// Convex URL.".to_string(),
        );
    }
    Ok(url)
}

fn deployment_url(journal: &Journal) -> Result<String, String> {
    let url = configured_deployment_url(std::env::var("SPECTRA_CONVEX_URL").ok())?;
    journal
        .set_config("deployment_url", &url)
        .map_err(|error| error.to_string())?;
    Ok(url)
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
        let _ = enqueue_unlocked_path(grant, journal, path);
        return Ok(false);
    }
    let _ = journal.delete_config(&lock_hold_key(&grant.id, &resource.local_resource_id));
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

fn lock_hold_key(grant_id: &str, resource_id: &str) -> String {
    format!("lock_held:{grant_id}:{resource_id}")
}

fn enqueue_lock_report(
    grant: &Grant,
    journal: &Journal,
    path: &std::path::Path,
    op: &str,
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
        let hold_key = lock_hold_key(&grant.id, &resource.local_resource_id);
        if op == "locked" && journal.config(&hold_key)?.is_some() {
            continue;
        }
        if op == "unlocked" && journal.config(&hold_key)?.is_none() {
            continue;
        }
        let before = resource
            .content_hash
            .as_deref()
            .or(resource.revision.as_deref());
        let mut key = derived_change_key(
            &grant.id,
            &resource.local_resource_id,
            None,
            &resource.path_key,
            before,
            None,
            op,
        );
        let mut operation = journal.begin_intent(
            &key,
            "cloud.report-change",
            Some(&resource.local_resource_id),
            before,
            None,
        )?;
        if operation.state == OpState::Verified && op == "locked" {
            key = derived_change_key(
                &grant.id,
                &resource.local_resource_id,
                None,
                &resource.path_key,
                before,
                None,
                &format!("locked:{}", uuid::Uuid::new_v4().simple()),
            );
            operation = journal.begin_intent(
                &key,
                "cloud.report-change",
                Some(&resource.local_resource_id),
                before,
                None,
            )?;
        }
        if operation.state != OpState::Verified {
            let envelope = QueuedChangeEnvelope {
                grant_id: grant.id.clone(),
                mount_id: mount_id.clone(),
                change: ReportedChange {
                    journal_id: operation.op_id.clone(),
                    resource_id: resource.local_resource_id.clone(),
                    op: op.into(),
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
        if op == "locked" {
            journal.set_config(&hold_key, "1")?;
        } else {
            let _ = journal.delete_config(&hold_key);
        }
    }
    Ok(queued)
}

fn enqueue_locked_path(
    grant: &Grant,
    journal: &Journal,
    path: &std::path::Path,
) -> anyhow::Result<usize> {
    enqueue_lock_report(grant, journal, path, "locked")
}

fn enqueue_unlocked_path(
    grant: &Grant,
    journal: &Journal,
    path: &std::path::Path,
) -> anyhow::Result<usize> {
    enqueue_lock_report(grant, journal, path, "unlocked")
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
            Backoff::delay_for_attempt(delivery.item.attempts, &delivery.item.op_id),
        );
    }
    let mut snapshot = match stable_file_snapshot(&target) {
        Ok(Some(snapshot)) => snapshot,
        Ok(None) => {
            return journal.retry_queue(
                delivery.item.id,
                Backoff::delay_for_attempt(delivery.item.attempts, &delivery.item.op_id),
            );
        }
        Err(_) => {
            return journal.retry_queue(
                delivery.item.id,
                Backoff::delay_for_attempt(delivery.item.attempts, &delivery.item.op_id),
            );
        }
    };
    let bytes = match snapshot.read_bytes() {
        Ok(bytes) => bytes,
        Err(_) => {
            return journal.retry_queue(
                delivery.item.id,
                Backoff::delay_for_attempt(delivery.item.attempts, &delivery.item.op_id),
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
            Backoff::delay_for_attempt(delivery.item.attempts, &delivery.item.op_id),
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
        let locked = file_held_by_office(&entry_path);
        if locked {
            locked_files += 1;
            scan_complete = false;
            let _ = enqueue_locked_path(grant, journal, &entry_path);
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
        let registrations =
            discover_resources_page_with_timeout_split(&deployment, &credential, &mount_id, page)
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
        schedule_mount_repair_retry(
            journal,
            &grant.id,
            &format!(
                "{} file{} did not sync.",
                locked_files + isolated_failures,
                if locked_files + isolated_failures == 1 {
                    ""
                } else {
                    "s"
                },
            ),
            files.len().saturating_sub(isolated_failures),
            files.len() + locked_files,
        )
        .map(|_| ())
    } else {
        clear_mount_repair_retry(journal, &grant.id)?;
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
    record_write_progress(journal, "resolving-target", Some(&request), None);
    let relative = std::path::Path::new(&request.relative_path);
    let target = match resolve_write_target(
        grants,
        journal,
        &request.grant_id,
        &request.local_resource_id,
        relative,
    ) {
        Ok(target) => target,
        Err(error) => {
            record_write_progress(journal, "target-unavailable", Some(&request), None);
            complete_claimed_write(
                deployment,
                credential,
                journal,
                &request,
                "failed",
                None,
                Some(("target-unavailable", &error.to_string())),
            )
            .await?;
            return Ok(true);
        }
    };
    record_write_progress(journal, "checking-source", Some(&request), None);
    let actual_revision = match inspect_write_target(
        &HostPlatform,
        &target,
        &request.base_revision,
        Some(&request.content_hash),
    ) {
        ClaimPrecondition::Ready { revision } => {
            record_write_progress(journal, "source-ready", Some(&request), None);
            revision
        }
        ClaimPrecondition::Missing => {
            record_write_progress(journal, "source-missing", Some(&request), None);
            complete_claimed_write(
                deployment,
                credential,
                journal,
                &request,
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
            record_write_progress(journal, "source-locked", Some(&request), None);
            complete_claimed_write(
                deployment,
                credential,
                journal,
                &request,
                "waiting",
                None,
                Some(("office-locked", "Waiting for Office to finish saving")),
            )
            .await?;
            return Ok(false);
        }
        ClaimPrecondition::Stale { revision } => {
            record_write_progress(journal, "source-changed", Some(&request), None);
            complete_claimed_write(
                deployment,
                credential,
                journal,
                &request,
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
            record_write_progress(journal, "source-unreadable", Some(&request), None);
            complete_claimed_write(
                deployment,
                credential,
                journal,
                &request,
                "waiting",
                None,
                Some(("file-read-failed", &message)),
            )
            .await?;
            return Ok(false);
        }
    };
    record_write_progress(journal, "downloading-payload", Some(&request), None);
    let response = match reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(3))
        .timeout(spectra_bridge_core::retry::bridge_payload_timeout())
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
            Ok(bytes) => {
                record_write_progress(journal, "payload-downloaded", Some(&request), None);
                bytes.to_vec()
            }
            Err(error) => {
                record_write_progress(
                    journal,
                    "payload-download-failed",
                    Some(&request),
                    Some(if error.is_timeout() {
                        "timeout"
                    } else {
                        "body-read"
                    }),
                );
                complete_claimed_write(
                    deployment,
                    credential,
                    journal,
                    &request,
                    "waiting",
                    None,
                    Some(("payload-download-failed", &error.to_string())),
                )
                .await?;
                return Ok(false);
            }
        },
        Err(error) => {
            record_write_progress(
                journal,
                "payload-download-failed",
                Some(&request),
                Some(if error.is_timeout() {
                    "timeout"
                } else {
                    "request"
                }),
            );
            complete_claimed_write(
                deployment,
                credential,
                journal,
                &request,
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
        record_write_progress(journal, "payload-hash-mismatch", Some(&request), None);
        complete_claimed_write(
            deployment,
            credential,
            journal,
            &request,
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
    if !refresh_write_claim(deployment, credential, &request).await? {
        record_write_progress(journal, "claim-no-longer-current", Some(&request), None);
        return Ok(true);
    }
    let writer = SafeWriter::new(grants.clone(), journal.clone(), Arc::new(HostPlatform));
    record_write_progress(journal, "safe-writer-started", Some(&request), None);
    let result = writer.write_with_readback(WriteRequest {
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
        Ok(write_result) => {
            record_write_progress(journal, "safe-writer-verified", Some(&request), None);
            complete_claimed_write(
                deployment,
                credential,
                journal,
                &request,
                "verified",
                Some(&write_result.verified_revision),
                None,
            )
            .await?;
            Ok(true)
        }
        Err(FsError::FileLocked) => {
            record_write_progress(journal, "safe-writer-locked", Some(&request), None);
            complete_claimed_write(
                deployment,
                credential,
                journal,
                &request,
                "waiting",
                Some(&actual_revision),
                Some(("office-locked", "Waiting for Office to finish saving")),
            )
            .await?;
            Ok(false)
        }
        Err(FsError::StaleRevision) => {
            record_write_progress(journal, "safe-writer-stale", Some(&request), None);
            complete_claimed_write(
                deployment,
                credential,
                journal,
                &request,
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
            record_write_progress(journal, "safe-writer-failed", Some(&request), None);
            complete_claimed_write(
                deployment,
                credential,
                journal,
                &request,
                "failed",
                Some(&actual_revision),
                Some(("write-failed", &error.to_string())),
            )
            .await?;
            Ok(true)
        }
    }
}

async fn drain_pending_payload_uploads(
    grants: &Arc<GrantRegistry>,
    journal: &Arc<Journal>,
    deployment: &str,
    credential: &str,
) -> anyhow::Result<usize> {
    let mut uploaded = 0usize;
    for _ in 0..10 {
        let page = claim_pending_payload_upload(deployment, credential).await?;
        let Some(request) = page.request else {
            if page.has_more {
                continue;
            }
            break;
        };
        if !finish_pending_payload_upload(grants, journal, deployment, credential, request).await? {
            break;
        }
        uploaded += 1;
    }
    Ok(uploaded)
}

async fn finish_pending_payload_upload(
    grants: &Arc<GrantRegistry>,
    journal: &Arc<Journal>,
    deployment: &str,
    credential: &str,
    request: ClaimedPayloadUpload,
) -> anyhow::Result<bool> {
    let Some(grant) = grants
        .device_grants()
        .into_iter()
        .find(|grant| grant.id == request.grant_id)
    else {
        return Ok(false);
    };
    let target = match grants.resolve(
        &request.grant_id,
        std::path::Path::new(&request.relative_path),
    ) {
        Ok(path) => path,
        Err(_) => return Ok(false),
    };
    if !target.exists() || is_office_lock_file(&target) {
        return Ok(false);
    }
    if HostPlatform.is_locked(&target).unwrap_or(false) {
        let _ = enqueue_locked_path(&grant, journal, &target);
        return Ok(false);
    }
    if office_lock_exists(&target) {
        let _ = enqueue_locked_path(&grant, journal, &target);
    }
    let mut snapshot = match stable_file_snapshot(&target) {
        Ok(Some(snapshot)) => snapshot,
        Ok(None) | Err(_) => {
            let _ = enqueue_locked_path(&grant, journal, &target);
            return Ok(false);
        }
    };
    let bytes = snapshot.read_bytes()?;
    let hash = hex::encode(sha2::Sha256::digest(&bytes));
    drop(snapshot);
    if !carries_native_payload(&request.native_format) {
        return Ok(false);
    }
    upload_resource_payload(
        deployment,
        credential,
        &request.replica_id,
        &bytes,
        &hash,
        media_type(&request.native_format),
    )
    .await?;
    Ok(true)
}

async fn drain_write_requests(
    grants: &Arc<GrantRegistry>,
    journal: &Arc<Journal>,
    deployment: &str,
    credential: &str,
) -> anyhow::Result<usize> {
    let mut by_replica = BTreeMap::<String, Vec<ClaimedWrite>>::new();
    // Bound simultaneous payload memory and time spent prefetching leases.
    for _ in 0..4 {
        let request = match claim_write(deployment, credential).await {
            Ok(Some(request)) => request,
            Ok(None) => break,
            Err(error) => {
                let error_text = error.to_string();
                let error_hint = error_text.split("; body=").next().unwrap_or(&error_text);
                record_write_progress(journal, "claim-failed", None, Some(error_hint));
                return Err(error);
            }
        };
        record_write_progress(journal, "claimed", Some(&request), None);
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
                        complete_claimed_write(
                            &deployment,
                            &credential,
                            &journal,
                            &blocked,
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
            complete_claimed_structure(
                deployment,
                credential,
                journal,
                &request,
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
        if !refresh_structure_claim(deployment, credential, &request).await? {
            continue;
        }
        let writer = SafeWriter::new(grants.clone(), journal.clone(), Arc::new(HostPlatform));
        let result = match request.kind.as_str() {
            "delete" => writer
                .recycle_with_base(
                    &request.grant_id,
                    relative_source,
                    &request.local_resource_id,
                    &request.idempotency_key,
                    request.base_revision.as_deref(),
                )
                .map(|_| None),
            "move" | "rename" => match target_candidate {
                Some(target) => (|| -> Result<Option<String>, FsError> {
                    // Validate before creating parents; a symlink in the
                    // selected folder must not authorize directories outside it.
                    grants.resolve(&request.grant_id, target)?;
                    let candidate = collision_path(grant.device_root(), target);
                    let actual = journal.reserve_structure_target(
                        &request.idempotency_key,
                        &candidate.to_string_lossy().replace('\\', "/"),
                    )?;
                    writer.relocate_with_base(
                        &request.grant_id,
                        relative_source,
                        std::path::Path::new(&actual),
                        &request.local_resource_id,
                        &request.idempotency_key,
                        request.base_revision.as_deref(),
                    )?;
                    Ok(Some(actual))
                })(),
                None => Err(FsError::Other(anyhow::anyhow!("structure target missing"))),
            },
            _ => Err(FsError::Other(anyhow::anyhow!(
                "unknown structure operation"
            ))),
        };
        match result {
            Ok(actual) => {
                complete_claimed_structure(
                    deployment,
                    credential,
                    journal,
                    &request,
                    "verified",
                    actual.as_deref(),
                    None,
                )
                .await?
            }
            Err(FsError::FileLocked) => {
                complete_claimed_structure(
                    deployment,
                    credential,
                    journal,
                    &request,
                    "waiting",
                    None,
                    Some(("office-locked", "The file is open in another application.")),
                )
                .await?
            }
            Err(error) => {
                complete_claimed_structure(
                    deployment,
                    credential,
                    journal,
                    &request,
                    if matches!(error, FsError::StaleRevision) {
                        "conflicted"
                    } else if matches!(error, FsError::Io(_)) {
                        "waiting"
                    } else {
                        "failed"
                    },
                    None,
                    Some((
                        if matches!(error, FsError::StaleRevision) {
                            "stale-revision"
                        } else {
                            "structure-operation-failed"
                        },
                        &error.to_string(),
                    )),
                )
                .await?
            }
        }
        handled += 1;
    }
    Ok(handled)
}

async fn complete_claimed_write(
    deployment: &str,
    credential: &str,
    journal: &Journal,
    request: &ClaimedWrite,
    outcome: &str,
    actual_revision: Option<&str>,
    error: Option<(&str, &str)>,
) -> anyhow::Result<bool> {
    record_write_progress(journal, "ack-enqueue", Some(request), Some(outcome));
    journal.enqueue_native_ack(
        &request.request_id,
        request.claim_generation,
        request.claim_token.as_deref(),
        outcome,
        actual_revision,
        error,
    )?;
    let ack = journal.due_native_acks(500)?.into_iter().find(|item| {
        item.kind == "write"
            && item.request_id == request.request_id
            && item.outcome == outcome
            && item.claim_generation == request.claim_generation
            && item.claim_token.as_deref() == request.claim_token.as_deref()
    });
    let Some(ack) = ack else {
        record_write_progress(journal, "ack-not-due", Some(request), None);
        return Ok(false);
    };
    let result = complete_write_with_claim(
        deployment,
        credential,
        &ack.request_id,
        &ack.outcome,
        ack.actual_revision.as_deref(),
        match (ack.error_code.as_deref(), ack.error_message.as_deref()) {
            (Some(code), Some(message)) => Some((code, message)),
            _ => None,
        },
        ack.claim_generation,
        ack.claim_token.as_deref(),
    )
    .await;
    match result {
        Ok(completion) => {
            record_write_progress(
                journal,
                if completion.ignored {
                    "ack-ignored"
                } else {
                    "acknowledged"
                },
                Some(request),
                completion
                    .reason
                    .as_deref()
                    .or(Some(completion.state.as_str())),
            );
            journal.acknowledge_native_ack(ack.id)?;
            Ok(true)
        }
        Err(error) => {
            record_write_progress(
                journal,
                "ack-retry",
                Some(request),
                Some(if error.to_string().contains("BRIDGE_CREDENTIAL_INVALID") {
                    "credential-invalid"
                } else {
                    "request-failed"
                }),
            );
            let retry_key = ack.id.to_string();
            journal
                .retry_native_ack(ack.id, Backoff::delay_for_attempt(ack.attempts, &retry_key))?;
            // The file operation has already reached its local durable state;
            // only the cloud acknowledgement remains to be retried.
            let _ = error;
            Ok(false)
        }
    }
}

async fn drain_native_ack_queue(
    journal: &Journal,
    deployment: &str,
    credential: &str,
) -> anyhow::Result<usize> {
    let mut handled = 0;
    for ack in journal.due_native_acks(100)? {
        let result = send_native_ack(deployment, credential, &ack).await;
        match result {
            Ok(_) => {
                journal.acknowledge_native_ack(ack.id)?;
                handled += 1;
            }
            Err(_) => {
                let retry_key = ack.id.to_string();
                journal.retry_native_ack(
                    ack.id,
                    Backoff::delay_for_attempt(ack.attempts, &retry_key),
                )?;
            }
        }
    }
    Ok(handled)
}

async fn send_native_ack(
    deployment: &str,
    credential: &str,
    ack: &NativeAckItem,
) -> anyhow::Result<WriteCompletion> {
    let error = match (ack.error_code.as_deref(), ack.error_message.as_deref()) {
        (Some(code), Some(message)) => Some((code, message)),
        _ => None,
    };
    match ack.kind.as_str() {
        "structure" => {
            complete_fs_request_with_claim(
                deployment,
                credential,
                &ack.request_id,
                &ack.outcome,
                ack.actual_relative_path.as_deref(),
                error,
                ack.claim_generation,
                ack.claim_token.as_deref(),
            )
            .await
        }
        "write" => {
            complete_write_with_claim(
                deployment,
                credential,
                &ack.request_id,
                &ack.outcome,
                ack.actual_revision.as_deref(),
                error,
                ack.claim_generation,
                ack.claim_token.as_deref(),
            )
            .await
        }
        _ => anyhow::bail!("unsupported native acknowledgement kind"),
    }
}

async fn complete_claimed_structure(
    deployment: &str,
    credential: &str,
    journal: &Journal,
    request: &ClaimedFsRequest,
    outcome: &str,
    actual_path: Option<&str>,
    error: Option<(&str, &str)>,
) -> anyhow::Result<()> {
    journal.enqueue_structure_ack(
        &request.request_id,
        request.claim_generation,
        request.claim_token.as_deref(),
        outcome,
        actual_path,
        error,
    )?;
    let ack = journal.due_native_acks(500)?.into_iter().find(|ack| {
        ack.kind == "structure"
            && ack.request_id == request.request_id
            && ack.claim_generation == request.claim_generation
            && ack.claim_token == request.claim_token
    });
    if let Some(ack) = ack {
        if send_native_ack(deployment, credential, &ack).await.is_ok() {
            journal.acknowledge_native_ack(ack.id)?;
        } else {
            journal.retry_native_ack(
                ack.id,
                Backoff::delay_for_attempt(ack.attempts, &ack.id.to_string()),
            )?;
        }
    }
    Ok(())
}

fn spawn_grant_watcher(
    grant: Grant,
    grants: Arc<GrantRegistry>,
    journal: Arc<Journal>,
    wake: PollWake,
    active_mount_syncs: ActiveMountSyncs,
) {
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
        let mut last_hold_scan = std::time::Instant::now();
        let mut hold_scan_cursor: Option<String> = None;
        let mut watcher_start_attempts = 0u32;
        let mut next_watcher_start = std::time::Instant::now();
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
            if wake.is_shutdown() {
                break;
            }
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
            if watcher.is_none() && std::time::Instant::now() >= next_watcher_start {
                watcher =
                    MountWatcher::start(std::path::Path::new(grant.device_root()), config.clone())
                        .ok();
                if watcher.is_none() {
                    watcher_start_attempts = watcher_start_attempts.saturating_add(1);
                    let delay_ms = bridge_mount_repair_delay_ms(
                        watcher_start_attempts,
                        &format!("watcher:{}", grant.id),
                    );
                    next_watcher_start =
                        std::time::Instant::now() + std::time::Duration::from_millis(delay_ms);
                    let _ = set_mount_status(
                        &journal,
                        &grant.id,
                        "waiting",
                        &format!(
                            "Folder change monitoring could not start. Retrying in {}.",
                            display_retry_delay(delay_ms),
                        ),
                        0,
                        0,
                    );
                } else {
                    watcher_start_attempts = 0;
                    next_watcher_start = std::time::Instant::now();
                    let _ = sync_grant(&grant, &journal, &active_mount_syncs).await;
                    let marker_key = format!("mount_availability:{}", grant.id);
                    let was_unavailable = journal.config(&marker_key).ok().flatten().as_deref()
                        == Some("unavailable");
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
            }
            if watcher.is_none() {
                if mount_repair_retry_due(&journal, &grant.id) {
                    let _ = sync_grant(&grant, &journal, &active_mount_syncs).await;
                    last_reconciliation = std::time::Instant::now();
                }
                if last_reconciliation.elapsed() >= config.reconciliation_interval {
                    let _ = sync_grant(&grant, &journal, &active_mount_syncs).await;
                    last_reconciliation = std::time::Instant::now();
                }
                continue;
            }
            if mount_repair_retry_due(&journal, &grant.id) {
                let _ = sync_grant(&grant, &journal, &active_mount_syncs).await;
                last_reconciliation = std::time::Instant::now();
            }
            let batch = watcher
                .as_ref()
                .map(MountWatcher::drain_paths)
                .unwrap_or_default();
            let mut local_work_queued = false;
            let observed_at = std::time::Instant::now();
            // `classify_changed_paths` already maps Office owner files to the
            // documents they lock, so neither list contains a `~$` path.
            for path in batch.existing_files {
                stability.mark_changed(&path);
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
                if file_held_by_office(&path) {
                    if enqueue_locked_path(&grant, &journal, &path)
                        .map(|queued| queued > 0)
                        .unwrap_or(false)
                    {
                        local_work_queued = true;
                        let _ = set_mount_status(
                            &journal,
                            &grant.id,
                            "waiting",
                            "A file is open in Office. Spectra will sync it after Office finishes saving.",
                            0,
                            0,
                        );
                    }
                    continue;
                }
                if enqueue_unlocked_path(&grant, &journal, &path)
                    .map(|queued| queued > 0)
                    .unwrap_or(false)
                {
                    local_work_queued = true;
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
                            Ok(changed) => {
                                local_work_queued |= changed;
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
                    Ok(queued) => {
                        local_work_queued |= queued > 0;
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
            if last_hold_scan.elapsed() >= std::time::Duration::from_secs(2) {
                last_hold_scan = std::time::Instant::now();
                if let Ok(resources) =
                    journal.resource_probe_page(&grant.id, hold_scan_cursor.as_deref(), 100)
                {
                    hold_scan_cursor = if resources.len() == 100 {
                        resources
                            .last()
                            .map(|resource| resource.local_resource_id.clone())
                    } else {
                        None
                    };
                    for resource in resources {
                        if !resource.available {
                            continue;
                        }
                        let held_path = grant
                            .device_root()
                            .join(std::path::Path::new(&resource.path_key));
                        if file_held_by_office(&held_path) {
                            if enqueue_locked_path(&grant, &journal, &held_path)
                                .map(|queued| queued > 0)
                                .unwrap_or(false)
                            {
                                local_work_queued = true;
                            }
                        } else {
                            if enqueue_unlocked_path(&grant, &journal, &held_path)
                                .map(|queued| queued > 0)
                                .unwrap_or(false)
                            {
                                local_work_queued = true;
                            }
                        }
                    }
                }
            }
            if last_reconciliation.elapsed() >= config.reconciliation_interval {
                let _ = sync_grant(&grant, &journal, &active_mount_syncs).await;
                last_reconciliation = std::time::Instant::now();
            }
            if local_work_queued {
                // The journal is the idempotent side-effect boundary. This is
                // only a wake hint; a worker retry never replays a completed
                // native write because claims and receipts remain durable.
                wake.wake();
            }
        }
    });
}

async fn sync_grant(
    grant: &Grant,
    journal: &Journal,
    active_mount_syncs: &ActiveMountSyncs,
) -> Result<MountSyncOutcome, String> {
    let Some(_active_mount_sync) = ActiveMountSyncGuard::acquire(active_mount_syncs, &grant.id)
    else {
        return Ok(MountSyncOutcome::AlreadyRunning);
    };
    if !grant.is_available() {
        set_mount_status(
            journal,
            &grant.id,
            "unavailable",
            "Folder is unavailable on this device; reconnect the drive to resume.",
            0,
            0,
        )?;
        return Ok(MountSyncOutcome::Completed);
    }
    match run_sync(grant, journal).await {
        Ok(()) => Ok(MountSyncOutcome::Completed),
        Err(error) => {
            record_runtime_error(journal, "Mount repair scan failed", &error);
            match schedule_mount_repair_retry(journal, &grant.id, &error, 0, 0) {
                Ok(_) => Ok(MountSyncOutcome::RetryScheduled),
                Err(schedule_error) => {
                    let detail =
                        format!("{error}. Automatic retry could not be saved: {schedule_error}");
                    let _ = set_mount_status(journal, &grant.id, "error", &detail, 0, 0);
                    Err(detail)
                }
            }
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
    let result = complete_pairing_offer(&offer, &state, &runtime.journal).await;
    if result.is_ok() {
        runtime.wake.wake_configuration();
    }
    result
}

async fn select_mount_impl(
    app: &tauri::AppHandle,
    grants: &Arc<GrantRegistry>,
    journal: &Arc<Journal>,
    wake: &PollWake,
    active_mount_syncs: &ActiveMountSyncs,
) -> Result<Option<(String, String)>, String> {
    let (selection_tx, selection_rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |selection| {
        let _ = selection_tx.send(selection);
    });
    let selection = selection_rx
        .await
        .map_err(|_| "Folder picker closed before returning a selection".to_string())?;
    let Some(selection) = selection else {
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
    spawn_grant_watcher(
        grant.clone(),
        grants.clone(),
        journal.clone(),
        wake.clone(),
        active_mount_syncs.clone(),
    );
    wake.wake();
    Ok(Some((grant.id, label)))
}

#[tauri::command]
async fn select_mount(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, BridgeRuntime>,
) -> Result<Option<(String, String)>, String> {
    select_mount_impl(
        &app,
        &runtime.grants,
        &runtime.journal,
        &runtime.wake,
        &runtime.active_mount_syncs,
    )
    .await
}

async fn retry_mount_impl(
    grant_id: &str,
    grants: &Arc<GrantRegistry>,
    journal: &Arc<Journal>,
    wake: &PollWake,
    active_mount_syncs: &ActiveMountSyncs,
) -> Result<(), String> {
    let grant = grants
        .device_grants()
        .into_iter()
        .find(|grant| grant.id == grant_id)
        .ok_or_else(|| "Folder grant not found".to_string())?;
    let already_running = active_mount_syncs
        .lock()
        .expect("mount sync gate is not poisoned")
        .contains(&grant.id);
    if already_running {
        return Ok(());
    }
    clear_mount_repair_retry(journal, &grant.id)?;
    set_mount_status(
        journal,
        &grant.id,
        "scanning",
        "Repair scan queued; existing changes remain safe.",
        0,
        0,
    )?;
    let grant_for_scan = grant.clone();
    let journal_for_scan = journal.clone();
    let active_mount_syncs_for_scan = active_mount_syncs.clone();
    let wake_for_scan = wake.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = sync_grant(
            &grant_for_scan,
            &journal_for_scan,
            &active_mount_syncs_for_scan,
        )
        .await
        {
            record_runtime_error(&journal_for_scan, "Repair scan failed", &error);
        }
        wake_for_scan.wake();
    });
    wake.wake();
    Ok(())
}

#[tauri::command]
async fn retry_mount(
    grant_id: String,
    runtime: tauri::State<'_, BridgeRuntime>,
) -> Result<(), String> {
    retry_mount_impl(
        &grant_id,
        &runtime.grants,
        &runtime.journal,
        &runtime.wake,
        &runtime.active_mount_syncs,
    )
    .await
}

async fn remove_mount_impl(
    grant_id: &str,
    grants: &Arc<GrantRegistry>,
    journal: &Arc<Journal>,
    wake: &PollWake,
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
    wake.wake();
    Ok(())
}

#[tauri::command]
async fn remove_mount(
    grant_id: String,
    runtime: tauri::State<'_, BridgeRuntime>,
) -> Result<(), String> {
    remove_mount_impl(&grant_id, &runtime.grants, &runtime.journal, &runtime.wake).await
}

fn open_log_file(path: &std::path::Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg(path)
            .creation_flags(WINDOWS_CREATE_NO_WINDOW)
            .spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(path).spawn()?;
    }
    Ok(())
}

fn open_logs_impl(app: &tauri::AppHandle, journal: &Journal) -> Result<(), String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join("bridge-diagnostics.log");
    let contents = journal
        .diagnostic_log(200)
        .map_err(|error| error.to_string())?;
    let last_runtime_error = journal
        .config("last_runtime_error")
        .ok()
        .flatten()
        .map(|error| format!("runtime: {error}"));
    let contents = if contents.is_empty() && last_runtime_error.is_none() {
        "No bridge operations have been recorded yet.\n".to_owned()
    } else {
        format!(
            "{}{}\n",
            contents,
            last_runtime_error
                .map(|error| format!("{error}\n"))
                .unwrap_or_default()
        )
    };
    std::fs::write(&path, contents).map_err(|error| error.to_string())?;
    open_log_file(&path).map_err(|error| format!("Could not open the Bridge log: {error}"))
}

async fn run_sync_iteration(
    grants: &Arc<GrantRegistry>,
    journal: &Arc<Journal>,
    state: &Arc<ServerState>,
    active_mount_syncs: &ActiveMountSyncs,
    restored_grants_reconciled: &mut HashSet<String>,
    last_compaction: &mut std::time::Instant,
    deployment: &mut Option<String>,
    configuration_dirty: &mut bool,
) -> PollResult {
    if *configuration_dirty || deployment.is_none() {
        match deployment_url(journal) {
            Ok(url) => {
                *deployment = Some(url);
                *configuration_dirty = false;
            }
            Err(error) => {
                let _ = journal.set_config("deployment_error", &error);
                return PollResult::FailedConfiguration;
            }
        }
    }
    let Some(deployment) = deployment.as_deref() else {
        return PollResult::FailedConfiguration;
    };
    let device_id = match journal.config("device_id") {
        Ok(Some(device_id)) => device_id,
        Ok(None) => return PollResult::Disconnected,
        Err(error) => {
            let _ = journal.set_config("device_error", &error.to_string());
            return PollResult::FailedConfiguration;
        }
    };
    let credential = match HostPlatform.read_credential(&device_id) {
        Ok(Some(credential)) => credential,
        Ok(None) => return PollResult::Unauthenticated,
        Err(error) => {
            let _ = journal.set_config("credential_error", &error.to_string());
            return PollResult::Unauthenticated;
        }
    };

    if let Err(error) = run_replica_migration(journal, deployment, &credential).await {
        let _ = journal.set_config("replica_migration_error", &error);
        return PollResult::FailedMigration;
    }
    let _ = journal.delete_config("replica_migration_error");

    let mut failed = false;
    let device_grants = grants.device_grants();
    retain_current_mounts(
        restored_grants_reconciled,
        device_grants.iter().map(|grant| grant.id.clone()),
    );
    for grant in device_grants {
        if restored_grants_reconciled.contains(&grant.id) {
            continue;
        }
        match sync_grant(&grant, journal, active_mount_syncs).await {
            Ok(MountSyncOutcome::Completed | MountSyncOutcome::RetryScheduled) => {
                restored_grants_reconciled.insert(grant.id);
            }
            Ok(MountSyncOutcome::AlreadyRunning) => {
                restored_grants_reconciled.insert(grant.id);
            }
            Err(_) => failed = true,
        }
    }

    let mut cloud_request_succeeded = false;
    let native_ack_handled = match drain_native_ack_queue(journal, deployment, &credential).await {
        Ok(handled) => {
            cloud_request_succeeded |= handled > 0;
            let _ = journal.delete_config("native_ack_queue_error");
            handled
        }
        Err(error) => {
            failed = true;
            let _ = journal.set_config("native_ack_queue_error", &error.to_string());
            0
        }
    };
    match drain_cloud_queue(journal, deployment, &credential).await {
        Ok(deliveries) => {
            cloud_request_succeeded = true;
            let mut delivery_failed = false;
            let mut delivery_tasks = tokio::task::JoinSet::new();
            for delivery in deliveries {
                let grants = grants.clone();
                let journal = journal.clone();
                let deployment = deployment.to_owned();
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
                failed = true;
                let _ = journal.set_config(
                    "outbound_queue_error",
                    "One file change will retry; unrelated files continued.",
                );
            } else {
                let _ = journal.delete_config("outbound_queue_error");
            }
        }
        Err(error) => {
            failed = true;
            let message = error.to_string();
            let _ = journal.set_config("outbound_queue_error", &message);
            if message.contains("MOUNT_NOT_ACTIVE") {
                // Re-register cloud mounts for local grants so
                // LibreOffice/Office disk edits can upload again.
                restored_grants_reconciled.clear();
                for grant in grants.device_grants() {
                    if matches!(
                        sync_grant(&grant, journal, active_mount_syncs).await,
                        Ok(MountSyncOutcome::Completed
                            | MountSyncOutcome::RetryScheduled
                            | MountSyncOutcome::AlreadyRunning)
                    ) {
                        restored_grants_reconciled.insert(grant.id);
                    }
                }
            }
        }
    }

    let structure_handled =
        match drain_structure_requests(grants, journal, deployment, &credential).await {
            Ok(handled) => {
                cloud_request_succeeded = true;
                let _ = journal.delete_config("structure_queue_error");
                handled
            }
            Err(error) => {
                failed = true;
                let _ = journal.set_config("structure_queue_error", &error.to_string());
                0
            }
        };
    let payload_handled =
        match drain_pending_payload_uploads(grants, journal, deployment, &credential).await {
            Ok(handled) => {
                cloud_request_succeeded = true;
                let _ = journal.delete_config("payload_queue_error");
                handled
            }
            Err(error) => {
                failed = true;
                let _ = journal.set_config("payload_queue_error", &error.to_string());
                0
            }
        };
    let write_handled = match drain_write_requests(grants, journal, deployment, &credential).await {
        Ok(handled) => {
            cloud_request_succeeded = true;
            let _ = journal.delete_config("write_queue_error");
            handled
        }
        Err(error) => {
            failed = true;
            let _ = journal.set_config("write_queue_error", &error.to_string());
            0
        }
    };

    if cloud_request_succeeded {
        // Cloud-connected status is evidence that at least one actual cloud
        // request returned successfully, not merely that local config exists.
        state.mark_cloud_seen();
    }
    if last_compaction.elapsed() >= std::time::Duration::from_secs(6 * 60 * 60) {
        let older_than = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64
            - 7 * 24 * 60 * 60 * 1_000;
        match journal.compact_verified(older_than) {
            Ok(_) => {
                let _ = journal.delete_config("journal_compaction_error");
            }
            Err(error) => {
                let _ = journal.set_config("journal_compaction_error", &error.to_string());
            }
        }
        *last_compaction = std::time::Instant::now();
    }

    if failed {
        PollResult::FailedRequest
    } else if native_ack_handled + structure_handled + payload_handled + write_handled > 0 {
        PollResult::WorkCompleted
    } else {
        PollResult::SuccessfulIdle
    }
}

async fn run_sync_worker(
    grants: Arc<GrantRegistry>,
    journal: Arc<Journal>,
    state: Arc<ServerState>,
    wake: PollWake,
    active_mount_syncs: ActiveMountSyncs,
) {
    // UUID v4 supplies an independent per-process component. The scheduler
    // folds the persisted device ID into it once pairing is available.
    let process_seed = uuid::Uuid::new_v4().as_u128() as u64;
    let mut scheduler = PollScheduler::new(process_seed);
    let mut device_id = None;
    let mut restored_grants_reconciled = HashSet::new();
    let mut last_compaction = std::time::Instant::now();
    let mut deployment = None;
    let mut configuration_dirty = true;

    loop {
        if wake.is_shutdown() {
            break;
        }
        if let Ok(Some(current_device_id)) = journal.config("device_id") {
            if device_id.as_deref() != Some(current_device_id.as_str()) {
                scheduler.set_device_id(Some(&current_device_id));
                device_id = Some(current_device_id);
            }
        }
        let result = run_sync_iteration(
            &grants,
            &journal,
            &state,
            &active_mount_syncs,
            &mut restored_grants_reconciled,
            &mut last_compaction,
            &mut deployment,
            &mut configuration_dirty,
        )
        .await;
        if result == PollResult::Disconnected || result == PollResult::Unauthenticated {
            restored_grants_reconciled.clear();
        }
        scheduler.record(result);
        match wake.wait(scheduler.next_delay()).await {
            WaitResult::Shutdown => break,
            WaitResult::Woken => {
                // A wake may represent pairing, a credential/config change,
                // or local journal work. Only the first two require re-reading
                // deployment config; repeated signals are coalesced by PollWake.
                if wake.take_configuration_changed() {
                    configuration_dirty = true;
                }
            }
            WaitResult::TimedOut => {}
        }
    }
}

#[tauri::command]
fn open_logs(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, BridgeRuntime>,
) -> Result<(), String> {
    open_logs_impl(&app, &runtime.journal)
}

fn main() {
    configure_embedded_release_environment();
    record_process_start();
    let sync_wake = PollWake::new();
    let shutdown_wake = sync_wake.clone();
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
            remove_mount,
            open_logs
        ])
        .setup(move |app| {
            let sync_wake = sync_wake.clone();
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
                wake: sync_wake.clone(),
                active_mount_syncs: Arc::new(Mutex::new(HashSet::new())),
            });
            let active_mount_syncs = app.state::<BridgeRuntime>().active_mount_syncs.clone();
            state.install_local_control(Arc::new(SpectraLocalControl {
                app: app.handle().clone(),
                state: state.clone(),
                grants: grants.clone(),
                journal: journal.clone(),
                wake: sync_wake.clone(),
                active_mount_syncs: active_mount_syncs.clone(),
            }));
            for grant in restored_grants {
                spawn_grant_watcher(
                    grant,
                    grants.clone(),
                    journal.clone(),
                    sync_wake.clone(),
                    active_mount_syncs.clone(),
                );
            }
            let sync_journal = app.state::<BridgeRuntime>().journal.clone();
            let sync_grants = app.state::<BridgeRuntime>().grants.clone();
            let sync_state = state.clone();
            tauri::async_runtime::spawn(run_sync_worker(
                sync_grants,
                sync_journal,
                sync_state,
                sync_wake.clone(),
                active_mount_syncs,
            ));
            let server_journal = journal.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = serve(state).await {
                    record_runtime_error(&server_journal, "Bridge server stopped", &error);
                }
            });
            let show = MenuItem::with_id(app, "show", "Open Spectra Bridge", true, None::<&str>)?;
            let logs = MenuItem::with_id(app, "logs", "Open logs", true, None::<&str>)?;
            let stop = MenuItem::with_id(app, "stop", "Stop Bridge", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &logs, &stop])?;
            let tray_journal = journal.clone();
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Spectra Bridge · Disconnected")
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "logs" => {
                        if let Err(error) = open_logs_impl(app, &tray_journal) {
                            record_runtime_error(
                                &tray_journal,
                                "Could not open the Bridge log",
                                &error,
                            );
                        }
                    }
                    "stop" => app.exit(0),
                    _ => {}
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
        .build(tauri::generate_context!())
        .expect("Spectra Bridge shell failed")
        .run(move |_app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                shutdown_wake.shutdown();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{
        ActiveMountSyncGuard, MountRepairRetry, clear_mount_repair_retry,
        configured_deployment_url, mount_repair_retry_due, mount_repair_retry_key,
        resolve_bridge_data_dir, retain_current_mounts, schedule_mount_repair_retry,
    };
    use spectra_bridge_core::journal::Journal;
    use std::collections::HashSet;
    use std::sync::{Arc, Mutex};

    #[test]
    fn bridge_requires_an_explicit_convex_url() {
        let error = configured_deployment_url(None).unwrap_err();
        assert!(error.contains("Set SPECTRA_CONVEX_URL"));
        assert!(configured_deployment_url(Some("   ".into())).is_err());
    }

    #[test]
    fn bridge_accepts_the_parameterized_local_convex_url() {
        assert_eq!(
            configured_deployment_url(Some(" http://127.0.0.1:3042/ ".into())).unwrap(),
            "http://127.0.0.1:3042"
        );
        assert!(configured_deployment_url(Some("file:///tmp/convex".into())).is_err());
    }

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

    #[test]
    fn active_mount_sync_gate_releases_when_scan_returns() {
        let active = Arc::new(Mutex::new(HashSet::new()));
        let guard = ActiveMountSyncGuard::acquire(&active, "grant-1");
        assert!(guard.is_some());
        assert!(!ActiveMountSyncGuard::acquire(&active, "grant-1").is_some());
        drop(guard);
        assert!(ActiveMountSyncGuard::acquire(&active, "grant-1").is_some());
    }

    #[tokio::test]
    async fn active_mount_sync_gate_releases_when_scan_panics() {
        let active = Arc::new(Mutex::new(HashSet::new()));
        let task_active = active.clone();
        let task = tokio::spawn(async move {
            let _guard = ActiveMountSyncGuard::acquire(&task_active, "grant-1")
                .expect("test scan should acquire the gate");
            panic!("simulated repair scan panic");
        });
        assert!(task.await.is_err());
        assert!(ActiveMountSyncGuard::acquire(&active, "grant-1").is_some());
    }

    #[test]
    fn successful_mounts_are_not_rescanned_when_another_mount_needs_retry() {
        let mut reconciled = HashSet::new();
        reconciled.insert("healthy".to_owned());

        let current_mounts = ["healthy", "offline"];
        retain_current_mounts(
            &mut reconciled,
            current_mounts.into_iter().map(str::to_owned),
        );
        let retry_mounts = current_mounts
            .into_iter()
            .filter(|mount_id| !reconciled.contains(*mount_id))
            .collect::<Vec<_>>();

        assert_eq!(retry_mounts, ["offline"]);
        reconciled.insert("offline".to_owned());
        retain_current_mounts(
            &mut reconciled,
            ["healthy", "offline"].into_iter().map(str::to_owned),
        );
        assert_eq!(reconciled.len(), 2);
    }

    #[test]
    fn removed_mounts_are_dropped_from_reconciliation_state() {
        let mut reconciled = HashSet::from(["removed".to_owned(), "current".to_owned()]);
        retain_current_mounts(&mut reconciled, ["current".to_owned()]);
        assert_eq!(reconciled, HashSet::from(["current".to_owned()]));
    }

    #[test]
    fn mount_repair_retry_is_durable_backed_off_and_cleared_on_success() {
        let journal = Journal::in_memory().unwrap();
        let first_delay =
            schedule_mount_repair_retry(&journal, "grant-safe", "Cloud unavailable.", 0, 2)
                .unwrap();
        let retry_key = mount_repair_retry_key("grant-safe");
        let first =
            serde_json::from_str::<MountRepairRetry>(&journal.config(&retry_key).unwrap().unwrap())
                .unwrap();
        assert_eq!(first.attempts, 1);
        assert!(!mount_repair_retry_due(&journal, "grant-safe"));
        let status: serde_json::Value =
            serde_json::from_str(&journal.config("mount_status:grant-safe").unwrap().unwrap())
                .unwrap();
        assert_eq!(status["state"], "waiting");
        assert!(
            status["detail"]
                .as_str()
                .unwrap()
                .contains("Automatic repair")
        );

        let due = MountRepairRetry {
            attempts: first.attempts,
            retry_at_ms: 0,
        };
        journal
            .set_config(&retry_key, &serde_json::to_string(&due).unwrap())
            .unwrap();
        assert!(mount_repair_retry_due(&journal, "grant-safe"));

        let second_delay =
            schedule_mount_repair_retry(&journal, "grant-safe", "Still offline.", 0, 2).unwrap();
        assert!(second_delay > first_delay);
        let second =
            serde_json::from_str::<MountRepairRetry>(&journal.config(&retry_key).unwrap().unwrap())
                .unwrap();
        assert_eq!(second.attempts, 2);
        clear_mount_repair_retry(&journal, "grant-safe").unwrap();
        assert!(!mount_repair_retry_due(&journal, "grant-safe"));
        assert_eq!(journal.config(&retry_key).unwrap(), None);
    }
}
