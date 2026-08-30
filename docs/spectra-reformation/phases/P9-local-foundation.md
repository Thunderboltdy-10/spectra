# P9 — Local Foundation & Convex Efficiency

**Goal:** development and verification move to free, isolated, parallelizable **local Convex deployments**, and the five query classes burning the cloud dev deployment (~60 GB DB I/O overage, function-call cap hit) are fixed at the class level. The phase ends with two real accounts (platform operator + TGC school admin) living on a seeded local instance, the ManageBac key entered, Bridge re-paired, local folders re-imported — which is also the program's first honest onboarding dry-run.

**Prerequisites:** none. Wave 0. **Architecture:** ARCHITECTURE-PLATFORM (Convex rules, budgets §4); ARCHITECTURE-TRUTH for anything replica-adjacent. **Findings absorbed:** the 2026-08-30 Convex dashboard analysis (per-function I/O below); P0.I2's unfinished reminder migration.

**Difficulty (PROCESS §4):** I1 = MT / xhigh. I2, I3 = Hard / xhigh. I4 = MT / high. V1 = Hard / max.

**Boundary (binding):** P9.I3 does **not** touch `convex/replicas.ts` or `convex/bridgeSync.ts`; bridge-side efficiency (claim polling, sweeper batching, inline projection blobs) is owned by P10.I2 (EXPANSION §5).

## P9.I1 — Local deployment harness (MT)

Make `npm run dev:local` (or equivalent) bring up one complete isolated stack: local Convex backend (`convex dev` local deployment), Next.js dev server, and the collaboration gateway, with **instance parameterization** so N stacks coexist (instance id → port block → per-instance Convex data dir and env file). Deliverables:

- Scripts under `scripts/local/` + `package.json` entries; `.env.local.example` updated with every required var (`NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOYMENT`, Clerk keys + `CLERK_JWT_ISSUER_DOMAIN` into the local Convex env, `SPECTRA_APP_URL` for scheduler callbacks, `SPECTRA_COLLAB_*`, `SPECTRA_CONNECTOR_BRIDGE_KEY`, `SPECTRA_SECRET_BRIDGE_KEY`, `OPENROUTER_API_KEY`, optional `MANAGEBAC_*`).
- Bridge points at the instance via `SPECTRA_CONVEX_URL`; the hardcoded `proper-orca-653.convex.cloud` fallback in `bridge/bridge-app/src/main.rs` is replaced with a required env (fail closed with a plain message).
- `src/lib/boot-diagnostics.ts` accepts local URLs without false mismatch warnings.
- Runbook `docs/spectra-reformation/runbooks/LOCAL-DEPLOY.md`: start/stop/reset an instance, add an instance, where data lives, how a VU claims a `local-deploy-n` lease.
- Owns: `scripts/local/`, `package.json` scripts, `.env.local.example`, runbooks. Does not own: seeding (I4), any Convex function bodies.

### P9.I1 implementation log — 2026-08-30

- `dev:local` now starts one health-gated local Convex + Next.js + Hocuspocus stack; lifecycle commands add, inspect, stop, and explicitly reset an instance.
- Numeric instance ids map to deterministic 20-port blocks. Manifests freeze the mapping; tests prove three non-overlapping instances and the general N mapping.
- Every instance owns a gitignored env file and `project/.convex/local/default` database/object store. Convex bundles the repository functions through an instance-local project config with codegen disabled.
- Startup validates the required Clerk/model/bridge secrets, configures the official `convex dev` local deployment once, allowlist-syncs backend env, restarts it, and only then exposes web/collaboration health.
- `.env.local.example` documents managed URLs, required app/backend values, optional ManageBac, routing, email, worker, role, and observability values. P9.I4 seed logic is untouched.
- Bridge deployment selection now requires a valid `SPECTRA_CONVEX_URL`; neither the old `proper-orca-653` debug fallback nor journal memory can select a deployment.
- Boot diagnostics recognize `local:` selectors paired with loopback Convex URLs and still warn on cloud/local mismatches.
- Runbook: `runbooks/LOCAL-DEPLOY.md` covers N≥3, first configuration, lifecycle, storage, Bridge targeting, and orchestrator-owned `local-deploy-n` leases.
- Focused evidence: local harness + boot diagnostics 13/13; Bridge app tests 5/5; scoped ESLint, `tsc --noEmit`, capability ghost gate, secret scan, seam fidelity 13/13, rustfmt, and diff check pass.
- Required fidelity executions remain red on unchanged owned-by-other-unit code: DOCX stops at `DOCX_UNSUPPORTED_EDIT` in `docx-lens.ts`; Office fails its existing aggregate assertion. No lens/harness expectation was changed.
- No Convex function body, seed/bootstrap path, shared runtime, browser profile, Bridge process, Office process, or lease was used.

