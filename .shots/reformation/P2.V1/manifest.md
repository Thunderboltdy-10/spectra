# P2.V1 — Office coexistence verification

- Environment: local web/collaboration server, local Convex, paired Bridge `0.1.0` on `127.0.0.1:47615`, signed-in Playwright profile, and isolated copies under `office-loop/`.
- Browser console: zero errors; the only warning was Clerk's development-key notice. One stale Bridge startup scan was truthfully rejected as `MOUNT_SCAN_NOT_CURRENT`.

## Sequence

1. `00-docx-null-boundary-failure.png` — first live DOCX open returned 400 because a never-activated linked artifact had `content: null`. Belief: SYSTEMIC projection-boundary defect across DOCX/XLSX/PPTX, not fixture corruption.
2. `01-docx-open-after-class-repair.png` — after null-safe native-base handling, the same document opened with its table and seven content controls. Belief: the class repair reached all Office routes.
3. `02-docx-stale-operation-retired.png` — a prior verified external operation no longer reactivated or kept the studio at “Syncing…”. Belief: recent-operation selection and durable lifecycle compensation now agree.
4. `03-word-content-control-open.png` → `05-word-after-spectra-roundtrip.png` — real Word retained `P2V1 Word-side marker`; Spectra targeted the stable table cell, but Word displayed `Eric White` after reopen. Package probe: `word/document.xml` contains `P2V1 Spectra cell`, while `customXml/item1.xml` still contains `Eric White` (one table, seven SDTs). Belief: table topology/identity passed; bound-cell backing-data mutation is a P2.I3 finding.
5. `06-excel-after-alternating-roundtrip.png` — real Excel retained Spectra A1 text and the Excel-side bold B2 marker together; chart, table, WordArt, comment, second sheet, and surrounding cells remained present.
6. `07-powerpoint-after-alternating-roundtrip.png` — real PowerPoint retained the PowerPoint-side title marker and Spectra's new text box; the deck remained 15 slides and the existing slide object set grew 3→4 without renumbering prior identities.
7. `08-package-export.png` → `09-package-import-restored.png` — Library exported, imported, opened, and re-exported the flashcard deck with both cards. Original and re-export are both 842 bytes with SHA-256 `5F2BD66F50AFEA0F3A31C8681427DF848E05AEE31093D9F4A008AA80276D5DEB`.

## Findings and gates

- FIXED IN VU · SYSTEMIC: null persisted content across all Office projections; stale external-operation activation; and applied-operation exit/presenter truth across Bridge upload, replica activation/reconciliation, query presentation, and the periodic sweeper.
- LATER P2.I3 · SYSTEMIC: DOCX content-control cell edits update document XML but not the bound Custom XML value, so Word restores the old displayed value.
- LATER P2.I2: simultaneous-open, save-during-materialize CAS/rebase, and human conflict resolution remain that unit's owned merge/race class and are not claimed by this VU.
- LATER P6.I3 · LOCAL: the final Convex poll showed `src/lib/logging.ts` calling nonexistent `errorEvents:log`; user work continued, but the error-persistence caller is dead wiring.
- Focused Vitest: 7 files / 76 tests passed. Scoped ESLint: verifier-owned files 0 warnings/errors; Library shell 0 errors / 17 pre-existing design-token warnings.
- `tsc --noEmit`: only the recorded blockers in Bridge/replica tests, presentation commands, and agent library shell; no changed production file failed.
