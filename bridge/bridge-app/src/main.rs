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
use spectra_bridge_core::protocol::{
    LocalControlSnapshot, LocalMountStatus, LocalOfficeFile, PairingOffer,
};
use spectra_bridge_core::retry::bridge_mount_repair_delay_ms;
use spectra_bridge_core::server::{LocalBridgeControl, ServerState, serve};
use spectra_bridge_core::sync::{
    Backoff, ClaimPrecondition, ClaimedFsRequest, ClaimedPayloadUpload, ClaimedWrite, CloudRefused,
    DeliveredChange, DeviceHealthReport, DiscoveredRegistration, DiscoveredResource,
    MAX_NATIVE_PAYLOAD_BYTES, QueuedChangeEnvelope, ReplicaMigrationPage, ReportedChange,
    WriteCompletion, claim_fs_request, claim_pending_payload_upload, claim_write,
    complete_fs_request_with_claim, complete_write_with_claim, detach_mount,
    discover_resources_page, drain_cloud_queue_holding, exchange_pairing, inspect_write_target,
    migrate_cloud_replica_page, reconcile_missing_resources, refresh_structure_claim,
    refresh_write_claim, register_mount, report_health, resume_pairing, set_mount_availability,
    upload_resource_payload,
};
use spectra_bridge_core::watcher::{
    MountWatcher, ScanEntry, StabilityTracker, WatcherConfig, file_held_by_office,
    is_office_lock_file, is_online_only, office_lock_exists, office_lock_paths, relative_key,
    reusable_hash, scan_mount, stable_file_snapshot,
};
use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;

struct BridgeRuntime {
    grants: Arc<GrantRegistry>,
    journal: Arc<Journal>,
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
    /// The folder is paused: nothing was scanned or sent. It is scanned again
    /// once it resumes.
    Paused,
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

/// Everything the Devices page does on this computer arrives here through the
/// local control API. Each change refreshes the tray at once.
#[async_trait::async_trait]
impl LocalBridgeControl for SpectraLocalControl {
    async fn auto_pair(&self, challenge: &str) -> Result<(), String> {
        let offer = self
            .state
            .take_pairing_offer(challenge)
            .map_err(|error| error.to_string())?;
        let result = complete_pairing_offer(&self.app, &offer, &self.state, &self.journal).await;
        if result.is_ok() {
            self.wake.wake_configuration();
            refresh_tray(&self.app);
        }
        result
    }

    async fn request_update(&self) -> Result<String, String> {
        request_bridge_update(&self.app).await
    }

    fn snapshot(&self) -> LocalControlSnapshot {
        control_snapshot(&self.grants, &self.journal)
    }

    async fn select_mount(&self) -> Result<(), String> {
        let result = select_mount_impl(
            &self.app,
            &self.grants,
            &self.journal,
            &self.wake,
            &self.active_mount_syncs,
        )
        .await
        .map(|_| ());
        refresh_tray(&self.app);
        result
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
        let result = remove_mount_impl(grant_id, &self.grants, &self.journal, &self.wake).await;
        refresh_tray(&self.app);
        result
    }

    async fn set_mount_paused(&self, grant_id: &str, paused: bool) -> Result<(), String> {
        set_mount_paused(&self.grants, &self.journal, grant_id, paused)?;
        self.wake.wake();
        refresh_tray(&self.app);
        Ok(())
    }

    async fn set_sync_paused(&self, paused: bool) -> Result<(), String> {
        set_sync_paused(&self.journal, paused)?;
        self.wake.wake();
        refresh_tray(&self.app);
        Ok(())
    }

    async fn open_logs(&self) -> Result<(), String> {
        open_logs_impl(&self.app, &self.journal)
    }

    async fn open_file(&self, grant_id: &str, relative_path: &str) -> Result<(), String> {
        let path = local_document(&self.grants, grant_id, relative_path)?;
        if !opens_in_desktop_app(&path) {
            return Err("Spectra opens Office documents on this computer, not other files.".into());
        }
        open_with_system(shell_path(&path).as_os_str())
            .map_err(|error| format!("Could not open the file: {error}"))
    }

    async fn reveal_file(&self, grant_id: &str, relative_path: &str) -> Result<(), String> {
        let path = local_document(&self.grants, grant_id, relative_path)?;
        reveal_in_file_manager(&shell_path(&path))
            .map_err(|error| format!("Could not show the file in its folder: {error}"))
    }

    async fn unpair(&self) -> Result<(), String> {
        unpair_this_computer(&self.grants, &self.journal)?;
        self.state.forget_pairing();
        self.wake.wake_configuration();
        refresh_tray(&self.app);
        Ok(())
    }
}

/* ---------------------------------------------------------------- local state */

const SYNC_PAUSED_KEY: &str = "sync_paused";
const LAST_SYNC_KEY: &str = "last_sync_at";

fn mount_paused_key(grant_id: &str) -> String {
    format!("mount_paused:{grant_id}")
}

fn mount_synced_at_key(grant_id: &str) -> String {
    format!("mount_synced_at:{grant_id}")
}

fn set_flag(journal: &Journal, key: &str, on: bool) -> Result<(), String> {
    if on {
        journal.set_config(key, "true")
    } else {
        journal.delete_config(key)
    }
    .map_err(|error| error.to_string())
}

fn flag(journal: &Journal, key: &str) -> bool {
    journal.config(key).ok().flatten().as_deref() == Some("true")
}

/// Syncing is paused for every folder, from the tray or the Devices page.
fn sync_paused(journal: &Journal) -> bool {
    flag(journal, SYNC_PAUSED_KEY)
}

fn set_sync_paused(journal: &Journal, paused: bool) -> Result<(), String> {
    set_flag(journal, SYNC_PAUSED_KEY, paused)
}

/// The folders paused one by one. Their changes wait in the journal.
fn paused_mounts(grants: &GrantRegistry, journal: &Journal) -> HashSet<String> {
    grants
        .device_grants()
        .into_iter()
        .map(|grant| grant.id)
        .filter(|grant_id| flag(journal, &mount_paused_key(grant_id)))
        .collect()
}

/// Whether this folder holds its changes: syncing is paused for every folder,
/// or for this one.
fn folder_paused(journal: &Journal, grant_id: &str) -> bool {
    sync_paused(journal) || flag(journal, &mount_paused_key(grant_id))
}

fn set_mount_paused(
    grants: &GrantRegistry,
    journal: &Journal,
    grant_id: &str,
    paused: bool,
) -> Result<(), String> {
    if !grants
        .device_grants()
        .iter()
        .any(|grant| grant.id == grant_id)
    {
        return Err("This folder is no longer on this computer.".into());
    }
    set_flag(journal, &mount_paused_key(grant_id), paused)
}

fn read_ms(journal: &Journal, key: &str) -> Option<u64> {
    journal
        .config(key)
        .ok()
        .flatten()
        .and_then(|value| value.parse().ok())
}

/// A pass that finished cleanly: every active folder that is not paused is
/// up to date as of now.
fn record_clean_pass(
    grants: &GrantRegistry,
    journal: &Journal,
    paused_grants: &HashSet<String>,
    now: u64,
) {
    let _ = journal.set_config(LAST_SYNC_KEY, &now.to_string());
    for grant in grants.device_grants() {
        if paused_grants.contains(&grant.id) {
            continue;
        }
        let active = journal
            .config(&format!("mount_status:{}", grant.id))
            .ok()
            .flatten()
            .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok())
            .is_some_and(|value| {
                value.get("state").and_then(|state| state.as_str()) == Some("active")
            });
        if active {
            let _ = journal.set_config(&mount_synced_at_key(&grant.id), &now.to_string());
        }
    }
}

/// The computer's name as its owner knows it.
fn this_device_name() -> String {
    static NAME: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    NAME.get_or_init(|| {
        #[cfg(target_os = "macos")]
        {
            if let Ok(output) = std::process::Command::new("scutil")
                .args(["--get", "ComputerName"])
                .output()
            {
                let name = String::from_utf8_lossy(&output.stdout).trim().to_owned();
                if output.status.success() && !name.is_empty() {
                    return name;
                }
            }
        }
        ["COMPUTERNAME", "HOSTNAME"]
            .iter()
            .find_map(|name| std::env::var(name).ok())
            .map(|name| name.trim().to_owned())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| "This computer".into())
    })
    .clone()
}

/// "Documents › Biology": the folder and the one it sits in.
fn friendly_path(path: &std::path::Path) -> String {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let parent = path
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|parent| parent.to_str());
    match (parent, name) {
        (_, "") => path.display().to_string(),
        (Some(parent), name) => format!("{parent} \u{203a} {name}"),
        (None, name) => name.to_owned(),
    }
}

/// The files Office holds open right now in the selected folders.
fn office_files(grants: &GrantRegistry, journal: &Journal) -> Vec<LocalOfficeFile> {
    let grants = grants.device_grants();
    let mut files = Vec::new();
    for (key, _) in journal.config_prefix("lock_held:").unwrap_or_default() {
        let held = key.trim_start_matches("lock_held:");
        let Some(grant) = grants
            .iter()
            .find(|grant| held.starts_with(&format!("{}:", grant.id)))
        else {
            continue;
        };
        let Ok(Some(resource)) = journal.resource_by_id(&held[grant.id.len() + 1..]) else {
            continue;
        };
        let name = resource
            .path_key
            .rsplit('/')
            .next()
            .unwrap_or(&resource.path_key)
            .to_owned();
        files.push(LocalOfficeFile {
            folder: grant.label.clone(),
            name,
        });
    }
    files.sort_by(|left, right| (&left.folder, &left.name).cmp(&(&right.folder, &right.name)));
    files.dedup();
    files
}

fn control_snapshot(grants: &GrantRegistry, journal: &Journal) -> LocalControlSnapshot {
    LocalControlSnapshot {
        device_name: this_device_name(),
        paused: sync_paused(journal),
        last_sync_at: read_ms(journal, LAST_SYNC_KEY),
        mounts: mount_views(grants, journal),
        office_files: office_files(grants, journal),
    }
}

