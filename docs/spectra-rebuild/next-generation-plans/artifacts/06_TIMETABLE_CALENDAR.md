# Timetable and calendar artifact plan

## Product and reference contract

This artifact inherits the standard and unifies academic time without pretending every event has the same authority. `19_timetable_calendar.png` is the executable full-screen specification for navigation, week/day/agenda language, mixed event hierarchy, sidebars, details, and AI composition. Implement every visible control plus month, accessible agenda, print/export, panel/card/embed/history, responsive/touch, and source/conflict states through the same visual system.

Calendars are private by default. Read-only/modify sharing, workspace projection exceptions, explicit public choice, and viewer-specific filtering are enforced. Sharing a calendar or view never exposes a private external/source layer or inaccessible linked artifact.

## Model, sources, and synchronization

Content contains stable calendars/layers, event series/occurrences, study sessions, availability, display preferences, reminders, overlays, and links. Events preserve UTC instant, IANA timezone, local start/end intent, all-day dates, recurrence/exceptions, source/version/hash/provenance, status, location/video, participants/audience, availability, and linked tasks/artifacts. Personal overlays store color, note, reminder, hidden state, alternative target, and links separately from source-owned fields.

The first verified ManageBac sync automatically/idempotently creates readable timetable/source layers, class meetings, assignments/assessments/deadlines, and links to class workspaces/tasks. Later sync leaves unchanged records untouched, applies safe source-field changes from hashes/versions, preserves overlays, tombstones/detaches removals, avoids duplicates, and routes ambiguous/consequential reorganization to review. External records remain immutable sources; the client cannot substitute another user ID.

Shared local calendars use live self-hosted Yjs/domain operations. Stable regions are event field, occurrence, series rule, overlay field, study block, and layer setting. Same-region edits are exclusive; independent events/fields proceed. Presence supports co-planning without noisy cursor traces; comments anchor to event/series. Network loss shows reconnect/unsynchronized/recovery and does not accept offline edits.

## AI skill, effects, history, interoperability

The on-demand time skill defines when to create/use a calendar, layer authority, regions, inspection, schedule/replan/link operations, constraints, validation, approvals, and relationships. AI inspects only permitted deadlines, availability, preferences, estimates, and schedule; proposes study blocks; replans; links materials; and explains tradeoffs. Creating/moving/deleting shared events, overriding source dates, recurrence changes, or bulk plans require preview. Locked events, sleep, accommodations, and hard constraints outrank optimization.

Actual time regions animate: a block forms/moves/resizes, a source badge changes, or a link/reminder appears. Independent changes can animate concurrently; all effects clear after every terminal state and reduced motion remains complete.

Human sessions/source-refresh manifests and every coherent AI batch are distinct history entries. AI checkpoints unversioned human state first. History renders the visible range with synchronized event selection, distinguishes source/overlay/human/AI changes, and restore creates a new current local/overlay version without rewriting external truth.

Support ICS import/export/subscription, CSV event imports, and staged adapters/exports from major Google/Microsoft calendar formats where technically permitted. Import quarantine detects duplicate feeds, malformed recurrence/timezones, organizer/attendee ambiguity, inaccessible links, and unsupported reminders; originals and fidelity reports enable recovery. Export reports omitted private/source fields and never escalates access.

## Failures and scale

Handle DST gaps/folds, organizer changes, revoked participants, duplicate feeds/records, stale/removed source, notification failure, reconnect, occupied region, conflicting series changes, partial first sync, permission loss, interrupted AI, and import quarantine. Load large ranges by window, virtualize dense lanes/agenda, cache derived conflicts, and meter bandwidth/render/storage without default commercial enforcement.

## Tasks

### CAL-01 Define layers/sources/series/occurrences/timezones/availability/overlays/reminders/links, stable regions, manifests, validation, and migrations

- [ ] Implemented
- [ ] Verified

### CAL-02 Build exact reference plus week/day/month/agenda/timetable/panel/card/embed/history/print/responsive representations with every control functional

- [ ] Implemented
- [ ] Verified

### CAL-03 Implement live collaboration, recurrence/DST/occurrence edits, presence/comments, region claims/conflicts, free/busy, notifications, reconnect, and range loading

- [ ] Implemented
- [ ] Verified

### CAL-04 Implement permission-filtered private/workspace/shared/public/source layers, embed/context filtering, revocation, and collaborative planning

- [ ] Implemented
- [ ] Verified

### CAL-05 Implement automatic ManageBac first-sync projections and safe later hashes/source ownership/overlays/tombstones/detach/duplicates/conflict review

- [ ] Implemented
- [ ] Verified

### CAL-06 Implement on-demand time skill, AI planning/replanning/linking with constraints/previews/approvals, real region effects, cleanup, and reduced motion

- [ ] Implemented
- [ ] Verified

### CAL-07 Implement ICS/CSV and staged major-calendar migration with quarantine, subscription safety, fidelity/unsupported reports, recovery, export, and tests

- [ ] Implemented
- [ ] Verified

### CAL-08 Migrate dated work, remove legacy paths, and prove every UI control, DST, recurrence, privacy, mixed collaboration, source sync, history, embeds, and recovery

- [ ] Implemented
- [ ] Verified

