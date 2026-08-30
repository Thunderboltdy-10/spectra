# RC.V1 real-corpus evidence — 2026-08-30

Status: **REJECTED**. RC-1 and the P5 realtime proxy defect are repaired. The fresh DOCX sequence now reaches durable Yjs, survives reload, materializes through Bridge, and reads back in Word with every untouched OOXML part preserved. The real XLSX renders, but committing one real cell blocks the renderer and never reaches durable Yjs. A clean full-corpus sequence therefore still cannot pass.

## Corpus and sequence

- Only copies under `Downloads/spectra-rc-corpus` were mounted or edited. The OneDrive originals were not mounted, edited, or changed.
- `00-workspace-baseline.png`–`30-bridge-connected-proxy-blocked.png`: credited first-pass evidence. It contains the red RC-1 baseline, Word reference walk, repaired rich-DOCX render/edit-safety pass, and the now-fixed query-only proxy blocker.
- `32-workspace-before-rerun.png`–`36-docx-stale-reconnect-size-loop.png`: fresh rerun and falsification evidence. The first real edit exposed stale native-room bootstrap equality, reload rollback, and an oversized full-state reconnect loop.
- `37-docx-fresh-sync-clean.png`, `39-docx-after-reload-native-current.png`, and `40-word-native-marker-readback.png`: repaired fresh-room sequence. Marker `RCV1-LIVE-39` survives reload, reaches the corpus copy through Bridge, and renders in Word.
- `43-docx-package-part-comparison.json`: the source and edited DOCX both contain 18 OOXML parts; only `word/document.xml` changed. The other 17 parts are byte-identical after decompression, and the marker occurs exactly once in the native XML.
- `41-xlsx-marker-stuck-syncing.png`: the real Physics IA workbook renders and cell A1 shows local marker `RCV1-XLSX-41`, while the studio remains `Syncing…`.
- `42-xlsx-durable-room-read.json`: after a bounded three-minute wait, the signed `root` partition read remains at `nextSequence: 2` with only bootstrap sequence 1, no snapshot, no projection sequence, and no marker.

The presentation walk did not start after the XLSX durability leg made the full gate red. PPTX round-trip fidelity is not claimed.

## RC-1 repair evidence

- The real EE renders **7 tables / 40 rows / 122 cells** and **695 KaTeX equations**, including **433 display equations**. Strict KaTeX rendering accepted **695/695** projected expressions.
- `26-ee-rich-cover.png`: the native cover image renders at **1106 × 830** from a bounded authenticated package-part reference; no base64 package copy is stored in collaborative content.
- Authenticated media fetch: **200**, `image/png`, **1,186,444 bytes**. The same route without authentication returned **401**.
- `28-ee-equation-table.png`: native table topology and OMML inside cells render in place. `29-ee-display-equations.png`: display and mixed prose/equation ordering render rather than flattening or disappearing.
- `27-ee-safe-edit-protected-rich.png`: a native equation paragraph is non-editable; Playwright `fill()` was rejected and its content remained unchanged. A safe prose paragraph accepted marker `RCV1-SPECTRA-30`.
- The repair is class-wide: ordered DOCX rich inline content, OMML→LaTeX, display equations, rich table cells, native image references, read-only native boundaries, and matching TipTap/Yjs projections share one contract.

## Fresh DOCX round-trip and shared repairs

- Native bootstrap now admits a bounded Yjs snapshot and canonical projection in one signed envelope. Recovery is guarded by account/policy, exact `nextSequence`, exact state-vector hashes, current artifact projection, and either a bootstrap-only log or a compacted room with no post-snapshot edits. Active or divergent rooms are never reset heuristically.
- Browser and plain-Node gateway use the same document projection contract, so rich DOCX bootstraps no longer flatten or discard native nodes at the gateway boundary.
- Full sync frames are accepted within the realtime envelope, but only the canonical delta is persisted. Delete-only changes remain durable, and compact incoming updates are not inflated past the durable size gate.
- Spreadsheet cell maps are encoded into bounded chunks at Convex/storage boundaries and decoded without inventing absent sheet metadata. This lets the real workbook activate beyond Convex's object-field limit and avoids false freeze-pane writes.
- `RCV1-LIVE-39` passed Spectra edit → durable acknowledgement → reload → Bridge `file.write` → Word readback. The native package has 17/18 untouched parts byte-identical; only `word/document.xml` changed.

## Rejecting XLSX blocker

