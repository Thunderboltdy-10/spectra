# S10-PERF — independent measurement and cost budgets

Status: source instrumentation and deterministic verification complete; three scheduled read-only direct Convex probes passed on the earlier frozen backend. UI/native, cold/warm and actual engine-I/O measurements remain pending. No production performance pass is claimed.

Primary checkout: `<local-workspace>`, inherited dirty `main`. PERF has not staged, committed, reset, switched branches, deployed, restarted the stack, or touched native fixtures. Initial effective context was workspace-write; the latest continuation explicitly provides danger-full-access / approval never. The coordinator owns runtime and integration.

## Findings

1. **The previous Convex collector could falsely pass.** Missing usage fields became zero, an empty event set passed, and early CLI exit was treated as the full requested window. `convex-window.mjs` now retains nulls and per-field coverage, distinguishes failed/unobserved/passed, rejects empty/missing/partial evidence, and records actual observation duration and process completion. `returnBytes` is never substituted for database I/O.
2. **Analytics body amplification was reproduced and its compact-source repair is now independently verified.** The initial actual-handler fixture kept its response at 2,467 bytes while returned row bytes rose from 17,697 to 1,926,117 as 12 canonical artifact bodies grew. PLATFORM then added compact analytics reads and explicit migrations. With both real backfills completed, the strengthened PERF fixture now reads **11,245 bytes both before and after artifact and run-body growth**, with correct non-null counts. The old failure is preserved separately; no deployed migration or engine-cost pass is claimed.
3. **Library body separation works for the measured migrated owned fixture.** A 4-item response over 12 candidates stayed at 13 API read calls, 15 returned documents, 10,008 returned-row JSON bytes, 2,265 response bytes and zero writes before/after body growth. Search also stayed at those bounds. This does not prove bounded shared-grant fanout, exhaustive discovery, engine scans, or cold/warm UI performance.
4. **Tiny native sheet edits remain tiny at scale.** The same real native Yjs model and gateway durable-delta helper produced 38/38/40-byte distant edits at 1k/10k/200k cells. Reconnect catch-up was also 38/38/40 bytes; duplicate durable updates returned zero bytes; cell count, distant value and an unchanged first cell survived readback.
5. **The browser observer previously lacked readiness, subscription and memory evidence.** The existing observer/checkpoint/reset helpers now record OPEN's editor-ready attribute transition, Convex query add/remove/active/peak counts in total and by function name, socket lifecycle, mutation-frame count, HTTP request/response body sizes and optional Chromium heap. Missing Content-Length remains unknown. Only navigation init-script installation is marked before-app; current-page installation is incomplete for pre-existing sockets/subscriptions. Old helper versions are rejected rather than silently reused.
6. **Thread active-execution hydration has a separately reported amplification defect.** DATA-REVIEW reused the PERF ledger in `convex/s10-data-review.test.ts` and reported 241 tab documents / 846,606 tab JSON bytes for 240 historical tabs, with 245 documents / 847,806 bytes overall per call and only a 115-byte active-execution response. Its bounded regression fails before repair. This is attributed DATA-REVIEW evidence, not a separate PERF rerun or physical engine-byte measurement; post-repair evidence is pending.
7. **Per-page bounds alone do not make sparse school-wide discovery usable.** DATA's isolated `catalogPages.artifactPage` density fixture (10,000 newer private items before 24 owned items) measured three actual prefix pages: all empty/nonfinal, each returning 25 summary documents plus one node, 10 terminal queries and two gets. The algorithm consumes one private candidate per request, so reaching the first owned result would require 10,001 requests, roughly 250k summary reads / 157MB fixture-row JSON, 100k queries and 20k gets. Those totals are **derived**, not a fully executed scan; the three local fixture durations (114.5/104.6/86.5 ms) are not served latency evidence. PERF raised the sparsity/read-amplification concern before this fixture; DATA confirmed it and recommended actor-indexed organization/owned discovery initially, keeping exhaustive school discovery opt-in. Do not call this default picker behavior performant merely because one page is bounded. Source: DATA-reported isolated `.spectra-local/s10-convex/density.json`, not a PERF runtime rerun.

## Deterministic measurements

