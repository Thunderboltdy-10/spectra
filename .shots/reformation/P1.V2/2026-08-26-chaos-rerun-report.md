# P1.V2 Bridge chaos verification rerun — 2026-08-26

Verdict: **PASS**. Independent verifier rerun; no product code or verifier assertions changed.

## Scope and unchanged-harness check

- Re-read the Reformation governing stack, P1.V2 brief, ARCHITECTURE-TRUTH, and the BR/CS finding families owned by this unit.
- Verified `bridge/bridge-core/tests/chaos.rs` and `convex/bridge-chaos.test.ts` are byte-for-byte unchanged from the rejecting verifier commit `4cdeae4`.
- Tested the implementation at `f11e147`, including the stable-byte lease path and paged device revocation.

## Results

| Scenario | Result | Evidence |
| --- | --- | --- |
| Kill/restart/replay, stale temp, lost ack, double replay | PASS | Rust chaos suite |
| Slow writer with an 800 ms pause | PASS | Writer-exclusive stable-byte proof; no partial revision |
| Lock storms and unrelated work | PASS | Rust chaos suite |
| Rename/folder-rename continuity | PASS | Rust core + chaos and Convex focused suites |
| OneDrive/provider placeholder failure | PASS | Explicit failure and incomplete-scan isolation |
| 10k-file discovery and quiet mount | PASS | Bounded single walk; no quiet watcher delta |
| Revocation during claimed write | PASS | Credential rejection and compensated state |
| Revocation at 2,001 replicas | PASS | All indexed states drained; no current replica remains |

## Commands

- `cargo test --manifest-path bridge/Cargo.toml --test chaos -- --nocapture` → **13/13 passed**.
- `cargo test --manifest-path bridge/Cargo.toml --lib -- --nocapture` → **37/37 passed**.
- Focused Convex command (`bridge-chaos`, `bridgeSync`, `replicas`, `replica-truth.property`) → **4 files / 19 tests passed**.
- `cargo check --manifest-path bridge/bridge-app/Cargo.toml` → PASS.
- `cargo fmt --manifest-path bridge/Cargo.toml --all -- --check` → PASS.
- `npx eslint convex/bridge-chaos.test.ts` → PASS; `git diff --check` → PASS; `npm run check:secrets` → PASS (1,921 tracked files).
- `cargo test --manifest-path bridge/Cargo.toml --all-targets -- --nocapture` → 50 tests passed, then the documented stale `granted_tree` fixture test failed during setup because `.tmp-n3-mount` is absent; no assertion or gate was weakened.
- Repository-wide sweep remains deferred by Reformation process until paired verification; this paired unit is now complete.

## Verdict

P1.V2-F1 (stable-byte proof / BR-3) is independently falsified and closed class-wide. P1.V2-F2 (bounded revocation) is independently falsified and closed. P1.V2 **VERIFIED**; P1.I2 **ACCEPTED**.