## P9.I2 — Convex efficiency: runs + reminders (H)

Fix the class, not the counter. Known offenders and their required shape:

- **`spectraRuns.reconcileStaleRuns`** (2-min cron, 6.08 GB): per stale run it `.collect()`s **all active artifacts and all workspaces of the owner** to find AI effects. Replace with targeted reads — index or denormalized backlink from run → touched artifact ids (the run already records operations); no per-owner table collects in a cron.
- **`plannerReminders.dispatchDue` / `timetableReminders.dispatchDue`** (1-min crons, 11.94 + 1.5 GB): global scans of up to 1,000 planner tasks / 5,000 timetable user-states per minute, full documents read. Complete the P0.I2 intent: **schedule-at-write** — compute next delivery at task/event/reminder mutation time via `ctx.scheduler.runAt`, store the handle, delete the polling scans. A small hourly safety sweep over a `nextReminderAt`-indexed window is the only residual scan permitted.
- **`spectraRuns.listTabs`** (5.1 GB; polled at 750 ms during active runs): returns full `spectraAiRuns` docs per tab. Denormalize the dock projection onto `spectraRunTabs` (or a summary field) so the query reads tabs + result card only; the client keeps its polling contract.

Deliverables include red→green tests against the pre-fix behavior where testable, and a measured before/after I/O note in the unit log. Owns: `convex/spectraRuns.ts` (reconcile + listTabs), `convex/plannerReminders.ts`, `convex/timetableReminders.ts`, related schema/index additions, `convex/crons.ts` rows for these jobs.

## P9.I3 — Convex efficiency: library + collaboration (H)

- **`spectraArtifacts.list`** (12.5 GB, top offender): reads up to `limit*3` **full** artifact documents (`content`, `textIndex`, `protectedBaseContent`, `aiPreview`) then strips fields in `summaryArtifact`. Introduce a summary read path that never loads heavy fields — denormalized summary columns maintained at write time (or a projection table), plus removal of the per-call `ownedWorkspaces.collect()` → `placementsByWorkspaceScan` orgNodes collects and the per-artifact `shareInvitations.collect()` N+1 (batch or denormalize share presence).
- **`collaboration.ensureRoom`** (1.97 GB): schema-upgrade path `.collect()`s all Yjs updates + snapshots for the room. Paginate/compact; never full-history reads on studio mount.
- **`orgTree.listContainers` / `listChildren` / `orgTreeBoard.column`** (4.35 GB combined): `hydrateNodes` with `withChildCounts` collects **all children per container**. Denormalize `childCount` on `orgNodes` (maintained by place/move/trash mutations); trim board hydration to indexed reads.

Same evidence discipline as I2. Owns: `convex/spectraArtifacts.ts` (list path + summary maintenance), `convex/collaboration.ts` (ensureRoom), `convex/orgTree.ts`, `convex/orgTreeShared.ts`, `convex/orgTreeViews.ts`, `convex/orgTreeBoard.ts`, related schema/indexes.

## P9.I4 — Seed, roles, and first-run bootstrap (MT)

A deterministic seed for a fresh local instance plus the Pablo checklist that finishes it:

