use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use async_trait::async_trait;
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use rand::RngCore;
use subtle::ConstantTimeEq;

use crate::protocol::{HealthResponse, LocalBridgeStatus, LocalControlSnapshot, PairingOffer};
use tower_http::cors::{AllowOrigin, CorsLayer};

/*
 * The local control API. Spectra's Devices page drives the Bridge through it:
 * pairing, status, folders, pausing, logs, updates and unpairing. The Bridge
 * has no window of its own; the only native surfaces are the tray, the folder
 * picker and the pairing confirmation, and both dialogs are opened from here.
 */

pub struct ServerState {
    paired: RwLock<bool>,
    allowed_origins: RwLock<HashSet<String>>,
    session_token: RwLock<Vec<u8>>,
    bind_error: RwLock<Option<String>>,
    pending_pairing: RwLock<HashMap<String, PairingOffer>>,
    pairing_completion: RwLock<HashMap<String, String>>,
    pairing_failure: RwLock<HashMap<String, String>>,
    device_id: RwLock<Option<String>>,
    cloud_seen_at: AtomicU64,
    local_control: RwLock<Option<Arc<dyn LocalBridgeControl>>>,
}

#[async_trait]
pub trait LocalBridgeControl: Send + Sync {
    /// Pairs this computer for a waiting offer. It may show the native
    /// confirmation with the offer's code and wait for the person's answer.
    async fn auto_pair(&self, challenge: &str) -> Result<(), String>;
    async fn request_update(&self) -> Result<String, String>;
    fn snapshot(&self) -> LocalControlSnapshot;
    /// Opens the native folder picker on this computer.
    async fn select_mount(&self) -> Result<(), String>;
    async fn retry_mount(&self, grant_id: &str) -> Result<(), String>;
    async fn remove_mount(&self, grant_id: &str) -> Result<(), String>;
    async fn set_mount_paused(&self, grant_id: &str, paused: bool) -> Result<(), String>;
    async fn set_sync_paused(&self, paused: bool) -> Result<(), String>;
    /// Opens the Bridge log file on this computer.
    async fn open_logs(&self) -> Result<(), String>;
    /// Opens a document in a selected folder in its desktop app.
    async fn open_file(&self, grant_id: &str, relative_path: &str) -> Result<(), String>;
    /// Shows a file in a selected folder in the system's file manager.
    async fn reveal_file(&self, grant_id: &str, relative_path: &str) -> Result<(), String>;
    /// Forgets this computer's pairing and stops syncing. Files stay.
    async fn unpair(&self) -> Result<(), String>;
}

