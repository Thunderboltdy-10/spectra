# Planner task artifact plan

## Product and model

The planner task inherits the artifact standard and must be rebuilt inside the current Spectra shell; the legacy reference is domain inspiration, not shell authority. A task is a focused, shareable work object that also projects into timetable/calendar views.

Content: title, rich description, status, priority, start/due instants, all-day flag, IANA timezone, estimate, progress, stable subtasks, tags, reminders, recurrence rule/exceptions, assignees/watchers, linked artifacts/resources, source link, personal overlay, completion/archive state. Comments/activity/history are shared services. Attachments are resource references.

External ManageBac assignments create source records plus user-owned planner overlays or explicit task artifacts. Source title/deadline/instructions remain provenance-bearing; user fields such as personal due target, notes, status, reminders, subtasks, and placement remain editable. Source changes produce compare/rebase, never silent overwrite.

Collaboration uses transactional fields plus CRDT rich description/subtasks where needed. Concurrent completion/reorder/date changes have domain merge rules and activity. Recurring series edits ask this occurrence/future/all. Time handling preserves timezone/DST intent; notification scheduling is idempotent.

AI can create/triage/decompose/estimate/link tasks, propose priorities and study sessions, update selected fields, and explain schedule impact. Consequential rescheduling, recurrence changes, assignments to others, or bulk completion require preview/approval. Focused edits include preservation assertions to avoid the current date/time normalization failures.

## UI, failure, migration

Full screen and panel show essential fields, subtasks, description, attachments, activity, source changes, Details/Comments/History. Card/embed emphasize due/progress/source. Mobile prioritizes capture and completion. Timetable drag creates a proposed schedule update with timezone/source rules.

Handle overdue, missing timezone, invalid recurrence, notification failure, revoked assignee, deleted source, offline completion, and duplicate reminder. Migrate current planner-task content with explicit timezone conversion report, stable subtask IDs, and source separation; do not infer lost times.

## Tasks

### TASK-01 Define task, subtask, recurrence, reminder, assignee, source, and overlay schemas

- [ ] Implemented
- [ ] Independently verified

### TASK-02 Build capture/full/panel/card/embed/history and timetable projection experiences

- [ ] Implemented
- [ ] Independently verified

### TASK-03 Implement collaboration and domain merges for fields, subtasks, assignment, and completion

- [ ] Implemented
- [ ] Independently verified

### TASK-04 Implement timezone/DST, recurrence exceptions, notification delivery, retry, and deduplication

- [ ] Implemented
- [ ] Independently verified

### TASK-05 Implement ManageBac source overlays, provenance, stale compare, rebase, detach, and deletion

- [ ] Implemented
- [ ] Independently verified

### TASK-06 Implement AI create/decompose/estimate/plan/edit with preservation and approval policies

- [ ] Implemented
- [ ] Independently verified

### TASK-07 Implement permissions for assignees/watchers/shared tasks and private personal overlays

- [ ] Implemented
- [ ] Independently verified

### TASK-08 Migrate current tasks with timezone report and prove reminders, concurrency, restore, and offline recovery

- [ ] Implemented
- [ ] Independently verified

