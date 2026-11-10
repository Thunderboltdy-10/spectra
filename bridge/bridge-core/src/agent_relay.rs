//! A stdio relay to the user's own `codex` and `claude` CLIs.
//!
//! The Bridge knows nothing about either protocol: it starts the CLI in a
//! private empty folder and passes newline-framed JSON both ways. The CLI's own
//! login is what authorises inference, so no provider credential ever passes
//! through here. When the far side goes away the process is killed.
//!
//! A session reaches this relay one of two ways:
//! - a local server connects to `/v1/agent/connect` with the token file, or
//! - a deployed server goes through the hub in the collaboration gateway. The
//!   Bridge dials out, so nothing on this computer accepts a connection from
//!   the internet. It only dials once the user has chosen their own runtime on
//!   this computer.
//!
//! Claude reaches Spectra's tools over MCP. That endpoint is local too, and its
//! requests travel back over the session's own connection, so a deployed server
//! needs no public address the CLI could call.
//!
//! Browsers always send an Origin header, so any local request carrying one is
//! refused.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use futures_util::{SinkExt, StreamExt};
use rand::RngCore;
use serde::Deserialize;
use subtle::ConstantTimeEq;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::Message as HubMessage;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;

const PROTOCOL: &str = "spectra-agent";
/// Provider frames can carry whole documents.
const MAX_FRAME_BYTES: usize = 64 * 1024 * 1024;
/// Keys that would silently move the session off the user's subscription.
const REMOVED_ENV: [&str; 6] = [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
];
/// A tool call can wait on the user's approval.
const MCP_REPLY_TIMEOUT: Duration = Duration::from_secs(60 * 30);
const LOCAL_ORIGIN: &str = "http://127.0.0.1:47615";
const HUB_BACKOFF_MAX: Duration = Duration::from_secs(60);
/// A connection that lasted this long was healthy, whatever ended it.
const HUB_STABLE_AFTER: Duration = Duration::from_secs(30);
/// The deployment has no hub, as on a local stack. Ask again later.
const HUB_UNCONFIGURED_WAIT: Duration = Duration::from_secs(60 * 10);

fn relay_root() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(base).join("Spectra"))
}

#[cfg(not(test))]
fn relay_token() -> Option<&'static str> {
    static TOKEN: OnceLock<Option<String>> = OnceLock::new();
    TOKEN
        .get_or_init(|| {
            let root = relay_root()?;
            std::fs::create_dir_all(&root).ok()?;
            let path = root.join("agent-relay.token");
            if let Ok(existing) = std::fs::read_to_string(&path) {
                let existing = existing.trim().to_string();
                if existing.len() == 64 {
                    return Some(existing);
                }
            }
            let token = random_hex();
            std::fs::write(&path, &token).ok()?;
            Some(token)
        })
        .as_deref()
}

// Unit-test servers must never read or replace the installed Bridge's token.
#[cfg(test)]
fn relay_token() -> Option<&'static str> { Some("dummy-local-relay-test-token") }