impl ServerState {
    pub fn unpaired() -> Self {
        let mut origins = HashSet::new();
        for origin in std::env::var("SPECTRA_ORIGINS")
            .unwrap_or_else(|_| "http://localhost:3000,http://127.0.0.1:3000".into())
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            origins.insert(origin.to_owned());
        }
        Self {
            paired: RwLock::new(false),
            allowed_origins: RwLock::new(origins),
            session_token: RwLock::new(vec![]),
            bind_error: RwLock::new(None),
            pending_pairing: RwLock::new(HashMap::new()),
            pairing_completion: RwLock::new(HashMap::new()),
            pairing_failure: RwLock::new(HashMap::new()),
            device_id: RwLock::new(None),
            cloud_seen_at: AtomicU64::new(0),
            local_control: RwLock::new(None),
        }
    }
    pub fn install_local_control(&self, control: Arc<dyn LocalBridgeControl>) {
        *self.local_control.write().unwrap() = Some(control);
    }
    pub fn set_device_id(&self, device_id: String) {
        *self.device_id.write().unwrap() = Some(device_id);
    }
    pub fn mark_cloud_seen(&self) {
        self.cloud_seen_at.store(unix_ms(), Ordering::Relaxed);
    }
    /// Whether a cloud request succeeded in the last 15 seconds.
    pub fn cloud_connected(&self) -> bool {
        self.cloud_seen_within(15_000)
    }
    pub fn cloud_seen_within(&self, window_ms: u64) -> bool {
        let seen = self.cloud_seen_at.load(Ordering::Relaxed);
        seen > 0 && unix_ms().saturating_sub(seen) <= window_ms
    }
    /// The first configured Spectra origin, for opening the Devices page.
    pub fn primary_origin(&self) -> Option<String> {
        let origins = self.allowed_origins.read().unwrap();
        let mut sorted: Vec<&String> = origins.iter().collect();
        // Prefer a deployed origin over a local development one.
        sorted.sort_by_key(|origin| (origin.starts_with("http://"), origin.as_str()));
        sorted.first().map(|origin| (*origin).clone())
    }
    pub fn pair(&self, origin: String) -> String {
        let mut token = vec![0_u8; 32];
        rand::rng().fill_bytes(&mut token);
        *self.session_token.write().unwrap() = token.clone();
        self.allowed_origins.write().unwrap().insert(origin);
        *self.paired.write().unwrap() = true;
        base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, token)
    }
    /// Unpairing: the browser session and the device identity are dropped.
    pub fn forget_pairing(&self) {
        *self.paired.write().unwrap() = false;
        *self.session_token.write().unwrap() = vec![];
        *self.device_id.write().unwrap() = None;
        self.cloud_seen_at.store(0, Ordering::Relaxed);
    }
    fn prune_expired_pairing(&self) {
        let now = unix_ms();
        self.pending_pairing
            .write()
            .unwrap()
            .retain(|_, offer| offer.expires_at > now);
    }
    pub fn accept_pairing_offer(&self, offer: PairingOffer) -> anyhow::Result<()> {
        anyhow::ensure!(
            offer.challenge.len() >= 32 && offer.challenge.len() <= 256,
            "invalid pairing challenge"
        );
        anyhow::ensure!(
            offer.short_code.len() == 6
                && offer.short_code.bytes().all(|byte| byte.is_ascii_digit()),
            "invalid pairing code"
        );
        anyhow::ensure!(offer.expires_at > unix_ms(), "pairing offer expired");
        anyhow::ensure!(
            self.allowed_origins
                .read()
                .unwrap()
                .contains(&offer.browser_origin),
            "origin is not configured for Spectra"
        );
        self.prune_expired_pairing();
        self.pairing_failure.write().unwrap().remove(&offer.challenge);
        self.pending_pairing
            .write()
            .unwrap()
            .insert(offer.challenge.clone(), offer);
        Ok(())
    }
    pub fn take_pairing_offer(&self, challenge: &str) -> anyhow::Result<PairingOffer> {
        self.prune_expired_pairing();
        let offer = self
            .pending_pairing
            .write()
            .unwrap()
            .remove(challenge)
            .ok_or_else(|| anyhow::anyhow!("no pairing is waiting"))?;
        anyhow::ensure!(offer.expires_at > unix_ms(), "pairing offer expired");
        Ok(offer)
    }
    pub fn is_paired(&self) -> bool {
        *self.paired.read().unwrap()
    }
    pub fn complete_pairing(&self, challenge: String, origin: String) -> String {
        let token = if self.is_paired() {
            self.resume_session(&origin)
                .unwrap_or_else(|| self.pair(origin))
        } else {
            self.pair(origin)
        };
        self.pairing_completion
            .write()
            .unwrap()
            .insert(challenge, token.clone());
        token
    }
    /// A pairing attempt ended without pairing; the page reads why once.
    pub fn fail_pairing(&self, challenge: String, reason: String) {
        self.pairing_failure
            .write()
            .unwrap()
            .insert(challenge, reason);
    }
    pub fn restore_pairing(&self, origin: String, token: &str) -> anyhow::Result<()> {
        let decoded =
            base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, token)?;
        anyhow::ensure!(decoded.len() == 32, "invalid stored browser session");
        self.allowed_origins.write().unwrap().insert(origin);
        *self.session_token.write().unwrap() = decoded;
        *self.paired.write().unwrap() = true;
        Ok(())
    }
    pub fn resume_session(&self, origin: &str) -> Option<String> {
        if !self.is_paired() || !self.allowed_origins.read().unwrap().contains(origin) {
            return None;
        }
        let token = self.session_token.read().unwrap();
        if token.len() != 32 {
            return None;
        }
        Some(base64::Engine::encode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            token.as_slice(),
        ))
    }
    pub fn session_token_matches(&self, supplied: &str) -> bool {
        if !self.is_paired() {
            return false;
        }
        let supplied =
            base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, supplied)
                .unwrap_or_default();
        let expected = self.session_token.read().unwrap();
        expected.len() == 32
            && supplied.len() == 32
            && bool::from(supplied.ct_eq(expected.as_slice()))
    }
    pub fn resume_session_with_token(&self, origin: &str, token: &str) -> Option<String> {
        if !self.session_token_matches(token) {
            return None;
        }
        self.resume_session(origin)
    }
    pub fn local_status(&self) -> LocalBridgeStatus {
        let snapshot = self
            .local_control
            .read()
            .unwrap()
            .as_ref()
            .map(|control| control.snapshot())
            .unwrap_or_default();
        LocalBridgeStatus {
            version: env!("CARGO_PKG_VERSION").into(),
            protocol_version: crate::PROTOCOL_VERSION.into(),
            paired: self.is_paired(),
            cloud_connected: self.cloud_connected(),
            device_id: self.device_id.read().unwrap().clone(),
            device_name: snapshot.device_name,
            paused: snapshot.paused,
            last_sync_at: snapshot.last_sync_at,
            mounts: snapshot.mounts,
            office_files: snapshot.office_files,
        }
    }
    fn take_pairing_completion(&self, challenge: &str) -> Option<String> {
        self.pairing_completion.write().unwrap().remove(challenge)
    }
    fn take_pairing_failure(&self, challenge: &str) -> Option<String> {
        self.pairing_failure.write().unwrap().remove(challenge)
    }
    fn control(&self) -> Option<Arc<dyn LocalBridgeControl>> {
        self.local_control.read().unwrap().clone()
    }
}

