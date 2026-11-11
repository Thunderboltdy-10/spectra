use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use async_trait::async_trait;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{Query, Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use rand::RngCore;
use subtle::ConstantTimeEq;

use crate::protocol::{HealthResponse, LocalBridgeStatus, LocalControlSnapshot, PairingOffer};
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::locks::{Locked, Recover};

/// A page served from this computer, on any port: a development instance of
/// Spectra. Only debug builds accept one (`ServerState::origin_allowed`); a
/// release Bridge accepts exactly the origins baked into it.
fn is_local_development_origin(value: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value) else { return false; };
    matches!(url.scheme(), "http" | "https")
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
        && url.username().is_empty() && url.password().is_none()
        && url.path() == "/" && url.query().is_none() && url.fragment().is_none()
}

/*
 * The local control API. Spectra's Devices page drives the Bridge through it:
 * pairing, status, folders, pausing, logs, updates and unpairing. The Bridge
 * has no window of its own; the only native surfaces are the tray, the folder
 * picker and the pairing confirmation, and both dialogs are opened from here.
 */

pub struct ServerState {
    paired: RwLock<bool>,
    allowed_origins: RwLock<HashSet<String>>,
    /// One session per browser origin: joining from a second never ends the first.
    sessions: RwLock<HashMap<String, Vec<u8>>>,
    bind_error: RwLock<Option<String>>,
    pending_pairing: RwLock<HashMap<String, PairingOffer>>,
    pairing_completion: RwLock<HashMap<String, String>>,
    pairing_failure: RwLock<HashMap<String, String>>,
    device_id: RwLock<Option<String>>,
    relay_generation: tokio::sync::watch::Sender<u64>,
    cloud_seen_at: AtomicU64,
    local_control: RwLock<Option<Arc<dyn LocalBridgeControl>>>,
    listening: AtomicBool,
    work_scope: RwLock<Option<WorkScope>>,
    work_cache: Mutex<HashMap<(String, String), Arc<crate::rooms::Rooms>>>,
    work_initializing: tokio::sync::Mutex<()>,
    /// Debug builds also accept pages served from this computer.
    local_development: bool,
    /// When Spectra last asked for an update, so a page cannot loop it.
    update_requested_at: AtomicU64,
}

/// One update request per ten minutes.
const UPDATE_REQUEST_INTERVAL_MS: u64 = 10 * 60 * 1000;

