# School: ManageBac in Spectra

The School page brings the student's ManageBac into Spectra: tasks, past work and its files, classes and
timetable. Each student controls what syncs, and when.

## Principles

- **The student decides.** The school connects ManageBac once (the existing school-level connector). From there, each
  student chooses what flows into their own Spectra.
- **Nothing surprising.**
  - Automatic syncs are visible: each kind of data shows its last sync and the next one.
  - Writes back to ManageBac always ask first. They are `irreversible` in [HARNESS.md](../ai/HARNESS.md#permissions).
  - Spectra AI asks before copying a class resource into the Library, as it does for every school sync action.
- **Past work is first-class.** Old tasks and their submitted files are a resource for revision and portfolios, not
  an archive nobody opens.

## Sync preferences

Settings sit on the School page's **Sync** tab, not buried in Settings.

**What each kind of data can do.** Every kind of data has one of three modes:

- **Auto:** kept up to date in the background.
- **Manual:** synced only when the student presses Sync now.
- **Off:** never synced, and nothing is shown for it.

| Data | Default | Notes |
| --- | --- | --- |
| Current tasks and deadlines | Auto | They feed the Calendar and the planner |
| Past tasks (archive) | Manual | The first sync brings in the full history, then it can be set to Auto |
| Dropbox files (the student's own submissions) | Manual | Downloaded on demand, cached once fetched |
| Task resources from teachers | Auto | Attachments and links on tasks |
| Grades and feedback | Auto | Only the student's own |
| CAS | Off | Unavailable, see below |
| Classes and timetable | Auto | Classes become workspaces, as today |
| Calendar events | Auto | School events |

**Per class.**

- A class can be excluded entirely.
- A class can override any mode above. For example, past tasks set to Auto only for the two subjects being revised.

**Sync now.**

- Each kind of data, and the page as a whole, has a Sync now action.
- Progress shows in the page header's status control, in the same pattern as an artifact's (see
  [EDITORS.md](../design/EDITORS.md#the-status-control)).

## Past tasks and dropbox files

- **Tasks tab.** It has three views: Current, Past and All.
  - Past tasks are grouped by class and term.
  - They are searchable by meaning through the semantic layer.
- **A past task's details** show:
  - the brief;
  - the resources;
  - the grade and feedback;
  - the student's submitted files.
- **Submitted files.**
  - PDFs and photos open in Spectra's own viewer, without leaving the task.
  - "Copy into Library" makes an editable artifact from them, which is how documents and slides open in Spectra.
  - Anything Spectra has no viewer for opens in a new tab.
- **Search.** Past tasks and their files are indexed for search, so Spectra AI can say "Use my Year 10 essay on
  Macbeth as a reference".

## CAS

ManageBac doesn't share CAS with the connection a school makes for Spectra, so CAS is unavailable: it never syncs,
and the School page doesn't mention it. The records, queries and AI read stay in place behind that one switch
(`SCHOOL_SYNC_KIND_INFO.cas` in `shared/school-sync.ts`), so a school whose ManageBac does share it can be turned
on without new code.

## What the API allows

Researched from Faria's public ManageBac API guide only; nothing was tried against a live school. Items marked
**live check** are designed for both possible answers behind one adapter (the route's normalization) and need
confirming against a real school before launch.

**Which API.**

- ManageBac has one API: the school-level Public API (`https://api.managebac.com`, versions `v2` to `v2p3`).
  A ManageBac administrator creates an API key and grants it permissions; requests carry it in the `auth-token`
  header. There is no student-facing API and no per-student sign-in (no OAuth).
- So the school connects once (the existing connector), and Spectra acts for each student by asking only for that
  student's records: every personal route names the student's own ManageBac id, which Spectra resolves from the
  student's verified email and never from anything the student types.

**Coverage.**

| Data | Endpoint (v2p2) | What Spectra does |
| --- | --- | --- |
| Classes | `/students/{id}/memberships?archived=true`, then `/classes/{id}` | Synced. Archived classes are included so their tasks become past tasks |
| Timetable | `/classes/{id}/timetable` | Synced. **Live check:** not in the public guide |
| Current and past tasks | `/classes/{id}/tasks` | Synced. A task is past once its class is archived or it was due more than a week ago |
| Grades and feedback | `/classes/{id}/tasks/{task}/students?student_ids={id}` | Synced for tasks already due, the student's own row only |
| Dropbox files | `/classes/{id}/tasks/{task}/submissions/{id}` | The file list syncs; each file downloads when the student opens it (a redirect to short-lived storage) |
| Task resources | `/classes/{id}/resources` | Synced. **Live check:** not in the public guide |
| CAS experiences | `/year-groups/{id}/projects/cas/experiences/students?student_ids={id}` | Unavailable: ManageBac doesn't share it with Spectra's connection |
| CAS reflections, learning outcomes, evidence | None | Kept in Spectra only. The School page says ManageBac can't receive them |
| Calendar events | None | Unavailable: the mode is Off and the School page leaves it out |

- **Writes.** The public API has no endpoints to write CAS reflections or evidence, so nothing is written back to
  ManageBac. If a live check finds one, `CAS_WRITE_BACK` in `shared/school-sync.ts` flips and the write asks first.
- **Term grades** (`/classes/{id}/assessments/term/{term}/grades`) exist but aren't synced: they are per class and
  term, not per task, and the School page has no place for them yet.
- **Shapes.** Memberships, CAS, task results and submissions are each read in either of the shapes the guide
  suggests. **Live check:** confirm which one ManageBac returns.

**Rate limits.**

- The guide documents none. Spectra paces itself: every school has a request budget per minute (default 180), each
  request waits its share, and a `429` pauses the job, which continues a minute later from its last saved page.
- Load is spread by design:
  - each kind of data is its own job with its own schedule (tasks hourly, grades and resources every six hours,
    classes twice a day, past tasks, dropbox files and CAS daily when set to Auto);
  - at most two of a school's student jobs run at once;
  - a job reads only the classes it is set to sync, and grades and submissions only the tasks already stored;
  - a job interrupted by its time budget continues where it stopped.
- **Live check:** watch real response headers for a limit, and tune the budget per school.

**When a permission is missing.**

- A `403` means the school's key wasn't granted that endpoint. The job stops and the School page shows, in plain words,
  what can't be read and that a ManageBac administrator at the school can fix it. A job set to Auto tries again a day later.
- A `401` means ManageBac refused the key itself. The connection is marked as needing the school administrator.
- An endpoint ManageBac doesn't serve is unavailable: its mode is Off and the School page leaves it out, since
  nobody can fix it from Spectra.
- The wording and who can fix each problem live in `describeSchoolSyncProblem` (`shared/school-sync.ts`).

## Engineering notes

- **Preferences.** Per-student preferences live in Convex (one row per student per kind of data, plus class
  overrides). Background sync reads them, and nothing syncs for a kind of data set to Off.
- **Leases.** Syncs reuse the existing lease and lock machinery in `convex/managebac.ts`. Each kind of data is a
  separate sync job, so one slow kind never blocks the others.
- **Files.** Dropbox and evidence files are fetched on demand into storage, deduplicated by content hash, and indexed
  for semantic search.
- **No backwards compatibility.** Current tables and flows can be reshaped freely.
- **Where it lives.** The backend and its client API are described in
  [convex/school.README.md](../../convex/school.README.md).
