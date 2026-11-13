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
/// A tool call waiting longer than this ends as a tool error the model can read.
const MCP_REPLY_TIMEOUT: Duration = Duration::from_secs(60 * 5);
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
            write_owner_only(&path, &token).ok()?;
            Some(token)
        })
        .as_deref()
}

// Unit-test servers must never read or replace the installed Bridge's token.
#[cfg(test)]
fn relay_token() -> Option<&'static str> { Some("dummy-local-relay-test-token") }

/// The token lets a local process start the user's CLIs; only its owner may read it.
#[cfg_attr(test, allow(dead_code))]
fn write_owner_only(path: &std::path::Path, contents: &str) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mut file = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(path)?;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
        file.write_all(contents.as_bytes())
    }
    #[cfg(not(unix))]
    {
        // The file lives in the user's own LOCALAPPDATA, which only they can read.
        std::fs::write(path, contents)
    }
}

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

/// The far side says what it wants; the Bridge decides the command line.
#[derive(Deserialize)]
struct StartFrame {
    /// Sent by servers older than this Bridge's own command lines. Never run.
    #[serde(default)]
    #[allow(dead_code)]
    args: Vec<String>,
    /// Written to a private file and given to Claude as its system prompt.
    #[serde(default)]
    system: Option<String>,
    /// What a Claude session is for. Codex always runs `app-server`.
    #[serde(default)]
    claude: Option<ClaudeIntent>,
    /// Install or log in to the CLI in a terminal the person can see. Nothing else runs.
    #[serde(default)]
    setup: Option<SetupAction>,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum SetupAction {
    Install,
    Login,
    /// The official installer with no window: Spectra watches for the CLI to appear, then asks for the log-in.
    InstallQuiet,
}

/// The official installers and each CLI's own log-in, fixed here: the far side only picks one.
fn setup_script(program: &str, action: SetupAction, windows: bool) -> Option<String> {
    let (name, login, installer) = match (program, windows) {
        ("claude", true) => ("Claude Code", "claude auth login", "irm https://claude.ai/install.ps1 | iex"),
        ("claude", false) => ("Claude Code", "claude auth login", "curl -fsSL https://claude.ai/install.sh | bash"),
        ("codex", true) => ("Codex", "codex login", "irm https://chatgpt.com/codex/install.ps1 | iex"),
        ("codex", false) => ("Codex", "codex login", "curl -fsSL https://chatgpt.com/codex/install.sh | sh"),
        _ => return None,
    };
    Some(if windows {
        // The installers' folders go on PATH here, since this window started before the install.
        let path = "$env:Path = \"$env:USERPROFILE\\.local\\bin;$env:LOCALAPPDATA\\Programs\\OpenAI\\Codex\\bin;$env:Path\"";
        let title = format!("$Host.UI.RawUI.WindowTitle = 'Spectra: {name}'");
        let done = "Write-Host ''; Write-Host 'Done. Close this window and go back to Spectra.'";
        match action {
            SetupAction::Install => format!("{title}; Write-Host 'Installing {name}...'; {installer}; {path}; {login}; {done}"),
            SetupAction::Login => format!("{title}; {path}; {login}; {done}"),
            SetupAction::InstallQuiet => installer.to_string(),
        }
    } else {
        let path = "export PATH=$HOME/.local/bin:$PATH";
        let done = "echo; echo 'Done. Close this window and go back to Spectra.'";
        match action {
            SetupAction::Install => format!("{path}; echo 'Installing {name}...'; {installer} && {login}; {done}"),
            SetupAction::Login => format!("{path}; {login}; {done}"),
            SetupAction::InstallQuiet => installer.to_string(),
        }
    })
}

/// Opens a terminal running the setup. "opened", or "unsupported" where Spectra can't open one.
fn open_setup(program: &str, action: SetupAction) -> &'static str {
    let Some(script) = setup_script(program, action, cfg!(windows)) else {
        return "unsupported";
    };
    if action == SetupAction::InstallQuiet {
        return if install_quietly(&script) { "started" } else { "failed" };
    }
    // A CLI found off the PATH (npm, Claude Desktop's own) logs in by its full path.
    let resolved = resolve_program(program);
    let script = if action == SetupAction::Login && resolved.is_absolute() {
        let quoted = resolved.to_string_lossy().replace('\'', "''");
        let call = if cfg!(windows) { format!("& '{quoted}'") } else { format!("'{quoted}'") };
        script.replacen(&format!("{program} "), &format!("{call} "), 1)
    } else {
        script
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let opened = std::process::Command::new("powershell.exe")
            .args(["-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &script])
            .creation_flags(0x0000_0010) // CREATE_NEW_CONSOLE
            .spawn();
        return if opened.is_ok() { "opened" } else { "failed" };
    }
    #[cfg(target_os = "macos")]
    {
        let opened = std::process::Command::new("osascript")
            .args(["-e", &format!("tell application \"Terminal\" to do script \"{script}\""), "-e", "tell application \"Terminal\" to activate"])
            .spawn();
        return if opened.is_ok() { "opened" } else { "failed" };
    }
    #[allow(unreachable_code)]
    {
        let _ = script;
        "unsupported"
    }
}

/// Runs the official installer with no window. It is left to finish on its own:
/// the CLI showing up where `resolve_program` looks is the sign it is done.
fn install_quietly(script: &str) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        return std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn()
            .is_ok();
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("/bin/sh")
            .args(["-c", script])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .is_ok()
    }
}

