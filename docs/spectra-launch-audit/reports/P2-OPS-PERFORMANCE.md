# P2 OPS-PERFORMANCE

Branch `p2/ops-performance` from main `0bb65e90`. The lens is an SRE on launch night with 50 schools onboarding: deploys should fail loudly at build time, and a missing dependency should degrade the product, not blank it.

## Commits

| Commit | Subject |
|---|---|
| b89f5922 | chore(spectra): delete dead usage tracking that called nonexistent Convex functions |
| 5a0651eb | fix(convex): break the authority/placement/durable-payload load-time cycle |
| 2b98c796 | fix(convex): register every module in api types and guard the module graph |
| d0d568cb | fix(managebac): bound open-conflict and projection reads for large classes |
| efc8ddcc | fix(collaboration): fail loudly instead of handing production clients ws://localhost |
| 36301b2d | chore(spectra): delete unused app-url helpers with a localhost fallback |
| d357408c | fix(deploy): fail Vercel production builds whose env falls back to development modes |
| d888acd8 | fix(spectra): pin the AI run route's function duration |
| 5ace4784 | fix(spectra): give server-rendered page failures the recovery screen |
| 76a4abd2 | fix(convex): scope school lifecycle impact counts to the school |
| 537663c2 | fix(convex): read a school's export through school indexes |
| 2e673496 | test(spectra): let the transport-only run route carry its maxDuration |

## Findings ledger

### Fixed

| Sev | Finding | Where | Evidence / guard |
|---|---|---|---|
| High | Cross-tenant full scans in the school lifecycle impact: every suspend, export, offboard or purge request read every tenant's `spectraArtifacts`, content included. Past about 16 MiB of artifacts platform-wide, operators could no longer suspend any school. | convex/administration.ts `lifecycleImpact` | convex/school-lifecycle-bounded.test.ts: 242 rows read before, 2 after |
| High | School export (the mandatory step before a purge) used `.filter(schoolId)` over six whole tables, including `externalRecords` and `memoryClaims`. | convex/administration.ts `buildLifecycleExport` | Same test file; it asserts the reads are index-bounded |
| High | A missing `NEXT_PUBLIC_SPECTRA_COLLAB_URL` handed every browser and every AI edit `ws://localhost:1234` (or `:8787`), and nothing in the logs named the cause. | src/lib/collaboration-token.ts `collaborationGatewayUrl`; token route; yjs-artifact-operation.ts | src/lib/__tests__/collaboration-gateway-url.test.ts |
| High | No deploy-time env validation. Several dev fallbacks applied silently in production: inline AI runs without `SPECTRA_APP_URL`, Clerk `pk_test_` keys, short or reused bridge secrets, a malformed master key, the shared `MANAGEBAC_API_KEY`, `SPECTRA_TEST_INLINE_RUNS`, and the Cloudflare realtime flag. | scripts/check-deploy-env.mjs, wired into `prebuild` | scripts/check-deploy-env.test.mjs |
| High | The AI run route had no `maxDuration`. It executes whole runs, including Convex `scheduled_run` callbacks, so without fluid compute Vercel would cut every run off at 15s (Pro) or 10s (Hobby). | src/app/api/spectra/run/route.ts | run-route.test.ts ("pins its function duration") |
| Med | Load-time import cycles authorityShared → artifactEmbedPlacement → authorityShared, and the one via collaborationDurablePayload. This is the "X is not a function" class of module-load failure. | New leaves convex/artifactEmbedPlacementEvidence.ts and convex/durablePayloadIntegrity.ts | convex/module-graph.test.ts (AST cycle guard) |
| Med | Stale `convex/_generated/api.d.ts` (modules missing), and string function refs that nothing checked. | api.d.ts regenerated | module-graph.test.ts checks the module list and that every `"module:fn"` ref (>300) resolves to a registered function, and to a public one when referenced outside convex/ |
| Med | Dead `src/lib/usage-tracking.ts` called three functions that do not exist. | deleted | module-graph ref guard |
| Med | ManageBac `syncRunOutcome` collected every open conflict, and personal `resolveConflict` read every projection of a class record. | convex/managebacProjectionJobs.ts, convex/managebac.ts | convex/managebac-bounded-reads.test.ts (240 classmates) |
| Med | Server-component render failures (Clerk or Convex down while a page loads) got Next's unstyled "Application error" page, because there was no `error.tsx`. | src/app/error.tsx; `ErrorScreen` extracted from GlobalErrorBoundary | global-error-boundary.test.tsx |
| Low | Unused `src/lib/app-url.ts` with a silent `http://localhost:3000` fallback. | deleted | none needed; it had no importers |

