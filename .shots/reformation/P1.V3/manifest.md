# P1.V3 — Sync journey verification

Independent rerun (after I3/I4 rejection-fixes and Convex serving current source): `.shots/reformation/P1.V3/rerun/manifest.md`. This file is the first-rejection record and is not the current verdict.

Run date: 2026-08-26
Verifier surface: signed-in Playwright Chrome (`.playwright-cli/spectra-session`); Settings / Files and devices / Library on `http://localhost:3000`; Bridge started in tray on a hidden desktop (GUI not driven); native folder picker and Word captured there. Isolated folder `<local-workspace>` — not OneDrive Documents, not Pablo's open Word files.
Scope: novice pairing; mount a real folder; toggle each storage option and verify the consequence is true; kill network mid-edit; kill Bridge mid-save; edit in Word while Spectra is open and closed; any label that disagrees with reality fails the card.
Verdict: **REJECTED — labels disagreed with reality, discovery never completed, and the Word roundtrip could not be graded.**

## Card results

| Card | Attempt and observed truth | Result | Evidence |
| --- | --- | --- | --- |
| Pairing from the website | With Bridge down, Files and devices said **Not running** and **Open it, then try again** (no raw `Failed to fetch`). After Bridge was started and `/v1/health` reported running+paired, the page still said **Not running** until **Connect this device** succeeded from the website. | Partial/fail. Recovery copy when truly down is honest; a running unpaired Bridge is labeled as if it were off. | `02`, `03`, `05`, `06` |
| Mount a real folder | Native picker reached `Downloads\spectra-p1v3-fixture` (address bar confirmed; Select Folder). The fixture row appeared, then **Needs attention** with a live Convex miss: `Could not find public function for 'bridgeSync:discoverResourcesPage'`. Library opened `spectra-p1v3-fixture` as empty. | Fail. Folder was selected; files never appeared. | `10`–`17` |
| Toggle This PC / Both / Spectra | Account radios match the canon sentences. Left on **Both**. No imported file existed, so the consequence sentences could not be shown to be true. | Incomplete. Wording present; truth of consequence not verified. | `07`–`09` |
| Kill network mid-edit | Browser `setOffline(true)` on Settings. Bridge was still running. Page said **Not running**. No product Offline banner (that banner lives on the Spectra shell, not Settings/`AppShell`). | Fail. Browser-offline impersonates Bridge-down. | `18` |
| Kill Bridge mid-save | After the real Bridge process was killed, **Not running** and **Waiting for Bridge** were then true. Add folder disabled. Connect still offered. No `0 of N` on the remembered Physics row. | Pass for the down state; the mid-save half never ran because discovery never produced a file. | `19` vs `05` |
| Word while Spectra open/closed | Word on the fixture showed a blank document and: **Word found unreadable content in P1V3-essay.docx.** Dialog dismissed No. Spectra never listed the file (empty folder). | Card blocked. See provenance below — this is not a Bridge rewrite of a good document. | `20`, `21`, `docx-inspect.txt`, `mount/P1V3-essay.docx` |

## Evidence sequence

`00-landing` (prior aborted attempt), `00-workspace`, `01-settings`, `02-files-devices-not-running`, `03-connect-while-not-running`, `04-bridge-tray-window` (black: hidden Tauri surface, not a product file), `05-running-but-labeled-not-running`, `06-connected-from-website`, `07-toggle-this-pc`, `08-toggle-both`, `09-toggle-spectra`, `10`–`13` folder picker to the isolated fixture, `14-fixture-mounted-discovery-error`, `15-retry-still-missing-function`, `16-library-list`, `17-fixture-folder-empty`, `18-offline-labeled-not-running`, `19-after-bridge-kill`, `20-word-fixture-headless`, `21-word-dialog-headless`.

## Word unreadability — considered, then rejected as Bridge damage

Shots `20` and `21` are real. Word refused `P1V3-essay.docx`. That does **not** mean this session's Bridge or Spectra rewrote a previously valid document.

