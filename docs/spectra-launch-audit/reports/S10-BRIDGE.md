# S10-BRIDGE

2026-09-24, primary `main`, inherited S9/W9 dirty baseline preserved. Implementation and focused validation complete; latest structural backend and worker changes await coordinator publication/upgrade. No commit, branch change, runtime restart, local deployment, browser/Office mutation, or original school-file edit was performed by this lane. The session began with workspace-write/restricted network and was explicitly changed to danger-full-access/approval never before implementation.

## Repairs and evidence

- Native byte replay now admits an exact target hash through preflight to SafeWriter readback. A crash after replacement and before the cloud receipt no longer becomes an automatic stale-base conflict. Both preflight and writer resolve the journal's resource path, with a grant ownership check.
- SafeWriter serializes operations on the same canonical path and rechecks current disk bytes, path and Office lock after staging, immediately before replacement. Deleted originals are not recreated; creation requires the explicit `new:` base. New deterministic cases cover an external save during download/staging, deletion, newly appearing targets/locks, same-path concurrent writers, and lost receipts.
- `refreshWriteClaim` revalidates token/generation, permission, live target and native base after download. Prefetch is limited to four writes; previously twenty serial claim RPCs could age the first lease beyond the two-minute redrive window. Publish the helper before upgrading the worker. HTTP mutation/upload clients reuse a connection pool with the existing per-request timeouts.
- `queueMaterialization` retries return the existing receipt without rewriting canonical content or the queued projection. Actual-handler tests cover pending, claimed and verified A replay after newer B. REVIEW-DURABLE independently ran the three regressions successfully.
- Idle payload discovery now reads indexed pending transitions, not the first sixty replica bodies plus per-work permission/history queries. A durable per-device cursor walks twenty transition IDs/source IDs at a time, with actual replica pagination for legacy transitions without source snapshots. Current permission, account, transition, replica and mount state are rechecked after resume. Empty idle polling does not patch the device. Six actual-handler tests cover later sources, multiple transition pages, legacy pages, cancelled cached entries and malformed cursors.
- Native write and structure claim deadlines use indexed ranges. DATA explicitly transferred these schema hunks: `bridgeDevices.payloadUploadCursor`, `storageStrategyTransitions.by_account_state`, and `bridgeWriteRequests`/`bridgeFsRequests.by_device_state_claimed`.
- Watcher lock fallback uses an indexed rotating local journal page of 100 resources every two seconds. The prior implementation loaded every resource and forever probed only the first 500. A 750-resource regression proves complete traversal. OS change events invalidate metadata shortcuts; read/access events do not. Quiescence polls avoid rehashing unchanged metadata before the deadline, but the deadline still requires a fresh writer-exclusive hash, including same-size/mtime edits. Bridge staging files are excluded from discovery and disappearance events.
- Rename collision destinations are journaled before the filesystem action. Post-rename/pre-receipt recovery verifies the reserved destination hash, and retries cannot report a newly calculated nonexistent suffix. Nested parents are validated inside the grant before creation. Structure terminal receipts are immutable and permissions are rechecked at claim/completion.
- Structural claims now capture the queued byte revision, rotate generation/token on every attempt, and refresh permission, mount, replica and resource bindings before filesystem work. Office locks and transient IO errors park outside the eligible queue using the shared retry schedule. Sweeper redrive preserves generation history and cannot revive an old receipt. Move/delete reject changed source bytes.
- Structural acknowledgements persist the outcome, actual collision path and lease in SQLite before HTTP. Lost responses can be retried without repeating the filesystem action. Migration preserves existing byte acknowledgements. Completion preserves pending/ahead/diverged content state and rejects a delayed first receipt if a newer move already changed the replica path, while accepting discovery of the same reserved destination.
- SECURITY owns the coordinated storage integrity guards in `beginPayloadUpload`/`commitPayloadUpload`, their dedicated tests, and device credential-hash redaction. Bridge fixtures now use actual stored-byte SHA-256 values; integrity checks were not weakened.

## Current verification checkpoint