- The Physics IA copy renders its native grid and reports **51 native formulas** from Excel's cache. Cell A1 accepted local marker `Physics IA — QBER Optical Analogue Data Template RCV1-XLSX-41` through the real React formula-input/commit path.
- That commit blocked the renderer for roughly two minutes. The studio then remained `Syncing…`; six transient authenticated API failures and a WebSocket close were followed by successful HTTP responses and a single gateway reconnection, but no durable acknowledgement arrived.
- Signed bridge read for room `x972kp24mb7ftg5s3xgztv43n18de7kr` remained `nextSequence: 2`: no snapshot; one 986,604-character bootstrap update at sequence 1; `uncompactedBytes: 739953`; `lastProjectionSequence: null`; state-vector hash `0n9iuJ1K1v3PnxYMTbBUp8-KjwM8T9-uUKmCvStQQsE`; marker absent.
- Bridge's native queue remained empty. There was no XLSX `file.write`, reload proof, or Excel readback to claim.
- The current live blocker is the renderer-blocking sheet commit/provider durability path, not bootstrap equality or freeze-pane comparison.

## Automated gates

- Focused recovery and freeze-pane tests passed before close-out: guarded collaboration-room recovery **17/17**; Office projection **12/12**.
- Broader changed-surface Vitest: **13 files / 202 tests passed** across checkpoint/replica truth, gateway envelopes, DOCX/native projection, bounded sheet storage, workbook operations, studios, XLSX/PPTX lens, and seam contract.
- Plain-Node gateway/native projection harness under Vitest: **1 file / 18 tests passed**. Dedicated fidelity seam command: **13/13 passed**.
- Scoped ESLint: **0 errors**. Capability IR ghost gate passed. Secret scan passed across **2,273 tracked files**.
- `npx convex dev --once --typecheck=enable`: **Convex functions ready**.
- Root `tsc --noEmit` remains red only in recorded files outside this RC diff: artifact-embed/capability tests and definitions, presentation command test, and agent-library shell. No RC repair file is named.
- `git diff --check` and the final scoped index audit pass before commit.

## Paste-ready continuation

> Diagnose and repair the real-sheet commit/provider durability path without weakening the guarded native-room recovery or bounded sheet-cell storage. Use only `Downloads/spectra-rc-corpus/IA Data Collection - RC copy.xlsx`. Commit an A1 marker through the real React formula input, keep the renderer responsive, and prove a durable Yjs append plus acknowledgement. Then prove reload persistence, Bridge `file.write`, Excel readback, and untouched-package-part hashes. Add focused coverage at the sheet commit/live-model/gateway boundary, preserve absent-vs-zero freeze semantics, run the scoped and mandatory Convex gates, and return one scoped repair commit. A fresh max RC.V1 verifier must rerun XLSX and then the unstarted PPTX leg; do not upgrade this verdict from REJECTED until the complete corpus journey is green.

## Sheet durability repair close-out addendum

- The scoped repair makes structured Yjs writes equality-aware and gives sheets a cell-only mutation plan. The exact 4-sheet / 1,785-cell corpus model changes A1 in **7.02 ms**, emits a **98-byte** Yjs delta instead of the prior **393,582-byte** full projection, and claims exactly one cell region (`45-sheet-repair-class-benchmark.json`).
- Transport truth now latches local work before provider sync, counts durable pending IDs, and clears only on `spectra.durable_ack`. Region edits await `transport.flush()` before semantic completion or native materialization. Focused coverage is **3 files / 20 tests**; a broader confirmation run was **13 files / 128 tests**.
- The bounded real-browser pass did not clear the original gate. Opening the exact workbook took more than two minutes to expose interactive A1; the real formula-input `fill` + Enter path then became unresponsive before `Syncing…` appeared. A subsequent probe exceeded 30 seconds.
- Signed room read after that attempt is still room `x972kp24mb7ftg5s3xgztv43n18de7kr`, schema 4, `nextSequence: 2`, bootstrap sequence 1 only, marker absent. Artifact-tool readback shows native A1 remains `Physics IA — QBER Optical Analogue Data Template` (`46-sheet-repair-live-boundary.json`).
- Bridge itself was healthy and paired on protocol 1.0 / port 47615 (`47-sheet-repair-bridge-health.json`), but no sheet append existed to materialize. Excel readback and XLSX part comparison therefore did not start.
- RC.V1 remains **REJECTED**. The isolated model/provider durability repair is verified, but the remaining boundary is the real React sheet-open/commit renderer path before the local Yjs transaction and durable-pending lifecycle.

### Updated paste-ready continuation

> Profile and repair the exact-corpus React sheet-open/formula-commit boundary before changing the Yjs/storage repair. Use only `Downloads/spectra-rc-corpus/IA Data Collection - RC copy.xlsx`; require A1 to become interactive promptly, then prove the real formula input reaches local Yjs, visible durable pending, `spectra.durable_ack`, signed room sequence advance, reload persistence, Bridge `file.write`, Excel A1 readback, and untouched OOXML-part hashes. Preserve the 98-byte cell-only delta, equality-aware projections, guarded recovery, bounded storage, and absent-vs-zero freeze semantics. RC.V1 stays REJECTED until XLSX and the unstarted PPTX leg both pass.