/// Where the official installers and the usual package managers put each CLI,
/// for a Bridge that started before the install.
fn installed_dirs(program: &str) -> Vec<PathBuf> {
    let var = |name: &str| std::env::var_os(name).map(PathBuf::from);
    let home = var(if cfg!(windows) { "USERPROFILE" } else { "HOME" });
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(home) = &home {
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join(".bun").join("bin"));
        dirs.push(home.join(".volta").join("bin"));
    }
    if cfg!(windows) {
        if let Some(local) = var("LOCALAPPDATA") {
            if program == "codex" {
                dirs.push(local.join("Programs").join("OpenAI").join("Codex").join("bin"));
            }
            dirs.push(local.join("Microsoft").join("WinGet").join("Links"));
            dirs.push(local.join("pnpm"));
        }
        if let Some(roaming) = var("APPDATA") {
            dirs.push(roaming.join("npm"));
        }
        if let Some(home) = &home {
            dirs.push(home.join("scoop").join("shims"));
        }
    } else {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin"].map(PathBuf::from));
        if let Some(home) = &home {
            dirs.push(home.join(".npm-global").join("bin"));
            // nvm keeps one folder per Node version; the newest is the likeliest.
            dirs.extend(newest_first(&home.join(".nvm").join("versions").join("node")).into_iter().map(|dir| dir.join("bin")));
        }
    }
    dirs
}

/// The folders inside `dir`, most recently changed first.
fn newest_first(dir: &std::path::Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut found: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| (entry.metadata().and_then(|meta| meta.modified()).unwrap_or(std::time::UNIX_EPOCH), entry.path()))
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().map(|(_, path)| path).collect()
}

/// Claude Desktop ships Claude Code (`claude-code/<version>/[<build>/]claude`)
/// beside its own data; the newest is used when there is no CLI of its own.
fn claude_desktop_cli() -> Option<PathBuf> {
    let root = if cfg!(windows) {
        PathBuf::from(std::env::var_os("APPDATA")?).join("Claude").join("claude-code")
    } else {
        PathBuf::from(std::env::var_os("HOME")?).join("Library").join("Application Support").join("Claude").join("claude-code")
    };
    let file = if cfg!(windows) { "claude.exe" } else { "claude" };
    newest_first(&root).into_iter().find_map(|version| {
        std::iter::once(version.join(file))
            .chain(newest_first(&version).into_iter().map(|build| build.join(file)))
            .find(|candidate| candidate.is_file())
    })
}

/// The person's PATH as it is now: Bridge's own copy is from when it started,
/// so on Windows the saved user and machine PATH are read again each time.
fn current_path_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|path| std::env::split_paths(&path).collect()).unwrap_or_default();
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        let saved = [
            registry_path(HKEY_CURRENT_USER, "Environment"),
            registry_path(HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
        ];
        for value in saved.into_iter().flatten() {
            for dir in std::env::split_paths(&value) {
                if !dirs.contains(&dir) {
                    dirs.push(dir);
                }
            }
        }
    }
    dirs
}

