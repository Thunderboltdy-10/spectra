# School backend

The backend of the School page ([docs/product/SCHOOL.md](../docs/product/SCHOOL.md)): one student's ManageBac data
in Spectra, and the controls over it. There are no screens here; the School page (lane D3) builds on this contract.

## Where things live

| File | What it holds |
| --- | --- |
| `shared/school-sync.ts` | The kinds of data, their defaults, schedules and availability; the mode rules; error wording and who can fix it; CAS outcomes; file limits. Shared by Convex, the route and the UI |
| `convex/school.ts` | The client API below |
| `convex/schoolSyncSchema.ts` | Tables: `schoolSyncPreferences`, `schoolSyncClassOverrides`, `schoolSyncStates`, `schoolFiles`, `casReflections`, `casOutcomeTags` |
| `convex/schoolSyncShared.ts` | Preferences, job state and scheduling, and what a job may reach (`syncTargets`) |
| `convex/managebac.ts` | Sync jobs (claim, begin, commit, fail, suspend, complete), enforcement of preferences on every committed page, purging, file fetch bookkeeping |
| `convex/managebacVisibility.ts` | The one read check: own school, own records, selected classes, kinds not Off |
| `src/app/api/spectra/managebac/route.ts` | Talks to ManageBac: runs jobs, downloads submitted files |

## Client API

Reads are Convex queries; use them with `useQuery(api.school.<name>, useAuthedArgs({...}))`. Every one of them returns
only the signed-in student's own data. Errors read as `CODE: message`; show them with `readConvexError`.

**Preferences**

- `preferences({})` returns `{ connected, kinds, classOverrides }`.
  - Each kind has `kind`, `label`, `description`, `defaultMode`, `classScoped`, `available`, `unavailableReason`,
    `autoEveryMinutes`, `mode` (what applies) and `chosen` (whether the student picked it).
  - `classOverrides` is `[{ providerClassId, kind, mode }]`.
- `setMode({ kind, mode })`. `mode` is `"auto" | "manual" | "off"`. Off removes that kind's data straight away
  (large sets finish in the background). Auto is scheduled; Manual waits for Sync now.
- `setClassOverride({ providerClassId, kind, mode | null })`. Only for class-scoped kinds and the student's own
  classes. `null` removes the override. An override to Off removes that class's data of that kind.
- Excluding a class entirely is choosing classes: `POST /api/spectra/managebac { action: "selectClasses" }`, as today.

**Sync status**

- `syncStatus({})` returns `{ connection, running, kinds }`.
  - `connection`: `{ state: "connected" | "degraded" | "blocked" | "not_connected", lastSyncAt, problem }`.
  - Each kind: `{ kind, label, mode, available, state, lastRunAt, lastSuccessAt, nextRunAt, nextRunTrigger, problem }`.
    `state` is `"off" | "idle" | "queued" | "running" | "failed" | "blocked"`. `nextRunTrigger` says why the next run
    happens (`"schedule" | "user" | "ai"`).
  - `problem` is `{ code, message, fixBy, fixHint, detail? }`. `fixBy` is `"student" | "school_admin" | "spectra" |
    "wait" | "nobody"`: show `message` and `fixHint` as they are.
- Sync now:
  - `syncSpectraManageBac(kind?)` (`src/features/spectra/data/api.ts`) runs now, in the request: one kind, or every
    kind not Off. It returns `{ jobs, queued }`; `queued` kinds, and jobs with `suspended`, finish in the background.
  - `syncNow({ kind? })` only queues the jobs for the background worker, which picks them up within minutes.

**Classes and tasks**

- `classes({})` returns every class ManageBac lists for the student: `{ providerClassId, recordId, title, subject,
  yearGroupId, academicPeriodKey, archived, selected, modes }`, where `modes` is the effective mode per class-scoped
  kind.
- `tasks({ view: "current" | "past" | "all", providerClassId? })` returns task summaries: `{ recordId, title,
  providerClassId, className, dueAt, status, taskType, term, past, sourceState, provenanceUrl }`. Group past tasks by
  `className` and `term`.
- `task({ recordId })` returns a summary plus `brief`, `resources`, `grade` (`{ score, maxScore, label, criteria,
  feedback }` or `null`) and `submission` (`{ recordId, status, submittedAt, files }` or `null`). Each file has
  `{ providerFileId, filename, mimeType, bytes, state, schoolFileId, tooLarge }`; `state` is `"listed"` until opened.

**Files** (submitted work and CAS evidence)

- Opening a submitted file: `fetchSpectraSchoolFile({ submissionRecordId, providerFileId })` (in
  `data/api.ts`). The first call downloads it from ManageBac into the student's storage; later calls return the kept
  copy. It returns `{ status: "cached" | "fetched", schoolFileId }`.
- `files({ origin? })` lists kept files: `{ schoolFileId, sourceRecordId, origin, providerFileId, filename,
  mimeType, bytes, state, hasText, problem, fetchedAt }`. `origin` is `"dropbox"` or `"cas_evidence"`.
- `fileUrl({ schoolFileId })` returns `{ url, filename, mimeType }` for viewers, or `null` if not kept.
- `removeSchoolFile({ schoolFileId })` forgets a kept copy. A dropbox file can be fetched again.
- "Copy into Library": open the file's `url` and import it through the existing Library import flow.

**CAS**

- `cas({})` returns `{ writeBack, learningOutcomes, experiences, outcomeCoverage }`. `outcomeCoverage` lists each
  of the seven outcomes with the experiences that meet it and whether it's `missing`.
- `casExperience({ recordId })` returns an experience with its `reflections`, `evidence` and `writeBack`.
- `saveCasReflection({ experienceRecordId, reflectionId?, body })` and `deleteCasReflection({ reflectionId })`.
- `setCasOutcomes({ experienceRecordId, outcomes })`, with outcomes from 1 to 7.
- Evidence, in two steps: `beginCasEvidenceUpload({ experienceRecordId })` returns `{ uploadUrl, maxBytes }`; POST the
  bytes there, then `attachCasEvidence({ experienceRecordId, storageId, filename, mimeType })`.
- `writeBack` says what ManageBac can receive. Today nothing: show `writeBack.reflections.reason`.

## How syncing works

- **Jobs.** Each student has one job per kind of data, with its own state row (`schoolSyncStates`), lease and
  schedule. A slow or failing kind never blocks another.
- **Triggers.** `"schedule"` (Auto only), `"user"` (Sync now) and `"ai"` (Spectra AI asking for fresher data). Manual
  kinds run only for `"user"` and `"ai"`.
- **Reach.** Convex decides what a job reads (`syncTargets`): the selected classes whose mode admits the trigger, the
  student's year group for CAS, and stored tasks for grades and submissions. The route reads exactly that.
- **Enforcement.** Every committed page is checked against the student's modes: a job stores only its own kind, a
  record of a kind now Off is removed, and the read check hides anything Off.
- **The worker** (`internal_scheduled_work`) claims due student jobs first, at most two running per school, then the
  school-wide reconciliation of shared routes. A job that runs out of time continues from its last saved page.
- **Search.** Task records, their submitted files' text and CAS reflections reach the semantic index through
  `convex/semanticSources.ts`, readable only by the student.
