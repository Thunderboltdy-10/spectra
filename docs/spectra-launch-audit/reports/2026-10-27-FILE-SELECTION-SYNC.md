# Individual and multi-file Bridge sync

Implemented on `launch-readiness-audit` at the user's explicit request during the launch audit. This extends file selection; it does not resolve the existing native projection/conflict failures in the [user-flow audit](2026-10-27-USER-FLOW-AUDIT.md).

## User behavior

- Library → New → **Sync computer files** opens the native picker. Choose one file or multiple files. If this browser has not connected Bridge, Devices connects it first and continues the file-selection request.
- Devices provides **Add files** alongside the existing folder action. Each selected file has its own pause/resume/retry/removal controls and a document icon. The established page components/styles are reused.
- Files appear directly in General in Library. Selecting a file does not invent a folder named after the file or import its siblings.
- Cancel creates no grants and makes no success claim. Duplicate selections reuse the original grant. Choose up to 100 files per selection.
- Removing a selection stops sync; it does not delete bytes. Deliberately detached selections no longer appear as broken connections in Devices.
- File and folder grants cannot overlap. If a file is already covered by a synced folder, use that existing sync. To add the entire parent of separately selected files, remove those selections first; physical files stay intact.
- A file grant follows the selected path through ordinary atomic saves, deletion/recreation and process restart. Renaming or moving that file to a different path on disk requires selecting the new path or syncing its folder. Library organization can change independently; a Library rename/move cannot silently broaden the native grant. This is an explicit permission boundary.

Evidence of the actual updated native app and browser flows: [single selection](2026-10-27-evidence/file-sync-devices-single.png), [multiple independent selections](2026-10-27-evidence/file-sync-devices-multiple.png), [final Devices view after the detached-item fix](2026-10-27-evidence/file-sync-devices-final.png), [Library menu](2026-10-27-evidence/file-sync-library-menu.png). Routine picker/browser screenshots were inspected without retaining them.

## Backend implementation and boundaries

- `bridge-core/fs.rs`: persistent optional selected basename on each grant; native batch validation, deduplication, overlap/limit checks; resolution permits only that exact file. Sibling, new-child, absolute and traversal paths are rejected. SafeWriter uses the existing atomic replace/readback/journal path.
- `watcher.rs`: watch the parent non-recursively so atomic replacements still produce events, then admit only the selected path and its Office owner-lock events. Scans read only that selected file. Directory/link replacements fail rather than recursively widening scope. A missing file is an empty completed scan for unavailable-resource reconciliation.
- `bridge-app/main.rs`: one native multi-select picker, shared picker lock, persist the entire selection before watchers start, rollback newly created grants if persistence fails, restore file scope on restart, distinct root keys and selection-aware status/upload checks. File grants use a separate `file-mount:` journal namespace; older binaries only restore `mount:` folder grants and therefore cannot reinterpret a narrow grant's parent on downgrade. Paths stay local.
- `server.rs`: paired/origin-protected `POST /v1/files/select`; returns a selected count, including zero on cancel. HTTP callers cannot provide arbitrary file paths. Older Bridge versions return their existing update-required behavior for the new endpoint.
- Convex mount schema stores only `selectedFile` (basename), never the absolute parent path. `bridgeSync` validates exact-file discovery/report paths, preserves existing grant scope and reuses earlier work when a device is retired/re-paired. File mounts share General; detaching one must not trash General or another file's mount.
- `bridgeStructure` keeps file-only rename/move operations independent from disk and rejects explicit out-of-scope paths. Existing delete confirmation/recycle behavior remains in place.
- Folder destination selectors and the native materialization route exclude file mounts. Convex also rejects creation of a new local replica in a file-only grant. Editing an existing selected file continues through its normal native save path.
- Library, Devices, application capabilities/dispatcher, command search and AI reach/tool actions all share the new `add_files` operation. AI still opens a native picker for the human to choose; it gains no path-based filesystem authority.

## Live validation

Used a dedicated ignored directory with copies of audit DOCX/XLSX/PPTX and an unselected sibling. Existing user work and integration keys were untouched.