fn random_hex() -> String {
    let mut bytes = [0_u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// Writes the token file at start so a local server can read it before connecting.
pub fn prepare() {
    let _ = relay_token();
}

#[derive(Deserialize)]
pub struct ConnectQuery {
    provider: String,
    #[serde(flatten)]
    identity: crate::server::LocalRelayIdentity,
}

#[derive(Deserialize)]
struct StartFrame {
    args: Vec<String>,
    /// Written to a private file; `{{system}}` in the args becomes its path.
    #[serde(default)]
    system: Option<String>,
    /// Asks for a tool endpoint; `{{mcp}}` in the args becomes its local URL.
    #[serde(default)]
    mcp: bool,
}

fn executable(provider: &str) -> Option<&'static str> {
    match provider {
        "codex" => Some("codex"),
        "claude" => Some("claude"),
        _ => None,
    }
}

/// The only ways Spectra starts these programs.
fn args_allowed(program: &str, args: &[String]) -> bool {
    let first = args.first().map(String::as_str);
    match program {
        "codex" => matches!(first, Some("app-server")),
        "claude" => {
            matches!(first, Some("auth")) || (matches!(first, Some("-p")) && claude_is_confined(args))
        }
        _ => false,
    }
}

/// A prompt session must have its own tools off and its config isolated.
fn claude_is_confined(args: &[String]) -> bool {
    let tools_off = args
        .windows(2)
        .any(|pair| pair[0] == "--tools" && pair[1].is_empty());
    tools_off && args.iter().any(|arg| arg == "--strict-mcp-config")
}

pub fn relay_token_matches(candidate: &str) -> bool {
    relay_token().is_some_and(|expected| {
        candidate.len() == expected.len() && bool::from(candidate.as_bytes().ct_eq(expected.as_bytes()))
    })
}

/// The local server's socket for requests about stored work.
pub async fn store_socket(
    State(state): State<Arc<crate::server::ServerState>>,
    Query(identity): Query<crate::server::LocalRelayIdentity>,
    headers: HeaderMap, socket: WebSocketUpgrade,
) -> Response {
    if headers.contains_key("origin") {
        return (StatusCode::FORBIDDEN, "Not for browsers").into_response();
    }
    let offered = headers
        .get("sec-websocket-protocol")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !offered.split(',').map(str::trim).any(relay_token_matches) {
        return (StatusCode::UNAUTHORIZED, "Agent relay token is wrong").into_response();
    }
    if !state.local_relay_matches(&identity) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut revoked = state.relay_changes();
    let Some(rooms) = state.work_rooms() else {
        return (StatusCode::SERVICE_UNAVAILABLE, "Work on this computer isn't available").into_response();
    };
    socket
        .protocols([PROTOCOL])
        .max_message_size(MAX_FRAME_BYTES)
        .max_frame_size(MAX_FRAME_BYTES)
        .on_upgrade(move |socket| async move {
            let (mut sink, mut stream) = socket.split();
            loop {
                if !state.local_relay_matches(&identity) { return; }
                let incoming = tokio::select! {
                    biased;
                    _ = revoked.changed() => return,
                    incoming = stream.next() => incoming,
                };
                let Some(Ok(message)) = incoming else { return; };
                match message {
                    Message::Text(text) => {
                        if !state.local_relay_matches(&identity) { return; }
                        let reply = tokio::select! {
                            biased;
                            _ = revoked.changed() => return,
                            reply = crate::rooms::answer_store_request(rooms.clone(), text.to_string()) => reply,
                        };
                        if !state.local_relay_matches(&identity) { return; }
                        let sent = tokio::select! {
                            biased;
                            _ = revoked.changed() => return,
                            sent = sink.send(Message::Text(reply.into())) => sent,
                        };
                        if sent.is_err() {
                            return;
                        }
                    }
                    Message::Close(_) => return,
                    _ => {}
                }
            }
        })
}

pub async fn connect(
    State(state): State<Arc<crate::server::ServerState>>,
    Query(query): Query<ConnectQuery>,
    headers: HeaderMap,
    socket: WebSocketUpgrade,
) -> Response {
    if headers.contains_key("origin") {
        return (StatusCode::FORBIDDEN, "Not for browsers").into_response();
    }
    let offered = headers
        .get("sec-websocket-protocol")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let authorized = offered.split(',').map(str::trim).any(relay_token_matches);
    if !authorized {
        return (StatusCode::UNAUTHORIZED, "Agent relay token is wrong").into_response();
    }
    if !state.local_relay_matches(&query.identity) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Some(program) = executable(&query.provider) else {
        return (StatusCode::BAD_REQUEST, "Unknown provider").into_response();
    };
    socket
        .protocols([PROTOCOL])
        .max_message_size(MAX_FRAME_BYTES)
        .max_frame_size(MAX_FRAME_BYTES)
        .on_upgrade(move |socket| local_session(socket, program, state, query.identity))
}

fn relay_note(kind: &str, detail: &str) -> String {
    serde_json::json!({ "relay": kind, "detail": detail }).to_string()
}

async fn local_session(mut socket: WebSocket, program: &'static str, state: Arc<crate::server::ServerState>, identity: crate::server::LocalRelayIdentity) {
    let mut revoked = state.relay_changes();
    if !state.local_relay_matches(&identity) { return; }
    let start = tokio::select! {
        biased;
        _ = revoked.changed() => return,
        start = read_start_local(&mut socket) => start,
    };
    let Some(start) = start else {
        return;
    };
    if !state.local_relay_matches(&identity) { return; }
    let (to_cli, from_far) = mpsc::channel::<String>(64);
    let (to_far, mut from_cli) = mpsc::channel::<String>(64);
    let session = tokio::spawn(run_cli(program, start, from_far, to_far));
    let _cancel_session = AbortOnDrop(session.abort_handle());
    loop {
        if !state.local_relay_matches(&identity) { break; }
        tokio::select! {
            biased;
            _ = revoked.changed() => break,
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    if !state.local_relay_matches(&identity) { break; }
                    let sent = tokio::select! {
                        biased;
                        _ = revoked.changed() => break,
                        sent = to_cli.send(text.to_string()) => sent,
                    };
                    if sent.is_err() {
                        break;
                    }
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
            line = from_cli.recv() => match line {
                Some(line) => {
                    if !state.local_relay_matches(&identity) { break; }
                    let sent = tokio::select! {
                        biased;
                        _ = revoked.changed() => break,
                        sent = socket.send(Message::Text(line.into())) => sent,
                    };
                    if sent.is_err() {
                        break;
                    }
                }
                None => break,
            },
        }
    }
    session.abort();
}

async fn read_start_local(socket: &mut WebSocket) -> Option<StartFrame> {
    // The first frame says how to start the CLI.
    loop {
        match socket.recv().await {
            Some(Ok(Message::Text(text))) => match serde_json::from_str::<StartFrame>(&text) {
                Ok(start) => return Some(start),
                Err(error) => {
                    let _ = socket
                        .send(Message::Text(relay_note("error", &error.to_string()).into()))
                        .await;
                    return None;
                }
            },
            Some(Ok(_)) => continue,
            _ => return None,
        }
    }
}

/* -------------------------------------------------------------------- MCP */

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Option<String>>>>>;

struct McpRoute {
    to_far: mpsc::Sender<String>,
    pending: Pending,
    next: AtomicU64,
}

fn mcp_routes() -> &'static Mutex<HashMap<String, Arc<McpRoute>>> {
    static ROUTES: OnceLock<Mutex<HashMap<String, Arc<McpRoute>>>> = OnceLock::new();
    ROUTES.get_or_init(Default::default)
}