- Current-source Vitest: **129/129, exactly seven files**, including Bridge queues/structure, replicas, property transitions, digest guards, Bridge contract and shared retry policy. Earlier totals of 115 across nine files and 57 across two files included frozen backup copies and are superseded by this explicitly excluded run.
- Rust core library, chaos and disposable granted-tree fixture: **80/80** (58 + 21 + 1), including structural acknowledgements, SQLite migration, changed-source rejection and receipt recovery.
- Rust app debug compile/tests: **24/24**, single build job and test thread, including the final structural queue/claim code. Package is `spectra-bridge`, binary target; compile finished in 14.91 seconds. No worker process was launched.
- Scoped ESLint with zero warnings and scoped `git diff --check` passed after the final structural change. Git printed existing LF/CRLF conversion notices only. Full integrated typecheck/build belongs to the coordinator and was not rerun by this lane.
- A provider timing test initially failed after the metadata shortcut; the event contract was repaired rather than allowing early emission. The fixture now explicitly signals its simulated provider changes, and a separate same-size/mtime test covers a missed event conservatively.

These are deterministic fixtures and source/debug/release-build evidence. Historical S9-OFFICE Word lock/coalescing/readback results are separate evidence on their tested source. No new live native case, physical process crash, served cost measurement, macOS result, or production readiness is claimed.

Commands from repository root, except Cargo commands from `bridge/`:

```text
npx vitest run convex/bridgeSync.test.ts convex/replicas.test.ts convex/replica-truth.property.test.ts convex/bridge-chaos.test.ts convex/bridge-payload-integrity.test.ts src/features/spectra/__tests__/bridge-contract.test.ts shared/sync-retry-policy.test.ts --exclude '.spectra-local/**' --maxWorkers=1 --no-file-parallelism --reporter=verbose
cargo test -p spectra-bridge-core --lib --test chaos --test granted_tree -j 1 -- --test-threads=1
cargo test -p spectra-bridge -j 1 -- --test-threads=1
npx eslint convex/bridge.ts convex/bridgeSync.ts convex/bridgeStructure.ts convex/bridgeWriteOperations.ts convex/bridgeSync.test.ts convex/replicas.ts convex/replicas.test.ts convex/replica-truth.property.test.ts src/features/spectra/__tests__/bridge-contract.test.ts --max-warnings=0
```

## Publication contract and ownership

The coordinator's earlier frozen backend publication excludes the final structural follow-up. Publish the updated schema/backend before starting the new worker. `bridgeStructure.claim` accepts optional `supportsFencing`; only `true` can acquire new work. New workers send it and use `refreshClaim`, then complete with generation/token. Old workers receive `{request:null, upgradeRequired:true}` and safely defer move/delete, while byte writes and payload discovery remain compatible. New workers against the old structural backend are not supported.

Pending/abandoned legacy structural requests without a captured base become `conflicted` with `structure-base-unavailable`, requiring a fresh user request rather than guessing the original bytes. Already claimed legacy requests may finish with their original unfenced acknowledgement if still current; terminal receipts remain immutable. Retention/expiry policy is unchanged.

DATA-approved schema additions: optional `bridgeDevices.payloadUploadCursor`; `storageStrategyTransitions.by_account_state`; `bridgeWriteRequests.by_device_state_claimed`; `bridgeFsRequests.by_device_state_claimed`; optional `bridgeFsRequests.claimGeneration`, `claimToken`, `attemptCount`, `retryAt`, `baseRevision`; and `bridgeFsRequests.by_device_state_retry`. No required-field migration is introduced.

BRIDGE implementation paths are `bridge/bridge-app/src/main.rs`, `bridge/bridge-core/src/{fs,journal,sync,watcher}.rs`, scoped Rust tests, `convex/{bridge,bridgeSync,bridgeStructure,bridgeWriteOperations}.ts`, and focused test fixtures. Existing Bridge identity/retry/lib changes are preserved. Coordinator transferred only `convex/replicas.ts` `queueMaterialization`; DATA transferred only the listed schema fields/indexes. SECURITY's digest guards and credential redaction remain in the shared files and must be preserved. Whole-file hashes below identify the combined checkpoint, not sole authorship.

