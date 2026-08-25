# P0 — Stop the Bleed & Build the Rails

**Goal:** the product stops actively corrupting/lying in the cheapest-to-fix places, Convex I/O is bounded, security quick wins land, and repo hygiene is restored. No architecture changes here — those are P1+. Everything in P0 is contained and reversible.

**Prerequisites:** none. I1, I2, I5, and I6 are the implementer scope for this run. I4, V1, and V2 are deferred; no implementation or journey sweep is claimed for them.

**Findings absorbed:** XLS-1, AI-10, PPT-4, ST-2 (dock title, fabricated conflict count), BR-5/CS-11 (trash-on-missing), CS-2 (minimal reaper), SEC-1 (binding fix), SBX-1, SEC-3, BR-8 (token holes), SEC-6, SEC-7 (report only), DS-4 (focus suppression), Part XXIII (all ten experiments), DS-6 worktree debris.

## P0.I1 — Contained critical fixes (M)

Each fix is small, root-cause-known, and lands with a relevant unit check (VERIFICATION anti-theater rule 1):

1. XLS-1: the `/\/worksheets\//i` unconditional PRESERVED claim in `xlsx-lens.ts:122` — scope it to the actual conditional-formatting side data; mounted workbooks must save again.
2. AI-10: remove both `.catch(console.warn)` swallows on AI materialization (`run/route.ts:10407-10425`); a failed materialize fails the operation visibly.
3. PPT-4: restore the speaker-notes refusal gate and its honest test; restore `touches:["slides"]` on addSlide (reverses the codified regression in `11bd601`).
4. ST-2: dock "Starting run" stuck-title regression; `Math.max(1,…)` fabricated conflict count; studio header hiding offline/error states.
5. Wire `assertPreservationKept` on the DOCX route (exists on office route only — DOC-2 backstop).
6. Trash-on-missing → `unavailable` (shared/sync-policy missing-resource decision; ARCHITECTURE-TRUTH §3). Auto-trash requires verified deletion.
7. Minimal sweeper cron: stranded `pending` replicas and abandoned claims get re-driven or failed truthfully (full compensation tables come in P1; this stops eternal "Saving…").
8. DOC-1 interim guard: until P2 unifies schemas, table blocks refuse the flattening path (honest strict-native refusal on table-region edits through the broken adapter) — corruption stops today, capability returns in P2.

## P0.I2 — Convex I/O P0 (M)

Per the I/O investigation: `spectraArtifacts.list` returns summary projections (no `content`/`protectedBaseContent`/`aiPreview`/`textIndex`); `listTabs` stops collecting messages/events (denormalized summary fields written at event time); `reconcileStaleRuns` gets `by_status_lease` index and reads only expired leases; planner/timetable reminder crons become `scheduler.runAt` per-item scheduling; Live Dock/run polling intervals rationalized (SSE cursor primary). Gate: idle-product and per-action budgets from ARCHITECTURE-PLATFORM §4 measured before/after; expect the ~34 GB/period pattern to drop by >70%.

## P0.I4 — Design-system baseline (M) — deferred

Skipped for this run by Pablo. No baseline migration or acceptance is claimed here.

## P0.I5 — Repo hygiene (S)

Delete `.tmp-n*` dirs (~11 GB), root `nul`, stale `validation-report.json`; gitignore `opencode*.json` (keep local); decide `ai-education-workspace-landing-page/` with Pablo; `.gitignore` audit.

## P0.I6 — Security quick wins (M)

CF DO room binding (claims.workId/roomId checked against routed room — even though path stays disabled); micropip egress closed; logout/account-switch storage sweep (Bridge token, caches, context store); Bridge pre-pairing empty-token length hole + Origin-only resume hardening; build endpoint bounds. Key rotation: **report only** — STATE §5 names the keys; Pablo rotates.

## P0.V1 — Falsification experiments (M) — deferred

Deferred for this run by Pablo. No experiment result is claimed.

## P0.V2 — Honest baseline journey (M) — deferred

Deferred for this run by Pablo. No journey result or baseline verdict is claimed.

## Exit gate

I1, I2, I5, and I6 have relevant unit evidence and then require paired verification. I4, V1, and V2 remain deferred. The entire repository sweep and Pablo's phase pass occur only after verification; P1 prerequisites must be updated when the deferred design baseline is scheduled.

## Implementer log — 2026-08-25

- Implemented P0.I1, P0.I2, P0.I5, and P0.I6; the automated test lane was removed; P0.I4/P0.V1/P0.V2 deferred per Pablo.
- I1 closes the Office preservation/materialization lies, truthful PPT refusals, dock state/title drift, missing-resource trashing, and DOCX table flattening path.
- I2 adds summary/denormalized reads, lease indexes, stale-Bridge sweeping, scheduled reminder delivery, and slower fallback polling.
- I5 removes validated scratch debris and ignores local `opencode*.json`; the landing prototype remains pending Pablo's decision.
- I6 binds collaboration rooms, closes micropip and Bridge token holes, clears account-scoped browser state, and bounds runtime builds; key rotation remains report-only.
- UI changes followed `/frontend-design` and `/design-taste-frontend` guidance, preserving the existing trust-first visual language.
- Relevant checks: Convex codegen; focused Vitest 7 files/100 tests; collaboration-room 11 tests; Rust core+chaos 35 tests; secret scan; diff check.
- Rust package-wide execution remains red only because `granted_tree` expects the removed `.tmp-n3-mount` fixture; no test was weakened or restored around cleanup.
- The architecture checker remains baseline-red on five pre-existing unregistered global events; this unit introduced no new event.
- Implementer status is `IMPLEMENTED`; no acceptance or verifier verdict is claimed. Full repository sweep waits for paired verification.
