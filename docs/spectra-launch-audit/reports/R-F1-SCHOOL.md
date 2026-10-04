# R-F1 — School backend

Lane F1, branch `lane/school`, worktree `<local-workspace>`. Binding spec: `docs/product/SCHOOL.md`.
Backend only: no new screens. The School page (lane D3) builds on `convex/school.README.md`.

## Result

- **Per-student control.**
  - Each student now controls their own ManageBac data: Auto, Manual or Off per kind of data, plus per-class overrides.
  - Each kind is its own sync job with its own state, lease and schedule.
  - Preferences are enforced on every committed page and in the one visibility check. Off removes the data.
- **New data.**
  - Grades come from task results, dropbox files from submissions, and CAS experiences are read from under the student.
  - Past tasks come from archived classes and from tasks due more than a week ago.
  - Handed-in files download on demand into the student's own storage. They are deduplicated by content hash and their text is indexed for search.
- **CAS.**
  - Reflections, outcome tags and evidence live in Spectra.
  - The public API has no write endpoints for them, so nothing is written back to ManageBac.
- **Not checked live.** Nothing here was tried against a real ManageBac school; see *Live checks needed*.

## What changed

| Commit | What |
| --- | --- |
| `3cf6bfb8` test(school) | Isolation tests written first (`convex/school-isolation.test.ts`). They cover another student, another school with the same provider ids, unselected classes, kinds turned Off and class overrides. `shared/school-sync.ts` holds the kinds, modes, defaults, schedules, problem wording, CAS outcomes and file limits |
| `ad498215` feat(school) | Per-student per-kind jobs (`schoolSyncStates`), preferences and class overrides, enforcement and purge, `schoolFiles` / `casReflections` / `casOutcomeTags`, the typed API `convex/school.ts`, semantic sources for submission text and CAS reflections, and erasure and purge coverage for the new tables |
| `1b0da96c` feat(school) | The route runs one job per kind and reads only the routes and targets Convex gives that job. It adds the official task-results and submissions routes, the memberships route with `archived=true`, CAS from under the student, `fetchSchoolFile`, 403 as `INTEGRATION_PERMISSION_DENIED`, and a worker that loops due jobs within its budget. Client callers were updated |
| `b57eda3d` docs(school) | SCHOOL.md gets "What the API allows" and "Where it lives". New `convex/school.README.md` holds the client API contract for D3 |
| `37a2e2f1` feat(school) | `managebac:requestAiRefresh` takes an optional `kinds` list and queues only those kinds, never one that is Off |

**Key files**
- `shared/school-sync.ts`
- `convex/school.ts`
- `convex/schoolSyncShared.ts`
- `convex/schoolSyncSchema.ts`
- `convex/managebac.ts`
- `convex/managebacVisibility.ts`
- `convex/semanticSources.ts`
- `src/app/api/spectra/managebac/route.ts`
- `src/features/spectra/data/api.ts`
  - `syncSpectraManageBac(kind?)`
  - `reconcileSpectraManageBacSchool()`
  - `fetchSpectraSchoolFile()`

## Removed (not shimmed)

- The `"bootstrap"` sync kind and the route's `personalOnly` pass. The identity request now runs the classes job (`syncClasses: true`). The schema keeps the `"bootstrap"` literal only so stored run documents still validate.
- The `body.bootstrap` flag on `resolveIdentity`.
- The `"manual"` and `"bootstrap"` arguments of `syncSpectraManageBac`. Its argument is now an optional kind.
- The old `/v2p2/memberships` route. The official manifest replaces stale items by name, path and normalization digest.
- 403 reported as `INTEGRATION_CREDENTIAL_REJECTED`. A 403 is now a missing permission that a school administrator can fix; only a 401 blocks the connection.
- A school admin's "Sync now" no longer runs the school-wide reconciliation. It runs their own student sync. Reconciliation runs in the worker, or on request through `reconcileSpectraManageBacSchool()`.

## Tests and gates