## Local Windows release worker — 2026-09-24

Coordinator approved this single-job build while running the integrated TypeScript check in the other heavy slot. From `<local-workspace>`, `cargo build --release -p spectra-bridge -j 1` succeeded with exit 0 in **182.8586 seconds**, from **12:43:49.102967 UTC** to **12:46:51.967712 UTC**. Cargo reported the optimized release profile finished in 3m 02s. Toolchain: rustc 1.92.0 (ded5c06cf 2025-12-08), cargo 1.92.0 (344c4567c 2025-10-21). No extra tests, signing, packaging, distribution, or worker startup were performed.

- Binary: `<local-workspace>`, **19,085,312 bytes**.
- Binary SHA-256: `9fa116f0b8db54fe33272d6afbf5bce9371a334f3c315dd59e6bcf1119fa8d89`.
- App source SHA-256: `57735e8dbbb5680664ad4286d8b4f87e71bff14e43c269bb4ed8d8733faf43df`, matching the tested checkpoint.
- Source manifest SHA-256: `6e2e2bd0ed0373ed6f30b5cb7098b0180fbe3fbb753f8f2b10d0ec3e52f988af`. All **33** captured files, including Cargo.lock, Rust source, app assets/config and shared retry policy, were unchanged after the build.
- Evidence directory: `<local-workspace>`, containing `build.log`, `build-result.json`, `release-result.json`, `source-before.json`, `source-after.json`, and `saved-profile-summary.json`.

Read-only SQLite inspection ties the historical successful S9 Office device in `S9-OFFICE.md` to this existing profile:

| Setting | Existing saved value |
| --- | --- |
| `SPECTRA_BRIDGE_DATA_DIR` | `<local-workspace>` |
| Journal | The same directory's `bridge.sqlite` |
| `SPECTRA_CONVEX_URL` | `http://127.0.0.1:3002` |
| `SPECTRA_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` |
| Saved browser origin | `http://localhost:3000` |
| Device ID | `ms7bvr48xev932adxppy2keyfh8ez0k0` |
| Existing grant | `grant_f968f5a6f8e5448fbb382adeaae932e6` |
| Granted folder | `<local-workspace>` |

This profile has a saved browser session, one remembered mount (`S9-OFFICE-safe-mount`), and zero queued native acknowledgements at inspection. Resume under the same Windows user, Pablo, with the existing Credential Manager entry: service `Spectra Bridge`, account equal to the saved device ID. Credential values were not retrieved, and current backend credential validity was not retested. App startup restores this device, browser session and grant from the existing journal/keyring; no new pairing, reset, journal copy, or grant is needed when those existing credentials remain valid. Keep authenticated browser Profile A and the same local backend identity. Explicitly select this data directory: the default AppData profile and instance-1 profile contain different devices and additional remembered folders.

The coordinator should publish the matching structural backend first, then launch the recorded executable with these process environment values and working directory `<local-workspace>`, using a hidden process window. This lane did not execute that launch. `/health` alone does not establish the selected backend/device.

This release-build turn regressed to workspace-write, restricted network, approval never. Compilation succeeded within those permissions. The coordinator status-message tool returned `MCP tool call requires approval, but approval policy is never`; no alternate messaging route or approval bypass was attempted. The complete handoff is saved here for coordinator retrieval.

Full Access was subsequently reapplied and confirmed in the next preparation turn. Sources and binary remain frozen. Exact hidden launch and credential-safe validation helpers plus a six-case bounded acceptance plan are prepared in `.spectra-local/launch-orchestration/2026-09-24/bridge-release/{start-recorded-worker.ps1,validate-recorded-worker.py,structural-acceptance.md}`. Both scripts passed syntax parsing only; no launcher, credential lookup, HTTP check, Office operation or fault injection was executed. The launcher requires the coordinator's backend-publication and runtime-slot prerequisites, pins the binary hash and existing profile, and refuses an occupied Bridge port.

