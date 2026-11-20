//! Spectra for desktop: the app's own windows, showing the hosted Spectra.
//!
//! The page in a window is the hosted web app, so web deploys reach the app at
//! once; it talks to the Bridge over the same loopback API a browser uses
//! (docs/desktop/PLAN.md). Closing a window destroys its webview so a closed app
//! costs only the tray and the Bridge.

use spectra_bridge_core::journal::Journal;
use tauri::webview::NewWindowResponse;
use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub const MAIN_LABEL: &str = "main";
const BOUNDS_KEY: &str = "desktop_window_bounds";
const DEFAULT_WIDTH: f64 = 1280.0;
const DEFAULT_HEIGHT: f64 = 832.0;

/// What a window may show and which origins count as Spectra.
#[derive(Clone, Debug)]
pub struct DesktopSite {
    /// Where the window opens.
    pub origin: String,
    /// Every origin the Bridge serves; the page may move between them.
    pub origins: Vec<String>,
}

/// The browser arguments every webview of this app shares (WebView2 refuses a
/// second webview whose environment options differ). Wry's own defaults are kept;
/// the loopback checks are off because a Spectra window only ever shows Spectra
/// (`navigation_allowed`), and the Bridge it talks to is part of this app.
pub const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests";

pub fn is_spectra_window(label: &str) -> bool {
    label == MAIN_LABEL || label.starts_with("spectra-")
}

fn is_local_shell(url: &Url) -> bool {
    url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost")
}

fn origin_of(url: &Url) -> String {
    url.origin().ascii_serialization()
}

/// Same origin as one Spectra serves.
pub fn is_spectra_url(url: &Url, origins: &[String]) -> bool {
    let origin = origin_of(url);
    origins.iter().any(|allowed| allowed.trim_end_matches('/') == origin)
}

/// Spectra pages that only make sense in the person's own browser: signing the
/// app in from there, and downloading the app itself.
pub fn belongs_in_browser(url: &Url) -> bool {
    let path = url.path();
    path.starts_with("/desktop/sign-in") || path.starts_with("/desktop/download")
}

/// A main-frame navigation the window may follow. Spectra itself, its own
/// subdomains (Clerk runs on accounts./clerk. of the same domain), Clerk's
/// development hosts for a local Spectra, and the local start page. Anything
/// else opens in the person's browser instead.
pub fn navigation_allowed(url: &Url, origins: &[String]) -> bool {
    if is_local_shell(url) || matches!(url.scheme(), "about" | "blob" | "data") {
        return true;
    }
    if is_spectra_url(url, origins) {
        return !belongs_in_browser(url);
    }
    let Some(host) = url.host_str() else { return false };
    origins.iter().filter_map(|origin| Url::parse(origin).ok()).any(|origin| {
        let Some(origin_host) = origin.host_str() else { return false };
        let local = matches!(origin_host, "localhost" | "127.0.0.1" | "[::1]");
        if local {
            host.ends_with(".clerk.accounts.dev") || host.ends_with(".accounts.dev")
        } else {
            url.scheme() == "https" && host.ends_with(&format!(".{origin_host}"))
        }
    })
}

/// The read-only marker a Spectra page uses to know it runs in the app. It is
/// set only on Spectra's own origins and on the local start page.
pub fn marker_script(version: &str, site: &DesktopSite) -> String {
    let origins = serde_json::to_string(&site.origins).unwrap_or_else(|_| "[]".into());
    let marker = serde_json::json!({
        "version": version,
        "protocol": "1",
        "platform": std::env::consts::OS,
        "origin": site.origin,
        "capabilities": ["window", "silent-pair", "sign-in-handoff", "restart-update"],
    });
    format!(
        r#"(function(){{var o={origins};var here=location.origin;var shell=location.protocol==="tauri:"||location.hostname==="tauri.localhost";if(!shell&&o.indexOf(here)<0)return;var m={marker};m.capabilities=Object.freeze(m.capabilities);try{{Object.defineProperty(window,"spectraDesktop",{{value:Object.freeze(m),writable:false,configurable:false,enumerable:false}});}}catch(e){{}}}})();"#
    )
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub maximized: bool,
}

pub fn read_bounds(journal: &Journal) -> Option<Bounds> {
    let raw = journal.config(BOUNDS_KEY).ok().flatten()?;
    let bounds: Bounds = serde_json::from_str(&raw).ok()?;
    (bounds.width >= 400.0 && bounds.height >= 300.0 && bounds.width.is_finite() && bounds.height.is_finite())
        .then_some(bounds)
}