/// A saved `Path` value, with `%VARIABLES%` expanded.
#[cfg(windows)]
fn registry_path(root: windows_sys::Win32::System::Registry::HKEY, key: &str) -> Option<std::ffi::OsString> {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows_sys::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_SZ};
    let wide = |text: &str| std::ffi::OsStr::new(text).encode_wide().chain(Some(0)).collect::<Vec<u16>>();
    let (key, name) = (wide(key), wide("Path"));
    let mut size: u32 = 0;
    // SAFETY: valid NUL-terminated strings; a null buffer only asks for the size.
    if unsafe { RegGetValueW(root, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), std::ptr::null_mut(), &mut size) } != 0 {
        return None;
    }
    // Expanding can need more room than the stored value reported, so allow for it.
    for _ in 0..3 {
        let mut buffer = vec![0u16; (size as usize).div_ceil(2) + 512];
        let mut bytes = (buffer.len() * 2) as u32;
        // SAFETY: `buffer` holds `bytes` bytes.
        let status = unsafe { RegGetValueW(root, key.as_ptr(), name.as_ptr(), RRF_RT_REG_SZ, std::ptr::null_mut(), buffer.as_mut_ptr().cast(), &mut bytes) };
        if status == 0 {
            let len = buffer.iter().position(|&unit| unit == 0).unwrap_or(buffer.len());
            return Some(std::ffi::OsString::from_wide(&buffer[..len]));
        }
        size = bytes.max(size * 2);
    }
    None
}

/// The names a CLI goes by in a folder: the program itself first, then (Windows)
/// the `.cmd` shim npm, pnpm and others make.
fn program_files(program: &str) -> Vec<String> {
    if cfg!(windows) { vec![format!("{program}.exe"), format!("{program}.cmd")] } else { vec![program.to_string()] }
}

/// The CLI on the PATH as it is now, else where an installer or package manager
/// puts it, else Claude Desktop's own (for `claude`), else its bare name (which
/// then reports "not-installed").
fn resolve_program(program: &str) -> PathBuf {
    resolve_in(program, &current_path_dirs(), &installed_dirs(program))
        .or_else(|| if program == "claude" { claude_desktop_cli() } else { None })
        .unwrap_or_else(|| PathBuf::from(program))
}

fn resolve_in(program: &str, path: &[PathBuf], installed: &[PathBuf]) -> Option<PathBuf> {
    // A real executable anywhere beats a shim, which needs a shell and Node behind it.
    program_files(program).into_iter().find_map(|file| path.iter().chain(installed).map(|dir| dir.join(&file)).find(|candidate| candidate.is_file()))
}

#[derive(Deserialize)]
#[serde(tag = "mode", rename_all = "kebab-case")]
enum ClaudeIntent {
    Prompt {
        model: String,
        #[serde(default)]
        effort: Option<String>,
        /// Spectra's tools over the local MCP endpoint.
        #[serde(default)]
        tools: bool,
    },
    AuthStatus,
}

const CLAUDE_EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

fn executable(provider: &str) -> Option<&'static str> {
    match provider {
        "codex" => Some("codex"),
        "claude" => Some("claude"),
        _ => None,
    }
}

/// A model name is one short word: an alias or an id, never a flag.
fn model_name_allowed(model: &str) -> bool {
    let bytes = model.as_bytes();
    (1..=64).contains(&bytes.len())
        && bytes[0].is_ascii_alphanumeric()
        && bytes.iter().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-' | b'[' | b']'))
}

/// Claude's whole command line, built here. `{{system}}` and `{{mcp}}` become
/// the prompt file and the local tool endpoint when the session starts. The
/// CLI's own tools are off, its settings and other MCP servers are ignored, and
/// nothing is saved as a session on disk.
fn claude_command(start: &StartFrame) -> Result<(Vec<String>, bool), &'static str> {
    let Some(intent) = &start.claude else {
        return Err("This Bridge starts Claude only from Spectra's own request. Update Spectra.");
    };
    let (model, effort, tools) = match intent {
        ClaudeIntent::AuthStatus => return Ok((vec!["auth".into(), "status".into()], false)),
        ClaudeIntent::Prompt { model, effort, tools } => (model, effort, *tools),
    };
    if !model_name_allowed(model) {
        return Err("Spectra does not start Claude with that model.");
    }
    if effort.as_deref().is_some_and(|effort| !CLAUDE_EFFORTS.contains(&effort)) {
        return Err("Spectra does not start Claude with that thinking level.");
    }
    let mut args: Vec<String> = [
        "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
        "--include-partial-messages", "--model", model, "--tools", "", "--setting-sources", "",
        "--no-session-persistence", "--strict-mcp-config", "--system-prompt-file", "{{system}}",
    ]
    .iter()
    .map(ToString::to_string)
    .collect();
    if let Some(effort) = effort {
        args.extend(["--effort".into(), effort.clone()]);
    }
    if tools {
        let config = serde_json::json!({ "mcpServers": { "spectra": { "type": "http", "url": "{{mcp}}" } } });
        args.extend(["--mcp-config".into(), config.to_string(), "--allowedTools".into(), "mcp__spectra".into()]);
    }
    Ok((args, tools))
}

