# S10 PLATFORM — stable integration checkpoint

2026-09-24. Primary checkout, inherited dirty baseline preserved. **Calendar/scheduling fixes and the compact analytics extension are implemented and tested.** The coordinator captured the first checkpoint, released the backend source freeze, and PLATFORM then completed the approved analytics extension. The coordinator is now running the integrated root TypeScript check with this extension; PLATFORM product files are held stable for initial integration/build. The newer schema/reader/trigger/UI work still needs coordinated publication and live verification. School/page implementation is postponed until initial integration and live verification of the current units; the remaining gaps below are not launch-green.

## Permissions and ownership

Initial effective context was workspace-write/restricted network; approval became never. Coordinator messages initially failed with “MCP tool call requires approval, but approval policy is never.” After the coordinator explicitly selected Full Access in this task's UI, the messaging tool succeeded. At that point, the visible developer environment still described workspace-write/restricted network/approval never, so danger-full-access was not yet confirmed. No alternative transport was used. Coordinator, DATA, PERF, LIBRARY and RELEASE received substantive checkpoints through the normal task tool.

Subsequent environment update on 2026-09-24 explicitly confirms **danger-full-access, network enabled, approval never**. Full Access is now verified from the effective context. This supersedes the earlier permission limitation. The coordinator subsequently released the source freeze while retaining exclusive runtime/publication ownership. LIBRARY confirmed no School client/path claims or overlap, permitting PLATFORM ownership in the next implementation segment.

Changed paths:

- `convex/calendarReadModels.ts`, `convex/calendar.ts`, `convex/calendar-bounded.test.ts`.
- `convex/managebac.ts` — only `scheduleExisting`; new `convex/managebac-scheduling.test.ts`.
- `convex/schools.ts` — only `cancelOnboarding`; new `convex/schools-bounded.test.ts`.
- `convex/analytics.ts`; new `convex/analytics-bounded.test.ts`.
- New `convex/analyticsReadModels.ts`; `convex/schema.ts` only the artifact-summary creation index and new compact run-summary table; `convex/orgNodeMutation.ts` only analytics-run maintenance and the thread-title no-op guard. DATA transferred these hunks; AI and DATA-REVIEW coordination found no overlap.
- `src/features/spectra/pages/analytics-shell.tsx` preparing-state correction; `src/features/spectra/administration/metric-registry.ts` compact-source labels. Coordinator explicitly approved these paths.
- This report. `convex/crons.ts` was inspected and is unchanged. The first checkpoint contained nine TypeScript paths; the extension adds five. Inherited/concurrent changes in shared files belong to their original owners. The analytics tests use PERF-owned `scripts/perf-read-ledger.ts`.

No stage/commit/reset/stash/branch switch, deployment, runtime restart, full build/typecheck, native/browser mutation, real school write, identity change or provider request was performed by PLATFORM. All mutation evidence below uses isolated convex-test fixtures.

## Implemented changes and exact evidence

| Change | Evidence and boundary |
| --- | --- |
| Calendar title/notes/freshness changes no longer reopen every day bucket | A 370-bucket long-event fixture spies the real `ctx.db.query` calls: metadata update queries only `calendarItemReadModels`, writes its one current row, and leaves every bucket ID unchanged. Item range, status, owner and read-model version determine whether bucket work is necessary. |
| Explicit Calendar repair remains effective | Deleting a bucket and explicitly repairing restores it. Backfill passes `repairRangeBuckets: true`; the ordinary no-op optimization cannot suppress maintenance repair. Bucket updates now include owner-account changes, fixing stale range ownership when dates/status are unchanged. Tests also cover move, removal and restoration. |
| Calendar item backfill is bounded by bucket fanout | Requests for 100 items now return at most 10, with an advancing continuation and a 2 MB canonical-page byte target. A stale item can delete/recreate 370 buckets, so 100 items was not a safe per-transaction bound. Ten items cap this bucket churn at 7,400 writes plus compact rows. This is an engineering bound, not a hosted cost measurement. |
| ManageBac legacy scheduling repair uses resumable indexed pages | `scheduleExisting` processes one connected/degraded stream at a time, at most 100 integrations and a 1 MB page target, and queues its next page. A fixture with 250 connected, 120 degraded and 250 revoked integrations, tied due times, missing schedules and blocked rows dispatched exactly 366 eligible callbacks once each. Callback HTTP was replaced by an in-memory fixture action. Empty streams terminate. |
| Onboarding cancellation reads one relevant membership | The irreversible boundary now uses `schoolMemberships.by_school_status(schoolId, active).first()` instead of collecting the school's membership history. A fixture with 300 suspended rows plus an active member still rejects cancellation; after that member is suspended, cancellation succeeds. Authorization and invitation behavior are unchanged. |
| Personal analytics follows its metric definition and shows current recent rows | Timetable rows are excluded from workCreated as well as byType/recentWork. Both created-work and run samples read descending before the 2,001-row sentinel bound. A 2,010-work + 2,010-run fixture returns the newest eight of each and marks the aggregates partial. Account/date/deletion isolation and missing-meter-as-partial are tested. Privacy wording describes response exclusions. Full-body database reads were unresolved at the first checkpoint; the completed extension below replaces them with compact-summary reads. |

