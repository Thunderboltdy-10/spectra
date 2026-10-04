# Devices and Spectra Bridge

Spectra Bridge links Spectra to the files on the user's computer. It is a quiet background helper. Everything the
user sees and does with it happens inside Spectra, on the **Devices** page.

## What changes

- **No Bridge window.** The desktop app has no window or view of its own. `bridge/bridge-app/ui/` and the window
  configuration are removed.
- **The tray stays.**
  - The tray icon is the Spectra prism, rendered from the same prism code as the app (a static pose, see
    [LIFE.md](../design/LIFE.md#sizes)), with a small state dot:
    - none when connected;
    - grey when disconnected;
    - orange when it needs the user;
    - red for a problem.
  - Its tooltip says the state in plain words: "Spectra Bridge · Connected · 3 folders".
  - The menu has only:
    - **Open Devices in Spectra** (opens the browser at the Devices page);
    - **Pause syncing** or **Resume syncing**;
    - **Quit Bridge**.
  - Logs open from the Devices page, not the tray.
- **Native prompts only where the system requires them.** These are native dialogs, triggered from Spectra:
  - the folder picker, because a browser cannot pick a desktop folder;
  - the pairing confirmation (below).

## Pairing

1. On the Devices page, the user presses **Connect this computer**. Spectra checks whether Bridge is running locally.
2. If it isn't, the page offers the download for the user's system, with one sentence on what it does. Then it waits,
   and continues by itself once Bridge starts.
3. Pairing runs through the existing local control (`auto_pair`). When the system needs a confirmation, Bridge shows
   one native dialog with the code, and the same code shows on the page. The user confirms on the computer.
4. The page settles into the device's details. The field condenses the device's row out of particles.

## The Devices page

The page follows the shell (see [SHELL.md](../design/SHELL.md#per-page-defaults)).

**Main view.**

- **This computer.** Its name, its state (connected, paused, out of date, problem) and the Bridge version.
- **Other devices.** The user's other paired computers, with when each was last seen.

**Details panel for a device** (collapsible):

- **Folders.**
  - Each folder shows its friendly path, its state and a progress line while it syncs.
  - The actions are Add folder (which opens the native picker on that computer), Retry, Pause and Remove.
- **Office.** Whether Word, PowerPoint and Excel files open and save through Bridge, and which file Office has open
  right now.
- **Native writes.**
  - When Spectra may write back to desktop files: always, ask first, or never.
  - This maps to the `irreversible` permission category (see [HARNESS.md](../ai/HARNESS.md#permissions)).
- **Health.**
  - The last sync and any problem, in plain words with a fix ("Couldn't reach *Documents › Biology*. Check the
    folder still exists.").
  - **Show logs** opens the log file on that computer.
- **Updates.** Update now, when a new version is ready (the existing `request_update`).
- **Remove this device.** This unpairs it and stops syncing. Files on the computer stay.

**Artifacts show the state.** Each artifact linked to a desktop file shows its state in its status control (see
[EDITORS.md](../design/EDITORS.md#the-status-control)), not on this page.

## The AI

Everything here is a command in the shared registry, so Spectra AI can check the state, retry a folder or explain a
problem. Pairing and removing a device are `settings` actions, so they ask first.

## Engineering notes

- **No backwards compatibility.** The window commands (`pending_pairing_code`, `bridge_status`, `confirm_pairing`,
  and the rest) are replaced by the local control API and the native dialog. Dead UI code is removed.
- **The tray icon** is generated at build time from the prism renderer, in a script under `scripts/`. It is produced
  at 16, 20, 24 and 32 px, plus the state-dot variants. It is not drawn by hand.
- **Rust gates.** `cargo test` and `cargo clippy` stay green for both crates.
