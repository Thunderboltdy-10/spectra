# RC.V1 verification note — 2026-08-30

Status: **REJECTED**. RC-1 and the realtime proxy are repaired, and the real DOCX now passes a fresh durable/native round-trip. The real XLSX renders but a cell commit never reaches durable Yjs, so the complete corpus gate remains red.

## Evidence

- Copies only under `Downloads/spectra-rc-corpus`; OneDrive originals were not mounted, edited, or changed.
- The real EE renders 7 tables / 40 rows / 122 cells and 695 KaTeX equations (433 display; strict render 695/695).
- Marker `RCV1-LIVE-39` survives Spectra reload and reads back in Word after Bridge materialization. Only `word/document.xml` differs from the 18-part source package; the other 17 parts are byte-identical after decompression.
- The real workbook renders with 51 cached native formulas. A1 shows local marker `RCV1-XLSX-41`, but the studio remains `Syncing…`.
- After a bounded three-minute wait, signed room `x972kp24mb7ftg5s3xgztv43n18de7kr` is still bootstrap-only: `nextSequence: 2`, sequence 1 only, no snapshot, no projection sequence, and no marker. Bridge has no native write to materialize.
- Evidence: `.shots/reformation/RC.V1/manifest.md`, especially `32`–`43`.

## Repairs held in this verifier diff

- Guarded native-room recovery uses exact sequence/state-vector/projection preconditions and cannot reset active or divergent rooms.
- The browser and gateway share the rich-document projection; full sync frames persist canonical deltas, including delete-only edits.
- Large sheet cell maps use bounded storage chunks without inventing absent native metadata; absent and explicit zero freeze panes compare equally.

## Blocker and verdict

- A real formula-input commit blocked the renderer for roughly two minutes, then stayed unacknowledged despite gateway reconnection and later healthy HTTP responses.
- The blocker is now the sheet commit/provider durability path, not the repaired query-only proxy, bootstrap equality, or freeze-pane comparison.
- RC.V1 stays **REJECTED**. PPTX was not started and is not claimed.

## Verification

- Broader changed-surface Vitest 13 files / 202 tests; gateway/native projection harness 18/18; seam 13/13.
- Scoped ESLint 0 errors; capability and secret gates pass; enabled Convex typecheck reports functions ready.
- Root TypeScript names only the recorded embed/capability/presentation/agent-library files outside this RC diff.

## Paste-ready continuation

> Repair the real-sheet commit/provider durability path while preserving guarded room recovery, bounded cell storage, and absent-vs-zero freeze semantics. Prove a real React A1 commit stays responsive, appends durably, survives reload, reaches Bridge `file.write`, reads back in Excel, and preserves untouched package parts. Add boundary-level regression coverage and run the mandatory Convex and repository gates. Then launch a fresh max RC.V1 verifier for XLSX followed by the unstarted PPTX leg; do not claim PASS before the entire corpus journey is green.
