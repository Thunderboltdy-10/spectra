# P1.V3 walk — Sync journey verification

Run date: 2026-08-26
Verifier surface: signed-in Playwright Chrome session `spectra` (`.playwright-cli/spectra-session`); Settings / Files and devices / Library on `http://localhost:3000`; Bridge rebuilt from current tree (`cargo build -p spectra-bridge`) and Word on hidden desktop `P1V3Walk`. Isolated folder `<local-workspace> essay.docx` (valid OOXML, originally 43336 bytes, SHA-256 `B790E6BC89F916FA2C14E7E10AFB582E48A3F8D2D15BBF4073A5ED08437ED531`). Not the 942-byte stub, not OneDrive Documents, not Pablo's open Word files (`PS 6.docx`, `PS 8.docx`). Convex serving (`npx convex dev --typecheck=disable`; functions ready 19:26:38). No product code changed.
Verdict: **REJECTED — the 1-file mount now leaves Reading folder and appears in Library; Offline/Not connected chips no longer say Waiting for Bridge; F6 toggle stranded, Word save stayed Up to date, and a real browser-offline killed Settings with a Convex Request ID.**

## Card results

| Card | Attempt and observed truth | Result | Evidence |
| --- | --- | --- | --- |
| Pairing from the website | Bridge down: header **Not running**. Connect while down stayed human (no `Failed to fetch`). After launching the rebuilt Bridge, unpaired-running was **Not connected**; Connect this device then **Connected**. | Header pass. | `02`, `03`, `05`, `06` |
| Mount a real folder | Remembered `spectra-p1v3-rerun-fixture` went **Ready · 1 of 1 files**. Library listed the folder and **Last-year essay.docx** (2m ago). Old stub stayed 0 files. Physics stayed 16/16. | Pass for P1.V3-R1. | `06`–`08` |
| Toggle This PC / Both / Spectra | Account radios match canon. On the imported file: This PC consequence true and disk file kept (43336). Spectra-only consequence said the file stays on disk (true) but radios locked **Moving this work… Bridge verifies** for minutes; Location still said **This device + Spectra** while Spectra was **Not available here**. Never returned to Both. | Fail. Consequence wording held; F6 did not exit; Location lied. | `09`–`13` |
| Kill network mid-edit | Playwright `setOffline(true)` crashed Settings into **Something went wrong** with `AUTH_NOT_SIGNED_IN` and Request ID `681785b0f916633b`. Spoofing `navigator.onLine` without blocking Convex: header **Offline**, AppShell banner present, every folder chip **Offline** (not Waiting for Bridge). Spectra edit never ran (Open in Spectra disabled by stranded F6). | Chip pass for R2. Real-offline crash fail. Mid-edit incomplete. | `19`, `21` |
| Kill Bridge mid-save | Word Save of `P1.V3 WALK BRIDGE-KILL` then killed this session's `spectra-bridge.exe` (pid 14796). Header **Not running**. Folder chips then correctly **Waiting for Bridge**. Word kept the marker. Pablo's Word untouched. | Pass for the down state. Mid-save was Word-local; Spectra could not ingest. | `22`, `23` |
| Word while Spectra open/closed | Headless Word opened the valid fixture (Compatibility Mode, 11 pages, Complexity / Allchin). Marker `WORD-OPEN` while the studio was open; `WORD-CLOSED` after Close file. Spectra still said This device **Up to date · Last verified 9m ago** after the first save (file grew 43336→44452 while Word held it). | Word readable; Spectra label fail. | `14`–`18` |

## Evidence sequence

`00-workspace`, `01-settings`, `02-files-devices-not-running`, `03-connect-while-not-running`, `04-bridge-tray-window` (black: hidden Tauri PrintWindow), `05-connected-from-website`, `06-connected-fixture-ready`, `07-library-fixture-listed`, `08-library-essay-listed`, `09-essay-studio-panel`, `10-toggle-this-pc`, `11-toggle-spectra`, `12-toggle-spectra-after-wait`, `13-spectra-toggle-stranded`, `14-word-open-while-spectra`, `15-word-after-insert-attempt`, `16-spectra-during-word-save`, `17-spectra-closed-library`, `18-word-closed-edit`, `19-offline-on-settings` (crash), `20-after-offline-recovery`, `21-offline-spoof-chips`, `22-after-bridge-kill`, `23-word-after-bridge-kill`.

## Independently closed from the prior rejection

- P1.V3-R1: new 1-file mount left scanning; Library showed `Last-year essay.docx` (`06`–`08`).
- P1.V3-R2: chips said **Not connected** while the header was Not connected (`05`); chips said **Offline** while the header was Offline (`21`). Real Bridge-down chips **Waiting for Bridge** (`22`) are true and do not count as this lie.

## Findings that remain

- `[P1.V3-W1] HIGH · SYSTEMIC: F6 storage toggle stranded pending · Keep in Spectra locked the radios on "Moving this work between Spectra and this computer. The item stays open while Spectra Bridge verifies the file." for minutes with Bridge running and Connected · a user cannot change storage or Open in Spectra · owner P1.I1 (CS-3 / R2) · evidence 11–13`
- `[P1.V3-W2] MED · SYSTEMIC: Location says This device + Spectra while Spectra is Not available here · owner P1.I4 · evidence 10–13, 16`
- `[P1.V3-W3] HIGH · SYSTEMIC: This device stays Up to date after a verified Word save of newer bytes · file 43336→44452 with Word still open; chip Last verified 9m ago · owner P1.I3 presenter (native lock/activity) with P1.I2 if the engine never reported the dirty path · evidence 15, 16`
- `[P1.V3-W4] HIGH · SYSTEMIC: real browser-offline crashes Settings · Playwright setOffline produced Something went wrong + Convex AUTH_NOT_SIGNED_IN Request ID · owner P1.I3 · evidence 19`
- `[P1.V3-W5] MED · LOCAL: waiting mount chip says Waiting for Bridge while Connected · old stub "1 file will retry after the next change or repair scan" · owner P1.I4 · evidence 06, 20`
- `[P1.V3-W6] MED · SYSTEMIC: Synced next to "unfinished control that cannot synchronize yet" and POST /api/spectra/lenses/docx 400 · owner P2.I1 · evidence 09`

Word unreadability is **not** filed. Mid-save kill did not drop the Word marker. Pablo's `PS 6.docx` / `PS 8.docx` were not touched (Word pids 24396, 35676 remained).

## Checks and anomalies

Focused command: `npx vitest run src/features/spectra/__tests__/sync-toggles.test.ts src/features/spectra/__tests__/sync-presentation.test.ts src/features/spectra/__tests__/artifact-persistence.test.ts src/features/spectra/__tests__/live-dock.test.ts src/features/spectra/__tests__/bridge-contract.test.ts` — **45 passed / 2 failed**. The two failures are the pre-existing I2 string-scans in `bridge-contract.test.ts` (restore key; `toPreset === "device"`) already recorded by I3/I4 and not rewritten.

No product code was changed. Hidden-desktop Word pid 37300 and Bridge pid 14796 were killed; Pablo's Word remained. Headless desktop `P1V3Walk` was closed. The repository-wide sweep remains deferred until paired verification. Do not `convex push`. Do not reuse `spectra-p1v3-fixture` (incomplete stub).
