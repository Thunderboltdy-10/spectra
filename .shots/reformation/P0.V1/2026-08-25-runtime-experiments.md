# P0.V1 runtime falsification report

Run date: 2026-08-25
Role: verifier; no product code changed.
Verdict: REJECTED with systemic findings and four field probes left unsafe or inconclusive.

## Part XXIII results

1. **HTTPS → loopback PNA — INCONCLUSIVE.** The Bridge was not listening at the start (`http://127.0.0.1:47615` refused). An isolated loopback responder was started and stopped safely. Chrome reached an HTTPS control page, but the Chrome evaluation sandbox exposed neither page `fetch` nor `performance`, and its javascript URL policy rejected the only remaining page-script route. No browser PNA permit/deny result is claimed. The product transport remains HTTP loopback (`src/features/spectra/bridge/client.ts:3,19`), so this requires a real browser-context probe before deployment claims.

2. **Hostile SDT-wrapped DOCX — FAIL, DOC-5 confirmed.** A generated two-table DOCX had the first `<w:tbl>` wrapped in `<w:sdt>`. The hostile package still contained 2 body tables, but the projection exposed 1 block (`FIRST A | FIRST B`) at the direct second-table position. Direct lens materialization of that block wrote `MUTATED A | FIRST B` and reported `wrote`. The route-level `assertChangedTablesSupported` guard is green and refuses changed table blocks, but the lens still has a topology/order identity gap (`docx-lens.ts:821-929`, `1156`). Triage: **SYSTEMIC — native-container traversal and stable region identity**, not a table-only patch.

3. **Slow copy / IPG — FAIL at runtime seam, BR-3 confirmed.** The tested `StabilityTracker` suppressed the first and intermediate observations and emitted only the final stable revision (`first=None`, `after-write=None`, `final_emitted=true`); watcher tests passed. `StabilityTracker` is not called by `bridge-app`; the production loop drains `MountWatcher`, sleeps `config.stability_window`, then calls `sync_grant` (`bridge-app/src/main.rs:920-924`). Triage: **SYSTEMIC — tested stable-byte gate is not wired into the production ingestion path**.

4. **SUBST drive swap — root identity fork confirmed, BR-4/CS-11 risk.** The same temporary file remained readable through a safe `F:` mapping, while `mount_root_key` produced different hashes for the original path and the `F:` path: `c0dfe7488da79c65df4a67ced6b096f91c88c8f8acc306f8abbaa80374a89c70` vs `9ee5fdeb26688fae7ae6158a7a60b3ebf154f2d5e5e931930a18ca74f52807a6`. No cloud sync or delete was allowed. Triage: **SYSTEMIC — path-derived mount identity/adoption and duplicate side effects** (`bridge-app/src/main.rs:235-243`).

5. **OneDrive online-only rescan — SAFE METADATA ONLY / runtime unverified, BR-5 open.** A read-only metadata walk of the real OneDrive root found 329,790 files; the root is a reparse-backed OneDrive directory and the population contains Windows cloud/reparse attribute groups consistent with online-only placeholders. No file bytes were opened and production `scan_page`/`run_sync` was not run: `scan_page` opens each file to obtain identity (`bridge-core/src/watcher.rs:105-110`), and a live rescan could hydrate or alter real user data. The mass-missing/trash behavior therefore remains unverified and must use an isolated provider fixture or explicit disposable-account approval.

6. **`revokeDevice` mid-write — NOT RUN.** Revoking the signed-in account's Bridge device is a destructive permission mutation. Static inspection confirms the server mutation revokes the credential, marks replicas/mounts unavailable, and fails pending/claimed writes (`convex/bridge.ts:115-134`), but `rg` found no product UI caller for `revokeDevice`. Live token invalidation and an in-flight write were not proven; Pablo approval and a disposable device/account are required.

7. **Six pairing tabs — core slot overwrite confirmed, WC-1.** A temporary core harness submitted six valid offers to one `ServerState`; after the sixth, `pending_pairing_code` was only `000005` (the sixth offer), proving the single pending slot overwrites earlier tabs. No six-tab browser mutation was attempted, and no Bridge listener was available. Triage: **SYSTEMIC — pairing lifecycle fan-in/expiry and user-visible ownership of pending offers**.

8. **Durable Object room binding — PASS at code boundary, SEC-1.** A temporary harness issued a valid signed token for `work-1` and verified both protections: `/rooms/work-2` returned `403 ROOM_WORK_BINDING_MISMATCH`, and a persisted `room_id=room-old` returned `403 ROOM_IDENTITY_BINDING_MISMATCH`. The harness was deleted. The paired realtime suite also passed 11/11.

9. **fflate determinism — FAIL, PKG-1 confirmed.** Two semantically identical `createSpectraPackage` calls 1.1 seconds apart produced 674 bytes each but different SHA-256 values: `013f573afcabe281379370b11ca3fe0cda19b51df6b1ef3d2c77db8027cba544` and `316b4e537c95d40675b5eb3b9c3ca6e0afb5de7422484ed2fb2a9ec7e1383e8a`. `spectra-package.ts:18` calls `zipSync` without a fixed timestamp/options. Triage: **SYSTEMIC — package byte canonicalization**, not a test relaxation.

10. **150 MB transfer — local guard PASS, end-to-end BR-6 open.** A 150 MB in-memory payload was rejected before any network call with `payload exceeds the 100 MB safety ceiling` in 0 ms (`bridge-core/src/sync.rs:243-254`). This does not test a whole-pass failure after one oversized item; cloud/Bridge were unavailable, so the abort/timeout behavior remains open.

## Relevant checks

- `npx vitest run src/features/spectra/__tests__/docx-lens.test.ts`: 13 passed.
- `npm run test:realtime -- --reporter=verbose`: 11 passed.
- Temporary DO binding probe: 2 passed; harness removed.
- `cargo test --manifest-path bridge\\bridge-core\\Cargo.toml watcher::tests -- --nocapture`: 9 passed.
- `cargo test --manifest-path bridge\\bridge-core\\Cargo.toml server::tests -- --nocapture`: 5 passed.
- `cargo test --manifest-path bridge\\bridge-core\\Cargo.toml sync::tests -- --nocapture`: 2 passed.
- The full repository sweep and package-wide Rust `granted_tree` run were not executed; paired verification is not complete and the fixture was intentionally removed by P0.I5.

Evidence includes the live same-tab baseline at `chrome-workspace-baseline.png`. The temporary HTTPS probe tab was closed; all subsequent browser work stayed on the claimed Spectra tab.
