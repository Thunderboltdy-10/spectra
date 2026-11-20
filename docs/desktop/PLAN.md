# Spectra for desktop

The Bridge stops being a separate, unexplained helper. People install **Spectra**, a desktop app. It opens
spectra.ink in its own window, and it carries the Bridge inside it. Closing the window leaves only the Bridge
running in the tray. The web app keeps working with the Bridge exactly as today.

This plan decides; it has no open questions. Where something must be measured first, the rule for acting on the
result is written next to it.

## Why this works with almost no new code

`bridge/bridge-app` is already a Tauri 2 app (`com.spectra.bridge`, tray, single instance, autostart, signed
updater, local control API on `127.0.0.1:47615`). It just has `"windows": []`. Spectra for desktop is that same
binary with one window that loads `https://spectra.ink`. The page in that window is the hosted web app, so every
web deploy reaches desktop users at once; only Rust changes need an app update.

Alternatives, and why not:

- **Open spectra.ink in the default browser.** That is a tab, not an app: no dock/taskbar identity, no window
  state, and the loopback-permission prompt stays. Rejected.
- **Electron.** Bundles Chromium (~150 MB, ~2× the memory) and would mean rewriting or sidecar-ing the Rust
  Bridge. Rejected.
- **Installable PWA.** App-like window, but no Bridge, so it does not solve the actual problem. It can stay as a
  bonus for people who will not install anything.

## Decisions

### 1. One process, two modes

- **Window open:** a `WebviewWindow` (label `main`) loads `https://spectra.ink` (the baked `SPECTRA_ORIGINS`
  primary origin; debug builds use the dev origin). Window size and position are remembered in the journal.
- **Window closed:** the close button **destroys** the webview (not hide), so WebView2/WKWebView memory is
  released. Only the tray and the Bridge stay, as today. Tray click, the tray's **Open Spectra**, a second launch
  (single-instance callback) and the dock icon on macOS reopen it.
