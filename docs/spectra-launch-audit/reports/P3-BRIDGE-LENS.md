# P3 — Bridge and Lens (Phase 3)

Branch `p3/bridge-lens`, from `main` fcf9dbbb. This report covers the native Office round trip, seen by a real
student:

- the Rust Bridge (`bridge/**`);
- the DOCX, XLSX and PPTX lenses (`src/features/spectra/lenses/**`);
- the lens routes (`src/app/api/spectra/lenses/**`);
- the Bridge client logic (`src/features/spectra/bridge/**`).

Following the Phase 3 addendum, reliability and capability came first. Two legacy paths were deleted rather than
hardened: the provider-managed pause and the route compat re-exports.

## Findings ledger

### Fixed

| # | Sev | Finding | Root fix | Test |
|---|-----|---------|----------|------|
| B1 | High (data loss on macOS, stuck file on Windows) | **Office owner files were half-recognised.** Word shortens a long name by replacing 1–2 leading characters with `~$`, while Excel and PowerPoint prefix the full name, but only the Word form mapped back to its document. So on macOS, where there is no share-mode probe, Spectra could write under an open workbook or deck. On Windows, a `~$` file left behind by an Office crash blocked its document forever. An owner-file event also re-hashed every sibling in the folder. | `watcher.rs:344` `office_owner_file_names` and `:361` `office_lock_targets` map every owner-file form back to its document. `:624` `office_lock_exists_with` counts an owner file only when `Platform::owner_file_is_live` (`platform.rs:20`, Windows override `:100`) says it is held. On Windows that is a share-mode probe, so a crash leftover no longer blocks. `watcher.rs:144` re-checks only the owning document. `fs.rs` and `sync.rs` use the same platform-aware check. The lock copy in `main.rs:2385` is now plain language. | `every_office_owner_file_form_maps_to_its_document`, `owner_file_left_by_an_office_crash_does_not_strand_the_document`, and a rewritten `office_lock_suppresses_revision_until_cleared`. Chaos `office_lock_appearing_during_staging_parks_the_write` still passes. |
| B2 | High | **OneDrive, Dropbox and Google Drive folders stopped syncing after their first scan.** `mount_auto_sync_allowed` and `pause_provider_managed_mount` were a test-harness guard (S11-OFFICE-REVIEW D27). They paused every provider-managed mount at 4 call sites: grant, restore loop, `MOUNT_NOT_ACTIVE` loop and startup watcher. Most students keep coursework in exactly these folders. | Deleted both functions, all 4 call sites and their test (`main.rs`). The informational "double sync" detail stays. | Existing grant, restore and mount tests; 23 app tests pass. |
| B3 | High | **Large Office files could never transfer.** Upload and write download used one fixed 15 s total timeout, so a 40 MB deck on a slow school network timed out, retried, and timed out again. A file over the 100 MB server ceiling (`convex/bridgeSync.ts:769,806`) retried forever. | `retry.rs:87` `bridge_payload_transfer_timeout`: 15 s plus 256 KiB/s of body. It is used for upload (`sync.rs:550`) and download (`main.rs:1451` `download_write_payload`: header timeout, then a body budget sized from `Content-Length`). `sync.rs:516` `MAX_NATIVE_PAYLOAD_BYTES`. An oversized change fails once with `payload-too-large` and plain copy (`main.rs:1158`, `:1445`). `run_sync` counts oversized files and skips their upload (`:1419`), and so does the pending upload path. | `payload_transfer_budget_grows_with_the_package`, plus the oversized paths in the app tests. |
| B4 | Medium | **Setting the wall clock back stranded retries.** Queue and ack retries scheduled before a clock correction had `available_at` far in the future, so they stopped until that time came round again. Mount repair behaved the same way. | `retry.rs:64` `retry_schedule_horizon`. `journal.rs:762` `due_window` treats anything beyond the horizon as due. `main.rs:475` `mount_repair_retry_due` does the same. | `retries_scheduled_before_the_clock_was_set_back_stay_due`, plus the extended mount-retry test. |
| B5 | High (data use, "why is my disk full") | **Online-only OneDrive files were downloaded just to be hashed.** A scan or the stability tracker opened Files-On-Demand placeholders, which recalled every cloud-only file in the folder. | `platform.rs:36` `is_online_only`, with the Windows override using `RECALL_ON_DATA_ACCESS`, `RECALL_ON_OPEN` and `OFFLINE` (`:185`). `watcher.rs:606` exposes it. `scan_mount` skips these files and counts them (`ScanPage.online_only`, `:109`). `StabilityTracker::observe` and the watcher loop skip them. `run_sync` says "N online-only files will sync once … available on this device" (`main.rs:1423`). | `online_only_placeholders_are_neither_read_nor_failures` (with `OnlineOnlyPlatform`) and the `windows_tests` attribute cases. |
| B6 | Medium | **A case-only folder rename, or any folder name containing `_`, marked the wrong files unavailable.** `resources_with_path_prefix` used `LIKE`, which treats `_` as a wildcard and ignores ASCII case. | `journal.rs:368`: exact `path_key=? OR substr(path_key,1,?)=?`. | `path_prefix_is_exact_and_case_sensitive`. |
| L1 | Medium (event-loop stall) | **The three-way merge ordered regions in cubic time.** `weaveInsertions` used `includes`, `indexOf`, `slice().find` and `splice` over the whole order for every insertion. Reconciling Word and Spectra edits that both insert blocks took 1.5 s at 1000 blocks, 8 s at 2000 and 92 s at 4000, all on the Next.js event loop. The same code orders DOCX blocks, sheets, slides and slide objects. | `three-way-merge.ts:107–140`: a linked list with anchors precomputed per pass, so each insertion is O(1). The output order is unchanged. | `three-way-merge.test.ts`: a randomized oracle compares 1200 merges against the original splice algorithm; a 5000 + 10000 region merge finishes in milliseconds (it hung before). |
| L2 | High (event-loop stall) | **Adding a section to a long Word document re-projected the whole document once per inserted block.** `applyDelta` called `projectDocument` after every `insert-paragraph` or `insert-table`. 400 paragraphs into a 400-paragraph document took 14.6 s; 600 into 600 took 30 s. This is the path for both an AI draft and a student's paste. | `docx-lens.ts:3456` `projectionFor`. The document is re-read only when a later operation targets a region born since the last read, which is the only case that needs a fresh fidelity entry and block. | `docx-lens.test.ts` "adds a long section to a long document…": 601 inserts ending in an equation whose layout operation targets the new region, checked with a readback digest. It takes 30 s before and about 1.7 s after. |
| L3 | Low (dead code) | The office route re-exported `contentToPptx` and `contentToXlsx` "for existing callers" and kept an unused `_mediaTypes` map. The lens library `seam-contract.ts` imported from an API route. | Removed. Callers import `pptxProjectionFromContent` from `office-content`. | `seam-contract` and `office-route-projection` suites. |