1. The file was created at **17:31:22** by an earlier aborted P1.V3 attempt as a PowerShell-zipped OOXML stub (`ZipFile.CreateFromDirectory`), before this session started Bridge (~18:00). Git was already listing it as a new untracked file at 17:31:26.
2. The package contains only `word/document.xml`, `word/_rels/document.xml.rels`, and `_rels/.rels`. It has no `[Content_Types].xml` (Word's required package map), no `word/styles.xml`, no `docProps`. XML parts carry UTF-8 BOMs from `Set-Content -Encoding UTF8`. Body text is the stub marker `P1.V3 last-year schoolwork. Original sentence. Marker BASE-2026-08-26.` A real fixture in this repo (`fixtures/office/docx/complex-structure.docx`) has nineteen parts including `[Content_Types].xml`.
3. The earlier script *attempted* to write `[Content_Types].xml`. In PowerShell, `[Content_Types]` is a character-class wildcard, so that part never entered the zip. The three surviving parts match the three writes that did not use brackets.
4. SHA-256 of `.shots/reformation/P1.V3/mount/P1V3-essay.docx` and `<local-workspace>` is identical: `5CCBF39661CB6181EA0F95D06684004A672EE25B0D8B4367C0DC43D45C59A331` (942 bytes, LastWriteTime still 17:31:24 after mount, after Word, after Bridge kill).
5. Spectra never ingested the file: `17` shows the mounted folder empty. There was no Spectra editor session on this path.

A Bridge/Spectra rewrite of a real Word file would still be a complete OOXML package, or a truncated copy that retained `[Content_Types].xml`. This file was born incomplete. The Word card still **fails as a journey card** because the roundtrip could not be run; it is not filed as native-file corruption by I2.

## Findings

- `[P1.V3] HIGH · live Convex missing discovery/library functions · source contains `bridgeSync:discoverResourcesPage` and `replicas:presentationsForAccount`; the live deployment returned Could not find public function for both (Library chips swallowed by IsolatedErrorBoundary) · `convex dev` was not running · a user mounting a folder sees Needs attention and an empty Library folder · LOCAL env until those functions are actually served; do not `convex push` the real school account without the I1 migration stop-and-ask · evidence 14, 15, 16, 17`
- `[P1.V3] HIGH · raw Convex and Bridge jargon on Files and devices · Physics (live OneDrive) and the fixture both dumped Request IDs plus Could not find public function for 'bridgeSync:discoverResourcesPage'; Physics also showed Provider-managed folder detected; conflict windows may be wider and This folder is also managed by another program · a school user cannot act on that · SYSTEMIC: R13 humanizer / I4 surface · evidence 08, 14, 15`
- `[P1.V3] HIGH · running Bridge labeled Not running · `/v1/health` was running+paired; `use-bridge.ts` maps `status?.paired` false to disconnected; `bridge-settings.tsx` maps disconnected (unless port-taken) to Not running · Connect this device then correctly showed Connected · SYSTEMIC: pairing/reachability labels · owner P1.I4 · evidence 05 vs 06`
- `[P1.V3] MED · browser-offline impersonates Bridge-down · Settings has no product Offline banner (banner is in spectra-shell only; Settings uses AppShell) · SYSTEMIC: product-offline vs Bridge-offline · owners P1.I3 (banner on Settings) and P1.I4 (Not running mapping) · evidence 18 vs 19`
- `[P1.V3] MED · Physics Needs attention while discovery cannot run · remembered Physics went Reading folder → Needs attention with the missing-function error; when Bridge was actually down, the same row correctly said Waiting for Bridge without 0 of N · SYSTEMIC: unavailable-truth while cloud discovery fails · owner P1.I4 · evidence 06, 08, 14, 15, 19`

## Checks and anomalies

Focused command: `npx vitest run src/features/spectra/__tests__/sync-toggles.test.ts src/features/spectra/__tests__/sync-presentation.test.ts src/features/spectra/__tests__/artifact-persistence.test.ts src/features/spectra/__tests__/live-dock.test.ts src/features/spectra/__tests__/bridge-contract.test.ts` — **42 passed / 2 failed**. The two failures are the pre-existing I2 string-scans in `bridge-contract.test.ts` (restore key; `toPreset === "device"`) already recorded by I3/I4 and not rewritten.

No product code was changed. Pablo's open Word windows (PS 6.docx, PS 8.docx) were not touched. Bridge was left stopped after the kill-Bridge card. The repository-wide sweep remains deferred until paired verification. V3 rerun needs Convex actually serving current source **and** a valid Word-authored fixture; this stub must not be reused.
