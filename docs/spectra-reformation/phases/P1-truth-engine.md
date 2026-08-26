# P1 — The Truth Engine

**Goal:** after P1, no state label in Spectra can lie, no sync state can strand, renames don't tombstone, a quiet mount is silent, and one presenter speaks for sync everywhere. This is the hardest phase and the foundation of every later one: a correct merge (P2) over a lying replica machine is still a lie.

**Prerequisites:** P0.I1 and P0.I2 accepted. **Architecture:** ARCHITECTURE-TRUTH (all), CANON R1–R4, R14–R15.

**Difficulty / routing (PROCESS §4):** I1, I2, V1, V2 = **Hard / GPT 5.6 Sol xhigh**. I3, I4, V3 = **Medium-thinking / Grok 4.6 High** (V3 may be Sol if Pablo wants the journey graded harder than I3/I4). **No Simple. No Luna on any P1 I or V.** Hard units are serial. Never two live-product verifiers at once. I1 and I2 were the one clean parallel pair (Convex vs Rust) and are **IMPLEMENTED** — not ACCEPTED until V1/V2 pass.

**Remaining launch order:** V1 then V2, then I3 then I4 (same studio/header/dock — serial), then V3. P2 starts only after P1.I1 + P1.I2 **ACCEPTED** (verifier, not I-status).

**Findings absorbed:** CS-1..CS-12 (whole cloud-sync part), BR-1..BR-9 (Bridge macro layer), WC-1..WC-5 (pairing/client), ST-1/ST-2 (status), PL-1 placement leaks touching replicas, DOC-3's stale-base window (the truth half; the merge half is P2).

## P1.I1 — Replica truth machine rebuild (H)

`convex/replicas.ts`, `convex/bridgeSync.ts`, `convex/syncPolicy.ts`, `shared/sync-policy.ts` (kernels preserved). Deliverables: the compensation table (spec-in-repo, reviewed with the code); removal of all optimistic stamps (ARCHITECTURE-TRUTH §1 list); derived idempotency keys end-to-end; sweepers (indexed) for every strandable state; F6 transitions with verified completion + failure paths; conflict lifecycle that swaps what it says (per-region where possible, keep-both exists); server-side policy enforcement on payload writes; refcount GC. Migration note: existing replica rows are migrated with a one-time reconciliation pass that re-derives state from actual revisions — never trust stored optimistic labels.

**Owns:** the truth half of V2 lost-edit / native-write persistence (no optimistic stamps, compensation, verified materialize); replica side of BR-4/CS-11 path-derived mount identity (adoption/duplicate replicas — not the Bridge `mount_root_key` kernel).

**Does not own** (P1.I1 correctly refused a P0.V1/V2 class dump — collides with I2/I3/I4, P2, P4, P6; violates Hard sizing): BR-3 (I2), WC-1 (I4), presenter/plain-words/unsaved warning (I3), Bridge pairing recovery UI (I4), DOC-5 (P2.I1), PKG-1 (P2.I1), Library Share silent no-op (P6.I1), AI targeting (P4.I2).

## P1.I2 — Bridge incremental engine (H)

`bridge/bridge-app/src/main.rs`, `bridge-core/src/{watcher,sync,identity,journal}.rs`. Deliverables per ARCHITECTURE-TRUTH §3: StabilityTracker wired (changed-path stabilization replaces sleep-and-hash-everything); identity adoption + `resources` table wired (rename/move = identity event); outbound journal queue wired with backoff + HTTP timeouts; batched `reportChanges` cloud API (new Convex endpoint, paged bulk discovery); per-file failure isolation (no whole-pass aborts, no head-of-line blocking); claim-time preconditions; journal compaction scheduled; the decorative WS request protocol **deleted** (decision 2026-08-25 — polling with backoff suffices at pilot scale; the health/status HTTP surface stays). Rust chaos tests extend the existing suite. The 300s unconditional rescan becomes a rare scheduled reconcile.