fn save_bounds(window: &tauri::WebviewWindow, journal: &Journal) {
    let (Ok(scale), Ok(position), Ok(size), Ok(maximized)) = (
        window.scale_factor(),
        window.outer_position(),
        window.inner_size(),
        window.is_maximized(),
    ) else {
        return;
    };
    if window.is_minimized().unwrap_or(false) {
        return;
    }
    let position = position.to_logical::<f64>(scale);
    let size = size.to_logical::<f64>(scale);
    let mut bounds = Bounds { x: position.x, y: position.y, width: size.width, height: size.height, maximized };
    // A maximized window keeps the size it had before, so restoring it unmaximized looks right.
    if maximized
        && let Some(previous) = read_bounds(journal) {
            bounds = Bounds { maximized: true, ..previous };
        }
    if let Ok(value) = serde_json::to_string(&bounds) {
        let _ = journal.set_config(BOUNDS_KEY, &value);
    }
}

/// Whether a saved position still lands on a connected screen.
fn on_a_screen(app: &tauri::AppHandle, bounds: &Bounds) -> bool {
    let Ok(monitors) = app.available_monitors() else { return false };
    monitors.iter().any(|monitor| {
        let scale = monitor.scale_factor();
        let position = monitor.position().to_logical::<f64>(scale);
        let size = monitor.size().to_logical::<f64>(scale);
        let (x, y) = (bounds.x + 60.0, bounds.y + 20.0);
        x >= position.x && y >= position.y && x < position.x + size.width && y < position.y + size.height
    })
}

static NEXT_WINDOW: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

fn spectra_window_builder<'a>(
    app: &'a tauri::AppHandle,
    label: String,
    url: WebviewUrl,
    site: &DesktopSite,
) -> WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle> {
    let guard_origins = site.origins.clone();
    let new_window_app = app.clone();
    let new_window_site = site.clone();
    let builder = WebviewWindowBuilder::new(app, label, url)
        .title("Spectra")
        .min_inner_size(720.0, 520.0)
        .initialization_script(marker_script(env!("CARGO_PKG_VERSION"), site))
        // Spectra's own drag and drop (files into the library, blocks, tabs) must reach the page.
        .disable_drag_drop_handler()
        .on_navigation(move |url| {
            if navigation_allowed(url, &guard_origins) {
                return true;
            }
            if matches!(url.scheme(), "https" | "http" | "mailto") {
                let _ = crate::open_with_system(std::ffi::OsStr::new(url.as_str()));
            }
            false
        })
        .on_new_window(move |url, features| {
            // Spectra opening Spectra (a work in a new tab) gets a window of its own;
            // everything else belongs in the person's browser.
            if is_spectra_url(&url, &new_window_site.origins) && !belongs_in_browser(&url) {
                let label = format!(
                    "spectra-{}",
                    NEXT_WINDOW.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                );
                let built = spectra_window_builder(
                    &new_window_app,
                    label,
                    WebviewUrl::External(url.clone()),
                    &new_window_site,
                )
                .window_features(features)
                .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
                .build();
                if let Ok(window) = built {
                    watch_window(&new_window_app, &window, None);
                    return NewWindowResponse::Create { window };
                }
            }
            if matches!(url.scheme(), "https" | "http" | "mailto") {
                let _ = crate::open_with_system(std::ffi::OsStr::new(url.as_str()));
            }
            NewWindowResponse::Deny
        });
    #[cfg(windows)]
    let builder = builder.additional_browser_args(BROWSER_ARGS);
    builder
}

fn watch_window(app: &tauri::AppHandle, window: &tauri::WebviewWindow, journal: Option<std::sync::Arc<Journal>>) {
    let app = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(true) => crate::nudge_update_check(),
        WindowEvent::CloseRequested { .. } => {
            if let (Some(journal), Some(window)) = (&journal, app.get_webview_window(MAIN_LABEL)) {
                save_bounds(&window, journal);
            }
        }
        WindowEvent::Destroyed => {
            set_dock_presence(&app);
            crate::nudge_update_install();
        }
        _ => {}
    });
}

/// Any Spectra window is open.
pub fn any_open(app: &tauri::AppHandle) -> bool {
    app.webview_windows().keys().any(|label| is_spectra_window(label))
}

