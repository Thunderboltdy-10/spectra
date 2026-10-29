use crate::journal::{Journal, QueueItem, ResourceRecord};
use crate::platform::Platform;
use crate::protocol::PairingOffer;
use crate::retry::retry_delay_ms;
use crate::watcher::office_lock_exists_with;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;

const CLOUD_CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const CLOUD_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
fn cloud_client() -> anyhow::Result<reqwest::Client> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client.clone());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(CLOUD_CONNECT_TIMEOUT)
        .build()?;
    let _ = CLIENT.set(client.clone());
    Ok(CLIENT.get().cloned().unwrap_or(client))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudResult {
    Applied,
    AlreadyApplied,
    StaleRevision,
    Retryable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClaimPrecondition {
    Ready { revision: String },
    Missing,
    Locked,
    Stale { revision: String },
    Unreadable { message: String },
}

pub fn inspect_claim_target<P: Platform>(
    platform: &P,
    path: &Path,
    base_revision: &str,
) -> ClaimPrecondition {
    inspect_write_target(platform, path, base_revision, None)
}

/// An exact target hash may be a write whose acknowledgement was lost. Let it
/// reach SafeWriter, which rechecks the durable bytes and never rewrites them.
pub fn inspect_write_target<P: Platform>(
    platform: &P,
    path: &Path,
    base_revision: &str,
    target_revision: Option<&str>,
) -> ClaimPrecondition {
    if !path.exists() {
        // A `new:<work-id>` base is the explicit sentinel written when
        // Spectra asks Bridge to create a second local copy. Absence is the
        // expected starting state for that request; any existing target still
        // hashes to a different revision and is refused below.
        if base_revision
            .strip_prefix("new:")
            .is_some_and(|work_id| !work_id.is_empty())
        {
            return ClaimPrecondition::Ready {
                revision: base_revision.to_owned(),
            };
        }
        return ClaimPrecondition::Missing;
    }
    if office_lock_exists_with(platform, path) {
        return ClaimPrecondition::Locked;
    }
    match platform.is_locked(path) {
        Ok(true) => return ClaimPrecondition::Locked,
        Err(error) => {
            return ClaimPrecondition::Unreadable {
                message: error.to_string(),
            };
        }
        Ok(false) => {}
    }
    match crate::fs::sha256_file(path) {
        Ok(revision) if revision == base_revision || target_revision == Some(revision.as_str()) => {
            ClaimPrecondition::Ready { revision }
        }
        Ok(revision) => ClaimPrecondition::Stale { revision },
        Err(error) => ClaimPrecondition::Unreadable {
            message: error.to_string(),
        },
    }
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
            floor: Duration::from_secs(1),
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

    pub fn delay_for_attempt(attempts: u32, key: &str) -> Duration {
        Duration::from_millis(retry_delay_ms(attempts, key))
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

/// The cloud answered and said no: a function threw, or storage refused the
/// request itself. Sending the same request again gets the same answer, so a
/// queue holding it should give up instead of retrying forever. Network
/// failures, timeouts and server errors are never this.
#[derive(Debug)]
pub struct CloudRefused(pub String);

impl std::fmt::Display for CloudRefused {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for CloudRefused {}

const CONVEX_FUNCTION_FAILED: u16 = 560;

/// A 4xx other than a timeout or a rate limit names the request, not the moment.
fn status_refuses(status: reqwest::StatusCode) -> bool {
    status.is_client_error()
        && status != reqwest::StatusCode::REQUEST_TIMEOUT
        && status != reqwest::StatusCode::TOO_MANY_REQUESTS
}

async fn mutation<T: for<'de> Deserialize<'de>>(
    deployment_url: &str,
    path: &str,
    args: serde_json::Value,
) -> anyhow::Result<T> {
    let response = cloud_client()?
        .post(format!(
            "{}/api/mutation",
            deployment_url.trim_end_matches('/')
        ))
        .timeout(CLOUD_REQUEST_TIMEOUT)
        .json(&serde_json::json!({ "path": path, "format": "json", "args": args }))
        .send()
        .await
        .map_err(|error| {
            let phase = if error.is_timeout() {
                "timed out"
            } else if error.is_connect() {
                "could not connect"
            } else {
                "failed"
            };
            anyhow::anyhow!("{path} request {phase}: {error}")
        })?;
    // Convex answers a function that threw with 560 and the usual error body.
    let function_failed = response.status().as_u16() == CONVEX_FUNCTION_FAILED;
    let response = if function_failed {
        response
    } else {
        response
            .error_for_status()
            .map_err(|error| anyhow::anyhow!("{path} returned an HTTP error: {error}"))?
    };
    let body = response
        .text()
        .await
        .map_err(|error| anyhow::anyhow!("{path} response could not be read: {error}"))?;
    if function_failed {
        let message = serde_json::from_str::<ConvexResponse<serde_json::Value>>(&body)
            .ok()
            .and_then(|response| response.error_message)
            .unwrap_or_else(|| format!("{path} failed"));
        return Err(CloudRefused(message).into());
    }
    let response = serde_json::from_str::<ConvexResponse<T>>(&body).map_err(|error| {
        anyhow::anyhow!(
            "{path} returned an invalid response: {error}; body={}",
            body.chars().take(500).collect::<String>()
        )
    })?;
    if response.status != "success" {
        return Err(CloudRefused(
            response
                .error_message
                .unwrap_or_else(|| format!("{path} failed")),
        )
        .into());
    }
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
struct DiscoveryPageResponse {
    registrations: Vec<DiscoveredRegistration>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReportedChange {
    pub journal_id: String,
    pub resource_id: String,
    pub op: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_relative_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision_before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_format: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedChangeEnvelope {
    pub grant_id: String,
    pub mount_id: String,
    pub change: ReportedChange,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReportChangeResult {
    pub journal_id: String,
    pub state: String,
    #[serde(default)]
    pub replica_id: Option<String>,
    #[serde(default)]
    pub needs_payload: bool,
    #[serde(default)]
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReportChangesResponse {
    results: Vec<ReportChangeResult>,
}

#[derive(Debug, Clone)]
pub struct DeliveredChange {
    pub item: QueueItem,
    pub envelope: QueuedChangeEnvelope,
    pub result: ReportChangeResult,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PayloadUploadIntent {
    deduplicated: bool,
    upload_url: Option<String>,
    payload_ref: Option<String>,
}

fn deserialize_claim_generation<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    let Some(number) = Option::<serde_json::Number>::deserialize(deserializer)? else {
        return Ok(None);
    };
    if let Some(integer) = number.as_u64() {
        return Ok(Some(integer));
    }
    let Some(value) = number.as_f64() else {
        return Err(serde::de::Error::custom(
            "claimGeneration must be a nonnegative integer",
        ));
    };
    if value.is_finite()
        && value >= 0.0
        && value.fract() == 0.0
        && value < 18_446_744_073_709_551_616.0
    {
        Ok(Some(value as u64))
    } else {
        Err(serde::de::Error::custom(
            "claimGeneration must be a nonnegative integer",
        ))
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimedWrite {
    pub request_id: String,
    #[serde(default)]
    pub operation_id: Option<String>,
    pub replica_id: String,
    pub grant_id: String,
    pub local_resource_id: String,
    pub relative_path: String,
    pub base_revision: String,
    pub target_revision: String,
    pub content_hash: String,
    pub idempotency_key: String,
    #[serde(default, deserialize_with = "deserialize_claim_generation")]
    pub claim_generation: Option<u64>,
    #[serde(default)]
    pub claim_token: Option<String>,
    #[serde(default)]
    pub native_receipt: Option<serde_json::Value>,
    pub payload_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteCompletion {
    pub state: String,
    #[serde(default)]
    pub ignored: bool,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimedFsRequest {
    pub request_id: String,
    pub grant_id: String,
    pub local_resource_id: String,
    pub kind: String,
    pub source_relative_path: String,
    pub target_relative_path: Option<String>,
    pub idempotency_key: String,
    #[serde(default)]
    pub base_revision: Option<String>,
    #[serde(default, deserialize_with = "deserialize_claim_generation")]
    pub claim_generation: Option<u64>,
    #[serde(default)]
    pub claim_token: Option<String>,
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
    root_key: &str,
    scan_id: &str,
    file_count: usize,
    double_sync_risk: bool,
    owner_lock_paths: &[String],
    selected_file: Option<&str>,
) -> anyhow::Result<String> {
    let mut args = serde_json::json!({ "credential": credential, "rootLabel": root_label, "grantId": grant_id, "rootKey": root_key, "scanId": scan_id, "fileCount": file_count, "doubleSyncRisk": double_sync_risk, "ownerLockPaths": owner_lock_paths });
    if let Some(name) = selected_file {
        args["selectedFile"] = name.into();
    }
    mutation(deployment_url, "bridgeSync:registerMount", args).await
}

pub async fn discover_resources_page(
    deployment_url: &str,
    credential: &str,
    mount_id: &str,
    resources: &[DiscoveredResource],
) -> anyhow::Result<Vec<DiscoveredRegistration>> {
    anyhow::ensure!(
        !resources.is_empty() && resources.len() <= 100,
        "discovery page must contain 1..=100 resources"
    );
    let response: DiscoveryPageResponse = mutation(
        deployment_url,
        "bridgeSync:discoverResourcesPage",
        serde_json::json!({
            "credential": credential,
            "mountId": mount_id,
            "resources": resources,
        }),
    )
    .await?;
    anyhow::ensure!(
        response.registrations.len() == resources.len(),
        "discovery page response length did not match the request"
    );
    Ok(response.registrations)
}

pub async fn report_changes(
    deployment_url: &str,
    credential: &str,
    mount_id: &str,
    changes: &[ReportedChange],
) -> anyhow::Result<Vec<ReportChangeResult>> {
    anyhow::ensure!(
        !changes.is_empty() && changes.len() <= 100,
        "change batch must contain 1..=100 changes"
    );
    let response: ReportChangesResponse = mutation(
        deployment_url,
        "bridgeSync:reportChanges",
        serde_json::json!({
            "credential": credential,
            "mountId": mount_id,
            "changes": changes,
        }),
    )
    .await?;
    Ok(response.results)
}

pub async fn reconcile_missing_resources(
    deployment_url: &str,
    credential: &str,
    mount_id: &str,
    scan_id: &str,
) -> anyhow::Result<()> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ReconcilePage {
        continue_cursor: Option<String>,
        is_done: bool,
    }
    let mut cursor: Option<String> = None;
    loop {
        let mut args = serde_json::json!({
            "credential": credential,
            "mountId": mount_id,
            "scanId": scan_id,
        });
        if let Some(value) = cursor.as_ref() {
            args.as_object_mut()
                .expect("reconcile args are an object")
                .insert("cursor".into(), serde_json::Value::String(value.clone()));
        }
        let page: ReconcilePage =
            mutation(deployment_url, "bridgeSync:reconcileMissingResources", args).await?;
        if page.is_done {
            break;
        }
        cursor = page.continue_cursor;
        anyhow::ensure!(
            cursor.is_some(),
            "missing-resource reconciliation did not advance"
        );
    }
    Ok(())
}

/// The largest native package the cloud accepts (`bridgeSync.beginPayloadUpload`).
pub const MAX_NATIVE_PAYLOAD_BYTES: u64 = 100 * 1024 * 1024;

pub async fn upload_resource_payload(
    deployment_url: &str,
    credential: &str,
    replica_id: &str,
    bytes: &[u8],
    hash: &str,
    media_type: &str,
) -> anyhow::Result<String> {
    anyhow::ensure!(
        bytes.len() as u64 <= MAX_NATIVE_PAYLOAD_BYTES,
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
        let response = cloud_client()?
            .post(upload_url)
            .timeout(crate::retry::bridge_payload_transfer_timeout(
                bytes.len() as u64
            ))
            .header(reqwest::header::CONTENT_TYPE, media_type)
            .body(bytes.to_vec())
            .send()
            .await?;
        if status_refuses(response.status()) {
            return Err(CloudRefused(format!(
                "storage refused the upload ({})",
                response.status()
            ))
            .into());
        }
        let response = response.error_for_status()?;
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimedPayloadUpload {
    pub replica_id: String,
    pub grant_id: String,
    pub local_resource_id: String,
    pub relative_path: String,
    pub native_format: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadUploadPage {
    pub request: Option<ClaimedPayloadUpload>,
    #[serde(default)]
    pub has_more: bool,
}

pub async fn claim_pending_payload_upload(
    deployment_url: &str,
    credential: &str,
) -> anyhow::Result<PayloadUploadPage> {
    mutation(
        deployment_url,
        "bridgeSync:claimPendingPayloadUpload",
        serde_json::json!({ "credential": credential }),
    )
    .await
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

pub async fn refresh_write_claim(
    deployment_url: &str,
    credential: &str,
    request: &ClaimedWrite,
) -> anyhow::Result<bool> {
    #[derive(Deserialize)]
    struct Response {
        valid: bool,
    }
    let mut args = serde_json::json!({ "credential": credential, "requestId": request.request_id });
    if let Some(generation) = request.claim_generation {
        args["claimGeneration"] = generation.into();
    }
    if let Some(token) = request.claim_token.as_deref() {
        args["claimToken"] = token.into();
    }
    let result: Response = mutation(deployment_url, "bridgeSync:refreshWriteClaim", args).await?;
    Ok(result.valid)
}

pub async fn complete_write(
    deployment_url: &str,
    credential: &str,
    request_id: &str,
    outcome: &str,
    actual_revision: Option<&str>,
    error: Option<(&str, &str)>,
) -> anyhow::Result<WriteCompletion> {
    complete_write_with_claim(
        deployment_url,
        credential,
        request_id,
        outcome,
        actual_revision,
        error,
        None,
        None,
    )
    .await
}

pub async fn complete_write_with_claim(
    deployment_url: &str,
    credential: &str,
    request_id: &str,
    outcome: &str,
    actual_revision: Option<&str>,
    error: Option<(&str, &str)>,
    claim_generation: Option<u64>,
    claim_token: Option<&str>,
) -> anyhow::Result<WriteCompletion> {
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
    if let Some(claim_generation) = claim_generation {
        args.as_object_mut()
            .expect("complete write args are an object")
            .insert("claimGeneration".into(), claim_generation.into());
    }
    if let Some(claim_token) = claim_token {
        args.as_object_mut()
            .expect("complete write args are an object")
            .insert("claimToken".into(), claim_token.into());
    }
    mutation(deployment_url, "bridgeSync:completeWrite", args).await
}

pub async fn claim_fs_request(
    deployment_url: &str,
    credential: &str,
) -> anyhow::Result<Option<ClaimedFsRequest>> {
    #[derive(Deserialize)]
    struct Response {
        request: Option<ClaimedFsRequest>,
    }
    let response: Response = mutation(
        deployment_url,
        "bridgeStructure:claim",
        serde_json::json!({ "credential": credential, "supportsFencing": true }),
    )
    .await?;
    Ok(response.request)
}

pub async fn complete_fs_request(
    deployment_url: &str,
    credential: &str,
    request_id: &str,
    outcome: &str,
    actual_relative_path: Option<&str>,
    error: Option<(&str, &str)>,
) -> anyhow::Result<()> {
    complete_fs_request_with_claim(
        deployment_url,
        credential,
        request_id,
        outcome,
        actual_relative_path,
        error,
        None,
        None,
    )
    .await?;
    Ok(())
}

pub async fn complete_fs_request_with_claim(
    deployment_url: &str,
    credential: &str,
    request_id: &str,
    outcome: &str,
    actual_relative_path: Option<&str>,
    error: Option<(&str, &str)>,
    claim_generation: Option<u64>,
    claim_token: Option<&str>,
) -> anyhow::Result<WriteCompletion> {
    let mut args = serde_json::json!({ "credential": credential, "requestId": request_id, "outcome": outcome });
    let object = args.as_object_mut().unwrap();
    if let Some(path) = actual_relative_path {
        object.insert("actualRelativePath".into(), path.into());
    }
    if let Some(generation) = claim_generation {
        object.insert("claimGeneration".into(), generation.into());
    }
    if let Some(token) = claim_token {
        object.insert("claimToken".into(), token.into());
    }
    if let Some((code, message)) = error {
        object.insert("errorCode".into(), code.into());
        object.insert(
            "errorMessage".into(),
            message.chars().take(500).collect::<String>().into(),
        );
    }
    mutation(deployment_url, "bridgeStructure:complete", args).await
}

pub async fn refresh_structure_claim(
    deployment_url: &str,
    credential: &str,
    request: &ClaimedFsRequest,
) -> anyhow::Result<bool> {
    #[derive(Deserialize)]
    struct Response {
        valid: bool,
    }
    let mut args = serde_json::json!({ "credential": credential, "requestId": request.request_id });
    if let Some(generation) = request.claim_generation {
        args["claimGeneration"] = generation.into();
    }
    if let Some(token) = request.claim_token.as_deref() {
        args["claimToken"] = token.into();
    }
    let result: Response = mutation(deployment_url, "bridgeStructure:refreshClaim", args).await?;
    Ok(result.valid)
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

pub async fn set_mount_availability(
    deployment_url: &str,
    credential: &str,
    grant_id: &str,
    available: bool,
) -> anyhow::Result<()> {
    let _: serde_json::Value = mutation(deployment_url, "bridgeSync:setMountAvailability", serde_json::json!({ "credential": credential, "grantId": grant_id, "available": available })).await?;
    Ok(())
}

pub async fn exchange_pairing(
    deployment_url: &str,
    offer: &PairingOffer,
    device_name: &str,
    installation_id: &str,
) -> anyhow::Result<PairingExchange> {
    mutation(
        deployment_url,
        "bridge:confirmPairing",
        serde_json::json!({
                "challenge": offer.challenge, "shortCode": offer.short_code,
                "installationId": installation_id,
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
    installation_id: &str,
) -> anyhow::Result<PairingResume> {
    mutation(
        deployment_url,
        "bridge:resumePairing",
        serde_json::json!({
            "credential": credential,
            "challenge": offer.challenge,
            "shortCode": offer.short_code,
            "installationId": installation_id,
            "deviceName": device_name,
            "platform": std::env::consts::OS,
            "appVersion": env!("CARGO_PKG_VERSION"),
            "protocolVersion": crate::PROTOCOL_VERSION
        }),
    )
    .await
}

/// What this computer tells Spectra about itself, so other devices can show
/// it: whether syncing is paused, how many folders it serves, the problem it
/// has (a stable code, worded by Spectra) and when it last finished a pass.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeviceHealthReport {
    pub paused: bool,
    pub folders: usize,
    pub problem: Option<String>,
    /// The folder the problem is about, as the person names it.
    pub problem_folder: Option<String>,
    pub last_sync_at: Option<u64>,
}

pub async fn report_health(
    deployment_url: &str,
    credential: &str,
    report: &DeviceHealthReport,
) -> anyhow::Result<()> {
    let _: serde_json::Value = mutation(
        deployment_url,
        "bridge:reportHealth",
        health_args(credential, report),
    )
    .await?;
    Ok(())
}

/// Convex optional arguments are absent, never null.
fn health_args(credential: &str, report: &DeviceHealthReport) -> serde_json::Value {
    let mut args = serde_json::json!({
        "credential": credential,
        "paused": report.paused,
        "folders": report.folders,
        "appVersion": env!("CARGO_PKG_VERSION"),
    });
    if let Some(problem) = &report.problem {
        args["problem"] = problem.clone().into();
    }
    if let Some(folder) = &report.problem_folder {
        args["problemFolder"] = folder.clone().into();
    }
    if let Some(last_sync_at) = report.last_sync_at {
        args["lastSyncAt"] = last_sync_at.into();
    }
    args
}

/// A lock/unlock report has no content hash. Comparing it to the stored hash
/// would mark every Word-open event as superseded and Convex would never hear
/// that the file is held.
pub fn queued_change_still_current(
    change: &ReportedChange,
    resource: Option<&ResourceRecord>,
) -> bool {
    let Some(resource) = resource else {
        return false;
    };
    match change.op.as_str() {
        "unavailable" => !resource.available,
        "locked" | "unlocked" => {
            resource.available
                && change
                    .relative_path
                    .as_deref()
                    .map(|path| path == resource.path_key)
                    .unwrap_or(true)
        }
        _ => {
            resource.available
                && change.relative_path.as_deref() == Some(resource.path_key.as_str())
                && change.hash.as_deref() == resource.content_hash.as_deref()
        }
    }
}

pub async fn drain_cloud_queue(
    journal: &Journal,
    deployment_url: &str,
    credential: &str,
) -> anyhow::Result<Vec<DeliveredChange>> {
    drain_cloud_queue_holding(journal, deployment_url, credential, &HashSet::new()).await
}

/// How long a change from a paused folder waits before it is looked at again.
pub const PAUSED_FOLDER_RECHECK: Duration = Duration::from_secs(15);

/// Drains outbound changes, keeping those of paused folders (by local grant)
/// in the journal untouched until the folder resumes.
pub async fn drain_cloud_queue_holding(
    journal: &Journal,
    deployment_url: &str,
    credential: &str,
    paused_grants: &HashSet<String>,
) -> anyhow::Result<Vec<DeliveredChange>> {
    let mut grouped = BTreeMap::<String, Vec<(QueueItem, QueuedChangeEnvelope)>>::new();
    for item in journal.due_queue(100)? {
        if !paused_grants.is_empty()
            && serde_json::from_str::<QueuedChangeEnvelope>(&item.payload)
                .is_ok_and(|envelope| paused_grants.contains(&envelope.grant_id))
        {
            journal.defer_queue(item.id, PAUSED_FOLDER_RECHECK)?;
            continue;
        }
        if item.direction != "outbound-change" {
            journal.fail_queue(
                &item,
                "unknown-queue-direction",
                "Unsupported outbound journal entry",
            )?;
            continue;
        }
        match serde_json::from_str::<QueuedChangeEnvelope>(&item.payload) {
            Ok(envelope) => {
                let current = journal.resource_by_id(&envelope.change.resource_id)?;
                let still_current = queued_change_still_current(&envelope.change, current.as_ref());
                if !still_current {
                    journal.fail_queue(
                        &item,
                        "change-superseded",
                        "A newer local file event replaced this queued change",
                    )?;
                    continue;
                }
                grouped
                    .entry(envelope.mount_id.clone())
                    .or_default()
                    .push((item, envelope));
            }
            Err(error) => journal.fail_queue(
                &item,
                "invalid-queued-change",
                &error.to_string().chars().take(500).collect::<String>(),
            )?,
        }
    }
    let mut delivered = Vec::new();
    for (mount_id, batch) in grouped {
        let changes = batch
            .iter()
            .map(|(_, envelope)| envelope.change.clone())
            .collect::<Vec<_>>();
        let results = match report_changes(deployment_url, credential, &mount_id, &changes).await {
            Ok(results) => results,
            Err(error) => {
                let message = error.to_string();
                for (item, _) in &batch {
                    journal.retry_queue(
                        item.id,
                        Backoff::delay_for_attempt(item.attempts, &item.op_id),
                    )?;
                }
                // Cloud mount revoked/detached while local grant still looks Ready.
                // Surface so the app loop can re-run registerMount via sync_grant
                // instead of silently backing off forever under "Changes queued safely".
                if message.contains("MOUNT_NOT_ACTIVE") {
                    anyhow::bail!("MOUNT_NOT_ACTIVE");
                }
                continue;
            }
        };
        let by_journal = results
            .into_iter()
            .map(|result| (result.journal_id.clone(), result))
            .collect::<BTreeMap<_, _>>();
        for (item, envelope) in batch {
            match by_journal.get(&envelope.change.journal_id) {
                Some(result) if result.error_code.is_none() => delivered.push(DeliveredChange {
                    item,
                    envelope,
                    result: result.clone(),
                }),
                Some(result) => journal.fail_queue(
                    &item,
                    result.error_code.as_deref().unwrap_or("change-rejected"),
                    "The cloud rejected this file change",
                )?,
                None => journal.retry_queue(
                    item.id,
                    Backoff::delay_for_attempt(item.attempts, &item.op_id),
                )?,
            }
        }
    }
    Ok(delivered)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Answers one request with `status` and `body`, then closes.
    async fn answer_once(status: &'static str, body: &'static str) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0_u8; 16 * 1024];
            let _ = socket.read(&mut request).await;
            let response = format!(
                "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = socket.write_all(response.as_bytes()).await;
        });
        format!("http://{address}")
    }

    async fn refusal_of(deployment: &str) -> anyhow::Error {
        upload_resource_payload(deployment, "credential", "replica", b"x", "h", "text/plain")
            .await
            .unwrap_err()
    }

    #[tokio::test]
    async fn a_function_that_threw_is_a_refusal_with_its_own_message() {
        let deployment = answer_once(
            "560 Function Failed",
            r#"{"status":"error","errorMessage":"PAYLOAD_HASH_QUARANTINED"}"#,
        )
        .await;
        let error = refusal_of(&deployment).await;
        let refused = error.downcast_ref::<CloudRefused>().expect("a refusal");
        assert_eq!(refused.0, "PAYLOAD_HASH_QUARANTINED");
    }

    #[tokio::test]
    async fn server_errors_and_lost_connections_stay_retryable() {
        let deployment = answer_once("503 Service Unavailable", "{}").await;
        let error = refusal_of(&deployment).await;
        assert!(error.downcast_ref::<CloudRefused>().is_none());
        let error = refusal_of("http://127.0.0.1:1").await;
        assert!(error.downcast_ref::<CloudRefused>().is_none());
    }

    #[test]
    fn only_request_shaped_client_errors_refuse() {
        assert!(status_refuses(reqwest::StatusCode::FORBIDDEN));
        assert!(status_refuses(reqwest::StatusCode::PAYLOAD_TOO_LARGE));
        assert!(!status_refuses(reqwest::StatusCode::TOO_MANY_REQUESTS));
        assert!(!status_refuses(reqwest::StatusCode::REQUEST_TIMEOUT));
        assert!(!status_refuses(reqwest::StatusCode::BAD_GATEWAY));
    }

    #[test]
    fn claimed_write_accepts_convex_float_encoded_integral_lease_generation() {
        let response = serde_json::json!({
            "requestId": "request-a",
            "replicaId": "replica-a",
            "grantId": "grant-a",
            "localResourceId": "resource-a",
            "relativePath": "file.docx",
            "baseRevision": "base",
            "targetRevision": "target",
            "contentHash": "target",
            "idempotencyKey": "write-a",
            "claimGeneration": 25.0,
            "claimToken": "lease-token",
            "nativeReceipt": null,
            "payloadUrl": "http://127.0.0.1:3002/api/storage/test"
        });
        let claimed: ClaimedWrite = serde_json::from_value(response).unwrap();
        assert_eq!(claimed.claim_generation, Some(25));
        assert_eq!(claimed.claim_token.as_deref(), Some("lease-token"));

        for generation in [25.5, -1.0] {
            let invalid = serde_json::json!({
                "requestId": "request-a",
                "replicaId": "replica-a",
                "grantId": "grant-a",
                "localResourceId": "resource-a",
                "relativePath": "file.docx",
                "baseRevision": "base",
                "targetRevision": "target",
                "contentHash": "target",
                "idempotencyKey": "write-a",
                "claimGeneration": generation,
                "claimToken": "lease-token",
                "nativeReceipt": null,
                "payloadUrl": "http://127.0.0.1:3002/api/storage/test"
            });
            assert!(serde_json::from_value::<ClaimedWrite>(invalid).is_err());
        }
    }

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
        assert_eq!(b.next_delay(), Duration::from_secs(1));
    }

    #[tokio::test]
    async fn superseded_queue_entry_is_failed_without_contacting_cloud() {
        let journal = Journal::in_memory().unwrap();
        let operation = journal
            .begin_intent(
                "superseded",
                "cloud.report-change",
                Some("lr_dead"),
                None,
                None,
            )
            .unwrap();
        let envelope = QueuedChangeEnvelope {
            grant_id: "grant_dead".into(),
            mount_id: "mount_dead".into(),
            change: ReportedChange {
                journal_id: operation.op_id.clone(),
                resource_id: "lr_dead".into(),
                op: "unavailable".into(),
                relative_path: Some("old.docx".into()),
                previous_relative_path: None,
                hash: None,
                revision_before: None,
                size: None,
                native_format: None,
            },
        };
        journal
            .enqueue(
                &operation.op_id,
                "outbound-change",
                &serde_json::to_string(&envelope).unwrap(),
            )
            .unwrap();

        let delivered = drain_cloud_queue(&journal, "http://127.0.0.1:1", "unused")
            .await
            .unwrap();
        assert!(delivered.is_empty());
        assert_eq!(
            journal.by_key("superseded").unwrap().unwrap().state,
            crate::journal::OpState::Failed
        );
    }

    #[test]
    fn health_report_omits_what_it_does_not_know() {
        let args = health_args(
            "credential",
            &DeviceHealthReport {
                paused: true,
                folders: 2,
                problem: None,
                problem_folder: None,
                last_sync_at: None,
            },
        );
        assert_eq!(args["paused"], true);
        assert_eq!(args["folders"], 2);
        assert!(args.get("problem").is_none());
        assert!(args.get("lastSyncAt").is_none());
        let args = health_args(
            "credential",
            &DeviceHealthReport {
                problem: Some("folder-unavailable".into()),
                problem_folder: Some("Documents › Biology".into()),
                last_sync_at: Some(5),
                ..DeviceHealthReport::default()
            },
        );
        assert_eq!(args["problem"], "folder-unavailable");
        assert_eq!(args["problemFolder"], "Documents › Biology");
        assert_eq!(args["lastSyncAt"], 5);
    }

    #[tokio::test]
    async fn a_paused_folder_keeps_its_changes_queued_without_counting_attempts() {
        let journal = Journal::in_memory().unwrap();
        let operation = journal
            .begin_intent("held", "cloud.report-change", Some("lr_held"), None, None)
            .unwrap();
        let envelope = QueuedChangeEnvelope {
            grant_id: "grant_paused".into(),
            mount_id: "mount_paused".into(),
            change: ReportedChange {
                journal_id: operation.op_id.clone(),
                resource_id: "lr_held".into(),
                op: "unavailable".into(),
                relative_path: Some("essay.docx".into()),
                previous_relative_path: None,
                hash: None,
                revision_before: None,
                size: None,
                native_format: None,
            },
        };
        journal
            .enqueue(
                &operation.op_id,
                "outbound-change",
                &serde_json::to_string(&envelope).unwrap(),
            )
            .unwrap();
        let paused = HashSet::from(["grant_paused".to_owned()]);
        let delivered =
            drain_cloud_queue_holding(&journal, "http://127.0.0.1:1", "unused", &paused)
                .await
                .unwrap();
        assert!(delivered.is_empty());
        assert!(journal.due_queue(10).unwrap().is_empty(), "held, not due");
        assert_ne!(
            journal.by_key("held").unwrap().unwrap().state,
            crate::journal::OpState::Failed,
            "a held change is not superseded or failed"
        );
    }

    #[test]
    fn locked_change_is_current_without_a_content_hash() {
        let resource = crate::journal::ResourceRecord {
            local_resource_id: "lr_word".into(),
            grant_id: "grant_word".into(),
            path_key: "Last-year essay.docx".into(),
            volume: None,
            file_index: None,
            content_hash: Some("ab".repeat(32)),
            revision: Some("ab".repeat(32)),
            available: true,
            unavailable_reason: None,
            last_seen_generation: 1,
        };
        let locked = ReportedChange {
            journal_id: "op_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
            resource_id: "lr_word".into(),
            op: "locked".into(),
            relative_path: Some("Last-year essay.docx".into()),
            previous_relative_path: None,
            hash: None,
            revision_before: resource.content_hash.clone(),
            size: None,
            native_format: None,
        };
        assert!(queued_change_still_current(&locked, Some(&resource)));
        let upsert = ReportedChange {
            hash: Some("cd".repeat(32)),
            op: "upsert".into(),
            ..locked.clone()
        };
        assert!(!queued_change_still_current(&upsert, Some(&resource)));
    }

    #[tokio::test]
    async fn locked_queue_entry_is_not_dropped_as_superseded() {
        let journal = Journal::in_memory().unwrap();
        journal
            .upsert_resource(&crate::journal::ResourceRecord {
                local_resource_id: "lr_word".into(),
                grant_id: "grant_word".into(),
                path_key: "Last-year essay.docx".into(),
                volume: None,
                file_index: None,
                content_hash: Some("ab".repeat(32)),
                revision: Some("ab".repeat(32)),
                available: true,
                unavailable_reason: None,
                last_seen_generation: 1,
            })
            .unwrap();
        let operation = journal
            .begin_intent(
                "locked-hold",
                "cloud.report-change",
                Some("lr_word"),
                Some(&"ab".repeat(32)),
                None,
            )
            .unwrap();
        let envelope = QueuedChangeEnvelope {
            grant_id: "grant_word".into(),
            mount_id: "mount_word".into(),
            change: ReportedChange {
                journal_id: operation.op_id.clone(),
                resource_id: "lr_word".into(),
                op: "locked".into(),
                relative_path: Some("Last-year essay.docx".into()),
                previous_relative_path: None,
                hash: None,
                revision_before: Some("ab".repeat(32)),
                size: None,
                native_format: None,
            },
        };
        journal
            .enqueue(
                &operation.op_id,
                "outbound-change",
                &serde_json::to_string(&envelope).unwrap(),
            )
            .unwrap();

        let delivered = drain_cloud_queue(&journal, "http://127.0.0.1:1", "unused")
            .await
            .unwrap();
        assert!(delivered.is_empty());
        assert_eq!(
            journal.by_key("locked-hold").unwrap().unwrap().state,
            crate::journal::OpState::Intent
        );
        assert_ne!(
            journal
                .by_key("locked-hold")
                .unwrap()
                .unwrap()
                .error_code
                .as_deref(),
            Some("change-superseded")
        );
    }
}
