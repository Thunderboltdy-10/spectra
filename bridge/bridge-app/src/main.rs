use std::sync::Arc;

use spectra_bridge_core::fs::{Grant, GrantRegistry};
use spectra_bridge_core::journal::Journal;
use spectra_bridge_core::platform::{HostPlatform, Platform};
use spectra_bridge_core::server::{ServerState, serve};
use spectra_bridge_core::sync::{
    DiscoveredResource, ReplicaMigrationPage, detach_mount, discover_resource, drain_cloud_queue,
    exchange_pairing, migrate_cloud_replica_page, register_mount,
};
use spectra_bridge_core::watcher::{MountWatcher, WatcherConfig, office_locks_present, scan_page};
use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;

struct BridgeRuntime {
    grants: Arc<GrantRegistry>,
    journal: Arc<Journal>,
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

fn deployment_url(journal: &Journal) -> Result<String, String> {
    if let Ok(url) = std::env::var("SPECTRA_CONVEX_URL") {
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
    let mut cursor = None;
    let mut files = Vec::new();
    let mut double_sync_risk = false;
    loop {
        let page = scan_page(&HostPlatform, grant.device_root(), cursor.as_deref(), 500)
            .map_err(|error| error.to_string())?;
        for entry in page.entries.into_iter().filter(|entry| !entry.is_directory) {
            double_sync_risk |= entry.double_sync_risk;
            let native_format = std::path::Path::new(&entry.relative_path)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("file")
                .to_ascii_lowercase();
            files.push(DiscoveredResource {
                local_resource_id: entry.local_resource_id,
                relative_path: entry.relative_path,
                size: entry.size,
                content_hash: entry.content_hash,
                native_format,
            });
        }
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }
    set_mount_status(
        journal,
        &grant.id,
        "syncing",
        "Making files available in Spectra…",
        0,
        files.len(),
    )?;
    let mount_id = register_mount(
        &deployment,
        &credential,
        &grant.label,
        &grant.id,
        files.len(),
        double_sync_risk,
    )
    .await
    .map_err(|error| error.to_string())?;
    journal
        .set_config(&format!("cloud_mount:{}", grant.id), &mount_id)
        .map_err(|error| error.to_string())?;
    for (index, resource) in files.iter().enumerate() {
        discover_resource(&deployment, &credential, &mount_id, resource)
            .await
            .map_err(|error| error.to_string())?;
        set_mount_status(
            journal,
            &grant.id,
            "syncing",
            "Making files available in Spectra…",
            index + 1,
            files.len(),
        )?;
    }
    set_mount_status(
        journal,
        &grant.id,
        "active",
        "Available in Spectra",
        files.len(),
        files.len(),
    )
}

fn spawn_grant_watcher(grant: Grant, grants: Arc<GrantRegistry>, journal: Arc<Journal>) {
    tauri::async_runtime::spawn(async move {
        let config = WatcherConfig::default();
        let watcher =
            MountWatcher::start(std::path::Path::new(grant.device_root()), config.clone()).ok();
        let mut last_reconciliation = std::time::Instant::now();
        let mut waiting_for_office = false;
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            if !grants
                .device_grants()
                .iter()
                .any(|candidate| candidate.id == grant.id)
            {
                break;
            }
            let changed = watcher
                .as_ref()
                .is_some_and(|watcher| !watcher.drain().is_empty());
            let office_locked = office_locks_present(std::path::Path::new(grant.device_root()));
            if office_locked {
                if changed || !waiting_for_office {
                    let _ = set_mount_status(
                        &journal,
                        &grant.id,
                        "waiting",
                        "Waiting for Office to finish saving",
                        0,
                        0,
                    );
                }
                waiting_for_office = true;
                continue;
            }
            if waiting_for_office {
                let _ = sync_grant(&grant, &journal).await;
                waiting_for_office = false;
                last_reconciliation = std::time::Instant::now();
                continue;
            }
            if changed {
                tokio::time::sleep(config.stability_window).await;
                let _ = sync_grant(&grant, &journal).await;
                last_reconciliation = std::time::Instant::now();
            } else if last_reconciliation.elapsed() >= config.reconciliation_interval {
                let _ = sync_grant(&grant, &journal).await;
                last_reconciliation = std::time::Instant::now();
            }
        }
    });
}

async fn sync_grant(grant: &Grant, journal: &Journal) -> Result<(), String> {
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
    let mounts = runtime
        .grants
        .device_grants()
        .into_iter()
        .map(|grant| {
            let value = runtime
                .journal
                .config(&format!("mount_status:{}", grant.id))
                .ok()
                .flatten()
                .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok())
                .unwrap_or_else(|| serde_json::json!({}));
            MountView {
                id: grant.id,
                label: grant.label,
                state: value
                    .get("state")
                    .and_then(|v| v.as_str())
                    .unwrap_or("selected")
                    .to_owned(),
                detail: value
                    .get("detail")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Selected on this device")
                    .to_owned(),
                synced: value.get("synced").and_then(|v| v.as_u64()).unwrap_or(0) as usize,
                total: value.get("total").and_then(|v| v.as_u64()).unwrap_or(0) as usize,
            }
        })
        .collect();
    (state.is_paired(), mounts)
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
    let deployment = deployment_url(&runtime.journal)?;
    let device_name = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "This device".into());
    let exchange = exchange_pairing(&deployment, &offer, &device_name)
        .await
        .map_err(|error| error.to_string())?;
    HostPlatform
        .store_credential(&exchange.device_id, &exchange.device_credential)
        .map_err(|error| error.to_string())?;
    runtime
        .journal
        .set_config("device_id", &exchange.device_id)
        .map_err(|error| error.to_string())?;
    let browser_origin = exchange.browser_origin;
    let session_token = state.complete_pairing(offer.challenge, browser_origin.clone());
    runtime
        .journal
        .set_config("browser_origin", &browser_origin)
        .map_err(|error| error.to_string())?;
    runtime
        .journal
        .set_config("browser_session_token", &session_token)
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn select_mount(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, BridgeRuntime>,
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
    let grant = runtime
        .grants
        .add_native_selection(label.clone(), &path)
        .map_err(|error| error.to_string())?;
    runtime
        .journal
        .set_config(
            &format!("mount:{}", grant.id),
            &serde_json::json!({ "label": label, "path": grant.device_root() }).to_string(),
        )
        .map_err(|error| error.to_string())?;
    sync_grant(&grant, &runtime.journal).await?;
    spawn_grant_watcher(
        grant.clone(),
        runtime.grants.clone(),
        runtime.journal.clone(),
    );
    Ok(Some((grant.id, label)))
}