/// The Dock icon follows the windows on macOS: an app with no window lives in the menu bar only.
pub fn set_dock_presence(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let policy = if any_open(app) {
            tauri::ActivationPolicy::Regular
        } else {
            tauri::ActivationPolicy::Accessory
        };
        let _ = app.set_activation_policy(policy);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Opens Spectra, or brings its window to the front. `path` (such as
/// `/devices`) goes straight to that page; without one the window starts at
/// the local start page, which waits for the network and then opens Spectra.
pub fn open(app: &tauri::AppHandle, journal: std::sync::Arc<Journal>, site: DesktopSite, path: Option<&str>) {
    let target = path.and_then(|path| Url::parse(&format!("{}{}", site.origin.trim_end_matches('/'), path)).ok());
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        if let Some(target) = target {
            let _ = window.navigate(target);
        }
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let url = match target {
        Some(target) => WebviewUrl::External(target),
        None => WebviewUrl::App("index.html".into()),
    };
    let mut builder = spectra_window_builder(app, MAIN_LABEL.into(), url, &site).visible(false);
    let bounds = read_bounds(&journal);
    builder = match bounds {
        Some(bounds) if on_a_screen(app, &bounds) => builder
            .inner_size(bounds.width, bounds.height)
            .position(bounds.x, bounds.y)
            .maximized(bounds.maximized),
        Some(bounds) => builder.inner_size(bounds.width, bounds.height).center().maximized(bounds.maximized),
        None => builder.inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT).center(),
    };
    match builder.build() {
        Ok(window) => {
            watch_window(app, &window, Some(journal.clone()));
            let _ = window.show();
            let _ = window.set_focus();
            set_dock_presence(app);
        }
        Err(error) => {
            crate::record_runtime_error(&journal, "Could not open the Spectra window", &error);
        }
    }
}

/* ------------------------------------------------------------- migration */

/// The Spectra Bridge 0.1.x install this app replaces. The update installs
/// Spectra beside it (a new product name means a new folder), so the old copy,
/// its login task and its uninstall entry are cleared once. App data is never
/// touched: it lives under the unchanged identifier `com.spectra.bridge`.
#[cfg(windows)]
pub fn retire_bridge_install(journal: &Journal) {
    const DONE: &str = "retired_bridge_install";
    if journal.config(DONE).ok().flatten().is_some() {
        return;
    }
    let Some(local) = std::env::var_os("LOCALAPPDATA").map(std::path::PathBuf::from) else { return };
    let old = local.join("Spectra Bridge");
    let running = std::env::current_exe().ok();
    if running.as_ref().is_some_and(|exe| exe.starts_with(&old)) {
        // Still running from the old folder (a source build or a manual copy): nothing to retire.
        return;
    }
    let mut problems = Vec::new();
    retire_old_logon_task(&mut problems);
    {
        use winreg::RegKey;
        use winreg::enums::HKEY_CURRENT_USER;
        let user = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(run) = user.open_subkey_with_flags(
            "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
            winreg::enums::KEY_SET_VALUE,
        ) {
            let _ = run.delete_value("Spectra Bridge");
        }
        let _ = user.delete_subkey_all("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Spectra Bridge");
        let _ = user.delete_subkey_all("Software\\spectra\\Spectra Bridge");
    }
    if let Some(roaming) = std::env::var_os("APPDATA").map(std::path::PathBuf::from) {
        for shortcut in [
            "Microsoft\\Windows\\Start Menu\\Programs\\Spectra Bridge.lnk",
            "Microsoft\\Windows\\Start Menu\\Programs\\Startup\\Spectra Bridge.lnk",
        ] {
            let path = roaming.join(shortcut);
            if path.exists()
                && let Err(error) = std::fs::remove_file(&path) {
                    problems.push(format!("{}: {error}", path.display()));
                }
        }
    }
    if let Some(desktop) = std::env::var_os("USERPROFILE").map(|home| std::path::PathBuf::from(home).join("Desktop\\Spectra Bridge.lnk")) {
        let _ = std::fs::remove_file(desktop);
    }
    // Only the files the old installer wrote; the folder goes only once empty.
    for file in ["spectra-bridge.exe", "uninstall.exe"] {
        let path = old.join(file);
        if path.exists()
            && let Err(error) = std::fs::remove_file(&path) {
                problems.push(format!("{}: {error}", path.display()));
            }
    }
    let _ = std::fs::remove_dir(&old);
    if problems.is_empty() {
        let _ = journal.set_config(DONE, "1");
    } else {
        // An old file still in use is retried on the next start.
        let _ = journal.set_config("retire_bridge_install_problem", &problems.join("; "));
    }
}

#[cfg(windows)]
fn retire_old_logon_task(problems: &mut Vec<String>) {
    use std::os::windows::process::CommandExt;
    let status = std::process::Command::new("schtasks.exe")
        .args(["/Delete", "/TN", "Spectra Bridge", "/F"])
        .creation_flags(crate::WINDOWS_CREATE_NO_WINDOW)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    // A missing task exits non-zero; that is the goal state, not a problem.
    if let Err(error) = status {
        problems.push(format!("logon task: {error}"));
    }
}

#[cfg(not(windows))]
pub fn retire_bridge_install(journal: &Journal) {
    #[cfg(target_os = "macos")]
    {
        const DONE: &str = "retired_bridge_install";
        if journal.config(DONE).ok().flatten().is_some() {
            return;
        }
        // The autostart plugin names its LaunchAgent after the product; the old one would start the app twice.
        if let Some(home) = std::env::var_os("HOME").map(std::path::PathBuf::from) {
            let _ = std::fs::remove_file(home.join("Library/LaunchAgents/Spectra Bridge.plist"));
        }
        let _ = journal.set_config(DONE, "1");
    }
    #[cfg(not(target_os = "macos"))]
    let _ = journal;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn site() -> DesktopSite {
        DesktopSite { origin: "https://spectra.ink".into(), origins: vec!["https://spectra.ink".into()] }
    }

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap()
    }

    #[test]
    fn a_window_stays_on_spectra_and_its_sign_in() {
        let origins = site().origins;
        assert!(navigation_allowed(&url("https://spectra.ink/devices"), &origins));
        assert!(navigation_allowed(&url("https://accounts.spectra.ink/sign-in"), &origins));
        assert!(navigation_allowed(&url("https://clerk.spectra.ink/v1/client"), &origins));
        assert!(navigation_allowed(&url("http://tauri.localhost/index.html"), &origins));
        assert!(navigation_allowed(&url("about:blank"), &origins));
        assert!(!navigation_allowed(&url("http://spectra.ink/"), &origins));
        assert!(!navigation_allowed(&url("https://evilspectra.ink/"), &origins));
        assert!(!navigation_allowed(&url("https://accounts.google.com/o/oauth2"), &origins));
        assert!(!navigation_allowed(&url("https://example.com/"), &origins));
    }

    #[test]
    fn signing_the_app_in_and_downloading_it_open_in_the_browser() {
        let origins = site().origins;
        assert!(!navigation_allowed(&url("https://spectra.ink/desktop/sign-in#s=abc"), &origins));
        assert!(!navigation_allowed(&url("https://spectra.ink/desktop/download/windows"), &origins));
        assert!(navigation_allowed(&url("https://spectra.ink/sign-in"), &origins));
        assert!(navigation_allowed(&url("https://spectra.ink/desktop"), &origins));
    }

    #[test]
    fn a_local_spectra_may_use_clerk_development_hosts() {
        let origins = vec!["http://localhost:3000".to_string()];
        assert!(navigation_allowed(&url("http://localhost:3000/workspace"), &origins));
        assert!(navigation_allowed(&url("https://smart-cat-1.clerk.accounts.dev/sign-in"), &origins));
        assert!(!navigation_allowed(&url("http://localhost:4000/"), &origins));
        assert!(!navigation_allowed(&url("https://sub.localhost/"), &origins));
    }

    #[test]
    fn spectra_urls_are_exact_origins() {
        let origins = site().origins;
        assert!(is_spectra_url(&url("https://spectra.ink/w/1?x=2"), &origins));
        assert!(!is_spectra_url(&url("https://accounts.spectra.ink/"), &origins));
    }

    #[test]
    fn the_marker_names_the_version_and_only_trusts_spectra() {
        let script = marker_script("0.2.0", &site());
        assert!(script.contains("\"version\":\"0.2.0\""));
        assert!(script.contains("[\"https://spectra.ink\"]"));
        assert!(script.contains("spectraDesktop"));
        assert!(script.contains("o.indexOf(here)<0)return"));
    }

    #[test]
    fn browser_args_keep_wry_defaults() {
        for feature in ["msWebOOUI", "msPdfOOUI", "msSmartScreenProtection", "LocalNetworkAccessChecks"] {
            assert!(BROWSER_ARGS.contains(feature));
        }
    }
}