The auth plan uses the one-item `migrateCloudReplicaPage` dry-run branch, which authenticates without writing data; device credentials remain in memory and only a sanitized result is printed. The existing local `cloudConnected` field is not authoritative: an empty successful outbound drain can set its timestamp without an HTTP request. This finding was reported to the coordinator while preserving the source freeze. Exact crash/ack cases require a precise fault gate absent from the frozen release; the plan labels missing or missed gates unrun/inconclusive rather than treating arbitrary timed kills as proof.

## Remaining acceptance

Source work is ready for integration. Coordinator owns backend publication, the running worker upgrade, and the following live acceptance.

The disk check and rename remain separate OS operations: no cross-process compare-and-swap guarantee is established. The new path mutex serializes this Bridge process, and claim refresh reduces stale cloud ownership; external rename in the final syscall gap and a file operation lasting longer than its refreshed lease still need a platform-level fence/acceptance decision. Stored legacy move intents without a reserved collision destination cannot always be reconstructed safely.

After final source publication/worker build, schedule disposable-fixture cases: (1) Office lock/unlock and a second queued edit; (2) dropped successful receipt followed by reconnect and a newer edit; (3) forced stop after staged temp, after replace and before acknowledgement; (4) rename collision plus lost receipt/restart; (5) claim redrive while the old worker is delayed; (6) external save/delete during staging. Compare exact native hashes, claim generations, request/operation states and canonical versions; open native Word read-only only after those facts agree.

Measure idle Convex reads/bytes and RPCs on the served revision, then a single-file event on a large disposable mount. The source bound is one indexed pending-transition page and zero replica/history traversal when idle; this is not a measured production billing reduction. The lock fallback now reaches all files, but on a 10k-file mount a full fallback cycle is approximately 200 seconds; normal file/lock events remain immediate.

Bridge `/health` uses camelCase `protocolVersion`/`bindError` and does not expose the selected Convex deployment. The protocol marker establishes listener identity only; paired status does not prove backend match. RELEASE owns the coordinated start-all/readiness guard correction.

## Validated source checkpoint SHA-256

| Path | SHA-256 |
| --- | --- |
| `convex/bridge.ts` | `614adc070dbdcc15314735b53b53c22b730837e5c842e183dc864ec5a2c7e55e` |
| `convex/bridgeStructure.ts` | `56cdbb5a7d854c7d6ce1aaebcffc4d724c6c41add13da65975f164a293d59440` |
| `convex/bridgeSync.ts` | `9a8a9c0b7aa4dcd5f435c9b268f67249a7605be020d54b74be4c6f758758b96c` |
| `convex/bridgeWriteOperations.ts` | `1024d40b927b6495f589fa14b9b289890324f8d5e8e3504590565a0360197dfa` |
| `convex/replicas.ts` | `5debe6407afea57d55fc88f981cf9a6b110c32eceaa9093886dd2d1c8a72fe76` |
| `convex/schema.ts` | `f7815cec681c87a07e047fc83cc3aee5c340a351648c5e06a5f13e0fd9ab93cd` |
| `bridge/bridge-app/src/main.rs` | `57735e8dbbb5680664ad4286d8b4f87e71bff14e43c269bb4ed8d8733faf43df` |
| `bridge/bridge-core/src/fs.rs` | `d388e19b7d278c17fd08b5cdd216db69016ea9ce0391d593d9cfb12371587062` |
| `bridge/bridge-core/src/journal.rs` | `c7a93d565dc8289da779f76b00cc02fea39c5bd127c1a3d7107c9544a7306536` |
| `bridge/bridge-core/src/sync.rs` | `1d288d7a704ec5a0035c1aa6f5aef5baf4cae3d0854e5cb2c4f20f4c954e103f` |
| `bridge/bridge-core/src/watcher.rs` | `3995a0172cdfd7d9423eda47021f7f85aa1b1ac5109b877d40539b6b11fe45d6` |