### Reported, not fixed

| # | Sev | Where | Finding / why not fixed here |
|---|-----|-------|------------------------------|
| R1 | Medium (perf) | `docx-lens.ts:1076` `uniqueRegionById`, `:1101` `insertedRegionId`, `:1119` `placeInsertedRegion` | Every operation still walks the whole body (`nativeRegions` and `descendants`). Editing every paragraph of a document costs 0.5 s at 1000 paragraphs and 2.8 s at 2000. A safe region index needs invalidation rules for every structural operation (insert, delete, reorder, section, wrappers). That is a larger change than the evidence justifies at typical essay sizes of 100–300 paragraphs. |
| R2 | Low (perf) | `docx-lens.ts` academic operations (citation, note, comment, track) | Each academic operation still runs one full `projectDocument` to infer its edits. 50 citations in a 500-paragraph document is about 1 s. |
| R3 | Low (perf) | `pptx-lens.ts` notes materialization | Creating speaker notes on every slide is super-linear: 142 ms at 100 slides, 642 ms at 200. That is acceptable for real decks. XLSX was measured linear (22 000 cells: open 349 ms, materialize 133 ms, merge 201 ms). |
| R4 | Medium (perf, Bridge) | `bridge-app/src/main.rs:1221` `run_sync` | Every repair pass re-hashes every file of every type in the mount. The journal already has the size and mtime to skip unchanged files. This is not a correctness bug. It was left as is because the repair cadence is backed off (up to 15 min), and changing the change-detection contract needs live Windows verification. |
| R5 | Low | `main.rs:1042` `upload_discovered_resource`, `:1247` | Any per-file discovery upload error counts as an isolated failure, which puts the whole mount on repair backoff, even when the other files synced. The copy is honest ("except N files"), so the user is not stuck. |
| R6 | Low (known) | `bridge-core/src/fs.rs:605` | There is still no OS-level compare-and-swap between the final lock and hash check and the rename. This was recorded in S10 and S11. On macOS a held owner file is treated as live, because there is no share-mode probe. That is conservative: the write parks and does not overwrite. |
| R7 | Info | clippy | `cargo clippy` was not clean on `main` (7 `collapsible_if` in bridge-core), so clippy was not used as a gate. `cargo fmt --check` is clean. |

### Reviewed and rejected

- **XLSX cell merge is quadratic.** Rejected: cells use `mergeOrder: false`, so the weave never runs for them.
- **The provider-managed humanize rule (`humanize.ts:121`) is dead after B2.** Rejected: the Bridge still emits the
  double-sync detail (`main.rs:418`). It is informational and does not pause the mount.
- **Write downloads can outlive the 120 s claim lease.** Rejected: `main.rs:1631` calls `refresh_write_claim`
  before SafeWriter. A claim that is no longer current is dropped as `claim-no-longer-current`, never written, and
  the server offers the request again.
- **Merge duplication or silent loss.** Checked against the code: the same new id with different content on both
  sides is a conflict; the same content is placed once; delete versus edit is a conflict. DOCX duplicate native ids
  fail closed with `DOCX_IDENTITY_AMBIGUOUS`, and XLSX and PPTX surface conflicts through
  `recordExternalReconciliation` with previews.