All gates were run in the worktree after the last code commit, unless noted.

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` (root) | pass |
| `npx tsc --noEmit -p convex/tsconfig.json` | pass (re-run after `37a2e2f1`) |
| `npm run lint` | pass (changed files re-linted after `37a2e2f1`) |
| check:architecture, check:copy, check:design-tokens, check:capabilities, check:secrets | pass |
| check:deploy-env | skipped by the script without deploy env (no `.env.local` values read) |
| Focused: `convex/school-isolation.test.ts` | 6/6 |
| Focused: affected convex suites (managebac-*, school-*, semantic, erasure, purge) | 187 pass |
| Focused: managebac route tests (provider fixture, sync budget, and others) | 6 files / 16 tests pass |
| Full `npx vitest run --maxWorkers=3` | **512 files passed, 1 skipped; 4430 tests passed, 1 skipped** |

The full run started before `37a2e2f1`. That commit's files were then run on their own: 58/58 including the action contract.

New coverage:
- **`provider-fixture-route.test.ts`** runs end to end against the local fixture. It checks:
  - the job order;
  - another student's class and CAS dropped;
  - grades only for due tasks;
  - the submission file list;
  - the file fetch: stored, the API key never sent to signed storage, text extracted, and cached on the second open;
  - a single-kind sync;
  - dropbox Off removing files and submissions while keeping grades.
- **`sync-budget.test.ts`**: the worker runs two student jobs, each reading only its kind and its target classes.

## Live checks needed

1. The `/v2p2/students/{id}/memberships?archived=true` path and its response shape (`memberships.classes`, `memberships` or `classes`).
2. CAS:
   - the route `/year-groups/{id}/projects/cas/experiences/students?student_ids={id}`;
   - which shape comes back (nested under `students[]` or flat);
   - whether the year-group id from `/students` is the one CAS expects.
3. The task-results shape for `?student_ids=`, and the submissions shape (`submission`, `dropbox` or bare). A 404 is treated as "no submission".
4. `files[].download_path`: confirm it redirects to short-lived storage that needs no key, and that file sizes are reported.
5. `/classes/{id}/resources` and `/classes/{id}/timetable`. They are not in the public guide; if they are missing, the kind shows as unavailable.
6. Rate limits. The guide documents none. Watch the headers on a real school and tune `requestBudgetPerMinute` (default 180).
7. Whether any CAS write endpoint exists. If one does, flip `CAS_WRITE_BACK` in `shared/school-sync.ts` and add a write that asks first.
8. A 403 on a real key missing a permission: confirm the School page wording and the daily retry.

## Decisions

- **Jobs and reach.**
  - There is one job per student and kind. Convex decides each job's targets (`syncTargets`); the route never chooses them.
  - A targeted job's reach is snapshotted when it starts.
  - Student jobs read only personal routes; the school reconciliation reads only shared ones.
- **Concurrency.** At most two student jobs run per school at once. Student jobs are claimed before the reconciliation.
- **Requests and worker.**
  - Sync now runs what fits in the request's time budget.
  - Remaining kinds are queued (`school:syncNow`), and a job that runs out of time continues in the worker from its last saved page.
  - The worker loops claims, up to 8 per invocation. A failing job is recorded and does not throw.
- **Off.**
  - Off purges the records and their derived rows.
  - Planner artifacts the student made are kept, and official calendar items are marked removed.
  - A task that becomes past follows past tasks' mode.
- **Errors.**
  - `INTEGRATION_PERMISSION_DENIED` (403) ends that job. An Auto job retries a day later.
  - Credential, token, identity and rate-limit errors stop every job in the request.
- **Isolation guards.**
  - Personal routes always name the student's own provider id, which comes from their verified email.
  - Rows owned by another user are dropped (`ownerIdPath`).
  - Single-record routes refuse more than one row (`INTEGRATION_ROUTE_BROAD`).
- **Files.**
  - Files are fetched by the student's own request. The redirect is followed once, without the auth header, and only to a public host.
  - Files are capped at 50 MB.
  - Convex checks the sha256 and size against what storage measured, and deduplicates per student by hash.
  - Text extraction reuses `prepareAttachments`.
- **Not built.** "Copy into Library" is `fileUrl` plus the existing Library import flow.
- **Not synced.** Term grades exist in the API but aren't synced: they are per class and term, and the School page has no place for them yet.
- **Identity runs** don't degrade the integration's status.
- **AI refresh.** The cooldown is 15 minutes, or 2 minutes when forced. It now queues jobs (trigger `"ai"`) rather than running a sync.

## Notes for other lanes

**Lane A2b (AI tools)**

- **`trigger_managebac_sync`** (`src/app/api/spectra/run/harness/effects.ts`) should pass `kinds` to `managebac:requestAiRefresh`, mapped from the purpose:

  | Purpose | Kind |
  | --- | --- |
  | `upcoming_deadlines` | `current_tasks` |
  | `class_resources` | `task_resources` |
  | `timetable` / `classes` | `classes` |
  | `cas` | `cas` |

  Grades map to `grades`, and past work to `past_tasks`. Without `kinds`, every kind not Off is queued.
- **`read_school_data`** can use `api.school`: `tasks({view:"past"})`, `task({recordId})` (grade, feedback, submission files), `files`, and `cas` / `casExperience` (reflections). Submission text and CAS reflections are already in the semantic index, readable only by their owner.

**Lane D3 (School page).** The full contract is in `convex/school.README.md`. Errors carry `fixBy` and `fixHint`; show them as they are.

**Orchestrator**
- `src/features/spectra/pages/spectra-shell.tsx` has a one-line compile fix: `syncSpectraManageBac()` lost its `"manual"` argument.
- The same one-argument change is in `calendar-application.tsx`, `school-data-shell.tsx`, `managebac-integration-shell.tsx` and the class-shelf components.
- `convex/_generated/api.d.ts` was hand-edited to add `school`.
- Main was not merged into the lane.