struct WorkScope {
    identity: LocalRelayIdentity,
    deployment: String,
    account: String,
    rooms: Arc<crate::rooms::Rooms>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LocalRelayIdentity {
    pub device_id: String,
    pub generation: String,
}

/// What choosing files came to, for whoever opened the picker. `selected` is
/// how many were newly added; `existing` were already here and can be placed.
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesSelected {
    pub selected: usize,
    pub added: Vec<crate::fs::SyncedFile>,
    pub existing: Vec<crate::fs::SyncedFile>,
}

#[async_trait]
pub trait LocalBridgeControl: Send + Sync {
    /// Pairs this computer for a waiting offer. It may show the native
    /// confirmation with the offer's code and wait for the person's answer.
    async fn auto_pair(&self, challenge: &str) -> Result<(), String>;
    async fn request_update(&self) -> Result<String, String>;
    fn snapshot(&self) -> LocalControlSnapshot;
    /// Opens the native folder picker on this computer.
    async fn select_mount(&self) -> Result<Option<String>, String>;
    /// Opens a native picker for one or several individual files.
    async fn select_files(&self) -> Result<FilesSelected, String> {
        Err("Update Spectra Bridge to sync individual files.".into())
    }
    /// Brings in a file or folder Spectra AI named, once the person agrees in
    /// a native prompt on this computer. None when they say no.
    async fn sync_named(&self, _path: &str) -> Result<Option<String>, String> {
        Err("Update Spectra Bridge to sync a file by name.".into())
    }
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
    /// The origins come from `SPECTRA_ORIGINS`, baked into a release build
    /// (`configure_embedded_release_environment`). Without it a debug build
    /// serves the local development app and a release build serves nothing.
    pub fn unpaired() -> Self {
        let configured = std::env::var("SPECTRA_ORIGINS").ok().or_else(|| {
            cfg!(debug_assertions).then(|| "http://localhost:3000,http://127.0.0.1:3000".to_string())
        });
        let configured = configured.unwrap_or_default();
        Self::with_origins(configured.split(',').map(str::trim), cfg!(debug_assertions))
    }
    pub fn with_origins<'a>(origins: impl IntoIterator<Item = &'a str>, local_development: bool) -> Self {
        let origins: HashSet<String> = origins.into_iter().filter(|value| !value.is_empty()).map(str::to_owned).collect();
        Self {
            paired: RwLock::new(false),
            allowed_origins: RwLock::new(origins),
            sessions: RwLock::new(HashMap::new()),
            bind_error: RwLock::new(None),
            pending_pairing: RwLock::new(HashMap::new()),
            pairing_completion: RwLock::new(HashMap::new()),
            pairing_failure: RwLock::new(HashMap::new()),
            device_id: RwLock::new(None),
            relay_generation: tokio::sync::watch::channel(rand::rng().next_u64()).0,
            cloud_seen_at: AtomicU64::new(0),
            local_control: RwLock::new(None),
            listening: AtomicBool::new(false),
            work_scope: RwLock::new(None),
            work_cache: Mutex::new(HashMap::new()),
            work_initializing: tokio::sync::Mutex::new(()),
            local_development,
            update_requested_at: AtomicU64::new(0),
        }
    }
    /// The one test for a browser origin: pairing offers, CORS and updates.
    pub fn origin_allowed(&self, origin: &str) -> bool {
        self.allowed_origins.reading().contains(origin)
            || (self.local_development && is_local_development_origin(origin))
    }
    pub fn install_local_control(&self, control: Arc<dyn LocalBridgeControl>) {
        *self.local_control.writing() = Some(control);
    }
    pub fn set_device_id(&self, device_id: String) {
        let mut current = self.device_id.writing();
        if current.as_ref() == Some(&device_id) { return; }
        if current.as_ref().is_some_and(|previous| previous != &device_id) {
            *self.paired.writing() = false;
            self.sessions.writing().clear();
            self.pairing_completion.writing().clear();
            self.cloud_seen_at.store(0, Ordering::Relaxed);
        }
        *current = Some(device_id);
        self.clear_work_scope();
        self.relay_generation.send_modify(|generation| *generation = generation.wrapping_add(1));
    }
    /// Also available while a confirmed pairing is preparing its local store.
    pub fn pairing_identity(&self) -> Option<LocalRelayIdentity> {
        let device = self.device_id.reading();
        Some(LocalRelayIdentity {
            device_id: device.clone()?,
            generation: self.relay_generation.borrow().to_string(),
        })
    }
    pub fn local_relay_identity(&self) -> Option<LocalRelayIdentity> {
        if !self.is_paired() { return None; }
        self.pairing_identity()
    }
    pub fn local_relay_matches(&self, identity: &LocalRelayIdentity) -> bool {
        self.local_relay_identity().as_ref() == Some(identity)
    }
    pub fn relay_changes(&self) -> tokio::sync::watch::Receiver<u64> {
        self.relay_generation.subscribe()
    }
    fn clear_work_scope(&self) {
        *self.work_scope.writing() = None;
        // Keep each room map until process exit: an old connection may still
        // be finishing a save when the same account is paired again.
        for rooms in self.work_cache.locked().values() { rooms.clear_authority(); }
    }
    pub fn is_listening(&self) -> bool { self.listening.load(Ordering::Acquire) }
    pub fn work_rooms(&self) -> Option<Arc<crate::rooms::Rooms>> {
        let identity = self.local_relay_identity()?;
        let scope = self.work_scope.reading();
        scope.as_ref().filter(|scope| scope.identity == identity).map(|scope| scope.rooms.clone())
    }
    pub fn work_account(&self) -> Option<(String, String)> {
        let identity = self.local_relay_identity()?;
        let scope = self.work_scope.reading();
        scope.as_ref().filter(|scope| scope.identity == identity).map(|scope| (scope.deployment.clone(), scope.account.clone()))
    }
    /// Called only with an owner from an authenticated pairing/health response
    /// or its device/deployment-bound journal record on restart.
    pub async fn prepare_work_rooms(&self, identity: &LocalRelayIdentity, store_path: std::path::PathBuf, legacy_path: std::path::PathBuf, deployment: String, credential: String, account: String) -> anyhow::Result<()> {
        let _initializing = self.work_initializing.lock().await;
        anyhow::ensure!(self.pairing_identity().as_ref() == Some(identity), "Pairing changed while preparing local work");
        let deployment = deployment.trim_end_matches('/').to_string();
        {
            let device = self.device_id.reading();
            anyhow::ensure!(device.as_deref() == Some(identity.device_id.as_str()) && self.relay_generation.borrow().to_string() == identity.generation, "Pairing changed while preparing local work");
            let mut scope = self.work_scope.writing();
            if scope.as_ref().is_some_and(|scope| scope.account != account || scope.deployment != deployment) {
                *scope = None;
                for rooms in self.work_cache.locked().values() { rooms.clear_authority(); }
                self.relay_generation.send_modify(|generation| *generation = generation.wrapping_add(1));
                anyhow::bail!("Work account changed; reconnect this computer");
            }
        }
        let key = (deployment.clone(), account.clone());
        let cached = self.work_cache.locked().get(&key).cloned();
        let rooms = match cached {
            Some(rooms) => rooms,
            None => crate::rooms::Rooms::for_account(store_path, legacy_path, deployment.clone(), credential.clone(), account.clone()).await?,
        };
        // Holding the device read lock fences set_device_id/forget_pairing
        // through cache insertion and publication, with no await in this span.
        let device = self.device_id.reading();
        anyhow::ensure!(device.as_deref() == Some(identity.device_id.as_str()) && self.relay_generation.borrow().to_string() == identity.generation, "Pairing changed while preparing local work");
        let mut scope = self.work_scope.writing();
        anyhow::ensure!(scope.as_ref().is_none_or(|scope| scope.account == account && scope.deployment == deployment), "Work account changed; reconnect this computer");
        rooms.refresh_authority(deployment.clone(), credential);
        self.work_cache.locked().insert(key, rooms.clone());
        *scope = Some(WorkScope { identity: identity.clone(), deployment, account, rooms });
        Ok(())
    }
    pub fn mark_cloud_seen(&self) {
        self.cloud_seen_at.store(unix_ms(), Ordering::Relaxed);
    }
    /// Whether the cloud answered in the last 45 seconds.
    pub fn cloud_connected(&self) -> bool {
        self.cloud_seen_within(45_000)
    }
    pub fn cloud_seen_within(&self, window_ms: u64) -> bool {
        let seen = self.cloud_seen_at.load(Ordering::Relaxed);
        seen > 0 && unix_ms().saturating_sub(seen) <= window_ms
    }
    /// The first configured Spectra origin, for opening the Devices page.
    pub fn primary_origin(&self) -> Option<String> {
        let origins = self.allowed_origins.reading();
        let mut sorted: Vec<&String> = origins.iter().collect();
        // Prefer a deployed origin over a local development one.
        sorted.sort_by_key(|origin| (origin.starts_with("http://"), origin.as_str()));
        sorted.first().map(|origin| (*origin).clone())
    }
    pub fn pair(&self, origin: String) -> String {
        let mut token = vec![0_u8; 32];
        rand::rng().fill_bytes(&mut token);
        self.sessions.writing().insert(origin.clone(), token.clone());
        self.allowed_origins.writing().insert(origin);
        *self.paired.writing() = true;
        base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, token)
    }
    /// Unpairing: the browser session and the device identity are dropped.
    pub fn forget_pairing(&self) {
        let mut device = self.device_id.writing();
        *self.paired.writing() = false;
        self.sessions.writing().clear();
        *device = None;
        self.clear_work_scope();
        self.relay_generation.send_modify(|generation| *generation = generation.wrapping_add(1));
        drop(device);
        self.cloud_seen_at.store(0, Ordering::Relaxed);
        self.pending_pairing.writing().clear();
        self.pairing_completion.writing().clear();
        self.pairing_failure.writing().clear();
    }
    fn prune_expired_pairing(&self) {
        let now = unix_ms();
        self.pending_pairing
            .writing()
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
            self.origin_allowed(&offer.browser_origin),
            "origin is not configured for Spectra"
        );
        self.prune_expired_pairing();
        self.pairing_failure.writing().remove(&offer.challenge);
        self.pending_pairing
            .writing()
            .insert(offer.challenge.clone(), offer);
        Ok(())
    }
    pub fn take_pairing_offer(&self, challenge: &str) -> anyhow::Result<PairingOffer> {
        self.prune_expired_pairing();
        let offer = self
            .pending_pairing
            .writing()
            .remove(challenge)
            .ok_or_else(|| anyhow::anyhow!("no pairing is waiting"))?;
        anyhow::ensure!(offer.expires_at > unix_ms(), "pairing offer expired");
        Ok(offer)
    }
    pub fn is_paired(&self) -> bool {
        *self.paired.reading()
    }
    pub fn complete_pairing(&self, challenge: String, origin: String) -> String {
        let token = self.prepare_pairing_session(&origin);
        self.complete_pairing_with_session(challenge, origin, &token)
            .expect("prepared pairing session is valid");
        token
    }
    /// Preparing does not expose a session until its durable settings commit.
    pub fn prepare_pairing_session(&self, origin: &str) -> String {
        self.resume_session(origin).unwrap_or_else(|| {
            let mut token = [0_u8; 32];
            rand::rng().fill_bytes(&mut token);
            base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, token)
        })
    }
    pub fn complete_pairing_with_session(
        &self,
        challenge: String,
        origin: String,
        token: &str,
    ) -> anyhow::Result<()> {
        self.restore_pairing(origin, token)?;
        self.pairing_completion
            .writing()
            .insert(challenge, token.to_owned());
        Ok(())
    }
    pub fn complete_pairing_with_session_for(&self, identity: &LocalRelayIdentity, challenge: String, origin: String, token: &str) -> anyhow::Result<()> {
        let device = self.device_id.reading();
        anyhow::ensure!(device.as_deref() == Some(identity.device_id.as_str()) && self.relay_generation.borrow().to_string() == identity.generation, "Pairing changed before completion");
        self.complete_pairing_with_session(challenge, origin, token)
    }
    /// A pairing attempt ended without pairing; the page reads why once.
    pub fn fail_pairing(&self, challenge: String, reason: String) {
        self.pairing_failure
            .writing()
            .insert(challenge, reason);
    }
    pub fn restore_pairing(&self, origin: String, token: &str) -> anyhow::Result<()> {
        let decoded =
            base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, token)?;
        anyhow::ensure!(decoded.len() == 32, "invalid stored browser session");
        self.allowed_origins.writing().insert(origin.clone());
        self.sessions.writing().insert(origin, decoded);
        *self.paired.writing() = true;
        Ok(())
    }
    /// Every session as the journal keeps it, with one about to be committed.
    pub fn sessions_json_with(&self, origin: &str, token: &str) -> String {
        let encode = |bytes: &Vec<u8>| {
            base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, bytes)
        };
        let mut stored: HashMap<String, String> = self
            .sessions
            .reading()
            .iter()
            .map(|(origin, token)| (origin.clone(), encode(token)))
            .collect();
        stored.insert(origin.to_owned(), token.to_owned());
        serde_json::to_string(&stored).unwrap_or_else(|_| "{}".into())
    }
    /// A session that can't be read is dropped; its browser joins again on its own.
    pub fn restore_sessions(&self, json: &str) {
        let Ok(stored) = serde_json::from_str::<HashMap<String, String>>(json) else {
            return;
        };
        for (origin, token) in stored {
            let _ = self.restore_pairing(origin, &token);
        }
    }
    pub fn resume_session(&self, origin: &str) -> Option<String> {
        if !self.is_paired() || !self.allowed_origins.reading().contains(origin) {
            return None;
        }
        let sessions = self.sessions.reading();
        let token = sessions.get(origin)?;
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
        self.sessions
            .reading()
            .values()
            .any(|expected| session_matches(expected, &supplied))
    }
    fn origin_session_matches(&self, origin: &str, supplied: &[u8]) -> bool {
        self.is_paired()
            && self
                .sessions
                .reading()
                .get(origin)
                .is_some_and(|expected| session_matches(expected, supplied))
    }
    pub fn resume_session_with_token(&self, origin: &str, token: &str) -> Option<String> {
        let supplied =
            base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, token)
                .unwrap_or_default();
        if !self.origin_session_matches(origin, &supplied) {
            return None;
        }
        self.resume_session(origin)
    }
    pub fn local_status(&self) -> LocalBridgeStatus {
        let snapshot = self
            .local_control
            .reading()
            .as_ref()
            .map(|control| control.snapshot())
            .unwrap_or_default();
        LocalBridgeStatus {
            version: env!("CARGO_PKG_VERSION").into(),
            protocol_version: crate::PROTOCOL_VERSION.into(),
            paired: self.is_paired(),
            cloud_connected: self.cloud_connected(),
            device_id: self.device_id.reading().clone(),
            device_name: snapshot.device_name,
            paused: snapshot.paused,
            last_sync_at: snapshot.last_sync_at,
            mounts: snapshot.mounts,
            office_files: snapshot.office_files,
        }
    }
    fn take_pairing_completion(&self, challenge: &str) -> Option<String> {
        self.pairing_completion.writing().remove(challenge)
    }
    fn take_pairing_failure(&self, challenge: &str) -> Option<String> {
        self.pairing_failure.writing().remove(challenge)
    }
    fn control(&self) -> Option<Arc<dyn LocalBridgeControl>> {
        self.local_control.reading().clone()
    }
}