## Needs live verification (Windows, real Office)

**Word (DOCX).** Use `fixtures/office/docx/footnotes-endnotes.docx`, `bibliography-source.docx`,
`equation-omml.docx` and `complex-structure.docx`, plus a real student essay with comments, tracked changes,
images and tables.

1. Open each through the Bridge in Spectra. Edit one paragraph in Spectra and have the AI add a two-paragraph
   section. Then open the file in Word and check:
   - comments, tracked changes (Review pane), footnote numbering, citations and bibliography (References →
     Update), equations and images are unchanged;
   - the new section is in place;
   - Word shows no repair prompt.
2. Paste 300–500 paragraphs into a long document in Spectra (L2). Saving should take seconds, with no server stall.
   Then open it in Word.
3. Concurrent edit: leave the file open in Word, edit paragraph A in Word and save, edit paragraph B in Spectra.
   - Both edits must survive, with no duplicated paragraph.
   - Repeat on the same paragraph: a conflict must appear, both "Keep Word" and "Keep Spectra" must work, and the
     losing text must stay visible in the preview.
4. Copy-paste a paragraph inside Word, then sync. Confirm Word gave it a new `w14:paraId`. If it did not, the
   file fails with `DOCX_IDENTITY_AMBIGUOUS`, and that would need a fix.

**Excel (XLSX).** Use `fixtures/office/xlsx/complex-preservation.xlsx` and a real workbook with formulas, charts,
several sheets and conditional formatting.

5. Edit cells in Spectra, then open the file in Excel. Check that:
   - formulas recalculate;
   - charts still point at the ranges;
   - formatting and the other sheets are intact.
6. Add a sheet in Excel while Spectra edits a cell on another sheet. Both must survive.

**PowerPoint (PPTX).** Use `fixtures/office/pptx/transition-law.pptx`, `media-preservation.pptx`,
`chart-notes-preservation.pptx` and `masters-media-preservation.pptx`.

7. Edit slide text and speaker notes in Spectra. In PowerPoint, check that transitions, video and audio playback,
   layouts and masters, and notes are intact.
8. Reorder slides in PowerPoint while Spectra edits a text box. Both must survive. Reorder on both sides: an order
   conflict must appear.

**New artifact.** 9. Create a new document, workbook and deck in Spectra and materialize each to a native file
through the Bridge. Open it natively, edit it, save, and confirm the edit comes back to Spectra.

**Bridge scenarios on Windows.**

10. B1: Open a `.docx` with a name longer than 8 characters, and an `.xlsx` and `.pptx`, in Office.
    - Edit them in Spectra: the write must park with "A file is open in Office…".
    - Close Office: the write must land.
    - Kill `WINWORD.EXE` so a `~$` file is left behind: the next Spectra edit must land without deleting the
      leftover.
11. B2: Select a folder under OneDrive, Dropbox and Google Drive. Edits must keep syncing after the first scan and
    after a Bridge restart.
12. B3: Sync a 40–90 MB deck on a throttled connection (for example a 1 Mbit shaper). It must finish. Add a
    120 MB file: it must show the "over 100 MB" copy once, with no retry loop in the logs.
13. B4: While offline with queued changes, set the clock forward a day, then back. Reconnect: the queue must drain
    immediately.
14. B5: Set OneDrive files to "Free up space", then select the folder. No files may download (watch the OneDrive
    activity panel), and the status must say online-only files will sync once available. Mark one "Always keep
    on this device": it must sync.
15. B6: Rename `Notes` to `notes`, and a folder `My_Work` to `MyXWork`. No file outside the renamed folder may
    become unavailable.
16. Other scenarios to confirm:
    - kill the Bridge in the middle of a sync and restart it: no duplicate upload, and the queue resumes;
    - use non-ASCII paths (`Économie/Übung ñ 日本.docx`);
    - move and delete files while the Bridge is offline;
    - check CPU and memory stay flat with 5000 files in a mount.

## Gates

- `cargo test --workspace` (bridge): 23 app, 64 core lib, 21 chaos and 1 granted_tree tests pass. It was run after
  the last Rust commit, 215f3fe8. `cargo fmt --all --check` is clean.
- `npx tsc --noEmit -p tsconfig.json` passes.
- ESLint `--max-warnings=0` passes on every touched TS file.
- `check:architecture`, `check:copy`, `check:design-tokens`, `check:capabilities` and `check:secrets` all pass.
- Focused vitest runs:
  - Bridge/Lens/Office/native: 50 files, 571 passed and 1 skipped;
  - DOCX: 16 files, 188 passed.
- Full `vitest run`: 439 files passed, 1 failed and 1 skipped; 4053 tests passed, 1 failed and 1 skipped.
  - The failure is `action-protocol.test.ts:564`. It expects `reasoningProfile: "high"`, but main's fcf9dbbb
    changed every Spectra model turn to `xhigh`, so the assertion is stale on `main` itself.
  - That test belongs to ai-engine, and this branch does not touch it. It was reported, not changed.
