# P2 SCALE: findings ledger

Branch `p2/scale`, cut from main `3aa01f19`. The scenario is 50 schools of about 1,000 students each onboarding in the same week. Other Phase 2 agents reported these launch-scale findings but did not fix them.

Every behaviour fix below has a test that fails on the old code and passes on the new code. Before committing, each test was run against the previous version of the changed file, restored from `HEAD` and put back afterwards (no stash).

## Commits

| Commit | Subject |
| --- | --- |
| `9eefabd1` | fix(lifecycle): export a school in resumable bounded parts |
| `a519ec66` | fix(lifecycle): let a school purge finish at platform scale |
| `18462959` | fix(administration): read shared agents by id in agent governance |
| `b73e8910` | fix(spectra): answer signed-out Stop and Undo with their status and plain copy |
| `08d0e3a3` | fix(managebac): bound a sync by its request and release the lease on time |
| `052dcf68` | fix(managebac): read the env ManageBac key only on a local stack |
| `44a440f8` | fix(managebac): resolve a school-wide conflict in scheduled batches |
| `28cbd482` | fix(outbound): bound Parallel search, scheduled callbacks and SMTP delivery |
| `9dd2f7ed` | fix(gateway): size the single Fly machine for launch and forbid a second |

## Fixed

### 1. A school export could not finish for a real school (high)

**Files:** `convex/administration.ts` (the export and lifecycle functions only), `convex/schema.ts`, `src/features/spectra/pages/superadmin-shell.tsx`.

**Problem.** `buildLifecycleExport` read every row of the school in one action and built one JSON blob. That included every artifact with its versions, every thread with its messages, and every membership, invitation and audit event. A 1,000-student school exceeds an action's memory and time long before the end. Two tables had no school index, so they were scanned platform-wide: `schoolGroupMembers` and `externalRecordOverlays`.

**Fix.** Export format v2 is written as bounded parts under a lease:
- `exportPage` reads one section page. Pages are capped at 2 MB or 2,000 rows, and nested children (artifact versions, thread messages, org nodes) are read under their parents.
- `processLifecycleExports` holds a 6-minute lease and runs for at most 4 minutes. It writes parts of up to 4 MB to storage (`schoolExportParts`), and after each part it reschedules itself through `commitLifecycleExportPart`.
- If a worker dies, a later worker takes over the expired lease and continues from the stored position. After 5 takeovers the job fails.
- The manifest lists sections, parts, consistency and exclusions. The page shows the manifest and part links.
- A failed or cancelled export deletes its parts in batches.

The export includes everything v1 exported (invitation `tokenHash` stays excluded). New indexes:
- `schoolGroupMembers.by_school`
- `externalRecordOverlays.by_school`
- `artifactAssets.by_school`

`lifecycleImpact` now counts artifacts with a byte budget and reports `N+` (`artifactsAtLeast`) instead of reading every body.

**Tests:** `convex/school-lifecycle-bounded.test.ts`
- The page bounds and index use are asserted through the read ledger.
- After a takeover, the union of all parts equals the v1 row set exactly.

### 2. A school purge could not finish at platform scale (high)

**Files:** `convex/administration.ts` (purge and lifecycle functions).

**Problem.** Tables without a school index were purged with `.filter(schoolId)`. Each batch therefore rescanned the whole platform table from the start. The purge also advanced one batch per cron tick. The integration reads during offboarding, purge holds and cancellation scanned `schoolIntegrations`.

**Fix.**
- `PURGE_SCHOOL_INDEXES` names the school index for each table in `PURGE_SCHOOL_TABLES`. Indexed tables delete 75 rows per batch through that index.
- Tables without a school index are walked once with a stored cursor, 200 rows or 4 MB per page.
- `advanceSchoolPurge` chains itself instead of waiting for the cron.
- Storage objects are found through `by_school` and `by_school_created`.
- `processLifecycleJobs` selects by job type, and the integration reads use `by_school_provider`.

**Tests:** `convex/school-purge-scale.test.ts`
- The index map matches the schema.
- The school stage runs with no post-index filter.
- A purge of 30 rows beside a 450-row tenant completes through the chain, and the other tenant keeps every row.

### 3. Agent governance read every artifact body in the school (medium)

**File:** `convex/administration.ts` `agentGovernance`.

