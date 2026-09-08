# Spectra Bridge desktop release runbook

This project builds the Bridge shell from `bridge/bridge-app`. The browser is
the normal pairing and setup surface; the native window stays hidden at
startup and the service runs quietly in the tray. Do not use this document to
claim Mac runtime verification from Windows.

## Final friend's-Mac test (unsigned)

On the friend's Mac, install Xcode Command Line Tools and Rust stable, then
from this directory run:

```sh
cd bridge/bridge-app
export SPECTRA_CONVEX_URL='https://<the-authoritative-deployment>.convex.cloud'
export SPECTRA_ORIGINS='https://<the-authoritative-browser-origin>'
cargo install tauri-cli --version 2.11.5 --locked
cargo tauri icon icons/tray-icon.svg
cargo tauri build --bundles app,dmg --config tauri.friend-test.conf.json
```

Because `bridge/bridge-app` is a member of the `bridge` workspace, the
unsigned test outputs are under `bridge/target/release/bundle/`:

- `macos/Spectra Bridge.app`
- `dmg/Spectra Bridge_0.1.0_aarch64.dmg` (the exact architecture/version name may vary)

Open the `.app` from Finder or with `open`, then check the local service before
pairing from the hosted browser:

```sh
open '../target/release/bundle/macos/Spectra Bridge.app'
curl --fail --max-time 10 http://127.0.0.1:47615/v1/health
test -f "$HOME/Library/Application Support/com.spectra.bridge/startup.log"
find "$HOME/Library/LaunchAgents" -maxdepth 1 -iname '*spectra*' -print
```

Expected readback: the health response is protocol `1.0`, the process is
paired only after the browser's Files and devices setup completes, the
startup log records `interactive` or `autostart`, and a LaunchAgent entry is
present after the first run. In the hosted browser, open Settings → Files and
devices, pair this device, add a disposable folder, approve the Mac folder
permission prompt, and verify the mount reaches `Ready` with the expected file
count. Use only copies of fixtures.

Exercise a second launch, login launch, browser reload/session resume, folder
remove/re-add, and a native-file save/readback on disposable files. Also check
that closing the native window hides it without stopping the loopback service,
and that the tray's Open logs action opens a diagnostic file. An unsigned app
may be blocked by Gatekeeper; that is expected for this test artifact and is
not a public launch result.

## Public candidate (only after signing decisions)

The manual workflow `.github/workflows/bridge-desktop.yml` has two explicit
modes. `friend-test` disables updater artifact generation and uploads unsigned
`.app`/DMG/NSIS artifacts only as workflow artifacts. `public-candidate` embeds
the supplied hosted Convex/origin configuration and requires all signing and
notarization secrets; it still does not publish a GitHub release.

Before any public candidate, configure a real Tauri updater signing key and
the exact hosted updater endpoint, Apple Developer ID Application certificate,
notarization credentials, team identity, bundle identifier, and release
artifact retention policy. Verify these on the Mac runner and inspect
`latest.json` URLs/signatures before adding a publish job. Never use the
friend-test artifacts as public installers or updater inputs.

## Mac launch gate

A Mac launch claim requires a signed/notarized candidate that passes install,
Gatekeeper assessment, first launch, login startup, update, uninstall/cleanup,
keychain credential persistence, filesystem permission prompts, provider
hydration/offline behavior, APFS identity continuity, and native-writer
stability. None of those Mac runtime claims can be established on Windows.