Evidence is under ignored `.spectra-local/launch-audit/evidence/S10-PERF/`. JSON includes hashes of the measured source files. It contains aggregate metrics, not user bodies or credentials.

Initial measured source (before the compact analytics extension):

| Fixture | Returned documents | Returned row JSON bytes | Response bytes | Writes |
| --- | ---: | ---: | ---: | ---: |
| Library, 12 × 1k bodies, limit 4 | 15 | 10,008 | 2,265 | 0 |
| Same Library, 12 × (80k body + 80k protected base) | 15 | 10,008 | 2,265 | 0 |
| Same large fixture, search | 15 | 10,008 | 2,265 | 0 |
| Analytics, small bodies | 15 | 17,697 | 2,467 | 0 |
| Analytics, large bodies | 15 | 1,926,117 | 2,467 | 0 |

After the compact-source extension, the fixture also seeds three real runs (completed, failed, running), grows each private prompt/plan/context from roughly 1k to 72–90k, and invokes the real summary maintenance helpers:

| Fixture | API calls | Returned documents | Returned row JSON bytes | Response bytes | Writes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Library/search before and after body growth | 13 | 15 | 10,009 | 2,265 | 0 |
| Prepared analytics before body growth | 9 | 20 | 11,245 | 2,826 | 0 |
| Prepared analytics after body growth | 9 | 20 | 11,245 | 2,826 | 0 |

The analytics budget now **passes** with exact byte equality. Before any migration the fixture requires null/partial work and run counts; after only artifact migration it requires 12 work items but still-null runs. Artifact backfill processed 12 rows over three calls at limit 5; run backfill processed 3 rows in one call. Only after both complete does the cost check require 12 work items, 3 runs, 50% completion, 8 recent work items and 3 recent runs. It asserts no canonical artifact/run table reads. Private run-body changes invoke `syncAnalyticsRun` with zero summary reads/writes.

Further synthetic maintenance controls verify a run status change updates outcomes/completion, ownership changes remove artifact/run summaries from the old actor's query and appear only for the new actor, run deletion removes its summary, and an artifact tombstone stops counting as work. These exercise projection maintenance and authenticated query isolation, not authorization to perform a real ownership transfer. Per-run row byte totals can differ by a few bytes from previous fixtures because Convex-generated IDs differ; each scale comparison uses the same records.

`database-boundary-before-compact-analytics.json` preserves the original failed budget and source hashes; `database-boundary.json` records the repaired-source check, completed backfills and maintenance controls. Both remain synthetic evidence. Full 2,001-row date-window cost and real migration rollout are outside this fixture's measured cardinality.

The ledger observes the real query handlers inside `convex-test`, wrapping the real `ctx.db` interface. These are documents returned by that API, counted again on repeated reads, and UTF-8 JSON sizes of those full rows. They are **not** index entries scanned, physical database bytes, hosted billing or transport bytes. A post-index filter can hide engine work; the ledger records that flag. The engine collector is required for actual database I/O evidence.

| Synthetic native sheet | Full Yjs bootstrap bytes | One-cell durable delta | Reconnect catch-up | Duplicate delta |
| --- | ---: | ---: | ---: | ---: |
| 1,000 cells | 25,214 | 38 | 38 | 0 |
| 10,000 cells | 268,215 | 38 | 38 | 0 |
| 200,000 cells | 5,978,217 | 40 | 40 | 0 |

The 200k run observed ~355 ms native-model initialization, ~5.9 ms edit/diff/apply and ~374 MB process heap growth. These are single process observations affected by GC and by three resident Y.Docs plus projections. They are not browser editor-ready latency, retained idle heap or an SLA. Byte/readback assertions are deterministic; there is no wall-clock pass threshold.

## Reproduction and ownership

- `node node_modules/vitest/vitest.mjs run docs/spectra-reformation/final-verification/scripts/foundation.test.mjs scripts/s9-measure.test.ts convex/s10-perf.test.ts --exclude '**/.spectra-local/**' --maxWorkers=1 --no-file-parallelism`
- Set `SPECTRA_PERF_EVIDENCE=1` for the Convex fixture to write `database-boundary.json`.
- `node --import tsx scripts/s9-measure.ts --synthetic` writes `synthetic-delta.json` for 1k/10k/200k cells without network/database/native mutation.
- `node --import tsx scripts/s9-measure.ts <disposable.xlsx> <disposable.docx>` retains the old S9 entry point and adds first/repeated lens-call timing, writing a timestamped S10 lens directory so historical S9 evidence is preserved. It deliberately reports browser readiness and database I/O as null.

