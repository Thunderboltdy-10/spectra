# S11 SCHOOL — preserve personal task state through ManageBac refresh

Date: 2026-09-25. Worker: `01a0d847-532e-7061-9f90-ea0fc9e52ab3`. Coordinator: `01a0d83f-92fb-7b80-9ea4-99fcecef20aa`.

## Bounded result

ManageBac refresh no longer reactivates completed, cancelled or removed Calendar tasks, overwrites their personal title/notes, or resets their scheduling timezone/precision. The separate official deadline still receives provider title, instructions and deadline updates. Untouched copied title/notes follow the provider field by field; divergent personal values, including an empty note, survive. Missing or mismatched previous source baselines are treated conservatively. Stable task/deadline IDs, source links, original authorship and scheduled blocks are preserved.

This unit changes only `convex/calendarShared.ts`, adds `convex/managebac-task-calendar.test.ts`, and adds this report. It makes no schema, authority, ManageBac dispatcher, planner editor, read-model implementation or UI changes. It is a repair candidate, not launch acceptance.

## Environment and source evidence

- Starting HEAD: `d9aabfb5735bdcd8a620af8a7bdaa85aba08d150`.
- Isolated checkout: `<local-workspace>`; branch `codex/s11-school`.
- Effective session `turn_context` independently read: `gpt-6-astra`, `xhigh`, `danger-full-access`, approval policy `never`. Coordinator independently confirmed the same configuration.
- Read the full integration `S11-CHARTER.md` and `.spectra-local/launch-s11/USER-BRIEF.md`, plus the coordinator's original request via `read_thread`.
- Original audit coordinator identified through `session_index.jsonl`: `01a07de0-958e-7d80-8ff7-4533962a2170`, “Audit Spectra for launch readiness”.
- Actual historical conversations inspected: W7-09 `01a09504-21a3-72c2-b234-00d93a00cdb1`; W9-02 `01a09d09-ab9b-7531-8a20-dc5afadfd442`; S9-EDGE `01a0d3fe-5f87-7ad3-9be3-2d3c2305c450`; S10 PLATFORM `01a0d338-89d6-7a01-bb52-5e000de103de`.
- The S9-EDGE original turn `01a0d3fe-6495-7083-8157-b42262e22e1f` explicitly states its implementation `22198903` added/ran no tests. Its unchanged-hash guard was reviewed in actual code, not accepted from the report.
- Node `v24.11.1`, Vitest `4.1.9`. Dependencies were restored centrally by RUNTIME; this checkout uses an authorized `node_modules` junction to primary. No installation or changes to that target were performed here.
- No shared runtime, browser, native Office, backend publication, school/provider mutation or deployment occurred. All test identities, source payloads and signatures are disposable local fixtures. All tests used one Vitest worker.

## Decision review