/// Codex features that act on this computer or reach beyond Spectra. Always off.
const CODEX_FEATURES_OFF: [&str; 18] = [
    "shell_tool", "apps", "memories", "browser_use", "computer_use", "plugins", "remote_plugin", "multi_agent",
    "skill_search", "tool_suggest", "image_generation", "goals", "sleep_tool", "unified_exec", "view_image", "hooks",
    "in_app_browser", "code_mode_host",
];

/// The requests Spectra sends to `codex app-server`, and the fields each may carry.
fn codex_allowed_fields(method: &str) -> Option<&'static [&'static str]> {
    Some(match method {
        "initialize" => &["clientInfo", "capabilities"],
        "initialized" => &[],
        "account/read" => &["refreshToken"],
        "config/read" => &[],
        "model/list" => &["cursor", "limit"],
        "thread/start" => &["model", "ephemeral", "baseInstructions", "serviceName", "config", "dynamicTools"],
        "turn/start" => &["threadId", "effort", "input", "outputSchema"],
        "turn/steer" => &["threadId", "expectedTurnId", "input"],
        "turn/interrupt" => &["threadId", "turnId"],
        _ => return None,
    })
}

/// The isolation every thread runs under, whatever the far side asked for.
fn codex_config(asked: Option<&serde_json::Value>) -> serde_json::Value {
    let mut config = serde_json::Map::new();
    config.insert("web_search".into(), "disabled".into());
    config.insert("project_doc_max_bytes".into(), 0.into());
    if let Some(serde_json::Value::Object(asked)) = asked {
        for (key, value) in asked {
            let keep = match key.as_str() {
                "model_reasoning_summary" => value.as_str().is_some_and(|summary| matches!(summary, "auto" | "concise" | "detailed" | "none")),
                // The person's own MCP servers may only be turned off.
                key if key.starts_with("mcp_servers.") && key.ends_with(".enabled") => value == &serde_json::Value::Bool(false),
                key if key.starts_with("features.") => {
                    config.insert(key.into(), false.into());
                    false
                }
                _ => false,
            };
            if keep {
                config.insert(key.clone(), value.clone());
            }
        }
    }
    for feature in CODEX_FEATURES_OFF {
        config.insert(format!("features.{feature}"), false.into());
    }
    serde_json::Value::Object(config)
}

/// One line from the far side to Codex, rewritten to Spectra's terms or refused.
/// Replies to Codex's own requests (Spectra's tool results) pass unchanged.
fn codex_inbound(line: &str) -> Result<String, String> {
    let mut frame: serde_json::Value = serde_json::from_str(line).map_err(|_| "not JSON".to_string())?;
    let Some(object) = frame.as_object_mut() else { return Err("not a JSON-RPC message".into()) };
    let Some(method) = object.get("method").and_then(serde_json::Value::as_str).map(str::to_owned) else {
        let is_reply = object.contains_key("id") && (object.contains_key("result") || object.contains_key("error"));
        return if is_reply { Ok(line.to_string()) } else { Err("not a JSON-RPC message".into()) };
    };
    let Some(fields) = codex_allowed_fields(&method) else {
        return Err(format!("{method} is not one of Spectra's requests"));
    };
    let mut params = serde_json::Map::new();
    if let Some(serde_json::Value::Object(asked)) = object.get("params") {
        for field in fields {
            if let Some(value) = asked.get(*field) {
                params.insert((*field).into(), value.clone());
            }
        }
    }
    if method == "thread/start" {
        let config = codex_config(params.get("config"));
        params.insert("config".into(), config);
        params.insert("approvalPolicy".into(), "never".into());
        params.insert("sandbox".into(), "read-only".into());
    }
    if object.contains_key("params") || method == "thread/start" {
        object.insert("params".into(), serde_json::Value::Object(params));
    }
    Ok(frame.to_string())
}

/// Codex items that act outside Spectra's own tools.
const CODEX_FOREIGN_ITEMS: [&str; 6] = ["commandExecution", "fileChange", "mcpToolCall", "webSearch", "imageView", "collabAgentToolCall"];