### Completed analytics extension

- `personalOverview` now reads `spectraArtifactSummaries.by_account_created` and `spectraAnalyticsRunSummaries.by_account_created`. There is no canonical artifact/run fallback. One run summary stores only canonical run ID, account, status, createdAt, read-model version and a title capped at 240 characters. It is independent of tab visibility/surface duplication.
- The existing transaction trigger maintains run-summary creation, status/title changes, owner transfer and physical deletion. Comparing already-present old/new projected facts prevents every summary read/write on heartbeat, lease, prompt/plan/context-only changes. Current actor authorization is still resolved on every query.
- `analytics:backfillReadModels` processes at most 25 canonical rows with a 2 MB page target. Existing `spectraReadModelMigrations` stores progress and explicit completion per source/version. Source-only calls resume; arbitrary supplied tail cursors are rejected. Missing/incomplete markers produce null + partial metrics, not zero. The UI charts/outcomes/recent lists display preparation rather than an empty completed history.
- Thread message-count/updatedAt updates no longer query or rewrite tab titles. Actual displayed title changes still propagate, and already-current tabs are skipped.

Local rollout after the coordinator publishes this exact extension:

```text
internal.analytics.backfillReadModels({ source: "artifacts" })
internal.analytics.backfillReadModels({ source: "runs" })
```

Repeat each source-only call until `done=true`; it resumes the stored cursor and returns at most 25 processed rows. A repeat after completion returns `{processed:0,cursor:null,done:true}`. `cursor:null` explicitly starts a fresh repair pass and may temporarily return that metric to preparing. No reset or provider/source mutation is needed. `repaired` in the migration row counts rows processed through the upsert, not physical writes.

No school deadline or provider-owned source field was rewritten. Calendar source locks, permissions, class selection and retained-copy policy remain in their existing writers.

## Current verification

Passed with one Vitest worker and file parallelism disabled:

```text
node node_modules/vitest/vitest.mjs run convex/calendar.test.ts convex/calendar-pagination.test.ts convex/calendar-bounded.test.ts convex/managebac-isolation.test.ts convex/managebac-retention.test.ts convex/managebac-scheduling.test.ts convex/school-onboarding.test.ts convex/schools-bounded.test.ts src/features/spectra/__tests__/calendar-pagination-client.test.ts src/features/spectra/__tests__/calendar-school-administration.test.ts --maxWorkers=1 --no-file-parallelism
```

10 files / **49 tests passed**, 11.00 seconds. The earlier focused 10-test run is a subset, not additional coverage.

```text
node node_modules/vitest/vitest.mjs run convex/analytics-bounded.test.ts --maxWorkers=1 --no-file-parallelism
```

1 file / **2 tests passed**, 1.69 seconds. The first checkpoint covered **51 distinct tests**. Scoped ESLint passed for its nine changed TypeScript paths; tracked-path `git diff --check` passed.

Extension verification:

```text
node node_modules/vitest/vitest.mjs run convex/analytics-bounded.test.ts convex/calendar-bounded.test.ts convex/ai-run-lifecycle.test.ts convex/s7-cost-read-model.test.ts convex/p9-efficiency.test.ts --exclude '.spectra-local/**' --maxWorkers=1 --no-file-parallelism
```

**32/32 tests passed**, 5 files, 19.62 seconds. These overlap the first checkpoint and must not be added to 51 as distinct tests. The new analytics file has six tests. A final targeted lifecycle rerun passed after adding post-migration creation and old-owner visibility assertions. The first lifecycle attempt correctly rejected the fixture's invalid `lastHeartbeatAt` field; the fixture was corrected to the real `heartbeatAt` field, with no production/schema relaxation.

The fixture's 12 artifacts and 12 runs remain nonempty through large body/prompt/plan/context growth: **12,730 → 12,730 serialized row bytes, 9 calls, 29 returned documents**, zero canonical artifact/run table reads and zero query writes. It also covers explicit migration incompleteness, bounded continuation/ties, arbitrary-cursor rejection, deactivated actors, heartbeat no-op, terminal status, title bound, owner change and deletion.