fn session_matches(expected: &[u8], supplied: &[u8]) -> bool {
    expected.len() == 32 && supplied.len() == 32 && bool::from(supplied.ct_eq(expected))
}

pub fn router(state: Arc<ServerState>) -> Router {
    let protected = Router::new()
        .route("/v1/status", get(status))
        .route("/v1/mount/select", post(select_mount))
        .route("/v1/files/select", post(select_files))
        .route("/v1/files/sync-named", post(sync_named))
        .route("/v1/mount/retry", post(retry_mount))
        .route("/v1/mount/remove", post(remove_mount))
        .route("/v1/mount/pause", post(pause_mount))
        .route("/v1/sync/pause", post(pause_sync))
        .route("/v1/logs/open", post(open_logs))
        .route("/v1/file/open", post(open_file))
        .route("/v1/file/reveal", post(reveal_file))
        .route("/v1/unpair", post(unpair))
        .route("/v1/agent/hub", post(set_agent_hub))
        .route("/v1/works/call", post(works_call))
        .route_layer(middleware::from_fn_with_state(state.clone(), authenticate));
    let cors_state = state.clone();
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/agent/identity", get(local_relay_identity))
        .route("/v1/agent/connect", get(crate::agent_relay::connect))
        .route("/v1/agent/mcp/{id}", post(crate::agent_relay::mcp))
        .route("/v1/rooms", get(open_room_socket))
        .route("/v1/store", get(crate::agent_relay::store_socket))
        .route("/v1/pair", post(pair_offer))
        .route("/v1/pair/status", post(pair_status))
        .route("/v1/session/resume", post(resume))
        .route("/v1/update", post(request_update))
        .merge(protected)
        .layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::predicate(move |origin, _| {
                    origin.to_str().is_ok_and(|value| cors_state.origin_allowed(value))
                }))
                .allow_methods([http::Method::GET, http::Method::POST])
                .allow_headers([http::header::AUTHORIZATION, http::header::CONTENT_TYPE])
                // A hosted page reaching this computer: browsers ask first.
                .allow_private_network(true),
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
        paired: *state.paired.reading(),
        protocol_version: crate::PROTOCOL_VERSION.into(),
        port: crate::BRIDGE_PORT,
        bind_error: state.bind_error.reading().clone(),
    })
}