Owned paths: `scripts/s9-measure.ts`, `scripts/s9-measure.test.ts`, `scripts/perf-read-ledger.ts`, `convex/s10-perf.test.ts`, this report, and final-verification `scripts/convex-window.mjs`, `scripts/foundation.test.mjs`, `scripts/playwright/install-observers.mjs`, `checkpoint.mjs`, `reset-window.mjs`. Product changes remain with their lane owners.

Integration note: the pre-existing `.git/info/exclude` pattern `/scripts/s9-*.ts` hides the two S9 harness paths from status/diff. The coordinator must review/include them explicitly if integrating. PERF has not changed the exclusion or staged files.

## Scheduled direct backend observation — 2026-09-24 12:42 UTC

Coordinator authorized exactly bounded read-only probes of the existing authenticated `launch-s10-ai` browser context while the web server remained down. The loaded `/chat` page still had its Clerk session, so no reload, web recovery, mutation or server start was needed. The Convex token stayed in-page and was not output or stored.

Three sequential query POSTs ran from **12:42:57.951Z to 12:42:58.902Z**:

| Function | Limit | HTTP/function result | Duration | HTTP response UTF-8 bytes | Items |
| --- | ---: | --- | ---: | ---: | ---: |
| `spectraArtifacts:list` | 60 | 200 / success | 860.7 ms | 46,962 | 60 |
| `spectraWorkspaces:list` | 30 | 200 / success | 31.3 ms | 5,797 | 8 |
| `spectraRuns:listRecent` | 12 | 200 / success | 59.2 ms | 10,760 | 12 |

Publication identity, verified before and after the probes: `.spectra-local/launch-orchestration/2026-09-24/backend-publication.json`, completed `2026-09-24T12:34:46.525Z`, deployment `local-pablo_md-ai_school-2`, URL `http://127.0.0.1:3002`, schema SHA-256 `28df4693768cb6ac6aa806e1685f6086a2ebbdc29d17f65f6e8da292bd830df1`. Coordinator source marker: frozen primary working tree with DATA `ce575b2f + 7feea08c + 53b6a612` and documented S10 checkpoints. These are the **earlier stable functions**, not the upcoming catalog-page or compact-analytics rollout.

Enriched evidence: `.spectra-local/launch-audit/evidence/S10-PERF/direct-convex-after-frozen-publication.json`. Actual database read documents/bytes and writes remain null because no engine usage stream was captured. Each duration is a single direct-query observation, not cold/warm or percentile evidence. Profile A is school-admin/operator; this is not an ordinary-student check. The older failing artifact/workspace timings reported by AI are useful failure history, not a matched performance benchmark from which a speedup ratio can be calculated. Overview/UI/bootstrap were not exercised.

## Remaining scheduled runtime measurement contract

All rows below are **NOT RUN in S10-PERF**. The finite direct-function checks above do not satisfy these broader journeys. The AI owner's existing Profile A is school-admin/operator, not ordinary-student evidence. Backend/web publication and runtime slots remain owned by the coordinator.

