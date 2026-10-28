# Convex and interaction performance — 28 October 2026

This is a small performance refactor based on the existing local deployment. The priority is resource consumption relative to each allowance, while preserving editing, authorization, history, and navigation behavior. Changes are uncommitted.

## Evidence and measurement limits

- Deployment: local instance 8, `local-pablo_md-spectra_local_live_7ac61-6`, cloud endpoint `127.0.0.1:3002`.
- Existing local process logs: `.spectra-local/instances/8/logs/start-all-stack.stdout.log` and `start-all-stack.stderr.log`. They contain engine diagnostics, rather than complete per-function billing data.
- Extracted the backend's `/api/stream_function_logs` completion records with `usageStats`, and its `/metrics` counters. The baseline sample contains 1,000 completions over 258.258 seconds, **00:11:15–00:15:33 UTC on 28 October**. The metrics snapshot was captured at 00:15:34 UTC. That backend process had started approximately 27 hours earlier.
- Aggregate evidence is saved locally in `.spectra-local/performance-audit/`: `baseline-events.json`, `baseline-metrics.txt`, `storage-inventory.json`, `usage-summary.json`, `before.json`, and `after.json`. No admin keys or source document bodies are included in those aggregates.
- These are local workload observations, not the cloud team's billing statement. Cached executions, internal calls, file access, index accounting, other deployments, and cloud-specific egress accounting prevent an exact invoice reconstruction. A short active browsing sample is not a reliable monthly traffic forecast.

## Relative pressure by resource