/// Removes the route and fails what was waiting on it when the session ends.
struct McpGuard {
    id: String,
    pending: Pending,
}

impl Drop for McpGuard {
    fn drop(&mut self) {
        if let Ok(mut routes) = mcp_routes().lock() {
            routes.remove(&self.id);
        }
        if let Ok(mut pending) = self.pending.lock() {
            pending.clear();
        }
    }
}

/// One JSON-RPC request from the CLI, answered by the server over the session.
pub async fn mcp(Path(id): Path<String>, headers: HeaderMap, body: String) -> Response {
    if headers.contains_key("origin") {
        return StatusCode::FORBIDDEN.into_response();
    }
    let route = mcp_routes().lock().ok().and_then(|routes| routes.get(&id).cloned());
    let Some(route) = route else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let request = route.next.fetch_add(1, Ordering::Relaxed);
    let (reply, answered) = oneshot::channel();
    if let Ok(mut pending) = route.pending.lock() {
        pending.insert(request, reply);
    }
    let frame = serde_json::json!({ "relay": "mcp", "id": request, "body": body }).to_string();
    if route.to_far.send(frame).await.is_err() {
        return StatusCode::BAD_GATEWAY.into_response();
    }
    match tokio::time::timeout(MCP_REPLY_TIMEOUT, answered).await {
        Ok(Ok(Some(body))) => {
            ([(header::CONTENT_TYPE, "application/json")], body).into_response()
        }
        Ok(Ok(None)) => StatusCode::ACCEPTED.into_response(),
        Ok(Err(_)) => StatusCode::BAD_GATEWAY.into_response(),
        Err(_) => StatusCode::GATEWAY_TIMEOUT.into_response(),
    }
}

