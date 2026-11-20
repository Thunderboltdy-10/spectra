use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub version: String,
    pub paired: bool,
    pub protocol_version: String,
    pub port: u16,
    pub bind_error: Option<String>,
    /// This computer was disconnected on purpose (from Bridge, or removed in
    /// Spectra): pages wait for a person to connect it again instead of
    /// joining by themselves. Absent from older Bridges, so it defaults off.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub disconnected_here: bool,
    /// Spectra for desktop: the version downloaded and waiting for a restart.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update_ready: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalMountStatus {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selection_kind: Option<String>,
    /// The folder as a person names it: its parent and itself,
    /// "Documents › Biology". Built on this computer for the local page only.
    pub friendly_path: String,
    pub state: String,
    pub detail: String,
    pub synced: usize,
    pub total: usize,
    pub double_sync_risk: bool,
    /// The user paused this one folder.
    pub paused: bool,
    /// When this folder last finished a sync pass, in Unix milliseconds.
    pub last_sync_at: Option<u64>,
}

/// A file Office holds open in a selected folder right now.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalOfficeFile {
    pub folder: String,
    pub name: String,
}

/// What the Bridge process knows about itself, apart from pairing.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalControlSnapshot {
    pub device_name: String,
    pub paused: bool,
    pub last_sync_at: Option<u64>,
    pub mounts: Vec<LocalMountStatus>,
    pub office_files: Vec<LocalOfficeFile>,
    /// What syncing did lately, newest first.
    #[serde(default)]
    pub sync_log: Vec<SyncLogEntry>,
    /// The last thing an update did, when it needs saying (it failed, it waits).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update_note: Option<String>,
}

/// One line of the local sync log.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncLogEntry {
    /// Unix milliseconds of the latest time this happened.
    pub at: u64,
    pub folder: String,
    /// scan, toSpectra, fromSpectra, conflict or error.
    pub kind: String,
    pub detail: String,
    /// How many more times the same line happened in a row.
    #[serde(default)]
    pub repeats: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalBridgeStatus {
    pub version: String,
    pub protocol_version: String,
    pub paired: bool,
    pub cloud_connected: bool,
    pub device_id: Option<String>,
    pub device_name: String,
    /// Syncing is paused for every folder (from the tray or the Devices page).
    pub paused: bool,
    pub last_sync_at: Option<u64>,
    pub mounts: Vec<LocalMountStatus>,
    pub office_files: Vec<LocalOfficeFile>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sync_log: Vec<SyncLogEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update_note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PairingOffer {
    pub challenge: String,
    pub short_code: String,
    pub browser_origin: String,
    pub expires_at: u64,
    /// The Convex deployment of the Spectra that made the offer. An installed
    /// Bridge learns where to sync from the page it pairs with.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deployment_url: Option<String>,
}

pub fn protocol_major(value: &str) -> Option<u32> {
    value.split('.').next()?.parse().ok()
}

pub fn compatible_protocol(remote: &str) -> bool {
    protocol_major(remote) == protocol_major(crate::PROTOCOL_VERSION)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn major_versions_are_the_compatibility_boundary() {
        assert!(compatible_protocol("1.99"));
        assert!(!compatible_protocol("2.0"));
        assert!(!compatible_protocol("invalid"));
    }
}
