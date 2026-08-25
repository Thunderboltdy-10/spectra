# P0 — Stop the Bleed & Build the Rails

**Goal:** the product stops actively corrupting/lying in the cheapest-to-fix places, the machine floor (CI) exists, the design-system baseline exists, and we establish an honest picture of what actually works. No architecture changes here — those are P1+. Everything in P0 is contained and reversible.

**Prerequisites:** none. Units are parallel-safe except I3 (CI) should land before the others close so their tests join the floor.

**Findings absorbed:** XLS-1, AI-10, PPT-4, ST-2 (dock title, fabricated conflict count), BR-5/CS-11 (trash-on-missing), CS-2 (minimal reaper), SEC-1 (binding fix), SBX-1, SEC-3, BR-8 (token holes), SEC-6, SEC-7 (report only), DS-4 (focus suppression), Part XXIII (all ten experiments), DS-6 worktree debris.

## P0.I1 — Contained critical fixes (M)

Each fix is small, root-cause-known, and lands with a test that failed before it (VERIFICATION anti-theater rule 1):

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

## P0.I3 — CI + mechanical gates (M)

GitHub Actions: typecheck, lint, `vitest run`, both fidelity harnesses (digests asserted, not recorded — retire circular readBack), secret scan. Harnesses join `npm test`. Evidence-path convention checks (a cited `.shots/reformation/**` dir must be non-empty). Branch protection on main. This unit is the R9 floor; every later unit's tests join it.

## P0.I4 — Design-system baseline (M)

ARCHITECTURE-PLATFORM §3: layering contract + Dialog primitive + composer demotion (220→composer-dock) + the six shell dialogs migrated; Input/Field with focus-visible restored (delete the global suppression at `spectra-app.css:4426`); Button adopted in shell chrome; ESLint arbitrary-value + hex + z-index rules at **warn**. Not a redesign — a floor for every later UI unit.

## P0.I5 — Repo hygiene (S)

Delete `.tmp-n*` dirs (~11 GB), root `nul`, stale `validation-report.json`; gitignore `opencode*.json` (keep local); decide `ai-education-workspace-landing-page/` with Pablo; `.gitignore` audit.

## P0.I6 — Security quick wins (M)

CF DO room binding (claims.workId/roomId checked against routed room — even though path stays disabled); micropip egress closed; logout/account-switch storage sweep (Bridge token, caches, context store); Bridge pre-pairing empty-token length hole + Origin-only resume hardening; build endpoint bounds. Key rotation: **report only** — STATE §5 names the keys; Pablo rotates.

## P0.V1 — Falsification experiments (M)

Run the compendium Part XXIII list (PNA/localhost fetch, sdt-table repro, slow-copy ingestion, subst drive swap, OneDrive online-only mount, revocation mid-write, pairing-tab theft, DO room probe, fflate determinism, 150 MB transfer). Each: result + implication recorded in STATE Field Notes. These convert HYPOTHESIS findings into facts before P1 designs against them.

## P0.V2 — Honest baseline journey (M)

A journey verifier (fresh agent, VERIFICATION L3) walks the current product with 6–8 goal cards spanning mount/edit/AI/collab/share and produces the baseline truth document: what works today, evidenced. This replaces Nova's void claims as the reference point for measuring the program.

## Exit gate

All I-units VERIFIED by their tests in CI + V1/V2 filed; Pablo pass done; no P0 fix regressed a Golden-Flow-level behavior (V2 confirms). P1 may start when I1/I3 are ACCEPTED (others may trail).