**Problem.** To find the few shared agents, the query collected every active artifact in the school, content included. **Fix.** It reads the agent grants, gets each visible agent by id, and reads that agent's own aggregates through per-agent indexes. The output is unchanged.

**Tests:** `convex/agent-governance-bounded.test.ts`: 300 essays of 8 KB are never read.

**Test contract change:** the governance witness case in `scripts/s10-platform-school-regression.test.ts` was removed. It asserted the old full-artifact read.

### 4. A signed-out Stop answered 500, and toasts printed raw bodies (medium)

**Files:**
- `src/app/api/spectra/run/runtime.ts`: the `requireActor()` call, and in the revert path the run read and the plan mutation;
- `src/lib/route-handler.ts`: `errorStatus`;
- `src/features/spectra/data/request.ts`: `spectraFailureMessage`;
- `src/features/spectra/ai/use-spectra-run.ts`: run start, steering stop, redirect, Undo and Stop.

**Problem.** `requireActor()` threw outside any handler, so Stop from a lapsed session answered 500 and the toast said the run could not be stopped. Undo had the same problem when Convex rejected its read or its plan. Every toast printed `response.text()`, which could be a gateway's HTML page.

**Fix.**
- These rejections map through the shared status table: 401 when signed out, 403 when there is no school or no access. The body is the plain `publicError` sentence.
- Client calls go through `requestSpectra`, so an unreachable server reads as a connection problem.
- `spectraFailureMessage` chooses the toast:
  - a 401 becomes "Sign in again to stop this run." (or to undo, redirect or run);
  - a short plain-text 4xx from the route is shown as written;
  - anything else (5xx, HTML, a JSON envelope) uses the caller's own copy.

**Tests:**
- `run-route.test.ts`: Stop signed out → 401, Stop with no school → 403, and Undo when Convex rejects the read or the plan → 401. No `AUTH_` code, request id or stack appears in the body.
- `data-api-connection-copy.test.ts`: the helper's wording.

### 5. A ManageBac sync killed mid-request held its lease for 30 minutes (medium)

**Files:** `src/app/api/spectra/managebac/route.ts` (`maxDuration`, `runSync`), `convex/managebac.ts` (`SYNC_LEASE_MS`, `claimScheduledSync`), `managebac-integration-shell.tsx`.

**Problem.** The route pinned no duration, and the sync paged the provider with no time check. When the platform killed the request, its catch never ran. The lease, 30 minutes and renewed on every page, blocked every Sync press with `INTEGRATION_SYNC_BUSY`. The scheduled run also got no near retry.

**Fix.**
- `maxDuration = 300`.
- The sync stops asking for pages after 240 s and throws `INTEGRATION_SYNC_TIME_BUDGET`. That error ends the whole sync, as a rate limit does, instead of quarantining one route. The existing failure path records a partial run, drops the lease and schedules the backoff retry.
- A lease now lasts 6 minutes (the request limit plus one page gap) and is still renewed per page. The scheduled claim uses the same constant.

**Tests:**
- `src/app/api/spectra/managebac/__tests__/sync-budget.test.ts`: an endless provider stops after 4 pages, and `failSync` carries the lease and the budget code.
- `convex/managebac-isolation.test.ts`: a killed request's sync stops blocking a new one after 7 minutes.

### 6. A blank ManageBac form connected a deployed school with the shared env key (medium)

**File:** `src/app/api/spectra/managebac/route.ts`: `localDevelopmentManageBacKey`, used by GET `envTokenAvailable` and by `configure`.

**Problem.** With no integration and a blank key field, `configure` stored `MANAGEBAC_API_KEY` as the school's secret. The deploy check fails a production build that sets the variable, but a preview deployment only warned.

**Fix.** The key is read only when `NODE_ENV` is not production, or when `SPECTRA_APP_URL` is a localhost stack. A deployment answers `INTEGRATION_TOKEN_REQUIRED`.

**Tests:** `src/app/api/spectra/managebac/__tests__/env-token.test.ts` covers the deployed case plus the dev-server and local-production-build cases.

### 7. A school-wide ManageBac conflict resolved in one transaction (medium)

**Files:** `convex/managebac.ts` (`resolveConflict`, `resolveConflictProjections`), `convex/managebacProjectionJobs.ts` (work accounting exported), `convex/schema.ts` (`projectionResolution` widened).

