# M01 Completion

Date: 2026-09-10
Branch: `codex/m01-spectra-read-cost-deletion`
Original M01 candidate preserved: `1dc1be2d94f9d82336e67807b367748367311ad9`
Consumed M02 completion candidate: `8071a0cfec4d6f582b6c75dbdc0ddaf308f638a8`
Consumed-on-branch commit: `b4c92514` (the M02 commit was cherry-picked privately; no primary merge)

## Delivered contracts

Thread reads now use bounded initial messages and a separately observed active run. `spectraThreads.get` no longer fans out operations, cards, events, or affected artifact bodies. `listMessages` accepts the legacy numeric boundary and the new opaque `(createdAt, document id)` cursor; equal timestamps are retained. `getRunTrace` has independent bounded operation, result-card, and event pages. `spectraThreads.list` keeps the existing shape, adds a stable page cursor, and checks each context through current workspace/artifact authority before returning labels. Metadata backfill skips already migrated rows and returns resumable state, so repeated calls advance. The conversation surface guards delayed page responses by thread/request generation, exposes retryable errors, and restores the scroll anchor after prepend.

Deletion keeps the owner artifact as a deleted tombstone and fences writers/readers with `deletionGeneration`. Direct deletion and the owner Trash path both create durable `artifactDeletionJobs`; peer placement removal remains placement-only. The worker advances through versions, M02 intake release, runtime builds, user states, memory claims/evidence/relations, links, replicas, Bridge requests, collaboration rows and run descendants in bounded pages. Terminal Bridge rows are not selected as new work. Job status checks owner and school authority. M02's `releaseArtifactIntakePage` is consumed directly; M01 does not delete its storage ids or count retained objects as released.

Embed operation reuse is bound to actor, container, region, source and version policy through `placementFingerprint`; conflicting reuse fails and identical replay returns the original row. `confirmPlacement` is available for canonical insertion callers. Bridge polling keeps active discovery at a short cadence, backs off disconnected/migration/request failures, decorrelates jitter, and caps total sleep at 15 seconds. W4 sequence/vector/room guards were not changed.

## API and migration contracts

- `spectraThreads.list({ includeArchived?, limit?, cursor? })` returns the prior row fields plus `pageCursor` on each row for compatibility with existing callers. Context labels are authority-filtered and use `spectraArtifactSummaries` when present.
- `spectraThreads.listMessages({ threadId, before?: string | number, limit? })` returns `{ messages, hasOlder, olderBefore, nextCursor }`. Numeric `before` remains accepted for old route callers.
- `spectraThreads.getRunTrace({ threadId, runId, eventAfter?: string | number, operationsBefore?, cardsBefore?, limit? })` pages all three descendant families independently.
- `spectraThreads.getActiveExecution({ threadId })` is the small independently subscribable active-run projection; the route exposes it as `threadActiveExecution`.
- `spectraThreads.backfillReadMetadata({ limit?, cursor? })` returns `{ scanned, updated, complete, nextCursor }`. Rollback is to stop calling the internal mutation; rows retain the previous optional fields and old callers can continue using numeric history boundaries.
- `artifactDeletionJobs` carries `generation`, `phase`, `cursor`, `deletedRows`, `releasedBytes`, `nextAttemptAt`, and `lastError`. A worker must pass the generation it claimed. A deleted artifact row is retained as the authorization/retry anchor.
- `releaseArtifactIntakePage` is consumed with the exact M02 signature. Its receipt rows are the byte-release proof; `releasedBytes` is accumulated only from first receipt-backed release.
- Embed `placementOperationId` is replay-safe only for the same stored fingerprint. `confirmPlacement` is idempotent for the same operation.

Migration procedure: deploy schema and backend together, run `backfillReadMetadata` in pages while retaining old `listMessages` numeric callers, then switch callers to returned opaque cursors. If a rollback is required, stop the backfill worker and restore the prior reader; optional metadata and tombstones remain backward compatible. Do not physically remove deleted artifact tombstones until every retained-reference owner has its own release path.

## Workload evidence

The reproducible local fixture is `convex/m01-workload-measurement.test.ts`. It creates 4-message and 200-message threads and measures the actual convex-test query result, dataset size, and elapsed method. One run produced:

| Workload | Dataset | Cold/warm sample | Returned bytes | Initial messages | Trace fan-out |
| --- | ---: | ---: | ---: | ---: | ---: |
| Small thread | 4 messages | 154.47 ms | 1,360 | 4 | 0 |
| Long thread | 200 messages | 3.32 ms | 10,493 | 32 | 0 |

