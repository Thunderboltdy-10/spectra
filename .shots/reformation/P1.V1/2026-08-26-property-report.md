# P1.V1 truth-machine property report — 2026-08-26

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
