# P1 — The Truth Engine

**Goal:** after P1, no state label in Spectra can lie, no sync state can strand, renames don't tombstone, a quiet mount is silent, and one presenter speaks for sync everywhere. This is the hardest phase and the foundation of every later one: a correct merge (P2) over a lying replica machine is still a lie.

**Prerequisites:** P0.I1, P0.I3 accepted. **Architecture:** ARCHITECTURE-TRUTH (all), CANON R1–R4, R14–R15.

**Findings absorbed:** CS-1..CS-12 (whole cloud-sync part), BR-1..BR-9 (Bridge macro layer), WC-1..WC-5 (pairing/client), ST-1/ST-2 (status), PL-1 placement leaks touching replicas, DOC-3's stale-base window (the truth half; the merge half is P2).

## P1.I1 — Replica truth machine rebuild (H)

`convex/replicas.ts`, `convex/bridgeSync.ts`, `convex/syncPolicy.ts`, `shared/sync-policy.ts` (kernels preserved). Deliverables: the compensation table (spec-in-repo, reviewed with the code); removal of all optimistic stamps (ARCHITECTURE-TRUTH §1 list); derived idempotency keys end-to-end; sweepers (indexed) for every strandable state; F6 transitions with verified completion + failure paths; conflict lifecycle that swaps what it says (per-region where possible, keep-both exists); server-side policy enforcement on payload writes; refcount GC. Migration note: existing replica rows are migrated with a one-time reconciliation pass that re-derives state from actual revisions — never trust stored optimistic labels.

## P1.I2 — Bridge incremental engine (H)

`bridge/bridge-app/src/main.rs`, `bridge-core/src/{watcher,sync,identity,journal}.rs`. Deliverables per ARCHITECTURE-TRUTH §3: StabilityTracker wired (changed-path stabilization replaces sleep-and-hash-everything); identity adoption + `resources` table wired (rename/move = identity event); outbound journal queue wired with backoff + HTTP timeouts; batched `reportChanges` cloud API (new Convex endpoint, paged bulk discovery); per-file failure isolation (no whole-pass aborts, no head-of-line blocking); claim-time preconditions; journal compaction scheduled; the decorative WS request protocol **deleted** (decision 2026-08-25 — polling with backoff suffices at pilot scale; the health/status HTTP surface stays). Rust chaos tests extend the existing suite. The 300s unconditional rescan becomes a rare scheduled reconcile.

## P1.I3 — Status presenter + studio truth seams (M)

Extract from `artifact-studio.tsx` the load-bearing seams (ARCHITECTURE-PLATFORM §3): `artifact-persistence.ts` (save/close/dirty — including a real discard path and the blank-title trap fix, UX-1/UX-2), `artifact-native-sync.ts` (lens refresh/reconcile effects), and build `useSyncPresentation` consumed by studio header, Library rows, and dock (ST-1). Product-wide offline truth (UX-3). Plain-words map for every sync/bridge state (R13) — machine tokens die here.

## P1.I4 — Sync-as-toggles surface (M)

ARCHITECTURE-TRUTH §6 table becomes the UI: three toggles + protected-original switch, consequence sentences, safe defaults. Bridge surfaces reworked to R15: pairing dead-ends fixed (expiry message, multi-tab, port-taken vs not-installed distinguishable), update-required state honest (health schema tolerant + working update affordance), dead buttons wired or removed (WC-3), "0 of 16 files" class of lies replaced by unavailable-truth. Raw enum vocabulary removed everywhere user-visible.

## P1.V1 — Truth-machine property tests (H)

VERIFICATION L2: model-based interleaving tests against the *real* Convex functions (convex-test harness) asserting ARCHITECTURE-TRUTH §4 invariants. Must import the production modules — a test that models the model is Nova's `sync-matrix.test.ts` again and will be rejected.

## P1.V2 — Bridge chaos verification (H)

Kill mid-write/restart/replay; slow-writer ingestion (partial-bytes revisions impossible); lock storms; rename cascades incl. folder renames; OneDrive placeholder mount (informed by P0.V1's experiment); 10k-file mount: discovery cost measured, steady-state budget (0 mutations quiet) verified; revocation mid-write. Dated reports in `.shots/reformation/P1.V2/`.

## P1.V3 — Sync journey verification (M)

Goal cards: first-run pairing by a novice; mount a real folder; toggle each storage option and verify the consequence sentence is true; kill the network mid-edit; kill the Bridge mid-save; edit in Word while Spectra is open and closed; watch every label — the card fails if any label ever disagrees with reality (R2/D26 is now testable by walking around).

## Exit gate

Property + chaos suites green in CI; journey PASS; budgets (quiet mount, idle product) met; no `pending`/`current` lie reproducible by the verifier; Pablo pass. P2 starts only after P1.I1 + P1.I2 ACCEPTED.