- **Quit** (tray, or Cmd+Q on macOS) stops everything, as **Quit Bridge** does now.
- **Login start:** `--autostart` starts tray-only, exactly like today. An interactive launch opens the window.
- **Offline:** if `spectra.ink` cannot load, the window shows a bundled offline page (prism, "Spectra can't reach
  the internet. Your folders keep syncing when it's back.", Try again). The Bridge is unaffected.

### 2. The page talks to the Bridge the same way everywhere

The window's origin is `https://spectra.ink`, so the existing loopback HTTP + WebSocket protocol, CORS and
`ServerState::origin_allowed` work unchanged. There is **one** code path for web and desktop, which is the main
reliability argument; Tauri IPC from a remote origin would be a second path to keep correct.

Desktop-only additions, all small:

- **No loopback prompt.** On Windows the app handles WebView2's `PermissionRequested` for the local-network /
  loopback kinds and allows them **only** when the requesting origin is an allowed origin. WKWebView does not
  prompt.
- **A desktop marker.** An initialization script, injected only into the `main` window and only when its URL is an
  allowed origin, sets `window.spectraDesktop = { version, protocol, capabilities }` (read-only, frozen). The page
  uses it to: skip every "download/install" surface, pair silently (§4), show "Spectra for desktop" instead of
  "Spectra Bridge" in places that name the app, and offer **Check for updates**.
- **Navigation guard.** The window only navigates within allowed origins and the Clerk domains Spectra uses.
  Any other link, `target=_blank` or `window.open` opens in the system browser.
- Downloads from the page (exports) go through Tauri's download handler to the user's Downloads folder.

### 3. Signing in inside the window

Clerk runs in the webview. Email and password sign-in work as on the web. Google (and any OAuth provider) is often
refused inside embedded webviews, so on desktop OAuth always goes through the system browser:

1. In the window, **Continue with Google** (desktop marker present) opens
   `https://spectra.ink/desktop/sign-in?nonce=<n>` in the system browser. `n` is a random nonce the app also
   holds.
2. That page signs in normally, then calls a server route that mints a short-lived Clerk sign-in token
   (backend `signInTokens.create`, 60 s expiry) for the signed-in user, and POSTs `{nonce, token}` to the
   Bridge at `/v1/desktop/handoff` (origin-checked like `/v1/pair`).
3. The Bridge accepts only the nonce it is holding, once, within 2 minutes, then navigates the window to
   `/desktop/ticket#token=…`, which completes Clerk's `ticket` strategy and lands on Home. The browser tab says
   "You're signed in to Spectra for desktop. You can close this tab."

### 4. Pairing becomes invisible on desktop

On desktop the person never sees "Connect this computer". When the page has the desktop marker, the user is
signed in and the Bridge reports unpaired, the page runs the existing silent `auto_pair` flow. When the Bridge is
paired to a **different** account, the page shows the existing "connected to another Spectra" message with one
**Switch this computer to <account>** action (unpair + pair; files stay).

On the web the flow stays as it is, but the offer becomes: "To sync folders on this computer, install Spectra for
desktop", with the download. If the app is already installed and running, the web detects the Bridge as today and
works with it; the copy names the app "Spectra for desktop" and the background part "Bridge".

### 5. Names

- **The app** is **Spectra** (installer, window, taskbar/dock, Start menu, tray tooltip "Spectra · Connected · 3
  folders").
- **Bridge** stays as the name of the part that syncs local files, used where that part is the subject: the
  Devices page heading "Bridge" section, tray "Pause syncing", AI commands, logs. Copy rule: say "Spectra for
  desktop" when telling someone what to install, "Bridge" when describing syncing.
- Tray menu: account line · **Open Spectra** · **Pause syncing / Resume syncing** · **Check for updates** ·
  **Disconnect this computer** · **Quit Spectra**.

### 6. Existing installs update in place — nobody uninstalls, nothing starts from scratch

- **Identifier stays `com.spectra.bridge` forever.** It is invisible, and it is what keeps the app-data folder
  (journal, sync state, logs), the keyring entries and the device credential. Changing it would force everyone to
  start over; keeping it means a Bridge user's next update simply becomes Spectra, still paired, folders intact.
  The WebView2 profile goes in the same folder (`EBWebView/`), so it is new but harmless.
- **The updater signing key stays the same**, so installed 0.1.x Bridges accept the update.
- **Releases repo:** rename `Thunderboltdy-10/spectra-bridge` → `Thunderboltdy-10/spectra-desktop` on GitHub.
  GitHub redirects the old `releases/latest/download/latest.json` URL, which is what every installed Bridge has
  baked in. Never create a new repo under the old name (that kills the redirect). The new app lists both
  endpoints (new first, old second). `BRIDGE_RELEASES_REPO` and `RELEASES_REPO` defaults move to the new name.
  Tags become `desktop-v*`: installing and updating is the desktop app, never "Bridge".
- **Version 0.2.0.** Versions continue from the last Bridge release (0.1.3). The web detects features by
  capability, not version.
- **Install folder never shares the data folder.** `%LOCALAPPDATA%\Spectra\` already holds user data: the
  device-only works store (`works/works.db`, `bridge-core/src/works.rs`) and `agent-relay.token`
  (`agent_relay.rs`). Tauri's per-user NSIS default for a product named "Spectra" is exactly that folder, so an
  install, update or uninstall there could touch people's works. An NSIS `installerHooks` `NSIS_HOOK_PREINSTALL`
  sets `$INSTDIR` to `$LOCALAPPDATA\Programs\Spectra` (the Windows convention for per-user apps). The release
  check installs, updates and uninstalls a build on a profile with a seeded `works.db` and asserts the file and
  its hash are untouched. If the hook cannot move `$INSTDIR` in update mode, the fallback is a custom NSIS
  template with that one line changed; shipping into `%LOCALAPPDATA%\Spectra` is not an option.
- **Windows migration.** `productName` becomes `Spectra`, `mainBinaryName` `spectra`. The NSIS update then
  installs into `%LOCALAPPDATA%\Programs\Spectra`, so the old copy must be cleaned up. On first start of 0.2.0 the app,
  once, records `migrated_from_bridge` in the journal after: deleting the scheduled task `Spectra Bridge` (the new
  one is `Spectra`), the `HKCU\…\Run\Spectra Bridge` value, the old Startup shortcut, the old Start menu shortcut,
  the `HKCU\…\Uninstall\Spectra Bridge` key, and `%LOCALAPPDATA%\Spectra Bridge\` (after confirming the running
  exe is not inside it). It never runs the old uninstaller, because that one can offer to delete app data. Each
  step is idempotent and failures are logged, not fatal.
- **macOS migration.** The Tauri macOS updater replaces the bundle in place, so the bundle path stays
  `Spectra Bridge.app` while its name in the menu bar and Dock becomes Spectra. The app removes the old
  `Spectra Bridge` LaunchAgent plist after registering the new one. The Finder name corrects itself on the next
  manual install; renaming a running bundle is not worth the risk.
- **Message to existing users:** "Spectra Bridge becomes Spectra for desktop. It updates by itself; you don't need
  to do anything. Your folders stay connected."

### 7. Updates arrive within the hour

- Check 60 s after start, then **every 30 min**, on wake from sleep, when the window gains focus (at most once per
  10 min), on tray **Check for updates**, and when the web asks (`/v1/update`, unchanged). `latest.json` is a tiny
  GitHub CDN file, so this costs nothing in Convex.
- Installing keeps the existing idle gate (no run, sync or open work). With the window **closed** it installs and
  restarts silently once idle. With the window **open**, the page shows a quiet "Spectra updated — Restart" pill
  (from `update_note`) and installs on the next window close or after 6 h idle, whichever comes first, so a page
  never disappears under someone's cursor.
- Web code needs none of this: the window loads spectra.ink, so a web deploy is live on the next navigation.

### 8. Claude Code and Codex

The installer keeps doing nothing extra; Spectra already sets up Codex and Claude Code from the app
(`fa7bc3ed`). That flow keeps working because the agent relay lives in the Bridge, which is in the app. The
setup copy changes from "needs Spectra Bridge" to "needs Spectra for desktop". On desktop the AI settings show
**Set up Claude Code / Codex** directly, with no install step before it.

## The Bridge, made simpler to understand

The engine is in good shape; the model shown to people is the problem. Today a person meets mounts, single-file
selections, an account-wide "New files sync both ways", OneDrive twins, link-by-hand, work home, native writes and
discovery requests, and none of it is visible where the files are. The rules below change what is shown and a few
defaults, not the engine.

### One idea: synced folders

- A **synced folder** is a folder on a computer, connected to a Spectra folder. A single file picked on its own is
  a synced folder of one file, shown with the file's name.
- **A file inside a synced folder always belongs to that folder.** Picking it (Add files, AI `sync_named`, drag in)
  never creates a separate selection: the Bridge resolves it to the containing grant and brings that file in
  regardless of the folder's new-files setting. The grant side already holds: `take_over_selections_within`
  folds single files into a newly added parent, and `add_native_file_selections` reports a file inside a folder
  as `already_synced`. The gap is the work side: when that folder skipped the file (`explicit-only`, `filtered`,
  `ignored-by-user`), the person is told it is already synced while it is not in Spectra. Picking it now records
  an approved `syncDiscoveryRequests` row for that file and wakes the folder, so it comes in on the next pass; the
  notice only says "already in Spectra" when a work exists.
- **New files, per folder.** Each synced folder has one setting, **New files**: *Bring in automatically*
  (default), *Ask me*, *Only the ones I pick*. It is the existing mount-scope policy (`discovery` +
  `structure`), so no new tables. The account switch becomes the default for folders added later, and the Devices
  page names it so.
- **Same folder on two computers** (OneDrive, Dropbox, iCloud, a USB copy): twins link automatically when the
  same relative path and content hash meet, as now. What changes is that it is shown: the file says **Also on:
  Laptop**, and the folder says **Same as "Documents › Biology" on Laptop**, with **Unlink**. Link-by-hand stays
  for the case where paths differ.

### Info where the files are

Each synced folder and each linked work gets a **Local** panel in Spectra's existing details/info surface:

- **Where:** computer, friendly path, Reveal, Open in its app.
- **State:** synced / syncing (progress) / waiting for Word to close / paused / problem with the fix in words.
- **History:** the last 20 events for that item (synced from disk, sent to disk, renamed, conflict kept both),
  read from rows that already exist (`workReplicas`, write and fs requests); nothing new is written per event.
- **Options:** New files (folders), Pause, Stop syncing (files stay), Also on / Unlink.

The Devices page gains nothing new beyond a folder list that opens the same panel. It loses the account-wide
switch's ambiguity (see above) and the install steps on desktop.

### The AI can do everything a person can

Every action above is a command in the shared registry: add a folder by path, pick files, set New files, pause,
resume, stop syncing, retry, link/unlink twins, reveal, explain a folder's state. Everything that touches the
computer asks first (`settings`/`irreversible` categories, as today).

## Reliability

Target: a save on disk is in Spectra within **3 s**; an edit in Spectra is on disk within **5 s**, with or without
a window open; nothing is ever lost or silently duplicated.

1. **Scenario suite.** A Rust integration harness runs two Bridges with separate `SPECTRA_BRIDGE_DATA_DIR`s against
   a dev Convex deployment and a shared temp folder standing in for OneDrive. Scenarios: create/edit/rename/move/
   delete on each side; the same file edited on both computers offline then reconnected (one work, conflict kept
   as both); Word holding a lock; 500-file folder added; sleep/resume; network drop mid-upload; update mid-sync;
   unpair/re-pair; account switch; nested selection merge; the 0.1.3 → 0.2.0 migration on a copied app-data
   folder. Each asserts end state and timing.
2. **Fix what it finds** before the release; anything that misses the latency target gets a cause written in the
   test.
3. **Convex budget.** Before and after, record function calls, database bandwidth and document reads for a fixed
   script (pair, add 200-file folder, 50 edits, idle 1 h) from the admin usage view. The release does not ship if
   any of the three goes up. Rules that keep it there: the Local panel and Also-on read only by index and `.take`
   bounded lists; no new subscription per file; the desktop window's presence costs nothing in Convex (the Bridge
   already holds the work signal; the page holds its normal one); health reports stay at 15 min.

## Phases

1. **Desktop shell.** Window, close-destroys, offline page, navigation guard, desktop marker, WebView2 loopback
   permission, tray changes, names, `productName`/`mainBinaryName`, the `$LOCALAPPDATA\Programs\Spectra` install
   hook and its works.db safety check, both updater endpoints, 30-min update cadence
   and restart pill, Windows and macOS migration. `cargo test`, clippy, and the bridge skill's local NSIS build.
2. **Web.** Desktop-aware pairing, install copy everywhere (inventory below), download routes renamed
   `/desktop/download/[platform]` with `/bridge/download/*` redirecting, landing page download, Setup and tour
   copy, AI provider setup copy, desktop sign-in handoff routes. Component tests updated.
3. **Synced-folder model.** Nested selection resolution and merge, per-folder New files, Also on, Local panel,
   AI commands. Convex tests for policy and twins.
4. **Reliability suite and Convex budget**, then fixes.
5. **Release.** Repo rename, workflow rename (`spectra-desktop-release.yml`, on `desktop-v*` tags), docs
   (`docs/product/DEVICES.md` rewritten around the desktop app, `RELEASE.md`). Tag only when Pablo says.

## Rename inventory (outside `bridge/`)

Copy says "Spectra for desktop" where it tells someone what to install and "Bridge" where it describes syncing.
On desktop (marker present) every install/download surface is hidden.

- **Download and release:** `src/app/bridge/download/[platform]/route.ts`, `src/app/bridge/latest/route.ts` (move
  to `/desktop/download/*` and `/desktop/latest`, old paths redirect; add `/desktop/latest` to the public list in
  `src/proxy.ts`), `bridgeDownloadUrl`/`bridgePlatform` in `src/features/spectra/bridge/client.ts`, `.env.example`
  (`SPECTRA_BRIDGE_RELEASES_REPO` → `SPECTRA_DESKTOP_RELEASES_REPO`, old name still read), both workflows,
  `docs/LAUNCH.md` §5, `docs/ENVIRONMENT.md`. One `DEFAULT_RELEASES_REPO` constant instead of three strings.
- **Intel Macs:** the browser cannot tell Apple silicon from Intel, so the Mac download stays arm64 and gets a
  small "Intel Mac?" link to `?arch=x64` (today Intel users have no way to get the right file).
- **Devices:** `devices-page.tsx`, `pairing-panel.tsx`, `bridge-install-steps.tsx` (the loopback-permission step
  disappears on desktop), `device-card.tsx`, `devices-model.ts`, `pairing.ts` `PAIRING_COPY`, `device-actions.ts`.
- **Setup and tour:** `onboarding/setup.tsx` (`BridgeStep` becomes "Spectra for desktop"; on desktop the step is
  already done), `tour-asks.tsx`, `tour-steps.ts`, `first-tips.tsx`, `bridge-discovery-mount.tsx` toasts.
- **Availability and errors:** `bridge/availability.ts`, `client.ts` reachability and pairing messages,
  `network-permission.ts`, `file-storage-controls.tsx`, `sync-toggles.ts`, `resource-surface.tsx`, `humanize.ts`,
  `device-works.ts`, `island/composer.tsx`, `settings/ui/runtime-settings.tsx`, `settings/schema/ai-permissions.ts`,
  `artifact-studio.tsx`, `data/api.ts`, `spectra-shell.tsx`, `app/api/spectra/route.ts`, the docx/office lens
  routes, `lib/device-restore-server.ts`, `convex/spectraArtifactWrites.ts`. "Open Spectra Bridge on the
  computer…" becomes "Open Spectra on the computer…".
- **AI providers:** `ai/provider-setup.tsx`, `use-agent-runtime.ts` copy only; commands unchanged.
- **Landing:** `landing/world/replies.ts`, `landing/spectra/scenes/bridge.tsx`, `ending.tsx`, plus a desktop
  download in the landing's call to action.
- **Docs:** `README.md`, `docs/README.md`, `docs/product/DEVICES.md` (rewritten), `docs/ai/HARNESS.md`,
  `bridge/bridge-app/RELEASE.md`.
- **Tests pinning copy:** `devices-model.test.ts`, `devices-page.component.test.tsx`,
  `setup-progress.component.test.tsx`, `runtime-chain.test.ts`, `run.test.ts`, `device-actions.test.ts`,
  `route.test.ts`.
- **Do not rename** (not this Bridge): `convex/bridgeIdentity.ts`, `secretBridgeNonces`, `verifyAgentBridge`,
  `collaborationGatewayBridge.ts`, `shared/collaboration-bridge.ts`, `scripts/collaboration-gateway-bridge-client.mjs`,
  and the Convex `bridge*` tables and functions (internal names; renaming them buys nothing and costs a migration).
- **Tidy while there:** port `47615` is hard-coded in eight files; it becomes one `BRIDGE_PORT` in `shared/`.
  `pairing.ts`'s header and `DEVICES.md` describe `auto_pair`, while the web pairs through `/v1/pair` +
  `/v1/pair/status`; the docs are corrected to the code. `scripts/local/start-all.mjs` points at "Settings →
  Files and devices"; it becomes `/devices`.

## Backward compatibility

- Web ↔ Bridge stays on protocol 1.x. The web treats `window.spectraDesktop` as optional and keeps working with
  0.1.x Bridges (no marker, old copy says "Spectra Bridge is out of date — it updates by itself").
- New local routes (`/v1/desktop/handoff`) are probed via `capabilities`; the web never calls them on old Bridges.
- Old download URLs redirect; old updater URL redirects through GitHub.