Allowances below are the common Free/Starter reference amounts, used as a comparison scale rather than as a target to stay under. Verified against [Convex pricing](https://www.convex.dev/pricing) and [resource definitions and limits](https://docs.convex.dev/production/state/limits) on 28 October 2026. Limits are shared at team scope unless specified otherwise.

| Resource | Reference allowance | Local observation | Observed/reference | Interpretation |
| --- | --- | --- | --- | --- |
| Database I/O | 1 GB/month | 2,202,016,018 query-read bytes in the backend counter | **220.2%**, before other I/O | Largest measured relative pressure. Counter help text identifies this as database bandwidth used for queries. |
| Function volume | 1,000,000/month | 100,847 function-runner executions, including 10 failed queries | About **10.1%** | Physical execution proxy, not an exact billed call count. Recent volume is dominated by authorization and bridge exchanges. |
| Database storage | 0.5 GB | 52,671,059 bytes of user documents | **10.5% minimum** | Excludes billed index overhead; do not treat this as total database storage. |
| File storage | 1 GB | 73 files, 20,612,383 bytes | **2.06%** | Much less pressure than repeated reads in this dataset. |
| Action compute | 20 GB-hours/month | Approximately 0.117 GB-hours from action duration counters and runtime memory allocations | About **0.58%** | Estimate: Node runner duration × 512 MiB, isolate action duration × 64 MiB. Not exact cloud billing. |
| Data egress | 1 GB/month | Storage egress counter: 6,994,094 bytes | **0.70% for this component only** | Complete client/action egress is unavailable. Local completion `networkEgressBytes` values of zero are not proof of zero outbound traffic. |
| Search queries | 3,000 query-GB/month | Text search index-size attribution: 12,405,028 byte-queries, about 0.0124 query-GB | About **0.00041% for text searches** | No significant search-query pressure shown here; not a complete text/vector cloud usage report. |
| Search storage | 0.5 GB | No complete search-storage gauge extracted | Unknown | Do not substitute database document bytes or SQLite file size. |

Monthly counters and storage snapshots have different meanings: the percentages above compare the observed amount with the allowance, not a completed month's utilization. Over the same approximately 27-hour counter window, database reads are far ahead of function executions and compute relative to their allowances. The fresh sample also points to reads and function volume, so both independent views support the priority order.

The fresh completion sample totals 3,414,698 database read bytes, 16,226 write bytes, and 386,700 return bytes. Return bytes include internal/action responses and are useful for ranking payloads, but cannot be summed as billed client egress.

## Functions responsible for the pressure

| Function | Calls in sample | Database read bytes | Share of sample reads |
| --- | ---: | ---: | ---: |
| `school:classes` | 11 | 985,540 | 28.9% |
| `replicas:sweepReplicaTruth` | 2 | 879,624 | 25.8% |
| `changeGroups:commitIdle` | 52 | 644,020 | 18.9% |
| `school:tasks` | 6 | 594,755 | 17.4% |
| `collaborationGatewayStore:authorize` | 256 | 84,565 | 2.5% |

The first four functions account for about **91% of read bytes**. `collaborationGatewayBridge:exchange` accounts for 359 completions, `authorize` for 256, and `policy` for 102. Together they account for **71.7% of completions**. The exchange action also dominates action compute in this short sample.

`bridge:reportHealth` accounts for all 16,226 sampled write bytes across 19 heartbeats. The response-byte leaders are class summaries (87,219), bridge exchanges (66,155), authorization results (53,248), and Library quick views (34,333). Removing duplicate subscriptions and calls helps both function volume and response traffic without trimming visible data.

Storage inspection found 600 collaboration updates (about 4.0 MB serialized JSON), 334 change groups (2.6 MB), 374 artifact versions (2.1 MB), 394 snapshot objects (1.6 MB), and 398 replicas (1.5 MB). These are JSON estimates, not physical billing sizes. One open human change group was about a week old and still retried every five seconds. No history, files, or retained payloads were deleted as part of this refactor.

## Changes and measured results

### School reads

Class/task queries reuse source records they just loaded in the same query transaction when checking visibility. Membership, mapping, selection, preferences, and current account authority are still checked. Mutations and callers holding earlier snapshots retain the original reader that reloads the source.

The following are actual uncached executions against the same local account and dataset, before and after updating only the local backend:

| Function | Before read bytes | After read bytes | Reduction | Documents read, before → after |
| --- | ---: | ---: | ---: | ---: |
| `school:classes` | 197,108 | 116,926 | **40.7%** | 260 → 156 |
| `school:tasks` (`view: all`) | 1,007,828 | 568,316 | **43.6%** | 672 → 399 |
| `replicas:sweepReplicaTruth` | 439,812 | 20,243 | **95.4%** | 36 → 36 |

Before: 00:20:04 UTC; after: 00:29:17 UTC. Class and task result SHA-256 digests match exactly: 23 classes and 258 tasks, with unchanged JSON response sizes of 7,929 and 71,969 bytes. The sweep returned the same result and performed no repairs or payload releases in either execution.

Single-run engine times also decreased (classes 95 → 66 ms; tasks 120 → 93 ms; sweep 100 → 69 ms), but byte counts and identical results are stronger evidence than these unreplicated timing observations.

### Replica maintenance

The sweep first probes existing compact payload ownership. A positive match avoids reading a full Office replica projection to establish that the payload must be retained. If compact ownership is absent, all existing reference probes still run. Missing compact ownership is never taken as proof that deletion is safe. A regression test covers both compact ownership and the legacy fallback with a large projection.

### Editing and version history

- One idle-history check is queued when a human change group opens. Continued typing moves the deadline through that check instead of adding a scheduled job for every durable append.
- A missing projection backs off from five seconds to at most one minute. A checkpoint that finally supplies the projection commits an already-idle human group immediately, avoiding a new wait for the backoff timer.
- A 12-append regression scenario queues one initial job instead of twelve, verifies the one-minute stale retry, and verifies immediate history completion when the checkpoint arrives.
- Durable editing still uses its existing 180 ms idle / 1 s maximum batch timing. Projection checkpoint timing remains 2 s idle / 15 s maximum. The editor's existing autosave cadence is unchanged.
- Gateway append/bootstrap/checkpoint/recovery paths reuse the artifact already loaded in their transaction for authorization instead of loading its content again.

### Collaboration function volume

The gateway shares only simultaneous authority requests for the same account, artifact, partition, and policy version. The room policy sweep refreshes connections concurrently so duplicate requests can actually share that work. Settled results are immediately discarded; there is no additional authority cache or longer revocation window.

The shared request times out, clears its map entry, and allows a subsequent check to recover even if the original request never resolves. Tests cover cross-account/room/policy isolation, definitive denial, transient failure, quiet-subscriber deadlines, a queued edit expiring, and late responses that cannot renew an expired connection. Savings depend on how many connections share an actor and room; no fabricated live percentage is assigned to this change.

### Default loading and landing interactions

- Folder/class shelves own their existing paginated query. The hidden parent List query no longer also loads its first 50 rows while that shelf is visible. Root Shelf still gets its data, and List, search, filters, and renaming retain their reads. Visible page sizes and pagination behavior are unchanged.
- The landing side editor is loaded dynamically and has an existing-style skeleton while opening, rather than pulling the full studio into the landing entry module.
- Browser measurement found that local-only demo documents unnecessarily waited four seconds for a room they never connect to. The existing local-only collaboration context now bypasses that wait. Normal application room binding remains unchanged. Warm development-browser opening fell from about 4.5 s to 0.63 s in this check; this is not a production latency guarantee.
- Added the missing `historyIsMine` memo dependency in the touched studio so its status actions stay current and the file passes hook linting.

## Verification

- 233 tests passed across 13 focused suites covering checkpoints, invited access, durable payloads/recovery, native history boundaries, ManageBac visibility/isolation/task projections/bounded reads, replica invariants, and Library behavior.
- 9 Node authorization/security tests passed, including concurrent-request sharing and recovery after a hung request.
- Root and Convex TypeScript checks passed. ESLint passed for all changed code/test files with zero warnings.
- An optimized production build completed successfully, including type checking and all 35 static pages.
- Authenticated development-browser checks: class Shelf → List showed all 20 expected items; search and clearing it worked; returning to Shelf worked; School, Calendar, and Home navigated without page errors.
- Landing browser checks: no editor chunk before opening/approaching the studio in the initial development check; editor opened, became editable, and closed without page errors. The local-only wait removal was checked in the browser.
- Production-browser smoke checks also passed for the landing editor and the authenticated Library → School → Calendar → Home flow, including all 20 class items and search/Shelf/List behavior. The landing's first contentful paint was 1.87 s, server response started at 524 ms, and the demo editor became editable about 0.73 s after clicking in this single desktop run. These are local, unthrottled observations, not a load test or a guarantee on mobile devices and real networks.
- The first temporary production probe used a `127.0.0.1` bind with a `localhost` URL. The development Clerk middleware normalized its rewrite to `localhost`, causing the local probe to proxy to itself. Using `localhost` consistently resolved it without a product code change. Temporary production probe servers were stopped afterward.

No cloud deployment or new commit was made. No new tables, indexes, migrations, retention policy, query framework, or redesigned flow were introduced.