pub fn router(state: Arc<ServerState>) -> Router {
    let protected = Router::new()
        .route("/v1/status", get(status))
        .route("/v1/mount/select", post(select_mount))
        .route("/v1/mount/retry", post(retry_mount))
        .route("/v1/mount/remove", post(remove_mount))
        .route("/v1/mount/pause", post(pause_mount))
        .route("/v1/sync/pause", post(pause_sync))
        .route("/v1/logs/open", post(open_logs))
        .route("/v1/file/open", post(open_file))
        .route("/v1/file/reveal", post(reveal_file))
        .route("/v1/unpair", post(unpair))
        .route_layer(middleware::from_fn_with_state(state.clone(), authenticate));
    let origins = state
        .allowed_origins
        .read()
        .unwrap()
        .iter()
        .filter_map(|value| value.parse().ok())
        .collect::<Vec<_>>();
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/pair", post(pair_offer))
        .route("/v1/pair/status", post(pair_status))
        .route("/v1/session/resume", post(resume))
        .route("/v1/update", post(request_update))
        .merge(protected)
        .layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::list(origins))
                .allow_methods([http::Method::GET, http::Method::POST])
                .allow_headers([http::header::AUTHORIZATION, http::header::CONTENT_TYPE]),
        )
        .with_state(state)
}

fn controls_not_ready() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        "Bridge controls are not ready",
    )
        .into_response()
}