**Problem.** An administrator's conflict (one with no `accountId`) collected every projection of the record, then patched and refreshed each one in the resolving mutation. A record shared with a school has one projection per member.

**Fix.**
- Up to 64 projections, the inline path is unchanged.
- Beyond 64, the conflict is marked with its accepted resolution, and one unit of provider work is counted. `resolveConflictProjections` then pages 64 at a time using the same per-projection helpers.
- For rebase and keep_overlay, the existing planner fanout starts after the last page.
- The conflict resolves through `settleProviderWork` once every unit settles.
- If a projection cannot be rebased, the work settles as failed and the conflict stays open.
- A second resolution while one is pending is refused.

**Tests:** in `convex/managebac-bounded-reads.test.ts`, a 241-projection conflict reads at most 65 projections in the request, then resolves. A second resolution while pending is refused.

### 8. Three outbound calls had no deadline of their own (low)

**Files:**
- `src/features/spectra/sources/research/parallel-search.ts`: 60 s per call. A Stop still rejects with the run's reason.
- `convex/executionScheduler.ts` `postSigned`: 330 s, which is the routes' 300 s plus margin, well under the 10-minute action limit.
- `src/lib/invitations.ts`: SMTP connect 10 s, greeting 10 s, socket 20 s. Only the transport options changed; the logging near line 118 was not touched.

**Tests:**
- `action-protocol.test.ts`
- `convex/execution-scheduler-timeout.test.ts`
- `src/lib/__tests__/invitation-smtp-timeouts.test.ts`

### 9. Gateway capacity and a second-machine hazard (high)

**Files:** `deploy/collaboration-gateway/fly.toml`, `scripts/collaboration-gateway-package.test.mjs`.

**Problem.**
- The gateway ran as one `shared-cpu-1x` / 512 MB machine with `hard_limit = 200`. Each open collaborative artifact is one WebSocket per tab, so a few classes working at once hit the limit.
- The documented `fly deploy` did not pass `--ha=false`, so a new app got two machines. Rooms live in one process's memory, so two machines would each accept writes for the same room.

**Fix.**
- One `performance-1x` machine with 2 GB, and `NODE_OPTIONS=--max-old-space-size=1536`.
- `hard_limit = 1000` and `soft_limit = 800`, both marked provisional.
- `--ha=false` added to the deploy command, and "scale up, never out" documented.

**Tests:** the package test pins the single-machine flags (Fly and Railway), the VM floor, a heap limit inside the VM, and soft below hard.

## Reported, not fixed

- **Multiplexing all of a tab's documents over one WebSocket** (`scripts/collaboration-gateway.mjs`). Not safe with the current gateway, for three reasons:
  - `pendingMessageReleases` and `acceptedDocumentMessages` (`:119`–`:120`, `:168`–`:208`, `:1088`) are FIFO queues keyed by socket id, so documents sharing a socket would release each other's entries.
  - Every rejection closes the whole socket: `webSocket.close` with 4409, 4403 or 1013 at `:114`, `:441`, `:456`, `:968` and `:1550`. One document's revoked access or durable rejection would therefore drop every document in the tab.
  - The client's auth refresh, replica rebuild, retry and `onDisconnect` handling are all per socket.

  It needs per-document queues and per-document close frames first. The gain is modest: one fewer transport per extra open artifact. `maxPendingDocuments: 4` (`:900`) already bounds the authentication fan-in.