async fn local_relay_identity(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    if headers.contains_key("origin") {
        return (StatusCode::FORBIDDEN, "Not for browsers").into_response();
    }
    let token = headers.get("authorization").and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer ")).unwrap_or_default();
    if !crate::agent_relay::relay_token_matches(token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    match (state.local_relay_identity(), state.work_account()) {
        (Some(identity), Some((deployment, account))) => Json(serde_json::json!({ "deviceId": identity.device_id, "generation": identity.generation, "deployment": deployment, "accountId": account })).into_response(),
        _ => (StatusCode::SERVICE_UNAVAILABLE, "Bridge's work account is not ready").into_response(),
    }
}

/// A socket to this computer's rooms. Browsers can't set headers on one, so it
/// proves itself in its first message: a paired browser with its session, and
/// the local server with the relay token.
async fn open_room_socket(
    State(state): State<Arc<ServerState>>,
    Query(identity): Query<LocalRelayIdentity>,
    headers: HeaderMap,
    socket: WebSocketUpgrade,
) -> Response {
    let origin = headers.get("origin").and_then(|value| value.to_str().ok()).map(str::to_string);
    if origin.is_none() && !state.local_relay_matches(&identity) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let revoked = state.relay_changes();
    let Some(rooms) = state.work_rooms() else {
        return (StatusCode::SERVICE_UNAVAILABLE, "Work on this computer isn't available").into_response();
    };
    let authorize: crate::rooms::Authorize = Arc::new(move |token: &str| match &origin {
        Some(origin) => {
            let supplied = base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, token)
                .unwrap_or_default();
            state.origin_session_matches(origin, &supplied)
        }
        None => state.local_relay_matches(&identity) && crate::agent_relay::relay_token_matches(token),
    });
    socket
        .protocols([crate::rooms::FRAME_PROTOCOL])
        .max_message_size(crate::rooms::FRAME_BYTES + 64)
        .max_frame_size(crate::rooms::FRAME_BYTES + 64)
        .on_upgrade(move |socket| crate::rooms::serve_browser(socket, rooms, authorize, revoked))
}

/// One request about stored work, from a paired browser.
async fn works_call(State(state): State<Arc<ServerState>>, body: String) -> Response {
    let mut revoked = state.relay_changes();
    let Some(rooms) = state.work_rooms() else {
        return (StatusCode::SERVICE_UNAVAILABLE, "Work on this computer isn't available").into_response();
    };
    let reply = tokio::select! {
        biased;
        _ = revoked.changed() => return (StatusCode::UNAUTHORIZED, "Bridge pairing changed").into_response(),
        reply = crate::rooms::answer_store_request(rooms, body) => reply,
    };
    (
        [(http::header::CONTENT_TYPE, "application/json")],
        reply,
    )
        .into_response()
}

async fn status(State(state): State<Arc<ServerState>>) -> Response {
    // Reading the journal waits for its lock; a long sync must not hold this thread.
    match tokio::task::spawn_blocking(move || state.local_status()).await {
        Ok(status) => Json::<LocalBridgeStatus>(status).into_response(),
        Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, "Status is unavailable").into_response(),
    }
}

async fn select_mount(State(state): State<Arc<ServerState>>) -> Response {
    match state.control() {
        Some(control) => match control.select_mount().await {
            Ok(grant_id) => Json(serde_json::json!({ "grantId": grant_id })).into_response(),
            Err(error) => (StatusCode::BAD_REQUEST, error).into_response(),
        },
        None => controls_not_ready(),
    }
}

async fn select_files(State(state): State<Arc<ServerState>>) -> Response {
    match state.control() {
        Some(control) => match control.select_files().await {
            Ok(selection) => Json(selection).into_response(),
            Err(error) => (StatusCode::BAD_REQUEST, error).into_response(),
        },
        None => controls_not_ready(),
    }
}

#[derive(serde::Deserialize)]
struct NamedPath {
    path: String,
}

