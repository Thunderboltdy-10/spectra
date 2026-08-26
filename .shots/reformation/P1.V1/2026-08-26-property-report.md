# P1.V1 truth-machine property report — 2026-08-26

**Current status: VERIFIED on independent rerun after fix `708b09a`. The original rejected run remains below as historical evidence.**

## Scope

- Verifier unit: P1.V1, grading P1.I1.
- Layer: VERIFICATION L2 against real Convex functions through `convex-test`.
- Invariants: ARCHITECTURE-TRUTH §4.1–§4.4; presenter invariant §4.5 remains owned by P1.I3/V3.
- No product code was changed.

## Harness

`convex/replica-truth.property.test.ts` imports the production schema and generated API modules. It runs 24 deterministic seeds with 18 action slots each across enqueue, claim, verified completion, Office lock/wait, failed completion, external save, exact journal replay, actor crash, sweeper restart, network wait, and device revoke. Each step asserts byte-backed `current`, cross-replica revision agreement, request/operation agreement, and idempotency-key uniqueness. Every trace is then expired and swept to check bounded compensation.

## Finding P1.V1-F1

**HIGH · SYSTEMIC: replay-sensitive external-save state derivation.**

Minimal real-function sequence:

1. Cloud and local replicas both begin `current` at revision `…0001`.
2. `bridgeSync.commitPayloadUpload` commits external revision `…0002` once. Local becomes `ahead` at `…0002`, but cloud remains `current` at `…0001`.
3. The exact same committed journal entry is replayed with the same payload reference. Local changes from `ahead` to `current`; cloud remains `current` at `…0001`; no conflict exists.

The semantic snapshot after step 3 differs from step 2 only in the local state (`ahead → current`). This violates replay idempotence and the rule that `current` requires verified byte agreement. Generated traces reproduced the false-current class in seeds 1, 2, 3, 4, 11, 14, 17, 20, 23, and 24 (59 observations including persistence after later actions).

Suspected root seam: `convex/bridgeSync.ts` derives `externalChange` from the already-mutated local replica and then updates only that replica on the non-conflict path. Event novelty is not a stable source of replica truth.

## Checks

- Pre-harness focused suite: 3 files / 33 tests passed.
- Property suite: 1 file / 2 tests failed on the finding above.
- Combined focused gate: 3 existing files passed (33 tests); the property file failed both tests, as expected for the rejected invariant.
- All 24 generated traces reached zero stranded pending request/operation/replica/strategy rows after forced expiry and `replicas.sweepReplicaTruth`.
- Harness ESLint: pass, zero warnings.
- `tsc --noEmit`: the same five pre-existing errors recorded in STATE §1; no harness error.
- Secret scan: pass across 1,917 tracked files.
- Scoped diff check for P1.V1 files: pass. The repository-wide diff check still sees the pre-existing, user-owned trailing space in dirty `PROCESS.md`; P1.V1 did not edit or stage it.

## Verdict

**REJECTED.** P1.I1 owns the systemic class. P1.V1 must be rerun after the class is fixed; P1.V2 does not start first.

## Independent rerun — 2026-08-26

### Integrity and code inspection

- Inspected fix commit `708b09a` and current `commitPayloadUpload` truth derivation before execution.
- `git diff --exit-code 38ee810..708b09a -- convex/replica-truth.property.test.ts` passed: the verifier-owned property suite is unchanged from its failing introduction commit.
- The fix derives external-operation identity from the retained common base, demotes an unchanged cloud to `behind`, preserves that base across later saves, and returns exact applied/conflicted replays before replica, operation, transition, or conflict mutation.

### Rerun results

- Unchanged property suite: 1 file / 2 tests passed, including all 24 deterministic traces × 18 actions and exact replay snapshot equality.
- Focused truth-machine suite: 3 files / 35 tests passed (`convex/replicas.test.ts`, replica-truth contracts, sync-policy/storage contracts).
- Independent ephemeral concurrent-change probe: 1 file / 1 test passed, then removed. A queued Spectra revision and a different external revision produced two `diverged` replicas, one conflicted write request, two conflicted operations, and one open conflict retaining both payload identities.
- Exact replay of that conflicted external journal entry returned the same result and changed no replica, request, operation, or conflict truth.
- Changed-file/harness ESLint passed with zero warnings; secret scan passed across 1,919 tracked files.
- The repository-wide sweep was not run, per the rerun instruction.

### Finding disposition and verdict

P1.V1-F1 is independently falsified against current code: external saves now leave local `ahead` and stale cloud `behind`; successive saves retain the verified common base; concurrent changes remain conflicts; exact replay is truth-idempotent.

**PASS.** P1.V1 is VERIFIED and P1.I1 is ACCEPTED under PROCESS §2. No product or existing test code was changed by the verifier. P1.V2 was not started.
