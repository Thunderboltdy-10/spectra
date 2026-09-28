# P2 — Resumable ManageBac sync

Branch `p2/sync-resume`, from main 2daf67bf. Perspective: the SRE on launch night, watching a large school's
first ManageBac sync.

## Findings ledger

### Fixed

| Severity | Finding | Where |
| --- | --- | --- |
| High | A sync that needs more than one request never completes. `runSync` kept its page position and seen keys only in request memory. At the 240 s budget the run failed with `INTEGRATION_SYNC_TIME_BUDGET`, and every retry restarted at page 1, so removed provider records were never reconciled. | `src/app/api/spectra/managebac/route.ts:1387` (runSync), `convex/managebac.ts:3713` (completeSync) |
| High | A request killed by the platform threw its work away. The expired lease was failed as `lease_expired`, and the next sync started again. | `convex/managebac.ts:163` (activeRunForScope) |
| Medium | Admin-scope seen identity keys were wrong. The route computed `account:<adminId>` for `mapped_user` records, while the server stores `account:unknown`. School reconciliation could tombstone and revive the same records on each pass. Seen keys are now computed server-side at commit. | `convex/managebac.ts:449` (recordPassPage) |
| Medium | `completeSync` received every seen key as mutation arguments, so a large school would exceed Convex argument limits. Seen keys now live in bounded rows in `externalSyncSeenKeys`. | `convex/schema.ts:1208` |

### How the pass works now

**Pass state.** `externalSyncRuns.cursorState` holds the pass:
- when it started;
- the routes it finished;
- the last committed page, with its binding and cursor;
- the class and year-group ids learned for fan-out.

Every `commitNormalizedPage` carries signed `progress` and writes the page's seen keys to `externalSyncSeenKeys`.

**Suspend.** When a request hits its time budget or is rate limited, the route calls `managebac:suspendSync` (operation
`sync-suspend`, `convex/managebac.ts:3637`) and answers 200 with `suspended: true`. The run becomes `partial/suspended`.
- For the school (admin) scope, the next scheduled claim is booked 30 s to 30 min later.
- The client repeats a paused manual sync, up to 12 requests (`src/features/spectra/data/api.ts`).
- A pass whose request was killed is also suspended when its lease expires.

**Resume.** The next `beginSync` or `claimScheduledSync` for the same scope takes the pass over under a fresh lease.
- The route skips the routes the pass already finished and the bindings before its position, which are sorted.
- It re-reads the last committed page, so records that shifted up a page while the pass waited are not skipped.

**A newer sync while one is part-way.** A live lease answers `INTEGRATION_SYNC_BUSY`. A paused pass is continued,
unless one of these changed since it began (`passRestartReason`, `convex/managebac.ts:364`):
- personal-only vs full sync;
- the connection (base URL, auth header or scheme, credential fingerprint);
- the manifest version or readable routes;
- the followed classes or the selection revision.

It is also restarted past 40 requests or 24 h. A restarted pass is cancelled as `restarted` / `INTEGRATION_SYNC_RESTARTED`,
closed without reconciling, and a fresh pass starts.

**Reconciliation.** It runs only in `completeSync`, which the route calls after every route has been read.
- It covers only the `full_reconciliation` routes the pass recorded as finished.
- It works in batches of 100 records (`reconcileSyncPass`, `convex/managebac.ts:3857`). The batches continue themselves
  under a reconcile lease that a disconnect stops.
- A record is not removed if it was created, or re-marked available or changed, after the pass began, because another
  sync touched it while this pass was paused (`removeUnseenSource`, `convex/managebac.ts:3945`).
- The projection, tombstone, conflict and fan-out semantics are the same code as before, moved.

**Revoked connection.** `disconnect` cancels a paused pass as well as live runs (`convex/managebac.ts:1105`). Later
commits and resumes are fenced, and the pass's seen keys are purged.

**Cleanup.** Seen keys are deleted in batches of 500 when a pass closes: completed, failed, restarted or disconnected.
School purge (`PURGE_SCHOOL_TABLES`) and account erasure (the sync-run drain in `convex/accountErasure.ts`) delete them
too.

**Tests.**
- `src/app/api/spectra/managebac/__tests__/resumable-sync.test.ts` runs the real route against convex-test. It covers:
  - a 10-page school finished in 3 requests, with pages 1-4, 4-7 and 7-10 read;
  - no removal before the pass ends;
  - a record added mid-pass that is kept;
  - a restart on connection change;
  - a disconnect mid-pass.
- `sync-budget.test.ts` now asserts suspend and progress. It is a contract change, explained in the commit.

### Reported, not fixed

- **Medium — `platformOverview` collects every account** (`convex/administration.ts:2014`, `:2017`).
  - The 30-day-active figure is a range over `lastSeenAt`, so a plain counter cannot answer it.
  - A correct fix needs a new `@convex-dev/aggregate` instance keyed by `[status, lastSeenAt]`. Every account insert,
    status change and `lastSeenAt` touch would have to write through it.
  - It also needs a backfill, and registration in `convex/convex.config.ts` and in every convex-test that writes
    accounts.
  - That is not cheap, so per the coordinator's reprioritisation it is left for a dedicated change.
- **Low — `lifecycleExportUrl` collects its part rows** (`convex/administration.ts:3437`). Skipped per the
  reprioritisation; no work had started.
- **Low — governance reads each agent's full history** (`convex/administration.ts` ~100-112). Skipped per the
  reprioritisation; no work had started.
- **Low — personal-scope passes are not scheduled.** A paused personal (student) pass continues only on that user's
  next sync, or through the client's repeat loop. Personal routes are small, so this matters only for a user with very
  many followed classes.

### Rejected as not real

- Restarting a pass whenever any record changes mid-pass. The re-read of the last committed page, together with the
  guard on records created or changed after the pass began, already keeps reconciliation conservative. Restarting would
  starve a busy school.

## Needs live verification

1. Connect a large ManageBac tenant, or a throttled fixture, whose school reconciliation takes more than 4 minutes.
   Confirm:
   - the run shows "Paused part-way";
   - the scheduled worker resumes it within about 30 s;
   - it ends `completed` with removals applied only then.
2. Kill the route mid-sync (for example with a deploy). Confirm the next sync resumes the same run (same `syncRunId`,
   stage `resuming`) instead of starting at page 1.
3. Change the school token while a pass is paused. Confirm the old run shows "Replaced by a fresh sync" and the new
   pass starts at page 1.
4. Press "Sync now" as a student with many classes. Confirm the button stays busy across the repeat requests and ends
   with a completed run.
5. After a completed large pass, confirm `externalSyncSeenKeys` for that run drains to zero on the deployment.