/// True when Codex reports doing something only Spectra's tools may do. The
/// session ends then: the isolation did not hold.
fn codex_outbound_refused(line: &str) -> bool {
    let Ok(frame) = serde_json::from_str::<serde_json::Value>(line) else { return false };
    let Some(method) = frame.get("method").and_then(serde_json::Value::as_str) else { return false };
    if method.ends_with("/requestApproval") || matches!(method, "execCommandApproval" | "applyPatchApproval") {
        return true;
    }
    if !matches!(method, "item/started" | "item/completed") {
        return false;
    }
    let kind = frame.pointer("/params/item/type").and_then(serde_json::Value::as_str).unwrap_or_default();
    CODEX_FOREIGN_ITEMS.contains(&kind)
}

fn hub_pipe_url(base: &str, sid: &str) -> String {
    let encoded: String = sid
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (byte as char).to_string(),
            _ => format!("%{byte:02X}"),
        })
        .collect();
    format!("{}/_spectra/agent-hub/pipe?sid={encoded}", base.trim_end_matches('/'))
}

/// The CLI's tool request waited too long: it gets an error it can read, not a dropped call.
fn mcp_timeout_reply(body: &str) -> String {
    let id = serde_json::from_str::<serde_json::Value>(body).ok().and_then(|request| request.get("id").cloned()).unwrap_or(serde_json::Value::Null);
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": { "isError": true, "content": [{ "type": "text", "text": "Spectra did not answer this tool call in time. Try it again, or continue without it." }] }
    })
    .to_string()
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
    let frame = serde_json::json!({ "relay": "mcp", "id": request, "body": &body }).to_string();
    if route.to_far.send(frame).await.is_err() {
        return StatusCode::BAD_GATEWAY.into_response();
    }
    match tokio::time::timeout(MCP_REPLY_TIMEOUT, answered).await {
        Ok(Ok(Some(body))) => {
            ([(header::CONTENT_TYPE, "application/json")], body).into_response()
        }
        Ok(Ok(None)) => StatusCode::ACCEPTED.into_response(),
        Ok(Err(_)) => StatusCode::BAD_GATEWAY.into_response(),
        Err(_) => ([(header::CONTENT_TYPE, "application/json")], mcp_timeout_reply(&body)).into_response(),
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
    if let Some(action) = start.setup {
        let opened = open_setup(program, action);
        let _ = to_far.send(relay_note("setup", opened)).await;
        return;
    }
    let _live = LiveSession::start();
    let codex = program == "codex";
    let (template, mcp) = if codex {
        (vec!["app-server".to_string()], false)
    } else {
        match claude_command(&start) {
            Ok(command) => command,
            Err(reason) => {
                eprintln!("[agent-relay] refused a Claude start: {reason}");
                let _ = to_far.send(relay_note("error", reason)).await;
                return;
            }
        }
    };
    let prompt_file = template.iter().any(|arg| arg == "{{system}}");
    let Some(root) = relay_root() else {
        let _ = to_far.send(relay_note("error", "No local data folder")).await;
        return;
    };
    let cwd = root.join("agent-cwd");
    if let Err(error) = std::fs::create_dir_all(&cwd) {
        let _ = to_far.send(relay_note("error", &error.to_string())).await;
        return;
    }
    let system_file = match start.system.take().or_else(|| prompt_file.then(String::new)) {
        Some(text) if prompt_file => {
            let path = std::env::temp_dir().join(format!("spectra-system-{}.md", random_hex()));
            if let Err(error) = std::fs::write(&path, text) {
                let _ = to_far.send(relay_note("error", &error.to_string())).await;
                return;
            }
            Some(TemporaryFile(path))
        }
        _ => None,
    };
    let pending: Pending = Arc::default();
    let mcp_guard = mcp.then(|| {
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
    let args = template.iter().map(|arg| {
        let mut arg = arg.clone();
        if let Some(file) = &system_file {
            arg = arg.replace("{{system}}", &file.0.to_string_lossy());
        }
        if let Some(url) = &mcp_url {
            arg = arg.replace("{{mcp}}", url);
        }
        arg
    });
    let resolved = resolve_program(program);
    let mut command = Command::new(&resolved);
    // The CLI's own folder first, for what it starts in turn.
    if let Some(dir) = resolved.parent().filter(|dir| !dir.as_os_str().is_empty()) {
        let rest = std::env::var_os("PATH").unwrap_or_default();
        if let Ok(path) = std::env::join_paths(std::iter::once(dir.to_path_buf()).chain(std::env::split_paths(&rest))) {
            command.env("PATH", path);
        }
    }
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
                    let text = if codex {
                        match codex_inbound(&text) {
                            Ok(text) => text,
                            Err(reason) => {
                                eprintln!("[agent-relay] refused a Codex request: {reason}");
                                let id = serde_json::from_str::<serde_json::Value>(&text).ok().and_then(|frame| frame.get("id").cloned());
                                let reply = match id {
                                    Some(id) => serde_json::json!({ "id": id, "error": { "code": -32601, "message": "Spectra Bridge does not allow this request." } }).to_string(),
                                    None => relay_note("refused", &reason),
                                };
                                if to_far.send(reply).await.is_err() { break; }
                                continue;
                            }
                        }
                    } else {
                        text
                    };
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
                    if codex && codex_outbound_refused(&line) {
                        eprintln!("[agent-relay] Codex acted outside Spectra's tools; the session was stopped");
                        let _ = to_far.send(relay_note("error", "Codex tried to act outside Spectra's tools, so Spectra Bridge stopped it.")).await;
                        break;
                    }
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

static LIVE_SESSIONS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// How many CLI sessions are running now. An update waits for none.
pub fn live_sessions() -> usize {
    LIVE_SESSIONS.load(Ordering::Acquire)
}

struct LiveSession;

impl LiveSession {
    fn start() -> Self {
        LIVE_SESSIONS.fetch_add(1, Ordering::AcqRel);
        Self
    }
}

impl Drop for LiveSession {
    fn drop(&mut self) {
        LIVE_SESSIONS.fetch_sub(1, Ordering::AcqRel);
    }
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
    let endpoint = hub_pipe_url(base, sid);
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
    let endpoint = hub_pipe_url(base, sid);
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
        // Argument lists from the far side are never run, however they look.
        for args in [strings(&["auth", "status"]), strings(&["-p", "--tools", "", "--strict-mcp-config"]), strings(&["-p", "do something"])] {
            let start: StartFrame = serde_json::from_value(serde_json::json!({ "args": args })).unwrap();
            assert!(claude_command(&start).is_err());
        }
        assert!(model_name_allowed("claude-haiku-4-5") && model_name_allowed("opus[1m]") && model_name_allowed("sonnet"));
        assert!(!model_name_allowed("") && !model_name_allowed("-p") && !model_name_allowed("Haiku") && !model_name_allowed("a b"));
    }

    #[test]
    fn setup_runs_only_the_official_installer_and_the_clis_own_log_in() {
        let start: StartFrame = serde_json::from_value(serde_json::json!({ "setup": "install", "args": ["rm", "-rf"] })).unwrap();
        assert_eq!(start.setup, Some(SetupAction::Install));
        assert!(serde_json::from_value::<StartFrame>(serde_json::json!({ "setup": "anything-else" })).is_err());
        let windows = setup_script("claude", SetupAction::Install, true).unwrap();
        assert!(windows.contains("irm https://claude.ai/install.ps1 | iex") && windows.ends_with("Done. Close this window and go back to Spectra.'"));
        assert!(windows.find("install.ps1").unwrap() < windows.find("claude auth login").unwrap());
        let mac = setup_script("codex", SetupAction::Install, false).unwrap();
        assert!(mac.contains("curl -fsSL https://chatgpt.com/codex/install.sh | sh && codex login"));
        // A Terminal script sits inside an AppleScript string, so it never has a double quote.
        for program in ["claude", "codex"] {
            for action in [SetupAction::Install, SetupAction::Login] {
                assert!(!setup_script(program, action, false).unwrap().contains('"'));
            }
        }
        let login = setup_script("codex", SetupAction::Login, true).unwrap();
        assert!(login.contains("codex login") && !login.contains("install"));
        assert!(setup_script("bash", SetupAction::Install, true).is_none());
    }

    #[cfg(windows)]
    #[test]
    fn powershell_reads_the_setup_script_as_written() {
        // The quotes in the PATH line survive Windows argument quoting; nothing is installed here.
        let script = setup_script("codex", SetupAction::Login, true).unwrap();
        let path_line = script.split("; ").find(|part| part.starts_with("$env:Path")).unwrap();
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &format!("{path_line}; Write-Output ($env:Path -split ';')[1]")])
            .output()
            .unwrap();
        let printed = String::from_utf8_lossy(&output.stdout);
        assert!(printed.trim().ends_with("Programs\\OpenAI\\Codex\\bin"), "{printed}");
    }

    #[test]
    fn a_cli_is_looked_for_where_its_installer_puts_it() {
        let dirs = installed_dirs("codex");
        assert!(dirs.iter().any(|dir| dir.ends_with(std::path::Path::new(".local").join("bin"))));
        if cfg!(windows) {
            assert!(dirs.iter().any(|dir| dir.ends_with("npm")), "npm's global folder is looked in");
            assert!(dirs.iter().any(|dir| dir.ends_with(std::path::Path::new("WinGet").join("Links"))));
        }
        assert_eq!(resolve_program("spectra-no-such-cli"), PathBuf::from("spectra-no-such-cli"));
    }

    #[test]
    fn a_real_executable_beats_a_shim_and_installed_folders_follow_the_path() {
        let root = tempfile::tempdir().unwrap();
        let (path_dir, npm_dir, local_dir) = (root.path().join("path"), root.path().join("npm"), root.path().join("local"));
        for dir in [&path_dir, &npm_dir, &local_dir] {
            std::fs::create_dir_all(dir).unwrap();
        }
        let exe = if cfg!(windows) { "fake.exe" } else { "fake" };
        // Only a shim on the PATH: found, so an npm install is seen.
        if cfg!(windows) {
            std::fs::write(npm_dir.join("fake.cmd"), "").unwrap();
            assert_eq!(resolve_in("fake", &[path_dir.clone()], &[npm_dir.clone()]), Some(npm_dir.join("fake.cmd")));
        }
        // An installed executable wins over the shim, wherever each is.
        std::fs::write(local_dir.join(exe), "").unwrap();
        assert_eq!(resolve_in("fake", &[path_dir.clone()], &[npm_dir.clone(), local_dir.clone()]), Some(local_dir.join(exe)));
        // The PATH comes first among real executables.
        std::fs::write(path_dir.join(exe), "").unwrap();
        assert_eq!(resolve_in("fake", &[path_dir.clone()], &[local_dir.clone()]), Some(path_dir.join(exe)));
        assert_eq!(resolve_in("missing", &[path_dir], &[local_dir]), None);
    }

    #[test]
    fn the_quiet_install_runs_only_the_official_installer() {
        assert_eq!(setup_script("codex", SetupAction::InstallQuiet, true).as_deref(), Some("irm https://chatgpt.com/codex/install.ps1 | iex"));
        assert_eq!(setup_script("claude", SetupAction::InstallQuiet, false).as_deref(), Some("curl -fsSL https://claude.ai/install.sh | bash"));
        let start: StartFrame = serde_json::from_value(serde_json::json!({ "args": [], "setup": "install-quiet" })).unwrap();
        assert_eq!(start.setup, Some(SetupAction::InstallQuiet));
    }

    fn claude_start(intent: serde_json::Value) -> StartFrame {
        serde_json::from_value(serde_json::json!({ "args": ["ignored"], "claude": intent })).unwrap()
    }

    #[test]
    fn the_bridge_builds_claudes_command_line_from_intent() {
        let (args, mcp) = claude_command(&claude_start(serde_json::json!({ "mode": "prompt", "model": "haiku", "effort": "low", "tools": true }))).unwrap();
        assert!(mcp);
        assert_eq!(&args[..3], &strings(&["-p", "--input-format", "stream-json"]));
        assert!(args.windows(2).any(|pair| pair[0] == "--model" && pair[1] == "haiku"));
        assert!(args.windows(2).any(|pair| pair[0] == "--effort" && pair[1] == "low"));
        assert!(args.windows(2).any(|pair| pair[0] == "--tools" && pair[1].is_empty()));
        assert!(args.windows(2).any(|pair| pair[0] == "--allowedTools" && pair[1] == "mcp__spectra"));
        assert!(args.contains(&"--strict-mcp-config".to_string()));
        let (plain, mcp) = claude_command(&claude_start(serde_json::json!({ "mode": "prompt", "model": "claude-fable-5-2" }))).unwrap();
        assert!(!mcp);
        assert!(!plain.iter().any(|arg| arg == "--mcp-config" || arg == "--effort"));
        assert_eq!(claude_command(&claude_start(serde_json::json!({ "mode": "auth-status" }))).unwrap().0, strings(&["auth", "status"]));
        for refused in [
            serde_json::json!({ "mode": "prompt", "model": "haiku --dangerously-skip-permissions" }),
            serde_json::json!({ "mode": "prompt", "model": "haiku", "effort": "--tools=Bash" }),
            serde_json::json!({ "mode": "shell" }),
        ] {
            let parsed = serde_json::from_value::<StartFrame>(serde_json::json!({ "claude": refused }));
            assert!(parsed.is_err() || claude_command(&parsed.unwrap()).is_err());
        }
        let old: StartFrame = serde_json::from_value(serde_json::json!({ "args": ["-p", "--tools", "", "--strict-mcp-config", "--extra"] })).unwrap();
        assert!(claude_command(&old).is_err());
    }

    #[test]
    fn the_bridge_owns_codexs_sandbox_and_methods() {
        let rewritten: serde_json::Value = serde_json::from_str(&codex_inbound(&serde_json::json!({
            "id": 3, "method": "thread/start",
            "params": {
                "model": "gpt-5.5", "ephemeral": true, "sandbox": "danger-full-access", "approvalPolicy": "on-request",
                "cwd": "/", "baseInstructions": "Be Spectra.", "dynamicTools": [{ "type": "function", "name": "read_work" }],
                "config": { "features.shell_tool": true, "sandbox_mode": "danger-full-access", "mcp_servers.github.enabled": false, "web_search": "live" }
            }
        }).to_string()).unwrap()).unwrap();
        let params = &rewritten["params"];
        assert_eq!(params["sandbox"], "read-only");
        assert_eq!(params["approvalPolicy"], "never");
        assert!(params.get("cwd").is_none());
        assert_eq!(params["baseInstructions"], "Be Spectra.");
        assert_eq!(params["dynamicTools"][0]["name"], "read_work");
        assert_eq!(params["config"]["features.shell_tool"], false);
        assert_eq!(params["config"]["web_search"], "disabled");
        assert_eq!(params["config"]["mcp_servers.github.enabled"], false);
        assert!(params["config"].get("sandbox_mode").is_none());
        let turn: serde_json::Value = serde_json::from_str(&codex_inbound(&serde_json::json!({
            "id": 4, "method": "turn/start", "params": { "threadId": "t", "effort": "medium", "input": [], "sandboxPolicy": { "type": "dangerFullAccess" }, "cwd": "/" }
        }).to_string()).unwrap()).unwrap();
        assert!(turn["params"].get("sandboxPolicy").is_none() && turn["params"].get("cwd").is_none());
        assert_eq!(turn["params"]["effort"], "medium");
        assert!(codex_inbound(r#"{"id":5,"method":"command/exec","params":{"command":["rm","-rf","/"]}}"#).is_err());
        assert!(codex_inbound(r#"{"id":6,"method":"config/value/write","params":{}}"#).is_err());
        assert!(codex_inbound("not json").is_err());
        assert!(codex_inbound(r#"{"id":7,"result":{"success":true}}"#).is_ok());
        assert!(codex_inbound(r#"{"method":"initialized"}"#).is_ok());
    }

    #[test]
    fn codex_using_anything_but_spectras_tools_ends_the_session() {
        assert!(codex_outbound_refused(r#"{"method":"item/started","params":{"item":{"type":"commandExecution","command":"ls"}}}"#));
        assert!(codex_outbound_refused(r#"{"method":"item/started","params":{"item":{"type":"mcpToolCall"}}}"#));
        assert!(!codex_outbound_refused(r#"{"method":"item/started","params":{"item":{"type":"agentMessage"}}}"#));
        assert!(!codex_outbound_refused(r#"{"method":"item/agentMessage/delta","params":{"delta":"hi"}}"#));
    }

    #[test]
    fn a_running_cli_session_is_counted_until_it_ends() {
        let before = live_sessions();
        let session = LiveSession::start();
        assert!(live_sessions() > before);
        drop(session);
        assert!(live_sessions() <= before + 1);
    }

    #[test]
    fn hub_session_ids_are_encoded_into_the_url() {
        assert_eq!(hub_pipe_url("wss://hub.test/", "a b&admin=1"), "wss://hub.test/_spectra/agent-hub/pipe?sid=a%20b%26admin%3D1");
    }

    #[test]
    fn a_tool_call_that_waits_too_long_is_a_tool_error() {
        let reply: serde_json::Value = serde_json::from_str(&mcp_timeout_reply(r#"{"jsonrpc":"2.0","id":12,"method":"tools/call"}"#)).unwrap();
        assert_eq!(reply["id"], 12);
        assert_eq!(reply["result"]["isError"], true);
        assert!(MCP_REPLY_TIMEOUT <= Duration::from_secs(5 * 60));
    }

    #[test]
    fn a_hub_reply_is_read_apart_from_a_cli_line() {
        let reply: McpReply = serde_json::from_str(r#"{"relayReply":4,"body":"{}"}"#).unwrap();
        assert_eq!(reply.relay_reply, 4);
        assert_eq!(reply.body.as_deref(), Some("{}"));
    }
}
