# R-F2 — Devices

Lane F2, branch `lane/devices`, worktree `<local-workspace>`. Binding specs: `docs/design/*`,
`docs/ai/HARNESS.md`, the product brief. Main (79df4c2f) is merged in; the coordinator lands the branch.

## Result

Spectra Bridge is now a tray app with no window. Everything it does is on one page, `/devices`, and every action on that
page is also a command that the command bar and Spectra AI can run.

- **Bridge.** Tray only. The icon is the prism with a state dot. A local control API drives it.
- **Devices page.**
  - It lists This computer and Other devices.
  - A collapsible Details panel shows:
    - folders: add, retry, pause and remove;
    - the Office files open on the computer;
    - native writes: always, ask first or never;
    - health, with Show logs;
    - updates;
    - removing the device.
- **Connecting a computer.**
  1. The page looks for Bridge.
  2. If Bridge is missing, it offers the download with one sentence and waits until Bridge starts.
  3. It pairs through `auto_pair`. The same code shows on the page and in Bridge's native confirmation.
  4. Once paired, the computer's row forms out of the field (`Row fresh`).
- **Old settings removed.** The old Bridge settings, trust presets, bridge intents and the Settings "Files and devices"
  section are gone. There is no back-compat.

Nothing was run live: no dev stack, no browser, no installed Bridge. See *Needs a live check*.

## Commits

| Commit | Step |
|---|---|
| 26799f64 | tray-only Bridge driven by the local control API; prism tray icons |
| 170b8fb1 | `bridge:reportHealth`; `bridge:overview` carries each device's health |
| cac98208 | Devices model (pure) and the Bridge client's new controls |
| a2a20114 | every Devices action is a shared command; old Bridge settings removed |
| 3a224b8f | the Devices page and `/devices` route; pause, play and download glyphs |
| d8548f93, 7ef59467, + label fix | test rewrite, lint-clean navigation fallback, robust tool labels |

## What changed

### Page (`src/features/spectra/devices/`)

- **`devices-model.ts`** is pure. It merges the local Bridge status with `bridge:overview` into This computer and Other
  devices:
  - each computer gets a state, a plain-language problem and its last sync or last seen;
  - a device counts as online for 5 minutes after it last reported.
  - `describeDevicesForAi` gives the AI the same view, with device and grant ids.
- **`pairing.ts`** is one shared store, for the page, the command bar and the AI. It moves through these states:
  checking → download (polls every 2.5 s, for up to 20 min) → requesting → confirming (polls every 1 s) → paired or
  failed. The AI and the command bar call `want()`, and the page starts pairing because it holds the Convex mutation.
- **`device-actions.ts`** runs the local actions. They never throw, and each one emits `devices.changed`.
  - AI actions arrive as `devices_action` UI events.
  - Each one runs once per computer, deduped in localStorage, and only on the computer whose `deviceId` matches.
- **`devices-page.tsx`** is built from the kit:
  - `ProductPageHeader`, `AdaptiveBar` (Connect or Add folder / Pause / Details, with an authored collapse plan), `Row`,
    `IconButton` (Tooltip built in), `SelectField`, `ConfirmDialog` and `Icon` glyphs;
  - tokens only; bottom padding `var(--spectra-composer-safe-area)`;
  - errors are read with `readConvexError` (directly, or through `humanizePublicFailure` / `pairingFailureMessage`).
- **Confirmations.** The page asks first before it:
  - removes a device;
  - stops using a folder;
  - turns native writes on.
- **Native writes** is account-level ("Applies to every device"):
  - never → the `spectra` sync preset;
  - ask first / always → the `both` preset, plus the `bridge_files` permission set to ask or allow.
  - Only the user can change it (`devices.native_writes` is `user`).

### AI and command parity

- **The `devices` tool** replaces `setup_bridge`.
  - Actions: status, pair, add/retry/pause/remove folder, pause_syncing, show_logs, update and remove_device.
  - Effects: status reads. pair, remove_folder and remove_device ask first, in the `settings` category. The others write.
- **Server commands:** `read_devices`, `control_device`, `pair_device` and `remove_device`.
  - `remove_device` runs `bridge:revokeDevice`.
  - `pair_device` and `remove_device` are confirmed commands, in `operationCategory` settings.
- **App registry:** `app.devices.open`, `app.devices.pair` (risk confirm), `app.devices.add-folder` and
  `app.devices.pause`. They are in the kbar, the dispatcher and `APP_SPECS`. `navigate_spectra` and follow-AI know the
  `devices` route.
- **Catalog:** the `devices` area. It covers every `bridge:*` write, as a command or as plumbing.

## Tests and gates

- New tests:
  - `devices-model` (16);
  - `pairing` (9);
  - `device-actions` (5);
  - `devices-page.component` (8): rows, folder actions, confirmations, pairing with the code, `want()`, `?connect=1`,
    remove;
  - dispatcher `app.devices.*`;
  - the harness devices tool (runs straight away; pair/remove ask first in settings);
  - the contract matrix for the four commands;
  - registry and parity.
- `convex/bridge-devices.test.ts` covers `reportHealth`.
- Gates on the merged branch: tsc (app and convex), `npm run lint`, check:design-tokens, check:architecture, check:copy,
  full `vitest --maxWorkers=3`, `cargo test` (138) and `cargo clippy`.
- The 20 clippy warnings are all in lines from main (collapsible `if`, too many arguments). None of them are new.

## Needs a live check

- **The tray:** the icons on light and dark taskbars, the native folder picker and pairing dialog, and macOS.
- **The download URL.** `NEXT_PUBLIC_SPECTRA_BRIDGE_DOWNLOAD_URL` (in `.env.local.example`) must serve `/windows` and
  `/macos`.
- **Deployment.** The deployed Convex needs `bridge:reportHealth` before Bridges can report their health.

## Follow-ups

- **Pausing one folder.** It parks writes but may still upload local changes. Verify, and hold outbound changes per
  folder.
- **Controlling other computers.** That needs a cloud relay. Today the page says to use Spectra on that computer, and
  the AI's local actions only run where Spectra is open.
- **No Side panel on `/devices`.** `/devices` is not in `ROUTE_SIDE_PANEL_PREFIXES`.
- **Follow-AI.** `navigation.show` is handled only on the workbench pages. Elsewhere, the connect request loads
  `/devices?connect=1`.
- **Pre-existing clippy warnings** in `bridge-app` and `bridge-core`.