Scoped ESLint passed for extension sources/tests; Impeccable's single mechanical UI detector pass returned no findings. UI work followed its existing-surface hardening path and incumbent capability-state components. No browser render or live UI acceptance is claimed. The ignored frozen backend snapshot contains duplicate test filenames, so current checks explicitly exclude `.spectra-local/**`. Full typecheck/build, publication and served-runtime acceptance remain coordinator-owned and unrun by this lane.

## Audit findings and next contracts

1. **Personal analytics body scaling is repaired in source; rollout remains pending.** The original query read up to 2,001 full artifact/run rows each. The extension above replaces those reads after explicit migration completion. DATA approved `spectraArtifactSummaries.by_account_created = [ownerAccountId, createdAt]` and the shared trigger hunks. Existing run tabs can duplicate a run across surfaces and carry prompt/dock information, so a distinct tiny model is used. PERF owns the independent byte-read ledger.

   Independent PERF evidence now quantifies this failure (`convex/s10-perf.test.ts`, actual handler with a database API read ledger): increasing 12 artifact bodies from 1 KB to 80 KB plus an 80 KB protected base keeps 15 returned documents / 7 calls / 2,467 response bytes unchanged, but serialized database-row bytes rise **17,697 → 1,926,117 (about 109x)**. The body-independence budget is **false**, distinct from the test harness completing successfully. Private evidence and source hashes: `.spectra-local/launch-audit/evidence/S10-PERF/database-boundary.json`. These are instrumented database API bytes, not a hosted billing measurement. The independent Library/search control stayed at 15 documents / 13 calls / 10,008 row bytes / 2,265 response bytes / zero writes.

   **Independent repaired fixture passed:** PERF ran both real migrations (12 artifacts in three calls at limit 5; three runs in one call), verified null/partial before completion and exact nonempty counts after it (12 work, 3 runs, 50% settled completion, 8/3 recent lists). Artifact and run prompt/plan/context growth now leaves **11,245 → 11,245 row bytes, 20 documents, 9 calls, 2,826 → 2,826 response bytes**, with no canonical artifact/run table reads. Body-only run-summary sync has zero reads/writes. PERF also checked status changes, owner isolation, deletion and artifact tombstone. Its one-test run took 1.80 seconds and scoped lint passed. PERF preserves the failed baseline separately; no hosted/live/billing result is inferred.
2. **School boot still loads a broad bundle.** `SchoolDataShell.load` starts overview plus class candidates together. `managebac.myOverview` reads up to 2,000 full normalized external records before filtering the current integration/school. `adminOverview` reads up to 500 records before selecting 120 previews. These samples have no continuation; the shelf does not yet establish complete bounded discovery. A purpose/class/page API plus explicit partial states and client continuation is needed.
3. **Purpose reads can omit eligible older rows.** `recordsForPurpose` samples 500 rows per integration/type and per account/type before class, selection and date filters. The class index is only `[providerClassId, recordType]`, lacking integration/account scope. Do not replace this with another post-filtered take. Next contract needs scope/type/class/date indexed compact rows and continuations, with current membership/selection checks. No source-provider truth or import authorization should be inferred from a missing sampled row.
4. **Admin and lifecycle paths retain broad work.** `administration.agentGovernance` collects all active school artifacts before finding agents, plus all-time usage/feedback/evaluation/release rows. `schoolOverview`, `platformOverview` and `schoolDirectory` retain broad member/usage/fanout reads. `processScheduledAnnouncements` caps announcements at 50 but collects every delivery for each; lifecycle export code also collects broad tables. These require durable page/checkpoint contracts, and partial delivery must not be confused with a fully sent announcement. No destructive lifecycle behavior was changed.
5. **Thread title fanout is repaired in source.** The DATA-approved unchanged-displayed-title early return is implemented and instrumented. AI reports no overlap. W9's existing AI heartbeat projection guard remains covered by the Calendar suite.

W9-01, W9-02, W9 school-repair and relevant S9 durability evidence were reviewed. W9-02's historic cost table must not be promoted to current hosted cost evidence. In particular, the current scaling test adds **80 extra off-range items**; their two compact writes per item explain 160 writes, whereas the historical report labels that step “160 additional off-range rows.” Current tests establish query/response independence for the corpus they actually insert.

## Proposed contracts for the next implementation segment

