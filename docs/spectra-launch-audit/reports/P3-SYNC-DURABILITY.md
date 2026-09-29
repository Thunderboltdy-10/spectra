# P3 — Sync durability (Phase 3)

Branch `p3/sync-durability`, from `main` 1f9f1594.

This pass looks for ways an accepted edit can be lost, or a folder can get stuck. It covers four areas:

- the collaboration gateway at shutdown;
- the Bridge's per-file retry and repair scans;
- the DOCX lens cost per operation;
- the Bridge queue ↔ Convex ↔ gateway handoffs.

Nothing here was verified live: no servers, Bridge app, Convex or network were used. The items that need a live
check are listed at the end.

## Commits

| Commit | Subject |
|--------|---------|
| df7a0467 | fix(gateway): drain accepted edits to Convex before a deploy kills the process |
| f899fcca | fix(bridge): retry failing files on their own and skip re-hashing unchanged files |
| 91d29aae | fix(gateway): type the shutdown drain options so the test typechecks |
| 37b82205 | perf(docx): look up regions from one body walk per structural change |

## Findings ledger

### Fixed

| # | Sev | Finding | Root fix | Test (before → after) |
|---|-----|---------|----------|-----------------------|
| G1 | High (data loss on every deploy) | **Edits the gateway had accepted but not yet stored were dropped on deploy.** Four things combined. (1) Hocuspocus installed its own SIGTERM handler (`stopOnSignals` defaults to true), which called `destroy()` and then `process.exit(0)`, racing the gateway's own handler. (2) The per-room persistence queues (180 ms idle, 1 s max wait) were never flushed at shutdown. (3) The launcher sent SIGKILL 3 s after forwarding SIGTERM. (4) Fly's default kill timeout is 5 s. An update that arrived during shutdown could also be applied and never stored. | `scripts/collaboration-persist.mjs` `drainGatewayForShutdown` runs a fixed sequence: stop listening, close every socket with 1012 "Gateway restarting" (clients reconnect and re-send their Yjs delta), flush every dirty room until none is left, then flush projection checkpoints. It is bounded by `GATEWAY_SHUTDOWN_DRAIN_MS` = 20 s, and every room still not durable is logged by artifact and partition. `scripts/collaboration-gateway.mjs:929` sets `stopOnSignals: false`, and `:1623` wires the drain. The drain is idempotent: `process.on` survives a repeated signal. `beforeHandleMessage` rejects updates during shutdown with 1012 instead of `rejectPeerUpdate`. A `persistenceDocuments` set tracks dirty rooms. The exit code is 1 if anything was not durable. `collaboration-gateway-process.mjs` now waits `GATEWAY_SHUTDOWN_GRACE_MS` (25 s) before SIGKILL. `deploy/collaboration-gateway/fly.toml:20` sets `kill_signal = "SIGTERM"` and `kill_timeout = "30s"`. `compose.yml` sets `stop_grace_period: 30s`. `railway.toml` sets `drainingSeconds = 30`. | `collaboration-gateway.test.ts` "gateway shutdown drain" (5 tests): order, late update drained, budget holds and logs, close code, and that each config's kill timer exceeds the grace. `collaboration-persistence-window.test.mjs`: SIGTERM stores pending entries before exit(0), a budget timeout gives exit(1) plus a log, and an update during shutdown is rejected with 1012. `collaboration-gateway-process.test.mjs`: there is no SIGKILL at 20 s, and there is one at 25 s (before: SIGKILL at 3 s). |
| S1 (R5) | High (folder shown as broken; permanent repair loop) | **One file's failure took the whole folder out of service.** In `run_sync`, every server skip counted as a failure except `approval-required`. So a folder with a policy filter, or with ignored or explicit-only files, never cleared: it showed "waiting" (which the web UI renders as "This folder is not available until Spectra Bridge is running") and ran a full repair every ≤15 min forever. Any single upload error did the same. The watcher's per-file errors also set "waiting" with 0/0 counts. | `bridge-app/src/main.rs:1442` `classify_discovery_skip`: skips for folder rules are not failures, `office-lock` is held, `resource-metadata-invalid` is named with no retry, and unknown reasons are retried. `:1460` `hand_off_failed_upload`: a failed upload goes to the outbound queue, which retries that file with its own backoff (`finish_delivered_change`). A full repair is scheduled (`:547` `record_mount_repair_retry`) only for held, unreadable or unqueueable files, or an incomplete scan. After a pass that reached the cloud, the folder stays `active`, and `:1518` `mount_pass_status` names the first file behind ("“x.docx” and 2 more files …"). The watcher's per-file notes use `:453` `set_mount_file_note`, which keeps the folder active and keeps its counts. `sync_grant`'s whole-pass error path still says "waiting". | `per_file_repair::folder_rules_are_not_sync_failures`, `a_failed_upload_retries_that_file_on_its_own_queue` (before: nothing was queued, and the file came back only with a full repair), `one_behind_file_is_named_and_the_folder_stays_active`, `a_file_note_keeps_the_folder_active_and_its_counts`. |
| S2 (R4) | Medium (perf, disk I/O and battery on every repair) | **Every repair pass re-read and re-hashed every file.** `adopt_resource_record` also reloaded every resource of the mount for every file, which is O(N²) journal reads per scan. | New journal table `resource_stats` (`journal.rs:170`, `record_verified_stat`/`verified_stat`). `scan_mount` takes size and mtime from the opened handle, not the lazily filled directory entry. `watcher.rs:343` `reusable_hash` reuses a hash only if all of these hold: same path, same OS identity, same size, same mtime, a hash is stored, and the hash was taken ≥2 s after the last write (so coarse-mtime filesystems cannot fool it). Otherwise the file is read again. `main.rs:1327` `scan_local_files` loads the records once and keeps the adoption candidates in memory. Online-only files are still never opened (95a36747 rule kept: `scan_mount` skips them before any open). | `a_repair_pass_reuses_the_hash_of_every_file_that_has_not_moved` (second pass `hashed == 0`; before, every file), `a_moved_stat_or_a_missing_hash_is_read_again`, `a_file_hashed_right_after_its_write_is_hashed_again_next_pass`, core `a_recorded_stat_vouches_for_its_hash_only_while_nothing_moved`, `scan_reads_size_and_mtime_from_the_file_handle`. |
| L1 (R1) | Medium (event-loop stall) | **Every DOCX region edit walked the whole Word body** (`uniqueRegionById` → `nativeRegions`) to find its target. That made rewriting a long essay quadratic. | `docx-lens.ts:1130` `nativeRegionIndex`: one body walk answers every lookup until an operation that is not in place. The index is rebuilt, never patched. `:1095` `inPlaceRegionEdit` counts a replace or format of one paragraph, or a table-cell edit, as in place, but not a bibliography rewrite (it removes its siblings). A cached hit is used only while its element is still under `body` with the same ID. A miss, stale hit or ambiguity walks again. Block lookup is a map. | `docx-lens.test.ts` "rewrites every paragraph of a long essay…" checks the readback digest with a < 1.5 s bound. "finds regions from the current XML after deletes, inserts and reorders" covers staleness and a deleted target. Measured timings are in the table after this ledger. All 19 DOCX-related suites (242 tests) pass. |