#[derive(Deserialize)]
struct McpReply {
    #[serde(rename = "relayReply")]
    relay_reply: u64,
    #[serde(default)]
    body: Option<String>,
}

/* ---------------------------------------------------------------- The CLI */

/// Runs one CLI until the far side hangs up or it exits. Lines from `from_far`
/// go to stdin; stdout and notes go to `to_far`. Dropping this kills the process.
async fn run_cli(
    program: &'static str,
    mut start: StartFrame,
    mut from_far: mpsc::Receiver<String>,
    to_far: mpsc::Sender<String>,
) {
    if !args_allowed(program, &start.args) {
        let _ = to_far
            .send(relay_note("error", "Spectra does not start the CLI that way."))
            .await;
        return;
    }
    let Some(root) = relay_root() else {
        let _ = to_far.send(relay_note("error", "No local data folder")).await;
        return;
    };
    let cwd = root.join("agent-cwd");
    if let Err(error) = std::fs::create_dir_all(&cwd) {
        let _ = to_far.send(relay_note("error", &error.to_string())).await;
        return;
    }
    let system_file = match start.system.take() {
        Some(text) => {
            let path = std::env::temp_dir().join(format!("spectra-system-{}.md", random_hex()));
            if let Err(error) = std::fs::write(&path, text) {
                let _ = to_far.send(relay_note("error", &error.to_string())).await;
                return;
            }
            Some(TemporaryFile(path))
        }
        None => None,
    };
    let pending: Pending = Arc::default();
    let mcp_guard = start.mcp.then(|| {
        let id = random_hex();
        if let Ok(mut routes) = mcp_routes().lock() {
            routes.insert(
                id.clone(),
                Arc::new(McpRoute {
                    to_far: to_far.clone(),
                    pending: pending.clone(),
                    next: AtomicU64::new(1),
                }),
            );
        }
        McpGuard { id, pending: pending.clone() }
    });
    let mcp_url = mcp_guard
        .as_ref()
        .map(|guard| format!("{LOCAL_ORIGIN}/v1/agent/mcp/{}", guard.id));
    let args = start.args.iter().map(|arg| {
        let mut arg = arg.clone();
        if let Some(file) = &system_file {
            arg = arg.replace("{{system}}", &file.0.to_string_lossy());
        }
        if let Some(url) = &mcp_url {
            arg = arg.replace("{{mcp}}", url);
        }
        arg
    });
    let mut command = Command::new(program);
    command
        .args(args)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for name in REMOVED_ENV {
        command.env_remove(name);
    }
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let missing = error.kind() == std::io::ErrorKind::NotFound;
            let detail = if missing { "not-installed".to_string() } else { error.to_string() };
            let _ = to_far.send(relay_note("error", &detail)).await;
            return;
        }
    };
    let (Some(mut stdin), Some(stdout), Some(stderr)) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        return;
    };
    let mut stdout = BufReader::new(stdout).lines();
    let mut stderr = BufReader::new(stderr).lines();
    let mut stderr_open = true;
    let _ = to_far.send(relay_note("started", program)).await;
    loop {
        tokio::select! {
            incoming = from_far.recv() => match incoming {
                Some(text) => {
                    // Answers to the CLI's tool requests never reach its stdin.
                    if text.starts_with("{\"relayReply\"") {
                        if let Ok(reply) = serde_json::from_str::<McpReply>(&text)
                            && let Ok(mut waiting) = pending.lock()
                            && let Some(sender) = waiting.remove(&reply.relay_reply)
                        {
                            let _ = sender.send(reply.body);
                        }
                        continue;
                    }
                    if stdin.write_all(text.as_bytes()).await.is_err()
                        || stdin.write_all(b"\n").await.is_err()
                        || stdin.flush().await.is_err()
                    {
                        break;
                    }
                }
                None => break,
            },
            line = stdout.next_line() => match line {
                Ok(Some(line)) => {
                    if to_far.send(line).await.is_err() {
                        break;
                    }
                }
                _ => {
                    let status = child.wait().await.ok().and_then(|status| status.code());
                    let detail = status.map_or_else(|| "unknown".to_string(), |code| code.to_string());
                    let _ = to_far.send(relay_note("exit", &detail)).await;
                    break;
                }
            },
            line = stderr.next_line(), if stderr_open => match line {
                Ok(Some(line)) => {
                    if to_far.send(relay_note("stderr", &line)).await.is_err() {
                        break;
                    }
                }
                _ => stderr_open = false,
            },
        }
    }
    let _ = child.kill().await;
    drop(mcp_guard);
}

