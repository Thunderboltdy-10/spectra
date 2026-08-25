# P0 — Stop the Bleed & Build the Rails

**Goal:** the product stops actively corrupting/lying in the cheapest-to-fix places, Convex I/O is bounded, security quick wins land, repo hygiene is restored, the design-system baseline exists, and we establish an honest picture of what actually works. No architecture changes here — those are P1+. Everything in P0 is contained and reversible.

**Prerequisites:** none. Units are parallel-safe.

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

All I-units are verified by their owning checks plus V1/V2 filed; Pablo's pass is required; no P0 fix may regress a Golden-Flow-level behavior. P1 may start when I1/I2 are ACCEPTED; other units may trail.

## Implementer log — 2026-08-25

- Implemented P0.I1, P0.I2, P0.I5, and P0.I6; the automated test lane was removed.
- I1 closes the Office preservation/materialization lies, truthful PPT refusals, dock state/title drift, missing-resource trashing, and DOCX table flattening path.
- I2 adds summary/denormalized reads, lease indexes, stale-Bridge sweeping, scheduled reminder delivery, and slower fallback polling.
- I5 removes validated scratch debris and ignores local `opencode*.json`; the landing prototype remains pending Pablo's decision.
- I6 binds collaboration rooms, closes micropip and Bridge token holes, clears account-scoped browser state, and bounds runtime builds; key rotation remains report-only.
- UI changes followed `/frontend-design` and `/design-taste-frontend` guidance, preserving the existing trust-first visual language.
- Relevant checks: Convex codegen; focused Vitest 7 files/100 tests; collaboration-room 11 tests; Rust core+chaos 35 tests; secret scan; diff check.
- Rust package-wide execution remains red only because `granted_tree` expects the removed `.tmp-n3-mount` fixture; no test was weakened or restored around cleanup.
- The architecture checker remains baseline-red on five pre-existing unregistered global events; this unit introduced no new event.
- Implementer status is `IMPLEMENTED`; no acceptance or verifier verdict is claimed. Full repository sweep waits for paired verification.

## Implementer log — P0.I4 (2026-08-25)

- Built the layering contract: seven tokens (`base < chrome < dropdown < panel < modal < composer-dock < toast`) in `spectra-tokens.css` + `@theme` wiring (`z-modal` & co. exist), mirrored in `src/components/ui/layers.ts`.
- Dialog primitive (`ui/dialog.tsx`): one overlay, one focus trap, `layer` prop, labelled close button (DS-4); SelectField/DropdownMenuContent/SelectContent take an optional `layer` so dialogs can float their picklists at `modal`.
- Composer demoted: `WorkbenchLiveStack`/`WorkbenchDockShell` no longer take numeric z-index; the dock is `composer-dock`. Call sites (shell 220, agent-library 220 ×3, global workbench 40) share the layer — the 220-vs-40 disagreement is gone.
- Six shell dialogs migrated to the primitive: pending-create picker, workspace-delete (type-to-confirm kept), workspace-edit, artifact-delete — extracted to `components/shell-dialogs.tsx`, tested directly; `ShareDialog` (was z-400) and `ViewportContextPicker` (was z-130, keeps its near-transparent capture veil at composer-dock).
- DS-4 root fix: deleted the global `input/textarea/select :focus-visible { outline:none !important }` suppression and its dead `data-search-input` sibling; `Input`/`Textarea` carry the restored 2px ring; new `Field` primitive wires label/description/error; per-component rings (e.g. `.foundry-input`) now actually render.
- Button adopted in shell chrome (People, Select-objects toggle, inspector danger, workspace-create actions); dialogs' actions use Button variants; `smallButtonClass`/`menuItemClass` deleted.
- Chrome re-layered: dropdown-menu/select (340→dropdown), tooltip (1000→toast, shadow token), guided-tour (120→composer-dock), app-shell (panel/chrome), cookie consent (chrome + modal detail), route-side-panel-host (panel).
- ESLint: `scripts/eslint/spectra-design-rules.mjs` — arbitrary-value/literal-colour, raw-hex, numeric-z rules at **warn** in features, **error** in `src/components/ui` (floor pure from birth); calibrated to the token idiom (color-mix over var()s, var() references, keyword radii pass). `npm run lint:design` = the 2,060-escape census, top-offender-first, non-failing.
- `check-design-tokens`: repaired the drifted globals.css `:root` check (canonical root lives in `spectra-app.css`), added failing checks for the seven layers plus the DS-4 suppression staying deleted; cleared all 25 pre-existing sub-11px failures (TSX → `text-micro`, CSS → `var(--text-micro)`). Gate passes for the first time (16 non-failing hex warnings remain as burn-down list).
- Tests written with the code: 26 in `design-layers` + `design-primitives.component` + `design-eslint-rules`; neighbouring suites (workbar, settings, sheets ×2, live-dock, workbench) still pass.
- Deliberate visual convergences to tokens (radius-controls 8–10px→8px, dialog radius→surface, title sizes→heading, hand shadows→shadow-lg, danger buttons→destructive variant) — judgment calls, flag anything that reads wrong.
- Field notes recorded: 5 pre-existing tsc errors (I1/I2 area), lint's pre-existing zero-warning breach + new warn census, check:copy's pre-existing crash, opencode*.json key handling (excluded from commit).
- Status: IMPLEMENTED. No acceptance claimed; awaiting paired verification. Full repository sweep deferred per program rules.