| Window | Repeat/control | Observe | Gate |
| --- | --- | --- | --- |
| Shell cold / warm + Library | Fresh page with observer before app; then same authenticated profile repeated | HTTP bodies, encoded/decoded ResourceTiming, sockets/subscriptions, server completion stats, usable Library predicate | Status 200, usable content; separate cache state and exact served source. No inference from blank responses |
| Library page / search / folder | Fixed limit; unrelated-history and shared-grant density controls | Server documents/DB bytes, response bytes, query lifecycle, continuation completeness | Bounded per page; follow explicit nonfinal empty pages; no inaccessible results or silent tail truncation |
| First / warm artifact open | Same disposable artifact; define HTTP, module and Yjs cache state separately | Click/reset to `[data-spectra-studio="id"][data-spectra-editor-ready="true"]`; content hydration/bytes and heap | Predicate is initial child viewport plus frame (DOCX waits TipTap), not canonical/native save or all-media readiness |
| Idle shell / open editor | 60-second isolated windows, fixed visible artifact | Executions/min, database I/O, mutation frames, active query/socket drift, heap after settle | Existing collector idle budgets; checkpoint writes need matching server function observations |
| Small edit on large artifact | One distant cell or paragraph; unchanged-neighbor control | Delta/request bytes, durable append, canonical version/readback, native queue/verified receipt separately | Size scales with edit; no full content POST; all required readbacks correct |
| Reconnect | Disposable session, permitted scheduled disconnect only | Catch-up bytes, reconnect attempts, subscription/room count, duplicate writes, final content | No lost/duplicate edit or lingering socket; readiness separate from durable acknowledgment |
| Bridge idle / queue | Existing Bridge, explicit disposable mount and scheduled native slot | Claim/retry queries, scans/probes, idle exchange rate, queue age and verified receipt | Bounded rotating probes; retries/coalescing preserve latest bytes; no production/native assertion from Rust/source tests alone |

Run `convex-window.mjs --instance 1 --seconds 60 --profile idle --label s10-<window>` only in the assigned slot. The collector uses the existing instance selector. A status of `unobserved` is a measurement failure to resolve, not an idle-cost pass. Function completion windows are backend-wide; overlapping AI/Bridge/cron work must be attributed or explicitly retained as confounding traffic. Store coordinator-confirmed served source markers alongside the window; checkout hashes alone do not establish what the running stack serves.

Existing budget values are retained: idle ≤5 non-cron executions/min and ≤250k DB-I/O/egress bytes/min; collaboration ≤8 executions, ≤2 Bridge exchanges, ≤500k DB-I/O and ≤64k egress bytes/min; action ≤1MB DB-I/O; scheduled execution ≤100 read documents and ≤128k DB-I/O bytes. These are engineering regression budgets requiring complete relevant metrics, not production cost/SLA promises.

PDF caution from OPEN: native PDF resource identity has no page-rendering preview, so it cannot count as PDF page-ready. PDF extracted into a document uses the document editor predicate.

LIBRARY's pending source contract: list mode uses paged `orgTree:listChildren` (50) and `orgTree:containersPage` for each visible expanded rail branch; Board must release hidden `listChildren`; search/quick use `orgTree:searchPage` / `orgTree:quickViewPage` with raw pages of 50 and explicit empty/nonfinal continuation. `convexQueries.byFunction` now supports independently checking those active/removed/peak counts without retaining query arguments. These frontend contracts are not yet verified live.

## Verification and limits

- Initial focused set: 3 files / 9 tests passed; affected two files / 3 tests passed after TypeScript narrowing fixes.
- Browser instrumentation adds a real jsdom socket/query/reset/readiness/privacy test. Initial run failed because jsdom lacks ResourceTiming; the fixture supplies that browser method and disconnects observers on teardown. Revised foundation: 7/7 passed.
- Final focused set: **3 files / 10 tests passed** in 4.44 s, one worker. A preceding run passed the same 10 source tests but also collected a recovery-checkpoint copy missing its relative helper; explicit `.spectra-local` exclusion removed that non-source copy from collection. No checkpoint was modified.
- Compact analytics follow-up: **1 changed file / 1 strengthened test passed** in 1.80 s; scoped ESLint passed. It covers both backfills, non-vacuous counts, run-body growth, status/delete/owner-move maintenance and authenticated account isolation.
- Per-function subscription observer follow-up: foundation **7/7 passed** in 1.69 s, including query-name counters across reset/removal and private-argument exclusion.
- Scoped ESLint on the six eligible files: **passed**. Explicitly passing the three intentionally ignored standalone browser helper expressions first produced ignored-file warnings; those helpers are syntax/behavior checked by foundation instead. `git diff --check` on PERF paths passed.
- No PERF broad suite, full build, deploy, shared runtime mutation, live Office test, provider change or production action.

Historical S9-DURABLE measurements (13,142/12,859 ms workbook open, 72–77-byte cell requests) and W9 calendar metrics remain tied to their historical source/runtime. They are context only and are not relabeled as S10 results.