/// Runs one control action: 204 when it worked, 400 with its sentence when not.
async fn act<F, Fut>(state: &ServerState, action: F) -> Response
where
    F: FnOnce(Arc<dyn LocalBridgeControl>) -> Fut,
    Fut: Future<Output = Result<(), String>>,
{
    match state.control() {
        Some(control) => match action(control).await {
            Ok(()) => StatusCode::NO_CONTENT.into_response(),
            Err(error) => (StatusCode::BAD_REQUEST, error).into_response(),
        },
        None => controls_not_ready(),
    }
}

async fn health(State(state): State<Arc<ServerState>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        version: env!("CARGO_PKG_VERSION").into(),
        paired: *state.paired.read().unwrap(),
        protocol_version: crate::PROTOCOL_VERSION.into(),
        port: crate::BRIDGE_PORT,
        bind_error: state.bind_error.read().unwrap().clone(),
    })
}

async fn status(State(state): State<Arc<ServerState>>) -> Json<LocalBridgeStatus> {
    Json(state.local_status())
}

async fn select_mount(State(state): State<Arc<ServerState>>) -> Response {
    act(&state, |control| async move { control.select_mount().await }).await
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MountAction {
    grant_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MountPause {
    grant_id: String,
    paused: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncPause {
    paused: bool,
}

async fn retry_mount(
    State(state): State<Arc<ServerState>>,
    Json(input): Json<MountAction>,
) -> Response {
    act(&state, |control| async move {
        control.retry_mount(&input.grant_id).await
    })
    .await
}

async fn remove_mount(
    State(state): State<Arc<ServerState>>,
    Json(input): Json<MountAction>,
) -> Response {
    act(&state, |control| async move {
        control.remove_mount(&input.grant_id).await
    })
    .await
}

async fn pause_mount(
    State(state): State<Arc<ServerState>>,
    Json(input): Json<MountPause>,
) -> Response {
    act(&state, |control| async move {
        control.set_mount_paused(&input.grant_id, input.paused).await
    })
    .await
}

async fn pause_sync(
    State(state): State<Arc<ServerState>>,
    Json(input): Json<SyncPause>,
) -> Response {
    act(&state, |control| async move {
        control.set_sync_paused(input.paused).await
    })
    .await
}

async fn open_logs(State(state): State<Arc<ServerState>>) -> Response {
    act(&state, |control| async move { control.open_logs().await }).await
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileAction {
    grant_id: String,
    relative_path: String,
}

async fn open_file(
    State(state): State<Arc<ServerState>>,
    Json(input): Json<FileAction>,
) -> Response {
    act(&state, |control| async move {
        control.open_file(&input.grant_id, &input.relative_path).await
    })
    .await
}

async fn reveal_file(
    State(state): State<Arc<ServerState>>,
    Json(input): Json<FileAction>,
) -> Response {
    act(&state, |control| async move {
        control.reveal_file(&input.grant_id, &input.relative_path).await
    })
    .await
}

async fn unpair(State(state): State<Arc<ServerState>>) -> Response {
    let response = act(&state, |control| async move { control.unpair().await }).await;
    if response.status() == StatusCode::NO_CONTENT {
        state.forget_pairing();
    }
    response
}

/// Accepts an offer and pairs in the background: the native confirmation may
/// wait for the person, so the page polls `/v1/pair/status` for the outcome.
async fn pair_offer(
    State(state): State<Arc<ServerState>>,
    Json(offer): Json<PairingOffer>,
) -> Response {
    let Some(control) = state.control() else {
        return controls_not_ready();
    };
    if let Err(error) = state.accept_pairing_offer(offer.clone()) {
        return (StatusCode::BAD_REQUEST, error.to_string()).into_response();
    }
    let background = state.clone();
    tokio::spawn(async move {
        if let Err(error) = control.auto_pair(&offer.challenge).await {
            background.fail_pairing(offer.challenge, error);
        }
    });
    StatusCode::ACCEPTED.into_response()
}

async fn request_update(State(state): State<Arc<ServerState>>) -> Response {
    match state.control() {
        Some(control) => match control.request_update().await {
            Ok(message) => Json(serde_json::json!({ "message": message })).into_response(),
            Err(error) => (StatusCode::BAD_REQUEST, error).into_response(),
        },
        None => controls_not_ready(),
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairStatus {
    challenge: String,
}
async fn pair_status(
    State(state): State<Arc<ServerState>>,
    Json(input): Json<PairStatus>,
) -> Response {
    if let Some(session_token) = state.take_pairing_completion(&input.challenge) {
        return Json(serde_json::json!({ "paired": true, "sessionToken": session_token }))
            .into_response();
    }
    match state.take_pairing_failure(&input.challenge) {
        Some(failure) => {
            Json(serde_json::json!({ "paired": false, "failure": failure })).into_response()
        }
        None => Json(serde_json::json!({ "paired": false })).into_response(),
    }
}

async fn resume(State(state): State<Arc<ServerState>>, request: Request) -> Response {
    let origin = request
        .headers()
        .get("origin")
        .and_then(|value| value.to_str().ok());
    let token = request
        .headers()
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    match origin
        .and_then(|value| token.and_then(|token| state.resume_session_with_token(value, token)))
    {
        Some(session_token) => Json(serde_json::json!({
            "paired": true,
            "sessionToken": session_token,
        }))
        .into_response(),
        None => Json(serde_json::json!({ "paired": false })).into_response(),
    }
}

async fn authenticate(
    State(state): State<Arc<ServerState>>,
    request: Request,
    next: Next,
) -> Response {
    let headers = request.headers();
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let allowed = origin.is_some_and(|value| state.allowed_origins.read().unwrap().contains(value));
    let supplied = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .and_then(|v| {
            base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, v).ok()
        })
        .unwrap_or_default();
    let token_ok = state.is_paired() && {
        let expected = state.session_token.read().unwrap();
        expected.len() == 32
            && supplied.len() == 32
            && bool::from(supplied.ct_eq(expected.as_slice()))
    };
    if !allowed || !token_ok {
        return (StatusCode::UNAUTHORIZED, "Bridge session is not authorized").into_response();
    }
    next.run(request).await
}

fn unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub async fn serve(state: Arc<ServerState>) -> anyhow::Result<()> {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), crate::BRIDGE_PORT);
    let listener = match tokio::net::TcpListener::bind(address).await {
        Ok(listener) => listener,
        Err(error) => {
            *state.bind_error.write().unwrap() = Some(format!(
                "Port {} is unavailable: {error}",
                crate::BRIDGE_PORT
            ));
            anyhow::bail!(
                "Spectra Bridge cannot bind fixed port {}: {error}",
                crate::BRIDGE_PORT
            );
        }
    };
    axum::serve(listener, router(state)).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{LocalMountStatus, LocalOfficeFile};
    use std::sync::Mutex;

    const ORIGIN: &str = "http://localhost:3000";

    #[derive(Default)]
    struct FakeControl {
        calls: Mutex<Vec<String>>,
        decline_pairing: bool,
    }

    #[async_trait]
    impl LocalBridgeControl for FakeControl {
        async fn auto_pair(&self, challenge: &str) -> Result<(), String> {
            self.calls.lock().unwrap().push(format!("pair:{}", &challenge[..4]));
            if self.decline_pairing {
                Err("Pairing was declined on this computer.".into())
            } else {
                Ok(())
            }
        }
        async fn request_update(&self) -> Result<String, String> {
            Ok("updating".into())
        }
        fn snapshot(&self) -> LocalControlSnapshot {
            LocalControlSnapshot {
                device_name: "Studio PC".into(),
                paused: true,
                last_sync_at: Some(42),
                mounts: vec![LocalMountStatus {
                    id: "grant_ab".into(),
                    label: "Biology".into(),
                    friendly_path: "Documents › Biology".into(),
                    state: "active".into(),
                    detail: "Up to date".into(),
                    synced: 3,
                    total: 3,
                    double_sync_risk: false,
                    paused: false,
                    last_sync_at: Some(41),
                }],
                office_files: vec![LocalOfficeFile {
                    folder: "Biology".into(),
                    name: "Essay.docx".into(),
                }],
            }
        }
        async fn select_mount(&self) -> Result<(), String> {
            self.calls.lock().unwrap().push("select".into());
            Ok(())
        }
        async fn retry_mount(&self, grant_id: &str) -> Result<(), String> {
            self.calls.lock().unwrap().push(format!("retry:{grant_id}"));
            Ok(())
        }
        async fn remove_mount(&self, grant_id: &str) -> Result<(), String> {
            self.calls.lock().unwrap().push(format!("remove:{grant_id}"));
            Ok(())
        }
        async fn set_mount_paused(&self, grant_id: &str, paused: bool) -> Result<(), String> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("pause-mount:{grant_id}:{paused}"));
            Ok(())
        }
        async fn set_sync_paused(&self, paused: bool) -> Result<(), String> {
            self.calls.lock().unwrap().push(format!("pause:{paused}"));
            Ok(())
        }
        async fn open_logs(&self) -> Result<(), String> {
            self.calls.lock().unwrap().push("logs".into());
            Ok(())
        }
        async fn open_file(&self, grant_id: &str, relative_path: &str) -> Result<(), String> {
            self.calls.lock().unwrap().push(format!("open:{grant_id}:{relative_path}"));
            if relative_path.ends_with(".exe") {
                return Err("Spectra opens documents only.".into());
            }
            Ok(())
        }
        async fn reveal_file(&self, grant_id: &str, relative_path: &str) -> Result<(), String> {
            self.calls.lock().unwrap().push(format!("reveal:{grant_id}:{relative_path}"));
            Ok(())
        }
        async fn unpair(&self) -> Result<(), String> {
            self.calls.lock().unwrap().push("unpair".into());
            Ok(())
        }
    }

    fn offer(challenge: char, code: &str) -> PairingOffer {
        PairingOffer {
            challenge: challenge.to_string().repeat(64),
            short_code: code.into(),
            browser_origin: ORIGIN.into(),
            expires_at: unix_ms() + 60_000,
        }
    }

    /// Serves the router on a free port and returns its base URL.
    async fn spawn(state: Arc<ServerState>) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, router(state)).await.unwrap();
        });
        format!("http://{address}")
    }

    #[test]
    fn pairing_mints_unique_tokens_and_pins_origin() {
        let state = ServerState::unpaired();
        let a = state.pair(ORIGIN.into());
        let b = state.pair(ORIGIN.into());
        assert_ne!(a, b);
        assert!(state.allowed_origins.read().unwrap().contains(ORIGIN));
    }
    #[test]
    fn pairing_session_restores_after_process_restart() {
        let original = ServerState::unpaired();
        let token = original.pair(ORIGIN.into());
        let restored = ServerState::unpaired();
        restored.restore_pairing(ORIGIN.into(), &token).unwrap();
        assert!(*restored.paired.read().unwrap());
        assert_eq!(
            *restored.session_token.read().unwrap(),
            *original.session_token.read().unwrap()
        );
    }
    #[test]
    fn pairing_offer_is_consumed_by_spectra_owned_auto_pair_flow() {
        let state = ServerState::unpaired();
        let offer = offer('a', "123456");
        state.accept_pairing_offer(offer.clone()).unwrap();
        assert_eq!(state.take_pairing_offer(&offer.challenge).unwrap(), offer);
        assert!(state.take_pairing_offer(&offer.challenge).is_err());
    }
    #[test]
    fn several_waiting_offers_are_each_kept_until_taken() {
        let state = ServerState::unpaired();
        for index in 0..6 {
            state
                .accept_pairing_offer(PairingOffer {
                    challenge: format!("{:0>64}", index),
                    short_code: format!("{index:06}"),
                    browser_origin: ORIGIN.into(),
                    expires_at: unix_ms() + 60_000,
                })
                .unwrap();
        }
        let first = state.take_pairing_offer(&"0".repeat(64)).unwrap();
        assert_eq!(first.short_code, "000000");
        assert_eq!(state.pending_pairing.read().unwrap().len(), 5);
        assert!(state.take_pairing_offer(&format!("{:0>64}", 5)).is_ok());
    }
    #[test]
    fn complete_pairing_reuses_the_session_for_a_second_tab() {
        let state = ServerState::unpaired();
        let first = state.complete_pairing("a".repeat(64), ORIGIN.into());
        let second = state.complete_pairing("b".repeat(64), ORIGIN.into());
        assert_eq!(first, second);
        assert_eq!(
            state.take_pairing_completion(&"a".repeat(64)).as_deref(),
            Some(first.as_str())
        );
        assert_eq!(
            state.take_pairing_completion(&"b".repeat(64)).as_deref(),
            Some(second.as_str())
        );
    }
    #[test]
    fn paired_session_can_resume_only_for_an_allowed_origin() {
        let state = ServerState::unpaired();
        let token = state.pair(ORIGIN.into());
        assert_eq!(state.resume_session(ORIGIN), Some(token));
        assert_eq!(state.resume_session("http://evil.test"), None);
        assert_eq!(state.resume_session_with_token(ORIGIN, "wrong"), None);
    }
    #[test]
    fn unpaired_empty_token_cannot_authenticate_or_resume() {
        let state = ServerState::unpaired();
        assert!(!state.session_token_matches(""));
        assert_eq!(state.resume_session_with_token(ORIGIN, ""), None);
    }
    #[test]
    fn forgetting_pairing_drops_the_session_and_device() {
        let state = ServerState::unpaired();
        let token = state.pair(ORIGIN.into());
        state.set_device_id("device-1".into());
        state.mark_cloud_seen();
        state.forget_pairing();
        assert!(!state.is_paired());
        assert!(!state.session_token_matches(&token));
        assert!(!state.cloud_connected());
        assert_eq!(state.local_status().device_id, None);
    }
    #[test]
    fn status_reports_the_control_snapshot() {
        let state = ServerState::unpaired();
        state.install_local_control(Arc::new(FakeControl::default()));
        let status = state.local_status();
        assert_eq!(status.device_name, "Studio PC");
        assert!(status.paused);
        assert_eq!(status.last_sync_at, Some(42));
        assert_eq!(status.mounts[0].friendly_path, "Documents › Biology");
        assert_eq!(status.office_files[0].name, "Essay.docx");
    }
    #[test]
    fn the_deployed_origin_opens_before_a_local_one() {
        let state = ServerState::unpaired();
        state
            .allowed_origins
            .write()
            .unwrap()
            .insert("https://spectra.school".into());
        assert_eq!(state.primary_origin().as_deref(), Some("https://spectra.school"));
    }

    #[tokio::test]
    async fn every_control_route_needs_the_paired_session() {
        let state = Arc::new(ServerState::unpaired());
        let control = Arc::new(FakeControl::default());
        state.install_local_control(control.clone());
        let base = spawn(state.clone()).await;
        let client = reqwest::Client::new();
        for path in [
            "/v1/mount/select",
            "/v1/sync/pause",
            "/v1/logs/open",
            "/v1/file/open",
            "/v1/file/reveal",
            "/v1/unpair",
        ] {
            let response = client
                .post(format!("{base}{path}"))
                .header("origin", ORIGIN)
                .json(&serde_json::json!({ "paused": true }))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), 401, "{path} must be protected");
        }
        assert!(control.calls.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn the_devices_page_drives_folders_pausing_logs_and_unpairing() {
        let state = Arc::new(ServerState::unpaired());
        let control = Arc::new(FakeControl::default());
        state.install_local_control(control.clone());
        let token = state.pair(ORIGIN.into());
        let base = spawn(state.clone()).await;
        let client = reqwest::Client::new();
        let post = |path: &str, body: serde_json::Value| {
            client
                .post(format!("{base}{path}"))
                .header("origin", ORIGIN)
                .bearer_auth(&token)
                .json(&body)
                .send()
        };
        for (path, body) in [
            ("/v1/mount/pause", serde_json::json!({ "grantId": "grant_ab", "paused": true })),
            ("/v1/mount/retry", serde_json::json!({ "grantId": "grant_ab" })),
            ("/v1/sync/pause", serde_json::json!({ "paused": false })),
            ("/v1/logs/open", serde_json::json!({})),
        ] {
            assert_eq!(post(path, body).await.unwrap().status(), 204, "{path}");
        }
        let status: LocalBridgeStatus = client
            .get(format!("{base}/v1/status"))
            .header("origin", ORIGIN)
            .bearer_auth(&token)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(status.mounts.len(), 1);
        assert_eq!(post("/v1/unpair", serde_json::json!({})).await.unwrap().status(), 204);
        assert!(!state.is_paired());
        assert_eq!(
            post("/v1/sync/pause", serde_json::json!({ "paused": true }))
                .await
                .unwrap()
                .status(),
            401,
            "an unpaired Bridge no longer accepts the old session"
        );
        assert_eq!(
            *control.calls.lock().unwrap(),
            vec![
                "pause-mount:grant_ab:true",
                "retry:grant_ab",
                "pause:false",
                "logs",
                "unpair"
            ]
        );
    }

    #[tokio::test]
    async fn a_work_page_opens_its_file_or_shows_it_in_its_folder() {
        let state = Arc::new(ServerState::unpaired());
        let control = Arc::new(FakeControl::default());
        state.install_local_control(control.clone());
        let token = state.pair(ORIGIN.into());
        let base = spawn(state.clone()).await;
        let client = reqwest::Client::new();
        let post = |path: &str, relative_path: &str| {
            client
                .post(format!("{base}{path}"))
                .header("origin", ORIGIN)
                .bearer_auth(&token)
                .json(&serde_json::json!({ "grantId": "grant_ab", "relativePath": relative_path }))
                .send()
        };
        assert_eq!(post("/v1/file/open", "Essays/Cells.docx").await.unwrap().status(), 204);
        assert_eq!(post("/v1/file/reveal", "Essays/Cells.docx").await.unwrap().status(), 204);
        // A refusal reaches the page as its sentence.
        let refused = post("/v1/file/open", "setup.exe").await.unwrap();
        assert_eq!(refused.status(), 400);
        assert_eq!(refused.text().await.unwrap(), "Spectra opens documents only.");
        assert_eq!(
            *control.calls.lock().unwrap(),
            vec![
                "open:grant_ab:Essays/Cells.docx",
                "reveal:grant_ab:Essays/Cells.docx",
                "open:grant_ab:setup.exe"
            ]
        );
    }

    #[tokio::test]
    async fn pairing_runs_in_the_background_and_reports_its_outcome() {
        let state = Arc::new(ServerState::unpaired());
        state.install_local_control(Arc::new(FakeControl {
            decline_pairing: true,
            ..FakeControl::default()
        }));
        let base = spawn(state.clone()).await;
        let client = reqwest::Client::new();
        let offer = offer('d', "654321");
        let accepted = client
            .post(format!("{base}/v1/pair"))
            .json(&offer)
            .send()
            .await
            .unwrap();
        assert_eq!(accepted.status(), 202);
        let mut outcome = serde_json::Value::Null;
        for _ in 0..50 {
            outcome = client
                .post(format!("{base}/v1/pair/status"))
                .json(&serde_json::json!({ "challenge": offer.challenge }))
                .send()
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            if outcome.get("failure").is_some() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert_eq!(outcome["paired"], false);
        assert_eq!(outcome["failure"], "Pairing was declined on this computer.");
    }
}