## Verifier log — P0.V1 (2026-08-25)

- Attempted all ten Part XXIII experiments from a fresh verifier session; evidence: `.shots/reformation/P0.V1/2026-08-25-runtime-experiments.md` and the live same-tab Chrome baseline.
- PNA/HTTPS-to-loopback was inconclusive because the Chrome evaluation sandbox blocked page `fetch`; Bridge was absent at the start and the isolated responder was stopped.
- Hostile SDT-wrapped DOCX confirmed DOC-5 topology/region-index drift; the route table guard passed but direct lens materialization still wrote.
- The stable-byte kernel passed slow-write tests, but production `bridge-app` does not call `StabilityTracker`; BR-3 is a SYSTEMIC runtime-wiring finding.
- `subst` preserved file access but changed the path-derived mount key; BR-4/CS-11 identity/adoption risk is SYSTEMIC, with cloud delete deliberately unrun.
- OneDrive metadata was read-only (329,790 files); live rescan was not run against real user files, leaving BR-5 open.
- Six pairing offers overwrite one pending core slot (WC-1); revocation was not run because it is destructive and has no product UI caller.
- DO route and persisted-room mismatches both returned 403; SEC-1 passed the isolated boundary probe.
- Equivalent Spectra packages differed after 1.1s (PKG-1 SYSTEMIC); 150MB payloads were rejected before network at the 100MB guard, while BR-6 whole-pass behavior remains open.
- Relevant checks: DOCX 13/13; realtime 11/11; DO probe 2/2; Rust watcher 9/9, server 5/5, sync 2/2.
- Verdict: **REJECTED** — confirmed systemic findings plus unsafe/inconclusive field probes; no product code or tests were patched or weakened.

## Verifier log — P0.V2 (2026-08-25)

- Ran seven goal cards in the existing signed-in Chrome tab, ending back at `/chat`; numbered same-tab evidence and narrative: `.shots/reformation/P0.V2/manifest.md`.
- Chat context selection, streaming, browse/open, comments entry, and studio sharing worked on the exercised paths.
- The controlled DOCX edit appeared and settled visually, but the marker disappeared after close/reopen with no unsaved warning.
- Library artifact `Share…` silently closed while studio `Share work` opened; these are divergent user-facing outcomes.
- Bridge offline state was visible, but `0 of 1`, engine policy terms, and `Failed to fetch` made recovery and mount truth unclear.
- Live Dock exposed raw internal failure tokens and retained a prior conversation title beside a new document focus.
- Focused checks: 5 Vitest files, 56 tests passed; no product code or tests were changed.
- Findings are SYSTEMIC: persistence/status compensation, plain-word failure surfaces, pairing recovery, offline counts, sync-policy humanization, share-entry consistency, and AI target legibility.
- Verdict: **REJECTED**. Full repository sweep remains deferred until paired verification; no acceptance claim is made.