1. Devices Add files → native Windows picker → selected only the audit Word file. One file grant appeared; Library placed its DOCX in General.
2. Library New → file sync → native multi-select chose the audit Excel and PowerPoint files together. Two more independent grants appeared and reached Up to date. The unselected sibling did not appear in Library or local grants.
3. An authenticated live `/v1/file/reveal` request for the sibling under the Word grant returned HTTP 400. The same grant cannot authorize arbitrary siblings.
4. Opened the selected Excel file as Spectra Sheets; values were 20, 22 and 42. Actual installed Excel changed A1 to 25 and saved. Bridge delivered the changed file, but Spectra raised the **existing false sequential conflict** (FLOW-012), even though this new work was only opened/viewed. Keep Excel version recovered 25, 22 and 47. [Evidence](2026-10-27-evidence/file-sync-excel-existing-conflict.png). This is not recorded as a clean round-trip pass.
5. Cancelled a native file picker. No additional grants appeared; no successful selection was reported. Unit coverage separately asserts the zero-selection outcome and absence of a devices-changed event.
6. Restarted the actual Bridge process. All three grant IDs and file scopes were identical afterward; no duplicate mounts were created.
7. Paused/resumed the isolated Word selection through Devices. Removed it through the file-specific confirmation. Its physical DOCX remained, while the other two live grants stayed present.
8. Repeated multi-select and process restart with the final `file-mount:` namespace: both grant IDs and `file` scopes restored unchanged. Removed all test selections through Devices afterward; the page correctly showed Connected with no stale tiles. All four physical files remained, including the never-selected sibling whose SHA-256 stayed `db6cef7f1337f5c0525c7e8c0b9bf0f0c170a72efb9a2585910dbd7ccb542338`.

## Verification

- Full Vitest suite: **615 test files passed, one skipped; 5,317 tests passed, one skipped**, with four workers. The dense Sheets performance assertion passed without changing its 250 ms threshold.
- Node suites: **12 passed**, zero failed.
- Final extra regressions after the full run: **65 tests passed** across the replica and Devices suites, including rejection of creating a sibling/new file in an isolated grant and exactly-once continuation from Library after connection.
- Rust workspace: **154 passed** (48 app unit, 84 core unit, 21 chaos/integration, one granted-tree acceptance). Native app build succeeded. The existing chaos/readback suite remained intact.
- `npx tsc --noEmit`: passed. Production Next build: compiled, type checked and prerendered successfully in an isolated build directory. The first build invocation using Node `--env-file` was rejected by Next's worker argument validation; the corrected runner loaded the same local environment without forwarding that flag.
- Architecture, capability IR, copy and secret gates: passed. Skills bundle check was current. Production deploy-environment check was skipped by its local-environment rule, not certified.
- ESLint on every changed TypeScript file and the new proxy test passed. Staged secret scan passed across 3,885 tracked files; evidence links resolved. Repository-wide lint/design debt remains separately listed in the audit.
- Dedicated regressions cover exact scope, batch validation/dedup/limits, missing/recreated selections, directory replacement, safe writes/readback, paired native route, cloud discovery/report boundaries, General preservation, re-pair identity, independent structure changes, destination filtering, command dispatch, Devices controls and downgrade namespace isolation. Symlink replacement is rejected by code; creating OS symlinks was not part of the live Windows test.
- Final native follow-up binds persisted file selections to their creating device ID. The 154-test Rust workspace rerun passed, including rejection before pairing and rejection of restoration under a different pairing. This prevents old-version unpair/re-pair from reviving otherwise invisible file selections under another account.

## Release requirements

- Deploy the schema/functions and web app together; release an updated Bridge binary to enable the new picker on installed devices. Local instances 8 and 9 were updated for live tests, and the local Bridge executable was rebuilt/restarted with existing credentials/journal preserved. No production deployment or published installer was performed.
- Existing folder grants/configuration remain compatible. File-only grants use their own journal namespace and require both a basename and their original device pairing when restored. Older binaries ignore these selections on downgrade; upgrading again restores them only if the pairing is unchanged. Unpairing/re-pairing through an older binary cannot resurrect selections for another account. No folder permission is inferred from a file grant.
- This feature preserves the existing file-format/import capabilities. Testing DOCX/XLSX/PPTX selections does not certify every supported Office subtype or arbitrary binary file's preview/edit behavior.
- The wider audit's P0 document corruption and native conflict failures still block a launch-readiness claim.