Measured DOCX timings for L1:

| Case | Before | After |
|------|--------|-------|
| 1000 paragraph edits | 0.70 s | 0.23 s |
| 2000 paragraph edits | 2.39 s | 0.35 s |

### Reported, not fixed

| # | Sev | Where | Finding / why not fixed |
|---|-----|-------|-------------------------|
| R2 | Low (perf) | `docx-lens.ts:3538` academic branch of `applyDelta` | Each academic op (citation, note, comment, track, review) runs one full `projectDocument`. 50 citations in 500 paragraphs through `mutate` takes about 2.0 s. The same 50 citations through a projection save (`materialize`) take 67–96 ms. Batching is not safe. Each op must see the Word XML its predecessor produced (citation fields, revision marks and comment ranges are re-read from Word), and a batch would infer edits against projection-only state. The `materialize` path is already the fast batch route. |
| R3 | Low (perf) | `docx-lens.ts:1167` `insertedRegionId`, `:1185` `placeInsertedRegion` | Each insert still walks the body (descendants plus region list). Inserts are structural, so a rebuilt-not-patched index cannot skip that walk. 601 inserts into 600 paragraphs take about 1.7 s (L2 from P3-BRIDGE-LENS). |
| D1 | Low (stuck, not lost) | `bridge-app/src/main.rs:1280` `finish_delivered_change` | A payload upload error is retried forever with backoff. It is never marked as failed, even when the error is permanent (for example a 4xx). The edit is not lost, but the file can sit in the queue indefinitely while the folder reads "Changes queued safely". Fixing this needs a typed error from `upload_resource_payload` (`sync.rs`) to tell permanent from transient. |
| D2 | Low (perf while an error persists) | watcher loop, `main.rs` `failed_paths` | A file whose `enqueue_stable_change` keeps failing (for example "cloud mount is not registered yet") stays pending and is re-hashed on every stable tick, with no per-file backoff. It is now named in the status (S1), but a large file keeps costing I/O until the cause clears. |
| D3 | Info (deliberate) | `run_sync` / `scan_local_files` `complete` | While any file is held or unreadable, the pass skips `reconcileMissingResources`, so a file deleted while the Bridge was off stays listed until the lock clears. This is intentional: reconciling with an unseen file would mark it missing and could trigger a restore to disk. |
| D4 | Info | `finish_delivered_change` "file-missing-before-upload" | Checked: an unplugged drive reports `unavailable` (not delete), and the next `sync_grant` after reconnect re-adopts and re-uploads the file. Nothing is lost. |
| D5 | Info | gateway ↔ client | Checked: every close except 4403/4409 makes the client reconnect, and Yjs re-sends its state-vector delta. The 1012 close and the shutdown-time rejection therefore lose nothing, provided the client stays open until the next gateway is up. |