- Seed script: platform-operator email registered in the local Convex env `SUPER_ADMIN_EMAILS` (Pablo's secondary account — the one without compatible ManageBac classes, per his 2026-08-30 direction); The Global College school created through the real onboarding saga (`schools` → `schoolOnboardingSagas` → `membershipInvitations`), **not** raw inserts, so the saga itself is exercised; `school_admin` invitation issued for account A.
- Checklist runbook `docs/spectra-reformation/runbooks/LOCAL-BOOTSTRAP.md` for the Pablo-in-loop legs (queued in QUESTIONS, non-blocking): both sign-ins, accept invitation, enter ManageBac API key at `/managebac`, resolve identity + bootstrap sync, re-pair Bridge to the local instance, re-mount and re-import the local folders.
- Everything scripted that can be scripted; everything human is one checklist with expected screens named — this doubles as onboarding evidence for P15.

Owns: `scripts/local/seed*`, runbooks. Does not own: onboarding UX changes (P15.I1).

## P9.V1 — Foundation verification (H)

Fresh agent, first VU on a `local-deploy` lease:

- **Two-account journey (L3):** operator surfaces (superadmin shell, operator school session into TGC), admin surfaces (school admin shell, ManageBac configure/sync, member management), member basics — sequences, not moments (R11).
- **Budget cards (L4):** measured function-call counts and DB read volumes for: workspace first paint, Library open, studio open, one AI run, ten idle minutes (crons). Record the numbers in the manifest as the standing baselines every later VU re-checks. The reminder crons must show near-zero idle reads after I2.
- **Bridge on local:** pair, mount an isolated fixture folder, discover, edit, Keep-in-Spectra — against the local instance.
- **Reminder correctness:** a due planner reminder and a timetable reminder actually deliver post-migration (schedule-at-write, no minute-scan).

## Exit gate

N≥3 instances documented and startable; both accounts live on the seeded instance with ManageBac connected and folders imported; the five efficiency classes fixed with measured before/after evidence; budget baselines recorded; V1 PASS. From this gate onward **every VU in the program runs on a local instance (CANON R23)** and the cloud dev deployment is retired for testing.

## P9.I3 unit log — 2026-08-30

- Status: IMPLEMENTED; no acceptance or P9.V1 verdict claimed.
- SYSTEMIC triage: payload-bearing Library rows, mount-time full-history deletion, and query-time derived tree metadata were the three root classes.
- Added `spectraArtifactSummaries`, an explicit hard-bounded projection; Library list/search now reads it only, batches grants/invitations/placements, and never loads artifact content, text indexes, protected bases, or preview content. Batched access preserves direct-grant and deny-override semantics.
- Write seams in `spectraArtifacts` and `orgTreeShared` maintain summaries; cursor backfill covers existing rows. Board/tree source hydration uses the indexed projection.
- Fixture measurement: source artifact >100 KB; summary row <10 KB and <10% of source. P9.V1 owns deployed L4 numbers.
- `ensureRoom` now atomically rotates to a fresh schema generation; retired updates/snapshots are deleted asynchronously in pages of 128, never on studio mount.
- `orgNodes.childCount` is transactionally maintained across create/place/move/trash/restore/purge; cursor backfill covers old containers. Hydration is a field read, not a child collect.
- Anti-theater: the P9 test failed when protected-base payload was injected and again when oversized metadata lacked hard limits; both mutations are reverted and the assertions are green.
- Focused Convex: 4 files / 45 tests passed (P9, checkpoint, AI lifecycle, replica blast radius).
- Standing gate: root `tsc --noEmit`, scoped ESLint, `check:capabilities`, secret scan (2,328 tracked files after rebase), and `git diff --check` passed.
- No fidelity harness required: no lens, Bridge, replica, bridgeSync, or `shared/` path changed.
- Merge coordination: P9.I2's `spectraRuns` and the concurrently owned ManageBac writer must call exported summary sync after their artifact patches; route as product-logic integration, not a P9.I3 ownership violation.
