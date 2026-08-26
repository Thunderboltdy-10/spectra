# P1.V2 Bridge chaos verification — 2026-08-26

Verdict: **REJECTED**. Verifier changed no product code.

## Scope and current-truth inspection

- Read the Reformation governing stack, P1.V2 brief, ARCHITECTURE-TRUTH, ARCHITECTURE-PLATFORM budgets, and BR-1..BR-9 / CS-10 / WC-1..WC-5.
- Inspected `bridge-app` watcher, discovery, queue, claim, restart and pairing paths plus the Rust journal/watcher/identity/sync modules and real Convex Bridge mutations.
- Added verifier-owned harnesses only: `bridge/bridge-core/tests/chaos.rs` and `convex/bridge-chaos.test.ts`.

## Results

| Scenario | Result | Evidence |
| --- | --- | --- |
| Kill mid-write, restart, lost ack, double replay | PASS | Existing + extended Rust chaos: stale temp removed, verified bytes restored, replay harmless. |
| Slow writer with an 800 ms pause | **FAIL** | `StabilityTracker(750ms)` emitted partial SHA `7a55aad8f213e92323a7b4a78a276fb32426f2ad384ca6d57d8c536a70e358b2` while the writer handle remained open. |
| Lock storm / unrelated work | PASS in focused coverage | Office-owner locks suppress revision; retrying one outbound item leaves the next due; claim-time lock parks outside the immediate claim window. |
| Rename and folder-rename continuity | PASS in focused coverage | Rust identity/journal tests preserve OS identity and restart mapping; Convex rename/replay keeps one work/replica and disappearance is unavailable, not deleted. |
| OneDrive placeholder read failure | PASS in synthetic provider boundary | Failed hydration is returned in `scan.failures`; incomplete scans skip missing-resource reconciliation. P0.V1 live OneDrive retry remained 16/16. |
| 10k discovery cost | PASS locally | Single Rust repair walk covered 10,000 files under the 10 s gate; existing run measured first-page snapshot at ~0.45–0.61 s. |
| Quiet mount | PASS in watcher boundary | No watcher delta without filesystem changes; production repair interval is six hours, so no cloud mutation path is entered while quiet. |
| Revocation during claimed write | PASS at small scale | Device/mount/local replica/request/operation compensate; old credential rejects with `BRIDGE_CREDENTIAL_INVALID`. |
| Revocation at >2,000 replicas | **FAIL** | Exactly 2,000 replicas became unavailable and 1 remained `current`; `revokeDevice` uses `.take(2_000)`. |

## Findings

1. **P1.V2-F1 HIGH · SYSTEMIC · BR-3 slow-writer ingestion.** A quiescence timer plus repeated fingerprint cannot prove the writer has finished: after a pause longer than the 750 ms window, production publishes a partial revision. A user can receive truncated Office bytes as truth. Owner: P1.I2. Required class fix: writer-completion/stable-byte proof in the production ingestion path, with the failing verifier test unchanged.
2. **P1.V2-F2 HIGH · LOCAL · bounded revocation cleanup.** `convex/bridge.ts:120-126` caps device replicas at 2,000; the 2,001st replica remains `current` after device revocation. A user can see a revoked device's file as available. Owner: P1.I2. Replace the capped cleanup with complete indexed pagination/batched continuation and re-run the unchanged verifier harness.

## Commands

- `cargo test --manifest-path bridge/Cargo.toml --all-targets -- --nocapture` → 49 passed, 1 failed (P1.V2-F1); the stale `granted_tree` target is not part of this workspace command. The two passing scale/quiet probes were also rerun individually (1/1 each).
- `npm test -- --run convex/bridge-chaos.test.ts convex/bridgeSync.test.ts convex/replicas.test.ts convex/replica-truth.property.test.ts` → 18 passed, 1 failed (P1.V2-F2).
- Focused non-failing Rust chaos → 10/10 before adding the explicit scale/quiet probes; production Rust core → 37/37.
- Focused revocation-during-claim → 1/1; existing Convex Bridge/truth suites → 17/17.
- `cargo check --manifest-path bridge/bridge-app/Cargo.toml` PASS; `cargo fmt --manifest-path bridge/Cargo.toml --all -- --check` PASS.
- `npx eslint convex/bridge-chaos.test.ts` PASS; `npm run check:secrets` PASS.
- Repository-wide sweep not run: verifier gates are red and the program has no automated full-test lane.

## Paste-ready relaunch prompt for P1.I2

You are relaunching P1.I2 after P1.V2 rejection. Read the Reformation docs, STATE §1, and `.shots/reformation/P1.V2/2026-08-26-chaos-report.md`. Fix both owned findings class-wide in the production Bridge seam: (1) `StabilityTracker`/watcher ingestion must never promote bytes while a slow writer remains active, even when the pause exceeds 750 ms; preserve the unchanged failing verifier test and add a real writer-completion/stable-byte proof; (2) `convex/bridge.ts` device revocation must process every indexed replica/request in bounded pages or a continuation, not `.take(2_000)`, so a 2,001+ replica mount leaves no device-owned replica `current`. Do not weaken/delete tests or gates. Run the unchanged P1.V2 harness plus focused Rust/Convex checks and return IMPLEMENTED; the verifier will rerun P1.V2.