- **Horizontal scaling of the gateway.** Rooms (live and canonical Y.Doc, write queues, `openDocuments`) are in-process state. A second machine needs room affinity: the room in the WebSocket URL, plus `fly-replay` to the owning machine by consistent hash. It also needs a handoff when machines change. Until then, the gateway scales up only.
- **Checkpoint flush on shutdown.** The gateway flushes checkpoint schedulers on SIGTERM (`collaboration-gateway.mjs:1580`). The supervisor kills the child after 3 s (`collaboration-gateway-process.mjs:45`), and Fly's `kill_timeout` defaults to 5 s. Appends are durable before acknowledgement, so this is not data loss; a cut-off flush only makes the next recovery replay more updates. `kill_timeout` was not raised without measuring the flush time.
- **A sync longer than one request never completes** (`route.ts` `runSync`). After the budget exit, the retry restarts from the first page. Resuming needs the seen-key sets for reconciliation persisted across requests. `cursorState` is written but never read. A school whose full sync needs more than 240 s of provider time keeps retrying partially. Pages already committed are kept, and later routes can be starved. Each retry marks the school's sources `temporarily_unavailable` through the existing `failSync` path (`convex/managebac.ts` `failSync`).
- **The operator platform overview reads every account** (`convex/administration.ts:2013`–`2020`, `platformOverview`). It collects all active accounts and all accounts active in the last 30 days, only to count them. At 50,000 accounts this passes Convex's per-function read limits, and the dashboard fails. Exact counts need a maintained aggregate on accounts by status and last-seen. That touches every account write path, including the account-erasure path owned by the account-lifecycle agent, so it is left to be coordinated.
- **`orgTreeIntegrity` operator tools** (`convex/orgTreeIntegrity.ts`: `verify` `:47`, `restampContexts` `:247`, `backfillBoardFacets` `:280`, `placeOrphanWorkspaces` `:346`). These are platform-wide scans, left in place as instructed. They are one-off repair tools run by an operator, and at launch scale they must be paginated or run per school before use.
- **Export consistency.** v2 pages are read over time, not as one snapshot. The manifest says so (`consistency`). A school still in use during export can show a row in one section and its child missing from another.
- **`lifecycleExportUrl`** (`administration.ts:3464`) collects every part row for a job. Part rows are small, but their count grows with school size (about one part per 4 MB).
- **Per-agent governance reads** (`administration.ts:100`–`112`) still collect each visible agent's feedback, evaluations and releases. They grow with one popular agent's history, not with the school.
- **Purge walk and hold.** Tables walked without a school index are passed once, which relies on the purge hold stopping new school rows. Queued purges beyond the 20 read per tick get their hold one tick later.

## Needs live verification

1. Run `npm run collaboration:classroom-load` against the resized Fly machine. Set `hard_limit` and `soft_limit` from the measured connections and heap at the point where edit latency degrades.
2. Deploy with `--ha=false` and confirm `fly status` shows exactly one machine.
3. Time the SIGTERM checkpoint flush with many open rooms. Raise both the supervisor's 3 s and Fly's `kill_timeout` if the flush needs longer.
4. Run a real ManageBac scheduled sync for a large school. Confirm a budget exit records a partial run, frees Sync within seconds, and retries.
5. Run a school export and a purge on a staging school of realistic size. Check part sizes, the action's wall time per chain step, and that the parts download.
6. Confirm the Vercel preview has no `MANAGEBAC_API_KEY` shortcut in the ManageBac admin form.
7. In a browser, Stop from an expired session: expect "Sign in again to stop this run."

## Tests and checks run

- Each fix ran its focused vitest files. Each new test also ran against the file's previous version, where it failed, then against the fix, where it passed.
- Full suite, run once on `9dd2f7ed`: 436 files passed, 1 failed, 1 skipped (3,997 tests passed, 3 failed, 1 skipped). The 3 failures are all in `src/features/spectra/__tests__/ai-live-write-admission.test.ts`. They come from the base commit: at `3aa01f19` that test's `@/lib/collaboration-token` mock has no `collaborationGatewayUrl`, and main has since added it. No file on this branch is in that test's import graph.
- `tsc --noEmit`: clean.
- `eslint --max-warnings=0` on every changed file: clean.
- `check:architecture`, `check:copy`, `check:design-tokens`, `check:capabilities`, `check:secrets`: all pass.

## Shared files touched

- `convex/schema.ts`: the export tables and indexes, and the `projectionResolution` union.
- `convex/administration.ts`: the export, lifecycle, purge and `agentGovernance` hunks only.
- `src/lib/route-handler.ts`: an added `errorStatus` export.
- `src/lib/invitations.ts`: transport options only.
- `src/features/spectra/ai/use-spectra-run.ts` and `src/app/api/spectra/run/runtime.ts`: Stop, Undo and run-start error paths.
- `convex/managebac.ts`, `convex/managebacProjectionJobs.ts`, `src/app/api/spectra/managebac/route.ts`.
- `src/features/spectra/__tests__/run-route.test.ts`: new cases only.