### Rejected

| # | Idea | Why rejected |
|---|------|--------------|
| X1 | Reject new sockets in `onAuthenticate` during shutdown | Hocuspocus answers with permission-denied, which the client treats as an auth failure (4403). `httpServer.close()` already refuses new connections, and existing sockets are closed with 1012. |
| X2 | Patch the DOCX region index after inserts and deletes | The brief requires rebuilt, not patched, indexes. Patching the carrier and paraId bookkeeping is exactly where a silent wrong-region edit would come from. |

## Gates

- `cargo test --workspace`: 30 app + 66 core + 21 integration + 1 tests pass. `cargo fmt --check` is clean.
- Focused vitest: 11 gateway suites (129 tests), the persistence-window and process tests, and 19 DOCX-related suites (242 tests).
- One full vitest run: 441 files passed, 1 skipped; 4068 tests passed, 1 skipped (325 s).
- `tsc --noEmit` is clean. It caught the untyped drain options in the committed gateway test, which 91d29aae fixes.
- `eslint --max-warnings=0` is clean on the touched TS/JS files.
- `check:architecture`, `check:copy`, `check:design-tokens`, `check:capabilities` and `check:secrets` all pass.

## Needs live verification

1. Fly: redeploy the gateway during active editing in several rooms.
   - The logs should show `[shutdown] drained N room flush(es); 0 room(s) not durable`.
   - The machine should stop inside the 30 s `kill_timeout`.
   - Clients should reconnect (1012) with no lost text.
2. Railway: `drainingSeconds = 30` is accepted by the current Railway config schema, and it delivers SIGTERM before the kill.
3. Docker compose: `stop_grace_period: 30s` gives the launcher its 25 s grace.
4. Bridge on Windows (NTFS):
   - A second repair pass reads no unchanged files.
   - An Office "save" (write to a temp file, then rename) is re-hashed because the identity changes.
   - Files on a FAT/exFAT USB drive are re-hashed while their stat is inside the 2 s window.
5. Bridge on Windows:
   - A folder with a policy filter or ignored files settles to "Ready" with no repeating repair.
   - A file open in Word is named in the folder detail while the other files stay available.
   - A forced upload failure (for example the network dropped mid-upload) retries from the outbound queue and clears without a full repair.
6. Bridge with OneDrive Files-On-Demand: online-only files are still not recalled by repair passes (95a36747).

## Shared files touched

- `scripts/collaboration-persist.mjs`
- `scripts/collaboration-gateway-process.mjs` (and its test)
- `src/features/spectra/__tests__/collaboration-gateway.test.ts`
- `src/features/spectra/__tests__/docx-lens.test.ts`
