# Planner task artifact plan

## Product and reference contract

Planner Task inherits the artifact standard and projects coherently into Home, workspace Board/Timeline, and Timetable without becoming duplicate records. `04_planner_task_editor.png` is the executable full-screen specification for structure, fields, hierarchy, details, linked artifacts, and AI treatment. Every visible control must work; common capture/completion/dates are obvious while recurrence, source, assignment, and automation use progressive disclosure.

Tasks are private by default. Read-only/modify sharing, assignees/watchers, workspace-projected access with per-task removal, and explicit public access are enforced server-side. Personal overlays remain private even when the source task is shared.

## Model, source overlays, and time

Content: title, rich description, status, priority, start/due instants, all-day flag, IANA timezone, estimate, progress, stable subtasks, tags, reminders, recurrence rule/exceptions, assignees/watchers, linked artifacts/resources, source link, personal overlay, completion/archive state. Comments/activity/history are shared services; attachments are permissioned resources.

Verified ManageBac records create normalized source records plus source-linked tasks and user overlays during automatic first sync. Source-owned title, deadline, instructions, assessment/class identity, and provenance are distinct from editable personal target date, notes, status, reminders, subtasks, placement, and links. First sync is idempotent and links class workspace/timetable/task/artifacts. Later sync compares source hashes/versions, applies safe non-conflicting source fields, preserves overlays, tombstones/removes source projections without deleting user work, prevents duplicates, and sends consequential/ambiguous conflicts to review. Detach preserves user work and records lost provenance behavior.

Timezone and DST intent are explicit. Recurring edits ask occurrence/future/all. Notification delivery is idempotent, retryable, deduplicated, and auditable.

## Collaboration, AI, effects, and history

Transactional fields plus CRDT description/subtasks synchronize live. Stable regions include each task field, subtask field, description block, reminder, recurrence rule, and source overlay field. Same-region changes are exclusive/queued; independent fields proceed concurrently. Presence/comments are region-aware. Network loss exposes reconnect/unsynchronized/recovery and does not accept offline completion.

The on-demand task skill defines when tasks are appropriate, regions, source authority, inspection, create/triage/decompose/estimate/link/schedule operations, preservation, validation, approvals, and cross-artifact effects. Consequential rescheduling, recurrence changes, assignment to others, source overrides, or bulk completion require preview/approval. Real effects bind to the changed title/date/status/subtask/link and clear after every terminal state.

Human edit sessions and each coherent AI batch create distinguishable history. Before AI touches uncheckpointed human state, create a user checkpoint. History compares typed fields and source/overlay layers; restore creates a new current version and never rewinds the external source. Timetable and workspace projections update live from source identity.

## Import, export, failures, and migration

Support CSV/TSV task imports with mapping, Todoist-compatible CSV where feasible, ICS VTODO import/export where fidelity permits, and JSON portable interchange. Reports cover timezone, recurrence, reminders, assignees, links, source provenance, and unsupported fields; imports are quarantined and recoverable. Export never leaks inaccessible linked artifacts or private overlays.

Full, panel, quick capture, card, live/pinned embed, history, workspace/timetable projection, narrow, touch, and reduced-motion representations are complete. Failures include overdue/invalid dates, missing timezone, invalid recurrence, reminder failure, revoked assignee, stale/removed source, duplicate source, reconnect, occupied field, partial AI work, permission loss, and import quarantine.

## Tasks

### TASK-01 Define task/subtask/recurrence/reminder/assignee/source/overlay schemas, stable regions, manifests, validation, and migrations

- [ ] Implemented
- [ ] Verified

### TASK-02 Build exact reference plus capture/full/panel/card/embed/history and consistent Home/Board/Timeline/Timetable responsive projections with every control functional

- [ ] Implemented
- [ ] Verified

### TASK-03 Implement live field/description collaboration, comments/presence, exclusive region control, reconnect/recovery, coherent versions, checkpoints, and restore

- [ ] Implemented
- [ ] Verified

### TASK-04 Implement timezone/DST, recurrence exceptions, notification delivery/retry/deduplication, validation, and failure recovery

- [ ] Implemented
- [ ] Verified

### TASK-05 Implement ManageBac automatic first-sync creation and safe later hashes/overlays/provenance/rebase/detach/tombstone/conflict/duplicate policy

- [ ] Implemented
- [ ] Verified

### TASK-06 Implement on-demand task skill, typed AI create/decompose/estimate/plan/edit operations, preservation/approvals, real field effects, cleanup, and reduced motion

- [ ] Implemented
- [ ] Verified

### TASK-07 Implement private-default grants, workspace exceptions, assignee/watcher policy, private overlays, embed/context filtering, and mid-run revocation

- [ ] Implemented
- [ ] Verified

### TASK-08 Implement CSV/TSV/Todoist/ICS/JSON import/export with mapping, quarantine, fidelity, provenance, recovery, and tests

- [ ] Implemented
- [ ] Verified

### TASK-09 Migrate current tasks with explicit timezone/source reports, remove legacy branches, and prove every actual UI control, reminders, mixed collaboration, history, embeds, sync, and recovery

- [ ] Implemented
- [ ] Verified

