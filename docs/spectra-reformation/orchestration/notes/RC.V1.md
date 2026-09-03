# RC.V1 verification note — closeout 2026-09-03

Status: **VERIFIED** (Pablo owner-closed). The real-corpus gate on the frozen production build is complete. xlsx-run3 Bridge write + Excel package readback is deferred to **P8.V1**; Spectra-side Keep Excel Y1+B1 and durable reload already passed in RC.V1.

## Closeout summary

- **DOCX:** Keep Word live green after OMML `filterTransaction` repair; `RCV1WORDNATIVE7` survives hard reload. Workbar inventoried; package compare vs control held on untouched parts.
- **XLSX:** xlsx-run3 grid opens in ~1s; Keep Excel adopts Y1=`RCV1EXCELY1`; reload retains B1+Y1+D4 formula; sheet2 still 327 formula tags. Bridge on-disk write hash poll deferred to P8.V1.
- **PPTX:** Workbar inventoried with honest native refusals. R2 timed exit for `Updating presentation content.` deferred to P8.V1.

## Repairs held across RC.V1

- Guarded native-room recovery; rich-document projection; delete-only deltas; bounded cell storage; absent-vs-zero freeze semantics.
- P5.I2 realtime proxy normalization (`34c7d7b`).
- Sheet durability: equality-aware Yjs writes, durable pending/ack/flush (`ae6bf56`).
- Keep Word: incremental native fragment adopt + Yjs-origin `filterTransaction` bypass.

## Evidence

- `.shots/reformation/RC.V1/` (manifest, screenshots, xlsx-run3 JSON).
- P8 phase log: `docs/spectra-reformation/phases/P8-release-gate.md` § RC.V1 verification log.

## P8.V1 carryover

> Prove xlsx-run3 Bridge `file.write` and Excel package readback on the sacrificial corpus copy. Also run the original-tree integrity card and PPTX R2 timed-exit checks already filed to P8.V1.

---

## Historical notes (pre-closeout)

Earlier 2026-08-30 sessions recorded **REJECTED** while the sheet commit/provider path and proxy defects were still open. Those classes were repaired before this closeout; the notes below are diagnostic history only.

### 2026-08-30 rejected pass

- Real EE renders 7 tables / 40 rows / 122 cells and 695 KaTeX equations.
- Marker `RCV1-LIVE-39` survives Spectra reload and reads back in Word after Bridge materialization.
- Real workbook rendered with 51 cached native formulas; A1 commit blocked on sheet durability path.
- Evidence: `.shots/reformation/RC.V1/manifest.md`, especially `32`–`43`, `45`–`47`.