| Source decision | Original finding and implementation | Current call-path evidence | Verdict and consequences | Evidence / residual |
| --- | --- | --- | --- | --- |
| `22198903`, S9-EDGE P1-10; original turn above | Identical provider sync overwrote personal tasks. Added an early return only for active tasks with the same hash. | `commitNormalizedPage` → `projectRecord` → `ensureTimetableProjection` → `upsertSourceCalendarItem`; the task guard excluded completed/cancelled/removed states. | **Replace the incomplete guard.** Source-row refresh and personal-task merge are separate. All personal lifecycle and scheduling fields survive every source hash. | Final 16-case suite: original source 14 failures / 2 passes; repaired source 16 passes. |
| Source deadline / schedulable task split in `calendarShared.ts` (pre-S9), retained by `22198903` | Source creates a locked official deadline and a separate unlocked task linked through `officialDeadlineItemId`. | `ensureTimetableProjection` and `safelyRefreshProjection` both use the same helper. `scheduleTask` creates another row for a work block and carries the official deadline link. | **Keep.** Provider truth must advance independently from personal planning. No new storage layer or schema. | Offset-aware deadline change across Madrid DST advances by 25 hours; exact scheduled block and replay remain unchanged. Official removal by a student remains rejected. |
| Prior changed-hash behavior in `calendarShared.ts` | A changed hash unconditionally wrote title, notes, status, timezone, all-day flag and precision into the personal task. | `taskPatch` in the baseline resets status to active and precision to unknown; starts/ends remain, producing an inconsistent personal schedule. | **Replace.** Only copied text equal to the previous locked source row can advance. Provider metadata remains current. Without a matching source hash baseline, retain personal text. | Customized and untouched fields, explicit note clearing, old baseline mismatch and provider-withdrawn due date covered. A personal edit exactly equal to source text is indistinguishable from an untouched copy; this unit adds no field-touch ledger. |
| W7-09 original turn `01a09504-4653-7121-a74a-a875a21df0ad`, `d13d54e1`; identity/follow decisions in `5bda4f18`, `d7713584`, `22198903` | Class selection, retention and academic-period identity govern whether school content follows updates. | `classFollowPolicy`, `sourceIdentityKey`, `projectionSourceKey` run before the shared calendar helper. | **Keep within this unit.** Do not bypass opt-in to make fixtures pass. Do not conflate period identity with authorization. | Selected → deselected keep → selected retains personal task; a new academic period creates a separate task for reused provider ID. SECURITY separately investigates period-aware inherited authority. Four old tests omit required selections and already fail on baseline. |
| W9-02 turn `01a09e6b-29a6-77d3-b85e-6d6570ac5047`, `8e54045d`; paging `d7713584` | Canonical scans replaced by compact Calendar rows, buckets and bounded continuation streams. | `orgNodeMutation` maintains Calendar projections after real mutations; `calendar.overview` uses compact rows and exact target lookup. | **Keep projection/write seams.** The repair performs no full-account scan, migration or rebuild. **Needs repair separately** for the missing imported-task feed. | Existing Calendar bounded and pagination suites pass. New tests verify canonical and compact personal states agree. See R1 below. |
| S9-EDGE P1-19 and shared Calendar time handling | School timezone bucketing and explicit AI civil-time handling prevent browser-zone errors. | Source helper currently uses `Date.parse`; verified period maps use their separate conversion helper. This repair leaves those contracts intact. | **Keep offset-aware source timestamps; needs more evidence for civil/date-only source inputs.** Do not imply this is a full DST audit. | Exact offset-bearing fall-back transition and work-block identity pass. Gap/fold period-map and date-only assumptions remain R4. |
| ManageBac source omission / tombstone behavior, `d7713584` retention | Missing sources mark projections removed; kept class projections should not be reconciled as followed. | `markProjectionSourceRemoved` changes the official Calendar projection and planner source status. The distinct task is not directly marked stale there. | **Needs separate lifecycle unit**, as coordinator requested. Do not silently delete personal work to solve a source freshness problem. | R3 below; not repaired or claimed accepted. |
| Current Plan expanded detail | Date input is disabled only by `officialDeadlineRef`; historical single-task normalization should retain the source boundary. | `normalizePlanContent` constructs a new task without transferring root `source` or an official deadline reference; `PlanStudio` consumes it. | **Needs functional repair before cosmetic polish.** Preserve source ownership through normalization and persistence first. | Independent local reproduction confirms missing `officialDeadlineRef`; full write/security impact remains to test. R2 below. |

## Reproduction and validation

The committed test fixture uses real `convex-test` schema, aggregate registration, signed `commitNormalizedPage`, actual projection triggers and public Calendar mutations/queries. Its test-only task editor models persisted personal edits through the real mutation wrapper, so compact read models update just as they do in application mutations. It makes no HTTP/provider call and requires no live server or credentials.

Baseline was tested by temporarily replacing only this worker's `calendarShared.ts` with the exact `git show HEAD:convex/calendarShared.ts` content, running the suite, then restoring the repair in `finally`. No other checkout was altered.

| Check | Result |
| --- | --- |
| New final 16 tests against `d9aabfb5` helper | **14 failed / 2 passed**, expected pre-fix failures. |
| New final 16 tests against repaired helper | **16 passed**. |
| New tests + Calendar idempotency, bounded discovery, pagination, ManageBac scheduling and client Calendar time-intent suites | **42 passed**, 6 files, one worker, final run 8.81 s. |
| Existing ManageBac isolation / retention | **9 passed / 4 failed**, identical failures reproduced separately with the original helper. No test weakened or skipped to report success. |
| Scoped ESLint for both code/test files | Passed. |
| `git diff --check` | Passed. |
| Full TypeScript / full suite / build / live browser / provider acceptance | Not claimed. Heavy check requested through coordinator; integrated checks remain a release gate. |

Re-run the focused acceptance:

```powershell
node node_modules/vitest/vitest.mjs run convex/managebac-task-calendar.test.ts convex/calendar.test.ts convex/calendar-bounded.test.ts convex/calendar-pagination.test.ts convex/managebac-scheduling.test.ts src/features/spectra/__tests__/calendar-time-intent.test.ts --maxWorkers=1
node node_modules/eslint/bin/eslint.js convex/calendarShared.ts convex/managebac-task-calendar.test.ts --max-warnings=0
```