The same command reports timing on each run; convex-test does not expose physical Convex read-byte counters, so these are response bytes and elapsed local transaction/query time, not a hosted billing estimate. The workload fixture has no shared 30-second traffic extrapolation. Library-many-item and active/idle Bridge measurements require an authenticated running account/device; they are listed as external-only below.

## Verification

All commands below exited 0 unless noted:

```text
npx vitest run convex/parent-m01-boundaries.test.ts convex/m01-workload-measurement.test.ts convex/spectraThreads-read-cost.test.ts convex/spectra-embed-deletion.test.ts convex/parent-m02-boundaries.test.ts src/features/spectra/__tests__/m02-intake-contracts.test.ts --reporter=dot
  6 files, 15 tests passed
npx tsc --noEmit
  exit 0
npx eslint convex/spectraThreads.ts convex/spectraArtifactDeletion.ts convex/artifactEmbeds.ts convex/artifactIntakeLifecycle.ts convex/schema.ts convex/orgTreeShared.ts src/app/api/spectra/route.ts src/features/spectra/sources/records/source-record.ts src/app/api/spectra/run/loop/intake.ts
  exit 0
git diff --check
  exit 0
cargo check --manifest-path bridge/bridge-app/Cargo.toml
  exit 0
npx convex codegen
  exit 1: CONVEX_DEPLOYMENT is not configured in this private checkout
```

The required `LA-M01C` Playwright session reached `http://localhost:3000` with zero page errors on the landing page. The changed `/api/spectra?action=threads&limit=2` path returned `401 Unauthorized` without an authenticated account. This identifies the route, but it is not evidence of an authenticated long-thread, delete, or Bridge journey. No process restart, database reset, primary dependency reinstall, deployment, or hosted billing change was performed.

## Retention and release disposition

| Family | M01 disposition |
| --- | --- |
| Asset/import originals and staging | M02 receipt helper only; retained/native/active rows are not released by M01 |
| Pinned versions/snapshots | Keep pinned version and release snapshot objects only after reference proof |
| Runtime builds and payloads | Page build rows and storage references; payload ownership remains in existing lifecycle tables |
| User states and memory | Delete artifact-scoped user state; redact/delete artifact claims, evidence and relations; capsules are not used as authorization |
| Replicas and Bridge requests | Remove replicas; move non-terminal requests to terminal `failed` with `work-deleted`, leaving audit truth |
| Collaboration | Page updates/snapshots/claims and close empty rooms; W4 checkpoint guards remain authoritative |
| Runs/results/history | Page operation/card/event descendants and run rows tied to the deleted artifact only; thread history for surviving work is retained |
| Embeds and access requests | Tombstone placement rows, cancel pending requests, preserve shared source/pinned references |

## Cost worksheet

Use current official pricing pages at measurement time: [Convex pricing](https://www.convex.dev/pricing), [Convex docs](https://docs.convex.dev/production/hosting), and [Fly.io pricing](https://fly.io/docs/about/pricing/) for the existing compute reference. Hosted counters were unavailable in this private local run; prices are variables, not invented launch claims.

For an account-scoped workload with `N` sessions:

```text
database_io_cost = (N * query_calls_per_session * measured_read_bytes_per_call / 2^30) * database_io_price_per_GiB
storage_cost     = (retained_bytes_GiB * storage_price_per_GiB_month)
egress_cost      = (N * response_bytes_per_session / 2^30) * egress_price_per_GiB
compute_cost     = (worker_seconds * compute_price_per_second)
monthly_total    = database_io_cost + storage_cost + egress_cost + compute_cost + fixed_plan_fee
```

Use the measured workload dimensions and concurrency as inputs. Do not substitute the shared audit's 30-second traffic window for per-user sessions, and do not infer capacity or a monthly bill without hosted read-byte, storage, egress, and compute counters.

## Remaining external-only or unfinished cases

An authenticated browser/device was not available for the requested long-thread scroll-anchor/retry journey, close/reopen secondary panels, disposable imported-artifact deletion through both front doors, offline Bridge replay, or pinned/shared local-file proof. The backend and conversation-surface guards are covered by targeted source/tests, but the live browser path remains unconfirmed. `npx convex codegen` and hosted Convex billing counters remain environment-dependent. No unfinished requirement is relabelled as M02 or as a hosting decision.
