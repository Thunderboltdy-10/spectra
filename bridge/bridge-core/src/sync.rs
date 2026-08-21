use crate::journal::Journal;
use crate::protocol::PairingOffer;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudResult {
    Applied,
    AlreadyApplied,
    StaleRevision,
    Retryable,
}

#[derive(Debug, Clone)]
pub struct Backoff {
    attempts: u32,
    floor: Duration,
    ceiling: Duration,
}

impl Default for Backoff {
    fn default() -> Self {
        Self {
            attempts: 0,
            floor: Duration::from_millis(500),
            ceiling: Duration::from_secs(60),
        }
    }
}

impl Backoff {
    pub fn success(&mut self) {
        self.attempts = 0;
    }
    pub fn next_delay(&mut self) -> Duration {
        let shift = self.attempts.min(16);
        self.attempts = self.attempts.saturating_add(1);
        self.floor.saturating_mul(1_u32 << shift).min(self.ceiling)
    }
}

pub fn accept_cloud_result(result: CloudResult) -> anyhow::Result<bool> {
    match result {
        CloudResult::Applied | CloudResult::AlreadyApplied => Ok(true),
        CloudResult::Retryable => Ok(false),
        CloudResult::StaleRevision => anyhow::bail!("stale-revision-rejected"),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingExchange {
    pub device_id: String,
    pub device_credential: String,
    pub browser_origin: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingResume {
    pub device_id: String,
    pub browser_origin: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConvexResponse<T> {
    status: String,
    value: Option<T>,
    error_message: Option<String>,
}

async fn mutation<T: for<'de> Deserialize<'de>>(
    deployment_url: &str,
    path: &str,
    args: serde_json::Value,
) -> anyhow::Result<T> {
    let response = reqwest::Client::new()
        .post(format!(
            "{}/api/mutation",
            deployment_url.trim_end_matches('/')
        ))
        .json(&serde_json::json!({ "path": path, "format": "json", "args": args }))
        .send()
        .await?
        .error_for_status()?;
    let body = response.text().await?;
    let response = serde_json::from_str::<ConvexResponse<T>>(&body).map_err(|error| {
        anyhow::anyhow!(
            "{path} returned an invalid response: {error}; body={}",
            body.chars().take(500).collect::<String>()
        )
    })?;
    anyhow::ensure!(
        response.status == "success",
        "{}",
        response
            .error_message
            .unwrap_or_else(|| format!("{path} failed"))
    );
    response
        .value
        .ok_or_else(|| anyhow::anyhow!("{path} returned no value"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredResource {
    pub local_resource_id: String,
    pub relative_path: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_hash: Option<String>,
    pub native_format: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredRegistration {
    #[serde(default)]
    pub work_id: Option<String>,
    #[serde(default)]
    pub replica_id: Option<String>,
    #[serde(default)]
    pub revision: Option<String>,
    pub payload_hash: Option<String>,
    #[serde(default)]
    pub needs_payload: bool,
    #[serde(default)]
    pub skipped: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PayloadUploadIntent {
    deduplicated: bool,
    upload_url: Option<String>,
    payload_ref: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimedWrite {
    pub request_id: String,
    pub replica_id: String,
    pub grant_id: String,
    pub local_resource_id: String,
    pub relative_path: String,
    pub base_revision: String,
    pub target_revision: String,
    pub content_hash: String,
    pub idempotency_key: String,
    pub payload_url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReplicaMigrationPage {
    pub continue_cursor: Option<String>,
    pub is_done: bool,
    pub scanned: f64,
    pub missing: f64,
    pub inserted: f64,
    pub duplicates: f64,
    pub local_only: f64,
}

pub async fn migrate_cloud_replica_page(
    deployment_url: &str,
    credential: &str,
    cursor: Option<&str>,
    dry_run: bool,
) -> anyhow::Result<ReplicaMigrationPage> {
    let mut args = serde_json::json!({
        "credential": credential,
        "numItems": 100,
        "dryRun": dry_run,
    });
    if let Some(cursor) = cursor {
        args.as_object_mut()
            .expect("migration args are an object")
            .insert("cursor".into(), cursor.into());
    }
    mutation(deployment_url, "bridgeSync:migrateCloudReplicaPage", args).await
}

pub async fn register_mount(
    deployment_url: &str,
    credential: &str,
    root_label: &str,
    grant_id: &str,
    file_count: usize,
    double_sync_risk: bool,
) -> anyhow::Result<String> {
    mutation(deployment_url, "bridgeSync:registerMount", serde_json::json!({ "credential": credential, "rootLabel": root_label, "grantId": grant_id, "fileCount": file_count, "doubleSyncRisk": double_sync_risk })).await
}

pub async fn discover_resource(
    deployment_url: &str,
    credential: &str,
    mount_id: &str,
    resource: &DiscoveredResource,
) -> anyhow::Result<DiscoveredRegistration> {
    let mut args = serde_json::to_value(resource)?;
    let object = args
        .as_object_mut()
        .ok_or_else(|| anyhow::anyhow!("resource payload is not an object"))?;
    object.insert("credential".into(), credential.into());
    object.insert("mountId".into(), mount_id.into());
    mutation(deployment_url, "bridgeSync:discoverResource", args).await
}

pub async fn upload_resource_payload(
    deployment_url: &str,
    credential: &str,
    replica_id: &str,
    bytes: &[u8],
    hash: &str,
    media_type: &str,
) -> anyhow::Result<String> {
    anyhow::ensure!(
        bytes.len() <= 100 * 1024 * 1024,
        "payload exceeds the 100 MB safety ceiling"
    );
    let intent: PayloadUploadIntent = mutation(
        deployment_url,
        "bridgeSync:beginPayloadUpload",
        serde_json::json!({
            "credential": credential,
            "replicaId": replica_id,
            "hash": hash,
            "bytes": bytes.len(),
            "mediaType": media_type,
        }),
    )
    .await?;
    let (storage_id, payload_ref) = if intent.deduplicated {
        (None, intent.payload_ref)
    } else {
        let upload_url = intent
            .upload_url
            .ok_or_else(|| anyhow::anyhow!("payload upload URL missing"))?;
        let response = reqwest::Client::new()
            .post(upload_url)
            .header(reqwest::header::CONTENT_TYPE, media_type)
            .body(bytes.to_vec())
            .send()
            .await?
            .error_for_status()?;
        let stored: serde_json::Value = response.json().await?;
        let storage_id = stored
            .get("storageId")
            .and_then(|value| value.as_str())
            .ok_or_else(|| anyhow::anyhow!("payload storage response did not include storageId"))?;
        (Some(storage_id.to_owned()), None)
    };
    let mut args = serde_json::json!({
        "credential": credential,
        "replicaId": replica_id,
        "hash": hash,
        "bytes": bytes.len(),
        "mediaType": media_type,
    });
    if let Some(storage_id) = storage_id {
        args.as_object_mut()
            .expect("payload commit args are an object")
            .insert("storageId".into(), storage_id.into());
    }
    if let Some(payload_ref) = payload_ref {
        args.as_object_mut()
            .expect("payload commit args are an object")
            .insert("payloadRef".into(), payload_ref.into());
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct CommittedPayload {
        payload_ref: String,
    }
    let committed: CommittedPayload =
        mutation(deployment_url, "bridgeSync:commitPayloadUpload", args).await?;
    Ok(committed.payload_ref)
}

pub async fn claim_write(
    deployment_url: &str,
    credential: &str,
) -> anyhow::Result<Option<ClaimedWrite>> {
    #[derive(Deserialize)]
    struct ClaimWriteResponse {
        request: Option<ClaimedWrite>,
    }
    let response: ClaimWriteResponse = mutation(
        deployment_url,
        "bridgeSync:claimWrite",
        serde_json::json!({ "credential": credential }),
    )
    .await?;
    Ok(response.request)
}

pub async fn complete_write(
    deployment_url: &str,
    credential: &str,
    request_id: &str,
    outcome: &str,
    actual_revision: Option<&str>,
    error: Option<(&str, &str)>,
) -> anyhow::Result<()> {
    let mut args = serde_json::json!({
        "credential": credential,
        "requestId": request_id,
        "outcome": outcome,
    });
    let object = args
        .as_object_mut()
        .expect("complete write args are an object");
    if let Some(actual_revision) = actual_revision {
        object.insert("actualRevision".into(), actual_revision.into());
    }
    if let Some((code, message)) = error {
        object.insert("errorCode".into(), code.into());
        object.insert(
            "errorMessage".into(),
            message.chars().take(500).collect::<String>().into(),
        );
    }
    let _: serde_json::Value = mutation(deployment_url, "bridgeSync:completeWrite", args).await?;
    Ok(())
}

pub async fn detach_mount(
    deployment_url: &str,
    credential: &str,
    grant_id: &str,
) -> anyhow::Result<bool> {
    mutation(
        deployment_url,
        "bridgeSync:detachGrant",
        serde_json::json!({ "credential": credential, "grantId": grant_id }),
    )
    .await
}

pub async fn exchange_pairing(
    deployment_url: &str,
    offer: &PairingOffer,
    device_name: &str,
) -> anyhow::Result<PairingExchange> {
    mutation(
        deployment_url,
        "bridge:confirmPairing",
        serde_json::json!({
                "challenge": offer.challenge, "shortCode": offer.short_code,
                "deviceName": device_name, "platform": std::env::consts::OS,
                "appVersion": env!("CARGO_PKG_VERSION"), "protocolVersion": crate::PROTOCOL_VERSION
        }),
    )
    .await
}

pub async fn resume_pairing(
    deployment_url: &str,
    credential: &str,
    offer: &PairingOffer,
    device_name: &str,
) -> anyhow::Result<PairingResume> {
    mutation(
        deployment_url,
        "bridge:resumePairing",
        serde_json::json!({
            "credential": credential,
            "challenge": offer.challenge,
            "shortCode": offer.short_code,
            "deviceName": device_name,
            "platform": std::env::consts::OS,
            "appVersion": env!("CARGO_PKG_VERSION"),
            "protocolVersion": crate::PROTOCOL_VERSION
        }),
    )
    .await
}

pub async fn drain_cloud_queue(
    journal: &Journal,
    deployment_url: &str,
    credential: &str,
) -> anyhow::Result<usize> {
    let client = reqwest::Client::new();
    let mut handled = 0;
    for item in journal.due_queue(100)? {
        let mut args: serde_json::Value = serde_json::from_str(&item.payload)?;
        let object = args
            .as_object_mut()
            .ok_or_else(|| anyhow::anyhow!("queued payload is not an object"))?;
        object.insert(
            "credential".into(),
            serde_json::Value::String(credential.to_owned()),
        );
        let result = client.post(format!("{}/api/mutation", deployment_url.trim_end_matches('/'))).json(&serde_json::json!({ "path": "bridgeSync:reportRevision", "format": "json", "args": args })).send().await;
        match result {
            Ok(response) if response.status().is_success() => {
                let body: serde_json::Value = response.json().await?;
                if body.get("status").and_then(|value| value.as_str()) == Some("success") {
                    journal.acknowledge_queue(item.id)?;
                    handled += 1;
                } else {
                    journal.retry_queue(item.id, Duration::from_secs(60))?;
                }
            }
            _ => {
                let delay =
                    Duration::from_millis(500).saturating_mul(1_u32 << item.attempts.min(7));
                journal.retry_queue(item.id, delay.min(Duration::from_secs(60)))?;
            }
        }
    }
    Ok(handled)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stale_cloud_revision_is_a_conflict_not_last_write_wins() {
        assert!(accept_cloud_result(CloudResult::StaleRevision).is_err());
    }
    #[test]
    fn backoff_is_bounded_and_resets() {
        let mut b = Backoff::default();
        for _ in 0..30 {
            assert!(b.next_delay() <= Duration::from_secs(60));
        }
        b.success();
        assert_eq!(b.next_delay(), Duration::from_millis(500));
    }
}