The 16 cases cover every active/completed/cancelled/removed state with unchanged and changed source hashes; preserved personal title, notes, schedule, timezone and all-day precision; exact compact projections; repeated refresh; public student removal and official-lock rejection; fieldwise copied-text updates and note clearing; missing previous baseline; stable schedule replay across DST; selected class opt-out/rejoin; academic period rollover; administrator parity; source deadline withdrawal; and bounded helper replay.

### Existing failures retained

`convex/managebac-isolation.test.ts`: “refreshes a calendarItems timetable projection and removes it without duplicates” at line 907 (zero projections), “refreshes a legacy timetable projection in place before upgrading its id” at line 1208 (old title), and “keeps personal overlay notes when a deadline source hash refreshes” at line 1750 (no conflict). `convex/managebac-retention.test.ts`: “keeps one account's shared projection while other accounts still receive updates and removals” at line 40 (missing initial projection).

All four encounter missing selected-class fixture state after the S9-EDGE opt-in guard. Correct the fixtures with actual authorized selection/membership state, retain their original lifecycle assertions, and rerun before treating those paths as accepted. Do not restore implicit class following.

### Cost evidence and limits

The helper test seeds 40 unrelated Calendar rows, each with a 20,000-character body, and instruments actual rows returned by its indexed reads. An identical replay of a removed task changes from **3 queries / 3 returned canonical rows / 2 writes** in the original helper to **2 queries / 2 rows / 0 writes** after this repair. The two serialized returned rows total less than 10,000 bytes; unrelated rows are not returned. This is helper-level deterministic evidence, excluding trigger costs, provider requests and the rest of the sync mutation. It is not a client-response-size claim, production latency measurement or Convex billing estimate. Initial imports still have legitimate writes. No cold/warm production, network, browser-memory or provider-budget measurements were made.

Private evidence is under `.spectra-local/launch-s11/school/`: `baseline-final-tests.log`, `final-passing-tests.log`, `baseline-existing-tests.log`, `focused-tests.log`, `residual-tests.log`, `residual-cases.txt`, and the dependency-free preliminary `repro.mjs`.

## Residual repair units for coordinator allocation

1. **R1 — Imported task discovery and duplicate planner identity.** Reproduced through the actual signed import fixture and `calendar.overview`: `unscheduledTasks` is empty and both unscheduled/planner cursors are null despite an active imported task. `calendar.ts:264` excludes every `sourceProvider` task, while `readPlannerTasks` suppresses the fallback when an active source task exists. The UI's Unscheduled plans panel consumes only this feed. Choose one canonical schedulable representation and preserve completion/removal semantics, source deadline links and bounded paging. Expected scope: `convex/calendar.ts`, direct Calendar tests, potentially projection links. No authorization changes needed merely to fix discovery.
2. **R2 — Plan normalization, source lock and expanded detail.** Reproduced `normalizePlanContent` dropping the historical imported root boundary and producing no `officialDeadlineRef`; the expanded Due input checks that reference. Audit persisted edits and server validation before implementing. Expected scope: `src/features/spectra/plan/model.ts`, `plan-studio.tsx`, planner normalization/schema/write tests and source projection mapping. Preserve official truth and expose a clearly personal target date; then make modest detail UX adjustments. No visual redesign was attempted here.
3. **R3 — Missing/restored source lifecycle and planner/task convergence.** Trace `markProjectionSourceRemoved`, class Keep, source restoration, source freshness and notification paths. Personal completed/removed tasks now remain so on refresh, but missing-source handling itself remains unchanged. Determine how the retained personal task signals stale/removed source without deleting the user's work; use portable sync fixtures and no real provider writes.
4. **R4 — Source time precision.** Test spring gaps, fall folds, invalid date-only dates, source date-only deadlines, different school/user zones and period-map changes without a provider hash change. `zonedDateTimeToUtc` uses iterative guessing while the shared AI Calendar converter has explicit disambiguation; the unchanged official-row hash shortcut can retain obsolete map-derived times. Keep official instants authoritative and avoid silently inventing a duration. Current pass proves only explicit-offset DST behavior.
5. **R5 — Authority and bounded school retrieval.** SECURITY owns the academic-period inherited-membership investigation. Current `recordsForPurpose` caps before some filters; S10 PLATFORM's actual conversation flags this independently. Review ordinary-student/admin visibility, class re-enrollment and selected/inherited access with SECURITY before any filtering changes. Query-cost and completeness claims require real row counts/bytes, not small HTTP bodies.
6. **R6 — Repair four stale class-selection test fixtures.** Retain baseline failures above until their setup models the accepted opt-in behavior. Then rerun existing removal, legacy projection and overlay-conflict cases and keep substantive failures visible.

The new helper cannot recover personal values already overwritten by earlier syncs; it prevents subsequent loss. Existing user data needs no migration to receive the fix.