#[tauri::command]
async fn retry_mount(
    grant_id: String,
    runtime: tauri::State<'_, BridgeRuntime>,
) -> Result<(), String> {
    let grant = runtime
        .grants
        .device_grants()
        .into_iter()
        .find(|grant| grant.id == grant_id)
        .ok_or_else(|| "Folder grant not found".to_string())?;
    sync_grant(&grant, &runtime.journal).await
}

#[tauri::command]
async fn remove_mount(
    grant_id: String,
    runtime: tauri::State<'_, BridgeRuntime>,
) -> Result<(), String> {
    if let (Ok(deployment), Some(device_id)) = (
        deployment_url(&runtime.journal),
        runtime
            .journal
            .config("device_id")
            .map_err(|error| error.to_string())?,
    ) {
        if let Some(credential) = HostPlatform
            .read_credential(&device_id)
            .map_err(|error| error.to_string())?
        {
            detach_mount(&deployment, &credential, &grant_id)
                .await
                .map_err(|error| error.to_string())?;
        }
    }
    runtime.grants.remove(&grant_id);
    for prefix in ["mount:", "mount_status:", "cloud_mount:"] {
        runtime
            .journal
            .delete_config(&format!("{prefix}{grant_id}"))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
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
            app.autolaunch().enable()?;
            repair_windows_autostart_command()?;
            if std::env::args().any(|argument| argument == "--autostart") {
                if let Some(window) = app.get_webview_window("main") {
                    window.hide()?;
                }
            }
            let data_dir = app.path().app_data_dir()?;
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
            app.manage(BridgeRuntime {
                grants: grants.clone(),
                journal: journal.clone(),
            });
            for grant in restored_grants {
                spawn_grant_watcher(grant, grants.clone(), journal.clone());
            }
            let sync_journal = app.state::<BridgeRuntime>().journal.clone();
            tauri::async_runtime::spawn(async move {
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
                                let _ = sync_journal.delete_config("replica_migration_error");
                                let _ = drain_cloud_queue(&sync_journal, &url, &credential).await;
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
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &pause, &logs, &quit])?;
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
                    "quit" => app.exit(0),
                    "pause" | "logs" | _ => {}
                });
            let tray_icon =
                tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
            tray = tray.icon(tray_icon);
            tray.build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Spectra Bridge shell failed");
}
