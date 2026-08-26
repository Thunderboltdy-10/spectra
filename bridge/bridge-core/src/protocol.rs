use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub version: String,
    pub paired: bool,
    pub protocol_version: String,
    pub port: u16,
    pub bind_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalMountStatus {
    pub id: String,
    pub label: String,
    pub state: String,
    pub detail: String,
    pub synced: usize,
    pub total: usize,
    pub double_sync_risk: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalBridgeStatus {
    pub version: String,
    pub protocol_version: String,
    pub paired: bool,
    pub cloud_connected: bool,
    pub device_id: Option<String>,
    pub mounts: Vec<LocalMountStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PairingOffer {
    pub challenge: String,
    pub short_code: String,
    pub browser_origin: String,
    pub expires_at: u64,
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