/// What the journal keeps for one folder, forgotten when the folder goes.
fn forget_mount_config(journal: &Journal, grant_id: &str) -> Result<(), String> {
    for prefix in [
        "mount:",
        "mount_status:",
        "mount_double_sync:",
        "cloud_mount:",
        "mount_paused:",
        "mount_synced_at:",
    ] {
        journal
            .delete_config(&format!("{prefix}{grant_id}"))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Unpairing forgets this computer's key, its folders and the browser
/// session, and stops syncing. The files in the folders stay where they are.
fn unpair_this_computer(grants: &GrantRegistry, journal: &Journal) -> Result<(), String> {
    if let Some(device_id) = journal
        .config("device_id")
        .map_err(|error| error.to_string())?
    {
        HostPlatform
            .delete_credential(&device_id)
            .map_err(|error| format!("Couldn't forget this computer's key: {error}"))?;
    }
    for grant in grants.device_grants() {
        grants.remove(&grant.id);
        forget_mount_config(journal, &grant.id)?;
    }
    for key in [
        "device_id",
        "browser_origin",
        "browser_session_token",
        SYNC_PAUSED_KEY,
        LAST_SYNC_KEY,
    ] {
        journal
            .delete_config(key)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/* ---------------------------------------------------------------- health */

const HEALTH_REPORT_INTERVAL: std::time::Duration = std::time::Duration::from_secs(60);

/// What this computer tells Spectra about itself, so the Devices page on any
/// other device can show it. The problem is a stable code; Spectra words it.
fn health_report(grants: &GrantRegistry, journal: &Journal, paused: bool) -> DeviceHealthReport {
    let mounts = mount_views(grants, journal);
    let problem = mounts
        .iter()
        .filter(|mount| !mount.paused)
        .find_map(|mount| match mount.state.as_str() {
            "unavailable" => Some(("folder-unavailable", mount)),
            "error" => Some(("folder-error", mount)),
            _ => None,
        });
    DeviceHealthReport {
        paused,
        folders: mounts.len(),
        problem: problem.map(|(code, _)| code.to_owned()),
        // Only the folder's own name leaves the computer, as it already does
        // when the folder is registered; its parents stay local.
        problem_folder: problem.map(|(_, mount)| mount.label.clone()),
        last_sync_at: read_ms(journal, LAST_SYNC_KEY),
    }
}

/// Sends a report when the state changes, and once a minute otherwise so the
/// page knows when this computer was last seen.
#[derive(Default)]
struct HealthReporter {
    last: Option<(DeviceHealthReport, std::time::Instant)>,
}

impl HealthReporter {
    fn due(&self, report: &DeviceHealthReport) -> bool {
        match &self.last {
            None => true,
            Some((last, sent_at)) => {
                (
                    last.paused,
                    last.folders,
                    &last.problem,
                    &last.problem_folder,
                ) != (
                    report.paused,
                    report.folders,
                    &report.problem,
                    &report.problem_folder,
                ) || sent_at.elapsed() >= HEALTH_REPORT_INTERVAL
            }
        }
    }

    fn sent(&mut self, report: DeviceHealthReport) {
        self.last = Some((report, std::time::Instant::now()));
    }
}

/* ---------------------------------------------------------------- tray */

const TRAY_ID: &str = "spectra-bridge";
const TRAY_REFRESH: std::time::Duration = std::time::Duration::from_secs(5);
/// The tray waits a few missed polls before it calls the cloud unreachable.
const TRAY_CLOUD_GRACE_MS: u64 = 45_000;

/// The state dot on the tray prism (docs/product/DEVICES.md).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrayDot {
    None,
    Grey,
    Orange,
    Red,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TrayView {
    dot: TrayDot,
    tooltip: String,
}

fn folder_count(count: usize) -> String {
    match count {
        0 => "No folders yet".into(),
        1 => "1 folder".into(),
        count => format!("{count} folders"),
    }
}

/// Tray tooltips are short (Windows keeps 127 characters).
fn short_label(label: &str) -> String {
    if label.chars().count() > 32 {
        format!("{}\u{2026}", label.chars().take(31).collect::<String>())
    } else {
        label.to_owned()
    }
}

/// What the tray says, in plain words, and which dot it shows: none when
/// connected, grey when disconnected or paused, orange when it needs the
/// person, red for a problem.
fn tray_view(paired: bool, connected: bool, paused: bool, mounts: &[LocalMountStatus]) -> TrayView {
    if !paired {
        return TrayView {
            dot: TrayDot::Orange,
            tooltip: "Spectra Bridge \u{b7} Not connected yet".into(),
        };
    }
    if paused {
        return TrayView {
            dot: TrayDot::Grey,
            tooltip: format!(
                "Spectra Bridge \u{b7} Paused \u{b7} {}",
                folder_count(mounts.len())
            ),
        };
    }
    let problems = mounts
        .iter()
        .filter(|mount| !mount.paused && matches!(mount.state.as_str(), "error" | "unavailable"))
        .collect::<Vec<_>>();
    match problems.as_slice() {
        [] => {}
        [only] => {
            return TrayView {
                dot: TrayDot::Red,
                tooltip: format!(
                    "Spectra Bridge \u{b7} Problem with {}",
                    short_label(&only.label)
                ),
            };
        }
        many => {
            return TrayView {
                dot: TrayDot::Red,
                tooltip: format!("Spectra Bridge \u{b7} Problem with {} folders", many.len()),
            };
        }
    }
    if !connected {
        return TrayView {
            dot: TrayDot::Grey,
            tooltip: "Spectra Bridge \u{b7} Disconnected".into(),
        };
    }
    TrayView {
        dot: TrayDot::None,
        tooltip: format!(
            "Spectra Bridge \u{b7} Connected \u{b7} {}",
            folder_count(mounts.len())
        ),
    }
}

/// The icon pixels for the display scale: 16 px at 100 percent.
fn tray_icon_size(scale_factor: f64) -> u32 {
    (16.0 * scale_factor.clamp(1.0, 2.0)).round() as u32
}

macro_rules! tray_png {
    ($theme:literal, $dot:literal, $size:literal) => {
        include_bytes!(concat!(
            "../icons/tray/",
            $theme,
            "-",
            $dot,
            "-",
            $size,
            ".png"
        )) as &[u8]
    };
}

macro_rules! tray_png_by_size {
    ($theme:literal, $dot:literal, $size:expr) => {
        match $size {
            0..=17 => tray_png!($theme, $dot, 16),
            18..=21 => tray_png!($theme, $dot, 20),
            22..=27 => tray_png!($theme, $dot, 24),
            _ => tray_png!($theme, $dot, 32),
        }
    };
}

macro_rules! tray_png_by_dot {
    ($theme:literal, $dot:expr, $size:expr) => {
        match $dot {
            TrayDot::None => tray_png_by_size!($theme, "none", $size),
            TrayDot::Grey => tray_png_by_size!($theme, "grey", $size),
            TrayDot::Orange => tray_png_by_size!($theme, "orange", $size),
            TrayDot::Red => tray_png_by_size!($theme, "red", $size),
        }
    };
}

/// The prism tray icons, generated from the app's prism renderer by
/// scripts/generate-bridge-tray-icons.ts (npm run icons:bridge).
fn tray_icon_png(light_taskbar: bool, dot: TrayDot, size: u32) -> &'static [u8] {
    if light_taskbar {
        tray_png_by_dot!("light", dot, size)
    } else {
        tray_png_by_dot!("dark", dot, size)
    }
}

#[cfg(windows)]
fn taskbar_is_light() -> bool {
    use winreg::RegKey;
    use winreg::enums::HKEY_CURRENT_USER;
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize")
        .and_then(|key| key.get_value::<u32, _>("SystemUsesLightTheme"))
        .map(|value| value == 1)
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn taskbar_is_light() -> bool {
    static CACHE: Mutex<Option<(std::time::Instant, bool)>> = Mutex::new(None);
    let mut cache = CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some((checked_at, light)) = *cache
        && checked_at.elapsed() < std::time::Duration::from_secs(60)
    {
        return light;
    }
    let light = std::process::Command::new("defaults")
        .args(["read", "-g", "AppleInterfaceStyle"])
        .output()
        .map(|output| !String::from_utf8_lossy(&output.stdout).contains("Dark"))
        .unwrap_or(false);
    *cache = Some((std::time::Instant::now(), light));
    light
}

#[cfg(all(unix, not(target_os = "macos")))]
fn taskbar_is_light() -> bool {
    false
}

struct TrayHandles {
    pause: MenuItem<tauri::Wry>,
    shown: Mutex<Option<(TrayView, bool, u32, bool)>>,
}

/// Brings the tray icon, tooltip and Pause/Resume item up to date.
fn refresh_tray(app: &tauri::AppHandle) {
    let (Some(handles), Some(runtime), Some(state)) = (
        app.try_state::<TrayHandles>(),
        app.try_state::<BridgeRuntime>(),
        app.try_state::<Arc<ServerState>>(),
    ) else {
        return;
    };
    let paused = sync_paused(&runtime.journal);
    let view = tray_view(
        state.is_paired(),
        state.cloud_seen_within(TRAY_CLOUD_GRACE_MS),
        paused,
        &mount_views(&runtime.grants, &runtime.journal),
    );
    let light = taskbar_is_light();
    let scale = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor.scale_factor())
        .unwrap_or(1.0);
    let next = (view, light, tray_icon_size(scale), paused);
    let mut shown = handles
        .shown
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if shown.as_ref() == Some(&next) {
        return;
    }
    let (view, light, size, paused) = &next;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Ok(icon) = tauri::image::Image::from_bytes(tray_icon_png(*light, view.dot, *size)) {
            let _ = tray.set_icon(Some(icon));
        }
        let _ = tray.set_tooltip(Some(&view.tooltip));
    }
    let _ = handles.pause.set_text(if *paused {
        "Resume syncing"
    } else {
        "Pause syncing"
    });
    *shown = Some(next);
}

/// The Devices page on the Spectra this computer is paired with.
fn devices_page_url(origin: &str) -> Option<String> {
    let origin = origin.trim().trim_end_matches('/');
    let scheme_ok = origin.starts_with("https://") || origin.starts_with("http://");
    let plain = !origin.is_empty()
        && origin.chars().all(|character| {
            character.is_ascii_graphic() && !matches!(character, '"' | '\'' | '\x60')
        });
    (scheme_ok && plain).then(|| format!("{origin}/devices"))
}

fn open_devices_page(app: &tauri::AppHandle) {
    let origin = app
        .try_state::<BridgeRuntime>()
        .and_then(|runtime| runtime.journal.config("browser_origin").ok().flatten())
        .or_else(|| {
            app.try_state::<Arc<ServerState>>()
                .and_then(|state| state.primary_origin())
        });
    let Some(url) = origin.as_deref().and_then(devices_page_url) else {
        return;
    };
    if let Err(error) = open_with_system(std::ffi::OsStr::new(&url))
        && let Some(runtime) = app.try_state::<BridgeRuntime>()
    {
        record_runtime_error(&runtime.journal, "Could not open Spectra", &error);
    }
}

/* ---------------------------------------------------------------- pairing */

const PAIRING_DECLINED: &str = "Pairing was cancelled on this computer.";

/// "123 456": the code as the Devices page shows it.
fn spaced_code(code: &str) -> String {
    if code.len() == 6 && code.is_ascii() {
        format!("{} {}", &code[..3], &code[3..])
    } else {
        code.to_owned()
    }
}

fn pairing_confirmation_text(code: &str) -> String {
    format!(
        "Spectra wants to connect this computer to your account.\n\nThe Devices page in Spectra shows the code {}. Connect only if it matches.",
        spaced_code(code)
    )
}

/// The one native prompt pairing needs: the person confirms, on this
/// computer, the code the Devices page shows.
async fn confirm_pairing_on_this_computer(
    app: &tauri::AppHandle,
    code: &str,
) -> Result<(), String> {
    let (answer_tx, answer_rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(pairing_confirmation_text(code))
        .title("Connect to Spectra")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Connect".into(),
            "Cancel".into(),
        ))
        .show(move |confirmed| {
            let _ = answer_tx.send(confirmed);
        });
    match answer_rx.await {
        Ok(true) => Ok(()),
        _ => Err(PAIRING_DECLINED.into()),
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

fn mount_views(grants: &GrantRegistry, journal: &Journal) -> Vec<LocalMountStatus> {
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
            LocalMountStatus {
                friendly_path: friendly_path(grant.device_root()),
                paused: flag(journal, &mount_paused_key(&grant.id)),
                last_sync_at: read_ms(journal, &mount_synced_at_key(&grant.id)),
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

/// Names a file that is behind without taking the folder out of service: the
/// folder stays active and keeps its last known counts.
fn set_mount_file_note(journal: &Journal, grant_id: &str, detail: &str) -> Result<(), String> {
    let previous = journal
        .config(&format!("mount_status:{grant_id}"))
        .ok()
        .flatten()
        .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok());
    let count = |key: &str| {
        previous
            .as_ref()
            .and_then(|value| value.get(key))
            .and_then(serde_json::Value::as_u64)
            .unwrap_or_default() as usize
    };
    set_mount_status(
        journal,
        grant_id,
        "active",
        detail,
        count("synced"),
        count("total"),
    )
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
        .is_some_and(|retry| {
            let now = current_time_ms();
            // A due time beyond any repair delay was scheduled before the wall
            // clock was set back; do not wait out the size of the jump.
            retry.retry_at_ms <= now
                || retry.retry_at_ms
                    > now.saturating_add(
                        spectra_bridge_core::retry::retry_schedule_horizon().as_millis() as u64,
                    )
        })
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
    let delay_ms = record_mount_repair_retry(journal, grant_id)?;
    let base_detail = detail.chars().take(500).collect::<String>();
    let status_detail = format!(
        "{base_detail} Automatic repair is scheduled in {}.",
        display_retry_delay(delay_ms),
    );
    set_mount_status(journal, grant_id, "waiting", &status_detail, synced, total)?;
    Ok(delay_ms)
}

/// Schedules the next full repair pass without touching the folder's status,
/// for a pass that synced the folder but left individual files behind.
fn record_mount_repair_retry(journal: &Journal, grant_id: &str) -> Result<u64, String> {
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

const UNKNOWN_DEPLOYMENT: &str = "This Bridge does not know which Spectra to sync with yet. Pair it again from Devices in Spectra.";

fn configured_deployment_url(value: Option<String>) -> Result<String, String> {
    let url = value
        .map(|value| value.trim().trim_end_matches('/').to_owned())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| UNKNOWN_DEPLOYMENT.to_string())?;
    let parsed = reqwest::Url::parse(&url).map_err(|_| {
        "Spectra's sync address must be a complete http:// or https:// URL.".to_string()
    })?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(
            "Spectra's sync address must be a complete http:// or https:// URL.".to_string(),
        );
    }
    Ok(url)
}

/// Where this Bridge syncs. A launch override (`SPECTRA_CONVEX_URL`, set by
/// the local stack or baked into a release) wins; otherwise the deployment
/// learned from the Spectra page this computer paired with.
fn resolve_deployment_url(
    launch: Option<String>,
    stored: Option<String>,
) -> Result<String, String> {
    match launch.filter(|value| !value.trim().is_empty()) {
        Some(value) => configured_deployment_url(Some(value)),
        None => configured_deployment_url(stored),
    }
}

fn deployment_url(journal: &Journal) -> Result<String, String> {
    let stored = journal
        .config("deployment_url")
        .map_err(|error| error.to_string())?;
    let url = resolve_deployment_url(std::env::var("SPECTRA_CONVEX_URL").ok(), stored.clone())?;
    if stored.as_deref() != Some(url.as_str()) {
        journal
            .set_config("deployment_url", &url)
            .map_err(|error| error.to_string())?;
    }
    Ok(url)
}

/// Pairing teaches the Bridge its deployment: the offer comes from a
/// configured Spectra origin, so its Convex URL is the one to sync with.
fn deployment_for_offer(journal: &Journal, offer: &PairingOffer) -> Result<String, String> {
    if std::env::var_os("SPECTRA_CONVEX_URL").is_none() {
        if let Some(offered) = offer.deployment_url.clone() {
            let url = configured_deployment_url(Some(offered))?;
            journal
                .set_config("deployment_url", &url)
                .map_err(|error| error.to_string())?;
        }
    }
    deployment_url(journal)
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

fn adoption_candidate(resource: &ResourceRecord) -> AdoptionCandidate {
    AdoptionCandidate {
        local_resource_id: resource.local_resource_id.clone(),
        path_key: resource.path_key.clone(),
        content_hash: resource.content_hash.clone().unwrap_or_default(),
        os_identity: record_identity(resource),
        available: resource.available,
        last_seen_generation: resource.last_seen_generation,
    }
}

fn record_identity(resource: &ResourceRecord) -> Option<OsFileIdentity> {
    match (resource.volume, resource.file_index) {
        (Some(volume), Some(file_index)) => Some(OsFileIdentity { volume, file_index }),
        _ => None,
    }
}

fn adoption_candidates(
    journal: &Journal,
    grant_id: &str,
) -> anyhow::Result<Vec<AdoptionCandidate>> {
    Ok(journal
        .resources_for_grant(grant_id)?
        .iter()
        .map(adoption_candidate)
        .collect())
}

/// Keeps a scan's in-memory candidates in step with the journal, so each
/// file adopts against every earlier file of the same scan without the scan
/// reloading the whole mount per file.
fn remember_candidate(candidates: &mut Vec<AdoptionCandidate>, resource: &ResourceRecord) {
    let candidate = adoption_candidate(resource);
    match candidates
        .iter_mut()
        .find(|existing| existing.local_resource_id == candidate.local_resource_id)
    {
        Some(existing) => *existing = candidate,
        None => candidates.push(candidate),
    }
}

fn adopt_resource_record(
    grant: &Grant,
    journal: &Journal,
    candidates: &[AdoptionCandidate],
    path: &std::path::Path,
    hash: &str,
    os_identity: &OsFileIdentity,
    generation: u64,
) -> anyhow::Result<(ResourceRecord, Option<ResourceRecord>)> {
    let relative_path = relative_key(grant.device_root(), path);
    anyhow::ensure!(!relative_path.is_empty(), "changed path is the mount root");
    let adopted_id = adopt(
        candidates,
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
    let candidates = adoption_candidates(journal, &grant.id)?;
    let (resource, previous) = adopt_resource_record(
        grant,
        journal,
        &candidates,
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
    if let Some(stat) = snapshot.verified_stat() {
        let _ = journal.record_verified_stat(&resource.local_resource_id, &stat);
    }
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
        // Lock transitions can repeat without changing the native revision.
        // A completed report belongs to the previous Office session; both
        // its next lock and its next unlock need a fresh durable operation.
        if operation.state == OpState::Verified {
            key = derived_change_key(
                &grant.id,
                &resource.local_resource_id,
                None,
                &resource.path_key,
                before,
                None,
                &format!("{op}:{}", uuid::Uuid::new_v4().simple()),
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
    if delivery
        .envelope
        .change
        .size
        .is_some_and(|size| size > MAX_NATIVE_PAYLOAD_BYTES)
    {
        // Retrying cannot shrink the file; it would re-read it forever.
        return journal.fail_queue(&delivery.item, "payload-too-large", OVERSIZED_FILE_DETAIL);
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
        // The cloud said no to these exact bytes; asking again gets the same
        // answer. The file stays on disk and its next change is a new upload.
        Err(error) if error.downcast_ref::<CloudRefused>().is_some() => journal.fail_queue(
            &delivery.item,
            "upload-refused",
            "Spectra did not accept this version of the file, so it is no longer being sent. Saving the file again sends the new version.",
        ),
        Err(_) => journal.retry_queue(
            delivery.item.id,
            Backoff::delay_for_attempt(delivery.item.attempts, &delivery.item.op_id),
        ),
    }
}

/// What one full pass found on disk before asking the cloud about it.
#[derive(Debug, Default)]
struct LocalScan {
    files: Vec<DiscoveredResource>,
    /// Files Office holds open or a writer is still changing.
    held: Vec<String>,
    /// Files (or folders) that could not be read or recorded.
    failed: Vec<String>,
    /// False when a file went unseen: reconciling missing files would then
    /// mistake it for deleted.
    complete: bool,
    double_sync_risk: bool,
    online_only: usize,
    /// Files whose bytes this pass read and hashed.
    hashed: usize,
}

/// The recorded hash of a file that has not moved since it was hashed: same
/// path, same OS identity, same size and modification time.
fn unchanged_hash(journal: &Journal, record: &ResourceRecord, entry: &ScanEntry) -> Option<String> {
    let identity = record_identity(record)?;
    if local_resource_id(&identity) != entry.local_resource_id {
        return None;
    }
    let stat = journal
        .verified_stat(&record.local_resource_id)
        .ok()
        .flatten()?;
    reusable_hash(
        &stat,
        record.content_hash.as_deref(),
        entry.size,
        entry.modified_ns,
    )
}

/// Reads the folder for a full repair pass. A file whose size, modification
/// time and identity still match the stat its hash was taken under keeps that
/// hash without being read again; every other file is read and hashed.
/// Online-only files are never opened (`scan_mount` skips them).
fn scan_local_files(
    grant: &Grant,
    journal: &Journal,
    generation: u64,
) -> Result<LocalScan, String> {
    let scan = scan_mount(&HostPlatform, grant.device_root()).map_err(|error| error.to_string())?;
    let mut local = LocalScan {
        complete: scan.failures.is_empty(),
        online_only: scan.online_only,
        failed: scan
            .failures
            .into_iter()
            .map(|failure| failure.relative_path)
            .collect(),
        ..LocalScan::default()
    };
    let records = journal
        .resources_for_grant(&grant.id)
        .map_err(|error| error.to_string())?;
    let mut candidates = records.iter().map(adoption_candidate).collect::<Vec<_>>();
    let by_path = records
        .into_iter()
        .filter(|record| record.available)
        .map(|record| (record.path_key.clone(), record))
        .collect::<HashMap<_, _>>();
    for entry in scan.entries {
        if entry.is_directory {
            continue;
        }
        local.double_sync_risk |= entry.double_sync_risk;
        let native_format = native_format(std::path::Path::new(&entry.relative_path));
        let entry_path = grant.device_root().join(&entry.relative_path);
        if file_held_by_office(&entry_path) {
            local.held.push(entry.relative_path);
            local.complete = false;
            let _ = enqueue_locked_path(grant, journal, &entry_path);
            continue;
        }
        let path_key = relative_key(grant.device_root(), &entry_path);
        let reused = by_path.get(&path_key).and_then(|record| {
            unchanged_hash(journal, record, &entry).map(|hash| (record.clone(), hash))
        });
        let (record, size, content_hash, stat) = match reused {
            Some((mut record, hash)) => {
                record.last_seen_generation = generation;
                (record, entry.size, hash, None)
            }
            None => {
                let snapshot = match stable_file_snapshot(&entry_path) {
                    Ok(Some(snapshot)) => snapshot,
                    Ok(None) => {
                        local.held.push(entry.relative_path);
                        local.complete = false;
                        continue;
                    }
                    Err(_) => {
                        local.failed.push(entry.relative_path);
                        local.complete = false;
                        continue;
                    }
                };
                local.hashed += 1;
                let record = match adopt_resource_record(
                    grant,
                    journal,
                    &candidates,
                    &entry_path,
                    &snapshot.fingerprint,
                    &snapshot.os_identity,
                    generation,
                ) {
                    Ok((record, _)) => record,
                    Err(_) => {
                        local.failed.push(entry.relative_path);
                        local.complete = false;
                        continue;
                    }
                };
                let stat = snapshot.verified_stat();
                (record, snapshot.size, snapshot.fingerprint.clone(), stat)
            }
        };
        if journal.upsert_resource(&record).is_err() {
            local.failed.push(entry.relative_path);
            local.complete = false;
            continue;
        }
        if let Some(stat) = stat {
            let _ = journal.record_verified_stat(&record.local_resource_id, &stat);
        }
        remember_candidate(&mut candidates, &record);
        local.files.push(DiscoveredResource {
            local_resource_id: record.local_resource_id,
            relative_path: entry.relative_path,
            size,
            content_hash: Some(content_hash),
            native_format,
        });
    }
    Ok(local)
}

/// How a pass treats a file the cloud declined to register.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DiscoverySkip {
    /// The folder's rules or the user's choice; nothing to retry.
    Policy,
    /// Office holds the file on some device; retry once it is closed.
    Held,
    /// The file cannot be registered as it is; a rename or move may fix it.
    Unsyncable,
    /// Anything else is retried with the next repair pass.
    Retry,
}

fn classify_discovery_skip(reason: Option<&str>) -> DiscoverySkip {
    match reason {
        Some(
            "approval-required"
            | "filtered"
            | "explicit-only"
            | "ignored-by-user"
            | "artifact-access-revoked",
        ) => DiscoverySkip::Policy,
        Some("office-lock") => DiscoverySkip::Held,
        Some("resource-metadata-invalid") => DiscoverySkip::Unsyncable,
        _ => DiscoverySkip::Retry,
    }
}

/// A failed payload upload goes to the outbound queue, which retries that one
/// file with its own backoff while the rest of the folder carries on. Returns
/// false when the file could not be queued and needs a repair pass instead.
fn hand_off_failed_upload(
    grant: &Grant,
    journal: &Journal,
    resource: &DiscoveredResource,
    generation: u64,
) -> bool {
    let Some(hash) = resource.content_hash.as_deref() else {
        return false;
    };
    let path = grant.device_root().join(&resource.relative_path);
    matches!(
        enqueue_stable_change(grant, journal, &path, hash, generation),
        Ok(true)
    )
}

/// Per-file results of one full pass. Files are named so the folder status
/// can say which one is behind instead of calling the whole folder stuck.
#[derive(Debug, Default)]
struct MountPass {
    scanned: usize,
    /// Files the scan never handed to the cloud (held or unreadable).
    unscanned: usize,
    /// Scanned files the cloud did not take in this pass.
    unsynced: usize,
    held: Vec<String>,
    failed: Vec<String>,
    retrying: Vec<String>,
    unsyncable: Vec<String>,
    oversized: usize,
    online_only: usize,
    complete: bool,
}

impl MountPass {
    fn needs_repair(&self) -> bool {
        !self.held.is_empty() || !self.failed.is_empty() || !self.complete
    }
}

fn file_word(count: usize) -> &'static str {
    if count == 1 { "file" } else { "files" }
}

fn name_files(paths: &[String]) -> String {
    let first = paths.first().map(String::as_str).unwrap_or_default();
    match paths.len() {
        0 | 1 => format!("\u{201c}{first}\u{201d}"),
        count => format!(
            "\u{201c}{first}\u{201d} and {} more {}",
            count - 1,
            file_word(count - 1)
        ),
    }
}

/// The folder's status after a pass that reached the cloud. The folder stays
/// active: files that did sync are usable, and each one that did not is named.
fn mount_pass_status(pass: &MountPass, repair_delay_ms: Option<u64>) -> (String, usize, usize) {
    let mut detail = "Available in Spectra".to_owned();
    if pass.oversized > 0 {
        detail = format!(
            "{detail}, except {} {} over 100 MB. {OVERSIZED_FILE_DETAIL}",
            pass.oversized,
            file_word(pass.oversized),
        );
    }
    let mut notes = Vec::new();
    let one = |paths: &[String]| paths.len() == 1;
    if !pass.held.is_empty() {
        notes.push(format!(
            "{} {} open or still being saved and will sync once {} closed.",
            name_files(&pass.held),
            if one(&pass.held) { "is" } else { "are" },
            if one(&pass.held) { "it is" } else { "they are" },
        ));
    }
    if !pass.failed.is_empty() {
        notes.push(format!(
            "{} could not be synced yet.",
            name_files(&pass.failed)
        ));
    }
    if !pass.retrying.is_empty() {
        notes.push(format!(
            "Spectra is retrying the upload of {}.",
            name_files(&pass.retrying)
        ));
    }
    if !pass.unsyncable.is_empty() {
        notes.push(format!(
            "{} could not be added to Spectra; renaming or moving {} may help.",
            name_files(&pass.unsyncable),
            if one(&pass.unsyncable) { "it" } else { "them" },
        ));
    }
    if let Some(delay_ms) = repair_delay_ms {
        notes.push(format!(
            "Spectra will check again in {}.",
            display_retry_delay(delay_ms)
        ));
    }
    if pass.online_only > 0 {
        notes.push(format!(
            "{} online-only {} will sync once {} on this device.",
            pass.online_only,
            file_word(pass.online_only),
            if pass.online_only == 1 {
                "it is"
            } else {
                "they are"
            },
        ));
    }
    if !notes.is_empty() {
        if !detail.ends_with('.') {
            detail.push('.');
        }
        for note in notes {
            detail.push(' ');
            detail.push_str(&note);
        }
    }
    let synced = pass
        .scanned
        .saturating_sub(pass.oversized)
        .saturating_sub(pass.unsynced);
    (detail, synced, pass.scanned + pass.unscanned)
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
    let owner_lock_paths = office_lock_paths(grant.device_root(), 500);
    let scan_id = uuid::Uuid::new_v4().to_string();
    let LocalScan {
        files,
        held,
        failed,
        complete,
        double_sync_risk,
        online_only,
        ..
    } = scan_local_files(grant, journal, generation)?;
    let mut pass = MountPass {
        scanned: files.len(),
        unscanned: held.len() + failed.len(),
        held,
        failed,
        online_only,
        complete,
        ..MountPass::default()
    };
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
            let name = || resource.relative_path.clone();
            if registration.skipped {
                match classify_discovery_skip(registration.reason.as_deref()) {
                    DiscoverySkip::Policy => {}
                    DiscoverySkip::Held => {
                        pass.unsynced += 1;
                        pass.held.push(name());
                    }
                    DiscoverySkip::Unsyncable => {
                        pass.unsynced += 1;
                        pass.unsyncable.push(name());
                    }
                    DiscoverySkip::Retry => {
                        pass.unsynced += 1;
                        pass.failed.push(name());
                    }
                }
            } else if registration.needs_payload
                && carries_native_payload(&resource.native_format)
                && resource.size > MAX_NATIVE_PAYLOAD_BYTES
            {
                // A repair retry cannot shrink the file; say so once instead
                // of re-reading it on every repair scan.
                pass.oversized += 1;
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
                // One file's upload must not hold the folder back: it retries
                // on its own schedule, and only a file that cannot be queued
                // waits for the next repair pass.
                pass.unsynced += 1;
                if hand_off_failed_upload(grant, journal, resource, generation) {
                    pass.retrying.push(name());
                } else {
                    pass.failed.push(name());
                }
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
    if pass.complete {
        reconcile_missing_resources(&deployment, &credential, &mount_id, &scan_id)
            .await
            .map_err(|error| error.to_string())?;
    }
    let repair_delay_ms = if pass.needs_repair() {
        Some(record_mount_repair_retry(journal, &grant.id)?)
    } else {
        clear_mount_repair_retry(journal, &grant.id)?;
        None
    };
    let (detail, synced, total) = mount_pass_status(&pass, repair_delay_ms);
    set_mount_status(journal, &grant.id, "active", &detail, synced, total)?;
    let _ = journal.set_config(
        &mount_synced_at_key(&grant.id),
        &current_time_ms().to_string(),
    );
    Ok(())
}

const OVERSIZED_FILE_DETAIL: &str = "Files over 100 MB stay on this computer only; compress their pictures and videos to sync them.";

/// Downloads a queued native package. The headers must arrive within the
/// ordinary request budget; the body then gets a budget sized to the package,
/// so a large deck on a slow school network finishes instead of timing out
/// and being re-downloaded forever.
async fn download_write_payload(url: &str) -> Result<Vec<u8>, (&'static str, String)> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|error| ("request", error.to_string()))?;
    let response = tokio::time::timeout(
        spectra_bridge_core::retry::bridge_payload_timeout(),
        client.get(url).send(),
    )
    .await
    .map_err(|_| {
        (
            "timeout",
            "payload download did not start in time".to_owned(),
        )
    })?
    .and_then(reqwest::Response::error_for_status)
    .map_err(|error| ("request", error.to_string()))?;
    let budget = spectra_bridge_core::retry::bridge_payload_transfer_timeout(
        response
            .content_length()
            .unwrap_or(MAX_NATIVE_PAYLOAD_BYTES),
    );
    let bytes = tokio::time::timeout(budget, response.bytes())
        .await
        .map_err(|_| ("timeout", "payload download stalled".to_owned()))?
        .map_err(|error| ("body-read", error.to_string()))?;
    Ok(bytes.to_vec())
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
    let payload = match download_write_payload(&request.payload_url).await {
        Ok(bytes) => {
            record_write_progress(journal, "payload-downloaded", Some(&request), None);
            bytes
        }
        Err((phase, message)) => {
            record_write_progress(
                journal,
                "payload-download-failed",
                Some(&request),
                Some(phase),
            );
            complete_claimed_write(
                deployment,
                credential,
                journal,
                &request,
                "waiting",
                None,
                Some(("payload-download-failed", &message)),
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
    paused_grants: &HashSet<String>,
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
        if paused_grants.contains(&request.grant_id) {
            // A paused folder sends nothing. Spectra asks for this file again
            // on a later pass, after the folder resumes; other folders go on.
            continue;
        }
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
    if !carries_native_payload(&request.native_format) || snapshot.size > MAX_NATIVE_PAYLOAD_BYTES {
        return Ok(false);
    }
    let bytes = snapshot.read_bytes()?;
    let hash = hex::encode(sha2::Sha256::digest(&bytes));
    drop(snapshot);
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
    paused_grants: &HashSet<String>,
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
        if paused_grants.contains(&request.grant_id) {
            // A paused folder takes no writes; Spectra offers this one again later.
            complete_claimed_write(
                deployment,
                credential,
                journal,
                &request,
                "waiting",
                None,
                Some(("folder-paused", "This folder is paused on this computer.")),
            )
            .await?;
            continue;
        }
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
    paused_grants: &HashSet<String>,
) -> anyhow::Result<usize> {
    let mut handled = 0;
    for _ in 0..20 {
        let Some(request) = claim_fs_request(deployment, credential).await? else {
            break;
        };
        if paused_grants.contains(&request.grant_id) {
            // A paused folder is not reorganized; Spectra offers this change
            // again later, as it does a paused folder's writes.
            complete_claimed_structure(
                deployment,
                credential,
                journal,
                &request,
                "waiting",
                None,
                Some(("folder-paused", "This folder is paused on this computer.")),
            )
            .await?;
            continue;
        }
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
            if let Some(failure) = batch.failures.first() {
                let _ = set_mount_file_note(
                    &journal,
                    &grant.id,
                    &format!(
                        "{} could not be read yet; other files continue syncing.",
                        name_files(std::slice::from_ref(&failure.relative_path)),
                    ),
                );
            }

            let mut generation = None;
            let mut failed_paths: Vec<std::path::PathBuf> = Vec::new();
            for path in pending_files.clone() {
                if !path.exists() {
                    pending_files.remove(&path);
                    pending_missing.entry(path).or_insert(observed_at);
                    continue;
                }
                if is_online_only(&path) {
                    // Hashing a cloud placeholder downloads it again right
                    // after the student chose 'Free up space'. It syncs once
                    // the provider brings its bytes back to this device.
                    pending_files.remove(&path);
                    continue;
                }
                if file_held_by_office(&path) {
                    if enqueue_locked_path(&grant, &journal, &path)
                        .map(|queued| queued > 0)
                        .unwrap_or(false)
                    {
                        local_work_queued = true;
                        let _ = set_mount_file_note(
                            &journal,
                            &grant.id,
                            &format!(
                                "{} is open in Office. Spectra will sync it after Office finishes saving.",
                                name_files(&[relative_key(grant.device_root(), &path)]),
                            ),
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
                                    failed_paths.push(path.clone());
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
                            Err(_) => failed_paths.push(path.clone()),
                        }
                    }
                    Ok(None) => {}
                    Err(_) => failed_paths.push(path.clone()),
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
                            failed_paths.push(path.clone());
                            continue;
                        }
                    },
                };
                match enqueue_missing_path(&grant, &journal, &path, current_generation) {
                    Ok(queued) => {
                        local_work_queued |= queued > 0;
                        pending_missing.remove(&path);
                    }
                    Err(_) => failed_paths.push(path.clone()),
                }
            }
            if !failed_paths.is_empty() {
                // The file stays pending and is retried on the next tick; the
                // folder itself is not stuck, so it stays active.
                let names = failed_paths
                    .iter()
                    .map(|path| relative_key(grant.device_root(), path))
                    .collect::<Vec<_>>();
                let _ = set_mount_file_note(
                    &journal,
                    &grant.id,
                    &format!(
                        "{} could not be synced yet; Spectra keeps retrying and other files continue.",
                        name_files(&names),
                    ),
                );
            } else if generation.is_some() {
                let _ = set_mount_file_note(&journal, &grant.id, "Changes queued safely");
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
    // A scan registers files with Spectra and uploads their bytes, so a
    // paused folder is not scanned: its watcher keeps changes in the journal.
    if folder_paused(journal, &grant.id) {
        return Ok(MountSyncOutcome::Paused);
    }
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

/// Pairs this computer for an offer from the Devices page. A computer already
/// paired to the account resumes quietly; a new pairing (or one whose key
/// Spectra no longer knows) first asks the person, in a native dialog showing
/// the same code as the page.
async fn complete_pairing_offer(
    app: &tauri::AppHandle,
    offer: &PairingOffer,
    state: &Arc<ServerState>,
    journal: &Arc<Journal>,
) -> Result<(), String> {
    let deployment = deployment_for_offer(journal, offer)?;
    let device_name = this_device_name();
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
                confirm_pairing_on_this_computer(app, &offer.short_code).await?;
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
        confirm_pairing_on_this_computer(app, &offer.short_code).await?;
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
    forget_mount_config(journal, grant_id)?;
    wake.wake();
    Ok(())
}

fn open_with_system(path: &std::ffi::OsStr) -> std::io::Result<()> {
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

/// A file in a selected folder that a work page asks to open or show. The
/// path must stay inside the folder (no `..`, no absolute path, no link out)
/// and name a file that is there.
fn local_document(
    grants: &GrantRegistry,
    grant_id: &str,
    relative_path: &str,
) -> Result<std::path::PathBuf, String> {
    let path = grants
        .resolve(grant_id, std::path::Path::new(relative_path))
        .map_err(|_| {
            "This file is not in a folder Spectra can reach on this computer.".to_string()
        })?;
    if !path.is_file() {
        return Err("This file is no longer in its folder on this computer.".into());
    }
    Ok(path)
}

/// Only the Office documents Spectra keeps a desktop copy of open from a web
/// page. A program or a script in the same folder is never launched.
fn opens_in_desktop_app(path: &std::path::Path) -> bool {
    let format = native_format(path);
    format != "spectra-pkg" && carries_native_payload(&format)
}

/// Explorer does not understand the `\\?\` form a resolved Windows path has.
fn shell_path(path: &std::path::Path) -> std::path::PathBuf {
    let raw = path.to_string_lossy();
    if let Some(share) = raw.strip_prefix(r"\\?\UNC\") {
        return std::path::PathBuf::from(format!(r"\\{share}"));
    }
    match raw.strip_prefix(r"\\?\") {
        Some(local) => std::path::PathBuf::from(local),
        None => path.to_path_buf(),
    }
}

/// Shows a file selected in the system's file manager.
fn reveal_in_file_manager(path: &std::path::Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg("/select,")
            .arg(path)
            .creation_flags(WINDOWS_CREATE_NO_WINDOW)
            .spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(path.parent().unwrap_or(path))
            .spawn()?;
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
    open_with_system(path.as_os_str())
        .map_err(|error| format!("Could not open the Bridge log: {error}"))
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
    health: &mut HealthReporter,
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

    let paused = sync_paused(journal);
    let paused_grants = paused_mounts(grants, journal);
    let report = health_report(grants, journal, paused);
    if health.due(&report) {
        match report_health(deployment, &credential, &report).await {
            Ok(()) => {
                health.sent(report);
                state.mark_cloud_seen();
                let _ = journal.delete_config("health_report_error");
            }
            Err(error) if should_repair_pairing(&error.to_string()) => {
                // Spectra removed this computer (from the Devices page here or
                // on another device). Forget it, unless pairing replaced the
                // key while this report was in flight.
                let still_current = journal.config("device_id").ok().flatten().as_deref()
                    == Some(device_id.as_str())
                    && HostPlatform
                        .read_credential(&device_id)
                        .ok()
                        .flatten()
                        .as_deref()
                        == Some(credential.as_str());
                if still_current && unpair_this_computer(grants, journal).is_ok() {
                    state.forget_pairing();
                }
                return PollResult::Unauthenticated;
            }
            Err(error) => {
                let _ = journal.set_config("health_report_error", &error.to_string());
            }
        }
    }
    if paused {
        // Changes found on disk wait in the journal until syncing resumes.
        return PollResult::SuccessfulIdle;
    }

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
        if restored_grants_reconciled.contains(&grant.id) || paused_grants.contains(&grant.id) {
            continue;
        }
        match sync_grant(&grant, journal, active_mount_syncs).await {
            Ok(MountSyncOutcome::Completed | MountSyncOutcome::RetryScheduled) => {
                restored_grants_reconciled.insert(grant.id);
            }
            Ok(MountSyncOutcome::AlreadyRunning) => {
                restored_grants_reconciled.insert(grant.id);
            }
            Ok(MountSyncOutcome::Paused) => {}
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
    match drain_cloud_queue_holding(journal, deployment, &credential, &paused_grants).await {
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
        match drain_structure_requests(grants, journal, deployment, &credential, &paused_grants)
            .await
        {
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
    let payload_handled = match drain_pending_payload_uploads(
        grants,
        journal,
        deployment,
        &credential,
        &paused_grants,
    )
    .await
    {
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
    let write_handled = match drain_write_requests(
        grants,
        journal,
        deployment,
        &credential,
        &paused_grants,
    )
    .await
    {
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

    if !failed {
        record_clean_pass(grants, journal, &paused_grants, current_time_ms());
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
    let mut health = HealthReporter::default();

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
            &mut health,
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

fn main() {
    configure_embedded_release_environment();
    record_process_start();
    let sync_wake = PollWake::new();
    let shutdown_wake = sync_wake.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Starting Bridge again while it runs opens its home: the
            // Devices page. A login start stays quiet.
            if !args.iter().any(|argument| argument == "--autostart") {
                open_devices_page(app);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg("--autostart")
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            // Bridge has no window: the tray, the folder picker and the
            // pairing confirmation are its only native surfaces. Everything
            // else happens on the Devices page in Spectra.
            let open =
                MenuItem::with_id(app, "open", "Open Devices in Spectra", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "Pause syncing", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Bridge", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &pause, &quit])?;
            let tray_journal = journal.clone();
            let tray_wake = sync_wake.clone();
            TrayIconBuilder::with_id(TRAY_ID)
                .menu(&menu)
                .tooltip("Spectra Bridge")
                .icon(tauri::image::Image::from_bytes(tray_icon_png(
                    taskbar_is_light(),
                    TrayDot::Grey,
                    32,
                ))?)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => open_devices_page(app),
                    "pause" => {
                        let paused = !sync_paused(&tray_journal);
                        if let Err(error) = set_sync_paused(&tray_journal, paused) {
                            record_runtime_error(&tray_journal, "Could not change syncing", &error);
                        }
                        tray_wake.wake();
                        refresh_tray(app);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            app.manage(TrayHandles {
                pause,
                shown: Mutex::new(None),
            });
            let tray_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    refresh_tray(&tray_app);
                    tokio::time::sleep(TRAY_REFRESH).await;
                }
            });
            Ok(())
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
mod devices_tests {
    use super::*;

    fn mount(label: &str, state: &str, paused: bool) -> LocalMountStatus {
        LocalMountStatus {
            id: format!("grant_{label}"),
            label: label.into(),
            friendly_path: format!("Documents \u{203a} {label}"),
            state: state.into(),
            detail: String::new(),
            synced: 0,
            total: 0,
            double_sync_risk: false,
            paused,
            last_sync_at: None,
        }
    }

    fn temp_folder(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir()
            .join(format!("spectra-bridge-{}", uuid::Uuid::new_v4()))
            .join(name);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn the_tray_says_its_state_in_plain_words() {
        let three = [
            mount("Biology", "active", false),
            mount("History", "active", false),
            mount("Maths", "syncing", false),
        ];
        assert_eq!(
            tray_view(true, true, false, &three),
            TrayView {
                dot: TrayDot::None,
                tooltip: "Spectra Bridge \u{b7} Connected \u{b7} 3 folders".into()
            }
        );
        assert_eq!(
            tray_view(true, true, false, &three[..1]).tooltip,
            "Spectra Bridge \u{b7} Connected \u{b7} 1 folder"
        );
        assert_eq!(
            tray_view(true, false, false, &three),
            TrayView {
                dot: TrayDot::Grey,
                tooltip: "Spectra Bridge \u{b7} Disconnected".into()
            }
        );
        assert_eq!(tray_view(false, false, false, &[]).dot, TrayDot::Orange);
        let paused = tray_view(true, true, true, &three);
        assert_eq!(paused.dot, TrayDot::Grey);
        assert_eq!(
            paused.tooltip,
            "Spectra Bridge \u{b7} Paused \u{b7} 3 folders"
        );
    }

    #[test]
    fn a_folder_problem_turns_the_dot_red_unless_that_folder_is_paused() {
        let unreachable = [
            mount("Biology", "unavailable", false),
            mount("Maths", "active", false),
        ];
        let view = tray_view(true, true, false, &unreachable);
        assert_eq!(view.dot, TrayDot::Red);
        assert_eq!(view.tooltip, "Spectra Bridge \u{b7} Problem with Biology");
        let two = [
            mount("Biology", "error", false),
            mount("Maths", "unavailable", false),
        ];
        assert_eq!(
            tray_view(true, true, false, &two).tooltip,
            "Spectra Bridge \u{b7} Problem with 2 folders"
        );
        let paused_problem = [mount("Biology", "unavailable", true)];
        assert_eq!(
            tray_view(true, true, false, &paused_problem).dot,
            TrayDot::None
        );
    }

    #[test]
    fn every_tray_icon_is_embedded_at_its_size() {
        for light in [true, false] {
            for dot in [TrayDot::None, TrayDot::Grey, TrayDot::Orange, TrayDot::Red] {
                for (scale, size) in [(1.0, 16), (1.25, 20), (1.5, 24), (2.0, 32), (3.0, 32)] {
                    let png = tray_icon_png(light, dot, tray_icon_size(scale));
                    assert_eq!(&png[1..4], b"PNG");
                    let width = u32::from_be_bytes(png[16..20].try_into().unwrap());
                    let height = u32::from_be_bytes(png[20..24].try_into().unwrap());
                    assert_eq!((width, height), (size, size), "{light} {dot:?} {scale}");
                }
            }
        }
    }

    #[test]
    fn folders_show_with_their_parent() {
        let path = std::path::Path::new("/Users/sam/Documents/Biology");
        assert_eq!(friendly_path(path), "Documents \u{203a} Biology");
        assert_eq!(friendly_path(std::path::Path::new("Biology")), "Biology");
    }

    #[test]
    fn the_devices_page_opens_only_on_a_web_origin() {
        assert_eq!(
            devices_page_url("https://spectra.school/").as_deref(),
            Some("https://spectra.school/devices")
        );
        assert_eq!(
            devices_page_url("http://localhost:3000").as_deref(),
            Some("http://localhost:3000/devices")
        );
        assert_eq!(devices_page_url("file:///etc/passwd"), None);
        assert_eq!(devices_page_url("https://a.test\" & calc"), None);
        assert_eq!(devices_page_url(""), None);
    }

    #[test]
    fn the_pairing_dialog_shows_the_code_as_the_page_does() {
        assert_eq!(spaced_code("123456"), "123 456");
        assert!(pairing_confirmation_text("123456").contains("123 456"));
    }

    #[test]
    fn pausing_is_remembered_per_computer_and_per_folder() {
        let journal = Journal::in_memory().unwrap();
        let grants = GrantRegistry::default();
        let grant = grants
            .add_native_selection("Biology".into(), &temp_folder("Biology"))
            .unwrap();
        assert!(!sync_paused(&journal));
        set_sync_paused(&journal, true).unwrap();
        assert!(sync_paused(&journal));
        assert!(control_snapshot(&grants, &journal).paused);
        set_sync_paused(&journal, false).unwrap();
        assert!(!sync_paused(&journal));

        set_mount_paused(&grants, &journal, &grant.id, true).unwrap();
        assert_eq!(
            paused_mounts(&grants, &journal),
            HashSet::from([grant.id.clone()])
        );
        let snapshot = control_snapshot(&grants, &journal);
        assert!(snapshot.mounts[0].paused);
        assert_eq!(
            snapshot.mounts[0].friendly_path.split(" \u{203a} ").last(),
            Some("Biology")
        );
        assert!(set_mount_paused(&grants, &journal, "grant_gone", true).is_err());
    }

    #[test]
    fn a_work_page_reaches_only_documents_inside_a_selected_folder() {
        let grants = GrantRegistry::default();
        let root = temp_folder("Biology");
        let grant = grants
            .add_native_selection("Biology".into(), &root)
            .unwrap();
        std::fs::create_dir_all(root.join("Essays")).unwrap();
        std::fs::write(root.join("Essays").join("Cells.docx"), b"doc").unwrap();
        std::fs::write(root.join("setup.exe"), b"exe").unwrap();
        std::fs::write(root.parent().unwrap().join("outside.docx"), b"doc").unwrap();

        let essay = local_document(&grants, &grant.id, "Essays/Cells.docx").unwrap();
        assert!(essay.ends_with(std::path::Path::new("Essays").join("Cells.docx")));
        assert!(opens_in_desktop_app(&essay));
        // A program in the folder can be shown, never launched.
        let program = local_document(&grants, &grant.id, "setup.exe").unwrap();
        assert!(!opens_in_desktop_app(&program));
        for refused in [
            "../outside.docx",
            "Essays/Missing.docx",
            "Essays",
            "C:/Windows/notepad.exe",
        ] {
            assert!(
                local_document(&grants, &grant.id, refused).is_err(),
                "{refused}"
            );
        }
        assert!(local_document(&grants, "grant_gone", "Essays/Cells.docx").is_err());
    }

    #[test]
    fn explorer_gets_a_plain_windows_path() {
        assert_eq!(
            shell_path(std::path::Path::new(r"\\?\C:\Users\Ana\Biology\Cells.docx")),
            std::path::PathBuf::from(r"C:\Users\Ana\Biology\Cells.docx")
        );
        assert_eq!(
            shell_path(std::path::Path::new(r"\\?\UNC\server\share\Cells.docx")),
            std::path::PathBuf::from(r"\\server\share\Cells.docx")
        );
        assert_eq!(
            shell_path(std::path::Path::new("/home/ana/Cells.docx")),
            std::path::PathBuf::from("/home/ana/Cells.docx")
        );
    }

    #[tokio::test]
    async fn a_paused_folder_is_never_scanned_to_spectra() {
        let journal = Arc::new(Journal::in_memory().unwrap());
        let grants = GrantRegistry::default();
        let biology = grants
            .add_native_selection("Biology".into(), &temp_folder("Biology"))
            .unwrap();
        let maths = grants
            .add_native_selection("Maths".into(), &temp_folder("Maths"))
            .unwrap();
        let active: ActiveMountSyncs = Arc::new(Mutex::new(HashSet::new()));

        set_mount_paused(&grants, &journal, &biology.id, true).unwrap();
        assert!(folder_paused(&journal, &biology.id));
        assert!(!folder_paused(&journal, &maths.id));
        // The scan returns before it reads the folder or calls Spectra, and
        // leaves the folder's status as it was.
        assert!(matches!(
            sync_grant(&biology, &journal, &active).await,
            Ok(MountSyncOutcome::Paused)
        ));
        assert!(active.lock().unwrap().is_empty());

        // Pausing every folder holds the other one too.
        set_sync_paused(&journal, true).unwrap();
        assert!(folder_paused(&journal, &maths.id));
        assert!(matches!(
            sync_grant(&maths, &journal, &active).await,
            Ok(MountSyncOutcome::Paused)
        ));
    }

    #[test]
    fn a_clean_pass_dates_active_folders_but_not_paused_ones() {
        let journal = Journal::in_memory().unwrap();
        let grants = GrantRegistry::default();
        let active = grants
            .add_native_selection("Biology".into(), &temp_folder("Biology"))
            .unwrap();
        let paused = grants
            .add_native_selection("Maths".into(), &temp_folder("Maths"))
            .unwrap();
        set_mount_status(&journal, &active.id, "active", "Up to date", 2, 2).unwrap();
        set_mount_status(&journal, &paused.id, "active", "Up to date", 1, 1).unwrap();
        record_clean_pass(
            &grants,
            &journal,
            &HashSet::from([paused.id.clone()]),
            1_000,
        );
        let snapshot = control_snapshot(&grants, &journal);
        assert_eq!(snapshot.last_sync_at, Some(1_000));
        let synced_at = |id: &str| {
            snapshot
                .mounts
                .iter()
                .find(|mount| mount.id == id)
                .unwrap()
                .last_sync_at
        };
        assert_eq!(synced_at(&active.id), Some(1_000));
        assert_eq!(synced_at(&paused.id), None);
    }

    #[test]
    fn office_files_name_the_file_and_its_folder() {
        let journal = Journal::in_memory().unwrap();
        let grants = GrantRegistry::default();
        let grant = grants
            .add_native_selection("Biology".into(), &temp_folder("Biology"))
            .unwrap();
        journal
            .upsert_resource(&ResourceRecord {
                local_resource_id: "lr_essay".into(),
                grant_id: grant.id.clone(),
                path_key: "Term 1/Essay.docx".into(),
                volume: None,
                file_index: None,
                content_hash: None,
                revision: None,
                available: true,
                unavailable_reason: None,
                last_seen_generation: 0,
            })
            .unwrap();
        journal
            .set_config(&lock_hold_key(&grant.id, "lr_essay"), "1")
            .unwrap();
        journal
            .set_config(&lock_hold_key("grant_other", "lr_essay"), "1")
            .unwrap();
        assert_eq!(
            office_files(&grants, &journal),
            vec![LocalOfficeFile {
                folder: "Biology".into(),
                name: "Essay.docx".into()
            }]
        );
    }

    #[test]
    fn unpairing_forgets_folders_and_the_browser_session_but_not_the_installation() {
        let journal = Journal::in_memory().unwrap();
        let grants = GrantRegistry::default();
        let grant = grants
            .add_native_selection("Biology".into(), &temp_folder("Biology"))
            .unwrap();
        journal
            .set_config(&format!("mount:{}", grant.id), "{}")
            .unwrap();
        journal
            .set_config(&mount_paused_key(&grant.id), "true")
            .unwrap();
        journal
            .set_config("browser_origin", "https://spectra.school")
            .unwrap();
        journal
            .set_config("browser_session_token", "token")
            .unwrap();
        journal.set_config("installation_id", "install-1").unwrap();
        set_sync_paused(&journal, true).unwrap();
        unpair_this_computer(&grants, &journal).unwrap();
        assert!(grants.device_grants().is_empty());
        assert_eq!(
            journal.config(&format!("mount:{}", grant.id)).unwrap(),
            None
        );
        assert_eq!(journal.config(&mount_paused_key(&grant.id)).unwrap(), None);
        assert_eq!(journal.config("browser_session_token").unwrap(), None);
        assert!(!sync_paused(&journal));
        assert_eq!(
            journal.config("installation_id").unwrap().as_deref(),
            Some("install-1")
        );
    }

    #[test]
    fn health_is_reported_on_change_and_otherwise_once_a_minute() {
        let mut reporter = HealthReporter::default();
        let report = DeviceHealthReport {
            folders: 2,
            last_sync_at: Some(1),
            ..DeviceHealthReport::default()
        };
        assert!(reporter.due(&report));
        reporter.sent(report.clone());
        let later = DeviceHealthReport {
            last_sync_at: Some(2),
            ..report.clone()
        };
        assert!(!reporter.due(&later), "a newer sync time alone waits");
        let problem = DeviceHealthReport {
            problem: Some("folder-unavailable".into()),
            ..report.clone()
        };
        assert!(reporter.due(&problem));
        reporter.last = Some((
            report.clone(),
            std::time::Instant::now() - HEALTH_REPORT_INTERVAL,
        ));
        assert!(reporter.due(&report));
    }

    #[test]
    fn health_names_the_first_unreachable_folder_that_is_not_paused() {
        let journal = Journal::in_memory().unwrap();
        let grants = GrantRegistry::default();
        let paused = grants
            .add_native_selection("Art".into(), &temp_folder("Art"))
            .unwrap();
        let missing = grants
            .add_native_selection("Biology".into(), &temp_folder("Biology"))
            .unwrap();
        set_mount_status(&journal, &paused.id, "unavailable", "", 0, 0).unwrap();
        set_mount_paused(&grants, &journal, &paused.id, true).unwrap();
        set_mount_status(&journal, &missing.id, "unavailable", "", 0, 0).unwrap();
        let report = health_report(&grants, &journal, false);
        assert_eq!(report.folders, 2);
        assert_eq!(report.problem.as_deref(), Some("folder-unavailable"));
        assert_eq!(report.problem_folder.as_deref(), Some("Biology"));
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ActiveMountSyncGuard, MountRepairRetry, clear_mount_repair_retry,
        configured_deployment_url, current_time_ms, mount_repair_retry_due, mount_repair_retry_key,
        resolve_bridge_data_dir, resolve_deployment_url, retain_current_mounts,
        schedule_mount_repair_retry,
    };
    use spectra_bridge_core::journal::Journal;
    use std::collections::HashSet;
    use std::sync::{Arc, Mutex};

    #[test]
    fn bridge_without_a_deployment_asks_to_pair_again() {
        let error = configured_deployment_url(None).unwrap_err();
        assert!(error.contains("Pair it again from Devices"));
        assert!(configured_deployment_url(Some("   ".into())).is_err());
    }

    #[test]
    fn launch_override_wins_over_the_paired_deployment() {
        let stored = Some("https://paired.convex.cloud".to_string());
        assert_eq!(
            resolve_deployment_url(Some("http://127.0.0.1:3002/".into()), stored.clone()).unwrap(),
            "http://127.0.0.1:3002"
        );
        assert_eq!(
            resolve_deployment_url(None, stored.clone()).unwrap(),
            "https://paired.convex.cloud"
        );
        assert_eq!(
            resolve_deployment_url(Some(" ".into()), stored).unwrap(),
            "https://paired.convex.cloud"
        );
        assert!(resolve_deployment_url(None, None).is_err());
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
        let skewed = MountRepairRetry {
            attempts: second.attempts,
            retry_at_ms: current_time_ms() + 24 * 60 * 60 * 1_000,
        };
        journal
            .set_config(&retry_key, &serde_json::to_string(&skewed).unwrap())
            .unwrap();
        assert!(
            mount_repair_retry_due(&journal, "grant-safe"),
            "a retry scheduled before the clock was set back must not wait out the jump"
        );
        clear_mount_repair_retry(&journal, "grant-safe").unwrap();
        assert!(!mount_repair_retry_due(&journal, "grant-safe"));
        assert_eq!(journal.config(&retry_key).unwrap(), None);
    }

    mod per_file_repair {
        use super::super::{
            DiscoveredResource, DiscoverySkip, MountPass, classify_discovery_skip,
            hand_off_failed_upload, mount_pass_status, record_mount_repair_retry, scan_local_files,
            set_mount_file_note, set_mount_status,
        };
        use spectra_bridge_core::fs::{Grant, GrantRegistry};
        use spectra_bridge_core::journal::Journal;
        use std::time::{Duration, SystemTime};

        struct Folder(std::path::PathBuf);

        impl Folder {
            fn new() -> Self {
                let path = std::env::temp_dir().join(format!(
                    "spectra-bridge-repair-{}",
                    uuid::Uuid::new_v4().simple()
                ));
                std::fs::create_dir_all(&path).unwrap();
                Self(path)
            }

            fn grant(&self) -> Grant {
                GrantRegistry::default()
                    .add_native_selection("Coursework".into(), &self.0)
                    .unwrap()
            }

            /// Writes a file whose last write is well in the past, as a file
            /// that has been sitting in the folder since the last pass.
            fn settled(&self, name: &str, bytes: &[u8]) -> std::path::PathBuf {
                let path = self.0.join(name);
                std::fs::write(&path, bytes).unwrap();
                set_mtime(&path, SystemTime::now() - Duration::from_secs(3_600));
                path
            }
        }

        impl Drop for Folder {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }

        fn set_mtime(path: &std::path::Path, time: SystemTime) {
            std::fs::File::options()
                .write(true)
                .open(path)
                .unwrap()
                .set_modified(time)
                .unwrap();
        }

        fn hash_of(files: &[DiscoveredResource], name: &str) -> Option<String> {
            files
                .iter()
                .find(|file| file.relative_path == name)
                .and_then(|file| file.content_hash.clone())
        }

        #[test]
        fn repeated_office_sessions_report_each_unlock_without_a_new_file_revision() {
            let folder = Folder::new();
            folder.settled("essay.docx", b"unchanged native revision");
            let grant = folder.grant();
            let journal = Journal::in_memory().unwrap();
            let path = grant.device_root().join("essay.docx");
            scan_local_files(&grant, &journal, 1).unwrap();
            journal
                .set_config(&format!("cloud_mount:{}", grant.id), "mount-test")
                .unwrap();
            let resource = journal.resources_for_grant(&grant.id).unwrap().remove(0);
            let mut delivered_operations = std::collections::HashSet::new();

            for session in 1..=3 {
                for op in ["locked", "unlocked"] {
                    assert_eq!(
                        super::super::enqueue_lock_report(&grant, &journal, &path, op).unwrap(),
                        1,
                        "session {session} must report {op} even with unchanged file bytes"
                    );
                    assert_eq!(
                        super::super::enqueue_lock_report(&grant, &journal, &path, op).unwrap(),
                        0,
                        "repeated probes must not duplicate an undelivered transition"
                    );
                    let queued = journal.due_queue(10).unwrap();
                    assert_eq!(queued.len(), 1);
                    let envelope: super::super::QueuedChangeEnvelope =
                        serde_json::from_str(&queued[0].payload).unwrap();
                    assert_eq!(envelope.change.op, op);
                    assert!(delivered_operations.insert(queued[0].op_id.clone()));
                    journal
                        .acknowledge_change(&queued[0], &resource.local_resource_id, None)
                        .unwrap();
                    assert_eq!(
                        super::super::enqueue_lock_report(&grant, &journal, &path, op).unwrap(),
                        0,
                        "repeated probes must not replay a delivered transition"
                    );
                }
            }
            assert_eq!(delivered_operations.len(), 6);
        }

        #[test]
        fn a_repair_pass_reuses_the_hash_of_every_file_that_has_not_moved() {
            let folder = Folder::new();
            folder.settled("essay.docx", b"first draft");
            folder.settled("notes.txt", b"notes");
            let grant = folder.grant();
            let journal = Journal::in_memory().unwrap();
            let first = scan_local_files(&grant, &journal, 1).unwrap();
            assert_eq!(first.hashed, 2);
            assert!(first.complete);

            // Before: every repair pass read and hashed every file again.
            let second = scan_local_files(&grant, &journal, 2).unwrap();
            assert_eq!(second.hashed, 0);
            assert_eq!(second.files.len(), 2);
            for name in ["essay.docx", "notes.txt"] {
                assert_eq!(hash_of(&second.files, name), hash_of(&first.files, name));
            }
            let ids = |files: &[DiscoveredResource]| {
                let mut ids = files
                    .iter()
                    .map(|file| file.local_resource_id.clone())
                    .collect::<Vec<_>>();
                ids.sort();
                ids
            };
            assert_eq!(ids(&second.files), ids(&first.files));
            for resource in journal.resources_for_grant(&grant.id).unwrap() {
                assert_eq!(resource.last_seen_generation, 2);
            }
        }

        #[test]
        fn a_moved_stat_or_a_missing_hash_is_read_again() {
            let folder = Folder::new();
            let essay = folder.settled("essay.docx", b"first draft");
            folder.settled("notes.txt", b"notes");
            let grant = folder.grant();
            let journal = Journal::in_memory().unwrap();
            let first = scan_local_files(&grant, &journal, 1).unwrap();

            // Same size, new bytes, new modification time.
            std::fs::write(&essay, b"final draft").unwrap();
            set_mtime(&essay, SystemTime::now() - Duration::from_secs(60));
            let edited = scan_local_files(&grant, &journal, 2).unwrap();
            assert_eq!(edited.hashed, 1);
            assert_ne!(
                hash_of(&edited.files, "essay.docx"),
                hash_of(&first.files, "essay.docx")
            );

            // Size and mtime still match, but the store holds no hash.
            let mut notes = journal
                .resources_for_grant(&grant.id)
                .unwrap()
                .into_iter()
                .find(|resource| resource.path_key.ends_with("notes.txt"))
                .unwrap();
            notes.content_hash = None;
            journal.upsert_resource(&notes).unwrap();
            let unhashed = scan_local_files(&grant, &journal, 3).unwrap();
            assert_eq!(unhashed.hashed, 1);
            assert_eq!(
                hash_of(&unhashed.files, "notes.txt"),
                hash_of(&first.files, "notes.txt")
            );
        }

        #[test]
        fn a_file_hashed_right_after_its_write_is_hashed_again_next_pass() {
            let folder = Folder::new();
            std::fs::write(folder.0.join("live.docx"), b"just saved").unwrap();
            let grant = folder.grant();
            let journal = Journal::in_memory().unwrap();
            assert_eq!(scan_local_files(&grant, &journal, 1).unwrap().hashed, 1);
            // A second write inside the timestamp granularity could keep this
            // size and mtime, so the stat does not vouch for these bytes yet.
            assert_eq!(scan_local_files(&grant, &journal, 2).unwrap().hashed, 1);
        }

        #[test]
        fn folder_rules_are_not_sync_failures() {
            for reason in [
                "approval-required",
                "filtered",
                "explicit-only",
                "ignored-by-user",
                "artifact-access-revoked",
            ] {
                assert_eq!(classify_discovery_skip(Some(reason)), DiscoverySkip::Policy);
            }
            assert_eq!(
                classify_discovery_skip(Some("office-lock")),
                DiscoverySkip::Held
            );
            assert_eq!(
                classify_discovery_skip(Some("resource-metadata-invalid")),
                DiscoverySkip::Unsyncable
            );
            assert_eq!(classify_discovery_skip(None), DiscoverySkip::Retry);
            assert_eq!(
                classify_discovery_skip(Some("new-server-reason")),
                DiscoverySkip::Retry
            );
        }

        #[test]
        fn a_failed_upload_retries_that_file_on_its_own_queue() {
            let folder = Folder::new();
            folder.settled("essay.docx", b"draft");
            let grant = folder.grant();
            let journal = Journal::in_memory().unwrap();
            journal
                .set_config(&format!("cloud_mount:{}", grant.id), "mount-1")
                .unwrap();
            let scan = scan_local_files(&grant, &journal, 1).unwrap();
            assert!(journal.due_queue(10).unwrap().is_empty());
            // Before: the file only came back with a full-folder repair pass.
            assert!(hand_off_failed_upload(&grant, &journal, &scan.files[0], 1));
            let queued = journal.due_queue(10).unwrap();
            assert_eq!(queued.len(), 1);
            assert_eq!(queued[0].direction, "outbound-change");
            assert!(queued[0].payload.contains("essay.docx"));
            // A file that is gone cannot be queued; it needs a repair pass.
            let gone = DiscoveredResource {
                relative_path: "missing.docx".into(),
                ..scan.files[0].clone()
            };
            assert!(!hand_off_failed_upload(&grant, &journal, &gone, 1));
        }

        #[test]
        fn one_behind_file_is_named_and_the_folder_stays_active() {
            let clean = MountPass {
                scanned: 3,
                complete: true,
                ..MountPass::default()
            };
            assert!(!clean.needs_repair());
            assert_eq!(
                mount_pass_status(&clean, None),
                ("Available in Spectra".to_owned(), 3, 3)
            );

            let retrying = MountPass {
                scanned: 3,
                unsynced: 1,
                retrying: vec!["Physics/lab.docx".into()],
                complete: true,
                ..MountPass::default()
            };
            // The queue retries it; the folder needs no repair pass for it.
            assert!(!retrying.needs_repair());
            let (detail, synced, total) = mount_pass_status(&retrying, None);
            assert_eq!(
                detail,
                "Available in Spectra. Spectra is retrying the upload of \u{201c}Physics/lab.docx\u{201d}."
            );
            assert_eq!((synced, total), (2, 3));

            let held = MountPass {
                scanned: 2,
                unscanned: 2,
                held: vec!["essay.docx".into(), "deck.pptx".into()],
                unsyncable: vec!["bad:name.docx".into()],
                unsynced: 1,
                ..MountPass::default()
            };
            assert!(held.needs_repair());
            let (detail, synced, total) = mount_pass_status(&held, Some(30_000));
            assert!(detail.contains(
                "\u{201c}essay.docx\u{201d} and 1 more file are open or still being saved"
            ));
            assert!(detail.contains("\u{201c}bad:name.docx\u{201d} could not be added"));
            assert!(detail.ends_with("Spectra will check again in 30 seconds."));
            assert_eq!((synced, total), (1, 4));
        }

        #[test]
        fn a_file_note_keeps_the_folder_active_and_its_counts() {
            let journal = Journal::in_memory().unwrap();
            set_mount_status(&journal, "grant-a", "active", "Available in Spectra", 7, 8).unwrap();
            record_mount_repair_retry(&journal, "grant-a").unwrap();
            set_mount_file_note(
                &journal,
                "grant-a",
                "\u{201c}a.docx\u{201d} could not be read yet.",
            )
            .unwrap();
            let status: serde_json::Value =
                serde_json::from_str(&journal.config("mount_status:grant-a").unwrap().unwrap())
                    .unwrap();
            assert_eq!(status["state"], "active");
            assert_eq!(status["synced"], 7);
            assert_eq!(status["total"], 8);
        }
    }
}