These are reviewable contracts, not implemented endpoints or measured performance claims. DATA owns coordinated additive schema integration; PLATFORM owns these readers/jobs; School client changes need an announced path claim with LIBRARY.

| Surface | Bounded contract | Completeness / authorization |
| --- | --- | --- |
| School mount | `managebac:overviewMetadata` returns integration/mapping/freshness and independently paged capability/sync/conflict summaries. It does not read `externalRecords`. Record sections request data only when opened. Keep legacy overview temporarily for unconverted consumers. | Failure of one summary/page must not blank the School shell. No school record or class count is inferred from the records currently loaded. |
| School records | `managebac:recordsPage({purpose, classId?, from?, to?, cursor?, limit?})`, `limit <= 50`, returns `{page, continueCursor, isDone, sourceState, scopeRevision}`. Use a compact `externalRecordSummaries` allowlist: canonical record ID, integration/school/account/audience/class/academic-period/type, title, exact source time/precision, source revision/state/freshness. No arbitrary normalized object or provider URL is required for list rows. | Required indexes include account/integration/type/time and integration/audience/class/type/time, ending in canonical record ID for ties. A page handles one indexed stream, with the opaque cursor selecting the next stream; do not use multiple Convex `.paginate()` calls in one query. Current authenticated membership, mapping and selected-class revision are checked for every page. A scope revision change invalidates the cursor and restarts discovery. |
| School detail / explicit import | Detail uses one canonical record ID with fresh authorization and selection checks. Human import continues through the existing begin/attach/complete/fail receipt seams, keyed by source revision. | A list summary is discovery metadata, never authority to import. Re-fetch source truth before download/adoption. Revocation/missing source retains prior personal copies. Provider URLs/identity are server-controlled. |
| Admin people and agent lists | School-scoped metadata pages of at most 50; artifact agent lists use school/type/status metadata indexes, not all active artifact bodies. Person status/role and grant changes remain current. Agent detail loads only the selected agent's bounded aggregate ranges. | Cursors must progress across ties; no empty first sample may stand for an empty school. Exact global counts use maintained aggregates or an explicit completion fence, not page length. |
| Admin metrics | Daily compact aggregates by school/day and account/day, with tracked measurement coverage. Query finite date windows and a documented aggregate-row bound; if exceeded, return partial state and continuation/narrow-range guidance. | Keep collection-disabled, backfill-incomplete and true zero distinct. Aggregates carry counts/quantities, never prompts, full artifacts, raw evaluation transcripts or feedback comments. |
| Scheduled announcements | A durable delivery generation owns audience snapshot, page cursor, delivered count and scheduled-function receipt. Materialize/deliver at most 200 recipient rows per invocation, with one continuation. Guard continuation by announcement ID + generation and recheck cancellation/status. | Do not mark `sent` until every page is complete. Editing or cancelling advances the generation so older jobs cannot recreate recipients or complete a replaced announcement. Reader copy must distinguish partially delivered from fully sent. Creating, editing and cancelling audiences must use the same bounded protocol; bounding only the cron leaves large-school failures. |
| Lifecycle export / admin directory | Page only school-scoped rows, <=100 per transaction with byte targets, into an explicit durable export/directory job; preserve stage/cursor/counts and failures. Avoid table scans followed by school filtering. | Export readiness requires all dependent pages and storage writes acknowledged. Existing dual approval, retention, recovery and purge boundaries remain authoritative; export partiality cannot unblock destructive lifecycle work. |

Acceptance for each new page contract: grow off-scope school/account/class history by at least 10x without increasing rows/bytes read by an unchanged page; traverse >2 pages with identical timestamps; include the first eligible row behind >500 unrelated rows; change selection/revoke access between pages; fail/abort one page; retry the same cursor without duplicates; prove that UI partial/failed state does not report a complete empty result. Record actual database reads separately from serialized response bytes. No live tests are scheduled by this document.

## Live acceptance boundary

No current live student/ManageBac import claim is made. Historical V9 evidence and degraded/no-match identity state remain distinct. The AI resource-import tool remains `aiAvailability: prohibited`; the existing human School route owns source verification and the import receipt.

RELEASE received criteria for a coordinator-scheduled disposable fixture: verified student mapping; selected Math vs unselected History visibility; explicit import with one counted binary request; same-revision replay with no duplicate; reopen the saved Library copy; source revision update preserving the old copy; missing/revoked/slow/redirect cases preserving saved work and avoiding hollow artifacts. Calendar acceptance must retain official deadline locks, personal scheduling and unknown/all-day time semantics. No real identity, role or provider changes are authorized by these fixture criteria.
