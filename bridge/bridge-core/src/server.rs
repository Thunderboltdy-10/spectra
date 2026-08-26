use std::collections::{HashMap, HashSet};
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

use crate::protocol::{HealthResponse, LocalBridgeStatus, LocalMountStatus, PairingOffer};
use tower_http::cors::{AllowOrigin, CorsLayer};

pub struct ServerState {
    paired: RwLock<bool>,
    allowed_origins: RwLock<HashSet<String>>,
    session_token: RwLock<Vec<u8>>,
    bind_error: RwLock<Option<String>>,
    pending_pairing: RwLock<HashMap<String, PairingOffer>>,
    pairing_completion: RwLock<HashMap<String, String>>,
    device_id: RwLock<Option<String>>,
    cloud_seen_at: AtomicU64,
    local_control: RwLock<Option<Arc<dyn LocalBridgeControl>>>,
}

#[async_trait]
pub trait LocalBridgeControl: Send + Sync {
    fn pairing_requested(&self);
    async fn auto_pair(&self, challenge: &str) -> Result<(), String>;
    async fn request_update(&self) -> Result<String, String>;
    fn mounts(&self) -> Vec<LocalMountStatus>;
    async fn select_mount(&self) -> Result<(), String>;
    async fn retry_mount(&self, grant_id: &str) -> Result<(), String>;
    async fn remove_mount(&self, grant_id: &str) -> Result<(), String>;
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
    pub fn pair(&self, origin: String) -> String {
        let mut token = vec![0_u8; 32];
        rand::rng().fill_bytes(&mut token);
        *self.session_token.write().unwrap() = token.clone();
        self.allowed_origins.write().unwrap().insert(origin);
        *self.paired.write().unwrap() = true;
        base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, token)
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
        self.pending_pairing
            .write()
            .unwrap()
            .insert(offer.challenge.clone(), offer);
        if let Some(control) = self.local_control.read().unwrap().as_ref() {
            control.pairing_requested();
        }
        Ok(())
    }
    pub fn confirm_pairing_code(&self, code: &str) -> anyhow::Result<PairingOffer> {
        self.prune_expired_pairing();
        let mut pending = self.pending_pairing.write().unwrap();
        let challenge = pending
            .iter()
            .find(|(_, offer)| offer.short_code == code)
            .map(|(challenge, _)| challenge.clone())
            .ok_or_else(|| anyhow::anyhow!("pairing code does not match"))?;
        Ok(pending
            .remove(&challenge)
            .expect("pairing offer was just found"))
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
    pub fn pending_pairing_code(&self) -> Option<String> {
        self.prune_expired_pairing();
        self.pending_pairing
            .read()
            .unwrap()
            .values()
            .max_by_key(|offer| offer.expires_at)
            .map(|offer| offer.short_code.clone())
    }
    pub fn pending_pairing_codes(&self) -> Vec<String> {
        self.prune_expired_pairing();
        let mut codes: Vec<String> = self
            .pending_pairing
            .read()
            .unwrap()
            .values()
            .map(|offer| offer.short_code.clone())
            .collect();
        codes.sort();
        codes
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
    fn local_status(&self) -> LocalBridgeStatus {
        let cloud_seen_at = self.cloud_seen_at.load(Ordering::Relaxed);
        LocalBridgeStatus {
            version: env!("CARGO_PKG_VERSION").into(),
            protocol_version: crate::PROTOCOL_VERSION.into(),
            paired: self.is_paired(),
            cloud_connected: cloud_seen_at > 0 && unix_ms().saturating_sub(cloud_seen_at) <= 15_000,
            device_id: self.device_id.read().unwrap().clone(),
            mounts: self
                .local_control
                .read()
                .unwrap()
                .as_ref()
                .map(|control| control.mounts())
                .unwrap_or_default(),
        }
    }
    fn take_pairing_completion(&self, challenge: &str) -> Option<String> {
        self.pairing_completion.write().unwrap().remove(challenge)
    }
}

pub fn router(state: Arc<ServerState>) -> Router {
    let protected = Router::new()
        .route("/v1/status", get(status))
        .route("/v1/mount/select", post(select_mount))
        .route("/v1/mount/retry", post(retry_mount))
        .route("/v1/mount/remove", post(remove_mount))
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
    let control = state.local_control.read().unwrap().clone();
    match control {
        Some(control) => match control.select_mount().await {
            Ok(()) => StatusCode::NO_CONTENT.into_response(),
            Err(error) => (StatusCode::BAD_REQUEST, error).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            "Bridge controls are not ready",
        )
            .into_response(),
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MountAction {
    grant_id: String,
}

async fn retry_mount(
    State(state): State<Arc<ServerState>>,
    Json(input): Json<MountAction>,
) -> Response {
    let control = state.local_control.read().unwrap().clone();
    match control {
        Some(control) => match control.retry_mount(&input.grant_id).await {
            Ok(()) => StatusCode::NO_CONTENT.into_response(),
            Err(error) => (StatusCode::BAD_REQUEST, error).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            "Bridge controls are not ready",
        )
            .into_response(),
    }
}

async fn remove_mount(
    State(state): State<Arc<ServerState>>,
    Json(input): Json<MountAction>,
) -> Response {
    let control = state.local_control.read().unwrap().clone();
    match control {
        Some(control) => match control.remove_mount(&input.grant_id).await {
            Ok(()) => StatusCode::NO_CONTENT.into_response(),
            Err(error) => (StatusCode::BAD_REQUEST, error).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            "Bridge controls are not ready",
        )
            .into_response(),
    }
}

async fn pair_offer(
    State(state): State<Arc<ServerState>>,
    Json(offer): Json<PairingOffer>,
) -> Response {
    match state.accept_pairing_offer(offer.clone()) {
        Ok(()) => {
            let control = state.local_control.read().unwrap().clone();
            match control {
                Some(control) => match control.auto_pair(&offer.challenge).await {
                    Ok(()) => StatusCode::NO_CONTENT.into_response(),
                    Err(error) => (StatusCode::BAD_REQUEST, error).into_response(),
                },
                None => (
                    StatusCode::SERVICE_UNAVAILABLE,
                    "Bridge controls are not ready",
                )
                    .into_response(),
            }
        }
        Err(error) => (StatusCode::BAD_REQUEST, error.to_string()).into_response(),
    }
}

async fn request_update(State(state): State<Arc<ServerState>>) -> Response {
    let control = state.local_control.read().unwrap().clone();
    match control {
        Some(control) => match control.request_update().await {
            Ok(message) => Json(serde_json::json!({ "message": message })).into_response(),
            Err(error) => (StatusCode::BAD_REQUEST, error).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            "Bridge controls are not ready",
        )
            .into_response(),
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
    match state.take_pairing_completion(&input.challenge) {
        Some(session_token) => {
            Json(serde_json::json!({ "paired": true, "sessionToken": session_token }))
                .into_response()
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
    #[test]
    fn pairing_mints_unique_tokens_and_pins_origin() {
        let state = ServerState::unpaired();
        let a = state.pair("http://localhost:3000".into());
        let b = state.pair("http://localhost:3000".into());
        assert_ne!(a, b);
        assert!(
            state
                .allowed_origins
                .read()
                .unwrap()
                .contains("http://localhost:3000")
        );
    }
    #[test]
    fn pairing_session_restores_after_process_restart() {
        let original = ServerState::unpaired();
        let token = original.pair("http://localhost:3000".into());
        let restored = ServerState::unpaired();
        restored
            .restore_pairing("http://localhost:3000".into(), &token)
            .unwrap();
        assert!(*restored.paired.read().unwrap());
        assert_eq!(
            *restored.session_token.read().unwrap(),
            *original.session_token.read().unwrap()
        );
    }
    #[test]
    fn pairing_offer_is_consumed_by_spectra_owned_auto_pair_flow() {
        let state = ServerState::unpaired();
        let offer = PairingOffer {
            challenge: "a".repeat(64),
            short_code: "123456".into(),
            browser_origin: "http://localhost:3000".into(),
            expires_at: unix_ms() + 60_000,
        };
        state.accept_pairing_offer(offer.clone()).unwrap();
        assert_eq!(state.take_pairing_offer(&offer.challenge).unwrap(), offer);
        assert!(state.take_pairing_offer(&offer.challenge).is_err());
    }
    #[test]
    fn six_pairing_offers_keep_every_code() {
        let state = ServerState::unpaired();
        for index in 0..6 {
            state
                .accept_pairing_offer(PairingOffer {
                    challenge: format!("{:0>64}", index),
                    short_code: format!("{index:06}"),
                    browser_origin: "http://localhost:3000".into(),
                    expires_at: unix_ms() + 60_000,
                })
                .unwrap();
        }
        assert_eq!(
            state.pending_pairing_codes(),
            vec!["000000", "000001", "000002", "000003", "000004", "000005"]
        );
        let first = state.take_pairing_offer(&"0".repeat(64)).unwrap();
        assert_eq!(first.short_code, "000000");
        assert_eq!(state.pending_pairing_codes().len(), 5);
        assert!(
            state
                .pending_pairing_codes()
                .contains(&"000005".to_string())
        );
    }
    #[test]
    fn complete_pairing_reuses_the_session_for_a_second_tab() {
        let state = ServerState::unpaired();
        let first = state.complete_pairing("a".repeat(64), "http://localhost:3000".into());
        let second = state.complete_pairing("b".repeat(64), "http://localhost:3000".into());
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
    fn wrong_pairing_code_leaves_the_waiting_offer() {
        let state = ServerState::unpaired();
        let offer = PairingOffer {
            challenge: "c".repeat(64),
            short_code: "654321".into(),
            browser_origin: "http://localhost:3000".into(),
            expires_at: unix_ms() + 60_000,
        };
        state.accept_pairing_offer(offer.clone()).unwrap();
        assert!(state.confirm_pairing_code("000000").is_err());
        assert_eq!(state.pending_pairing_codes(), vec!["654321"]);
    }
    #[test]
    fn paired_session_can_resume_only_for_an_allowed_origin() {
        let state = ServerState::unpaired();
        let token = state.pair("http://localhost:3000".into());
        assert_eq!(state.resume_session("http://localhost:3000"), Some(token));
        assert_eq!(state.resume_session("http://evil.test"), None);
        assert_eq!(
            state.resume_session_with_token("http://localhost:3000", "wrong"),
            None
        );
    }
    #[test]
    fn unpaired_empty_token_cannot_authenticate_or_resume() {
        let state = ServerState::unpaired();
        assert!(!state.session_token_matches(""));
        assert_eq!(
            state.resume_session_with_token("http://localhost:3000", ""),
            None
        );
    }
}