struct TemporaryFile(PathBuf);

impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/* -------------------------------------------------------------------- Hub */

static HUB_ENABLED: AtomicBool = AtomicBool::new(false);

fn hub_consent_file() -> Option<PathBuf> {
    relay_root().map(|root| root.join("agent-hub.enabled"))
}

/// Whether the user has chosen their own runtime on this computer.
pub fn hub_enabled() -> bool {
    HUB_ENABLED.load(Ordering::Relaxed)
        || hub_consent_file().is_some_and(|file| file.exists())
}

/// Remembered across restarts. Turning it off drops the connection within a moment.
pub fn set_hub_enabled(enabled: bool) -> std::io::Result<()> {
    HUB_ENABLED.store(enabled, Ordering::Relaxed);
    let Some(file) = hub_consent_file() else {
        return Ok(());
    };
    if enabled {
        if let Some(parent) = file.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(file, b"1")
    } else if file.exists() {
        std::fs::remove_file(file)
    } else {
        Ok(())
    }
}

/// What the Bridge needs to dial the hub.
pub struct HubTicket {
    pub url: String,
    pub ticket: String,
    pub account_id: String,
}

/// Keeps one control connection to the hub while this computer has agreed to it.
/// `fetch` asks Spectra for a fresh ticket; `None` means this deployment has no hub.
pub async fn run_hub<F, Fut>(state: Arc<crate::server::ServerState>, fetch: F)
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = anyhow::Result<Option<HubTicket>>>,
{
    let mut backoff = Duration::from_secs(1);
    loop {
        if !hub_enabled() {
            tokio::time::sleep(Duration::from_secs(5)).await;
            continue;
        }
        let mut changes = state.relay_changes();
        let Some(identity) = state.local_relay_identity() else {
            tokio::time::sleep(Duration::from_secs(1)).await;
            continue;
        };
        let Some(rooms) = state.work_rooms() else {
            tokio::time::sleep(Duration::from_secs(1)).await;
            continue;
        };
        let fetched = tokio::select! {
            biased;
            _ = changes.changed() => continue,
            fetched = fetch() => fetched,
        };
        if !state.local_relay_matches(&identity) { continue; }
        match fetched {
            Ok(None) => {
                tokio::time::sleep(HUB_UNCONFIGURED_WAIT).await;
                continue;
            }
            Ok(Some(ticket)) => {
                if state.work_account().as_ref().is_some_and(|(_, account)| account == &ticket.account_id) {
                    let began = std::time::Instant::now();
                    if let Err(error) = hub_control(&ticket, state.clone(), identity, rooms, changes).await {
                        eprintln!("[agent-hub] {error}");
                    }
                    if began.elapsed() >= HUB_STABLE_AFTER {
                        backoff = Duration::from_secs(1);
                    }
                }
            }
            Err(error) => eprintln!("[agent-hub] ticket: {error}"),
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(HUB_BACKOFF_MAX);
    }
}

fn hub_request(
    url: &str,
    ticket: Option<&str>,
) -> anyhow::Result<tokio_tungstenite::tungstenite::http::Request<()>> {
    let mut request = url.into_client_request()?;
    let offered = match ticket {
        Some(ticket) => format!("{PROTOCOL}, {ticket}"),
        None => PROTOCOL.to_string(),
    };
    request
        .headers_mut()
        .insert("sec-websocket-protocol", HeaderValue::from_str(&offered)?);
    Ok(request)
}

#[derive(Deserialize)]
struct HubOpen {
    open: String,
    provider: String,
}

async fn hub_control(ticket: &HubTicket, state: Arc<crate::server::ServerState>, identity: crate::server::LocalRelayIdentity, rooms: Arc<crate::rooms::Rooms>, mut changes: tokio::sync::watch::Receiver<u64>) -> anyhow::Result<()> {
    anyhow::ensure!(state.work_account().as_ref().is_some_and(|(_, account)| account == &ticket.account_id), "Hub ticket belongs to another work account");
    let endpoint = format!("{}/_spectra/agent-hub/bridge", ticket.url.trim_end_matches('/'));
    let (mut socket, _) = tokio::select! {
        biased;
        _ = changes.changed() => return Ok(()),
        socket = tokio_tungstenite::connect_async(hub_request(&endpoint, Some(&ticket.ticket))?) => socket?,
    };
    let mut consent = tokio::time::interval(Duration::from_secs(5));
    let (stop, _) = tokio::sync::watch::channel(0u64);
    let mut pipes = tokio::task::JoinSet::new();
    let result = loop {
        if !state.local_relay_matches(&identity) { break Ok(()); }
        tokio::select! {
            biased;
            _ = changes.changed() => break Ok(()),
            _ = pipes.join_next(), if !pipes.is_empty() => {},
            frame = socket.next() => match frame {
                Some(Ok(HubMessage::Text(text))) => {
                    if let Ok(open) = serde_json::from_str::<HubOpen>(&text) {
                        let base = ticket.url.trim_end_matches('/').to_string();
                        let rooms = rooms.clone();
                        let mut stopped = stop.subscribe();
                        pipes.spawn(async move {
                            let result = if matches!(open.provider.as_str(), "rooms" | "store") {
                                hub_work_pipe(&base, &open.open, &open.provider, rooms, stopped).await
                            } else {
                                tokio::select! {
                                    biased;
                                    _ = stopped.changed() => Ok(()),
                                    result = hub_pipe(&base, &open.open, &open.provider) => result,
                                }
                            };
                            if let Err(error) = result {
                                eprintln!("[agent-hub] pipe: {error}");
                            }
                        });
                    }
                }
                Some(Ok(_)) => {}
                Some(Err(error)) => break Err(error.into()),
                None => break Ok(()),
            },
            _ = consent.tick() => {
                if !hub_enabled() {
                    break Ok(());
                }
            }
        }
    };
    stop.send_modify(|generation| *generation += 1);
    // Room pipes finish their final local save before their task is dropped.
    while pipes.join_next().await.is_some() {}
    result
}

/// A hub connection for stored work rather than a provider's program.
async fn hub_work_pipe(base: &str, sid: &str, provider: &str, rooms: Arc<crate::rooms::Rooms>, mut stopped: tokio::sync::watch::Receiver<u64>) -> anyhow::Result<()> {
    let endpoint = format!("{base}/_spectra/agent-hub/pipe?sid={sid}");
    let (socket, _) = tokio::select! {
        biased;
        _ = stopped.changed() => return Ok(()),
        socket = tokio_tungstenite::connect_async(hub_request(&endpoint, None)?) => socket?,
    };
    let (sink, stream) = socket.split();
    if provider == "store" {
        let sink = sink.with(|text: String| async move {
            Ok::<_, tokio_tungstenite::tungstenite::Error>(HubMessage::Text(text.into()))
        });
        let stream = stream.filter_map(|frame| async move {
            match frame {
                Ok(HubMessage::Text(text)) => Some(Ok::<_, tokio_tungstenite::tungstenite::Error>(text.to_string())),
                Ok(_) => None,
                Err(error) => Some(Err(error)),
            }
        });
        crate::rooms::serve_store_requests(Box::pin(sink), Box::pin(stream), rooms, stopped).await;
    } else {
        let sink = sink.with(|bytes: Vec<u8>| async move {
            Ok::<_, tokio_tungstenite::tungstenite::Error>(HubMessage::Binary(bytes.into()))
        });
        let stream = stream.filter_map(|frame| async move {
            match frame {
                Ok(HubMessage::Binary(bytes)) => Some(Ok::<_, tokio_tungstenite::tungstenite::Error>(bytes.to_vec())),
                Ok(_) => None,
                Err(error) => Some(Err(error)),
            }
        });
        crate::rooms::serve_pipe(Box::pin(sink), Box::pin(stream), rooms, stopped).await;
    }
    Ok(())
}

async fn hub_pipe(base: &str, sid: &str, provider: &str) -> anyhow::Result<()> {
    let Some(program) = executable(provider) else {
        anyhow::bail!("unknown provider");
    };
    let endpoint = format!("{base}/_spectra/agent-hub/pipe?sid={sid}");
    let (mut socket, _) =
        tokio_tungstenite::connect_async(hub_request(&endpoint, None)?).await?;
    let start = loop {
        match socket.next().await {
            Some(Ok(HubMessage::Text(text))) => match serde_json::from_str::<StartFrame>(&text) {
                Ok(start) => break start,
                Err(error) => {
                    let _ = socket
                        .send(HubMessage::Text(relay_note("error", &error.to_string()).into()))
                        .await;
                    return Ok(());
                }
            },
            Some(Ok(_)) => continue,
            _ => return Ok(()),
        }
    };
    let (to_cli, from_far) = mpsc::channel::<String>(64);
    let (to_far, mut from_cli) = mpsc::channel::<String>(64);
    let session = tokio::spawn(run_cli(program, start, from_far, to_far));
    let _cancel_session = AbortOnDrop(session.abort_handle());
    loop {
        tokio::select! {
            incoming = socket.next() => match incoming {
                Some(Ok(HubMessage::Text(text))) => {
                    if to_cli.send(text.to_string()).await.is_err() {
                        break;
                    }
                }
                Some(Ok(HubMessage::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
            line = from_cli.recv() => match line {
                Some(line) => {
                    if socket.send(HubMessage::Text(line.into())).await.is_err() {
                        break;
                    }
                }
                None => break,
            },
        }
    }
    session.abort();
    let _ = socket.close(None).await;
    Ok(())
}

struct AbortOnDrop(tokio::task::AbortHandle);
impl Drop for AbortOnDrop { fn drop(&mut self) { self.0.abort(); } }

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancelling_a_relay_future_also_aborts_its_child_task() {
        let (started, ready) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move { let _ = started.send(()); std::future::pending::<()>().await; });
        ready.await.unwrap();
        let cancel = AbortOnDrop(task.abort_handle());
        drop(cancel);
        assert!(task.await.unwrap_err().is_cancelled());
    }

    #[tokio::test]
    async fn hub_account_binding_and_unpairing_close_store_room_and_waiting_cli_pipes() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("works.db");
        let state = Arc::new(crate::server::ServerState::unpaired());
        state.set_device_id("fixture-device".into());
        state.pair("http://localhost:3000".into());
        let identity = state.local_relay_identity().unwrap();
        state.prepare_work_rooms(&identity, path.clone(), path, "http://fixture".into(), "fixture-only".into(), "a".into()).await.unwrap();
        let rooms = state.work_rooms().unwrap();
        rooms.call("save", &serde_json::json!({"artifactId":"a-work","projection":{"title":"Private A work"}})).unwrap();
        let opened = Arc::new(AtomicU64::new(0));
        let closed = Arc::new(AtomicU64::new(0));
        let (notices, mut received) = mpsc::unbounded_channel();
        let count_open = opened.clone(); let count_closed = closed.clone();
        let router = axum::Router::new()
            .route("/_spectra/agent-hub/bridge", axum::routing::get(|socket: WebSocketUpgrade| async move {
                socket.protocols([PROTOCOL]).on_upgrade(|mut socket| async move {
                    for provider in ["store", "rooms", "codex"] {
                        socket.send(Message::Text(serde_json::json!({"open":provider,"provider":provider}).to_string().into())).await.unwrap();
                    }
                    while socket.next().await.is_some() {}
                })
            }))
            .route("/_spectra/agent-hub/pipe", axum::routing::get(move |Query(query): Query<HashMap<String,String>>, socket: WebSocketUpgrade| {
                let opened = count_open.clone(); let closed = count_closed.clone(); let notices = notices.clone();
                async move { socket.protocols([PROTOCOL]).on_upgrade(move |mut socket| async move {
                    if query["sid"] == "store" {
                        socket.send(Message::Text(r#"{"id":1,"method":"get","params":{"artifactId":"a-work"}}"#.into())).await.unwrap();
                        let reply = socket.next().await.unwrap().unwrap().into_text().unwrap();
                        let reply: serde_json::Value = serde_json::from_str(&reply).unwrap();
                        assert_eq!(reply["result"]["title"], "Private A work");
                    }
                    // The CLI receives no start frame and never runs a program.
                    opened.fetch_add(1, Ordering::SeqCst);
                    let _ = notices.send(());
                    while socket.next().await.is_some() {}
                    closed.fetch_add(1, Ordering::SeqCst);
                    let _ = notices.send(());
                }) }
            }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap(); });
        let wrong = HubTicket { url: url.clone(), ticket: "fixture-only".into(), account_id: "b".into() };
        assert!(hub_control(&wrong, state.clone(), identity.clone(), rooms.clone(), state.relay_changes()).await.is_err());
        // In-memory consent only: never read or change the installed consent file.
        let previous = HUB_ENABLED.swap(true, Ordering::SeqCst);
        let ticket = HubTicket { url, ticket: "fixture-only".into(), account_id: "a".into() };
        let control_state = state.clone();
        let changes = state.relay_changes();
        let task = tokio::spawn(async move { hub_control(&ticket, control_state, identity, rooms, changes).await });
        tokio::time::timeout(Duration::from_secs(3), async {
            while opened.load(Ordering::SeqCst) < 3 { received.recv().await.unwrap(); }
        }).await.unwrap();
        state.forget_pairing();
        tokio::time::timeout(Duration::from_secs(3), task).await.unwrap().unwrap().unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            while closed.load(Ordering::SeqCst) < 3 { received.recv().await.unwrap(); }
        }).await.unwrap();
        HUB_ENABLED.store(previous, Ordering::SeqCst);
        server.abort();
    }

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(ToString::to_string).collect()
    }

    #[test]
    fn only_spectras_own_ways_of_starting_a_cli_are_allowed() {
        assert!(args_allowed("codex", &strings(&["app-server"])));
        assert!(!args_allowed("codex", &strings(&["exec", "rm -rf /"])));
        assert!(args_allowed("claude", &strings(&["auth", "status"])));
        assert!(args_allowed(
            "claude",
            &strings(&["-p", "--tools", "", "--strict-mcp-config"])
        ));
        assert!(!args_allowed("claude", &strings(&["-p", "do something"])));
        assert!(!args_allowed("claude", &strings(&["-p", "--tools", "Bash", "--strict-mcp-config"])));
        assert!(!args_allowed("claude", &[]));
    }

    #[test]
    fn a_hub_reply_is_read_apart_from_a_cli_line() {
        let reply: McpReply = serde_json::from_str(r#"{"relayReply":4,"body":"{}"}"#).unwrap();
        assert_eq!(reply.relay_reply, 4);
        assert_eq!(reply.body.as_deref(), Some("{}"));
    }
}
