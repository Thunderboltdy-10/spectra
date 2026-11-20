# Devices and Spectra for desktop

**Spectra for desktop** is the app people install on their computer. It shows Spectra in its own window and carries
the **Bridge**, the part that syncs files between the computer and Spectra. "Bridge" names the syncing; the thing
people download and open is Spectra for desktop. Onboarding says it plainly: install Spectra for desktop to sync
local files.

The app is `bridge/bridge-app` (Tauri 2, identifier `com.spectra.bridge`, kept so the old tray-only Bridge updates in
place). The design and its decisions are in [docs/desktop/PLAN.md](../desktop/PLAN.md).

## The app

- **One process, two modes.** With the window open it shows `https://spectra.ink` (the first baked origin). The
  page is the hosted web app, so every web deploy reaches desktop users without an app update. Closing the window
  destroys the webview; the tray and the Bridge keep running. Tray click, **Open Spectra**, a second launch and the
  dock icon reopen it. Login start is tray-only.
- **Offline.** If the site cannot load, a bundled page says so and offers Try again. Syncing carries on.
- **The desktop marker.** Only in its own window, and only on an allowed origin, the app sets a frozen
  `window.spectraDesktop` (`version`, `protocol`, `capabilities`). The page uses it to hide download prompts, to
  name the app, and to offer sign-in through the browser.
- **Links.** The window stays on allowed origins and the Clerk domains Spectra uses. Other links, new windows,
  `/desktop/sign-in` and `/desktop/download` open in the system browser.
- **Signing in.** Email sign-in works in the window. Google and Microsoft accounts use **Sign in with your
  browser**: the window opens `/desktop/sign-in#s=<secret>` in the browser, both screens show the same 6-digit code,
  and on the person's confirmation the browser seals a 2-minute Clerk sign-in ticket with a key derived from the
  secret and leaves it in `desktopSignIns` (expires after 2 minutes, taken once). The window opens it and signs in.
  The secret never leaves the two screens; the server only sees its hash and the sealed ticket.
- **The tray.** The Spectra prism with a state dot (none when connected, grey disconnected, orange needs the user,
  red problem). The tooltip names the state ("Spectra · Connected · 3 folders"). The menu: Open Spectra; the
  connected account (not clickable); Pause or Resume syncing; Show sync log; Check for updates (with the version);
  Disconnect this computer; Quit Spectra.
- **Updates.** The app checks a minute after it starts, then every 30 minutes, and also when the window gains focus
  or the computer wakes. It installs when the Bridge is idle. A ready update is reported in health (`updateReady`),
  and the page can restart into it (`POST /v1/update/restart`). Releases come from
  `Thunderboltdy-10/spectra-desktop`, with the old `spectra-bridge` repository as the second updater endpoint.
- **Windows install.** Per-user, in `%LOCALAPPDATA%\Programs\Spectra`, with no administrator prompt.

## Pairing

Pairing is silent. On the Devices page (or in onboarding) **Connect this computer** checks whether the Bridge answers
on `127.0.0.1:47615`. If it does not, the page offers Spectra for desktop for the person's system and waits. In the app
there is nothing to download, and it connects by itself.

Silence is safe because only Spectra itself can start it:

- A release Bridge accepts exactly the origins baked into it at build time (`SPECTRA_ORIGINS`, `https://spectra.ink`
  for production; checked by `bridge/scripts/verify-release-env.py`). Pages served from this computer are accepted
  only by debug builds. One predicate, `ServerState::origin_allowed`, decides for pairing, CORS and updates.
- `/v1/pair` requires the browser's `Origin`, equal to the offer's `browser_origin`, and allowed. A page cannot set
  `Origin`, so another site cannot pair in Spectra's name.
- `/v1/update` refuses other origins and takes one request in ten minutes.

The Bridge keeps working from an ordinary browser tab too, through the same loopback protocol. The app adds no second
code path.

## Synced folders

- **New files.** Files added later to a synced folder come into Spectra by themselves unless the person says
  otherwise. The account's choice is **New files sync both ways** on the Devices page. Each folder's **Details** can
  set it differently ("Set for this folder only") or follow the account again. This is a `mount`-scope sync policy
  (`syncPolicy.setFolderNewFiles`); with no choice made anywhere, discovery is ungated.
- **Picking a file inside a synced folder** (Add files) brings that one file in without changing the folder:
  `bridgeSync.pickWithinFolders` approves it by path (`syncDiscoveryRequests.by_mount_path`), and discovery takes an
  approved request whatever the folder's rule says. The folder is not detached.
- **The same folder on two computers** (OneDrive, Dropbox, iCloud). Found by its path, it is one folder already and
  each file comes in once, with a copy on each computer. At different paths a shared name is the hint, and **Same
  folder as on …** links them: duplicates brought in from both go to the Trash, leaving one. Unlinking stops; what was merged
  stays merged.
- **Folder details** show where the folder is on the computer, its state, the new-files rule, and its twin.

## The Devices page

- **This computer.** Its name, state (connected, paused, out of date, problem) and the Spectra for desktop version.
  Its folders, with Add folder, Add files, Retry, Pause, Remove and Details.
- **Other devices.** The person's other computers, when each was last seen, and their folders (changed on that
  computer).
- **New files sync both ways** and **Native writes** (always, ask first, never) for the account.
- **Health.** The last sync and any problem in plain words with a fix. Show logs opens the log on that computer.
- **Updates.** Check for updates; Update now when one is ready.
- **Remove this device.** Unpairs it and stops syncing. Files on the computer stay.

Each artifact linked to a desktop file shows its own state in its status control (see
[EDITORS.md](../design/EDITORS.md#the-status-control)).

## The AI

Everything here is a command in the shared registry (`src/features/spectra/commands/ai-reach.ts`), reached through the
`devices` tool. Spectra AI can read the state, list names on the computer, ask to sync a path, pair, add folders or
files, retry, pause, remove, set a folder's new-files rule (`new_files`), link or unlink the same folder on two
computers (`link_folders`, `unlink_folder`), show logs, update and remove a device. Pairing, removing, the new-files
rule and linking are `settings` actions, so they ask first. Actions on the computer run there through the person's
open Spectra.

## Engineering notes

- **Backward compatible.** Older Bridges keep working with the web app: capabilities are read from health, and the
  web falls back where a feature is missing. `/bridge/download/*` and `/bridge/latest` redirect to the `/desktop/*`
  routes.
- **Convex budget.** Folder details read the policy only while open. The picked-path lookup is one indexed read, only
  for a file about to become a work. The sign-in handoff is one small row that expires in two minutes.
- **The tray icon** is generated from the prism renderer (`scripts/generate-bridge-tray-icons.ts`) at 16, 20, 24 and
  32 px, with the state-dot variants.
- **Rust gates.** `cargo test` and `cargo clippy` stay green for both crates; the NSIS build is simulated locally
  before a release (see the `bridge` skill).
