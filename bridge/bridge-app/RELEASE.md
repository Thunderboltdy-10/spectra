# Spectra Bridge desktop release runbook

This project builds the Bridge shell from `bridge/bridge-app`. The browser is
the normal pairing and setup surface; the native window stays hidden at
startup and the service runs quietly in the tray. The friend-test artifact is
unsigned; on macOS, Control-click → Open (or Privacy & Security → Open Anyway)
may be required on first launch. Do not use this document to
claim Mac runtime verification from Windows.

## Final friend's-Mac test (unsigned)

On the friend's Mac, install Xcode Command Line Tools and Rust stable, then
from this directory run:

```sh
cd bridge/bridge-app
export SPECTRA_CONVEX_URL='https://<the-authoritative-deployment>.convex.cloud'
export SPECTRA_ORIGINS='https://spectra.ink'
cargo install tauri-cli --version 2.11.5 --locked
cargo tauri icon icons/app-icon.png
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
paired only after Connect this computer on the Devices page completes, the
startup log records `interactive` or `autostart`, and a LaunchAgent entry is
present after the first run. In the hosted browser, open Devices, press
Connect this computer, confirm the matching code in the native dialog, add a
disposable folder, approve the Mac folder
permission prompt, and verify the mount reaches `Ready` with the expected file
count. Use only copies of fixtures.

Exercise a second launch, login launch, browser reload/session resume, folder
remove/re-add, pause/resume (tray and page), and a native-file save/readback
on disposable files. Also check that the tray's Open Devices in Spectra opens
the Devices page, its tooltip names the state, and Show logs on the page opens
a diagnostic file. An unsigned app
may be blocked by Gatekeeper; that is expected for this test artifact and is
not a public launch result.

## Public candidate (without publisher certificates)

The manual workflow `.github/workflows/bridge-desktop.yml` has two explicit
modes. `friend-test` disables updater artifact generation and uploads unsigned
`.app`/DMG/NSIS artifacts only as workflow artifacts. `public-candidate` embeds
the supplied hosted Convex/origin configuration and requires the Tauri updater
signing key; it still does not publish a GitHub release.

`TAURI_SIGNING_PRIVATE_KEY` must match the public key in `tauri.conf.json`;
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` may be empty for an unencrypted key. This
signature protects updater downloads and is separate from an OS publisher
certificate. Do not set `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, or
Apple notarization credentials in these workflows, even to empty strings: Tauri
attempts a certificate import when both certificate variables exist. The macOS
`signingIdentity: "-"` uses ad-hoc signing without an Apple Developer account.
Windows NSIS packaging needs no certificate. These installers may show operating-
system trust warnings. Inspect `latest.json` URLs/signatures and perform platform
install checks before a launch claim. Never use friend-test artifacts as updater
inputs.

## Mac launch gate

A Mac runtime claim requires testing the actual ad-hoc-signed candidate through
install, the expected operating-system warning, first launch, login startup, update, uninstall/cleanup,
keychain credential persistence, filesystem permission prompts, provider
hydration/offline behavior, APFS identity continuity, and native-writer
stability. Ad-hoc signing does not confer Apple publisher verification or
notarization. None of those Mac runtime claims can be established on Windows.