### Reported (not fixed: outside scope or owned elsewhere)

- **High — the gateway is a capacity and single-point-of-failure risk.**
  - deploy/collaboration-gateway/fly.toml runs one `shared-cpu-1x`/512 MB machine with `hard_limit = 200` connections.
  - Each open document opens its own socket (src/features/spectra/collaboration/hocuspocus-transport.ts:697 creates one `HocuspocusProviderWebsocket` per transport).
  - 50 schools will exceed 200 concurrent sockets. Rooms are in memory, so scaling out needs room-affinity routing.
  - The limit and VM size need a measured load test before launch.
- **High — `buildLifecycleExport` still loads a whole school in one query** (convex/administration.ts:2569).
  - It reads all artifacts plus all their versions, threads, audit events and external records.
  - A real school will exceed Convex's per-function read limit, so the export (and therefore purge) cannot complete.
  - It needs a paginated export.
  - `schoolGroupMembers` and `externalRecordOverlays` (administration.ts:2624 and :2724) have no school index and still scan their whole tables.
- **Med — ManageBac scheduled sync has no time budget or resumability.**
  - `runScheduledSync` (src/app/api/spectra/managebac/route.ts:1806) runs a whole paced sync in one request, and the route declares no `maxDuration`.
  - A Vercel kill leaves the 30-minute sync lease (convex/managebac.ts:45) held until it expires.
  - I left this with the ManageBac owner, per the coordination rules.
- **Med — ManageBac `configure` falls back to the env `MANAGEBAC_API_KEY`** when the typed token is blank (src/app/api/spectra/managebac/route.ts:1934 and :1995). The deploy check now fails production if the key is set; the fallback code itself belongs to the ManageBac/security owner.
- **Med — school-level `resolveConflict` patches every projection of the record inline** (convex/managebac.ts:3606, the `by_record_type` path). A resource shared with a large cohort approaches the per-mutation write limit.
- **Med — `agentGovernance` is a reactive admin query that collects every active artifact in the school** (with content) just to list agents (convex/administration.ts:60).
- **Low — the offboard executor still scans all `schoolIntegrations`** (convex/administration.ts:3678). The purge helpers filter `artifactAssets`/`artifactImportJobs` without an index and use `.take(40)` (administration.ts:3410), and main's security-privacy merge edits that region.
- **Low — full scans in `orgTreeIntegrity` operator tools** (convex/orgTreeIntegrity.ts:50, :250, :349). These are internal and on-demand.
- **Low — some external calls have no per-call timeout; they are bounded only by the run abort or the host limit:**
  - OpenRouter parallel search (src/features/spectra/sources/research/parallel-search.ts:23);
  - `postSigned` in convex/executionScheduler.ts (capped by the 10-minute Convex action limit);
  - nodemailer `verify()` in src/lib/invitations.ts:90.
- **Low — bundle:**
  - `@ariadng/office/zip` (not the parsers) is statically reachable from every app page via shared/parser-limits.ts ← src/features/spectra/code/model.ts.
  - The landing hero imports `three` as a namespace (src/app/landing/scene/heroState.ts:1) for math only. It should tree-shake; confirm with a bundle analyzer.
  - The Office parsers, charts, CodeMirror, pdfjs, pyodide and sql.js are not statically reachable from any page or layout.

### Rejected as not real

- Stray `console.log`: there are none in src/convex/shared production code. Logging goes through `StructuredLogger` or tagged `console.info`/`warn`.
- Cron idempotency: all 12 crons use index-bounded `take(n)` reads. `reconcileStaleRuns` recovers runs whose 2-minute heartbeat lease expired, so a killed run is marked interrupted within about 4 minutes.
- Gateway Docker package: scripts/collaboration-gateway-package.test.mjs passes. The gateway validates its secrets at boot, and flushes checkpoints on SIGTERM.
- `schoolDirectory` `schools.collect()` (administration.ts:2314): operator-only and bounded by the number of schools.