**Owns:** BR-3 (wire `StabilityTracker` into `bridge-app`); Bridge half of BR-4/CS-11 (`mount_root_key` / identity adoption — path-derived root keys must not fork mounts).

## P1.I3 — Status presenter + studio truth seams (MT)

Extract from `artifact-studio.tsx` the load-bearing seams (ARCHITECTURE-PLATFORM §3): `artifact-persistence.ts` (save/close/dirty — including a real discard path and the blank-title trap fix, UX-1/UX-2), `artifact-native-sync.ts` (lens refresh/reconcile effects), and build `useSyncPresentation` consumed by studio header, Library rows, and dock (ST-1). Product-wide offline truth (UX-3). Plain-words map for every sync/bridge state (R13) — machine tokens die here.

**Owns the presenter half** of V2 lost-edit / status: unsaved warning, dirty/close/discard, raw Live Dock tokens, offline counts as spoken to the user. Do not re-implement the replica machine. Serial with I4 (same studio/header/dock); run I3 then I4 after V1/V2.

## P1.I4 — Sync-as-toggles surface (MT)

ARCHITECTURE-TRUTH §6 table becomes the UI: three toggles + protected-original switch, consequence sentences, safe defaults. Bridge surfaces reworked to R15: pairing dead-ends fixed (expiry message, multi-tab, port-taken vs not-installed distinguishable), update-required state honest (health schema tolerant + working update affordance), dead buttons wired or removed (WC-3), "0 of 16 files" class of lies replaced by unavailable-truth. Raw enum vocabulary removed everywhere user-visible.

**Owns:** WC-1 (six pairing offers / last code kept); Bridge recovery (`Failed to fetch`, pairing dead-ends); sync-policy jargon → toggle sentences; `0 of N` mount lies. Serial after I3.

## P1.V1 — Truth-machine property tests (H)

VERIFICATION L2: model-based interleaving tests against the *real* Convex functions (convex-test harness) asserting ARCHITECTURE-TRUTH §4 invariants. Must import the production modules — a test that models the model is Nova's `sync-matrix.test.ts` again and will be rejected.

**Model: GPT 5.6 Sol xhigh.** First remaining P1 unit. Not Luna.

## P1.V2 — Bridge chaos verification (H)

