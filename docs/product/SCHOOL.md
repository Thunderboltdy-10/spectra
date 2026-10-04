# School: ManageBac in Spectra

The School page brings the student's ManageBac into Spectra: tasks, past work and its files, CAS, classes and
timetable. Each student controls what syncs, and when.

## Principles

- **The student decides.** The school connects ManageBac once (the existing school-level connector). From there, each
  student chooses what flows into their own Spectra.
- **Nothing surprising.**
  - Automatic syncs are visible: each kind of data shows its last sync and the next one.
  - Writes back to ManageBac always ask first. They are `irreversible` in [HARNESS.md](../ai/HARNESS.md#permissions).
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
| CAS | Manual | See below |
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
  - They can be opened in Spectra's viewers (PDF, documents, slides).
  - "Copy into Library" makes an editable artifact from them.
- **Search.** Past tasks and their files are indexed for search, so Spectra AI can say "Use my Year 10 essay on
  Macbeth as a reference".

## CAS

Creativity, Activity and Service. It is the IB Diploma requirement that students track across two years.

- **Experiences.**
  - Each shows its type (C, A, S), its dates, its supervisor and its status.
  - Each opens to its reflections and evidence.
- **Reflections.**
  - Students read them in Spectra and write new ones there.
  - Writing back to ManageBac asks first.
- **Learning outcomes.** The seven outcomes, with which experiences cover each and what's still missing, at a glance.
- **Evidence.** Photos and files, viewable, and copied into the Library on request.
- **Spectra AI.** It can:
  - draft a reflection from the student's notes;
  - suggest which outcomes an experience meets;
  - find gaps before deadlines.

Writing always asks first.

## What the API allows

The F1 lane must first establish what ManageBac's API exposes and how, and write it into this document:

- **Which API.** The school-level API, the student-facing endpoints, or both.
- **Coverage.** Whether there are endpoints for past tasks, dropbox submissions, CAS experiences, reflections,
  outcomes and evidence. Where something isn't available, the UI says so plainly and the mode is Off.
- **Rate limits.** How sync scheduling respects them, since syncs are per student and per kind of data.

Where an endpoint needs credentials or a permission the school hasn't granted, Spectra shows that in plain words, with
who can fix it.

## Engineering notes

- **Preferences.** Per-student preferences live in Convex (one row per student per kind of data, plus class
  overrides). Background sync reads them, and nothing syncs for a kind of data set to Off.
- **Leases.** Syncs reuse the existing lease and lock machinery in `convex/managebac.ts`. Each kind of data is a
  separate sync job, so one slow kind never blocks the others.
- **Files.** Dropbox and evidence files are fetched on demand into storage, deduplicated by content hash, and indexed
  for semantic search.
- **No backwards compatibility.** Current tables and flows can be reshaped freely.
