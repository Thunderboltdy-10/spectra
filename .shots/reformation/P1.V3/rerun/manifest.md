# P1.V3 rerun — Sync journey verification

Run date: 2026-08-26
Verifier surface: signed-in Playwright Chrome (`.playwright-cli/spectra-session`); Settings / Files and devices / Library on `http://localhost:3000`; Bridge on hidden desktop `P1V3Rerun` (native folder picker and Word driven there). Isolated folder `<local-workspace> essay.docx` — copied from `fixtures/office/docx/complex-structure.docx`, 43336 bytes, has `[Content_Types].xml`, SHA-256 `B790E6BC89F916FA2C14E7E10AFB582E48A3F8D2D15BBF4073A5ED08437ED531`. Not OneDrive Documents, not Pablo's open Word files (`PS 6.docx`, `PS 8.docx`). First-rejection shots at `.shots/reformation/P1.V3/` are history; this folder is the independent rerun.
Scope: same goal cards as P1.V3. Convex was serving current source (`npx convex dev --typecheck=disable`; functions ready 18:41:58). No product code changed.
Verdict: **REJECTED — I3/I4 header and Settings offline banner hold; a new 1-file mount never left scanning, folder badges still disagree with reality, and the Word/mid-save cards could not finish.**

## Card results

| Card | Attempt and observed truth | Result | Evidence |
| --- | --- | --- | --- |
| Pairing from the website | Bridge down: header **Not running**, Connect copy human, no `Failed to fetch`. Starting Bridge auto-resumed a leftover `spectra.bridge.session` → **Connected** (recovery, not a first-run pairing demo). After deleting the session token and reloading: header **Not connected** while `/v1/health` was running unpaired. | Header pass for the I4 unpaired-running fix. Folder chips still said **Waiting for Bridge** while Bridge was running. | `02`, `03`, `05`, `21` |
| Mount a real folder | Native picker reached `Downloads\spectra-p1v3-rerun-fixture`. New grant stayed **Reading folder** / Bridge status `scanning` for minutes. Library listed Physics (16) and the old stub folder (0); the rerun fixture never appeared. Physics stayed `active` 16/16. | Fail. Folder selected; file never listed. | `09`–`17` |
| Toggle This PC / Both / Spectra | Account radios match the canon sentences. Left on **Both**. No imported file, so consequence sentences were not shown to be true of a real copy. | Incomplete. Wording present; truth of consequence not verified. | `06`–`08` |
| Kill network mid-edit | Browser `setOffline(true)` on Settings. AppShell banner present. Header **Offline** (not Not running). Folder chips still **Waiting for Bridge** while Bridge was actually running. | Header/banner pass for I3/I4. Badge fail. Mid-edit on a Spectra file never ran (no imported file). | `19` |
| Kill Bridge mid-save | Killed only this session's `spectra-bridge.exe`. Header **Not running**. Remembered folders then correctly **Waiting for Bridge**. Mid-save half never ran because discovery never produced a file. | Pass for the down state. | `22` vs `05` |
| Word while Spectra open/closed | Headless Word first showed a leftover "safe mode?" dialog (prior V3 crash residue; declined). `Last-year essay.docx` then opened readable (Compatibility Mode, 11 pages). Spectra never listed the file. Pablo's Word windows untouched. | Roundtrip incomplete. Not filed as native-file corruption. | `18`, `20`, `docx-inspect.txt` |

## Evidence sequence

`00-workspace`, `01-settings`, `02-files-devices-not-running`, `03-connect-while-not-running`, `04-bridge-tray-window` (black: hidden Tauri PrintWindow), `05-connected-from-website`, `06-toggle-this-pc`, `07-toggle-spectra`, `08-toggle-both`, `09`–`14` native Select Folder to the isolated fixture, `15-fixture-mounted`, `16-library`, `17-still-scanning`, `18-word-dialog-headless`, `19-offline-on-settings`, `20-word-fixture-open`, `21-running-unpaired-not-connected`, `22-after-bridge-kill`, `docx-inspect.txt`.

## Independently closed from the first rejection

- Running unpaired Bridge is **Not connected**, not **Not running** (`21`).
- Browser-offline is **Offline** plus the AppShell banner, not **Not running** (`19`).
- Live Convex served `discoverResourcesPage` / library queries; no Request IDs, no `Could not find public function`, no raw `Provider-managed folder detected` in the UI (Physics still uses the humanized "another program" sentence).
- Real Bridge-down is **Not running** (`02`, `22`).

## Findings that remain

- `[P1.V3-R1] HIGH · SYSTEMIC: new 1-file mount never left scanning · after a valid OOXML file was selected, Bridge `/v1/status` kept the new grant at scanning / "Reading folder metadata…" for minutes while Physics stayed active 16/16; Library never grew a rerun-fixture row · `run_sync` stamps scanning then `stable_file_snapshot` / `scan_mount`; the presenter is not inventing this state · a school user mounting one ordinary essay never sees the file · owner P1.I2 · evidence 15–17`
- `[P1.V3-R2] MED · SYSTEMIC: folder chips say Waiting for Bridge when that is false · `mountStateLabel` maps disconnected/waiting → Waiting for Bridge and ignores reachability · chips stayed Waiting for Bridge while the header was Offline (`19`) and while it was Not connected with Bridge actually running (`21`); details were often honest · owner P1.I4 · evidence 19, 21 (22 is the true down-state and does not count as this lie)`

Word unreadability is **not** filed: the rerun fixture is a complete package and Word opened it. The journey card still fails because Spectra never listed the file. Mid-save kill was not run.

## Checks and anomalies

Focused command: `npx vitest run src/features/spectra/__tests__/sync-toggles.test.ts src/features/spectra/__tests__/sync-presentation.test.ts src/features/spectra/__tests__/artifact-persistence.test.ts src/features/spectra/__tests__/live-dock.test.ts src/features/spectra/__tests__/bridge-contract.test.ts` — **45 passed / 2 failed**. The two failures are the pre-existing I2 string-scans in `bridge-contract.test.ts` (restore key; `toPreset === "device"`) already recorded by I3/I4 and not rewritten.

No product code was changed. Hidden-desktop Word pid 21124 and Bridge pid 36320 were killed; Pablo's Word (pids 24396, 35676; `PS 6.docx`, `PS 8.docx`) remained. Headless desktop `P1V3Rerun` was closed. The repository-wide sweep remains deferred until paired verification. Do not `convex push`. Do not reuse `spectra-p1v3-fixture` (incomplete stub).