async fn sync_named(State(state): State<Arc<ServerState>>, Json(named): Json<NamedPath>) -> Response {
    match state.control() {
        Some(control) => match control.sync_named(&named.path).await {
            Ok(grant_id) => Json(serde_json::json!({ "grantId": grant_id })).into_response(),
            Err(error) => (StatusCode::BAD_REQUEST, error).into_response(),
        },
        None => controls_not_ready(),
    }
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

#[derive(serde::Deserialize)]
struct AgentHubChoice {
    enabled: bool,
}

/// The user picked their own runtime in Spectra, on this computer.
async fn set_agent_hub(Json(input): Json<AgentHubChoice>) -> Response {
    match crate::agent_relay::set_hub_enabled(input.enabled) {
        Ok(()) => Json(serde_json::json!({ "enabled": input.enabled })).into_response(),
        Err(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
    }
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

/// Accepts an offer and pairs in the background; the page polls
/// `/v1/pair/status` for the outcome. Pairing is silent, so the offer must
/// come from a page of an allowed origin, and from the origin it names: the
/// browser sets `Origin` and a page cannot forge it.
async fn pair_offer(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(offer): Json<PairingOffer>,
) -> Response {
    let origin = headers.get("origin").and_then(|value| value.to_str().ok());
    if origin != Some(offer.browser_origin.as_str()) || !state.origin_allowed(&offer.browser_origin) {
        return (StatusCode::FORBIDDEN, "PAIRING_ORIGIN_REFUSED").into_response();
    }
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

/// Spectra's Devices page may ask for the update now. A page elsewhere may not,
/// and no page may ask more than once in ten minutes. The tray and the native
/// app call `request_update` directly, without `Origin`.
async fn request_update(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    if let Some(origin) = headers.get("origin") {
        if !origin.to_str().is_ok_and(|value| state.origin_allowed(value)) {
            return (StatusCode::FORBIDDEN, "Not for this page").into_response();
        }
    }
    let now = unix_ms();
    let last = state.update_requested_at.load(Ordering::Acquire);
    if last > 0 && now.saturating_sub(last) < UPDATE_REQUEST_INTERVAL_MS
        || state.update_requested_at.compare_exchange(last, now, Ordering::AcqRel, Ordering::Acquire).is_err()
    {
        return (StatusCode::TOO_MANY_REQUESTS, "An update was asked for a moment ago").into_response();
    }
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
    let allowed = origin.is_some_and(|value| state.allowed_origins.reading().contains(value));
    let supplied = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .and_then(|v| {
            base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, v).ok()
        })
        .unwrap_or_default();
    let token_ok = origin.is_some_and(|value| state.origin_session_matches(value, &supplied));
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
            *state.bind_error.writing() = Some(format!(
                "Port {} is unavailable: {error}",
                crate::BRIDGE_PORT
            ));
            anyhow::bail!(
                "Spectra Bridge cannot bind fixed port {}: {error}",
                crate::BRIDGE_PORT
            );
        }
    };
    crate::agent_relay::prepare();
    state.listening.store(true, Ordering::Release);
    axum::serve(listener, router(state)).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{LocalMountStatus, LocalOfficeFile};
    use std::sync::Mutex;
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    const ORIGIN: &str = "http://localhost:3000";

    #[tokio::test]
    async fn local_relay_identity_and_channels_stay_bound_to_the_pairing() {
        let state = Arc::new(ServerState::unpaired());
        let base = spawn(state.clone()).await;
        let client = reqwest::Client::new();
        let identity_url = format!("{base}/v1/agent/identity");
        let token = "dummy-local-relay-test-token";
        assert_eq!(client.get(&identity_url).send().await.unwrap().status(), 401);
        assert_eq!(client.get(&identity_url).bearer_auth(token).header("origin", ORIGIN).send().await.unwrap().status(), 403);
        assert_eq!(client.get(&identity_url).bearer_auth(token).send().await.unwrap().status(), 503);
        state.pair(ORIGIN.into());
        state.set_device_id("device-1".into());
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("works.db");
        state.prepare_work_rooms(&state.pairing_identity().unwrap(), path.clone(), path, "http://fixture".into(), "fixture-only".into(), "account-1".into()).await.unwrap();
        let identity: LocalRelayIdentity = client.get(&identity_url).bearer_auth(token).send().await.unwrap().json().await.unwrap();
        let request = |path: &str, identity: &LocalRelayIdentity, protocol: &str| {
            let separator = if path.contains('?') { '&' } else { '?' };
            let url = format!("{}{path}{separator}deviceId={}&generation={}", base.replacen("http", "ws", 1), identity.device_id, identity.generation);
            let mut request = url.into_client_request().unwrap();
            request.headers_mut().insert("sec-websocket-protocol", format!("{protocol}, {token}").parse().unwrap());
            request
        };
        let wrong = LocalRelayIdentity { device_id: "device-2".into(), ..identity.clone() };
        for (path, protocol) in [("/v1/store", "spectra-agent"), ("/v1/agent/connect?provider=codex", "spectra-agent"), ("/v1/rooms", crate::rooms::FRAME_PROTOCOL)] {
            let error = tokio_tungstenite::connect_async(request(path, &wrong, protocol)).await.unwrap_err();
            assert!(matches!(error, tokio_tungstenite::tungstenite::Error::Http(response) if response.status() == StatusCode::FORBIDDEN));
        }
        let (mut store, _) = tokio_tungstenite::connect_async(request("/v1/store", &identity, "spectra-agent")).await.unwrap();
        store.send(tokio_tungstenite::tungstenite::Message::Text(r#"{"id":1,"method":"summary","params":{}}"#.into())).await.unwrap();
        assert!(store.next().await.unwrap().unwrap().into_text().unwrap().contains("storeId"));
        let (mut room, _) = tokio_tungstenite::connect_async(request("/v1/rooms", &identity, crate::rooms::FRAME_PROTOCOL)).await.unwrap();
        let cli_request = request("/v1/agent/connect?provider=codex", &identity, "spectra-agent");
        let (mut cli, _) = tokio_tungstenite::connect_async(cli_request).await.unwrap();
        // No start frame is sent, so this test never launches a real CLI.
        state.forget_pairing();
        for closed in [
            tokio::time::timeout(std::time::Duration::from_secs(2), store.next()).await,
            tokio::time::timeout(std::time::Duration::from_secs(2), room.next()).await,
            tokio::time::timeout(std::time::Duration::from_secs(2), cli.next()).await,
        ] {
            assert!(!matches!(closed.unwrap(), Some(Ok(message)) if !message.is_close()));
        }
        state.pair(ORIGIN.into());
        state.set_device_id("device-1".into());
        assert!(!state.local_relay_matches(&identity));
        assert_ne!(state.local_relay_identity().unwrap().generation, identity.generation);
    }

    #[tokio::test]
    async fn re_pairing_keeps_work_private_and_reuses_the_same_accounts_room_map() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("works.db");
        let state = Arc::new(ServerState::unpaired());
        let base = spawn(state.clone()).await;
        let client = reqwest::Client::new();
        let call = |token: &str, method: &str, params: serde_json::Value| client.post(format!("{base}/v1/works/call")).header("origin", ORIGIN).bearer_auth(token).json(&serde_json::json!({"id":1,"method":method,"params":params})).send();
        state.set_device_id("device-a".into());
        let a = state.pairing_identity().unwrap();
        let token_a = state.pair(ORIGIN.into());
        // No global/empty store may be exposed before migration succeeds.
        assert_eq!(call(&token_a, "summary", serde_json::json!({})).await.unwrap().status(), 503);
        state.prepare_work_rooms(&a, path.clone(), path.clone(), "http://fixture".into(), "fixture-a".into(), "a".into()).await.unwrap();
        let rooms_a = state.work_rooms().unwrap();
        let saved: serde_json::Value = call(&token_a, "save", serde_json::json!({"artifactId":"a-work","projection":{"title":"A's work","owner":"b"}})).await.unwrap().json().await.unwrap();
        assert_eq!(saved["result"]["ok"], true);
        // A second browser joining the same verified device must not retire
        // the active run/room authority or hide the already-open work store.
        state.set_device_id("device-a".into());
        assert!(state.local_relay_matches(&a));
        assert!(Arc::ptr_eq(&rooms_a, &state.work_rooms().unwrap()));
        assert_eq!(call(&token_a, "summary", serde_json::json!({})).await.unwrap().status(), 200);
        state.set_device_id("device-b".into());
        assert!(!state.is_paired());
        assert!(state.work_rooms().is_none());
        assert_eq!(call(&token_a, "summary", serde_json::json!({})).await.unwrap().status(), 401);
        let b = state.pairing_identity().unwrap();
        let token_b = state.pair(ORIGIN.into());
        state.prepare_work_rooms(&b, path.clone(), path.clone(), "http://fixture".into(), "fixture-b".into(), "b".into()).await.unwrap();
        let hidden: serde_json::Value = call(&token_b, "get", serde_json::json!({"artifactId":"a-work"})).await.unwrap().json().await.unwrap();
        assert!(hidden["result"].is_null());
        assert!(!Arc::ptr_eq(&rooms_a, &state.work_rooms().unwrap()));
        assert!(state.prepare_work_rooms(&a, path.clone(), path.clone(), "http://fixture".into(), "fixture-a".into(), "a".into()).await.is_err());
        assert_eq!(state.work_account().unwrap().1, "b");
        assert_eq!(call(&token_a, "summary", serde_json::json!({})).await.unwrap().status(), 401);
        state.set_device_id("device-a".into());
        assert_eq!(call(&token_b, "summary", serde_json::json!({})).await.unwrap().status(), 401);
        let token_a = state.pair(ORIGIN.into());
        state.prepare_work_rooms(&state.pairing_identity().unwrap(), path.clone(), path, "http://fixture/".into(), "fixture-a-new".into(), "a".into()).await.unwrap();
        assert!(Arc::ptr_eq(&rooms_a, &state.work_rooms().unwrap()));
        let recovered: serde_json::Value = call(&token_a, "get", serde_json::json!({"artifactId":"a-work"})).await.unwrap().json().await.unwrap();
        assert_eq!(recovered["result"]["title"], "A's work");
        assert_eq!(rooms_a.store().search("work", Some("a"), 10).unwrap().len(), 1);
        assert!(rooms_a.store().search("work", Some("b"), 10).unwrap().is_empty());
        // A new verified owner for the same pairing must retire the old scope.
        let current = state.pairing_identity().unwrap();
        assert!(state.prepare_work_rooms(&current, root.path().join("works.db"), root.path().join("works.db"), "http://fixture".into(), "fixture-b".into(), "b".into()).await.is_err());
        assert!(state.work_rooms().is_none());
        assert!(!state.local_relay_matches(&current));
    }

    #[test]
    fn same_device_rejoin_and_startup_preserve_sessions_but_switching_rotates_them() {
        let state = ServerState::unpaired();
        let first = state.pair(ORIGIN.into());
        state.set_device_id("device-a".into());
        state.set_device_id("device-a".into());
        assert_eq!(state.prepare_pairing_session(ORIGIN), first);
        state.set_device_id("device-b".into());
        let second = state.prepare_pairing_session(ORIGIN);
        assert_ne!(first, second);
        let restored = ServerState::unpaired();
        restored.restore_sessions(&state.sessions_json_with(ORIGIN, &second));
        restored.set_device_id("device-b".into());
        assert_eq!(restored.resume_session_with_token(ORIGIN, &first), None);
        assert_eq!(restored.resume_session_with_token(ORIGIN, &second), Some(second));
    }

    #[test]
    fn a_cancelled_pairing_cannot_publish_its_browser_session() {
        let state = ServerState::unpaired();
        state.set_device_id("device-a".into());
        let identity = state.pairing_identity().unwrap();
        let token = state.prepare_pairing_session(ORIGIN);
        state.forget_pairing();
        state.set_device_id("device-b".into());
        assert!(state.complete_pairing_with_session_for(&identity, "old-offer".into(), ORIGIN.into(), &token).is_err());
        assert!(!state.is_paired());
        let current = state.pairing_identity().unwrap();
        state.complete_pairing_with_session_for(&current, "current-offer".into(), ORIGIN.into(), &token).unwrap();
        assert!(state.is_paired());
    }

    #[tokio::test]
    async fn migration_finishing_after_re_pairing_cannot_publish_the_old_account() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("works.db");
        let legacy = crate::works::WorkStore::open(&path).unwrap();
        legacy.save_projection("a-work", &crate::works::Projection { title: Some("Private A work".into()), ..Default::default() }).unwrap();
        let entered = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let waiting = entered.clone(); let released = release.clone();
        let router = Router::new().route("/api/query", post(move |Json(request): Json<serde_json::Value>| {
            let waiting = waiting.clone(); let released = released.clone();
            async move {
                assert_eq!(request["args"]["credential"], "fixture-a");
                waiting.notify_one();
                released.notified().await;
                Json(serde_json::json!({"status":"success","value":{"accountId":"a","artifactIds":["a-work"]}}))
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let deployment = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap(); });
        let state = Arc::new(ServerState::unpaired());
        state.set_device_id("device-a".into());
        state.pair(ORIGIN.into());
        let identity = state.pairing_identity().unwrap();
        let preparing = state.clone(); let target = path.clone(); let cloud = deployment.clone();
        let task = tokio::spawn(async move { preparing.prepare_work_rooms(&identity, target.clone(), target, cloud, "fixture-a".into(), "a".into()).await });
        tokio::time::timeout(std::time::Duration::from_secs(2), entered.notified()).await.unwrap();
        state.forget_pairing();
        state.set_device_id("device-b".into());
        state.pair(ORIGIN.into());
        release.notify_one();
        assert!(task.await.unwrap().is_err());
        assert!(state.work_rooms().is_none());
        // A's private copy can survive cancellation; the legacy source stays.
        assert_eq!(legacy.work("a-work").unwrap().unwrap()["title"], "Private A work");
        let recovered = crate::works::WorkStore::for_account(&path, &deployment, "a").unwrap();
        assert_eq!(recovered.work("a-work").unwrap().unwrap()["title"], "Private A work");
        server.abort();
    }

    #[tokio::test]
    async fn unpairing_cancels_a_browser_restore_waiting_for_ownership() {
        let entered = Arc::new(tokio::sync::Notify::new());
        let waiting = entered.clone();
        let cloud = Router::new().route("/api/query", post(move || {
            let waiting = waiting.clone();
            async move { waiting.notify_one(); std::future::pending::<Json<serde_json::Value>>().await }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let deployment = format!("http://{}", listener.local_addr().unwrap());
        let cloud = tokio::spawn(async move { axum::serve(listener, cloud).await.unwrap(); });
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("works.db");
        let state = Arc::new(ServerState::unpaired());
        state.set_device_id("device-a".into());
        let token = state.pair(ORIGIN.into());
        state.prepare_work_rooms(&state.pairing_identity().unwrap(), path.clone(), path, deployment, "fixture-only".into(), "a".into()).await.unwrap();
        let rooms = state.work_rooms().unwrap();
        let backup = crate::works::WorkStore::in_memory().unwrap();
        backup.save_projection("a-work", &crate::works::Projection { title: Some("From backup".into()), ..Default::default() }).unwrap();
        let bundle = backup.backup_bundle(true).unwrap().0;
        let bundle = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bundle);
        let base = spawn(state.clone()).await;
        let response = tokio::spawn(async move { reqwest::Client::new().post(format!("{base}/v1/works/call")).header("origin", ORIGIN).bearer_auth(token).json(&serde_json::json!({"id":1,"method":"restore","params":{"bundleBase64":bundle}})).send().await.unwrap() });
        tokio::time::timeout(std::time::Duration::from_secs(2), entered.notified()).await.unwrap();
        state.forget_pairing();
        assert_eq!(tokio::time::timeout(std::time::Duration::from_secs(2), response).await.unwrap().unwrap().status(), 401);
        assert!(rooms.store().work("a-work").unwrap().is_none());
        cloud.abort();
    }

    #[test]
    fn development_origins_are_exact_loopback_hosts() {
        for origin in [
            "http://localhost:3160",
            "http://127.0.0.1:3180",
            "https://localhost:3000",
        ] {
            assert!(is_local_development_origin(origin));
        }
        for origin in [
            "http://localhost.evil.test:3160",
            "http://evil.test",
            "file:///etc/passwd",
            "http://localhost:3160/path",
            "http://user@localhost:3160",
        ] {
            assert!(!is_local_development_origin(origin));
        }
    }

    #[tokio::test]
    async fn fresh_local_instance_can_discover_but_cannot_read_files_before_pairing() {
        let state = Arc::new(ServerState::unpaired());
        let base = spawn(state.clone()).await;
        let client = reqwest::Client::new();
        let origin = "http://localhost:3160";
        let health = client.get(format!("{base}/v1/health")).header("origin", origin).send().await.unwrap();
        assert_eq!(health.headers().get("access-control-allow-origin").unwrap(), origin);
        let status = client.get(format!("{base}/v1/status")).header("origin", origin).send().await.unwrap();
        assert_eq!(status.status(), 401);
        let token = state.pair(origin.into());
        let status = client.get(format!("{base}/v1/status")).header("origin", origin).bearer_auth(token).send().await.unwrap();
        assert_eq!(status.headers().get("access-control-allow-origin").unwrap(), origin);
        assert_ne!(status.status(), 401);
    }

    #[derive(Default)]
    struct FakeControl {
        calls: Mutex<Vec<String>>,
        decline_pairing: bool,
    }

    #[async_trait]
    impl LocalBridgeControl for FakeControl {
        async fn auto_pair(&self, challenge: &str) -> Result<(), String> {
            self.calls.locked().push(format!("pair:{}", &challenge[..4]));
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
                    selection_kind: None,
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
        async fn select_mount(&self) -> Result<Option<String>, String> {
            self.calls.locked().push("select".into());
            Ok(Some("grant_folder".into()))
        }
        async fn select_files(&self) -> Result<FilesSelected, String> {
            self.calls.locked().push("select-files".into());
            Ok(FilesSelected {
                selected: 2,
                added: vec![crate::fs::SyncedFile {
                    grant_id: "grant_new".into(),
                    relative_path: "new.docx".into(),
                }],
                existing: vec![crate::fs::SyncedFile {
                    grant_id: "grant_folder".into(),
                    relative_path: "unit 1/essay.docx".into(),
                }],
            })
        }
        async fn retry_mount(&self, grant_id: &str) -> Result<(), String> {
            self.calls.locked().push(format!("retry:{grant_id}"));
            Ok(())
        }
        async fn remove_mount(&self, grant_id: &str) -> Result<(), String> {
            self.calls.locked().push(format!("remove:{grant_id}"));
            Ok(())
        }
        async fn set_mount_paused(&self, grant_id: &str, paused: bool) -> Result<(), String> {
            self.calls
                .locked()
                .push(format!("pause-mount:{grant_id}:{paused}"));
            Ok(())
        }
        async fn set_sync_paused(&self, paused: bool) -> Result<(), String> {
            self.calls.locked().push(format!("pause:{paused}"));
            Ok(())
        }
        async fn open_logs(&self) -> Result<(), String> {
            self.calls.locked().push("logs".into());
            Ok(())
        }
        async fn open_file(&self, grant_id: &str, relative_path: &str) -> Result<(), String> {
            self.calls.locked().push(format!("open:{grant_id}:{relative_path}"));
            if relative_path.ends_with(".exe") {
                return Err("Spectra opens documents only.".into());
            }
            Ok(())
        }
        async fn reveal_file(&self, grant_id: &str, relative_path: &str) -> Result<(), String> {
            self.calls.locked().push(format!("reveal:{grant_id}:{relative_path}"));
            Ok(())
        }
        async fn unpair(&self) -> Result<(), String> {
            self.calls.locked().push("unpair".into());
            Ok(())
        }
    }

    fn offer(challenge: char, code: &str) -> PairingOffer {
        PairingOffer {
            challenge: challenge.to_string().repeat(64),
            short_code: code.into(),
            browser_origin: ORIGIN.into(),
            expires_at: unix_ms() + 60_000,
            deployment_url: None,
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
        assert!(state.allowed_origins.reading().contains(ORIGIN));
    }
    #[test]
    fn pairing_session_restores_after_process_restart() {
        let original = ServerState::unpaired();
        let token = original.pair(ORIGIN.into());
        let restored = ServerState::unpaired();
        restored.restore_pairing(ORIGIN.into(), &token).unwrap();
        assert!(*restored.paired.reading());
        assert_eq!(
            *restored.sessions.reading(),
            *original.sessions.reading()
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
                    deployment_url: None,
                })
                .unwrap();
        }
        let first = state.take_pairing_offer(&"0".repeat(64)).unwrap();
        assert_eq!(first.short_code, "000000");
        assert_eq!(state.pending_pairing.reading().len(), 5);
        assert!(state.take_pairing_offer(&format!("{:0>64}", 5)).is_ok());
    }
    #[test]
    fn a_second_origin_never_ends_the_first_session() {
        let state = ServerState::unpaired();
        let first = state.pair(ORIGIN.into());
        let second = state.pair("http://localhost:3160".into());
        assert_ne!(first, second);
        assert_eq!(state.resume_session(ORIGIN), Some(first.clone()));
        assert_eq!(state.resume_session_with_token(ORIGIN, &first), Some(first.clone()));
        assert_eq!(state.resume_session("http://localhost:3160"), Some(second.clone()));
        // One origin's session doesn't open another's.
        assert_eq!(state.resume_session_with_token(ORIGIN, &second), None);
    }

    #[test]
    fn every_origin_survives_a_restart() {
        let state = ServerState::unpaired();
        let first = state.pair(ORIGIN.into());
        let second = state.prepare_pairing_session("http://localhost:3160");
        let stored = state.sessions_json_with("http://localhost:3160", &second);
        let restored = ServerState::unpaired();
        restored.restore_sessions(&stored);
        assert!(restored.is_paired());
        assert_eq!(restored.resume_session(ORIGIN), Some(first));
        assert_eq!(restored.resume_session("http://localhost:3160"), Some(second));
        let unread = ServerState::unpaired();
        unread.restore_sessions("not json");
        assert!(!unread.is_paired());
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
    fn preparing_a_session_does_not_publish_or_replace_a_pairing() {
        let state = ServerState::unpaired();
        let token = state.prepare_pairing_session(ORIGIN);
        assert!(!state.is_paired());
        assert!(!state.session_token_matches(&token));
        state
            .complete_pairing_with_session("committed".into(), ORIGIN.into(), &token)
            .unwrap();
        assert!(state.session_token_matches(&token));
        let other = state.prepare_pairing_session("http://localhost:3160");
        assert_ne!(token, other);
        assert!(
            state.session_token_matches(&token),
            "a cancelled offer preserves the existing session"
        );
        assert_eq!(state.prepare_pairing_session(ORIGIN), token);
        assert!(
            state
                .complete_pairing_with_session("invalid".into(), ORIGIN.into(), "invalid")
                .is_err()
        );
        assert!(state.take_pairing_completion("invalid").is_none());
        assert!(state.session_token_matches(&token));
    }
    #[test]
    fn disconnect_revokes_even_an_unclaimed_pairing_completion() {
        let state = ServerState::unpaired();
        let token = state.complete_pairing("waiting".into(), ORIGIN.into());
        state.set_device_id("old-device".into());
        state.forget_pairing();
        assert!(!state.session_token_matches(&token));
        assert!(state.take_pairing_completion("waiting").is_none());
        assert!(!state.is_paired());
        assert!(state.local_status().device_id.is_none());
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
            .writing()
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
            "/v1/files/select",
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
        assert!(control.calls.locked().is_empty());
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
            (
                "/v1/mount/pause",
                serde_json::json!({ "grantId": "grant_ab", "paused": true }),
            ),
            (
                "/v1/mount/retry",
                serde_json::json!({ "grantId": "grant_ab" }),
            ),
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
        let selection = post("/v1/files/select", serde_json::json!({}))
            .await
            .unwrap();
        assert_eq!(selection.status(), 200);
        assert_eq!(
            selection.json::<serde_json::Value>().await.unwrap(),
            serde_json::json!({
                "selected": 2,
                "added": [{"grantId": "grant_new", "relativePath": "new.docx"}],
                "existing": [{"grantId": "grant_folder", "relativePath": "unit 1/essay.docx"}],
            })
        );
        assert_eq!(
            post("/v1/unpair", serde_json::json!({}))
                .await
                .unwrap()
                .status(),
            204
        );
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
            *control.calls.locked(),
            vec![
                "pause-mount:grant_ab:true",
                "retry:grant_ab",
                "pause:false",
                "logs",
                "select-files",
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
            *control.calls.locked(),
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
            .header("origin", ORIGIN)
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

    const RELEASE_ORIGIN: &str = "https://spectra.ink";

    #[tokio::test]
    async fn a_release_build_accepts_only_its_baked_origins() {
        let state = Arc::new(ServerState::with_origins([RELEASE_ORIGIN], false));
        state.install_local_control(Arc::new(FakeControl::default()));
        let base = spawn(state.clone()).await;
        let client = reqwest::Client::new();
        let local = "http://localhost:5173";
        let mut offer_from_local = offer('e', "123456");
        offer_from_local.browser_origin = local.into();
        let refused = client.post(format!("{base}/v1/pair")).header("origin", local).json(&offer_from_local).send().await.unwrap();
        assert_eq!(refused.status(), 403);
        let health = client.get(format!("{base}/v1/health")).header("origin", local).send().await.unwrap();
        assert!(health.headers().get("access-control-allow-origin").is_none());
        let mut released = offer('f', "123456");
        released.browser_origin = RELEASE_ORIGIN.into();
        let accepted = client.post(format!("{base}/v1/pair")).header("origin", RELEASE_ORIGIN).json(&released).send().await.unwrap();
        assert_eq!(accepted.status(), 202);
    }

    #[tokio::test]
    async fn a_pairing_offer_must_come_from_the_origin_it_names() {
        let state = Arc::new(ServerState::with_origins([RELEASE_ORIGIN, "https://other.spectra.ink"], false));
        state.install_local_control(Arc::new(FakeControl::default()));
        let base = spawn(state.clone()).await;
        let client = reqwest::Client::new();
        let mut named = offer('g', "123456");
        named.browser_origin = RELEASE_ORIGIN.into();
        let without_origin = client.post(format!("{base}/v1/pair")).json(&named).send().await.unwrap();
        assert_eq!(without_origin.status(), 403);
        let elsewhere = client.post(format!("{base}/v1/pair")).header("origin", "https://other.spectra.ink").json(&named).send().await.unwrap();
        assert_eq!(elsewhere.status(), 403);
        let evil = client.post(format!("{base}/v1/pair")).header("origin", "https://evil.test").json(&named).send().await.unwrap();
        assert_eq!(evil.status(), 403);
        assert!(state.take_pairing_offer(&named.challenge).is_err());
    }

    #[tokio::test]
    async fn only_spectra_can_ask_for_an_update_and_not_often() {
        let state = Arc::new(ServerState::with_origins([RELEASE_ORIGIN], false));
        state.install_local_control(Arc::new(FakeControl::default()));
        let base = spawn(state.clone()).await;
        let client = reqwest::Client::new();
        let foreign = client.post(format!("{base}/v1/update")).header("origin", "https://evil.test").send().await.unwrap();
        assert_eq!(foreign.status(), 403);
        let first = client.post(format!("{base}/v1/update")).header("origin", RELEASE_ORIGIN).send().await.unwrap();
        assert_eq!(first.status(), 200);
        let again = client.post(format!("{base}/v1/update")).header("origin", RELEASE_ORIGIN).send().await.unwrap();
        assert_eq!(again.status(), 429);
    }
}