Kill mid-write/restart/replay; slow-writer ingestion (partial-bytes revisions impossible); lock storms; rename cascades incl. folder renames; OneDrive placeholder mount (informed by P0.V1's experiment); 10k-file mount: discovery cost measured, steady-state budget (0 mutations quiet) verified; revocation mid-write. Dated reports in `.shots/reformation/P1.V2/`.

**Model: GPT 5.6 Sol xhigh.** After V1. Never concurrent with another live-product verifier.

## P1.V3 — Sync journey verification (MT)

Goal cards: first-run pairing by a novice; mount a real folder; toggle each storage option and verify the consequence sentence is true; kill the network mid-edit; kill the Bridge mid-save; edit in Word while Spectra is open and closed; watch every label — the card fails if any label ever disagrees with reality (R2/D26 is now testable by walking around).

**Model: Grok 4.6 High** (or Sol if Pablo wants it graded harder than I3/I4). After I3+I4. Not Luna — P0.V2's Luna success does not transfer.

## Exit gate

Property + chaos suites green in their owning verification units; journey PASS; budgets (quiet mount, idle product) met; no `pending`/`current` lie reproducible by the verifier; Pablo pass. P2 starts only after P1.I1 + P1.I2 ACCEPTED.

## Implementer log — P1.I1 (2026-08-25)

- Rebuilt replica transitions around retained revision evidence; enqueue, discovery, and external reports no longer stamp unverified agreement.
- Added the executable compensation table, derived byte/strategy intent keys, indexed expiry/redrive paths, and structured sweeper repair logs.
- Persisted native payload + semantic projection bases and advance them only after write read-back or external reconciliation.
- F6 now stages policy, verifies Bridge materialization, rolls back on failure/expiry, and clears cloud bytes for metadata-only device/linked outcomes.
- Conflict rows retain both payload identities; resolution is revision/region-scoped, Spectra wins waits for write verification, and keep-both creates a real fork.
- Payload uploads are denied server-side for metadata-only/none policy; reference reconciliation protects current, pending, base, request, and open-conflict bytes before GC.
- Added the automatic one-time migration that distrusts legacy labels, verifies retained revisions, repairs duplicates, and records divergence instead of overwriting it.
- Deleted the superseded `removeLocalReplica` path and removed caller-supplied random keys from the materialization/strategy seams.
- Incidental UI call-site edits followed `/frontend-design` and `/design-taste-frontend`; no visual behavior or styling changed.
- Relevant checks: Convex production-module tests + focused policy contracts, 3 files/32 tests; changed-file ESLint; diff check; secret scan.
- `tsc --noEmit` has the same five pre-existing blockers recorded in STATE §1; this unit adds no TypeScript error and no gate was weakened.
- “Spectra only” unlinks but does not delete the user’s physical file; the transition records that consequence explicitly pending any separately approved destructive workflow.
- Status: IMPLEMENTED. No acceptance or verifier verdict claimed; the repository-wide sweep remains deferred until paired verification.

## Implementer rejection-fix log — P1.I1 / P1.V1-F1 (2026-08-26)

- Triage: **HIGH · SYSTEMIC** — external-save truth and keys depended on event novelty and a moving local revision.
- `commitPayloadUpload` now derives replica state from retained payload/base relations and keeps the verified common base stable across successive Word saves.
- A local-only upload leaves local `ahead` and demotes the unchanged cloud to `behind`; only byte equality can make either side `current`.
- External operation keys now use the retained base, and an already-applied matching target returns before any replica, operation, conflict, or transition mutation.
- Conflict recording no longer depends on whether its operation row already exists.
- Added focused regressions for exact replay and successive external saves; the verifier-owned property suite was not changed.
- Relevant checks: 4 focused files / 36 tests pass, including P1.V1's 24-seed property suite; changed-file ESLint passes.
- `tsc --noEmit` retains exactly the five pre-existing blockers in STATE §1 and adds none.
- Status: IMPLEMENTED. P1.V1 remains REJECTED pending independent rerun; no acceptance is claimed and P1.V2/P1.I2/I3/I4 were untouched.

## Implementer log — P1.I2 (2026-08-26)

- Replaced per-event/full-tree sync with changed-path classification, per-path StabilityTracker quiescence, and a six-hour repair reconcile.
- Repair scans walk once, batch discovery in pages of 100, preserve per-file scan failures, and never infer absence from an incomplete or locked scan.
- Wired the SQLite `resources` mapping to OS identity, path/hash adoption, rename/folder-move continuity, restart persistence, and explicit unavailable state.
- Delete/recreate with changed bytes receives a new identity; ambiguous hash adoption refuses to guess and cloud duplicates are preserved unavailable, not deleted.
- Wired durable outbound change intents, queue dedupe, deterministic keys, per-item acknowledgement/failure, bounded backoff, HTTP timeouts, and six-hour compaction.
- Added batched `reportChanges`, paged missing-resource reconciliation, concurrent payload delivery, and per-file failure isolation.
- Claim-time existence/lock/revision checks now precede payload download; externally deleted files conflict instead of being recreated.
- Indexed parked write retries and process unrelated replicas concurrently while preserving order within one replica.
- Deleted the decorative WebSocket request/session protocol; health, pairing, status, and HTTP mount surfaces remain.
- Relevant checks: Rust core 37/37; Rust chaos 9/9; Convex production-module tests 13/13; Bridge compile; changed-file ESLint; Rustfmt; diff check; secret scan.
- `tsc --noEmit` retains exactly the five pre-existing errors recorded in STATE §1 and adds none from P1.I2.
- The package-wide Rust command still cannot start the stale `granted_tree` fixture recorded in STATE §1; its assertion was not weakened or rewritten.
- Status: IMPLEMENTED. No acceptance/verifier verdict claimed; the repository-wide sweep remains deferred until paired verification.

## Verifier log — P1.V1 (2026-08-26)

- Read the governing stack, ARCHITECTURE-TRUTH, VERIFICATION, and the phase finding families; inspected I1 tests before production code.
- Existing I1 production-module/policy suite passed 3 files / 33 tests before the independent property harness was added.
- Added `convex/replica-truth.property.test.ts`; it imports the real Convex schema/API modules and does not reproduce transition logic in a test-only model.
- Exercised 24 deterministic seeds × 18 actions across enqueue, claim, complete, lock, external save, exact replay, crash, restart, network wait, and revoke.
- Compensation/quiescence left zero pending requests, operations, replicas, or strategy transitions across all 24 traces.
- **P1.V1-F1 HIGH · SYSTEMIC: replay-sensitive external-save state derivation.** First upload leaves cloud `current` against newer local bytes; exact replay changes local `ahead` to `current` while cloud keeps the old revision.
- The failure appeared in 10/24 generated traces (59 observations while the invalid state persisted); exact minimal replay fails deterministically.
- Root seam is `bridgeSync.commitPayloadUpload`: truth depends on whether the event looks new relative to already-mutated local state, rather than on the retained byte relation between replicas.
- No product code or existing assertion was changed. Harness ESLint passes; TypeScript adds no error beyond the five pre-existing blockers in STATE §1.
- Evidence: `.shots/reformation/P1.V1/2026-08-26-property-report.md`.
- Verdict: **REJECTED**. Owner P1.I1; rerun P1.V1 before P1.V2.

## Verifier rerun log — P1.V1 (2026-08-26)

- Inspected fix commit `708b09a` and current production truth; no product code was changed.
- Confirmed `convex/replica-truth.property.test.ts` is unchanged from failing verifier commit `38ee810`.
- Unchanged property suite passed 1 file / 2 tests, including all 24 deterministic traces × 18 actions.
- Focused truth-machine suites passed 3 files / 35 tests.
- External save now leaves local `ahead` and stale cloud `behind`; successive saves retain the original verified common base.
- An ephemeral production-module probe verified concurrent Spectra/external revisions create an open conflict retaining both payload identities; it passed 1/1 and was removed.
- Exact replay changed no replica, request, operation, or conflict truth in either the ordinary or conflicted sequence.
- Changed-file/harness ESLint and secret scan passed; the repository-wide sweep was not run by instruction.
- P1.V1-F1 is independently falsified and closed class-wide.
- Evidence: `.shots/reformation/P1.V1/2026-08-26-property-report.md`.
- Verdict: **PASS**. P1.V1 VERIFIED; P1.I1 ACCEPTED. P1.V2 was not started.

## Verifier log — P1.V2 (2026-08-26)

- Read the governing stack, P1.V2 finding families, current Bridge production paths, and existing Rust/Convex evidence; no product code changed.
- Added verifier-owned Rust and Convex chaos harnesses for slow writers, placeholders, 10k discovery/quiet boundaries, claimed-write revocation, and >2,000 replica cleanup.
- Kill/restart/replay, stale temp recovery, lost acknowledgement, double replay, lock parking/isolation, rename continuity, and explicit provider failures passed focused checks.
- Local 10k repair discovery completed in one bounded walk under 10 seconds; a quiet watched fixture emitted no change batch.
- Claimed-write revocation compensated device, mount, replica, request, and operation truth and rejected the old credential.
- **P1.V2-F1 HIGH · SYSTEMIC (BR-3):** an open writer paused for 800 ms; the 750 ms tracker emitted the partial prefix SHA as a revision before final bytes arrived.
- Root class: time/fingerprint quiescence is not writer-completion proof; the wired macro path can still promote partial bytes.
- **P1.V2-F2 HIGH · LOCAL:** revoking a device with 2,001 replicas changed 2,000 to unavailable and left exactly one `current` because cleanup uses `.take(2_000)`.
- Rust all-targets: 49 pass / 1 fail (F1). Focused Convex: 18 pass / 1 fail (F2). Existing Bridge/truth suites remain green.
- Bridge compile, Rustfmt, verifier-test ESLint, diff check (owned files), and secret scan pass; full repository sweep deferred by instruction.
- Evidence: `.shots/reformation/P1.V2/2026-08-26-chaos-report.md`.
- Verdict: **REJECTED**. Owner P1.I2; rerun P1.V2 unchanged after both findings are fixed.

## Implementer rejection-fix log — P1.I2 / P1.V2-F1-F2 (2026-08-26)

- Triage retained: F1 **HIGH · SYSTEMIC** stable-byte proof; F2 **HIGH · LOCAL** bounded revocation cleanup.
- Windows watcher ingestion now opens a `FILE_SHARE_READ`-only lease, hashes through that handle, and cannot emit while an incompatible writer remains open; platforms without an equivalent proof fail closed and retry.
- Enqueue rechecks the proven fingerprint, repair scans use the same snapshot, and payload upload reads through the writer-exclusive lease so promoted bytes cannot race the proof.
- `revokeDevice` uses a new `workReplicas.by_device_state` index and drains every non-unavailable replica state in batches of 100; mounts and pending/claimed write and structure requests are drained through their existing device-state indexes.
- The verifier-owned slow-writer and 2,001-replica tests were unchanged. Rust core 37/37 and chaos 13/13 pass; focused Convex 4 files / 19 tests pass; Bridge compile, changed-file ESLint, Rustfmt, owned diff check, and secret scan pass.
- Package-wide Rust still stops only at the documented missing `granted_tree` fixture. `tsc --noEmit` retains the five recorded blockers plus the unchanged verifier-test typing error at `convex/bridge-chaos.test.ts:172`.
- Status: **IMPLEMENTED**. P1.V2 remains REJECTED pending an independent unchanged rerun; no acceptance is claimed.

## Verifier rerun log — P1.V2 (2026-08-26)

- Re-ran the unchanged verifier harnesses against `f11e147`; no product code or assertions changed.
- Rust chaos passed **13/13**, including slow-writer, kill/replay, locks, placeholders, quiet mount, 10k discovery, and revocation scenarios.
- Rust core passed **37/37**; focused Convex suites passed **4 files / 19 tests** including 2,001-replica revocation.
- Bridge compile, Rustfmt, verifier-test ESLint, diff check, and secret scan passed.
- All-target Rust reached **50 passed** and only failed at the documented missing `.tmp-n3-mount` `granted_tree` fixture; no gate was weakened.
- P1.V2-F1 stable-byte proof and P1.V2-F2 bounded revocation are independently falsified and closed.
- Verdict: **PASS**. P1.V2 VERIFIED; P1.I2 ACCEPTED. Evidence: `.shots/reformation/P1.V2/2026-08-26-chaos-rerun-report.md`.

## Implementer log — P1.I3 (2026-08-26)

- One presenter (`presentSync` / `useSyncPresentation`) now speaks the studio header, Library rows, resource surface, and Live Dock failures; `saved-locally` is ready (ST-1).
- Product online is `navigator.onLine`; offline is selected before pending; zero queued still says Offline (UX-3).
- Dirty close asks Save / Discard / Keep editing; a blank name persists as Untitled and does not trap X, Escape, or tab close (UX-1/UX-2).
- Native lens open/apply/reconcile lives in `useArtifactNativeSync`; the studio duplicate path is deleted.
- One humanizer strips machine tokens from dock, native, and sync copy (R13 / ST-2).
- Library list rows subscribe to indexed `presentationsForAccount` and show conflict/error/offline/pending chips; board cards were left alone (more card chrome than this unit owns).
- The offline banner sits under the tab rail so Library and the composer see the same sentence.
- Taste: Untitled instead of a name prompt; Live stays off the header when copies agree; presenter `action` is not wired to Reconnect.
- Relevant checks: focused Vitest 3 files / 27 tests; disclosure wording in `bridge-contract.test.ts`; new-file ESLint; secret scan. Two pre-existing I2 string-scan assertions in `bridge-contract.test.ts` remain red (restore key now derived; `device || linked`). `tsc --noEmit` retains the five recorded blockers plus `bridge-chaos.test.ts:172`; this unit adds none.
- Status: IMPLEMENTED. No acceptance or verifier verdict claimed.

## Implementer log — P1.I4 (2026-08-26)

- Files and devices is three storage radios (This PC / Spectra / Both) plus a protected-original switch; Both is recommended in the UI. Consequence sentences replace policy enums (`mirror-from-disk`, `cloudContent`, `on-save-open`).
- Item-level Spectra never claims the disk file was deleted: the file stays on disk when a local copy already exists (honors the P1.I1 field note). Unconfigured accounts still default to engine `spectra` so we do not silently start writing the PC.
- Pairing offers are a map by challenge: six tabs keep six codes; a wrong code does not consume the offer; an already-paired second tab reuses the session token (WC-1).
- Health parse is `.passthrough()` (WC-4). Reachability distinguishes not-running vs port-taken vs running. Pairing errors never surface `Failed to fetch`. Update Bridge POSTs `/v1/update` and falls back to the tray sentence.
- Unavailable mounts speak unavailable-truth, never `0 of N`. Dead Open on device / fake image-preview / Bridge-can-stream copy are gone. Reconnect on the studio header and resource surface goes to Files and devices.
- Taste: Open on device deleted (no honest OS-open path). Live signed-in pairing/toggle/Word journey is P1.V3, not this unit.
- Relevant checks: focused Vitest `sync-toggles` + `sync-presentation` 12/12; `bridge-contract` 9 pass / 2 pre-existing I2 string-scans still red (restore key; `toPreset === "device"`) and not rewritten. Rust core `--lib` 40/40 (was 37); chaos 13/13 unchanged; `cargo check` bridge-app OK; new-file ESLint; secret scan. `tsc --noEmit` retains the five recorded blockers plus `bridge-chaos.test.ts:172`; this unit adds none.
- Status: IMPLEMENTED. No acceptance or verifier verdict claimed.

## Verifier log — P1.V3 (2026-08-26)

- Website-only pairing/settings/sync. Bridge in hidden tray; GUI not driven. Isolated `Downloads\spectra-p1v3-fixture`, not OneDrive Documents, not PS 6/PS 8.
- Bridge-down: honest **Not running**. Bridge-up unpaired: still **Not running** (`use-bridge` unpaired → disconnected → that label). **Connect this device** from the site then showed **Connected**.
- Account radios match canon; left on Both; consequence sentences not verified (no imported file).
- Picker reached the isolated fixture. Live Convex: `Could not find public function for 'bridgeSync:discoverResourcesPage'` (and Library `presentationsForAccount`). Fixture folder empty. Physics (real OneDrive) showed Request IDs plus `Provider-managed folder detected; conflict windows may be wider` / **Needs attention**.
- Browser offline on Settings → **Not running**, no Offline banner (`AppShell` vs `spectra-shell`). Real Bridge kill → **Not running** / **Waiting for Bridge** became true (no `0 of N`).
- Word refused `P1V3-essay.docx` (shots 20–21). Provenance: 17:31 PowerShell stub, 942 bytes, no `[Content_Types].xml`, SHA-256 unchanged after mount/Word. Not filed as Bridge rewrite. Do not reuse this stub.
- Focused Vitest 42 pass / 2 pre-existing I2 string-scans, not rewritten. No product code changed. `convex dev` was not running; do not `convex push` the real account.
- Verdict: **REJECTED**. Evidence: `.shots/reformation/P1.V3/manifest.md`.

## Implementer rejection-fix log — P1.I4 / P1.V3 (2026-08-26)

- Triage: unpaired-running → Not running, browser-offline → Not running, and listing-failure → Needs attention are one reachability class. Raw Request IDs / `bridgeSync:` / provider-managed copy are R13. Missing Convex functions stay LOCAL env (no `convex push`).
- `presentBridgeReachability` now separates offline, not-running, port-taken, running-unpaired, connected. A live unpaired Bridge is **Not connected**. Browser-offline is **Offline**, never Not running. I3 still owns the Settings Offline banner.
- Mount rows humanize Bridge `detail`; discovery/listing failures say waiting-for-Spectra, not Needs attention, and never dump Request IDs. Provider-managed jargon is stripped; the existing "another program" sentence remains.
- Taste: running-unpaired remembered folders say Connect this device, not Open Spectra Bridge.
- Relevant checks: focused Vitest `sync-toggles` + `sync-presentation` 14/14. Two pre-existing I2 string-scans in `bridge-contract.test.ts` not rewritten. Changed-file ESLint clean. Did not `convex push`.
- Status: IMPLEMENTED. No acceptance claimed. P1.V3 rerun remains independent after I3's banner and Convex actually serving current source.

## Implementer rejection-fix log — P1.I3 / P1.V3 (2026-08-26)

- Triage: **SYSTEMIC** — product-offline lived in the workbench (`spectra-shell`), so Settings/`AppShell` had no Offline sentence while Files and devices could still impersonate Bridge-down.
- `ProductOfflineBanner` now mounts once in `AppShell` chrome; the workbench copy is deleted so Library and Settings share the same strip (UX-3). Stage padding moved off `main` so the banner is full-bleed in the content column.
- I4 still owns Offline vs Not connected vs Not running on Files and devices. This unit does not retouch that mapping.
- Relevant checks: focused Vitest 3 files / 29 tests including an AppShell-mount contract; new-file ESLint; secret scan. No `convex push`. Did not run P1.V3.
- Status: IMPLEMENTED. No acceptance claimed. P1.V3 rerun remains independent.

## Verifier rerun log — P1.V3 (2026-08-26)

- Independent rerun after `f6f60fb` / `7a31c25`. Convex serving (`convex dev --typecheck=disable`). No product code or assertions changed.
- Isolated valid OOXML at `Downloads\spectra-p1v3-rerun-fixture` (not the 942-byte stub, not OneDrive, not PS 6/PS 8). Bridge + Word on hidden desktop `P1V3Rerun`, then cleaned up.
- Header holds: down → **Not running**; unpaired-running (after clearing session) → **Not connected**; browser-offline → **Offline** plus AppShell banner. No Request IDs / missing-function dumps; Physics jargon humanized.
- New 1-file mount stayed **Reading folder** / Bridge `scanning` for minutes; Library never listed the folder. Physics stayed 16/16. Owner **P1.I2**.
- Folder chips said **Waiting for Bridge** while the header was Offline and while it was Not connected with Bridge running. `mountStateLabel` ignores reachability. Owner **P1.I4**.
- Toggles match canon wording; consequence-on-a-real-file, mid-save kill, and Word↔Spectra roundtrip did not finish (no imported file). Word opened the valid fixture; not filed as native corruption.
- Focused Vitest 45 pass / 2 pre-existing I2 string-scans, not rewritten.
- Verdict: **REJECTED**. Evidence: `.shots/reformation/P1.V3/rerun/manifest.md`. I3/I4 stay IMPLEMENTED, not ACCEPTED. P1.I2 reopened for the scan hang.