## Regenerating `convex/_generated/api.d.ts`

`npx convex codegen` needs deployment credentials, because component types come from the deployment. `--system-udfs` works offline but drops `components`. The api.d.ts on this branch was hand-regenerated to match the Convex entry-point rules, and module-graph.test.ts fails whenever a module is added without it.

At deploy time, run `npx convex codegen` (or `npx convex deploy`) against the target deployment and commit any diff. The guard test should then pass unchanged.

## Deploy checklist: Convex environment (not visible to the Vercel build)

- **Required:**
  - `CLERK_JWT_ISSUER_DOMAIN` (auth.config.ts throws without it);
  - `SPECTRA_APP_URL` (https; needed for scheduled AI runs and ManageBac dispatch);
  - `SPECTRA_COLLAB_BRIDGE_KEY`, `SPECTRA_CONNECTOR_BRIDGE_KEY`, `SPECTRA_SECRET_BRIDGE_KEY` (≥32 chars, identical to the Vercel values);
  - `SUPER_ADMIN_EMAILS`;
  - `OPENROUTER_API_KEY`.
- **Optional:** `SPECTRA_AGENT_EVAL_BRIDGE_KEY`.
- **Must be absent:** `SPECTRA_ALLOW_LOCAL_MANAGEBAC_FIXTURE`, `SPECTRA_LOCAL_SELF_HOSTED`.
- **Gateway host:** `NEXT_PUBLIC_CONVEX_URL` or `CONVEX_URL`, `SPECTRA_COLLAB_TOKEN_SECRET`, `SPECTRA_COLLAB_BRIDGE_KEY`.

## Needs live verification

1. **Deploy env check.** On a Vercel production build, confirm that `VERCEL_ENV` is exposed at build time and that `npm run check:deploy-env` passes with the real env. On a preview build, confirm it warns.
2. **Run route duration.** Check whether the Vercel project has fluid compute. Measure p95 run duration; if runs exceed 300s, raise `maxDuration` (up to 800 on fluid Pro).
3. **Scheduled runs.** Confirm a Convex-dispatched `scheduled_run` completes end-to-end, and that a run killed at the limit is marked interrupted by `reconcile-stale-spectra-runs`.
4. **Gateway capacity.** Run a classroom load test (`npm run collaboration:classroom-load`) against the Fly gateway to establish the real limit. Then set `hard_limit` and the VM size, and check the `kill_timeout` default (5s) against the checkpoint flush time on SIGTERM.
5. **Collaboration URL.** With `NEXT_PUBLIC_SPECTRA_COLLAB_URL` unset on a preview, the token route should return a 500 and log `COLLABORATION_GATEWAY_CONFIG_MISSING`.
6. **`src/app/error.tsx`.** With Clerk or Convex unreachable during SSR, the recovery screen should appear, and "Try again" should refetch.
7. **Lifecycle jobs.** Run `requestLifecycleJob` and the export on a production-sized dataset to observe the read volume of the remaining per-school residual.
8. **Codegen.** Run `npx convex codegen` against the deployment and confirm api.d.ts has no diff (the `components` block especially).

## Tests and gates

- **Focused tests:**
  - module-graph, school-lifecycle-bounded and managebac-bounded-reads;
  - the ManageBac suites: provider-projection, isolation, scheduling, retention and task-calendar;
  - artifact-embed-placement, collaboration-durable-payload, authority-shared and retained-pin-access;
  - run-route, agent-loop-extraction, global-error-boundary, collaboration-gateway-url, check-deploy-env and collaboration-gateway-package;
  - workers/collaboration.
- **Full run:** `vitest run --maxWorkers=3` gave 418 files passing and 1 failing (the agent-loop-extraction route line-count guard, fixed in 2e673496 and re-run green).
- **Typecheck:** `tsc --noEmit` is clean.
- **Lint:** eslint on touched files, `--max-warnings=0`.
- **Gates:** check:architecture, check:copy, check:design-tokens, check:capabilities, check:secrets and check:deploy-env all pass.
