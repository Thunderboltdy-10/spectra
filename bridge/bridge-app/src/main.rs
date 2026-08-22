use sha2::Digest;
use std::sync::Arc;

use spectra_bridge_core::fs::{
    FsError, Grant, GrantRegistry, SafeWriter, WriteRequest, sha256_file,
};
use spectra_bridge_core::journal::Journal;
use spectra_bridge_core::platform::{HostPlatform, Platform};
use spectra_bridge_core::protocol::{LocalMountStatus, PairingOffer};
use spectra_bridge_core::server::{LocalBridgeControl, ServerState, serve};
use spectra_bridge_core::sync::{
    DiscoveredResource, ReplicaMigrationPage, claim_fs_request, claim_write, complete_fs_request,
    complete_write, detach_mount, discover_resource, drain_cloud_queue, exchange_pairing,
    migrate_cloud_replica_page, reconcile_missing_resources, register_mount, resume_pairing,
    set_mount_availability, upload_resource_payload,
};
use spectra_bridge_core::watcher::{
    MountWatcher, WatcherConfig, office_lock_exists, office_lock_paths, scan_page,
};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;

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

    async fn auto_pair(&self) -> Result<(), String> {
        let offer = self
            .state
            .take_pairing_offer()
            .map_err(|error| error.to_string())?;
        complete_pairing_offer(&offer, &self.state, &self.journal).await
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
    let owner_lock_paths = office_lock_paths(grant.device_root(), 500);
    let scan_id = uuid::Uuid::new_v4().to_string();
    let mut double_sync_risk = false;
    let mut locked_files = 0usize;
    loop {
        let page = scan_page(&HostPlatform, grant.device_root(), cursor.as_deref(), 500)
            .map_err(|error| error.to_string())?;
        for entry in page.entries {
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
            }
            // Never hash a file while Office owns it. The next watcher pass
            // will pick it up after the owner lock disappears.
            let content_hash = if locked {
                None
            } else {
                entry.content_hash.or_else(|| sha256_file(&entry_path).ok())
            };
            files.push(DiscoveredResource {
                local_resource_id: entry.local_resource_id,
                relative_path: entry.relative_path,
                size: entry.size,
                content_hash,
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
    for (index, resource) in files.iter().enumerate() {
        let registration = discover_resource(&deployment, &credential, &mount_id, resource)
            .await
            .map_err(|error| error.to_string())?;
        if registration.skipped {
            set_mount_status(
                journal,
                &grant.id,
                "waiting",
                registration
                    .reason
                    .as_deref()
                    .unwrap_or("Waiting for approval in Spectra"),
                index + 1,
                files.len(),
            )?;
            continue;
        }
        if registration.needs_payload
            && [
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
            .contains(&resource.native_format.as_str())
        {
            let replica_id = registration
                .replica_id
                .as_deref()
                .ok_or_else(|| "Bridge registration returned no replica id".to_string())?;
            let relative = std::path::Path::new(&resource.relative_path);
            if relative.is_absolute()
                || relative.components().any(|part| {
                    matches!(
                        part,
                        std::path::Component::ParentDir
                            | std::path::Component::RootDir
                            | std::path::Component::Prefix(_)
                    )
                })
            {
                return Err("payload path escaped its selected folder".into());
            }
            let candidate = grant.device_root().join(relative);
            if office_lock_exists(&candidate) {
                // The mount remains usable and unrelated files continue to
                // sync. This specific file is retried after Word releases it.
                continue;
            }
            let canonical = candidate
                .canonicalize()
                .map_err(|error| error.to_string())?;
            if !canonical.starts_with(grant.device_root()) {
                return Err("payload path escaped its selected folder".into());
            }
            let bytes = std::fs::read(&canonical).map_err(|error| error.to_string())?;
            let hash = hex::encode(sha2::Sha256::digest(&bytes));
            if resource.content_hash.as_deref() != Some(hash.as_str()) {
                return Err(format!(
                    "{} changed while it was being read; retrying after it settles",
                    resource.relative_path
                ));
            }
            let media_type = match resource.native_format.as_str() {
                "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "docm" | "dotm" => "application/vnd.ms-word.document.macroEnabled.12",
                "dotx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
                "xlsx" | "xltx" => {
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                }
                "xlsm" | "xltm" | "xlam" => "application/vnd.ms-excel.sheet.macroEnabled.12",
                "pptm" | "potm" | "ppsm" | "ppam" => {
                    "application/vnd.ms-powerpoint.presentation.macroEnabled.12"
                }
                "potx" => "application/vnd.openxmlformats-officedocument.presentationml.template",
                "spectra-pkg" => "application/vnd.spectra.package+zip",
                _ => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            };
            upload_resource_payload(
                &deployment,
                &credential,
                replica_id,
                &bytes,
                &hash,
                media_type,
            )
            .await
            .map_err(|error| error.to_string())?;
        }
        set_mount_status(
            journal,
            &grant.id,
            "syncing",
            "Making files available in Spectra…",
            index + 1,
            files.len(),
        )?;
    }
    reconcile_missing_resources(&deployment, &credential, &mount_id, &scan_id)
        .await
        .map_err(|error| error.to_string())?;
    if locked_files > 0 {
        set_mount_status(
            journal,
            &grant.id,
            "waiting",
            &format!(
                "Waiting for Office to finish saving {locked_files} file{}",
                if locked_files == 1 { "" } else { "s" }
            ),
            files.len().saturating_sub(locked_files),
            files.len(),
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

async fn drain_write_requests(
    grants: &Arc<GrantRegistry>,
    journal: &Arc<Journal>,
    deployment: &str,
    credential: &str,
) -> anyhow::Result<usize> {
    use sha2::Digest;
    let mut handled = 0;
    for _ in 0..20 {
        let Some(request) = claim_write(deployment, credential).await? else {
            break;
        };
        let response = match reqwest::Client::new()
            .get(&request.payload_url)
            .send()
            .await
        {
            Ok(response) => response.error_for_status(),
            Err(error) => Err(error),
        };
        let payload = match response {
            Ok(response) => response.bytes().await?.to_vec(),
            Err(error) => {
                complete_write(
                    deployment,
                    credential,
                    &request.request_id,
                    "failed",
                    None,
                    Some(("payload-download-failed", &error.to_string())),
                )
                .await?;
                handled += 1;
                continue;
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
            handled += 1;
            continue;
        }
        let relative = std::path::Path::new(&request.relative_path);
        let target = grants.resolve(&request.grant_id, relative)?;
        let actual_revision = target.exists().then(|| sha256_file(&target)).transpose()?;
        let known_revision = actual_revision
            .as_deref()
            .unwrap_or(request.base_revision.as_str());
        let writer = SafeWriter::new(grants.clone(), journal.clone(), Arc::new(HostPlatform));
        let result = writer.write(WriteRequest {
            grant_id: &request.grant_id,
            relative_path: relative,
            resource_id: &request.local_resource_id,
            base_revision: &request.base_revision,
            known_revision,
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
                handled += 1;
            }
            Err(FsError::FileLocked) => {
                complete_write(
                    deployment,
                    credential,
                    &request.request_id,
                    "waiting",
                    actual_revision.as_deref(),
                    Some(("office-locked", "Waiting for Office to finish saving")),
                )
                .await?;
                break;
            }
            Err(FsError::StaleRevision) => {
                complete_write(
                    deployment,
                    credential,
                    &request.request_id,
                    "conflicted",
                    actual_revision.as_deref(),
                    Some((
                        "stale-revision",
                        "Word changed this file before Spectra could write it",
                    )),
                )
                .await?;
                handled += 1;
            }
            Err(error) => {
                complete_write(
                    deployment,
                    credential,
                    &request.request_id,
                    "failed",
                    actual_revision.as_deref(),
                    Some(("write-failed", &error.to_string())),
                )
                .await?;
                handled += 1;
            }
        }
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
        let mut watcher =
            MountWatcher::start(std::path::Path::new(grant.device_root()), config.clone()).ok();
        let mut last_reconciliation = std::time::Instant::now();
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
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
                last_reconciliation = std::time::Instant::now();
            }
            let changed = watcher
                .as_ref()
                .is_some_and(|watcher| !watcher.drain().is_empty());
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
                                let _ = drain_cloud_queue(&sync_journal, &url, &credential).await;
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
