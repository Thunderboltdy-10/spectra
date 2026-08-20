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
#[serde(tag = "type", content = "payload", rename_all = "camelCase")]
pub enum BrowserRequest {
    MountsList,
    TreeScan(TreeScanRequest),
    FileStat(ResourceRequest),
    FileRead(ResourceRequest),
    WatchSubscribe { mount_id: String },
    StatusSubscribe,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TreeScanRequest {
    pub mount_id: String,
    pub cursor: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRequest {
    pub resource_id: String,
    pub revision: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PairingOffer {
    pub challenge: String,
    pub short_code: String,
    pub browser_origin: String,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", content = "payload", rename_all = "camelCase")]
pub enum BrowserResponse {
    Ready { protocol_version: String },
    Error { code: String, message: String },
    Pong,
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
